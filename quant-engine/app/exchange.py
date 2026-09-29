"""Binance USDⓈ-M futures adapter.

Two clearly separated capability surfaces:

  PUBLIC  — market data. No credentials. Used by both paper and live modes.
  PRIVATE — account + order routing. Signed, credentials required, and only ever
            reachable from LiveBroker after the config interlock passes.

Everything returned to the rest of the system is a normalised dataclass so the
strategy/risk layers never depend on raw exchange payloads.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from .logging_setup import get_logger, scrub

log = get_logger("exchange")


# ---------------------------------------------------------------------------
# Normalised models
# ---------------------------------------------------------------------------
@dataclass
class Ticker:
    symbol: str
    last: float
    bid: float
    ask: float
    quote_volume_24h: float
    price_change_pct_24h: float
    mark_price: float = 0.0
    index_price: float = 0.0
    funding_rate: float = 0.0
    next_funding_ts: int = 0
    # Hours between funding settlements. Binance USDT-perps are 8h; Bybit varies
    # per symbol, and this drives the funding cost estimate.
    funding_interval_hours: float = 8.0
    ts: int = 0

    @property
    def mid(self) -> float:
        if self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2.0
        return self.last

    @property
    def spread_bps(self) -> float:
        if self.bid <= 0 or self.ask <= 0 or self.mid <= 0:
            return 0.0
        return (self.ask - self.bid) / self.mid * 10_000.0


@dataclass
class SymbolSpec:
    symbol: str
    tick_size: float
    step_size: float
    min_qty: float
    min_notional: float
    max_leverage: int
    price_precision: int
    qty_precision: int


@dataclass
class Balance:
    asset: str
    wallet_balance: float
    available_balance: float
    unrealized_pnl: float
    margin_balance: float


@dataclass
class OrderRequest:
    symbol: str
    side: str                 # BUY | SELL
    qty: float
    order_type: str = "MARKET"
    price: Optional[float] = None
    reduce_only: bool = False
    client_id: str = ""
    stop_price: Optional[float] = None
    close_position: bool = False


@dataclass
class OrderResult:
    ok: bool
    order_id: str = ""
    client_id: str = ""
    status: str = ""
    filled_qty: float = 0.0
    avg_price: float = 0.0
    fee: float = 0.0
    error: str = ""
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PositionRisk:
    symbol: str
    position_amt: float
    entry_price: float
    mark_price: float
    unrealized_pnl: float
    liquidation_price: float
    leverage: float
    margin_type: str
    isolated_wallet: float


@dataclass
class DepthSnapshot:
    symbol: str
    bids: List[List[float]]
    asks: List[List[float]]
    ts: int = 0

    def spread_bps(self) -> float:
        if not self.bids or not self.asks:
            return 0.0
        best_bid, best_ask = self.bids[0][0], self.asks[0][0]
        mid = (best_bid + best_ask) / 2.0
        return (best_ask - best_bid) / mid * 10_000.0 if mid else 0.0


# Per-venue defaults. Fees matter: Bybit's standard taker rate is 5.5bps vs
# Binance's 5.0bps, which is enough to turn a marginal edge into a loser.
EXCHANGE_PRESETS: Dict[str, Dict[str, Any]] = {
    "binance": {
        "market_type": "usdm",
        "rest_url": "https://fapi.binance.com",
        "ws_url": "wss://fstream.binance.com",
        "maker_fee_bps": 2.0,
        "taker_fee_bps": 5.0,
        "funding_interval_hours": 8.0,
    },
    "bybit": {
        "market_type": "linear",
        "rest_url": "https://api.bybit.com",
        "ws_url": "wss://stream.bybit.com/v5/public/linear",
        "maker_fee_bps": 2.0,
        "taker_fee_bps": 5.5,
        "funding_interval_hours": 8.0,
    },
}


class ExchangeError(RuntimeError):
    def __init__(self, message: str, code: int = 0, status: int = 0):
        super().__init__(message)
        self.code = code
        self.status = status


# ---------------------------------------------------------------------------
# Public market data
# ---------------------------------------------------------------------------
class BinanceFutures:
    """Read-only market data. Safe to instantiate without credentials."""

    def __init__(self, cfg, client: Optional[httpx.AsyncClient] = None):
        self.cfg = cfg
        self._client = client
        self._own_client = client is None
        self._specs: Dict[str, SymbolSpec] = {}
        self._specs_loaded_at = 0.0

    async def __aenter__(self) -> "BinanceFutures":
        await self._ensure_client()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.cfg.exchange.rest_url,
                timeout=httpx.Timeout(self.cfg.exchange.request_timeout_s, connect=5.0),
                headers={"User-Agent": "quant-platform/1.0"},
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
        return self._client

    async def close(self) -> None:
        if self._own_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        client = await self._ensure_client()
        last_err: Optional[Exception] = None
        for attempt in range(self.cfg.exchange.max_retries):
            try:
                resp = await client.get(path, params=params)
                if resp.status_code == 429 or resp.status_code == 418:
                    wait = float(resp.headers.get("Retry-After", 2 ** attempt))
                    log.warning("rate limited", extra={"path": path, "wait_s": wait})
                    await asyncio.sleep(min(wait, 30.0))
                    continue
                if resp.status_code >= 500:
                    raise ExchangeError(f"upstream {resp.status_code}", status=resp.status_code)
                data = resp.json()
                if isinstance(data, dict) and "code" in data and int(data.get("code", 0)) < 0:
                    raise ExchangeError(str(data.get("msg")), code=int(data["code"]), status=resp.status_code)
                return data
            except (httpx.HTTPError, ExchangeError, ValueError) as exc:
                last_err = exc
                if attempt < self.cfg.exchange.max_retries - 1:
                    await asyncio.sleep(min(0.5 * (2 ** attempt), 8.0))
        raise ExchangeError(f"GET {path} failed: {scrub(str(last_err))}")

    # -- endpoints ---------------------------------------------------------
    async def ping(self) -> float:
        t0 = time.time()
        await self._get("/fapi/v1/ping")
        return (time.time() - t0) * 1000.0

    async def server_time(self) -> int:
        data = await self._get("/fapi/v1/time")
        return int(data["time"])

    async def exchange_info(self, force: bool = False) -> Dict[str, SymbolSpec]:
        if self._specs and not force and (time.time() - self._specs_loaded_at) < 3600:
            return self._specs
        data = await self._get("/fapi/v1/exchangeInfo")
        specs: Dict[str, SymbolSpec] = {}
        for s in data.get("symbols", []):
            if s.get("contractType") != "PERPETUAL" or s.get("status") != "TRADING":
                continue
            if s.get("quoteAsset") != self.cfg.universe.quote:
                continue
            filters = {f["filterType"]: f for f in s.get("filters", [])}
            tick = float(filters.get("PRICE_FILTER", {}).get("tickSize", 0.01))
            step = float(filters.get("LOT_SIZE", {}).get("stepSize", 0.001))
            specs[s["symbol"]] = SymbolSpec(
                symbol=s["symbol"],
                tick_size=tick,
                step_size=step,
                min_qty=float(filters.get("LOT_SIZE", {}).get("minQty", 0.0)),
                min_notional=float(filters.get("MIN_NOTIONAL", {}).get("notional", 5.0)),
                max_leverage=int(s.get("maxLeverage", 20) or 20),
                price_precision=int(s.get("pricePrecision", 2)),
                qty_precision=int(s.get("quantityPrecision", 3)),
            )
        self._specs = specs
        self._specs_loaded_at = time.time()
        return specs

    async def tickers_24h(self) -> Dict[str, Ticker]:
        data = await self._get("/fapi/v1/ticker/24hr")
        out: Dict[str, Ticker] = {}
        if isinstance(data, dict):
            data = [data]
        for t in data:
            try:
                out[t["symbol"]] = Ticker(
                    symbol=t["symbol"],
                    last=float(t["lastPrice"]),
                    bid=float(t.get("bidPrice", 0) or 0),
                    ask=float(t.get("askPrice", 0) or 0),
                    quote_volume_24h=float(t["quoteVolume"]),
                    price_change_pct_24h=float(t["priceChangePercent"]),
                    ts=int(t.get("closeTime", 0)),
                )
            except (KeyError, ValueError, TypeError):
                continue
        return out

    async def book_ticker(self, symbol: str) -> Ticker:
        data = await self._get("/fapi/v1/ticker/bookTicker", {"symbol": symbol})
        prem = await self._get("/fapi/v1/premiumIndex", {"symbol": symbol})
        return Ticker(
            symbol=symbol,
            last=float(prem.get("markPrice", 0) or 0),
            bid=float(data.get("bidPrice", 0) or 0),
            ask=float(data.get("askPrice", 0) or 0),
            quote_volume_24h=0.0,
            price_change_pct_24h=0.0,
            mark_price=float(prem.get("markPrice", 0) or 0),
            index_price=float(prem.get("indexPrice", 0) or 0),
            funding_rate=float(prem.get("lastFundingRate", 0) or 0),
            next_funding_ts=int(prem.get("nextFundingTime", 0) or 0),
            ts=int(prem.get("time", 0) or 0),
        )

    async def premium_index(self) -> Dict[str, Dict[str, float]]:
        data = await self._get("/fapi/v1/premiumIndex")
        out: Dict[str, Dict[str, float]] = {}
        if isinstance(data, dict):
            data = [data]
        for p in data:
            out[p["symbol"]] = {
                "mark_price": float(p.get("markPrice", 0) or 0),
                "index_price": float(p.get("indexPrice", 0) or 0),
                "funding_rate": float(p.get("lastFundingRate", 0) or 0),
                "next_funding_ts": int(p.get("nextFundingTime", 0) or 0),
            }
        return out

    async def klines(
        self, symbol: str, interval: str, limit: int = 500,
        start_ms: Optional[int] = None, end_ms: Optional[int] = None,
    ) -> List[List[Any]]:
        params: Dict[str, Any] = {"symbol": symbol, "interval": interval, "limit": min(limit, 1500)}
        if start_ms is not None:
            params["startTime"] = int(start_ms)
        if end_ms is not None:
            params["endTime"] = int(end_ms)
        return await self._get("/fapi/v1/klines", params)

    async def klines_full(
        self, symbol: str, interval: str, total_bars: int
    ) -> List[List[Any]]:
        """Page backwards when more history is requested than one call allows."""
        out: List[List[Any]] = []
        end_ms: Optional[int] = None
        remaining = total_bars
        interval_ms = _interval_ms(interval)
        while remaining > 0:
            batch = min(remaining, 1500)
            rows = await self.klines(symbol, interval, limit=batch, end_ms=end_ms)
            if not rows:
                break
            rows.sort(key=lambda r: r[0])
            out = rows + out
            end_ms = int(rows[0][0]) - 1
            remaining -= len(rows)
            if len(rows) < batch:
                break
            await asyncio.sleep(0.12)
        # de-duplicate
        seen = set()
        dedup: List[List[Any]] = []
        for r in sorted(out, key=lambda r: r[0]):
            if r[0] in seen:
                continue
            seen.add(r[0])
            dedup.append(r)
        return dedup

    async def depth(self, symbol: str, limit: int = 50) -> DepthSnapshot:
        data = await self._get("/fapi/v1/depth", {"symbol": symbol, "limit": limit})
        return DepthSnapshot(
            symbol=symbol,
            bids=[[float(p), float(q)] for p, q in data.get("bids", [])],
            asks=[[float(p), float(q)] for p, q in data.get("asks", [])],
            ts=int(data.get("E", 0) or 0),
        )

    async def order_fee(self, symbol: str, order_id: str = "",
                        client_id: Optional[str] = None) -> float:
        """Execution fee for one order. Uniform across venues; Binance order ids are
        integers while Bybit's are UUIDs, so callers must never coerce these."""
        try:
            trades = await BinancePrivate.user_trades(self, symbol, limit=100)  # type: ignore[arg-type]
        except (ExchangeError, AttributeError):
            return 0.0
        want = str(order_id or "")
        total = 0.0
        for t in trades:
            if want and str(t.get("orderId", "")) == want:
                total += abs(float(t.get("commission", 0) or 0))
        return total

    # -- websocket contract (implemented per venue) ------------------------
    def to_native_interval(self, interval: str) -> str:
        return interval

    def ws_connect_url(self, interval: str, symbols: List[str]) -> str:
        streams = "/".join(f"{s.lower()}@kline_{interval}" for s in symbols)
        return f"{self.cfg.exchange.ws_url}/stream?streams={streams}"

    def ws_subscribe_messages(self, interval: str, symbols: List[str]) -> List[str]:
        return []

    def ws_heartbeat_message(self) -> Optional[str]:
        return None

    def ws_heartbeat_interval(self) -> float:
        return 20.0

    def parse_kline_message(self, raw: str) -> Optional[Dict[str, Any]]:
        """Normalise a venue kline frame to
        {symbol, ts, open, high, low, close, volume, closed} or None."""
        import json as _json

        try:
            msg = _json.loads(raw)
        except _json.JSONDecodeError:
            return None
        data = msg.get("data") or msg
        k = data.get("k")
        if not k:
            return None
        symbol = data.get("s") or k.get("s")
        if not symbol:
            return None
        return {
            "symbol": symbol,
            "ts": int(k["t"]),
            "open": float(k["o"]),
            "high": float(k["h"]),
            "low": float(k["l"]),
            "close": float(k["c"]),
            "volume": float(k["v"]),
            "closed": bool(k.get("x")),
        }

    async def funding_history(self, symbol: str, limit: int = 30) -> List[Dict[str, float]]:
        data = await self._get("/fapi/v1/fundingRate", {"symbol": symbol, "limit": limit})
        return [
            {"ts": int(d["fundingTime"]), "rate": float(d["fundingRate"])}
            for d in data
        ]


