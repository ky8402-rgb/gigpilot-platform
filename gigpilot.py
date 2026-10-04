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
from pathlib import Path
import sqlite3
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlencode

import aiohttp
import uvicorn
from fastapi import Depends, FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel as _BaseModel


# =============================================================================
# 0. Utilities (MIGRATED -> gpkg/core/clock.py)
# =============================================================================
from gpkg.core.clock import now_ms, now_iso, f  # noqa: E402


# =============================================================================
# 1. Config (MIGRATED -> gpkg/core/config.py)
# =============================================================================
from gpkg.core.config import (  # noqa: E402
    Config,
    LIVE_HOST,
    WS_PUBLIC,
    WS_PRIVATE,
    FORBIDDEN,
    _maybe_load_local_keys,
    _maybe_load_aws_secret,
)


# =============================================================================
# 2. Logging + Metrics (MIGRATED -> gpkg/core/logging.py, gpkg/core/metrics.py)
# =============================================================================
from gpkg.core.logging import JsonFormatter, setup_logging  # noqa: E402

log = setup_logging("INFO")


# MIGRATED -> gpkg/core/metrics.py. Re-exported so existing references keep resolving.
from gpkg.core.metrics import Metrics  # noqa: E402


METRICS = Metrics()
from gpkg.core.watchdog import TaskWatchdog  # noqa: E402


# =============================================================================
# 3. Bybit REST v5 (MIGRATED -> gpkg/exchange/bybit_rest.py)
# =============================================================================
# MIGRATED -> gpkg/core/errors.py. Re-exported so every existing reference (and the deployed engine,
# which imports this module) keeps resolving unchanged.
from gpkg.core.errors import BybitError, DUPLICATE_ORDER_LINK_CODE  # noqa: E402
from gpkg.exchange.bybit_rest import BybitREST  # noqa: E402
from gpkg.exchange.adapters.bybit import BybitAdapter  # noqa: E402


# =============================================================================
# 4. Market state (MIGRATED -> gpkg/market/state.py)
# =============================================================================
from gpkg.market.state import MarketState  # noqa: E402


# =============================================================================
# 5. Edge engine (MIGRATED -> gpkg/strategy/edge.py)
# =============================================================================
from gpkg.strategy.edge import EdgeEstimate, EdgeEngine  # noqa: E402


# =============================================================================
# 6. Risk gate (MIGRATED -> gpkg/risk/gate.py)
# =============================================================================
from gpkg.risk.gate import Portfolio, RiskGate  # noqa: E402


# =============================================================================
# 7. Executor (MIGRATED -> gpkg/execution/executor.py)
# =============================================================================
from gpkg.execution.executor import Executor  # noqa: E402


# =============================================================================
# 8. Store (MIGRATED -> gpkg/persistence/store.py)
# =============================================================================
from gpkg.persistence.store import Store  # noqa: E402
from gpkg.ml.registry import ModelRegistry  # noqa: E402


