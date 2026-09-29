"""Strategy: regime detection, entry rules, and empirical edge estimation.

Philosophy
----------
1. Detect the market regime first. Trend rules lose money in chop and mean-reversion
   rules lose money in trends; the cheapest edge available is simply not trading the
   wrong regime.
2. Generate a setup only on **closed** bars.
3. Estimate the setup's *gross* edge empirically from that symbol's own recent real
   history — never from a hand-waved assumption. If we do not have enough samples to
   estimate an edge, we report no edge and therefore do not trade.
4. Let the cost model veto. A setup only becomes an order if
   gross_edge_bps >= hurdle(round_trip_cost) x multiplier.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from . import indicators as ta
from .costs import CostEstimate, CostModel
from .exchange import DepthSnapshot, Ticker, SymbolSpec
from .logging_setup import get_logger

log = get_logger("strategy")


class Regime(str, Enum):
    TREND_UP = "trend_up"
    TREND_DOWN = "trend_down"
    RANGE = "range"
    CHOP = "chop"


@dataclass
class Setup:
    symbol: str
    direction: str = "FLAT"          # LONG | SHORT | FLAT
    regime: str = Regime.CHOP.value
    price: float = 0.0
    atr: float = 0.0
    stop: float = 0.0
    target: float = 0.0
    risk_per_unit: float = 0.0
    reason: str = ""
    score: float = 0.0
    indicators: Dict[str, float] = field(default_factory=dict)


@dataclass
class Decision:
    """Full audit record of why we did or did not trade. Surfaced in the UI."""
    symbol: str
    action: str                      # OPEN_LONG | OPEN_SHORT | HOLD | SKIP
    traded: bool = False
    regime: str = Regime.CHOP.value
    price: float = 0.0
    stop: float = 0.0
    target: float = 0.0
    qty: float = 0.0
    notional: float = 0.0
    leverage: float = 1.0
    expected_gross_edge_bps: float = 0.0
    cost_bps: float = 0.0
    hurdle_bps: float = 0.0
    net_edge_bps: float = 0.0
    samples: int = 0
    reason: str = ""
    cost_breakdown: Dict[str, float] = field(default_factory=dict)
    rejected_by: List[str] = field(default_factory=list)


def edge_is_reliable(dec: Optional[Decision], min_samples: int) -> bool:
    """Whether this decision rests on a *measured* edge, rather than on no edge at all.

    Two very different situations both end in "do not trade", and conflating them hides
    a real problem from the operator:

      * the edge **was measured** and found wanting (too few samples, weak t-stat), and
      * **no setup existed**, so no edge was ever estimated at all (`samples == 0`).

    Only the first says anything about the edge. Reporting ``True`` for the second — as
    a substring check on ``rejected_by`` alone did — makes the dashboard print a concrete
    edge number for a symbol whose edge is simply unknown. That reads as "verified, and
    it is zero" when the truth is "never measured".

    Fails closed: a missing decision, or anything short of enough real samples, is False.
    """
    if dec is None:
        return False
    if dec.samples < max(int(min_samples), 1):
        return False
    return "insufficient_edge_evidence" not in dec.rejected_by


# ---------------------------------------------------------------------------
# Regime
# ---------------------------------------------------------------------------
def detect_regime(row: pd.Series, cfg) -> Regime:
    if not np.isfinite(row.get("ema_fast", np.nan)) or not np.isfinite(row.get("adx", np.nan)):
        return Regime.CHOP
    up = row["ema_fast"] > row["ema_slow"]
    down = row["ema_fast"] < row["ema_slow"]
    trending = row["adx"] >= cfg.adx_min
    if trending and up:
        return Regime.TREND_UP
    if trending and down:
        return Regime.TREND_DOWN
    # Weak trend strength -> range vs outright chop, distinguished by whether price
    # is oscillating around a flat mean.
    if np.isfinite(row.get("slope", np.nan)):
        flat = abs(row["slope"]) / max(row["close"], 1e-9) < 1e-4
        if flat:
            return Regime.RANGE
    return Regime.CHOP


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------
def build_signals(df: pd.DataFrame, cfg) -> pd.DataFrame:
    """Boolean long/short entry columns plus trade levels. No look-ahead.

    Each column at index i depends only on rows <= i.
    """
    d = df.copy()
    atr = d["atr"]
    buffer = cfg.breakout_buffer_atr * atr
    mom = cfg.min_momentum_atr * atr

    trend_up = d["ema_fast"] > d["ema_slow"]
    trend_dn = d["ema_fast"] < d["ema_slow"]
    trending = d["adx"] >= cfg.adx_min

    htf_long = (d["close"] > d["ema_trend"]) if cfg.require_htf_alignment else True
    htf_short = (d["close"] < d["ema_trend"]) if cfg.require_htf_alignment else True
    if not isinstance(htf_long, pd.Series):
        htf_long = pd.Series(True, index=d.index)
        htf_short = pd.Series(True, index=d.index)

    breakout_long = d["close"] > (d["dc_up"] + buffer)
    breakout_short = d["close"] < (d["dc_lo"] - buffer)

    mom_long = (d["roc"] > 0) & (d["macd_hist"] > 0) & ((d["close"] - d["bb_mid"]) >= mom)
    mom_short = (d["roc"] < 0) & (d["macd_hist"] < 0) & ((d["bb_mid"] - d["close"]) >= mom)

    d["long_signal"] = (trend_up & trending & htf_long & breakout_long & mom_long).fillna(False)
    d["short_signal"] = (trend_dn & trending & htf_short & breakout_short & mom_short).fillna(False)

    # ATR-based risk levels fixed at signal time.
    d["stop_long"] = d["close"] - cfg.atr_stop_mult * atr
    d["stop_short"] = d["close"] + cfg.atr_stop_mult * atr
    risk = cfg.atr_stop_mult * atr
    d["target_long"] = d["close"] + cfg.tp_r_multiple * risk
    d["target_short"] = d["close"] - cfg.tp_r_multiple * risk
    d["risk_unit"] = risk
    return d


def latest_setup(
    symbol: str, df: pd.DataFrame, cfg, signals: Optional[pd.DataFrame] = None
) -> Setup:
    """Evaluate the most recent CLOSED bar.

    ``signals`` may be a frame already returned by :func:`build_signals` for the same
    ``df``. Passing it lets a caller that needs both the setup and the setup *history*
    analyse the bars once instead of twice.
    """
    if df is None or len(df) < max(cfg.ema_trend, cfg.donchian_period) + 5:
        return Setup(symbol=symbol, reason="insufficient history", regime=Regime.CHOP.value)
    d = signals if signals is not None else build_signals(df, cfg)
    row = d.iloc[-1]
    regime = detect_regime(row, cfg)
    price = float(row["close"])
    atr_v = float(row["atr"]) if np.isfinite(row["atr"]) else 0.0

    ind = {
        k: (float(row[k]) if k in row and np.isfinite(row.get(k, np.nan)) else None)
        for k in ("ema_fast", "ema_slow", "ema_trend", "atr", "adx", "rsi", "roc",
                  "macd_hist", "dc_up", "dc_lo", "bb_mid", "z", "rv")
    }

    if bool(row["long_signal"]):
        return Setup(
            symbol=symbol, direction="LONG", regime=regime.value, price=price, atr=atr_v,
            stop=float(row["stop_long"]), target=float(row["target_long"]),
            risk_per_unit=float(row["risk_unit"]),
            reason=f"breakout above {float(row['dc_up']):.6g} with ADX {float(row['adx']):.1f}, "
                   f"ROC {float(row['roc']) * 100:.2f}%",
            score=float(row["adx"]), indicators=ind,
        )
    if bool(row["short_signal"]):
        return Setup(
            symbol=symbol, direction="SHORT", regime=regime.value, price=price, atr=atr_v,
            stop=float(row["stop_short"]), target=float(row["target_short"]),
            risk_per_unit=float(row["risk_unit"]),
            reason=f"breakdown below {float(row['dc_lo']):.6g} with ADX {float(row['adx']):.1f}, "
                   f"ROC {float(row['roc']) * 100:.2f}%",
            score=float(row["adx"]), indicators=ind,
        )
    return Setup(
        symbol=symbol, direction="FLAT", regime=regime.value, price=price, atr=atr_v,
        reason=f"no setup: regime={regime.value} adx={float(row['adx']) if np.isfinite(row['adx']) else 0:.1f} "
               f"close={price:.6g}",
        indicators=ind,
    )


# ---------------------------------------------------------------------------
# Setup frequency — is "no trades" quiet, or broken?
# ---------------------------------------------------------------------------
@dataclass
class SetupHistory:
    """How often this symbol's own rules fire, and how long the current gap is.

    This answers the operator question a raw position count cannot: *is zero trades normal,
    or is something wrong?* A quiet market, a dead feed, and a rule that can no longer
    produce a setup all look identical from the outside. Comparing the current gap against
    the symbol's OWN measured gap distribution is what separates them.
    """
    bars: int = 0
    long_setups: int = 0
    short_setups: int = 0
    total_setups: int = 0
    bars_since_last: Optional[int] = None
    median_gap_bars: Optional[float] = None
    p90_gap_bars: Optional[float] = None
    max_gap_bars: Optional[int] = None
    state: str = "unknown"
    detail: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "setup_bars": self.bars,
            "setup_long": self.long_setups,
            "setup_short": self.short_setups,
            "setup_total": self.total_setups,
            "bars_since_last_setup": self.bars_since_last,
            "setup_gap_median_bars": self.median_gap_bars,
            "setup_gap_p90_bars": self.p90_gap_bars,
            "setup_gap_max_bars": self.max_gap_bars,
            "setup_state": self.state,
            "setup_detail": self.detail,
        }


def setup_history(
    signals: Optional[pd.DataFrame], cfg, idle_multiplier: float = 3.0
) -> SetupHistory:
    """Summarise how often this symbol's entry rules fired, from an already-built frame.

    Takes the frame produced by :func:`build_signals` rather than rebuilding it: counting is
    free (measured ~0.02 ms on 10 000 bars) while rebuilding indicators is not.

    ``state`` is deliberately coarse, and never flatters the system:

    * ``in_setup``             the latest closed bar carries a setup
    * ``normal_idle``          no setup, and the gap is inside the symbol's own measured
                               variation
    * ``elongated_idle``       no setup, and the gap exceeds ``idle_multiplier`` × the
                               symbol's median gap. Worth looking at — not an error.
    * ``no_historical_setups`` the rules have never fired on the stored history. There is no
                               distribution to compare against, so this is reported as
                               *unknown*, never as "normal": we have no evidence for that.
    """
    h = SetupHistory()
    if signals is None or len(signals) == 0:
        h.state = "no_historical_setups"
        h.detail = "no bars available"
        return h
    if "long_signal" not in signals.columns or "short_signal" not in signals.columns:
        h.state = "no_historical_setups"
        h.detail = "signal columns unavailable"
        return h

    h.bars = int(len(signals))
    long_mask = signals["long_signal"].fillna(False).astype(bool).to_numpy()
    short_mask = signals["short_signal"].fillna(False).astype(bool).to_numpy()
    fired = long_mask | short_mask
    h.long_setups = int(long_mask.sum())
    h.short_setups = int(short_mask.sum())
    h.total_setups = h.long_setups + h.short_setups

    idx = np.flatnonzero(fired)
    last_i = len(signals) - 1
    if idx.size == 0:
        h.state = "no_historical_setups"
        h.detail = f"entry rules have not fired in {h.bars} bars of stored history"
        return h

    h.bars_since_last = last_i - int(idx[-1])
    if bool(fired[last_i]):
        h.state = "in_setup"
        h.detail = "the latest closed bar carries a setup"
        return h

    gaps = np.diff(idx)
    if gaps.size == 0:
        h.state = "no_historical_setups"
        h.detail = (
            f"only one setup in {h.bars} bars; no gap distribution to compare against"
        )
        return h

    h.median_gap_bars = float(np.median(gaps))
    h.p90_gap_bars = float(np.percentile(gaps, 90))
    h.max_gap_bars = int(gaps.max())
    threshold = max(h.median_gap_bars * float(idle_multiplier), 1.0)
    if h.bars_since_last > threshold:
        h.state = "elongated_idle"
        h.detail = (
            f"no setup for {h.bars_since_last} bars vs this symbol's median gap "
            f"{h.median_gap_bars:.0f} (p90 {h.p90_gap_bars:.0f}, max {h.max_gap_bars}) — "
            f"outside its normal spacing"
        )
    else:
        h.state = "normal_idle"
        h.detail = (
            f"no setup for {h.bars_since_last} bars, within this symbol's median gap "
            f"{h.median_gap_bars:.0f} (p90 {h.p90_gap_bars:.0f})"
        )
    return h


# ---------------------------------------------------------------------------
# Shared trade simulator — used by BOTH the backtest and the live edge estimate
# so that what we measure is what we would actually have traded.
# ---------------------------------------------------------------------------
@dataclass
class SimTrade:
    symbol: str
    direction: str
    entry_i: int
    exit_i: int
    entry_price: float
    exit_price: float
    qty: float
    stop: float                      # stop level at exit (may have trailed)
    initial_stop: float
    target: float
    r_multiple: float
    gross_return_bps: float          # price move in bps, signed
    fee_bps: float
    net_return_bps: float            # after modelled fees only (slip added downstream)
    exit_reason: str
    bars_held: int


def simulate(
    symbol: str,
    df: pd.DataFrame,
    cfg,
    *,
    fee_bps_round_trip: float = 7.0,
    slippage_bps_round_trip: float = 0.0,
) -> Tuple[List[SimTrade], pd.Series]:
    """Walk-forward simulation of the rule over real bars.

    Deliberately pessimistic, because an optimistic backtest is worse than none:

      * Signals are read from the CLOSED bar and filled at that bar's close. We
        never fill at a price that was not observable when the decision was made.
      * If a bar's range touches both the stop and the target we assume the STOP
        filled first. Intrabar ordering is unknowable, so we take the bad case.
      * Trailing stops are re-anchored from the PREVIOUS bar's extreme, so the
        stop for bar i cannot be derived from bar i's own range.
      * One position per symbol at a time; no pyramiding.
      * Round-trip fees and slippage are charged in full on every trade.

    The arrays are pulled out of the frame once and iterated as numpy, which keeps
    a full walk-forward optimisation over many parameter sets tractable.
    """
    if df is None or len(df) < 60:
        return [], pd.Series(dtype=float)

    d = build_signals(df, cfg)
    n = len(d)

    close = d["close"].to_numpy(dtype=float)
    high = d["high"].to_numpy(dtype=float)
    low = d["low"].to_numpy(dtype=float)
    atr = d["atr"].to_numpy(dtype=float)
    long_sig = d["long_signal"].to_numpy(dtype=bool)
    short_sig = d["short_signal"].to_numpy(dtype=bool)
    stop_long = d["stop_long"].to_numpy(dtype=float)
    stop_short = d["stop_short"].to_numpy(dtype=float)
    tgt_long = d["target_long"].to_numpy(dtype=float)
    tgt_short = d["target_short"].to_numpy(dtype=float)
    risk_arr = d["risk_unit"].to_numpy(dtype=float)

    trades: List[SimTrade] = []
    equity_curve = np.zeros(n, dtype=float)
    total_cost_bps = float(fee_bps_round_trip) + float(slippage_bps_round_trip)

    warmup = max(cfg.ema_trend, cfg.donchian_period, cfg.atr_period) + 1
    if warmup >= n:
        return [], pd.Series(equity_curve, index=d.index)

    be_r = float(cfg.breakeven_after_r)
    tr_start = float(cfg.trailing_start_r)
    tr_mult = float(cfg.trailing_atr_mult)
    tp_r = float(cfg.tp_r_multiple)

    in_pos = False
    is_long = False
    entry = stop = target = risk = 0.0
    initial_stop = 0.0
    entry_i = 0
    be_moved = False
    cum = 0.0
    prev_high = high[warmup - 1]
    prev_low = low[warmup - 1]

    for i in range(warmup, n):
        a = atr[i]
        c = close[i]
        h = high[i]
        lo = low[i]

        if not np.isfinite(a) or a <= 0 or not np.isfinite(c):
            equity_curve[i] = cum
            prev_high, prev_low = h, lo
            continue

        if in_pos:
            exit_price = None
            reason = ""
            if is_long:
                r_now = (c - entry) / risk
                if lo <= stop:
                    exit_price = stop
                    reason = "trail/stop" if be_moved else "stop"
                elif h >= target:
                    exit_price = target
                    reason = "target"
                else:
                    if r_now >= be_r and not be_moved:
                        stop = max(stop, entry + 0.05 * risk)
                        be_moved = True
                    if r_now >= tr_start:
                        stop = max(stop, prev_high - tr_mult * a)
            else:
                r_now = (entry - c) / risk
                if h >= stop:
                    exit_price = stop
                    reason = "trail/stop" if be_moved else "stop"
                elif lo <= target:
                    exit_price = target
                    reason = "target"
                else:
                    if r_now >= be_r and not be_moved:
                        stop = min(stop, entry - 0.05 * risk)
                        be_moved = True
                    if r_now >= tr_start:
                        stop = min(stop, prev_low + tr_mult * a)

            if exit_price is not None:
                if is_long:
                    gross_bps = (exit_price - entry) / entry * 10_000.0
                    r_mult = (exit_price - entry) / risk
                else:
                    gross_bps = (entry - exit_price) / entry * 10_000.0
                    r_mult = (entry - exit_price) / risk
                trades.append(
                    SimTrade(
                        symbol=symbol,
                        direction="LONG" if is_long else "SHORT",
                        entry_i=entry_i, exit_i=i,
                        entry_price=entry, exit_price=exit_price, qty=0.0,
                        stop=stop, initial_stop=initial_stop, target=target, r_multiple=r_mult,
                        gross_return_bps=gross_bps, fee_bps=total_cost_bps,
                        net_return_bps=gross_bps - total_cost_bps,
                        exit_reason=reason, bars_held=i - entry_i,
                    )
                )
                cum += gross_bps - total_cost_bps
                in_pos = False
                be_moved = False

        if not in_pos:
            go_long = long_sig[i]
            go_short = short_sig[i]
            if go_long or go_short:
                rk = risk_arr[i]
                if np.isfinite(rk) and rk > 0:
                    is_long = bool(go_long)
                    entry = c
                    risk = float(rk)
                    stop = float(stop_long[i] if is_long else stop_short[i])
                    target = float(tgt_long[i] if is_long else tgt_short[i])
                    if np.isfinite(stop) and np.isfinite(target) and risk > 0:
                        entry_i = i
                        initial_stop = stop
                        in_pos = True
                        be_moved = False

        equity_curve[i] = cum
        prev_high, prev_low = h, lo

    return trades, pd.Series(equity_curve, index=d.index)


# ---------------------------------------------------------------------------
# Empirical edge estimation
# ---------------------------------------------------------------------------
@dataclass
class EdgeStats:
    samples: int = 0
    win_rate: float = 0.0
    avg_win_bps: float = 0.0
    avg_loss_bps: float = 0.0
    expectancy_bps: float = 0.0          # per-trade, gross of slip/funding
    expectancy_net_bps: float = 0.0      # after modelled fees
    payoff_ratio: float = 0.0
    total_net_bps: float = 0.0
    median_bars_held: float = 0.0
    max_consecutive_losses: int = 0
    tstat: float = 0.0
    reliable: bool = False
    reliability_note: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return self.__dict__.copy()


def edge_from_trades(
    trades: List[SimTrade], direction: str, cfg,
    min_samples: Optional[int] = None, min_tstat: Optional[float] = None,
) -> EdgeStats:
    """Per-trade expectancy for one direction, in bps, with a significance test.

    A raw positive mean is not evidence: five lucky trades produce one easily. We
    therefore require both a minimum sample count AND a minimum t-statistic on the
    per-trade returns before a setup is considered to have a measurable edge.
    """
    subset = [t for t in trades if t.direction == direction]
    st = EdgeStats(samples=len(subset))
    if not subset:
        return st

    wins = [t.gross_return_bps for t in subset if t.gross_return_bps > 0]
    losses = [t.gross_return_bps for t in subset if t.gross_return_bps <= 0]
    st.win_rate = len(wins) / len(subset)
    st.avg_win_bps = float(np.mean(wins)) if wins else 0.0
    st.avg_loss_bps = float(np.mean(losses)) if losses else 0.0
    st.expectancy_bps = float(np.mean([t.gross_return_bps for t in subset]))
    st.expectancy_net_bps = float(np.mean([t.net_return_bps for t in subset]))
    st.payoff_ratio = (
        st.avg_win_bps / abs(st.avg_loss_bps) if st.avg_loss_bps < 0 else 0.0
    )
    st.total_net_bps = float(np.sum([t.net_return_bps for t in subset]))
    st.median_bars_held = float(np.median([t.bars_held for t in subset]))

    streak = worst = 0
    for t in subset:
        if t.gross_return_bps <= 0:
            streak += 1
            worst = max(worst, streak)
        else:
            streak = 0
    st.max_consecutive_losses = worst

    nets = np.array([t.net_return_bps for t in subset], dtype=float)
    sd = float(nets.std(ddof=1)) if len(nets) > 1 else 0.0
    st.tstat = float(nets.mean() / (sd / np.sqrt(len(nets)))) if sd > 1e-9 else 0.0

    need_n = min_samples if min_samples is not None else getattr(cfg, "min_edge_samples", 12)
    need_t = min_tstat if min_tstat is not None else getattr(cfg, "min_edge_tstat", 1.0)
    reasons = []
    if len(subset) < need_n:
        reasons.append(f"only {len(subset)} samples (need {need_n})")
    if st.tstat < need_t:
        reasons.append(f"t-stat {st.tstat:.2f} (need {need_t:.2f})")
    st.reliable = not reasons
    st.reliability_note = "; ".join(reasons)
    return st


# ---------------------------------------------------------------------------
# Decision
# ---------------------------------------------------------------------------
class StrategyEngine:
    """Turns a closed-bar setup into a trade/no-trade decision."""

    def __init__(self, cfg, cost_model: CostModel):
        self.cfg = cfg
        self.cfg_s = cfg.strategy
        self.costs = cost_model

    def estimate_edge(
        self, symbol: str, df: pd.DataFrame, direction: str
    ) -> EdgeStats:
        trades, _ = simulate(
            symbol, df, self.cfg_s,
            fee_bps_round_trip=self.cfg.costs.maker_fee_bps + self.cfg.costs.taker_fee_bps,
        )
        return edge_from_trades(trades, direction, self.cfg_s)

    def decide(
        self,
        symbol: str,
        df: pd.DataFrame,
        ticker: Optional[Ticker],
        depth: Optional[DepthSnapshot],
        equity: float,
        *,
        already_open: bool = False,
        size_fn=None,
        spec: Optional[SymbolSpec] = None,
    ) -> Decision:
        s = latest_setup(symbol, df, self.cfg_s)
        dec = Decision(
            symbol=symbol, action="HOLD", regime=s.regime, price=s.price,
            stop=s.stop, target=s.target, reason=s.reason,
        )
        if ticker is None or ticker.mid <= 0:
            dec.rejected_by.append("no_ticker")
            dec.reason = "no live ticker"
            return dec

        # Cost/hurdle are computed on EVERY evaluation, setup or not, so the
        # dashboard never shows a 0.0 hurdle that contradicts the configured
        # floor. This is the live bar any setup on this symbol must clear.
        entry_side = "BUY" if s.direction == "LONG" else "SELL"
        ref_notional = max(
            equity * self.cfg.risk.max_position_notional_pct / 100.0, 1.0
        )
        ref_cost: CostEstimate = self.costs.round_trip(
            ticker=ticker, depth=depth, notional_usd=ref_notional,
            expected_holding_hours=float(self.cfg.risk.min_expected_holding_bars)
            * _bar_hours(self.cfg.data.primary_interval),
            entry_side=entry_side,
        )
        dec.cost_bps = ref_cost.total_bps
        dec.hurdle_bps = self.costs.hurdle_bps(ref_cost)
        dec.cost_breakdown = ref_cost.as_dict()

        if already_open:
            dec.action = "HOLD"
            dec.reason = (
                f"position already open; managing it (live hurdle "
                f"{dec.hurdle_bps:.1f}bps, cost {dec.cost_bps:.1f}bps)"
            )
            dec.rejected_by.append("position_open")
            return dec
        if s.direction == "FLAT":
            dec.rejected_by.append("no_setup")
            dec.reason = (
                f"{s.reason} | live round-trip cost {dec.cost_bps:.1f}bps, "
                f"hurdle {dec.hurdle_bps:.1f}bps"
            )
            return dec

        # --- size first: slippage and costs depend on the order's real size ---
        if size_fn is None:
            dec.rejected_by.append("no_sizer")
            dec.reason = "no position sizer configured"
            return dec
        sizing = size_fn(s, equity, ticker, spec)
        dec.qty = sizing.get("qty", 0.0)
        dec.notional = sizing.get("notional", 0.0)
        dec.leverage = sizing.get("leverage", 1.0)

        # --- empirical edge on this symbol's own real history ---------------
        stats = self.estimate_edge(symbol, df, s.direction)
        dec.samples = stats.samples
        dec.expected_gross_edge_bps = stats.expectancy_bps

        # --- costs on the real book, at the real size -----------------------
        base_hours = max(
            stats.median_bars_held or 0.0,
            float(self.cfg.risk.min_expected_holding_bars),
        ) * _bar_hours(self.cfg.data.primary_interval)
        # Re-price at the ACTUAL order size: slippage depends on how much size we
        # are about to walk through the book, not on a reference notional.
        cost: CostEstimate = self.costs.round_trip(
            ticker=ticker, depth=depth,
            notional_usd=dec.notional if dec.notional > 0 else ref_notional,
            expected_holding_hours=base_hours, entry_side=entry_side,
        )
        dec.cost_bps = cost.total_bps
        dec.hurdle_bps = self.costs.hurdle_bps(cost)
        dec.cost_breakdown = cost.as_dict()
        dec.net_edge_bps = dec.expected_gross_edge_bps - cost.total_bps

        # Gate 1: is there statistically measurable edge at all?
        if not stats.reliable:
            dec.action = "SKIP"
            dec.rejected_by.append("insufficient_edge_evidence")
            dec.reason = (
                f"{s.direction} setup on {symbol} but no verifiable edge: "
                f"{stats.reliability_note}. Observed expectancy "
                f"{stats.expectancy_bps:+.1f}bps over {stats.samples} samples; "
                f"hurdle to clear is {dec.hurdle_bps:.1f}bps. Not trading."
            )
            return dec

        # Gate 2: does the verified edge clear the fully-loaded round-trip cost?
        ok, shortfall, why = self.costs.clears_hurdle(dec.expected_gross_edge_bps, cost)
        if not ok:
            dec.action = "SKIP"
            dec.rejected_by.append("below_cost_hurdle")
            dec.reason = (
                f"{s.direction} on {symbol}: {why} (short by {shortfall:.1f}bps)"
            )
            return dec

        # Gate 3: sane position size and a book we can actually cross.
        if dec.qty <= 0 or dec.notional <= 0:
            dec.action = "SKIP"
            dec.rejected_by.append("size_zero")
            dec.reason = sizing.get("reason", "position size resolved to zero")
            return dec

        live_spread = depth.spread_bps() if depth is not None else ticker.spread_bps
        if live_spread > self.cfg.risk.max_spread_bps:
            dec.action = "SKIP"
            dec.rejected_by.append("spread_too_wide")
            dec.reason = (
                f"{symbol} spread {live_spread:.2f}bps exceeds max "
                f"{self.cfg.risk.max_spread_bps:.2f}bps"
            )
            return dec

        dec.traded = True
        dec.action = "OPEN_LONG" if s.direction == "LONG" else "OPEN_SHORT"
        dec.reason = (
            f"{s.reason} | edge {dec.expected_gross_edge_bps:.1f}bps gross "
            f"({stats.samples} samples, win {stats.win_rate * 100:.0f}%, "
            f"payoff {stats.payoff_ratio:.2f}) clears {dec.hurdle_bps:.1f}bps hurdle "
            f"-> net {dec.net_edge_bps:.1f}bps"
        )
        return dec


def _bar_hours(interval: str) -> float:
    table = {"1m": 1 / 60, "5m": 1 / 12, "15m": 0.25, "30m": 0.5, "1h": 1.0,
             "2h": 2.0, "4h": 4.0, "6h": 6.0, "12h": 12.0, "1d": 24.0}
    return table.get(interval, 1.0)
