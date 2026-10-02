"""
GigPilot — Live-only Bybit USDT-Perp autonomous trading platform.

Invariants
----------
1. LIVE ONLY. Host hard-coded to https://api.bybit.com. Any string
   containing testnet/demo/paper/sim/mock/fake aborts startup.
2. ONE-WAY ONLY. Hedge accounts are refused at boot (see _detect_position_mode).
3. FAIL CLOSED. Stale book, thin depth, unreadable fee, unsafe margin, or
   missing step size all produce DO NOTHING.
4. REAL EDGE ONLY. Trades only when net edge after live taker fee + spread +
   slippage + funding clears GIGPILOT_HURDLE_BPS.
5. EXCHANGE IS AUTHORITY. Positions, orders, fills, and realized PnL are
   reconciled from Bybit. Local journal is a mirror, not a source.
6. AUDITABLE. Every mutation writes to SQLite (WAL) and appears on
   /api/state, /metrics, and the dashboard.
"""

from __future__ import annotations
import asyncio, hashlib, hmac, json, logging, math, os, sys, time, uuid
import sqlite3
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlencode

import aiohttp
import uvicorn
from fastapi import FastAPI, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse


# =============================================================================
# 0. Utilities
# =============================================================================
def now_ms() -> int: return int(time.time() * 1000)
def now_iso() -> str: return datetime.now(timezone.utc).isoformat(timespec="milliseconds")
def f(x: Any, default: float = 0.0) -> float:
    try: return float(x)
    except (TypeError, ValueError): return default


def _maybe_load_aws_secret() -> None:
    arn = os.getenv("BYBIT_SECRET_ARN", "").strip()
    if not arn: return
    try:
        import boto3  # type: ignore
        client = boto3.client("secretsmanager",
                              region_name=os.getenv("AWS_REGION", "us-east-1"))
        payload = json.loads(client.get_secret_value(SecretId=arn)["SecretString"])
    except Exception as e:
        print(f"FATAL: cannot read secret {arn}: {e}", file=sys.stderr)
        sys.exit(2)
    for k in ("BYBIT_API_KEY", "BYBIT_API_SECRET"):
        if k in payload and not os.getenv(k):
            os.environ[k] = str(payload[k])
    print("hydrated Bybit credentials from Secrets Manager", file=sys.stderr)


def _maybe_load_local_keys() -> tuple[str, str]:
    key = os.getenv("BYBIT_API_KEY", "").strip()
    secret = os.getenv("BYBIT_API_SECRET", "").strip()
    if not key or not secret:
        try:
            for candidate in [".bybit-quant-keys.json", ".env"]:
                if os.path.exists(candidate):
                    if candidate.endswith(".json"):
                        with open(candidate, "r") as cf:
                            kd = json.load(cf)
                            key = key or kd.get("apiKey", "").strip()
                            secret = secret or kd.get("apiSecret", "").strip()
                    else:
                        with open(candidate, "r") as cf:
                            for line in cf:
                                if line.startswith("BYBIT_API_KEY="):
                                    key = key or line.split("=", 1)[1].strip().strip('"').strip("'")
                                elif line.startswith("BYBIT_API_SECRET="):
                                    secret = secret or line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return key, secret


# =============================================================================
# 1. Config
# =============================================================================
LIVE_HOST = "https://api.bybit.com"
WS_PUBLIC = "wss://stream.bybit.com/v5/public/linear"
WS_PRIVATE = "wss://stream.bybit.com/v5/private"
FORBIDDEN = ("testnet", "demo", "paper", "sim", "mock", "fake")


@dataclass
class Config:
    api_key: str; api_secret: str; symbols: list[str]
    host: str = LIVE_HOST; ws_public: str = WS_PUBLIC; ws_private: str = WS_PRIVATE
    arm: bool = False; recv_window: str = "5000"
    edge_hurdle_bps: float = 3.0
    fee_ceiling_bps: float = 8.0
    slippage_factor: float = 0.5
    max_leverage: float = 3.0
    max_symbol_notional_pct: float = 15.0
    max_gross_notional_pct: float = 40.0
    risk_per_trade_pct: float = 0.5
    max_daily_loss_pct: float = 1.5
    max_concurrent_positions: int = 3
    min_arm_capital_usdt: float = 67.0
    atr_period: int = 14
    stop_atr_mult: float = 2.0
    tp_atr_mult: float = 2.5
    min_stop_bps: float = 15.0
    time_stop_min: int = 240
    staleness_ms: int = 1500
    book_levels: int = 5
    momentum_window_s: int = 30
    signal_fair_shift_bps: float = 2.5
    db_path: str = "gigpilot.db"
    log_level: str = "INFO"

    @staticmethod
    def from_env() -> "Config":
        _maybe_load_aws_secret()
        key, secret = _maybe_load_local_keys()
        if not key or not secret:
            print("FATAL: BYBIT_API_KEY / BYBIT_API_SECRET required.", file=sys.stderr)
            sys.exit(2)
        host = os.getenv("GIGPILOT_HOST", LIVE_HOST).strip()
        if any(x in host.lower() for x in FORBIDDEN) or host != LIVE_HOST:
            print(f"FATAL: host must be exactly {LIVE_HOST}.", file=sys.stderr)
            sys.exit(2)
        syms = [s.strip().upper() for s in
                os.getenv("GIGPILOT_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT").split(",")
                if s.strip()]
        if not syms:
            print("FATAL: GIGPILOT_SYMBOLS empty.", file=sys.stderr); sys.exit(2)
        return Config(
            api_key=key, api_secret=secret, symbols=syms,
            arm=os.getenv("GIGPILOT_ARM", "0") == "1",
            edge_hurdle_bps=float(os.getenv("GIGPILOT_HURDLE_BPS", "3.0")),
            max_leverage=float(os.getenv("GIGPILOT_MAX_LEV", "3.0")),
            max_daily_loss_pct=float(os.getenv("GIGPILOT_MAX_DAILY_LOSS", "1.5")),
            min_arm_capital_usdt=float(os.getenv("GIGPILOT_MIN_ARM_CAPITAL_USDT", "67.0")),
            db_path=os.getenv("GIGPILOT_DB_PATH", "gigpilot.db"),
            log_level=os.getenv("GIGPILOT_LOG_LEVEL", "INFO"),
        )


# =============================================================================
# 2. Logging + Metrics
# =============================================================================
class JsonFormatter(logging.Formatter):
    def format(self, r: logging.LogRecord) -> str:
        p = {"ts": now_iso(), "level": r.levelname, "msg": r.getMessage(), "logger": r.name}
        if r.exc_info: p["exc"] = self.formatException(r.exc_info)
        for k, v in getattr(r, "extra", {}).items(): p[k] = v
        return json.dumps(p, separators=(",", ":"))


def setup_logging(level: str) -> logging.Logger:
    h = logging.StreamHandler(sys.stdout); h.setFormatter(JsonFormatter())
    root = logging.getLogger(); root.handlers[:] = [h]; root.setLevel(level.upper())
    return logging.getLogger("gigpilot")


log = setup_logging("INFO")


class Metrics:
    def __init__(self): self.g: dict[str, float] = {}; self.c: dict[str, float] = {}
    def set(self, n: str, v: float, **l: str):
        k = n + ("{" + ",".join(f'{a}="{b}"' for a, b in sorted(l.items())) + "}" if l else "")
        self.g[k] = v
    def inc(self, n: str, v: float = 1.0, **l: str):
        k = n + ("{" + ",".join(f'{a}="{b}"' for a, b in sorted(l.items())) + "}" if l else "")
        self.c[k] = self.c.get(k, 0.0) + v
    def render(self) -> str:
        return "\n".join([f"{k} {v}" for k, v in sorted(self.g.items())] +
                         [f"{k} {v}" for k, v in sorted(self.c.items())]) + "\n"


METRICS = Metrics()


