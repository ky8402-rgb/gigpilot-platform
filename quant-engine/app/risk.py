"""Risk management.

Two responsibilities, deliberately separated:

  Sizing   — how large a position may be, given equity, volatility and caps.
  Guarding — whether trading is permitted at all right now, and when to force-flat
             and lock the book.

The guard layer is the last thing between this process and a blown account, so it
fails *closed*: any uncertainty, any missing datum, any breach resolves to NO TRADE.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from .logging_setup import get_logger

log = get_logger("risk")


class HaltReason(str, Enum):
    NONE = "none"
    DAILY_LOSS_LIMIT = "daily_loss_limit"
    MAX_DRAWDOWN = "max_drawdown"
    CONSECUTIVE_LOSSES = "consecutive_losses"
    STALE_DATA = "stale_data"
    FEED_DOWN = "feed_down"
    MANUAL = "manual"
    EXCHANGE_ERRORS = "exchange_errors"
    # A file on disk acts as an out-of-band kill switch: `touch data/HALT` stops
    # new risk without needing API access, a DB edit, or a dashboard token.
    KILL_SWITCH_FILE = "kill_switch_file"
    HOST_IDENTITY_MISMATCH = "host_identity_mismatch"


@dataclass
class RiskState:
    equity: float
    peak_equity: float
    day_start_equity: float
    day_key: str
    consecutive_losses: int = 0
    halted: bool = False
    halt_reasons: List[str] = field(default_factory=list)
    halt_since: float = 0.0
    daily_pnl: float = 0.0
    drawdown_pct: float = 0.0
    daily_pnl_pct: float = 0.0

    def as_dict(self) -> Dict[str, Any]:
        return {
            "equity": round(self.equity, 2),
            "peak_equity": round(self.peak_equity, 2),
            "day_start_equity": round(self.day_start_equity, 2),
            "daily_pnl": round(self.daily_pnl, 2),
            "daily_pnl_pct": round(self.daily_pnl_pct, 3),
            "drawdown_pct": round(self.drawdown_pct, 3),
            "consecutive_losses": self.consecutive_losses,
            "halted": self.halted,
            "halt_reasons": list(self.halt_reasons),
            "halt_since": self.halt_since,
        }


def round_step(value: float, step: float) -> float:
    if step <= 0:
        return value
    return math.floor(value / step) * step


def round_tick(price: float, tick: float) -> float:
    if tick <= 0:
        return price
    return round(round(price / tick) * tick, 10)


class RiskManager:
    def __init__(self, cfg, persist_cb=None):
        self.cfg = cfg
        self.cfg_r = cfg.risk
        # Optional persistence hook. Guard state MUST survive a restart: the
        # watchdog/systemd restart the process on any crash, and an in-memory-only
        # kill switch would silently re-arm a halted account.
        self._persist_cb = persist_cb
        self._last_persist = 0.0
        today = time.strftime("%Y-%m-%d", time.gmtime())
        eq = cfg.risk.starting_equity
        self.state = RiskState(
            equity=eq, peak_equity=eq, day_start_equity=eq, day_key=today
        )
        self._events: List[Dict[str, Any]] = []

    # -- durable guard state ----------------------------------------------
    def snapshot_state(self) -> Dict[str, Any]:
        st = self.state
        return {
            "peak_equity": st.peak_equity,
            "day_start_equity": st.day_start_equity,
            "day_key": st.day_key,
            "consecutive_losses": st.consecutive_losses,
            "halted": st.halted,
            "halt_reasons": list(st.halt_reasons),
            "halt_since": st.halt_since,
            "saved_at": time.time(),
        }

    def restore_state(self, payload: Optional[Dict[str, Any]]) -> bool:
        """Restore guard state persisted by a previous run.

        Only durable guards are restored; equity itself always comes from the live
        source (exchange in live mode), never from the snapshot.
        """
        if not payload or not isinstance(payload, dict):
            return False
        st = self.state
        try:
            st.peak_equity = max(float(payload.get("peak_equity") or 0.0), st.peak_equity)
            st.day_start_equity = float(payload.get("day_start_equity") or st.day_start_equity)
            st.day_key = str(payload.get("day_key") or st.day_key)
            st.consecutive_losses = int(payload.get("consecutive_losses") or 0)
            reasons = [str(r) for r in (payload.get("halt_reasons") or [])]
            st.halt_reasons = reasons
            st.halted = bool(reasons) or bool(payload.get("halted"))
            st.halt_since = float(payload.get("halt_since") or 0.0)
        except (TypeError, ValueError):
            return False
        self._roll_day()
        if st.halted:
            log.warning(
                "restored an ACTIVE TRADING HALT from the previous run",
                extra={"reasons": st.halt_reasons,
                       "note": "a kill switch must survive a restart; clear it deliberately"},
            )
            self._events.append({"ts": time.time(), "type": "halt_restored",
                                 "reasons": st.halt_reasons})
        return True

    def _persist(self, force: bool = False) -> None:
        if self._persist_cb is None:
            return
        now = time.time()
        if not force and (now - self._last_persist) < 10.0:
            return
        self._last_persist = now
        try:
            self._persist_cb(self.snapshot_state())
        except Exception as exc:  # persistence must never break the guard loop
            log.warning("risk state persist failed", extra={"error": str(exc)})

    # -- equity bookkeeping ------------------------------------------------
    def on_equity(self, equity: float) -> None:
        if equity <= 0:
            return
        st = self.state
        st.equity = equity
        st.peak_equity = max(st.peak_equity, equity)
        self._roll_day()
        st.daily_pnl = equity - st.day_start_equity
        st.daily_pnl_pct = (st.daily_pnl / st.day_start_equity * 100.0) if st.day_start_equity else 0.0
        st.drawdown_pct = (
            (st.peak_equity - equity) / st.peak_equity * 100.0 if st.peak_equity else 0.0
        )
        self._persist()

    def _reevaluate_halt(self) -> None:
        """Recompute the halt flag from the current reason set.

        Kept separate from evaluate() so the day-roll path can refresh the flag
        without needing live health inputs.
        """
        self.state.halt_reasons = sorted(set(r for r in self.state.halt_reasons if r))
        self.state.halted = bool(self.state.halt_reasons)
        if not self.state.halted:
            self.state.halt_since = 0.0

    def _roll_day(self) -> None:
        today = time.strftime("%Y-%m-%d", time.gmtime())
        if today != self.state.day_key:
            self.state.day_key = today
            self.state.day_start_equity = self.state.equity
            # Daily-loss halt expires with the UTC day; a drawdown kill switch does not.
            if HaltReason.DAILY_LOSS_LIMIT.value in self.state.halt_reasons:
                self.state.halt_reasons.remove(HaltReason.DAILY_LOSS_LIMIT.value)
            self._reevaluate_halt()
            self._persist(force=True)

    # -- outcome feedback --------------------------------------------------
    def on_trade_closed(self, net_pnl: float) -> None:
        st = self.state
        if net_pnl < 0:
            st.consecutive_losses += 1
        else:
            st.consecutive_losses = 0
        self._persist(force=True)

    # -- guards ------------------------------------------------------------
    # Reasons that this method derives from live gauges. Any halt reason NOT in
    # this set is externally managed (operator, kill-switch file, startup guard) and
    # must be preserved verbatim — otherwise each evaluate() call would silently
    # clear it.
    GAUGE_REASONS = {
        HaltReason.MAX_DRAWDOWN.value,
        HaltReason.DAILY_LOSS_LIMIT.value,
        HaltReason.CONSECUTIVE_LOSSES.value,
        HaltReason.STALE_DATA.value,
        HaltReason.FEED_DOWN.value,
        HaltReason.EXCHANGE_ERRORS.value,
    }

    def evaluate(
        self,
        *,
        data_ok: bool = False,
        feed_connected: bool = False,
        exchange_errors: int = 0,
    ) -> tuple[bool, List[str]]:
        """Evaluate every guard and return (allowed, reasons).

        The health flags default to the UNSAFE values on purpose: a caller that
        forgets to pass them gets a halt, not a silent green light. Fail closed.
        """
        st = self.state
        reasons: List[str] = []
        if st.drawdown_pct >= self.cfg_r.max_drawdown_pct:
            reasons.append(HaltReason.MAX_DRAWDOWN.value)
        if st.daily_pnl_pct <= -abs(self.cfg_r.daily_loss_limit_pct):
            reasons.append(HaltReason.DAILY_LOSS_LIMIT.value)
        if st.consecutive_losses >= self.cfg_r.max_consecutive_losses:
            reasons.append(HaltReason.CONSECUTIVE_LOSSES.value)
        if not data_ok:
            reasons.append(HaltReason.STALE_DATA.value)
        if not feed_connected:
            reasons.append(HaltReason.FEED_DOWN.value)
        if exchange_errors >= 10:
            reasons.append(HaltReason.EXCHANGE_ERRORS.value)

        # Union the gauge-derived reasons with the externally managed ones. A
        # previous implementation replaced the set outright, which silently cleared
        # the operator halt and the kill-switch file on the very next call.
        external = {r for r in st.halt_reasons if r not in self.GAUGE_REASONS}
        st.halt_reasons = sorted(set(reasons) | external)
        was = st.halted
        st.halted = bool(st.halt_reasons)
        if st.halted and not was:
            st.halt_since = time.time()
            log.warning("TRADING HALTED", extra={"reasons": st.halt_reasons})
            self._events.append({"ts": time.time(), "type": "halt", "reasons": st.halt_reasons})
            self._persist(force=True)
        elif st.halted is False and was:
            log.info("trading resumed")
            self._events.append({"ts": time.time(), "type": "resume"})
        return (not st.halted), st.halt_reasons

    def halt(self, code: str, detail: str = "") -> bool:
        """Add a halt reason. Returns True if this changed the state."""
        code = str(code)
        if code in self.state.halt_reasons:
            return False
        self.state.halt_reasons.append(code)
        self.state.halt_reasons = sorted(set(self.state.halt_reasons))
        self.state.halted = True
        self.state.halt_since = time.time()
        log.warning("trading halted", extra={"halt_code": code, "detail": detail})
        self._events.append({"ts": time.time(), "type": "halt_added",
                             "code": code, "detail": detail})
        self._persist(force=True)
        return True

    def clear_reason(self, code: str) -> bool:
        """Remove ONE halt reason, leaving any others in force."""
        code = str(code)
        if code not in self.state.halt_reasons:
            return False
        self.state.halt_reasons.remove(code)
        self._reevaluate_halt()
        log.warning("halt reason cleared", extra={"halt_code": code,
                                                 "still_halted": self.state.halted})
        self._events.append({"ts": time.time(), "type": "halt_cleared", "code": code})
        self._persist(force=True)
        return True

    def manual_halt(self, reason: str = "operator kill switch") -> None:
        self.halt(HaltReason.MANUAL.value, reason)
        if reason:
            self._events.append({"ts": time.time(), "type": "manual_halt", "reason": reason})

    def clear_halt(self) -> None:
        """Only a human may re-arm after a max-drawdown kill switch."""
        self.state.halt_reasons.clear()
        self.state.halted = False
        self.state.consecutive_losses = 0
        log.warning("halts cleared by operator")
        self._events.append({"ts": time.time(), "type": "clear_halt"})
        self._persist(force=True)

    def can_trade(self) -> bool:
        return not self.state.halted

    def events(self, limit: int = 100) -> List[Dict[str, Any]]:
        return self._events[-limit:]

    # -- exposure limits ---------------------------------------------------
    def check_exposure(
        self, new_notional: float, gross_notional: float, symbol_notional: float, open_count: int
    ) -> tuple[bool, str]:
        eq = self.state.equity
        if open_count >= self.cfg_r.max_concurrent_positions:
            return False, f"max concurrent positions ({self.cfg_r.max_concurrent_positions}) reached"
        if eq <= 0:
            return False, "equity is zero"
        if new_notional > eq * self.cfg_r.max_position_notional_pct / 100.0:
            return False, (
                f"position notional {new_notional:.2f} exceeds "
                f"{self.cfg_r.max_position_notional_pct}% of equity"
            )
        if gross_notional + new_notional > eq * self.cfg_r.max_gross_exposure_x:
            return False, (
                f"gross exposure {gross_notional + new_notional:.2f} exceeds "
                f"{self.cfg_r.max_gross_exposure_x}x equity ({eq:.2f})"
            )
        if symbol_notional > 0:
            return False, "symbol already has exposure"
        return True, "ok"

    def snapshot(self) -> Dict[str, Any]:
        d = self.state.as_dict()
        d["limits"] = {
            "risk_per_trade_pct": self.cfg_r.risk_per_trade_pct,
            "max_leverage": self.cfg_r.max_leverage,
            "max_position_notional_pct": self.cfg_r.max_position_notional_pct,
            "max_concurrent_positions": self.cfg_r.max_concurrent_positions,
            "max_gross_exposure_x": self.cfg_r.max_gross_exposure_x,
            "daily_loss_limit_pct": self.cfg_r.daily_loss_limit_pct,
            "max_drawdown_pct": self.cfg_r.max_drawdown_pct,
            "max_consecutive_losses": self.cfg_r.max_consecutive_losses,
            "max_spread_bps": self.cfg_r.max_spread_bps,
        }
        return d


# ---------------------------------------------------------------------------
# Sizing
# ---------------------------------------------------------------------------
def size_position(
    setup,
    equity: float,
    ticker,
    spec: Optional[Any],
    cfg,
) -> Dict[str, Any]:
    """Volatility-targeted, risk-capped position sizing.

    The stop distance defines risk per unit. We size so that hitting the stop costs
    exactly `risk_per_trade_pct` of equity — then clamp by every other cap.

    Returns a dict with qty/notional/leverage plus the binding constraint, so the UI
    can explain *why* a position is the size it is.
    """
    risk_unit = float(setup.risk_per_unit or 0.0)
    price = float(setup.price or 0.0)
    if risk_unit <= 0 or price <= 0 or equity <= 0:
        return {"qty": 0.0, "notional": 0.0, "leverage": 1.0, "reason": "invalid risk unit or price"}

    risk_budget = equity * cfg.risk.risk_per_trade_pct / 100.0
    qty_by_risk = risk_budget / risk_unit

    cap_notional = equity * cfg.risk.max_position_notional_pct / 100.0
    qty_by_notional = cap_notional / price
    qty = min(qty_by_risk, qty_by_notional)
    binding = "risk" if qty_by_risk <= qty_by_notional else "notional_cap"

    # Leverage cap: we never want implied leverage above max.
    implied_lev = (qty * price) / equity
    if implied_lev > cfg.risk.max_leverage:
        qty = (equity * cfg.risk.max_leverage) / price
        binding = "max_leverage"

    # Exchange contract constraints.
    if spec is not None:
        step = getattr(spec, "step_size", 0.0)
        if step > 0:
            stepped = round_step(qty, step)
            if stepped <= 0:
                return {
                    "qty": 0.0, "notional": 0.0, "leverage": 1.0,
                    "reason": f"size {qty:.10f} below exchange step {step}",
                    "binding": "exchange_step",
                }
            qty = stepped
        min_qty = getattr(spec, "min_qty", 0.0)
        min_notional = getattr(spec, "min_notional", 0.0)
        if qty < min_qty:
            return {
                "qty": 0.0, "notional": 0.0, "leverage": 1.0,
                "reason": f"size {qty} below exchange min qty {min_qty}",
                "binding": "exchange_min_qty",
            }
        if qty * price < min_notional:
            return {
                "qty": 0.0, "notional": 0.0, "leverage": 1.0,
                "reason": f"notional {qty * price:.2f} below exchange min {min_notional}",
                "binding": "exchange_min_notional",
            }

    notional = qty * price
    leverage = max(1.0, min(cfg.risk.max_leverage, notional / equity if equity else 1.0))
    return {
        "qty": qty,
        "notional": notional,
        "leverage": float(leverage),
        "risk_amount": risk_budget,
        "binding": binding,
        "reason": f"sized by {binding}",
    }
