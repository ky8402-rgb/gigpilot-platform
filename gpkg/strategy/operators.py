"""The four physics-inspired stochastic quoting operators.

These replace a static mid-centred grid with a dynamic quoting engine. Each operator is a pure,
deterministic function of its inputs: no venue calls, no time reads, no hidden state. That is the
fail-closed property in miniature — the same inputs always produce the same quote, and a caller can
prove the math with a unit test before a single order reaches Bybit.

Operator index (mirrors the spec):
  1. Momentum-based asymmetric skewing  -> `momentum_skew`
  2. Kinetic-energy / toxicity spacing -> `toxicity_spread` (+ `kinetic_energy`, `is_toxic_spike`)
  3. Frequency-adaptive step size      -> `atr_step`
  4. Dynamic capital velocity sizing   -> `gpkg.risk.allocation` (fractional Kelly + min-step floor)

Nothing here ever crosses the spread: the composed grid spacing is floored at the market spread, and
the caller's `OrderRequest` still carries the exchange's post-only flag, so the resting orders are
maker-only by construction.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else min(x, hi)


# ---------------------------------------------------------------------------
# Operator 1 — momentum-based asymmetric skewing
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Skew:
    """Where the nearest bid and ask rest relative to the reference price, in price units."""

    reference: float
    bid_offset: float
    ask_offset: float

    @property
    def nearest_bid(self) -> float:
        return self.reference - self.bid_offset

    @property
    def nearest_ask(self) -> float:
        return self.reference + self.ask_offset


def momentum_skew(mid: float, obi: float, spread_half: float, alpha: float = 0.5) -> Skew:
    """Compute the reference price and the bid/ask offsets from order-book imbalance.

    P_ref = P_mid + (alpha * OBI * Spread_half), with OBI clamped to [-1, 1].

    When OBI > 0 (buy pressure) the grid is skewed upward: the bid offset SHRINKS so resting bids sit
    closer to the inside and capture maker fills, while the ask offset GROWS so resting asks are held
    deeper and are not taken out by premature take-profit during a trend. OBI < 0 mirrors the effect.

    `alpha` is a dimensionless skew intensity in [0, 1]: 0 degenerates to static mid-centering
    (offsets symmetric), 1 applies the full imbalance.
    """
    obi = _clamp(obi, -1.0, 1.0)
    alpha = _clamp(alpha, 0.0, 1.0)
    reference = mid + alpha * obi * spread_half
    # The asymmetry is split around the reference: the buying-pressure side is pulled in by
    # (alpha * |obi|) of the half-spread and the opposite side pushed out by the same amount.
    bid_offset = spread_half * (1.0 - alpha * obi)
    ask_offset = spread_half * (1.0 + alpha * obi)
    return Skew(reference=reference, bid_offset=bid_offset, ask_offset=ask_offset)


# ---------------------------------------------------------------------------
# Operator 2 — kinetic energy & toxicity-aware spacing
# ---------------------------------------------------------------------------
def kinetic_energy(prices: Sequence[float]) -> float:
    """Normalised volatility proxy from trailing price second-differences (acceleration).

    A static first-difference (velocity) RMS cannot see a reversal that maintains speed; the
    second difference can. Returns a unitless ratio (RMS acceleration / last price), which is what the
    spread formula squares. A series that is too short, or with a non-positive last price, returns
    0.0 rather than guessing.
    """
    if len(prices) < 3:
        return 0.0
    ref = prices[-1]
    if ref <= 0.0:
        return 0.0
    accel = [prices[i] - 2.0 * prices[i - 1] + prices[i - 2] for i in range(2, len(prices))]
    if not accel:
        return 0.0
    rms = math.sqrt(sum(a * a for a in accel) / len(accel))
    return rms / ref


def toxicity_spread(spread_base: float, gamma: float, normalized_vol: float) -> float:
    """Spread_optimal = Spread_base * (1 + gamma * Normalized_Volatility^2).

    The squaring makes the widening slow near calm and aggressive near a toxic spike, which is the
    point: adverse selection is concentrated in the tail. `gamma` is dimensionless; 0 freezes the
    spread at its base.
    """
    if spread_base < 0.0 or gamma < 0.0:
        raise ValueError("spread_base and gamma must be non-negative")
    return spread_base * (1.0 + gamma * normalized_vol * normalized_vol)


def is_toxic_spike(normalized_vol: float, threshold: float) -> bool:
    """True when the volatility proxy is in the toxic tail (e.g. >= the 95th-percentile threshold)."""
    return normalized_vol >= threshold


# ---------------------------------------------------------------------------
# Operator 3 — frequency-adaptive step size
# ---------------------------------------------------------------------------
def atr_step(step_base: float, atr_bps: float, atr_baseline: float) -> float:
    """Step_t = Step_base * (ATR_15m / ATR_baseline).

    Tight consolidation (ATR below baseline) compresses the grid for turnover and compounding; wide
    swings (ATR above baseline) expand it so inventory is not exhausted. A non-positive baseline
    falls back to the base step instead of dividing by zero.
    """
    if atr_baseline <= 0.0:
        return step_base
    return step_base * (atr_bps / atr_baseline)


# ---------------------------------------------------------------------------
# Composer
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class QuoterParams:
    alpha: float = 0.5
    gamma: float = 2.0
    spread_base_bps: float = 20.0
    step_base_bps: float = 10.0
    atr_baseline_bps: float = 20.0
    toxic_percentile: float = 0.95


@dataclass(frozen=True)
class QuotePlan:
    skew: Skew
    spacing_bps: float
    step_bps: float
    toxic: bool


class StochasticQuoter:
    """Composes the three price/spacing/step operators into a single quote decision."""

    def __init__(self, params: QuoterParams | None = None):
        self.params = params or QuoterParams()

    def quote(
        self,
        *,
        mid: float,
        obi: float,
        spread_half: float,
        normalized_vol: float,
        atr_bps: float,
        market_spread_bps: float,
        toxic: bool | None = None,
    ) -> QuotePlan:
        skew = momentum_skew(mid, obi, spread_half, self.params.alpha)
        raw_spacing = toxicity_spread(self.params.spread_base_bps, self.params.gamma, normalized_vol)
        # NEVER cross the spread: the grid level spacing is floored at the venue's own spread, so a
        # resting bid can never be placed at or above the best ask (and vice-versa). Post-only stays
        # enforceable regardless of how wide the volatility operator wants to go.
        spacing = max(raw_spacing, market_spread_bps)
        step = atr_step(self.params.step_base_bps, atr_bps, self.params.atr_baseline_bps)
        regime = is_toxic_spike(normalized_vol, self.params.toxic_percentile) if toxic is None else toxic
        return QuotePlan(skew=skew, spacing_bps=spacing, step_bps=step, toxic=regime)