# =============================================================================
# 3. Bybit REST v5
# =============================================================================
class BybitError(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(f"Bybit {code}: {msg}"); self.code = code; self.msg = msg


class BybitREST:
    def __init__(self, cfg: Config):
        self.cfg = cfg; self._sess: Optional[aiohttp.ClientSession] = None

    async def start(self):
        if self._sess is None:
            self._sess = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10),
                headers={"User-Agent": "gigpilot/1.2"},
            )

    async def stop(self):
        if self._sess: await self._sess.close(); self._sess = None

    def _sign(self, ts: str, payload: str) -> str:
        msg = ts + self.cfg.api_key + self.cfg.recv_window + payload
        return hmac.new(self.cfg.api_secret.encode(), msg.encode(), hashlib.sha256).hexdigest()

    async def _req(self, method: str, path: str, params: Optional[dict] = None,
                   body: Optional[dict] = None, signed: bool = True, retries: int = 3) -> dict:
        assert self._sess is not None
        params = params or {}; url = self.cfg.host + path; last_err = None
        for attempt in range(retries):
            try:
                if signed:
                    ts = str(now_ms())
                    if method == "GET":
                        payload = urlencode(sorted(params.items()))
                        headers = {
                            "X-BAPI-API-KEY": self.cfg.api_key,
                            "X-BAPI-TIMESTAMP": ts,
                            "X-BAPI-RECV-WINDOW": self.cfg.recv_window,
                            "X-BAPI-SIGN": self._sign(ts, payload),
                        }
                        async with self._sess.get(url, params=params, headers=headers) as r:
                            data = await r.json()
                            rem = r.headers.get("X-Bapi-Limit-Status")
                            if rem: METRICS.set("gigpilot_rest_rate_limit_remaining", f(rem))
                    else:
                        bs = json.dumps(body or {}, separators=(",", ":"))
                        headers = {
                            "X-BAPI-API-KEY": self.cfg.api_key,
                            "X-BAPI-TIMESTAMP": ts,
                            "X-BAPI-RECV-WINDOW": self.cfg.recv_window,
                            "X-BAPI-SIGN": self._sign(ts, bs),
                            "Content-Type": "application/json",
                        }
                        async with self._sess.post(url, data=bs, headers=headers) as r:
                            data = await r.json()
                else:
                    async with self._sess.get(url, params=params) as r:
                        data = await r.json()
                if not isinstance(data, dict): raise BybitError(-1, f"non-dict: {data}")
                if data.get("retCode") != 0:
                    raise BybitError(int(data.get("retCode", -1)), data.get("retMsg", "?"))
                return data.get("result", {})
            except BybitError:
                raise
            except Exception as e:
                last_err = e
                log.warning("REST %s %s attempt %d: %s", method, path, attempt + 1, e)
                await asyncio.sleep(0.4 * (2 ** attempt))
        raise RuntimeError(f"REST {method} {path} failed: {last_err}")

    async def tickers(self):
        return (await self._req("GET", "/v5/market/tickers", {"category": "linear"},
                                signed=False)).get("list", [])
    async def kline(self, symbol: str, interval: str = "1", limit: int = 200):
        return (await self._req("GET", "/v5/market/kline",
                                {"category": "linear", "symbol": symbol,
                                 "interval": interval, "limit": limit},
                                signed=False)).get("list", [])
    async def instrument(self, symbol: str):
        r = await self._req("GET", "/v5/market/instruments-info",
                            {"category": "linear", "symbol": symbol}, signed=False)
        lst = r.get("list", []); return lst[0] if lst else {}
    async def wallet(self):
        return await self._req("GET", "/v5/account/wallet-balance", {"accountType": "UNIFIED"})
    async def fee_rate(self, symbol: str):
        r = await self._req("GET", "/v5/account/fee-rate",
                            {"category": "linear", "symbol": symbol})
        lst = r.get("list", []); return lst[0] if lst else {}
    async def positions(self):
        return (await self._req("GET", "/v5/position/list",
                                {"category": "linear", "settleCoin": "USDT"})).get("list", [])
    async def open_orders(self):
        return (await self._req("GET", "/v5/order/realtime",
                                {"category": "linear", "settleCoin": "USDT"})).get("list", [])
    async def closed_pnl(self, limit: int = 100):
        return (await self._req("GET", "/v5/position/closed-pnl",
                                {"category": "linear", "limit": limit})).get("list", [])
    async def set_leverage(self, symbol: str, lev: float):
        try:
            await self._req("POST", "/v5/position/set-leverage", body={
                "category": "linear", "symbol": symbol,
                "buyLeverage": str(lev), "sellLeverage": str(lev),
            })
        except BybitError as e:
            if e.code != 110043: raise
    async def place_order(self, **kw):
        return await self._req("POST", "/v5/order/create", body=kw)
    async def cancel_order(self, **kw):
        return await self._req("POST", "/v5/order/cancel", body=kw)
    async def cancel_all(self, symbol: str):
        return await self._req("POST", "/v5/order/cancel-all",
                               body={"category": "linear", "symbol": symbol})
    async def trading_stop(self, **kw):
        return await self._req("POST", "/v5/position/trading-stop", body=kw)


# =============================================================================
# 4. Market state
# =============================================================================
@dataclass
class MarketState:
    symbol: str
    bids: list = field(default_factory=list); asks: list = field(default_factory=list)
    last: float = 0.0; mark: float = 0.0; index: float = 0.0
    funding_rate: float = 0.0; next_funding_ms: int = 0
    trades: deque = field(default_factory=lambda: deque(maxlen=512))
    closes_1m: deque = field(default_factory=lambda: deque(maxlen=200))
    ts_book_ms: int = 0; ts_tick_ms: int = 0

    @property
    def mid(self) -> float:
        if not self.bids or not self.asks: return 0.0
        return (self.bids[0][0] + self.asks[0][0]) / 2.0

    @property
    def spread_bps(self) -> float:
        if not self.bids or not self.asks: return float("inf")
        m = self.mid
        return float("inf") if m <= 0 else (self.asks[0][0] - self.bids[0][0]) / m * 1e4

    def apply_book_snapshot(self, b, a):
        self.bids = sorted(((f(p), f(s)) for p, s in b if f(s) > 0), key=lambda x: -x[0])
        self.asks = sorted(((f(p), f(s)) for p, s in a if f(s) > 0), key=lambda x: x[0])
        self.ts_book_ms = now_ms()

    def apply_book_delta(self, b, a):
        for price, size in b:
            p, s = f(price), f(size)
            self.bids = [(bp, bs) for bp, bs in self.bids if bp != p]
            if s > 0:
                self.bids.append((p, s)); self.bids.sort(key=lambda x: -x[0])
        for price, size in a:
            p, s = f(price), f(size)
            self.asks = [(ap, aa) for ap, aa in self.asks if ap != p]
            if s > 0:
                self.asks.append((p, s)); self.asks.sort(key=lambda x: x[0])
        self.ts_book_ms = now_ms()

    def depth_notional(self, side: str, levels: int) -> float:
        book = self.bids if side == "Buy" else self.asks
        return sum(p * s for p, s in book[:levels])

    def imbalance(self, levels: int) -> float:
        bv = sum(s for _, s in self.bids[:levels]); av = sum(s for _, s in self.asks[:levels])
        tot = bv + av
        return 0.0 if tot <= 0 else (bv - av) / tot

    def momentum(self, window_s: int) -> float:
        if not self.trades: return 0.0
        cutoff = now_ms() - window_s * 1000
        rec = [t for t in self.trades if t[0] >= cutoff]
        if len(rec) < 5: return 0.0
        p0, p1 = rec[0][1], rec[-1][1]
        return 0.0 if p0 <= 0 else math.log(p1 / p0)

    def atr_bps(self, period: int, fallback: float = 20.0) -> float:
        if len(self.closes_1m) < period + 1: return fallback
        closes = list(self.closes_1m)[-(period + 1):]
        trs = [abs(closes[i] - closes[i-1]) / closes[i-1] for i in range(1, len(closes))]
        return fallback if not trs else (sum(trs) / len(trs)) * 1e4


# =============================================================================
# 5. Edge engine
# =============================================================================
@dataclass
class EdgeEstimate:
    symbol: str; side: str
    gross_bps: float; fee_bps: float; spread_bps: float
    slip_bps: float; funding_bps: float; net_bps: float
    tradable: bool; reason: str; ts_ms: int


class EdgeEngine:
    def __init__(self, cfg: Config): self.cfg = cfg

    def evaluate(self, ms: MarketState, side: str, fee_rate_bps: float,
                 holding_hours: float, required_notional: float) -> EdgeEstimate:
        if not ms.bids or not ms.asks: return self._no(ms.symbol, side, "no_book")
        if now_ms() - ms.ts_book_ms > self.cfg.staleness_ms:
            return self._no(ms.symbol, side, "stale_book")
        if now_ms() - ms.ts_tick_ms > self.cfg.staleness_ms:
            return self._no(ms.symbol, side, "stale_tick")
        mid = ms.mid
        if mid <= 0: return self._no(ms.symbol, side, "no_mid")

        imb = ms.imbalance(self.cfg.book_levels)
        mom = ms.momentum(self.cfg.momentum_window_s)
        signal = max(-1.0, min(1.0, 0.65 * imb + 0.35 * math.tanh(mom * 500.0)))
        fair = mid * (1.0 + signal * self.cfg.signal_fair_shift_bps / 1e4)
        entry = ms.asks[0][0] if side == "Buy" else ms.bids[0][0]
        gross_bps = ((fair - entry) if side == "Buy" else (entry - fair)) / mid * 1e4
        fee_bps = fee_rate_bps
        spread_bps = ms.spread_bps
        if not math.isfinite(spread_bps): return self._no(ms.symbol, side, "no_spread")
        if ms.depth_notional(side, self.cfg.book_levels) < required_notional:
            return EdgeEstimate(ms.symbol, side, gross_bps, fee_bps, spread_bps,
                                0.0, 0.0, 0.0, False, "insufficient_depth", now_ms())
        slip_bps = spread_bps * self.cfg.slippage_factor
        funding_bps = abs(ms.funding_rate) * 1e4 * (holding_hours / 8.0)
        net = gross_bps - fee_bps - spread_bps - slip_bps - funding_bps
        ok = net >= self.cfg.edge_hurdle_bps
        return EdgeEstimate(ms.symbol, side, gross_bps, fee_bps, spread_bps,
                            slip_bps, funding_bps, net, ok,
                            "clears_hurdle" if ok
                            else f"net_{net:.2f}bps_lt_{self.cfg.edge_hurdle_bps}",
                            now_ms())

    @staticmethod
    def _no(symbol: str, side: str, reason: str) -> EdgeEstimate:
        return EdgeEstimate(symbol, side, 0, 0, 0, 0, 0, 0, False, reason, now_ms())