# =============================================================================
# 8b. Control-plane owner authentication (MIGRATED -> gpkg/api/auth.py)
# =============================================================================
# Every operational endpoint below is gated on this. The Node stack already enforced the same
# boundary (server/trading/ownerAuth.ts); the Python control plane previously enforced NOTHING, so
# an unauthenticated caller could arm live trading or trip the kill switch. Absence of a check is
# not a neutral default on a control plane that can move money.
from gpkg.api.auth import OwnerAuth, get_owner_auth, owner_authenticated, require_owner  # noqa: E402


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
    def __init__(self, cfg: Config, rest, store: Store, positions: dict):
        self.cfg = cfg
        self.adapter = rest if hasattr(rest, "positions") and hasattr(rest, "trade_permission") else None
        self.rest = rest.rest if self.adapter is not None and hasattr(rest, "rest") else rest
        self.store = store; self.positions = positions
        self.healthy = False
        self.last_error: Optional[str] = "not_run"
        self.last_run_ms = 0
        # Trade AUTHORIZATION, tracked separately from authentication.
        # `healthy`/`last_error` describe whether signed REST calls succeed at all (reads). A key can
        # pass that while being refused on every order-mutating endpoint — which is exactly the
        # production state — so readiness must be gated on the permission probe below, not on reads.
        self.trade_permissions_ok = False
        self.trade_permissions_error: Optional[str] = "not_run"
        self.trade_permissions_ms = 0

    async def run_once(self):
        try:
            if self.adapter is not None:
                exch = {p.symbol: p for p in await self.adapter.positions() if p.qty > 0}
            else:
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
            ep = exch[sym]
            e_qty = ep.qty if self.adapter is not None else f(ep.get("size"))
            if abs(e_qty - self.positions[sym].get("qty", 0.0)) > 1e-9:
                self.positions[sym]["qty"] = e_qty
                METRICS.inc("gigpilot_reconcile_divergences_total", kind="size")
        for sym, ep in exch.items():
            if sym not in self.positions:
                log.warning("RECONCILE: adopting untracked %s", sym)
                if self.adapter is not None:
                    side = ep.side.value
                    qty = ep.qty
                    entry = ep.entry_price
                else:
                    side = ep.get("side", "Buy")
                    qty = f(ep.get("size"))
                    entry = f(ep.get("avgPrice"))
                self.positions[sym] = {"side": side, "qty": qty, "entry": entry, "trade_id": None}
                METRICS.inc("gigpilot_reconcile_divergences_total", kind="adopt")
        try:
            orders = await (self.adapter.open_orders() if self.adapter is not None else self.rest.open_orders())
            for o in orders:
                if self.adapter is not None:
                    link = o.client_order_id or ""
                    symbol = o.symbol
                    order_id = o.order_id
                else:
                    link = o.get("orderLinkId", "")
                    symbol = o["symbol"]
                    order_id = ""
                if not link.startswith("gp-"): continue
                try:
                    if self.adapter is not None:
                        await self.adapter.cancel_order(symbol, order_id)
                    else:
                        await self.rest.cancel_order(category="linear", symbol=symbol, orderLinkId=link)
                    METRICS.inc("gigpilot_reconcile_divergences_total", kind="orphan_cancelled")
                except Exception:
                    pass
        except Exception as e:
            self.healthy = False; self.last_error = str(e); self.last_run_ms = now_ms()
            log.warning("reconcile orders: %s", e)
            return
        # --- trade-authorization probe (non-mutating) -------------------------------------------
        # Read access succeeding does NOT mean the key may trade. In production this key reads
        # positions and open orders perfectly well while every order-mutating endpoint answers
        # "API key is invalid", so `healthy` alone would report a fully working credential.
        try:
            if self.adapter is not None:
                self.trade_permissions_ok, reason = await self.adapter.trade_permission()
                self.trade_permissions_error = None if self.trade_permissions_ok else reason
            else:
                # BybitREST._req() already unwraps the venue envelope and returns result directly.
                info = (await self.rest.api_info()) or {}
                perms = info.get("permissions", {}) or {}
                contract_trade = perms.get("ContractTrade") or []
                read_only = int(info.get("readOnly", 0) or 0)
                if read_only != 0:
                    self.trade_permissions_ok = False
                    self.trade_permissions_error = "API key is READ-ONLY; it cannot place orders"
                elif not contract_trade:
                    self.trade_permissions_ok = False
                    self.trade_permissions_error = (
                        "API key lacks the ContractTrade permission; it cannot place futures orders"
                    )
                else:
                    self.trade_permissions_ok = True
                    self.trade_permissions_error = None
        except Exception as e:
            self.trade_permissions_ok = False
            self.trade_permissions_error = str(e)
        self.trade_permissions_ms = now_ms()

        self.healthy = True; self.last_error = None; self.last_run_ms = now_ms()


