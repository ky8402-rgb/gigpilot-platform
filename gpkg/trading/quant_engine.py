"""The quantitative quoting engine.

`QuantEngine` was an alias for `EdgeEngine`; it is now a real facade over the stochastic quoting
operators (`gpkg.strategy.operators`) and the capital-velocity sizer (`gpkg.risk.allocation`). The
edge engine remains the cost/feasibility authority, and the executor remains the exchange-safety
authority — this facade is the piece that turns market microstructure into a dynamic, maker-only
quote plan and a step-aligned order size.
"""
from __future__ import annotations

from gpkg.risk.allocation import Sizing, fractional_kelly, size_order_qty
from gpkg.strategy.operators import (
    QuotePlan,
    QuoterParams,
    StochasticQuoter,
)


class QuantEngine(StochasticQuoter):
    """Stochastic quoting engine: dynamic price skew, volatility-scaled spacing, Kelly sizing."""

    def __init__(self, params: QuoterParams | None = None, *, kelly_fraction: float = 0.25):
        super().__init__(params)
        self.kelly_fraction = kelly_fraction

    def size(
        self,
        *,
        equity: float,
        win_rate: float,
        payoff_ratio: float,
        price: float,
        step_size: float,
        min_qty: float,
    ) -> Sizing:
        kelly = fractional_kelly(win_rate, payoff_ratio, self.kelly_fraction)
        return size_order_qty(equity, kelly, price, step_size, min_qty)


__all__ = ["QuantEngine", "QuotePlan", "QuoterParams", "Sizing", "StochasticQuoter"]