# =============================================================================
# 6. Risk gate
# =============================================================================
@dataclass
class Portfolio:
    equity: float = 0.0
    daily_pnl: float = 0.0
    gross_notional: float = 0.0
    symbol_notional: dict = field(default_factory=dict)
    open_positions: int = 0
    margin_ratio: float = 0.0


class RiskGate:
    def __init__(self, cfg: Config): self.cfg = cfg

    def check(self, p: Portfolio, symbol: str, notional: float, leverage: float,
              armed: bool, day_start_equity: float) -> tuple[bool, str]:
        if not armed: return False, "not_armed"
        if p.equity <= 0: return False, "no_equity"
        if leverage > self.cfg.max_leverage:
            return False, f"leverage_{leverage:.2f}_gt_{self.cfg.max_leverage}"
        if day_start_equity > 0:
            loss_pct = -p.daily_pnl / day_start_equity * 100.0
            if loss_pct >= self.cfg.max_daily_loss_pct:
                return False, f"daily_loss_{loss_pct:.2f}pct"
        if p.margin_ratio > 0.6:
            return False, f"margin_ratio_{p.margin_ratio:.2f}"
        if p.open_positions >= self.cfg.max_concurrent_positions:
            return False, "max_concurrent"
        if p.symbol_notional.get(symbol, 0.0) + notional > \
           p.equity * self.cfg.max_symbol_notional_pct / 100.0:
            return False, "symbol_concentration"
        if p.gross_notional + notional > \
           p.equity * self.cfg.max_gross_notional_pct / 100.0:
            return False, "gross_exposure"
        return True, "ok"


# =============================================================================
# 7. Executor (one-way only; refuses unknown step)
# =============================================================================
class Executor:
    def __init__(self, cfg: Config, rest: BybitREST, step_sizes: dict[str, float]):
        self.cfg = cfg; self.rest = rest; self.step_size = step_sizes

    def _round_qty(self, symbol: str, qty: float) -> str:
        step = self.step_size.get(symbol, 0.0)
        if step <= 0:
            raise RuntimeError(f"step size unknown for {symbol} — refusing to trade")
        v = math.floor(qty / step) * step
        if v <= 0:
            raise RuntimeError(f"qty {qty} rounds to 0 at step {step} for {symbol}")
        return f"{v:.10f}".rstrip("0").rstrip(".")

    async def open_protected(self, symbol: str, side: str, qty: float,
                             tp_price: float, sl_price: float,
                             position_idx: int = 0) -> dict:
        qty_s = self._round_qty(symbol, qty)
        link = f"gp-{uuid.uuid4().hex[:26]}"
        try:
            await self.rest.place_order(category="linear", symbol=symbol, side=side,
                                        orderType="Market", qty=qty_s,
                                        orderLinkId=link, positionIdx=position_idx)
        except BybitError as e:
            if e.code != 110072: raise
        try:
            await self.rest.trading_stop(category="linear", symbol=symbol, tpslMode="Full",
                                         positionIdx=position_idx,
                                         takeProfit=str(tp_price), stopLoss=str(sl_price),
                                         tpTriggerBy="MarkPrice", slTriggerBy="MarkPrice")
        except Exception as e:
            log.error("protection failed %s — unwinding: %s", symbol, e)
            await self._unwind(symbol, side, qty_s, position_idx)
            raise RuntimeError("PROTECTION_FAILED_POSITION_FLATTENED")
        METRICS.inc("gigpilot_trades_total", side=side, result="opened")
        return {"orderLinkId": link, "qty": qty_s, "tp": tp_price, "sl": sl_price}

    async def _unwind(self, symbol: str, side: str, qty_s: str, position_idx: int):
        opp = "Sell" if side == "Buy" else "Buy"
        try:
            await self.rest.place_order(category="linear", symbol=symbol, side=opp,
                                        orderType="Market", qty=qty_s, reduceOnly=True,
                                        orderLinkId=f"gp-unwind-{uuid.uuid4().hex[:20]}",
                                        positionIdx=position_idx)
        except Exception as e:
            log.critical("UNWIND FAILED %s: %s", symbol, e)

    async def close_market(self, symbol: str, side: str, qty_s: str, position_idx: int = 0):
        opp = "Sell" if side == "Buy" else "Buy"
        return await self.rest.place_order(category="linear", symbol=symbol, side=opp,
                                           orderType="Market", qty=qty_s, reduceOnly=True,
                                           orderLinkId=f"gp-close-{uuid.uuid4().hex[:20]}",
                                           positionIdx=position_idx)


# =============================================================================
# 8. Store
# =============================================================================
class Store:
    def __init__(self, path: str):
        self.path = path
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._init()

    def _init(self):
        self._conn.executescript("""
        CREATE TABLE IF NOT EXISTS journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL, kind TEXT NOT NULL, symbol TEXT, payload TEXT);
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
            qty REAL NOT NULL, entry REAL NOT NULL, tp REAL, sl REAL,
            order_link_id TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            exit_ts_ms INTEGER, exit_px REAL,
            realized_pnl REAL DEFAULT 0, fees REAL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS ix_trades_open ON trades(status, symbol);
        CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        """)
        self._conn.commit()

    def journal(self, kind: str, symbol: Optional[str], payload: dict):
        self._conn.execute("INSERT INTO journal(ts_ms,kind,symbol,payload) VALUES(?,?,?,?)",
                           (now_ms(), kind, symbol, json.dumps(payload, default=str)))
        self._conn.commit()

    def open_trade(self, symbol, side, qty, entry, tp, sl, link) -> int:
        cur = self._conn.execute(
            """INSERT INTO trades(ts_ms,symbol,side,qty,entry,tp,sl,order_link_id)
               VALUES(?,?,?,?,?,?,?,?)""",
            (now_ms(), symbol, side, qty, entry, tp, sl, link))
        self._conn.commit()
        return cur.lastrowid

    def mark_closed_pending(self, trade_id: int, reason: str):
        """Local close registered; awaiting exchange-verified PnL."""
        self._conn.execute(
            "UPDATE trades SET status='pending_verify', exit_ts_ms=? WHERE id=?",
            (now_ms(), trade_id))
        self._conn.commit()
        self.journal("CLOSE_PENDING", None, {"trade_id": trade_id, "reason": reason})

    def apply_exchange_pnl(self, trade_id: int, exit_px: float,
                           realized_pnl: float, fees: float):
        self._conn.execute(
            """UPDATE trades SET status='closed', exit_ts_ms=?, exit_px=?,
               realized_pnl=?, fees=? WHERE id=?""",
            (now_ms(), exit_px, realized_pnl, fees, trade_id))
        self._conn.commit()

    def open_trades(self) -> list[dict]:
        cur = self._conn.execute(
            "SELECT id,ts_ms,symbol,side,qty,entry,tp,sl,order_link_id "
            "FROM trades WHERE status='open'")
        cols = ["id", "ts_ms", "symbol", "side", "qty", "entry", "tp", "sl", "order_link_id"]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def match_closed_trade(self, symbol: str, closing_side: str,
                           created_ms: int) -> Optional[dict]:
        entry_side = "Sell" if closing_side == "Buy" else "Buy"
        row = self._conn.execute("""
            SELECT id, ts_ms, symbol, side, qty, entry FROM trades
            WHERE symbol=? AND side=? AND status IN ('open','pending_verify')
            ORDER BY ABS(ts_ms - ?) ASC LIMIT 1
        """, (symbol, entry_side, created_ms)).fetchone()
        if row is None: return None
        return {"id": row[0], "ts_ms": row[1], "symbol": row[2],
                "side": row[3], "qty": row[4], "entry": row[5]}

    def kv_set(self, k: str, v: str):
        self._conn.execute("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)", (k, v))
        self._conn.commit()

    def kv_get(self, k: str) -> Optional[str]:
        r = self._conn.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return r[0] if r else None

    def realized_today(self) -> float:
        midnight = int(datetime.now(timezone.utc)
                       .replace(hour=0, minute=0, second=0, microsecond=0)
                       .timestamp() * 1000)
        r = self._conn.execute(
            "SELECT COALESCE(SUM(realized_pnl - fees),0) FROM trades "
            "WHERE status='closed' AND exit_ts_ms>=?", (midnight,)).fetchone()
        return f(r[0] if r else 0)