# =============================================================================
# 11. Accounting reconciler — exchange-verified PnL
# =============================================================================
class AccountingReconciler:
    """Back-fills realized_pnl + fees from exchange-verified closed fills.
    Unmatched exchange closes emit ACCT_ORPHAN — never fabricate a local row."""

    def __init__(self, rest, store: Store):
        self.adapter = rest if hasattr(rest, "closed_pnl") and hasattr(rest, "trade_permission") else None
        self.rest = rest.rest if self.adapter is not None and hasattr(rest, "rest") else rest
        self.store = store
        self._seen_order_ids: set[str] = set()

    async def run_once(self) -> int:
        try:
            rows = await (self.adapter.closed_pnl(limit=100) if self.adapter is not None
                          else self.rest.closed_pnl(limit=100))
        except Exception as e:
            log.warning("closed-pnl fetch failed: %s", e)
            METRICS.inc("gigpilot_accounting_errors_total")
            return 0
        applied = 0
        for row in rows:
            if self.adapter is not None:
                order_id = row.order_id
                sym = row.symbol
                side = row.side.value
                avg_exit = row.price
                closed_pnl = row.closed_pnl
                created_ms = row.ts_ms
                total_fee = row.fees
            else:
                order_id = str(row.get("orderId", ""))
                sym = row.get("symbol", "")
                side = row.get("side", "")
                avg_exit = f(row.get("avgExitPrice"))
                closed_pnl = f(row.get("closedPnl"))
                created_ms = int(f(row.get("createdTime"), 0))
                total_fee = 0.0
                for a, b in (("openFee", "closeFee"), ("cumEntryFee", "cumExitFee")):
                    if a in row or b in row:
                        total_fee = f(row.get(a)) + f(row.get(b)); break
                if total_fee == 0.0:
                    total_fee = f(row.get("execFee"))
            if not order_id or order_id in self._seen_order_ids: continue
            self._seen_order_ids.add(order_id)
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
        # The adapter is the live execution boundary. It deliberately reuses the already-hardened
        # BybitREST transport/session so this migration changes the abstraction seam, not signing,
        # retry, timeout, or venue semantics.
        self.exchange = BybitAdapter(cfg, rest=self.rest, metrics=METRICS)
        self.store = Store(cfg.db_path)
        self.model_registry = ModelRegistry(self.store, METRICS)
        self.markets = {s: MarketState(symbol=s) for s in cfg.symbols}
        self.step_size: dict[str, float] = {}
        self.tick_size: dict[str, float] = {}
        self.min_qty: dict[str, float] = {}
        self.executor: Optional[Executor] = None
        self.edge = EdgeEngine(cfg); self.risk = RiskGate(cfg)
        self.positions: dict[str, dict] = {}
        self.reconciler = Reconciler(cfg, self.exchange, self.store, self.positions)
        self.accounting = AccountingReconciler(self.exchange, self.store)
        self.ws = BybitWS(cfg, self.markets, on_private_event=self._on_private)
        self.portfolio = Portfolio()
        self.fee_rate_bps: dict[str, float] = {}
        self.day_start_equity: float = 0.0
        self._day_anchor: str = ""
        self.armed: bool = False
        self.position_mode: str = "one-way"
        self._tasks: list[asyncio.Task] = []
        self._task_factories: dict[str, callable] = {}
        self._watchdog = TaskWatchdog(
            disarm=self.disarm,
            journal=self.store.journal,
            metric_inc=METRICS.inc,
        )
        self._stop = asyncio.Event()
        self.signals: dict[str, EdgeEstimate] = {}
        self.last_events: deque = deque(maxlen=200)

    @staticmethod
    def _utc_date() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # ------------------------------------------------------------------ arm-state persistence
    # The kill switch, and an explicit owner disarm, MUST survive a restart.
    #
    # Without persistence, `GIGIPILOT_ARM=1` re-arms the engine on the next boot and silently undoes
    # an operator's kill. That is a fail-OPEN default, which is the one property a kill switch may
    # never have: an emergency stop that a process restart clears is not an emergency stop.
    #
    # Precedence on boot, highest first:  killed  >  disarmed  >  GIGPILOT_ARM
    # Clearing a kill requires a fresh ARM, which re-runs the full preflight gate — so the kill can
    # only be lifted by an authenticated owner action that also re-proves every safety condition.
    ARM_STATE_KEY = "arm_state"
    ARM_ARMED = "armed"
    ARM_DISARMED = "disarmed"
    ARM_KILLED = "killed"

    def _persist_arm_state(self, state: str) -> None:
        self.store.kv_set(self.ARM_STATE_KEY, state)

    def _restore_arm_state(self) -> tuple[bool, str]:
        """Decide the boot arming state. Returns (armed, source) so the reason is auditable."""
        state = (self.store.kv_get(self.ARM_STATE_KEY) or "").strip()
        if state == self.ARM_KILLED:
            return False, "persisted_kill_switch"
        if state == self.ARM_DISARMED:
            return False, "persisted_disarm"
        return bool(self.cfg.arm), "env_GIGPILOT_ARM"

    def disarm(self, reason: str) -> None:
        self.armed = False
        self._persist_arm_state(self.ARM_DISARMED)
        self.store.journal("DISARM", None, {"reason": reason})
        log.warning("DISARM: %s", reason)

    def kill(self) -> None:
        self.armed = False
        self._persist_arm_state(self.ARM_KILLED)
        self.store.journal("KILL", None, {})
        log.critical("KILL SWITCH")

    async def _detect_position_mode(self) -> str:
        last_err = None
        for attempt in range(3):
            try:
                positions = await self.exchange.positions()
                idxs = {int(p.position_idx) for p in positions}
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
            self.min_qty[s] = f(lot.get("minOrderQty"), 0.0)
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

        self.executor = Executor(self.cfg, self.exchange, self.step_size, metrics=METRICS, min_sizes=self.min_qty)

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

        self.armed, arm_source = self._restore_arm_state()
        if arm_source.startswith("persisted_"):
            log.warning("boot arm state suppressed by %s — refusing to auto-arm", arm_source)
        log.info("trading %s (source=%s)", "ARMED" if self.armed else "DISARMED (DO NOTHING)", arm_source)
        self.store.journal("BOOT", None, {"symbols": self.cfg.symbols,
                                          "armed": self.armed,
                                          "arm_source": arm_source,
                                          "hurdle_bps": self.cfg.edge_hurdle_bps,
                                          "position_mode": self.position_mode})

        self._task_factories = {
            "ws": self.ws.start,
            "strategy": self._strategy_loop,
            "reconcile": self._reconcile_loop,
            "portfolio": self._portfolio_loop,
            "daily-reset": self._daily_reset_loop,
            "accounting": self._accounting_loop,
        }
        self._tasks = [
            asyncio.create_task(factory(), name=name)
            for name, factory in self._task_factories.items()
        ]
        self._tasks.append(asyncio.create_task(self._watchdog_loop(), name="watchdog"))

    async def _watchdog_loop(self):
        """Supervise critical loops without ever auto-arming after a crash."""
        await asyncio.sleep(2)
        while not self._stop.is_set():
            for idx, task in enumerate(list(self._tasks)):
                if task.done() and task.get_name() != "watchdog" and not self._stop.is_set():
                    name = task.get_name()
                    try:
                        exc = task.exception()
                    except asyncio.CancelledError:
                        exc = None
                    if exc is None and not self._stop.is_set():
                        exc = RuntimeError("task exited without an exception")
                    if self._watchdog.failure(name, exc):
                        await asyncio.sleep(self._watchdog.restart_delay_s)
                        if self._stop.is_set() or self._watchdog.circuit_open:
                            continue
                        factory = self._task_factories.get(name)
                        if factory is not None:
                            self._tasks[idx] = asyncio.create_task(factory(), name=name)
                            METRICS.inc("gigpilot_watchdog_restarts_total", task=name)
                            self.store.journal("WATCHDOG_RESTART", None, {"task": name})
            await asyncio.sleep(1)

    async def stop(self):
        self._stop.set()
        await self.ws.stop()
        for t in self._tasks: t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.rest.stop()
        log.info("GigPilot stopped")

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

        # Reads succeeding is NOT the same as being allowed to trade. A key can read positions and
        # open orders perfectly well while every order-mutating endpoint refuses it — that is
        # precisely the production state recorded by the reconciler's permission probe. Without
        # this check the gate would happily arm an engine that believes it is live and then fails
        # on every single entry, which is the "authenticating is not authorising" defect that
        # /health already reports as a readiness blocker.
        if self.reconciler.healthy and not self.reconciler.trade_permissions_ok:
            block(
                "TRADE_PERMISSION_INVALID",
                "Bybit API key authenticates but is NOT authorised to place futures orders.",
                {"error": self.reconciler.trade_permissions_error},
            )

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
            self._persist_arm_state(self.ARM_ARMED)
            self.store.journal("ARM", None, {"hurdle_bps": self.cfg.edge_hurdle_bps})
            log.warning("MANUAL ARM: all safety gates passed")
        return True, reasons

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
            # Keep the shared dict identity stable. Reconciler holds a reference to this object;
            # rebinding self.positions here would leave reconciliation mutating a stale dictionary.
            self.positions.clear()
            self.positions.update(fresh)
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
                self._persist_arm_state(self.ARM_DISARMED)
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
        # Size through the executor's DECIMAL rounder, not `math.floor(x/step)*step`.
        #
        # In binary, 0.3/0.1 == 2.9999999999999996, so the float floor drops a whole extra step
        # (0.3 -> 0.2, a 33% under-size) and the position no longer matches the risk the gate is
        # about to approve for it. Delegating also removes a duplicated rounding rule: it lived both
        # here and in the executor, and when a rule is written twice only one of them is right.
        try:
            qty_s = self.executor._round_qty(symbol, notional / entry_px)
        except RuntimeError as e:
            log.info("skip entry %s: %s", symbol, e)
            METRICS.inc("gigpilot_entry_skips_total", reason="qty_rounding", symbol=symbol)
            return
        qty = float(qty_s)
        # Entry-time minimum-size eligibility. Submitting below `minOrderQty` is guaranteed to be
        # rejected by Bybit, so this is a clean pre-trade skip rather than a wasted round trip and a
        # logged exchange error. It is checked on ENTRY only — never on the exit/unwind path.
        size_ok, size_reason = self.executor.check_entry_size(symbol, qty_s)
        if not size_ok:
            log.info("skip entry %s: %s", symbol, size_reason)
            METRICS.inc("gigpilot_entry_skips_total", reason=size_reason, symbol=symbol)
            return
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
            # `qty_s` (the exact decimal string) goes on the wire, not the float round-trip of it.
            res = await self.executor.open_protected(symbol, est.side, qty_s, tp, sl)
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
            "ml": {
                "models": [
                    {
                        "model_id": e.model_id,
                        "state": e.state.value,
                        "verified": e.verified,
                        "mean_net_bps": e.mean_net_bps,
                        "p_value": e.one_sided_p_value,
                        "t_stat": e.t_stat,
                        "oos_sharpe": e.oos_sharpe,
                        "expected_net_edge_bps": e.expected_net_edge_bps,
                        "oos_trades": e.oos_trades,
                        "walk_forward_folds": e.walk_forward_folds,
                        "feature_importance": e.feature_importance,
                        "psi_baseline": e.psi_baseline,
                        "training_start_ms": e.training_start_ms,
                        "training_window_ms": e.training_window_ms,
                        "model_types": list(e.model_types),
                        "calibration_error": e.calibration_error,
                        "live_eligible": bool(
                            e.verified and e.state.value in ("CANARY", "CHAMPION")
                        ),
                    }
                    for e in self.model_registry.list()
                ],
                "live_eligible_count": sum(
                    1 for e in self.model_registry.list()
                    if e.verified and e.state.value in ("CANARY", "CHAMPION")
                ),
                "recent_events": self.store.ml_events(limit=20),
                "research_audits": self.store.ml_research_audits(limit=20),
            },
            "reconciliation": {"healthy": self.reconciler.healthy, "last_error": self.reconciler.last_error, "last_run_ms": self.reconciler.last_run_ms},
            "watchdog": self._watchdog.snapshot(),
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
@app.get("/api/health")
@app.get("/api/trading/gigpilot/health")
async def health(request: Request):
    """Liveness/readiness for the deploy gate, monitoring, and the owner.

    TWO-TIER RESPONSE. This endpoint stays reachable WITHOUT authentication because the deployment
    gate and uptime monitoring depend on it — locking it down would freeze every release, including
    the releases that fix things. But it previously returned the full operational picture to anyone
    who asked, which is free reconnaissance:

      * `host`                  -> which venue, so an attacker knows where else to look
      * `armed`                 -> whether live trading is on RIGHT NOW
      * `trade_permissions_error`, `credentials_error`, `trading_blockers`
                                -> verbatim internal failure text, including why a key was rejected
      * `position_mode`         -> account configuration detail

    So the sensitive fields are now returned only to a caller holding a valid owner session. The
    public tier keeps exactly what the gate asserts on (`deployedCommit`, `autonomousEngine.reachable`)
    plus booleans that carry monitoring value without disclosing configuration or state reasons.
    """
    gp = get_gp()
    is_owner = owner_authenticated(request)
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
    trade_authorized = bool(gp.reconciler.trade_permissions_ok)
    blockers = []
    if not public_ok:
        blockers.append("public market-data feed is not connected")
    if not private_ok:
        blockers.append("private (authenticated) WebSocket is not connected")
    if not fresh:
        blockers.append("market data is stale")
    if not credentials_ok:
        # Signed REST calls themselves are failing => the credential is not accepted at all.
        blockers.append(
            "credentials rejected for trading: "
            + (gp.reconciler.last_error or "never validated")
        )
    elif not trade_authorized:
        # Reads work but order placement would be refused. This is the production state and it must
        # NOT be reported as acceptable: an authenticated key that cannot trade is not trading-ready.
        blockers.append(
            "credentials cannot trade: "
            + (gp.reconciler.trade_permissions_error or "trade permission not validated")
        )
    if gp.position_mode != "one-way":
        blockers.append(f"position mode is '{gp.position_mode}', expected 'one-way'")

    deployed_file = Path(".gigpilot-data/deployed-commit.txt")
    commit_sha = ""
    if deployed_file.is_file():
        commit_sha = deployed_file.read_text(encoding="utf-8").strip()
    if not commit_sha:
        commit_sha = os.getenv("DEPLOYED_COMMIT", os.getenv("GITHUB_SHA", ""))

    payload = {
        # ---- PUBLIC TIER -------------------------------------------------------------
        # The deployment gate asserts on `deployedCommit` and `autonomousEngine.reachable`; both
        # must stay here or every rollout breaks. The rest is monitoring signal that discloses no
        # configuration, no credential state and no failure reasons.
        "status": "ok" if healthy else "degraded",
        "service": "Autonomous Crypto Grid Trading Platform",
        "healthy": healthy, "public_ws": public_ok,
        "private_ws": private_ok, "feed_fresh": fresh,
        "deployedCommit": commit_sha,
        "autonomousEngine": {
            "status": "healthy" if healthy else "unhealthy",
            "reachable": True,
            "publicWs": public_ok,
            "privateWs": private_ok,
            "feedFresh": fresh,
        },
        # A single boolean. Uptime monitoring needs to alarm when the engine cannot trade; nobody
        # outside needs to know WHY, and the reason is what leaks credential state.
        "trading_ready": len(blockers) == 0,
        "authenticated": is_owner,
    }

    if is_owner:
        payload.update({
            # ---- OWNER TIER ----------------------------------------------------------
            "host": gp.cfg.host,
            "position_mode": gp.position_mode,
            "armed": gp.armed,
            "credentials_ok": credentials_ok,
            "credentials_error": gp.reconciler.last_error,
            "credentials_checked_ms_ago": (now_ms() - gp.reconciler.last_run_ms)
                                          if gp.reconciler.last_run_ms else None,
            "trade_permissions_ok": trade_authorized,
            "trade_permissions_error": gp.reconciler.trade_permissions_error,
            "trade_permissions_checked_ms_ago": (now_ms() - gp.reconciler.trade_permissions_ms)
                                                if gp.reconciler.trade_permissions_ms else None,
            "trading_blockers": blockers,
        })
        payload["autonomousEngine"]["armed"] = gp.armed

    return JSONResponse(status_code=200 if healthy else 503, content=payload)