# ---------------------------------------------------------------------------
# Private (signed) surface
# ---------------------------------------------------------------------------
class BinancePrivate(BinanceFutures):
    """Adds authenticated endpoints. Only instantiated in live mode."""

    def __init__(self, cfg, client: Optional[httpx.AsyncClient] = None):
        super().__init__(cfg, client)
        if not cfg.exchange.api_key or not cfg.exchange.api_secret:
            raise ExchangeError("private client requires api_key and api_secret")

    def _sign(self, params: Dict[str, Any]) -> str:
        query = urllib.parse.urlencode(params, doseq=True)
        sig = hmac.new(
            self.cfg.exchange.api_secret.encode(), query.encode(), hashlib.sha256
        ).hexdigest()
        return f"{query}&signature={sig}"

    async def _request(
        self, method: str, path: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        client = await self._ensure_client()
        p = dict(params or {})
        p["timestamp"] = int(time.time() * 1000)
        p["recvWindow"] = self.cfg.exchange.recv_window_ms
        signed = self._sign(p)
        headers = {"X-MBX-APIKEY": self.cfg.exchange.api_key}
        last_err: Optional[Exception] = None
        for attempt in range(self.cfg.exchange.max_retries):
            try:
                resp = await client.request(
                    method, f"{path}?{signed}", headers=headers
                )
                if resp.status_code in (429, 418):
                    await asyncio.sleep(min(float(resp.headers.get("Retry-After", 2 ** attempt)), 30.0))
                    continue
                data = resp.json()
                if isinstance(data, dict) and int(data.get("code", 0) or 0) < 0:
                    # -2015 etc. are auth/permission problems: never retry blindly.
                    raise ExchangeError(
                        scrub(str(data.get("msg"))),
                        code=int(data["code"]),
                        status=resp.status_code,
                    )
                if resp.status_code >= 400:
                    raise ExchangeError(scrub(resp.text[:300]), status=resp.status_code)
                return data
            except (httpx.HTTPError, ExchangeError, ValueError) as exc:
                last_err = exc
                if isinstance(exc, ExchangeError) and exc.code in (-2015, -2014, -1022, -1099):
                    raise
                if attempt < self.cfg.exchange.max_retries - 1:
                    await asyncio.sleep(min(0.5 * (2 ** attempt), 8.0))
        raise ExchangeError(f"{method} {path} failed: {scrub(str(last_err))}")

    async def account_balance(self) -> List[Balance]:
        data = await self._request("GET", "/fapi/v2/balance")
        out = []
        for b in data:
            try:
                out.append(
                    Balance(
                        asset=b["asset"],
                        wallet_balance=float(b["balance"]),
                        available_balance=float(b["availableBalance"]),
                        unrealized_pnl=float(b.get("crossUnPnl", 0) or 0),
                        margin_balance=float(b.get("crossWalletBalance", b["balance"]) or 0),
                    )
                )
            except (KeyError, ValueError):
                continue
        return out

    async def position_risk(self, symbol: Optional[str] = None) -> List[PositionRisk]:
        params = {"symbol": symbol} if symbol else None
        data = await self._request("GET", "/fapi/v2/positionRisk", params)
        out = []
        for p in data:
            amt = float(p.get("positionAmt", 0) or 0)
            if abs(amt) < 1e-12:
                continue
            out.append(
                PositionRisk(
                    symbol=p["symbol"],
                    position_amt=amt,
                    entry_price=float(p.get("entryPrice", 0) or 0),
                    mark_price=float(p.get("markPrice", 0) or 0),
                    unrealized_pnl=float(p.get("unRealizedProfit", 0) or 0),
                    liquidation_price=float(p.get("liquidationPrice", 0) or 0),
                    leverage=float(p.get("leverage", 0) or 0),
                    margin_type=p.get("marginType", ""),
                    isolated_wallet=float(p.get("isolatedWallet", 0) or 0),
                )
            )
        return out

    async def set_leverage(self, symbol: str, leverage: int) -> Dict[str, Any]:
        return await self._request(
            "POST", "/fapi/v1/leverage", {"symbol": symbol, "leverage": int(leverage)}
        )

    async def set_margin_type(self, symbol: str, isolated: bool = False) -> Dict[str, Any]:
        """Idempotent: -4046 means 'no need to change'."""
        try:
            return await self._request(
                "POST",
                "/fapi/v1/marginType",
                {"symbol": symbol, "marginType": "ISOLATED" if isolated else "CROSSED"},
            )
        except ExchangeError as exc:
            if exc.code == -4046:
                return {"msg": "no change"}
            raise

    async def place_order(self, req: OrderRequest) -> OrderResult:
        params: Dict[str, Any] = {
            "symbol": req.symbol,
            "side": req.side,
            "type": req.order_type,
            "quantity": req.qty,
        }
        if req.client_id:
            params["newClientOrderId"] = req.client_id
        if req.reduce_only:
            params["reduceOnly"] = "true"
        if req.close_position:
            params["closePosition"] = "true"
        if req.order_type == "LIMIT":
            params["price"] = req.price
            params["timeInForce"] = "GTC"
        if req.stop_price is not None:
            params["stopPrice"] = req.stop_price
        try:
            raw = await self._request("POST", "/fapi/v1/order", params)
        except ExchangeError as exc:
            return OrderResult(ok=False, error=f"[{exc.code}] {exc}", client_id=req.client_id)
        return _parse_order(raw, req.client_id)

    async def cancel_order(self, symbol: str, order_id: Optional[str] = None,
                           client_id: Optional[str] = None) -> Dict[str, Any]:
        params: Dict[str, Any] = {"symbol": symbol}
        if order_id:
            params["orderId"] = order_id
        if client_id:
            params["origClientOrderId"] = client_id
        return await self._request("DELETE", "/fapi/v1/order", params)

    async def open_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        params = {"symbol": symbol} if symbol else None
        return await self._request("GET", "/fapi/v1/openOrders", params)

    async def all_orders(self, symbol: str, limit: int = 50) -> List[Dict[str, Any]]:
        return await self._request("GET", "/fapi/v1/allOrders", {"symbol": symbol, "limit": limit})

    async def user_trades(self, symbol: str, limit: int = 100) -> List[Dict[str, Any]]:
        return await self._request("GET", "/fapi/v1/userTrades", {"symbol": symbol, "limit": limit})

    async def income(self, income_type: str = "FUNDING_FEE", limit: int = 200) -> List[Dict[str, Any]]:
        return await self._request("GET", "/fapi/v1/income", {"incomeType": income_type, "limit": limit})

    async def change_position_mode(self, dual: bool = False) -> Dict[str, Any]:
        try:
            return await self._request(
                "POST", "/fapi/v1/positionSide/dual", {"dualSidePosition": "true" if dual else "false"}
            )
        except ExchangeError as exc:
            if exc.code == -4059:
                return {"msg": "no change"}
            raise

    async def permissions_probe(self) -> Dict[str, Any]:
        """Cheap authenticated call used to validate the key at startup."""
        bal = await self.account_balance()
        return {"ok": True, "assets": [b.asset for b in bal if b.wallet_balance > 0]}


def _parse_order(raw: Dict[str, Any], client_id: str = "") -> OrderResult:
    if not isinstance(raw, dict):
        return OrderResult(ok=False, error="unexpected order payload")
    avg = float(raw.get("avgPrice", 0) or 0)
    filled = float(raw.get("executedQty", 0) or 0)
    if avg <= 0 and filled > 0:
        avg = float(raw.get("price", 0) or 0)
    return OrderResult(
        ok=True,
        order_id=str(raw.get("orderId", "")),
        client_id=str(raw.get("clientOrderId", client_id)),
        status=str(raw.get("status", "")),
        filled_qty=filled,
        avg_price=avg,
        raw=raw,
    )


_INTERVAL_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
    "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000,
}


def _interval_ms(interval: str) -> int:
    return _INTERVAL_MS.get(interval, 3_600_000)


# ---------------------------------------------------------------------------
# Venue factories. The rest of the platform depends only on the method surface
# shared by BinanceFutures/BinancePrivate and BybitClient/BybitPrivate.
# ---------------------------------------------------------------------------
def create_market_client(cfg, client: Optional[httpx.AsyncClient] = None):
    """Public market-data client for the configured venue (no credentials)."""
    name = (cfg.exchange.name or "binance").lower()
    if name == "bybit":
        from .bybit import BybitClient

        return BybitClient(cfg, require_creds=False, client=client)
    return BinanceFutures(cfg, client=client)


def create_private_client(cfg, client: Optional[httpx.AsyncClient] = None):
    """Signed account/order client. Raises if credentials are absent."""
    name = (cfg.exchange.name or "binance").lower()
    if name == "bybit":
        from .bybit import BybitPrivate

        return BybitPrivate(cfg, client=client)
    return BinancePrivate(cfg, client=client)