# =============================================================================
# 9. Bybit WebSocket
# =============================================================================
class BybitWS:
    def __init__(self, cfg: Config, markets: dict, on_private_event=None):
        self.cfg = cfg; self.markets = markets; self.on_private_event = on_private_event
        self._stop = asyncio.Event()
        self._public_ok = False; self._private_ok = False
        self._tasks: list[asyncio.Task] = []

    async def start(self):
        self._tasks = [asyncio.create_task(self._public_loop(), name="ws-public"),
                       asyncio.create_task(self._private_loop(), name="ws-private")]

    async def arm_preflight(self) -> tuple[bool, list[dict]]:
        """Run every safety gate required before enabling the autonomous loop.
        This method never places an order.
        """
        if self.armed:
            ok, reasons = await self._arm_gate_check()
            return ok, reasons if not ok else [{"code": "ALREADY_ARMED", "message": "GigPilot is already armed; request is idempotent."}]
        return await self._arm_gate_check()

    async def _arm_gate_check(self) -> tuple[bool, list[dict]]:
        reasons: list[dict] = []
        def block(code: str, message: str, details: Optional[dict] = None):
            item = {"code": code, "message": message}
            if details: item["details"] = details
            reasons.append(item)

        if not self.cfg.api_key or not self.cfg.api_secret:
            block("BYBIT_CREDENTIALS_MISSING", "Valid Bybit Linear Futures credentials are required.")
        if self.position_mode != "one-way":
            block("POSITION_MODE_INVALID", "Bybit account must be in one-way position mode.", {"position_mode": self.position_mode})

        try:
            wallet = await self.rest.wallet()
            accounts = wallet.get("list", [])
            if not accounts:
                block("CAPITAL_UNAVAILABLE", "Bybit Unified account balance response is empty.")
            else:
                account = accounts[0]
                coins = account.get("coin") or []
                usdt = next((c for c in coins if str(c.get("coin", "")).upper() == "USDT"), None)
                if not usdt:
                    block("USDT_CAPITAL_UNAVAILABLE", "No eligible USDT collateral was returned by Bybit.")
                else:
                    usdt_equity = f(usdt.get("equity"), 0.0)
                    usdt_wallet = f(usdt.get("walletBalance"), 0.0)
                    available = f(usdt.get("availableToWithdraw"), usdt_equity)
                    eligible_values = [x for x in (usdt_equity, usdt_wallet, available) if x >= 0]
                    eligible = min(eligible_values) if eligible_values else 0.0
                    if eligible < self.cfg.min_arm_capital_usdt:
                        block("INSUFFICIENT_CAPITAL", "Eligible USDT capital is below the configured ARM minimum.",
                              {"eligible_usdt": eligible, "required_usdt": self.cfg.min_arm_capital_usdt})
                    if usdt_equity > 0:
                        self.portfolio.equity = usdt_equity
        except Exception as e:
            block("BYBIT_CONNECTIVITY_INVALID", "Authenticated Bybit account connectivity failed during ARM preflight.", {"error": str(e)})

        try:
            positions = await self.rest.positions()
            idxs = {int(p.get("positionIdx", 0)) for p in positions}
            if idxs - {0}:
                block("POSITION_MODE_INVALID", "Bybit returned hedge-mode position indices; one-way mode is required.", {"position_indices": sorted(idxs)})
        except Exception as e:
            block("BYBIT_CONNECTIVITY_INVALID", "Unable to verify Bybit Linear Futures positions.", {"error": str(e)})

        for sym in self.cfg.symbols:
            ms = self.markets.get(sym)
            if not ms or not ms.bids or not ms.asks or ms.mid <= 0:
                block("MARKET_DATA_INVALID", f"Live order-book data is unavailable for {sym}.")
                continue
            if now_ms() - ms.ts_book_ms > self.cfg.staleness_ms or now_ms() - ms.ts_tick_ms > self.cfg.staleness_ms:
                block("MARKET_DATA_STALE", f"Live market data is stale for {sym}.")
            if len(ms.closes_1m) < 5:
                block("MARKET_DATA_INSUFFICIENT", f"Insufficient candle depth for {sym}.", {"candles": len(ms.closes_1m)})

            try:
                instrument = await self.rest.instrument(sym)
                lot = instrument.get("lotSizeFilter", {})
                price = instrument.get("priceFilter", {})
                if f(lot.get("qtyStep"), 0.0) <= 0 or f(price.get("tickSize"), 0.0) <= 0:
                    block("RISK_CONFIGURATION_INVALID", f"Instrument sizing configuration is invalid for {sym}.")
                taker = f((await self.rest.fee_rate(sym)).get("takerFeeRate"), 0.0)
                if taker <= 0:
                    block("RISK_CONFIGURATION_INVALID", f"Bybit taker fee is unreadable for {sym}; ARM fails closed.")
                self.fee_rate_bps[sym] = taker * 1e4
            except Exception as e:
                block("BYBIT_CONNECTIVITY_INVALID", f"Unable to validate instrument/fee configuration for {sym}.", {"error": str(e)})

            try:
                await self.rest.set_leverage(sym, self.cfg.max_leverage)
                verified = next((p for p in await self.rest.positions() if p.get("symbol") == sym), None)
                lev = f(verified.get("leverage"), 0.0) if verified else 0.0
                if lev <= 0 or lev > self.cfg.max_leverage:
                    block("LEVERAGE_INVALID", f"Configured leverage could not be verified for {sym}.",
                          {"configured_max": self.cfg.max_leverage, "verified": lev})
            except Exception as e:
                block("LEVERAGE_INVALID", f"Bybit leverage configuration failed for {sym}.", {"error": str(e)})

        if not (self.ws._public_ok and self.ws._private_ok):
            block("BYBIT_CONNECTIVITY_INVALID", "Bybit public/private WebSocket connectivity is not healthy.",
                  {"public_ws": self.ws._public_ok, "private_ws": self.ws._private_ok})

        try:
            await self.reconciler.run_once()
            if not self.reconciler.healthy:
                block("RECONCILIATION_UNHEALTHY", "Position/order reconciliation is not healthy.",
                      {"last_error": self.reconciler.last_error})
        except Exception as e:
            block("RECONCILIATION_UNHEALTHY", "Reconciliation preflight failed.", {"error": str(e)})

        tradable = []
        for sym, ms in self.markets.items():
            fee_bps = self.fee_rate_bps.get(sym, self.cfg.fee_ceiling_bps)
            for side in ("Buy", "Sell"):
                est = self.edge.evaluate(ms, side, fee_bps, 1.0, max(50.0, self.portfolio.equity * 0.03))
                current = self.signals.get(sym)
                if current is None or est.net_bps > current.net_bps:
                    self.signals[sym] = est
                if est.tradable:
                    tradable.append(est)
        if not tradable:
            block("NET_EDGE_GATE_UNHEALTHY", "No current market has verified expected net edge above the configured hurdle.",
                  {"hurdle_bps": self.cfg.edge_hurdle_bps})

        if self.portfolio.margin_ratio > 0.6:
            block("MARGIN_CONFIGURATION_INVALID", "Current margin utilization is above the safe ARM threshold.",
                  {"margin_ratio": self.portfolio.margin_ratio})

        if reasons:
            self.store.journal("ARM_BLOCKED", None, {"reasons": reasons})
            return False, reasons
        return True, []

    async def arm(self) -> tuple[bool, list[dict]]:
        ok, reasons = await self.arm_preflight()
        if not ok:
            return False, reasons
        if not self.armed:
            self.armed = True
            self.store.journal("ARM", None, {"hurdle_bps": self.cfg.edge_hurdle_bps})
            log.warning("MANUAL ARM: all safety gates passed")
        return True, reasons

    async def stop(self):
        self._stop.set()
        for t in self._tasks: t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _public_loop(self):
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(
                        total=None, sock_connect=10, sock_read=60)) as sess:
                    async with sess.ws_connect(self.cfg.ws_public, heartbeat=20) as ws:
                        self._public_ok = True
                        METRICS.set("gigpilot_ws_connected", 1, stream="public")
                        backoff = 1.0
                        args = []
                        for s in self.cfg.symbols:
                            args += [f"orderbook.50.{s}", f"tickers.{s}", f"publicTrade.{s}"]
                        await ws.send_json({"op": "subscribe", "args": args})
                        log.info("public WS subscribed: %s", self.cfg.symbols)
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                self._handle_public(json.loads(msg.data))
                            elif msg.type in (aiohttp.WSMsgType.CLOSED,
                                              aiohttp.WSMsgType.ERROR):
                                break
            except asyncio.CancelledError: return
            except Exception as e: log.warning("public WS: %s", e)
            finally:
                self._public_ok = False
                METRICS.set("gigpilot_ws_connected", 0, stream="public")
            if self._stop.is_set(): return
            await asyncio.sleep(backoff); backoff = min(30.0, backoff * 2)

    def _handle_public(self, msg: dict):
        topic = msg.get("topic", "")
        if not topic: return
        mtype = msg.get("type"); data = msg.get("data")
        if topic.startswith("orderbook."):
            parts = topic.split(".")
            if len(parts) < 3: return
            sym = parts[2]; ms = self.markets.get(sym)
            if ms is None or not isinstance(data, dict): return
            b, a = data.get("b") or [], data.get("a") or []
            if mtype == "snapshot": ms.apply_book_snapshot(b, a)
            else: ms.apply_book_delta(b, a)
            METRICS.set("gigpilot_tick_age_ms", now_ms() - ms.ts_book_ms, symbol=sym)
        elif topic.startswith("tickers."):
            sym = topic.split(".", 1)[1]; ms = self.markets.get(sym)
            if ms is None or not isinstance(data, dict): return
            ms.last = f(data.get("lastPrice"), ms.last)
            ms.mark = f(data.get("markPrice"), ms.mark)
            ms.index = f(data.get("indexPrice"), ms.index)
            ms.funding_rate = f(data.get("fundingRate"), ms.funding_rate)
            ms.next_funding_ms = int(f(data.get("nextFundingTime"), 0))
            ms.ts_tick_ms = now_ms()
            METRICS.set("gigpilot_tick_age_ms", 0, symbol=sym)
            METRICS.set("gigpilot_funding_rate", ms.funding_rate, symbol=sym)
        elif topic.startswith("publicTrade."):
            sym = topic.split(".", 1)[1]; ms = self.markets.get(sym)
            if ms is None or not isinstance(data, list): return
            for t in data:
                px = f(t.get("p")); ts = int(f(t.get("T"), now_ms()))
                if px > 0: ms.trades.append((ts, px))

    async def _private_loop(self):
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(
                        total=None, sock_connect=10, sock_read=60)) as sess:
                    async with sess.ws_connect(self.cfg.ws_private, heartbeat=20) as ws:
                        expires = int((time.time() + 10) * 1000)
                        sig = hmac.new(self.cfg.api_secret.encode(),
                                       f"GET/realtime{expires}".encode(),
                                       hashlib.sha256).hexdigest()
                        await ws.send_json({"op": "auth",
                                            "args": [self.cfg.api_key, expires, sig]})
                        resp = await ws.receive_json()
                        if not resp.get("success"):
                            raise RuntimeError(f"private WS auth failed: {resp}")
                        self._private_ok = True
                        METRICS.set("gigpilot_ws_connected", 1, stream="private")
                        backoff = 1.0
                        await ws.send_json({"op": "subscribe",
                                            "args": ["position", "order",
                                                     "execution", "wallet"]})
                        log.info("private WS subscribed")
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT and self.on_private_event:
                                try: await self.on_private_event(json.loads(msg.data))
                                except Exception as e: log.error("private handler: %s", e)
                            elif msg.type in (aiohttp.WSMsgType.CLOSED,
                                              aiohttp.WSMsgType.ERROR):
                                break
            except asyncio.CancelledError: return
            except Exception as e: log.warning("private WS: %s", e)
            finally:
                self._private_ok = False
                METRICS.set("gigpilot_ws_connected", 0, stream="private")
            if self._stop.is_set(): return
            await asyncio.sleep(backoff); backoff = min(30.0, backoff * 2)


