"""The quantitative quoting engine.

`QuantEngine` was an alias for `EdgeEngine`; it is now a real facade over the stochastic quoting
operators (`gpkg.strategy.operators`) and the capital-velocity sizer (`gpkg.risk.allocation`). The
edge engine remains the cost/feasibility authority, and the executor remains the exchange-safety
authority — this facade is the piece that turns market microstructure into a dynamic, maker-only
quote plan and a step-aligned order size.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from gpkg.risk.allocation import Sizing, fractional_kelly, size_order_qty
from gpkg.strategy.operators import (
    QuotePlan,
    QuoterParams,
    StochasticQuoter,
    kinetic_energy,
)

#: Trailing look-back (in 1-minute bars) for the ATR that drives the adaptive grid-step operator.
#: The task specifies 15 minutes; `MarketState.atr_bps(period)` needs `period + 1` closes.
ATR_STEP_PERIOD = 15


@dataclass(frozen=True)
class QuantDecision:
    """The composed quoting decision, or a fail-closed refusal.

    `reason == ""` means the inputs were fresh and complete enough to price; any other value is the
    named reason the entry path refused. `plan is None` is exactly equivalent to `reason != ""`.
    """

    reason: str = ""
    plan: QuotePlan | None = None
    obi: float = 0.0
    vpin: float | None = None
    atr_bps: float = 0.0
    kinetic: float = 0.0
    toxic: bool = False
    skew_bid: float = 0.0
    skew_ask: float = 0.0

    @property
    def admissible(self) -> bool:
        return self.reason == "" and self.plan is not None

    @classmethod
    def denied(cls, reason: str) -> QuantDecision:
        return cls(reason=reason)


class QuantEngine(StochasticQuoter):
    """Stochastic quoting engine: dynamic price skew, volatility-scaled spacing, Kelly sizing."""

    def __init__(self, params: QuoterParams | None = None, *, kelly_fraction: float = 0.25):
        super().__init__(params)
        self.kelly_fraction = kelly_fraction

    def decide(
        self,
        *,
        mid: float,
        obi: float | None,
        vpin: float | None,
        atr_bps: float | None,
        prices: Sequence[float],
        market_spread_bps: float,
        spread_half: float,
    ) -> QuantDecision:
        """Compose live microstructure into a quote plan, refusing (fail-closed) on missing inputs.

        The three inputs that a quote cannot be priced without — OBI, VPIN, ATR — are validated here
        rather than at the caller, so every caller gets the same refusal semantics. Kinetic energy is
        derived from the trailing price series and widens the spacing through `toxicity_spread`; the
        `toxic` flag marks a kinetic spike, which the caller surfaces as "widen/hold off".
        """
        if obi is None or not math.isfinite(obi):
            return QuantDecision.denied("no_obi")
        if vpin is None or not math.isfinite(vpin):
            return QuantDecision.denied("no_vpin")
        if atr_bps is None or not math.isfinite(atr_bps) or atr_bps <= 0.0:
            return QuantDecision.denied("no_atr")
        if mid <= 0.0 or spread_half <= 0.0 or not math.isfinite(market_spread_bps):
            return QuantDecision.denied("no_quote_reference")

        kinetic = kinetic_energy(list(prices))
        plan = self.quote(
            mid=mid,
            obi=obi,
            spread_half=spread_half,
            normalized_vol=kinetic,
            atr_bps=atr_bps,
            market_spread_bps=market_spread_bps,
        )
        return QuantDecision(
            plan=plan,
            obi=obi,
            vpin=vpin,
            atr_bps=atr_bps,
            kinetic=kinetic,
            toxic=plan.toxic,
            skew_bid=plan.skew.nearest_bid,
            skew_ask=plan.skew.nearest_ask,
        )

    def size(
        self,
        *,
        equity: float,
        win_rate: float,
        payoff_ratio: float,
        price: float,
        step_size: float,
        min_qty: float,
        snap_to_min: bool = True,
    ) -> Sizing:
        kelly = fractional_kelly(win_rate, payoff_ratio, self.kelly_fraction)
        return size_order_qty(equity, kelly, price, step_size, min_qty, snap_to_min=snap_to_min)


__all__ = ["ATR_STEP_PERIOD", "QuantDecision", "QuantEngine", "QuotePlan", "QuoterParams",
           "Sizing", "StochasticQuoter"]
