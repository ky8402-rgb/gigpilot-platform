"""Trading engine: orchestration, health, self-healing, and the main loop.

Loop topology
-------------
  feed (ws + rest)  ->  CandleStore
  tick loop:
      1. refresh tickers / mark positions
      2. accrue real funding on open positions
      3. manage exits (stop / target / breakeven / trailing) on live price
      4. evaluate risk guards -> may halt
      5. when a NEW CLOSED BAR appears, run the entry scan for that symbol
      6. record the equity point
  health loop:
      - detect stale/dropped data and fail closed
      - reconcile against the exchange in live mode
      - auto-rollback parameters if live performance degrades
  learning loop:
      - walk-forward optimise on real history, promote only on OOS evidence

Fail-closed principle: any doubt about data integrity, connectivity, or account
state resolves to "do not open new risk". Existing positions stay protected by
their stops.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from . import indicators as ta
from . import hostid
from .config import PROJECT_ROOT, Config, redact
from .costs import CostModel
from .exchange import (ExchangeError, Ticker, create_market_client,
                       create_private_client)
from .execution import BaseBroker, ExecutionEngine, LiveBroker, PaperBroker
from .learning import ParamSet, WalkForwardOptimizer, apply_params
from .logging_setup import get_logger, recent_logs
from .market import CandleStore, MarketFeed, screen_universe
from .portfolio import Ledger, Position, load_equity_curve, load_trades
from .risk import HaltReason, RiskManager, size_position
from .strategy import (
    Decision,
    StrategyEngine,
    build_signals,
    edge_is_reliable,
    latest_setup,
    setup_history,
)

log = get_logger("engine")

# Loop-latency escalation policy. A single slow tick is not actionable; a sustained run of
# them inside the window is, and that is the only thing that raises an alert. Chosen to be
# deliberately hard to trip: the loop budget is ~5 s, so three overruns inside ten minutes
# means something structural, not a pause in the weather.
SLOW_TICK_WINDOW_S = 600.0
SLOW_TICK_ALERT_THRESHOLD = 3
SLOW_TICK_ALERT_DEBOUNCE_S = 900.0


@dataclass
class EngineStatus:
    started_at: float = field(default_factory=time.time)
    last_tick: float = 0.0
    ticks: int = 0
    last_entry_scan: float = 0.0
    entry_scans: int = 0
    trades_opened: int = 0
    trades_closed: int = 0
    signals_seen: int = 0
    signals_rejected: int = 0
    last_error: str = ""
    error_count: int = 0
    loop_errors: int = 0
    last_rollback_version: int = 0
    learning_runs: int = 0
    last_learning_ts: float = 0.0
    last_learning_verdict: str = ""
    last_learning_reason: str = ""
    reconcile_issues: List[str] = field(default_factory=list)
    orphan_restarts: int = 0
    # Loop latency. Without this the engine can silently fall behind its own cadence: one
    # blocking REST or depth call delays every subsequent closed-bar entry scan, which on a
    # 1h strategy costs edge directly and is invisible in every other counter.
    last_tick_ms: float = 0.0
    max_tick_ms: float = 0.0
    slow_ticks: int = 0
    # Overruns inside the recent window, and the per-phase breakdown of the most recent
    # tick, so a sustained slowdown can be attributed instead of merely noticed.
    slow_ticks_recent: int = 0
    slow_tick_alerts: int = 0
    last_tick_phases: Dict[str, float] = field(default_factory=dict)
    _slow_tick_events: List[float] = field(default_factory=list, repr=False)
    _last_slow_alert_ts: float = field(default=0.0, repr=False)

    def record_tick(
        self, duration_s: float, budget_s: float,
        phases: Optional[Dict[str, float]] = None,
    ) -> bool:
        """Record one loop iteration's cost against its cadence budget.

        Returns True when overruns have become persistent enough to be worth investigating.
        A lone slow tick is noise — a GC pause, a burst of exchange latency, a cold cache —
        and reacting to it would be chasing noise. Only a *sustained* run of overruns inside
        ``SLOW_TICK_WINDOW_S`` escalates, debounced so one incident reports once. The phase
        breakdown is retained so the investigation starts from evidence, not guesswork.
        """
        ms = duration_s * 1000.0
        self.last_tick_ms = ms
        if ms > self.max_tick_ms:
            self.max_tick_ms = ms
        if phases:
            self.last_tick_phases = {k: round(v * 1000.0, 2) for k, v in phases.items()}
        if duration_s <= budget_s:
            return False

        self.slow_ticks += 1
        now = time.time()
        self._slow_tick_events.append(now)
        cutoff = now - SLOW_TICK_WINDOW_S
        while self._slow_tick_events and self._slow_tick_events[0] < cutoff:
            self._slow_tick_events.pop(0)
        self.slow_ticks_recent = len(self._slow_tick_events)

        if (self.slow_ticks_recent >= SLOW_TICK_ALERT_THRESHOLD
                and now - self._last_slow_alert_ts >= SLOW_TICK_ALERT_DEBOUNCE_S):
            self._last_slow_alert_ts = now
            self.slow_tick_alerts += 1
            return True
        return False

    def as_dict(self) -> Dict[str, Any]:
        return {
            "started_at": self.started_at,
            "uptime_s": round(time.time() - self.started_at, 1),
            "last_tick_ts": self.last_tick,
            "last_tick_age_s": round(time.time() - self.last_tick, 2) if self.last_tick else None,
            "ticks": self.ticks,
            "entry_scans": self.entry_scans,
            "trades_opened": self.trades_opened,
            "trades_closed": self.trades_closed,
            "signals_seen": self.signals_seen,
            "signals_rejected": self.signals_rejected,
            "error_count": self.error_count,
            "loop_errors": self.loop_errors,
            "last_error": self.last_error,
            "learning_runs": self.learning_runs,
            "last_learning_ts": self.last_learning_ts,
            "last_learning_verdict": self.last_learning_verdict,
            "last_learning_reason": self.last_learning_reason,
            "reconcile_issues": self.reconcile_issues[-10:],
            "orphan_restarts": self.orphan_restarts,
            "last_tick_ms": round(self.last_tick_ms, 1),
            "max_tick_ms": round(self.max_tick_ms, 1),
            "slow_ticks": self.slow_ticks,
            "slow_ticks_recent": self.slow_ticks_recent,
            "slow_tick_window_s": SLOW_TICK_WINDOW_S,
            "slow_tick_alert_threshold": SLOW_TICK_ALERT_THRESHOLD,
            "slow_tick_alerts": self.slow_tick_alerts,
            "last_tick_phases": self.last_tick_phases,
            "last_rollback_version": self.last_rollback_version,
        }


class TradingEngine:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.status = EngineStatus()
        self.mode = cfg.effective_mode()

        self.cost_model = CostModel(cfg)
        # Risk guards are constructed with a persistence hook so a halt (and the
        # peak-equity that triggers one) survives a process restart.
        self.risk = RiskManager(cfg, persist_cb=self._persist_risk_state)
        self.strategy = StrategyEngine(cfg, self.cost_model)

        db = cfg.db_file
        # The venue is part of the store key so bars from different exchanges can
        # never be spliced into one series.
        self.store = CandleStore(db, persist=cfg.data.persist_candles,
                                 venue=cfg.exchange.name)
        self.ledger = Ledger(cfg.risk.starting_equity, db, persist=True)
        self.optimizer = WalkForwardOptimizer(cfg, db)

        # Restore prior state so a restart is not amnesia.
        self.ledger.equity_curve = load_equity_curve(db)
        if self.ledger.equity_curve:
            self.risk.on_equity(self.ledger.equity_curve[-1]["equity"])

        # Venue-agnostic clients (Binance or Bybit) sharing one method surface.
        self.public: Optional[Any] = None
        self.private: Optional[Any] = None
        self.feed: Optional[MarketFeed] = None
        self.broker: Optional[BaseBroker] = None
        self.execution: Optional[ExecutionEngine] = None

        self.symbols: List[str] = []
        self.specs: Dict[str, Any] = {}
        self.params: ParamSet = self.optimizer.active_params() or ParamSet()
        self.strategy_cfg = apply_params(cfg.strategy, self.params)
        self._last_scanned: Dict[str, int] = {}
        self._decisions: Dict[str, Decision] = {}
        # Indicator/signal frames per symbol, invalidated when they can actually change.
        # See `_analysis` for why this is not premature optimisation.
        self._analysis_cache: Dict[str, Dict[str, Any]] = {}
        # Bumped whenever the learned parameters are promoted, so cached indicator frames
        # computed under the old thresholds are never reused.
        self._strategy_cfg_generation = 0
        self._tick_phases: Dict[str, float] = {}
        # Symbol -> {enabled, reason, ...}. Populated from persisted evidence at
        # start and refreshed by each learning run.
        self.symbol_state: Dict[str, Dict[str, Any]] = self.optimizer.symbol_state()
        self._running = False
        self._tasks: List[asyncio.Task] = []
        self._state_lock = asyncio.Lock()
        self._selfcheck: Dict[str, Any] = {}
        self._host_identity: Dict[str, Any] = {"enabled": False, "ok": True}
        hp = Path(cfg.risk.halt_file)
        self.halt_file = hp if hp.is_absolute() else PROJECT_ROOT / hp

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    async def start(self) -> None:
        log.info(
            "starting engine",
            extra={"mode": self.mode, "interval": self.cfg.data.primary_interval,
                   "api_key": redact(self.cfg.exchange.api_key)},
        )
        self.public = create_market_client(self.cfg)
        await self.public.ping()
        self.specs = await self.public.exchange_info()

        if self.mode == "live":
            self.private = create_private_client(self.cfg)
            # Verify the key's capabilities BEFORE any order is attempted, and
            # refuse to run if it can withdraw or transfer funds.
            probe = await self.private.permissions_probe()
            log.warning("LIVE MODE ARMED", extra={"venue": self.cfg.exchange.name, "probe": probe})
            if probe.get("can_withdraw"):
                raise RuntimeError(
                    "refusing to arm: the API key has WITHDRAWAL permission. "
                    "Disable withdrawals on this key before running live."
                )
            if not probe.get("can_trade_futures", True):
                raise RuntimeError(
                    "refusing to arm: the API key lacks futures/contract trading permission"
                )
            self.broker = LiveBroker(self.cfg, self.ledger, self.private, self.cost_model)
        else:
            self.broker = PaperBroker(self.cfg, self.ledger, self.cost_model)
            log.info("PAPER MODE: real market data, simulated fills, no orders sent")

        self.execution = ExecutionEngine(self.cfg, self.ledger, self.broker, self.cost_model)
        self.symbols = await screen_universe(self.cfg, self.public)
        if not self.symbols:
            raise RuntimeError("no tradable symbols passed the liquidity screen")

        self.feed = MarketFeed(self.cfg, self.public, self.store)
        await self.feed.start(self.symbols)

        # Restore durable guard state BEFORE anything can trade. A kill switch from
        # a previous run must still be in force.
        # Host identity must be established BEFORE any live risk is taken. An API
        # key is bound to specific source IPs, so running the live configuration on
        # the wrong machine silently routes orders from an unintended host.
        idrep = await hostid.verify(self.cfg.exchange.expected_host_ip)
        self._host_identity = idrep
        if idrep["enabled"]:
            if idrep["ok"]:
                log.info("host identity confirmed", extra={"ip": idrep["actual"]})
            else:
                log.error("HOST IDENTITY MISMATCH — starting halted", extra={"detail": idrep["detail"]})
                self.risk.halt(HaltReason.HOST_IDENTITY_MISMATCH.value, idrep["detail"])
                self.ledger.log_event("host_identity_mismatch", idrep)
        else:
            log.info("host identity check disabled (exchange.expected_host_ip unset)")

        if self.halt_file.exists():
            self.risk.halt(HaltReason.KILL_SWITCH_FILE.value,
                           f"kill switch file present at startup: {self.halt_file}")
            log.error("KILL SWITCH FILE PRESENT — starting halted",
                      extra={"path": str(self.halt_file)})

        restored = self.ledger.load_risk_state()
        if restored and self.risk.restore_state(restored):
            log.warning("risk guard state restored from disk",
                        extra={"halted": self.risk.state.halted,
                               "reasons": self.risk.state.halt_reasons,
                               "peak_equity": self.risk.state.peak_equity})

        if self.mode == "live":
            # Discover and manage any position that already exists on the account.
            # Without this the ledger believes exposure is zero and can open a
            # second position on top of a real one.
            await self._adopt_exchange_positions()

        self._running = True
        self._tasks = [
            asyncio.create_task(self._tick_loop(), name="tick"),
            asyncio.create_task(self._health_loop(), name="health"),
        ]
        if self.cfg.learning.enabled:
            self._tasks.append(asyncio.create_task(self._learning_loop(), name="learning"))
        else:
            # Even with learning disabled we must still evaluate which symbols are
            # tradeable; otherwise the fail-closed gate blocks everything forever.
            self._tasks.append(asyncio.create_task(self._initial_gating(), name="gating"))
        log.info("engine started", extra={"symbols": self.symbols, "mode": self.mode})

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        if self.feed:
            await self.feed.stop()
        if self.public:
            await self.public.close()
        if self.private:
            await self.private.close()
        log.info("engine stopped")

    # ------------------------------------------------------------------
    # main tick
    # ------------------------------------------------------------------
    async def _tick_loop(self) -> None:
        interval = max(self.cfg.data.rest_poll_seconds / 6.0, 2.0)
        while self._running:
            t0 = time.time()
            try:
                await self._tick()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                self.status.loop_errors += 1
                self.status.error_count += 1
                self.status.last_error = str(exc)
                log.error("tick loop error", extra={"error": str(exc)})
                await asyncio.sleep(2.0)
            elapsed = time.time() - t0
            if self.status.record_tick(elapsed, interval, self._tick_phases):
                # Sustained overruns, not a single blip. Report once per debounce window
                # WITH the phase breakdown, so the cause is attributable from the log
                # rather than requiring a reproduction.
                log.warning(
                    "sustained slow ticks — loop is overrunning its cadence",
                    extra={
                        "slow_ticks": self.status.slow_ticks,
                        "slow_ticks_recent": self.status.slow_ticks_recent,
                        "window_s": SLOW_TICK_WINDOW_S,
                        "budget_s": round(interval, 2),
                        "last_tick_ms": round(self.status.last_tick_ms, 1),
                        "max_tick_ms": round(self.status.max_tick_ms, 1),
                        "phases_ms": self.status.last_tick_phases,
                    },
                )
            await asyncio.sleep(max(interval - elapsed, 0.5))

    async def _tick(self) -> None:
        assert self.feed is not None and self.execution is not None
        self.status.ticks += 1
        self.status.last_tick = time.time()

        # Per-phase timings. Cheap to collect, and the only way to attribute an overrun to a
        # cause rather than guessing at one once an alert finally fires.
        phases: Dict[str, float] = {}
        _t = time.time()

        # 1. cheap live quotes
        await self.feed.refresh_book_ticker()
        prices = {
            s: (self.feed.tickers.get(s).mid if self.feed.tickers.get(s) else None)
            for s in self.symbols
        }
        self.ledger.mark({k: v for k, v in prices.items() if v})
        phases["quotes"] = time.time() - _t
        _t = time.time()

        # 2. context for the execution engine
        atr_map = {}
        for s in self.symbols:
            df = self.store.frame(s, self.cfg.data.primary_interval, closed_only=True)
            if len(df) > self.cfg.strategy.atr_period + 1:
                a = ta.atr(df["high"], df["low"], df["close"], self.cfg.strategy.atr_period)
                if len(a) and a.iloc[-1] == a.iloc[-1]:
                    atr_map[s] = float(a.iloc[-1])
        self.execution.attach_context(self.feed.tickers, atr_map)
        phases["context"] = time.time() - _t
        _t = time.time()

        # 3. exits first — protecting open risk always precedes opening new risk
        for sym in list(self.ledger.positions.keys()):
            tk = self.feed.tickers.get(sym)
            if tk is None:
                continue
            df = self.store.frame(sym, self.cfg.data.primary_interval, closed_only=False)
            if df.empty:
                continue
            bar_high = float(df["high"].iloc[-1])
            bar_low = float(df["low"].iloc[-1])
            res = await self.execution.manage(sym, tk, None, bar_high, bar_low)
            if res.get("action") in ("stop", "target") and res.get("ok"):
                self.status.trades_closed += 1
                self._register_close(sym)
        phases["exits"] = time.time() - _t
        _t = time.time()

        # 4. funding accrual (paper book only; live is synced at reconcile)
        await self.execution.accrue_funding()

        # 5. risk guards
        data_ok = self.feed.data_ok()
        feed_ok = not self.feed.is_stale()
        self.risk.on_equity(self.ledger.equity)
        allowed, reasons = self.risk.evaluate(
            data_ok=data_ok, feed_connected=feed_ok, exchange_errors=self.feed.health.errors
        )
        phases["funding_risk"] = time.time() - _t
        _t = time.time()

        # 6. entries: only on a freshly CLOSED bar, and only if risk allows
        for sym in self.symbols:
            if not allowed or self.risk.state.halted:
                break
            last_ts = self.store.last_ts_ms(sym, self.cfg.data.primary_interval)
            if last_ts == 0:
                continue
            if self._last_scanned.get(sym) == last_ts:
                continue
            self._last_scanned[sym] = last_ts
            await self._scan_symbol(sym)

        phases["entries"] = time.time() - _t

        # 7. persist an equity point (rate-limited)
        if self.status.ticks % 10 == 1:
            self.ledger.record_equity()

        self._tick_phases = phases

    def _persist_risk_state(self, payload: Dict[str, Any]) -> None:
        self.ledger.save_risk_state(payload)

    async def _adopt_exchange_positions(self) -> List[Dict[str, Any]]:
        """Adopt positions already open on the exchange into the local ledger.

        A restart (crash, deploy, supervisor cycle) must not make the engine forget
        real risk. We rebuild each position with a protective stop derived from the
        current ATR, because an inherited position has no stop of its own.

        The position is adopted AS-IS: its size is a fact, not a request, so we do
        not silently resize it. We DO flag it loudly if it breaches current limits
        or sits on a symbol the evidence gate has disabled.
        """
        assert self.broker is not None
        adopted: List[Dict[str, Any]] = []
        try:
            remote = await self.broker.exchange_positions()
        except Exception as exc:
            log.error("position adoption failed; refusing to trade until resolved",
                      extra={"error": str(exc)})
            self.risk.manual_halt("could not reconcile existing exchange positions at startup")
            return adopted

        for r in remote:
            if r.symbol in self.ledger.positions:
                continue
            side = "LONG" if r.position_amt > 0 else "SHORT"
            qty = abs(float(r.position_amt))
            entry = float(r.entry_price) or float(r.mark_price)
            if qty <= 0 or entry <= 0:
                continue

            df = self.store.frame(r.symbol, self.cfg.data.primary_interval, closed_only=True)
            atr_val = 0.0
            if len(df) > self.cfg.strategy.atr_period + 1:
                a = ta.atr(df["high"], df["low"], df["close"], self.cfg.strategy.atr_period)
                if len(a) and a.iloc[-1] == a.iloc[-1]:
                    atr_val = float(a.iloc[-1])
            risk_unit = (atr_val * self.cfg.strategy.atr_stop_mult) if atr_val > 0 else entry * 0.02
            if side == "LONG":
                stop = entry - risk_unit
                target = entry + self.cfg.strategy.tp_r_multiple * risk_unit
            else:
                stop = entry + risk_unit
                target = entry - self.cfg.strategy.tp_r_multiple * risk_unit

            pos = Position(
                id=f"adopted-{uuid.uuid4().hex[:10]}",
                symbol=r.symbol, side=side, qty=qty, entry_price=entry,
                mark_price=float(r.mark_price) or entry, stop=stop, initial_stop=stop,
                target=target, leverage=float(r.leverage) or 1.0, risk_per_unit=risk_unit,
                mode="live", adopted=True,
                strategy_reason="adopted from the exchange at startup (no local record)",
            )
            self.ledger.open_position(pos)
            gate = self.symbol_state.get(r.symbol) or {}
            notional = qty * entry
            breaches = notional > self.ledger.equity * self.cfg.risk.max_position_notional_pct / 100.0
            log.warning(
                "ADOPTED EXISTING EXCHANGE POSITION",
                extra={"symbol": r.symbol, "side": side, "qty": qty, "entry": entry,
                       "notional": round(notional, 2), "protective_stop": round(stop, 8),
                       "symbol_gate_enabled": gate.get("enabled", False),
                       "breaches_notional_limit": breaches},
            )
            if not gate.get("enabled", False):
                log.error(
                    "adopted position sits on a symbol the evidence gate has DISABLED",
                    extra={"symbol": r.symbol, "reason": gate.get("reason", "not evaluated")},
                )
            if breaches:
                log.error("adopted position EXCEEDS the configured notional limit",
                          extra={"symbol": r.symbol, "notional": round(notional, 2),
                                 "limit_pct": self.cfg.risk.max_position_notional_pct})
            self.ledger.log_event("position_adopted", {
                "symbol": r.symbol, "side": side, "qty": qty, "entry": entry,
                "protective_stop": stop})
            adopted.append({"symbol": r.symbol, "side": side, "qty": qty,
                            "entry": entry, "stop": stop, "breaches_limit": breaches})
        if not adopted:
            log.info("no pre-existing exchange positions to adopt")
        return adopted

    def _register_close(self, symbol: str) -> None:
        """Feed a realized result back into the risk model (loss streaks)."""
        if not self.ledger.trades:
            return
        last = self.ledger.trades[-1]
        if last.symbol == symbol:
            self.risk.on_trade_closed(last.net_pnl)

    async def _scan_symbol(self, symbol: str) -> None:
        """Entry evaluation for one symbol on the latest closed bar."""
        assert self.feed is not None and self.execution is not None
        self.status.entry_scans += 1
        self.status.last_entry_scan = time.time()

        # Fail CLOSED: a symbol that has not yet been evaluated against its own
        # out-of-sample evidence is not tradeable. `enabled` defaults to False so
        # a missing entry blocks rather than permits.
        gate = self.symbol_state.get(symbol) or {}
        if not gate.get("enabled", False):
            log.debug("symbol not enabled", extra={
                "symbol": symbol,
                "reason": gate.get("reason", "not yet evaluated against out-of-sample evidence"),
            })
            return

        enriched, signals = self._analysis(symbol)
        if signals is None:
            return

        ticker = self.feed.tickers.get(symbol)
        depth = await self.feed.depth(symbol)
        equity = self.ledger.equity

        dec = self.strategy.decide(
            symbol, enriched, ticker, depth, equity,
            already_open=symbol in self.ledger.positions,
            size_fn=lambda s, e, t, spec: size_position(s, e, t, spec, self.cfg),
            spec=self.specs.get(symbol),
        )
        self._decisions[symbol] = dec
        if dec.action in ("SKIP", "OPEN_LONG", "OPEN_SHORT"):
            self.status.signals_seen += 1
        if not dec.traded:
            if dec.action == "SKIP":
                self.status.signals_rejected += 1
                log.info("signal rejected", extra={"symbol": symbol, "reason": dec.reason})
            return

        # Exposure check before sizing is committed.
        ok, why = self.risk.check_exposure(
            new_notional=dec.notional,
            gross_notional=self.ledger.gross_exposure,
            symbol_notional=0.0,
            open_count=len(self.ledger.positions),
        )
        if not ok:
            dec.traded = False
            dec.reason = f"blocked by exposure limits: {why}"
            dec.rejected_by.append("exposure_limit")
            self.status.signals_rejected += 1
            log.info("entry blocked", extra={"symbol": symbol, "reason": why})
            return

        # Rebuild the setup for the execution engine (levels + risk unit).
        setup = latest_setup(symbol, enriched, self.strategy_cfg)
        if setup.direction == "FLAT":
            return
        sizing = size_position(setup, equity, ticker, self.specs.get(symbol), self.cfg)
        if sizing["qty"] <= 0:
            dec.traded = False
            dec.reason = sizing.get("reason", "size zero")
            return

        opened, msg = await self.execution.open_position(setup, sizing, ticker, depth, dec)
        if opened:
            self.status.trades_opened += 1
            log.warning(
                "POSITION OPENED",
                extra={"symbol": symbol, "side": setup.direction, "qty": sizing["qty"],
                       "notional": round(sizing["notional"], 2),
                       "edge_bps": round(dec.expected_gross_edge_bps, 2),
                       "cost_bps": round(dec.cost_bps, 2), "mode": self.mode},
            )

    # ------------------------------------------------------------------
    # health / self-healing
    # ------------------------------------------------------------------
    async def _health_loop(self) -> None:
        # Run one pass IMMEDIATELY, then settle into the heartbeat. Otherwise there
        # is a window right after boot where /api/ready reports true but no health
        # telemetry has been published yet — which a deploy gate observes as a
        # broken self-check.
        first = True
        while self._running:
            try:
                if not first:
                    await asyncio.sleep(self.cfg.health.heartbeat_seconds)
                first = False
                await self._health_check()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                self.status.error_count += 1
                self.status.last_error = str(exc)
                log.error("health loop error", extra={"error": str(exc)})

    async def _health_check(self) -> None:
        assert self.feed is not None
        selfcheck: Dict[str, Any] = {"ts": time.time()}

        # -- websocket self-heal -----------------------------------------
        feed_age = self.feed.feed_age_s()
        selfcheck["feed_age_s"] = feed_age
        if not self.feed.health.connected and self.cfg.data.ws_enabled:
            selfcheck["ws_disconnected"] = True
            if feed_age is None or feed_age > self.cfg.health.stale_feed_halt_s:
                log.error("feed stale with websocket down; forcing REST refresh")
                await self.feed.refresh_rest()
                self.status.orphan_restarts += 1

        # -- host identity (re-checked; IPs can change under a live process) --
        idrep = await hostid.verify(self.cfg.exchange.expected_host_ip)
        self._host_identity = idrep
        selfcheck["host_identity"] = idrep
        if idrep["enabled"]:
            if idrep["ok"]:
                if self.risk.clear_reason(HaltReason.HOST_IDENTITY_MISMATCH.value):
                    log.warning("host identity restored; halt cleared")
            else:
                if self.risk.halt(HaltReason.HOST_IDENTITY_MISMATCH.value, idrep["detail"]):
                    self.ledger.log_event("host_identity_mismatch", idrep)

        # -- out-of-band file kill switch --------------------------------
        # `touch data/HALT` halts; removing it clears ONLY this reason.
        try:
            present = self.halt_file.exists()
        except OSError:
            present = False
        selfcheck["halt_file"] = {"path": str(self.halt_file), "present": present}
        if present:
            if self.risk.halt(HaltReason.KILL_SWITCH_FILE.value,
                              f"kill switch file present: {self.halt_file}"):
                self.ledger.log_event("kill_switch_file", {"present": True})
        elif self.risk.clear_reason(HaltReason.KILL_SWITCH_FILE.value):
            self.ledger.log_event("kill_switch_file", {"present": False})

        # -- equity / drawdown -------------------------------------------
        self.risk.on_equity(self.ledger.equity)
        selfcheck["equity"] = self.ledger.equity
        selfcheck["drawdown_pct"] = self.risk.state.drawdown_pct
        selfcheck["halted"] = self.risk.state.halted
        selfcheck["halt_reasons"] = self.risk.state.halt_reasons

        # -- auto-rollback on live degradation ---------------------------
        if (
            self.mode == "live"
            and self.cfg.learning.enabled
            and self.params.version > 1
            and self.risk.state.drawdown_pct >= self.cfg.health.auto_rollback_drawdown_pct
        ):
            versions = [h for h in self.optimizer.history(20) if h["version"] < self.params.version]
            if versions:
                target = versions[0]["version"]
                rolled = self.optimizer.rollback(target)
                if rolled is not None:
                    self.params = rolled
                    self.strategy_cfg = apply_params(self.cfg.strategy, rolled)
                    self.status.last_rollback_version = target
                    log.warning(
                        "AUTO-ROLLBACK: parameters reverted",
                        extra={"to_version": target, "drawdown_pct": self.risk.state.drawdown_pct},
                    )
                    self.ledger.log_event("auto_rollback", {"to_version": target,
                                                           "drawdown_pct": self.risk.state.drawdown_pct})

        # -- live reconciliation -----------------------------------------
        if self.broker is not None and self.mode == "live":
            try:
                rec = await self.broker.reconcile(self.ledger)
                self.status.reconcile_issues = rec.get("issues", [])
                selfcheck["reconcile"] = {"ok": rec.get("ok"), "issues": rec.get("issues", [])}
            except Exception as exc:
                selfcheck["reconcile"] = {"ok": False, "error": str(exc)}

        # -- account truth in live mode ----------------------------------
        if self.private is not None:
            try:
                bals = await self.private.account_balance()
                quote = self.cfg.universe.quote
                acct = next((b for b in bals if b.asset == quote), None)
                if acct:
                    selfcheck["exchange_wallet_balance"] = acct.wallet_balance
                    selfcheck["exchange_available"] = acct.available_balance
                    # The EXCHANGE is the authority on equity in live mode. Sizing
                    # from a configured placeholder instead would mis-scale every
                    # position by however wrong that placeholder is.
                    equity = acct.margin_balance or acct.wallet_balance
                    rep = self.ledger.set_authoritative_equity(equity, f"{self.cfg.exchange.name}-wallet")
                    selfcheck["equity_source"] = self.ledger.equity_source
                    if rep.get("rebased_starting_equity"):
                        log.warning("live equity adopted from exchange; sizing basis rebased",
                                    extra={"equity": rep["adopted_equity"],
                                           "was": rep["previous_equity"],
                                           "delta": rep["delta"]})
                        self.ledger.log_event("equity_rebased", rep)
                    elif abs(rep.get("delta", 0.0)) > 0.01:
                        log.info("equity resynced from exchange",
                                 extra={"equity": rep["adopted_equity"], "delta": rep["delta"]})
            except ExchangeError as exc:
                selfcheck["balance_error"] = str(exc)
                log.error("could not read exchange balance; equity basis not refreshed",
                          extra={"error": str(exc)})

        self._selfcheck = selfcheck
        self.ledger.record_equity()

    # ------------------------------------------------------------------
    # learning
    # ------------------------------------------------------------------
    async def _initial_gating(self) -> None:
        """Evaluate tradeable symbols once history is warm, without waiting for
        the first full optimisation cycle."""
        await asyncio.sleep(20)
        try:
            frames = self._learning_frames()
            if not frames:
                return
            loop = asyncio.get_running_loop()
            decisions = await loop.run_in_executor(
                None, lambda: self.optimizer.apply_symbol_gating(frames, self.params)
            )
            for sym, d in decisions.items():
                self.symbol_state[sym] = d
            if not decisions:
                log.warning("initial gating produced no decisions; "
                            "all symbols remain fail-closed until history is warm")
            log.info("initial symbol gating complete", extra={
                "evaluated": len(decisions),
                "tradable": sorted(s for s, d in decisions.items() if d["enabled"])})
        except Exception as exc:
            self.status.error_count += 1
            log.error("initial gating failed", extra={"error": str(exc)})

    def _learning_frames(self, limit: Optional[int] = None) -> Dict[str, Any]:
        """History frames for learning.

        `limit=None` covers the ENTIRE universe and is used for symbol gating:
        gating costs one parameter set, and stopping short would leave symbols
        permanently disabled simply because they were never looked at.
        A limit is applied only to the expensive candidate search.
        """
        syms = self.symbols if limit is None else self.symbols[:limit]
        frames: Dict[str, Any] = {}
        for sym in syms:
            df = self.store.frame(sym, self.cfg.data.primary_interval, closed_only=True)
            if len(df) >= self.cfg.learning.train_bars + self.cfg.learning.test_bars:
                frames[sym] = df
        return frames

    async def _learning_loop(self) -> None:
        # Evaluate tradeable symbols first so the fail-closed gate opens as soon as
        # evidence supports it, then start the optimisation cadence.
        await self._initial_gating()
        while self._running:
            try:
                await self._run_learning()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                self.status.error_count += 1
                self.status.last_error = str(exc)
                log.error("learning run failed", extra={"error": str(exc)})
            await asyncio.sleep(max(self.cfg.learning.optimize_every_hours * 3600.0, 600.0))

    async def _run_learning(self) -> Dict[str, Any]:
        """Walk-forward optimise on real history; promote only on OOS evidence."""
        # Full universe for gating (cheap), a subset for the candidate search (CPU).
        gate_frames = self._learning_frames()
        search_frames = self._learning_frames(limit=6)
        if len(search_frames) < 2:
            log.info("learning skipped: insufficient history",
                     extra={"frames": len(search_frames)})
            return {"verdict": "skip", "reason": "insufficient history"}
        frames = search_frames

        loop = asyncio.get_running_loop()
        # CPU-bound: run off the event loop so ticks keep flowing.
        report = await loop.run_in_executor(
            None, lambda: self.optimizer.optimize(frames, incumbent=self.params)
        )
        # Re-evaluate each symbol's own out-of-sample edge and gate accordingly.
        # Uses the FULL universe so no symbol is left permanently unevaluated.
        decisions = self.optimizer.apply_symbol_gating(gate_frames, self.params)
        for sym, d in decisions.items():
            prev = self.symbol_state.get(sym)
            self.symbol_state[sym] = d
            if prev is None or prev.get("enabled") != d["enabled"]:
                log.warning(
                    "SYMBOL GATE CHANGED",
                    extra={"symbol": sym, "enabled": d["enabled"], "reason": d["reason"],
                           "oos_net_bps": round(d["oos_net_bps"], 2), "oos_trades": d["oos_trades"]},
                )
                self.ledger.log_event("symbol_gate", {"symbol": sym, **d})
            if d["enabled"]:
                # Force an immediate re-evaluation for newly tradeable symbols so
                # they do not sit without a decision (showing a stale 0.00 cost)
                # until the next hourly bar closes.
                self._last_scanned.pop(sym, None)

        self.status.learning_runs += 1
        self.status.last_learning_ts = time.time()
        self.status.last_learning_verdict = report["verdict"]
        self.status.last_learning_reason = report["reason"]

        if report["verdict"] == "promote":
            newp = self.optimizer.active_params()
            if newp is not None:
                self.params = newp
                self.strategy_cfg = apply_params(self.cfg.strategy, newp)
                # New thresholds mean every cached indicator/signal frame was computed
                # under the old ones. Bump the generation so `_analysis` cannot reuse them.
                self._strategy_cfg_generation += 1
                log.warning("strategy parameters updated", extra={"params": newp.strategy_overrides()})
                self.ledger.log_event("params_promoted", newp.as_dict())
        else:
            self.optimizer.record_rejection(report)
        return report

    async def run_learning_now(self) -> Dict[str, Any]:
        return await self._run_learning()

    # ------------------------------------------------------------------
    # state
    # ------------------------------------------------------------------
    def candles(self, symbol: str, limit: int = 300) -> List[Dict[str, Any]]:
        df = self.store.frame(symbol, self.cfg.data.primary_interval, closed_only=True)
        if df.empty:
            return []
        df = df.tail(limit)
        out = []
        for t, r in df.iterrows():
            out.append({
                "time": int(t.timestamp()),
                "open": float(r["open"]), "high": float(r["high"]),
                "low": float(r["low"]), "close": float(r["close"]),
                "volume": float(r["volume"]),
            })
        return out

    def _analysis(self, symbol: str) -> Tuple[pd.DataFrame, Optional[pd.DataFrame]]:
        """Enriched + signal frames for one symbol, recomputed only when they can change.

        Indicators over CLOSED bars are a pure function of the bar series, so they may be
        cached until a new bar closes. This is not premature optimisation — it is measured:
        ``ta.enrich`` costs ~51 ms per symbol, so building dashboard rows for a 10-symbol
        universe took ~2.6 s of synchronous CPU *per request*, which starved the event loop
        and made the scanner too slow for the UI to ever render it.

        The cache key covers everything that can change the answer: the last closed bar's
        timestamp, the bar count (a backfill keeps the last timestamp while adding history),
        and a generation counter bumped whenever learned parameters are promoted.
        """
        df = self.store.frame(symbol, self.cfg.data.primary_interval, closed_only=True)
        if df.empty:
            return df, None
        last_ts = int(self.store.last_ts_ms(symbol, self.cfg.data.primary_interval))
        key = (last_ts, len(df), self._strategy_cfg_generation)
        cached = self._analysis_cache.get(symbol)
        if cached is not None and cached.get("key") == key:
            return cached["df"], cached["signals"]

        min_bars = max(self.strategy_cfg.ema_trend, self.strategy_cfg.donchian_period) + 5
        if len(df) < min_bars:
            return df, None
        enriched = ta.enrich(df, self.strategy_cfg)
        signals = build_signals(enriched, self.strategy_cfg)
        self._analysis_cache[symbol] = {"key": key, "df": enriched, "signals": signals}
        return enriched, signals

    def symbol_rows(self) -> List[Dict[str, Any]]:
        rows = []
        for s in self.symbols:
            tk = self.feed.tickers.get(s) if self.feed else None
            df, signals = self._analysis(s)
            dec = self._decisions.get(s)
            setup = latest_setup(s, df, self.strategy_cfg, signals) if signals is not None else None
            hist = setup_history(signals, self.strategy_cfg)
            gate = self.symbol_state.get(s) or {}
            gated = not gate.get("enabled", False)
            rows.append({
                "symbol": s,
                "price": tk.mid if tk else (float(df["close"].iloc[-1]) if len(df) else None),
                "bid": tk.bid if tk else None,
                "ask": tk.ask if tk else None,
                "spread_bps": round(tk.spread_bps, 3) if tk else None,
                "funding_rate": tk.funding_rate if tk else None,
                "next_funding_ts": tk.next_funding_ts if tk else None,
                "change_24h_pct": tk.price_change_pct_24h if tk else None,
                "quote_volume_24h": tk.quote_volume_24h if tk else None,
                "bars": len(df),
                "last_bar_age_s": round((time.time() * 1000 - self.store.last_ts_ms(s, self.cfg.data.primary_interval)) / 1000.0, 1)
                if self.store.last_ts_ms(s, self.cfg.data.primary_interval) else None,
                # A gated symbol has no setup by definition: reporting its raw
                # direction with a blank reason would read as a hold, not a veto.
                "direction": "FLAT" if gated else (setup.direction if setup else "FLAT"),
                "regime": setup.regime if setup else "unknown",
                "trigger": setup.reason if setup else "",
                "last_decision": (gate.get("reason", "disabled") if gated
                                  else (dec.reason if dec else "")),
                "last_action": "DISABLED" if gated else (dec.action if dec else "HOLD"),
                "edge_bps": dec.expected_gross_edge_bps if dec else 0.0,
                "cost_bps": dec.cost_bps if dec else 0.0,
                "hurdle_bps": dec.hurdle_bps if dec else 0.0,
                "net_edge_bps": dec.net_edge_bps if dec else 0.0,
                "raw_direction": setup.direction if setup else "FLAT",
                "edge_samples": dec.samples if dec else 0,
                "min_edge_samples": self.strategy_cfg.min_edge_samples,
                "edge_reliable": edge_is_reliable(dec, self.strategy_cfg.min_edge_samples),
                "rejected_by": dec.rejected_by if dec else [],
                "verdict": dec.action if dec else "HOLD",
                "in_position": s in self.ledger.positions,
                "enabled": not gated,
                "gate_reason": gate.get(
                    "reason", "not yet evaluated against out-of-sample evidence"),
                # Is this symbol's silence normal, or is something wrong? These fields
                # answer with the symbol's own measured gap distribution instead of the
                # bare fact that no position happens to be open.
                **hist.as_dict(),
            })
        return rows

    def snapshot(self) -> Dict[str, Any]:
        snap = {
            "ts": time.time(),
            "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "mode": self.mode,
            "live_armed": self.cfg.live_enabled(),
            "venue": self.cfg.exchange.name,
            "market_type": self.cfg.exchange.market_type,
            "interval": self.cfg.data.primary_interval,
            "symbols": self.symbols,
            # The dashboard renders its scanner table from `symbol_rows`. It used to be
            # absent from the snapshot and never fetched separately, so the table — the
            # whole point of the UI — silently sat on "Loading universe…" forever.
            "symbol_rows": self.symbol_rows(),
            "portfolio": self.ledger.snapshot(),
            "risk": self.risk.snapshot(),
            "engine": self.status.as_dict(),
            "feed": self.feed.health.as_dict() if self.feed else {},
            "execution": self.execution.snapshot() if self.execution else {},
            "costs": self.cost_model.snapshot(),
            "params": self.params.as_dict(),
            "selfcheck": self._selfcheck,
            "host_identity": self._host_identity,
            "host_ip": self._host_identity.get("actual"),
            "learning": {
                "enabled": self.cfg.learning.enabled,
                "history": self.optimizer.history(10),
                "symbol_state": self.symbol_state,
                "tradable_symbols": sorted(
                    s for s in self.symbols
                    if (self.symbol_state.get(s) or {}).get("enabled", False)
                ),
            },
        }
        return snap