# =============================================================================
# 10. Position reconciler
# =============================================================================
class Reconciler:
    def __init__(self, cfg: Config, rest: BybitREST, store: Store, positions: dict):
        self.cfg = cfg; self.rest = rest; self.store = store; self.positions = positions
        self.healthy = False
        self.last_error: Optional[str] = "not_run"
        self.last_run_ms = 0

    async def run_once(self):
        try:
            exch = {p["symbol"]: p for p in await self.rest.positions()
                    if f(p.get("size")) > 0}
        except Exception as e:
            self.healthy = False; self.last_error = str(e); self.last_run_ms = now_ms()
            log.warning("reconcile positions: %s", e)
            METRICS.inc("gigpilot_reconcile_errors_total"); return
        for sym in list(self.positions.keys()):
            if sym not in exch:
                log.warning("RECONCILE: local %s, exchange flat — pending verify", sym)
                local = self.positions.pop(sym)
                if local.get("trade_id"):
                    self.store.mark_closed_pending(local["trade_id"], "exchange_flat")
                METRICS.inc("gigpilot_reconcile_divergences_total",
                            kind="local_open_exch_flat")
                continue
            ep = exch[sym]; e_qty = f(ep.get("size"))
            if abs(e_qty - self.positions[sym].get("qty", 0.0)) > 1e-9:
                self.positions[sym]["qty"] = e_qty
                METRICS.inc("gigpilot_reconcile_divergences_total", kind="size")
        for sym, ep in exch.items():
            if sym not in self.positions:
                log.warning("RECONCILE: adopting untracked %s", sym)
                self.positions[sym] = {"side": ep.get("side", "Buy"),
                                       "qty": f(ep.get("size")),
                                       "entry": f(ep.get("avgPrice")),
                                       "trade_id": None}
                METRICS.inc("gigpilot_reconcile_divergences_total", kind="adopt")
        try:
            for o in await self.rest.open_orders():
                link = o.get("orderLinkId", "")
                if not link.startswith("gp-"): continue
                try:
                    await self.rest.cancel_order(category="linear",
                                                 symbol=o["symbol"],
                                                 orderLinkId=link)
                    METRICS.inc("gigpilot_reconcile_divergences_total",
                                kind="orphan_cancelled")
                except Exception: pass
        except Exception as e:
            self.healthy = False; self.last_error = str(e); self.last_run_ms = now_ms()
            log.warning("reconcile orders: %s", e)
            return
        self.healthy = True; self.last_error = None; self.last_run_ms = now_ms()


# =============================================================================
# 11. Accounting reconciler — exchange-verified PnL
# =============================================================================
class AccountingReconciler:
    """Back-fills realized_pnl + fees from /v5/position/closed-pnl.
    Unmatched exchange closes emit ACCT_ORPHAN — never fabricate a local row."""

    def __init__(self, rest: BybitREST, store: Store):
        self.rest = rest; self.store = store
        self._seen_order_ids: set[str] = set()

    async def run_once(self) -> int:
        try:
            rows = await self.rest.closed_pnl(limit=100)
        except Exception as e:
            log.warning("closed-pnl fetch failed: %s", e)
            METRICS.inc("gigpilot_accounting_errors_total")
            return 0
        applied = 0
        for row in rows:
            order_id = str(row.get("orderId", ""))
            if not order_id or order_id in self._seen_order_ids: continue
            self._seen_order_ids.add(order_id)
            sym        = row.get("symbol", "")
            side       = row.get("side", "")
            avg_exit   = f(row.get("avgExitPrice"))
            closed_pnl = f(row.get("closedPnl"))
            created_ms = int(f(row.get("createdTime"), 0))
            total_fee = 0.0
            for a, b in (("openFee", "closeFee"), ("cumEntryFee", "cumExitFee")):
                if a in row or b in row:
                    total_fee = f(row.get(a)) + f(row.get(b)); break
            if total_fee == 0.0: total_fee = f(row.get("execFee"))
            matched = self.store.match_closed_trade(sym, side, created_ms)
            if matched is None:
                log.warning("ACCT: unmatched close %s side=%s pnl=%.4f",
                            sym, side, closed_pnl)
                self.store.journal("ACCT_ORPHAN", sym,
                                   {"orderId": order_id, "side": side,
                                    "pnl": closed_pnl, "fee": total_fee})
                METRICS.inc("gigpilot_accounting_orphans_total", symbol=sym)
                continue
            self.store.apply_exchange_pnl(matched["id"], avg_exit,
                                          closed_pnl, total_fee)
            applied += 1
            METRICS.inc("gigpilot_accounting_backfilled_total")
            log.info("ACCT: trade#%d %s backfilled pnl=%.4f fee=%.4f (exchange-verified)",
                     matched["id"], sym, closed_pnl, total_fee)
        if applied:
            log.info("accounting reconciler applied %d rows", applied)
        return applied