@app.get("/metrics", dependencies=[Depends(require_owner)])
async def metrics():
    gp = get_gp()
    METRICS.set("gigpilot_equity", gp.portfolio.equity)
    METRICS.set("gigpilot_gross_notional", gp.portfolio.gross_notional)
    METRICS.set("gigpilot_armed", 1 if gp.armed else 0)
    METRICS.set("gigpilot_daily_pnl", gp.portfolio.daily_pnl)
    for sym, e in gp.signals.items():
        METRICS.set("gigpilot_edge_net_bps", e.net_bps, symbol=sym)
    return Response(content=METRICS.render(), media_type="text/plain")


# ---------------------------------------------------------------------------
# Authentication (gpkg/api/auth.py). These are the ONLY routes reachable without a session token:
# they exist so the owner can obtain one. Everything operational is gated by require_owner.
# ---------------------------------------------------------------------------
class _LoginBody(_BaseModel):
    email: str = ""
    password: str = ""
    totpCode: str = ""
    emergencyPin: str = ""


class _SetupBody(_BaseModel):
    email: str = ""
    password: str = ""
    totpCode: str = ""
    emergencyPin: str = ""


@app.get("/api/auth/status")
async def api_auth_status(request: Request):
    auth = get_owner_auth()
    from gpkg.api.auth import extract_token
    return auth.status(auth.verify(extract_token(request) or ""))