# =============================================================================
# 12. Orchestrator
# =============================================================================
class GigPilot:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.rest = BybitREST(cfg)
        self.store = Store(cfg.db_path)
        self.markets = {s: MarketState(symbol=s) for s in cfg.symbols}
        self.step_size: dict[str, float] = {}
        self.tick_size: dict[str, float] = {}
        self.executor: Optional[Executor] = None
        self.edge = EdgeEngine(cfg); self.risk = RiskGate(cfg)
        self.positions: dict[str, dict] = {}
        self.reconciler = Reconciler(cfg, self.rest, self.store, self.positions)
        self.accounting = AccountingReconciler(self.rest, self.store)
        self.ws = BybitWS(cfg, self.markets, on_private_event=self._on_private)
        self.portfolio = Portfolio()
        self.fee_rate_bps: dict[str, float] = {}
        self.day_start_equity: float = 0.0
        self._day_anchor: str = ""
        self.armed: bool = False
        self.position_mode: str = "one-way"
        self._tasks: list[asyncio.Task] = []
        self._stop = asyncio.Event()
        self.signals: dict[str, EdgeEstimate] = {}
        self.last_events: deque = deque(maxlen=200)

    @staticmethod
    def _utc_date() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    async def _detect_position_mode(self) -> str:
        last_err = None
        for attempt in range(3):
            try:
                positions = await self.rest.positions()
                idxs = {int(p.get("positionIdx", 0)) for p in positions}
                if idxs - {0}: return "hedge"
                return "one-way"
            except Exception as e:
                last_err = e
                log.warning("position-mode detection attempt %d: %s", attempt + 1, e)
                await asyncio.sleep(2 ** attempt)
        raise RuntimeError(f"cannot determine position mode: {last_err}")

    async def start(self):
        log.info("GigPilot starting — host=%s symbols=%s", self.cfg.host, self.cfg.symbols)
        await self.rest.start()

        # --- Refuse hedge at boot ---
        self.position_mode = await self._detect_position_mode()
        self.store.journal("POSITION_MODE", None, {"mode": self.position_mode})
        if self.position_mode == "hedge":
            log.critical(
                "BOOT REFUSED: hedge mode detected. This build supports ONE-WAY only. "
                "Hedge returns two legs per symbol (positionIdx 1 and 2) and this "
                "system keys positions by symbol alone — running it would attach "
                "TP/SL and the kill switch to the wrong leg. Switch the account to "
                "one-way in the Bybit UI, or request the hedge refactor."
            )
            raise SystemExit(3)

        # --- Instruments, klines, fees ---
        for s in self.cfg.symbols:
            info = await self.rest.instrument(s)
            lot = info.get("lotSizeFilter", {}); price = info.get("priceFilter", {})
            self.step_size[s] = f(lot.get("qtyStep"), 0.0)
            self.tick_size[s] = f(price.get("tickSize"), 0.01)
            if self.step_size[s] <= 0:
                log.critical("BOOT REFUSED: qtyStep missing for %s", s)
                raise SystemExit(4)
            try:
                kl = await self.rest.kline(s, "1", 200)
                closes = [f(r[4]) for r in reversed(kl) if len(r) >= 5]
                self.markets[s].closes_1m.extend(closes[-200:])
            except Exception as e:
                log.warning("kline warmup %s: %s", s, e)
            try:
                taker = f((await self.rest.fee_rate(s)).get("takerFeeRate"), 0.0)
                self.fee_rate_bps[s] = taker * 1e4 if taker > 0 else self.cfg.fee_ceiling_bps
                if taker <= 0:
                    log.warning("fee unreadable for %s — ceiling %.2f bps applied",
                                s, self.cfg.fee_ceiling_bps)
            except Exception as e:
                log.warning("fee_rate %s: %s — ceiling applied", s, e)
                self.fee_rate_bps[s] = self.cfg.fee_ceiling_bps

        self.executor = Executor(self.cfg, self.rest, self.step_size)

        # --- Anchor day_start_equity, restore from KV if same UTC day ---
        await self._refresh_portfolio()
        today = self._utc_date()
        stored_anchor = self.store.kv_get("day_anchor")
        stored_equity = self.store.kv_get("day_start_equity")
        if stored_anchor == today and stored_equity:
            self.day_start_equity = f(stored_equity)
            self._day_anchor = today
            log.info("restored day_start_equity=%.2f for %s",
                     self.day_start_equity, today)
        else:
            self.day_start_equity = self.portfolio.equity
            self._day_anchor = today
            self.store.kv_set("day_start_equity", str(self.day_start_equity))
            self.store.kv_set("day_anchor", today)
            log.info("anchored day_start_equity=%.2f for %s",
                     self.day_start_equity, today)

        for s in self.cfg.symbols:
            try: await self.rest.set_leverage(s, self.cfg.max_leverage)
            except Exception as e: log.warning("set_leverage %s: %s", s, e)

        self.armed = bool(self.cfg.arm)
        log.info("trading %s", "ARMED" if self.armed else "DISARMED (DO NOTHING)")
        self.store.journal("BOOT", None, {"symbols": self.cfg.symbols,
                                          "armed": self.armed,
                                          "hurdle_bps": self.cfg.edge_hurdle_bps,
                                          "position_mode": self.position_mode})

        self._tasks = [
            asyncio.create_task(self.ws.start(), name="ws"),
            asyncio.create_task(self._strategy_loop(), name="strategy"),
            asyncio.create_task(self._reconcile_loop(), name="reconcile"),
            asyncio.create_task(self._portfolio_loop(), name="portfolio"),
            asyncio.create_task(self._daily_reset_loop(), name="daily-reset"),
            asyncio.create_task(self._accounting_loop(), name="accounting"),
        ]

    async def stop(self):
        self._stop.set()
        await self.ws.stop()
        for t in self._tasks: t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.rest.stop()
        log.info("GigPilot stopped")

    # ---------- private WS events ----------
    async def _on_private(self, msg: dict):
        topic = msg.get("topic"); data = msg.get("data")
        if topic == "execution" and isinstance(data, list):
            for ex in data:
                if ex.get("execType") != "Trade": continue
                sym = ex.get("symbol", ""); px = f(ex.get("execPrice"))
                qty = f(ex.get("execQty")); fee = f(ex.get("execFee"))
                side = ex.get("side", ""); realized = f(ex.get("closedPnl"))
                link = ex.get("orderLinkId", "")
                self.last_events.append({
                    "ts": now_iso(), "kind": "fill", "symbol": sym, "side": side,
                    "px": px, "qty": qty, "fee": fee,
                    "closed_pnl": realized, "link": link})
                self.store.journal("FILL", sym,
                                   {"side": side, "px": px, "qty": qty, "fee": fee,
                                    "closed_pnl": realized, "link": link})
                METRICS.inc("gigpilot_fills_total", symbol=sym, side=side)
                METRICS.inc("gigpilot_fees_usd_total", fee)
                if realized != 0.0:
                    METRICS.inc("gigpilot_realized_pnl_usd_total", realized)
                local = self.positions.get(sym)
                if local and local.get("side") != side:
                    await self._refresh_portfolio()
        elif topic == "position" and isinstance(data, list):
            for p in data:
                sym = p.get("symbol", ""); size = f(p.get("size"))
                if size <= 0 and sym in self.positions:
                    local = self.positions.pop(sym)
                    if local.get("trade_id"):
                        self.store.mark_closed_pending(local["trade_id"], "position_ws_zero")
        elif topic == "wallet" and isinstance(data, list):
            for w in data:
                eq = f(w.get("totalEquity"))
                if eq > 0: self.portfolio.equity = eq

    # ---------- portfolio refresh (trade_id preserved) ----------
    async def _refresh_portfolio(self):
        try:
            w = await self.rest.wallet(); lst = w.get("list", [])
            if lst:
                eq = f(lst[0].get("totalEquity"))
                if eq > 0: self.portfolio.equity = eq
                self.portfolio.margin_ratio = f(lst[0].get("accountIMRate"), 0.0)
        except Exception as e:
            log.warning("wallet refresh: %s", e)
        try:
            positions = await self.rest.positions()
            fresh: dict[str, dict] = {}; gross = 0.0; per_sym: dict[str, float] = {}
            for p in positions:
                sz = f(p.get("size"))
                if sz <= 0: continue
                sym = p.get("symbol", "")
                notional = abs(sz * f(p.get("markPrice")))
                gross += notional; per_sym[sym] = notional
                prev = self.positions.get(sym)
                fresh[sym] = {"side": p.get("side", "Buy"), "qty": sz,
                              "entry": f(p.get("avgPrice")),
                              "trade_id": prev.get("trade_id") if prev else None}
            for sym, prev in self.positions.items():
                if sym not in fresh and prev.get("trade_id"):
                    self.store.mark_closed_pending(prev["trade_id"], "refresh_flat")
                    log.info("marked local trade pending_verify for %s (exchange flat)", sym)
            self.positions = fresh
            self.portfolio.gross_notional = gross
            self.portfolio.symbol_notional = per_sym
            self.portfolio.open_positions = len(fresh)
        except Exception as e:
            log.warning("positions refresh: %s", e)

    async def _portfolio_loop(self):
        while not self._stop.is_set():
            try:
                await self._refresh_portfolio()
                self.portfolio.daily_pnl = self.store.realized_today()
            except Exception as e:
                log.error("portfolio loop: %s", e)
            try: await asyncio.wait_for(self._stop.wait(), timeout=15)
            except asyncio.TimeoutError: pass

    async def _reconcile_loop(self):
        await asyncio.sleep(2)
        while not self._stop.is_set():
            try: await self.reconciler.run_once()
            except Exception as e: log.error("reconcile loop: %s", e)
            try: await asyncio.wait_for(self._stop.wait(), timeout=5)
            except asyncio.TimeoutError: pass

    async def _accounting_loop(self):
        await asyncio.sleep(20)
        while not self._stop.is_set():
            try: await self.accounting.run_once()
            except Exception as e: log.error("accounting loop: %s", e)
            try: await asyncio.wait_for(self._stop.wait(), timeout=60)
            except asyncio.TimeoutError: pass

    async def _daily_reset_loop(self):
        while not self._stop.is_set():
            today = self._utc_date()
            if today != self._day_anchor and self.portfolio.equity > 0:
                self.day_start_equity = self.portfolio.equity
                self._day_anchor = today
                self.store.kv_set("day_start_equity", str(self.day_start_equity))
                self.store.kv_set("day_anchor", today)
                log.info("UTC rollover: new day_start_equity=%.2f", self.day_start_equity)
            try: await asyncio.wait_for(self._stop.wait(), timeout=30)
            except asyncio.TimeoutError: pass

    # ---------- strategy ----------
    async def _strategy_loop(self):
        await asyncio.sleep(3)
        while not self._stop.is_set():
            try: await self._strategy_tick()
            except Exception as e: log.error("strategy tick: %s", e, exc_info=True)
            try: await asyncio.wait_for(self._stop.wait(), timeout=1.5)
            except asyncio.TimeoutError: pass

    async def _strategy_tick(self):
        if self.armed and self.day_start_equity > 0:
            loss_pct = -self.portfolio.daily_pnl / self.day_start_equity * 100.0
            if loss_pct >= self.cfg.max_daily_loss_pct:
                log.critical("DAILY LOSS LIMIT (%.2f%%) — auto-disarm", loss_pct)
                self.armed = False
                self.store.journal("AUTO_DISARM", None,
                                   {"reason": "daily_loss", "loss_pct": loss_pct})
                METRICS.inc("gigpilot_auto_disarm_total")

        for sym, ms in self.markets.items():
            fee_bps = self.fee_rate_bps.get(sym, self.cfg.fee_ceiling_bps)
            req = max(50.0, self.portfolio.equity * 0.03)
            for side in ("Buy", "Sell"):
                est = self.edge.evaluate(ms, side, fee_bps, 1.0, req)
                cur = self.signals.get(sym)
                if cur is None or est.net_bps > cur.net_bps:
                    self.signals[sym] = est

        if not self.armed: return

        open_by_sym = {t["symbol"]: t for t in self.store.open_trades()}
        for sym in list(self.positions.keys()):
            t = open_by_sym.get(sym)
            if t is None: continue
            age_min = (now_ms() - t["ts_ms"]) / 60000.0
            if age_min > self.cfg.time_stop_min:
                log.info("time-stop %s (%.1f min)", sym, age_min)
                await self._close_position(sym, reason="time_stop")

        for sym in self.markets:
            if sym in self.positions: continue
            est = self.signals.get(sym)
            if est is None or not est.tradable: continue
            await self._try_enter(sym, est)

    async def _try_enter(self, symbol: str, est: EdgeEstimate):
        ms = self.markets[symbol]; equity = self.portfolio.equity
        if equity <= 0 or self.executor is None: return
        atr_bps = ms.atr_bps(self.cfg.atr_period, fallback=self.cfg.min_stop_bps)
        stop_bps = max(self.cfg.min_stop_bps, self.cfg.stop_atr_mult * atr_bps)
        tp_bps = max(self.cfg.tp_atr_mult * atr_bps, stop_bps * 1.2)
        risk_usd = equity * self.cfg.risk_per_trade_pct / 100.0
        notional = min(risk_usd / (stop_bps / 1e4),
                       equity * self.cfg.max_symbol_notional_pct / 100.0)
        if notional < 10: return
        entry_px = ms.asks[0][0] if est.side == "Buy" else ms.bids[0][0]
        if entry_px <= 0: return
        step = self.step_size.get(symbol, 0.0)
        if step <= 0: return
        qty = math.floor((notional / entry_px) / step) * step
        if qty <= 0: return
        leverage = notional / equity
        ok, reason = self.risk.check(self.portfolio, symbol, notional, leverage,
                                     self.armed, self.day_start_equity or equity)
        if not ok:
            METRICS.inc("gigpilot_risk_rejects_total", reason=reason); return
        if est.side == "Buy":
            tp = entry_px * (1 + tp_bps / 1e4); sl = entry_px * (1 - stop_bps / 1e4)
        else:
            tp = entry_px * (1 - tp_bps / 1e4); sl = entry_px * (1 + stop_bps / 1e4)
        tp = self._round_tick(symbol, tp); sl = self._round_tick(symbol, sl)
        log.info("ENTER %s %s qty=%s notional=%.2f net=%.2fbps tp=%.6f sl=%.6f",
                 est.side, symbol, qty, notional, est.net_bps, tp, sl)
        try:
            res = await self.executor.open_protected(symbol, est.side, qty, tp, sl)
        except Exception as e:
            log.error("entry failed %s: %s", symbol, e)
            METRICS.inc("gigpilot_entry_errors_total", symbol=symbol); return
        tid = self.store.open_trade(symbol, est.side, qty, entry_px, tp, sl,
                                    res["orderLinkId"])
        self.positions[symbol] = {"side": est.side, "qty": qty,
                                  "entry": entry_px, "trade_id": tid}
        self.store.journal("ENTER", symbol,
                           {"side": est.side, "qty": qty, "entry": entry_px,
                            "tp": tp, "sl": sl, "net_edge_bps": est.net_bps})

    async def _close_position(self, symbol: str, reason: str):
        local = self.positions.get(symbol)
        if not local or self.executor is None: return
        qty_s = self.executor._round_qty(symbol, local["qty"])
        try:
            await self.executor.close_market(symbol, local["side"], qty_s)
            self.store.journal("CLOSE", symbol, {"reason": reason, "qty": qty_s})
        except Exception as e:
            log.error("close %s: %s", symbol, e)

    def _round_tick(self, symbol: str, px: float) -> float:
        tick = self.tick_size.get(symbol, 0.01)
        return px if tick <= 0 else round(round(px / tick) * tick, 10)

    def snapshot(self) -> dict:
        positions = []
        for sym, p in self.positions.items():
            ms = self.markets[sym]; upnl = 0.0
            if ms.mid > 0 and p["entry"] > 0:
                d = 1 if p["side"] == "Buy" else -1
                upnl = (ms.mid - p["entry"]) * d * p["qty"]
            positions.append({"symbol": sym, "side": p["side"], "qty": p["qty"],
                              "entry": p["entry"], "upnl": upnl,
                              "mark": ms.mark or ms.mid})
        return {
            "ts": now_iso(), "armed": self.armed, "host": self.cfg.host,
            "hurdle_bps": self.cfg.edge_hurdle_bps,
            "position_mode": self.position_mode,
            "equity": self.portfolio.equity,
            "margin_ratio": self.portfolio.margin_ratio,
            "gross_notional": self.portfolio.gross_notional,
            "daily_pnl": self.portfolio.daily_pnl,
            "realized_today": self.store.realized_today(),
            "positions": positions,
            "signals": [asdict(e) for e in self.signals.values()],
            "markets": [{"symbol": s, "mid": m.mid, "last": m.last, "mark": m.mark,
                         "spread_bps": m.spread_bps if math.isfinite(m.spread_bps) else None,
                         "funding_rate": m.funding_rate,
                         "tick_age_ms": now_ms() - m.ts_book_ms if m.ts_book_ms else None,
                         "imbalance": m.imbalance(self.cfg.book_levels),
                         "atr_bps": m.atr_bps(self.cfg.atr_period),
                         "fee_bps": self.fee_rate_bps.get(s)}
                        for s, m in self.markets.items()],
            "events": list(self.last_events)[-30:],
            "reconciliation": {"healthy": self.reconciler.healthy, "last_error": self.reconciler.last_error, "last_run_ms": self.reconciler.last_run_ms},
            "armable": bool(self.reconciler.healthy and self.position_mode == "one-way" and self.ws._public_ok and self.ws._private_ok),
        }