def _throttled_response(auth) -> Optional[JSONResponse]:
    """429 + Retry-After when the login throttle is engaged.

    Checked BEFORE any credential comparison, so a locked-out caller cannot even make the server do
    PBKDF2 work. Returning 401 here would be wrong: it tells the caller "your guess was wrong" when
    the truth is "stop guessing", and it invites the retry that the lockout exists to prevent.
    """
    allowed, retry_after = auth.throttle.check()
    if allowed:
        return None
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(retry_after)},
        content={"success": False, "lockedOut": True, "retryAfterSeconds": retry_after,
                 "error": f"Too many failed authentication attempts. Retry in {retry_after}s."},
    )


@app.post("/api/auth/login")
async def api_auth_login(body: _LoginBody):
    auth = get_owner_auth()
    limited = _throttled_response(auth)
    if limited is not None:
        return limited
    ok, token, err = auth.login(
        body.email, body.password, body.totpCode, body.emergencyPin
    )
    if not ok:
        return JSONResponse(status_code=401, content={"success": False, "error": err})
    return {"success": True, "token": token}


@app.post("/api/auth/provision")
async def api_auth_provision(body: _LoginBody):
    """Start first-run setup. Gated on the break-glass PIN so it cannot be used to seize the account."""
    auth = get_owner_auth()
    limited = _throttled_response(auth)
    if limited is not None:
        return limited
    if not auth.verify_emergency_pin(body.emergencyPin):
        return JSONResponse(status_code=401, content={"success": False, "error": "Invalid break-glass PIN."})
    return {"success": True, **auth.initiate_setup(body.email or None)}