# =============================================================================
# 13. FastAPI app
# =============================================================================
_GP: Optional[GigPilot] = None


def get_gp() -> GigPilot:
    global _GP
    if _GP is None:
        _GP = GigPilot(Config.from_env())
    return _GP


@asynccontextmanager
async def lifespan(app: FastAPI):
    gp = get_gp()
    await gp.start()
    try:
        yield
    finally:
        await gp.stop()


app = FastAPI(title="GigPilot", lifespan=lifespan)


@app.get("/health")
async def health():
    gp = get_gp()
    fresh = all((now_ms() - ms.ts_book_ms) < gp.cfg.staleness_ms
                for ms in gp.markets.values() if ms.ts_book_ms > 0)
    public_ok = gp.ws._public_ok
    private_ok = gp.ws._private_ok
    healthy = public_ok and private_ok and fresh

    # ------------------------------------------------------------------ trading readiness
    # TRADING READINESS IS DELIBERATELY SEPARATE FROM `healthy`.
    #
    # `healthy` describes the PROCESS and its feeds. That is what a deployment gate should verify,
    # and it must not depend on an owner-side credential problem — otherwise a rejected key would
    # freeze every release, including the releases that fix things.
    #
    # `trading_ready` describes whether EXECUTION IS ACTUALLY POSSIBLE. It therefore also requires
    # authenticated REST validation: the reconciler performs real signed REST calls (positions,
    # open orders) and records the outcome, which is the only evidence that the credentials are
    # accepted. A connected private WebSocket is NOT sufficient evidence — WS auth and REST auth
    # can disagree, and they currently DO in production.
    #
    # Every condition defaults to NOT-ready:
    #   - reconciler.healthy starts False with last_error="not_run", so a credential state that has
    #     never been validated can never present as ready. Absence of a failure is not readiness.
    credentials_ok = bool(gp.reconciler.healthy)
    blockers = []
    if not public_ok:
        blockers.append("public market-data feed is not connected")
    if not private_ok:
        blockers.append("private (authenticated) WebSocket is not connected")
    if not fresh:
        blockers.append("market data is stale")
    if not credentials_ok:
        blockers.append(
            "credentials rejected for trading: "
            + (gp.reconciler.last_error or "never validated")
        )
    if gp.position_mode != "one-way":
        blockers.append(f"position mode is '{gp.position_mode}', expected 'one-way'")

    return JSONResponse(status_code=200 if healthy else 503, content={
        "healthy": healthy, "public_ws": public_ok,
        "private_ws": private_ok, "feed_fresh": fresh,
        "armed": gp.armed, "host": gp.cfg.host,
        "position_mode": gp.position_mode,
        # ---- authoritative trading-readiness signal ----
        "trading_ready": len(blockers) == 0,
        "credentials_ok": credentials_ok,
        "credentials_error": gp.reconciler.last_error,
        "credentials_checked_ms_ago": (now_ms() - gp.reconciler.last_run_ms)
                                      if gp.reconciler.last_run_ms else None,
        "trading_blockers": blockers,
    })


@app.get("/metrics")
async def metrics():
    gp = get_gp()
    METRICS.set("gigpilot_equity", gp.portfolio.equity)
    METRICS.set("gigpilot_gross_notional", gp.portfolio.gross_notional)
    METRICS.set("gigpilot_armed", 1 if gp.armed else 0)
    METRICS.set("gigpilot_daily_pnl", gp.portfolio.daily_pnl)
    for sym, e in gp.signals.items():
        METRICS.set("gigpilot_edge_net_bps", e.net_bps, symbol=sym)
    return Response(content=METRICS.render(), media_type="text/plain")


@app.get("/api/state")
async def api_state():
    return JSONResponse(get_gp().snapshot())


@app.post("/api/arm")
async def api_arm():
    gp = get_gp()
    ok, reasons = await gp.arm()
    if not ok:
        return JSONResponse(status_code=422, content={
            "success": False,
            "armed": False,
            "error": "ARM_BLOCKED",
            "reasons": reasons,
            "state": gp.snapshot(),
        })
    return {"success": True, "armed": True, "idempotent": any(r.get("code") == "ALREADY_ARMED" for r in reasons), "reasons": reasons, "state": gp.snapshot()}


@app.post("/api/disarm")
async def api_disarm():
    gp = get_gp()
    was_armed = gp.armed
    gp.armed = False
    gp.store.journal("DISARM", None, {"was_armed": was_armed})
    log.warning("MANUAL DISARM")
    return {"success": True, "armed": False, "idempotent": not was_armed}


@app.post("/api/kill")
async def api_kill():
    gp = get_gp(); gp.armed = False; gp.store.journal("KILL", None, {})
    log.critical("KILL SWITCH")
    for sym in list(gp.positions.keys()):
        try: await gp._close_position(sym, reason="kill_switch")
        except Exception as e: log.error("kill close %s: %s", sym, e)
    for sym in gp.cfg.symbols:
        try: await gp.rest.cancel_all(sym)
        except Exception as e: log.warning("cancel_all %s: %s", sym, e)
    return {"killed": True}


@app.get("/events")
async def events():
    async def stream() -> AsyncIterator[bytes]:
        while True:
            try:
                yield f"data: {json.dumps(get_gp().snapshot())}\n\n".encode()
            except Exception:
                yield b"data: {}\n\n"
            await asyncio.sleep(1.0)
    return StreamingResponse(stream(), media_type="text/event-stream")


DASHBOARD_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>GigPilot</title>
<style>
 body{background:#0b0d10;color:#e6edf3;font:13px/1.5 ui-monospace,Menlo,monospace;margin:0;padding:16px}
 h1{margin:0 0 8px;font-size:16px;color:#7ee787}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
 .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px}
 .k{color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
 .v{font-size:18px;color:#e6edf3}
 .pos{color:#7ee787}.neg{color:#ff7b72}.warn{color:#e3b341}
 table{width:100%;border-collapse:collapse;margin-top:6px}
 th,td{padding:3px 6px;text-align:left;border-bottom:1px solid #21262d;font-size:12px}
 th{color:#8b949e;font-weight:500}
 button{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:6px 12px;cursor:pointer;margin-right:6px}
 button:hover{background:#30363d}
 .kill{background:#3d1216;border-color:#ff7b72;color:#ff7b72}
 .badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px}
 .armed{background:#0d3a1e;color:#7ee787}
 .disarmed{background:#3a0d0d;color:#ff7b72}
 .muted{color:#8b949e}
</style></head><body>
<h1>GigPilot · <span id="host" class="muted"></span> · <span id="mode" class="muted"></span> · <span id="arm" class="badge disarmed">DISARMED</span></h1>
<div style="margin-bottom:12px">
 <button onclick="fetch('/api/arm',{method:'POST'})">Arm</button>
 <button onclick="fetch('/api/disarm',{method:'POST'})">Disarm</button>
 <button class="kill" onclick="if(confirm('KILL: cancel all, flatten all?'))fetch('/api/kill',{method:'POST'})">KILL</button>
</div>
<div class="grid">
 <div class="card"><div class="k">Equity</div><div class="v" id="eq">–</div></div>
 <div class="card"><div class="k">Gross Notional</div><div class="v" id="gn">–</div></div>
 <div class="card"><div class="k">Realized Today (verified)</div><div class="v" id="rt">–</div></div>
 <div class="card"><div class="k">Daily PnL</div><div class="v" id="dp">–</div></div>
 <div class="card"><div class="k">Margin Ratio</div><div class="v" id="mr">–</div></div>
</div>
<div class="card" style="margin-top:12px"><div class="k">Positions</div>
 <table id="pos"><thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Mark</th><th>uPnL</th></tr></thead><tbody></tbody></table>
</div>
<div class="card" style="margin-top:12px"><div class="k">Markets &amp; Edge</div>
 <table id="mk"><thead><tr><th>Sym</th><th>Mid</th><th>Spread bps</th><th>ATR bps</th><th>Fee bps</th><th>Imb</th><th>Net edge bps</th><th>Hurdle</th><th>Tradable</th></tr></thead><tbody></tbody></table>
</div>
<div class="card" style="margin-top:12px"><div class="k">Recent Events</div>
 <table id="ev"><thead><tr><th>Time</th><th>Kind</th><th>Symbol</th><th>Detail</th></tr></thead><tbody></tbody></table>
</div>
<script>
const fmt=n=>n==null?'–':Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const pnl=n=>n>=0?'<span class="pos">+'+fmt(n)+'</span>':'<span class="neg">'+fmt(n)+'</span>';
function upd(s){
 document.getElementById('host').textContent=s.host;
 document.getElementById('mode').textContent=s.position_mode||'';
 const a=document.getElementById('arm');a.textContent=s.armed?'ARMED':'DISARMED';a.className='badge '+(s.armed?'armed':'disarmed');
 document.getElementById('eq').textContent=fmt(s.equity);
 document.getElementById('gn').textContent=fmt(s.gross_notional);
 document.getElementById('rt').innerHTML=pnl(s.realized_today);
 document.getElementById('dp').innerHTML=pnl(s.daily_pnl);
 document.getElementById('mr').textContent=(s.margin_ratio*100).toFixed(2)+'%';
 document.querySelector('#pos tbody').innerHTML=s.positions.map(p=>`<tr><td>${p.symbol}</td><td>${p.side}</td><td>${p.qty}</td><td>${fmt(p.entry)}</td><td>${fmt(p.mark)}</td><td>${pnl(p.upnl)}</td></tr>`).join('')||'<tr><td colspan=6 class=muted>none</td></tr>';
 const sig=Object.fromEntries(s.signals.map(x=>[x.symbol,x]));
 document.querySelector('#mk tbody').innerHTML=s.markets.map(m=>{const e=sig[m.symbol]||{};return `<tr><td>${m.symbol}</td><td>${fmt(m.mid)}</td><td>${m.spread_bps==null?'–':m.spread_bps.toFixed(2)}</td><td>${fmt(m.atr_bps)}</td><td>${fmt(m.fee_bps)}</td><td>${m.imbalance.toFixed(3)}</td><td>${e.net_bps==null?'–':e.net_bps.toFixed(2)}</td><td>${s.hurdle_bps}</td><td>${e.tradable?'<span class=pos>YES</span>':'<span class=muted>no</span>'}</td></tr>`}).join('');
 document.querySelector('#ev tbody').innerHTML=s.events.slice().reverse().map(x=>`<tr><td class=muted>${x.ts}</td><td>${x.kind}</td><td>${x.symbol||''}</td><td>${x.side||''} ${fmt(x.px)}×${fmt(x.qty)} fee=${fmt(x.fee)} pnl=${fmt(x.closed_pnl)}</td></tr>`).join('')||'<tr><td colspan=4 class=muted>none</td></tr>';
}
new EventSource('/events').onmessage=e=>{try{upd(JSON.parse(e.data))}catch(_){}};
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
async def dashboard(): return DASHBOARD_HTML


# =============================================================================
# 14. Entrypoint
# =============================================================================
def main():
    cfg = Config.from_env()
    setup_logging(cfg.log_level)
    log.info("boot: arm=%s hurdle=%.2fbps symbols=%s",
             cfg.arm, cfg.edge_hurdle_bps, cfg.symbols)
    bind = os.getenv("GIGPILOT_BIND", "127.0.0.1")
    port = int(os.getenv("GIGPILOT_PORT", "8001"))
    uvicorn.run(app, host=bind, port=port,
                log_level=cfg.log_level.lower(), access_log=False)


if __name__ == "__main__":
    main()