@app.post("/api/auth/setup")
async def api_auth_setup(body: _SetupBody):
    auth = get_owner_auth()
    limited = _throttled_response(auth)
    if limited is not None:
        return limited
    if not auth.verify_emergency_pin(body.emergencyPin):
        return JSONResponse(status_code=401, content={"success": False, "error": "Invalid break-glass PIN."})
    ok, token, err = auth.complete_setup(body.password, body.totpCode, body.email or None)
    if not ok:
        return JSONResponse(status_code=422, content={"success": False, "error": err})
    return {"success": True, "token": token}


@app.get("/api/state", dependencies=[Depends(require_owner)])
async def api_state():
    return JSONResponse(get_gp().snapshot())


@app.post("/api/arm", dependencies=[Depends(require_owner)])
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


@app.post("/api/disarm", dependencies=[Depends(require_owner)])
async def api_disarm():
    gp = get_gp()
    was_armed = gp.armed
    # Sticky: a disarm must survive a restart, otherwise `GIGPILOT_ARM=1` silently undoes it.
    gp.disarm("manual")
    return {"success": True, "armed": False, "idempotent": not was_armed}


@app.post("/api/kill", dependencies=[Depends(require_owner)])
async def api_kill():
    gp = get_gp()
    # Sticky: the kill switch is persisted BEFORE any unwind attempt, so a crash mid-flatten still
    # leaves the engine disarmed on the next boot rather than re-arming it.
    gp.kill()
    for sym in list(gp.positions.keys()):
        try: await gp._close_position(sym, reason="kill_switch")
        except Exception as e: log.error("kill close %s: %s", sym, e)
    for sym in gp.cfg.symbols:
        try: await gp.exchange.cancel_all(sym)
        except Exception as e: log.warning("cancel_all %s: %s", sym, e)
    return {"killed": True}


@app.get("/events", dependencies=[Depends(require_owner)])
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


from gpkg.api.compat import register_compat_routes
register_compat_routes(app, get_gp)

from gpkg.web.dashboard import mount_dashboard

mount_dashboard(app, fallback_html=DASHBOARD_HTML)


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
