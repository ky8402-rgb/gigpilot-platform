"""Explicit trading cost model.

The core discipline of this platform: a signal is not a trade. A signal becomes a
trade only when its *expected gross edge* exceeds the *fully loaded round-trip
cost* by the configured hurdle multiple. Most retail futures losses are fee,
spread and funding churn dressed up as strategy — this module exists to make that
arithmetically impossible to ignore.

Cost components, all in basis points of notional:

    entry_fee        taker or maker, per config and routing style
    exit_fee         taker or maker
    entry_slippage   measured from the LIVE order book, not assumed
    exit_slippage    stops are market orders -> taker + worse slippage
    spread           crossing half the bid/ask spread twice (round trip)
    adverse_selection  information leakage of aggressive orders
    funding          real exchange funding rate x expected holding intervals

Costs are charged on notional that is *turned over*, so leverage does not dilute
them — it multiplies them. That is exactly the trap the hurdle is designed to catch.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, Optional

from .exchange import DepthSnapshot, Ticker


@dataclass
class CostEstimate:
    """Round-trip cost breakdown in basis points of notional."""
    entry_fee_bps: float = 0.0
    exit_fee_bps: float = 0.0
    entry_slippage_bps: float = 0.0
    exit_slippage_bps: float = 0.0
    spread_bps: float = 0.0
    adverse_selection_bps: float = 0.0
    funding_bps: float = 0.0

    @property
    def total_bps(self) -> float:
        return (
            self.entry_fee_bps
            + self.exit_fee_bps
            + self.entry_slippage_bps
            + self.exit_slippage_bps
            + self.spread_bps
            + self.adverse_selection_bps
            + self.funding_bps
        )

    def as_dict(self) -> Dict[str, float]:
        d = asdict(self)
        d["total_bps"] = self.total_bps
        return d


def estimate_slippage_bps(
    depth: Optional[DepthSnapshot],
    side: str,
    notional_usd: float,
    fallback_bps: float = 2.0,
) -> float:
    """Walk the real order book to find the volume-weighted price impact.

    `side` is the aggressor: "BUY" consumes asks, "SELL" consumes bids.
    Returns the average fill price's deviation from mid, in bps.
    """
    if depth is None or not depth.bids or not depth.asks:
        return fallback_bps

    levels = depth.asks if side.upper() == "BUY" else depth.bids
    best_bid = depth.bids[0][0]
    best_ask = depth.asks[0][0]
    mid = (best_bid + best_ask) / 2.0
    if mid <= 0:
        return fallback_bps

    remaining = max(notional_usd, 0.0)
    filled_notional = 0.0
    filled_qty = 0.0
    for price, qty in levels:
        level_notional = price * qty
        take = min(remaining, level_notional)
        if take <= 0:
            break
        qty_taken = take / price
        filled_notional += take
        filled_qty += qty_taken
        remaining -= take
        if remaining <= 1e-9:
            break

    if filled_qty <= 0:
        return fallback_bps
    vwap = filled_notional / filled_qty
    # Signed adverse impact.
    impact_bps = abs(vwap - mid) / mid * 10_000.0

    # If the book was thinner than our order we would walk it destructively.
    if remaining > 0:
        unfilled_frac = remaining / max(notional_usd, 1e-9)
        impact_bps *= 1.0 + 2.0 * unfilled_frac

    return float(impact_bps)


class CostModel:
    """Builds a full round-trip cost estimate for a prospective trade."""

    def __init__(self, cfg):
        self.cfg = cfg.costs
        self.risk = cfg.risk

    def funding_bps(
        self, funding_rate: float, expected_holding_hours: float, side: str,
        funding_interval_hours: float = 8.0,
    ) -> float:
        """Funding is paid on notional every settlement interval.

        The interval is a parameter, not a constant: Binance USDT-perps settle every
        8h, but Bybit varies it per symbol, and assuming 8h where the venue settles
        hourly under-charges funding by 8x.

        We charge the *adverse* amount: for a long, positive funding is a cost;
        for a short, negative funding is a cost. We also assume it can be paid in
        both directions over a multi-day hold rather than netting to zero, because
        hoping for the offsetting sign is not a risk control.
        """
        period = float(funding_interval_hours or 8.0)
        if period <= 0:
            period = 8.0
        intervals = max(expected_holding_hours / period, 0.0)
        if intervals <= 0:
            return 0.0
        rate = float(funding_rate or 0.0)
        cost = 0.0
        if side.upper() == "BUY":
            cost = max(rate, 0.0) * intervals
        else:
            cost = max(-rate, 0.0) * intervals
        # A baseline charge even when the current sign is favourable: funding
        # flips, and a strategy that only works while funding happens to favour
        # us has no edge, only luck.
        baseline = abs(rate) * 0.25 * intervals
        return (cost + baseline) * 10_000.0

    def round_trip(
        self,
        *,
        ticker: Ticker,
        depth: Optional[DepthSnapshot] = None,
        notional_usd: float,
        expected_holding_hours: float,
        entry_is_taker: Optional[bool] = None,
        exit_is_taker: Optional[bool] = None,
        entry_side: str = "BUY",
    ) -> CostEstimate:
        c = self.cfg
        entry_taker = c.assume_taker_entry if entry_is_taker is None else entry_is_taker
        exit_taker = c.assume_taker_exit_on_stop if exit_is_taker is None else exit_is_taker

        est = CostEstimate()
        est.entry_fee_bps = c.taker_fee_bps if entry_taker else c.maker_fee_bps
        est.exit_fee_bps = c.taker_fee_bps if exit_taker else c.maker_fee_bps

        est.entry_slippage_bps = estimate_slippage_bps(
            depth, entry_side, notional_usd, c.fallback_slippage_bps
        )
        exit_side = "SELL" if entry_side.upper() == "BUY" else "BUY"
        exit_slip = estimate_slippage_bps(
            depth, exit_side, notional_usd, c.fallback_slippage_bps
        )
        # Stops are triggered into a moving market: impact is worse than a
        # passive walk of the current book.
        est.exit_slippage_bps = exit_slip * (1.6 if exit_taker else 1.0)

        # Half-spread crossed on entry and again on exit.
        live_spread = depth.spread_bps() if depth is not None else ticker.spread_bps
        est.spread_bps = live_spread  # 0.5 + 0.5

        est.adverse_selection_bps = c.adverse_selection_bps if entry_taker else 0.0
        est.funding_bps = self.funding_bps(
            ticker.funding_rate, expected_holding_hours, entry_side,
            getattr(ticker, "funding_interval_hours", 8.0) or 8.0,
        )
        return est

    def hurdle_bps(self, cost: CostEstimate) -> float:
        """Minimum gross edge required to justify the trade."""
        return max(cost.total_bps * self.cfg.hurdle_multiplier, self.cfg.min_edge_bps)

    def clears_hurdle(self, expected_gross_edge_bps: float, cost: CostEstimate) -> tuple[bool, float, str]:
        """Returns (passes, shortfall_bps, human_reason)."""
        total = cost.total_bps
        hurdle = self.hurdle_bps(cost)
        net = expected_gross_edge_bps - total
        if expected_gross_edge_bps >= hurdle:
            return True, 0.0, (
                f"gross {expected_gross_edge_bps:.1f}bps >= hurdle {hurdle:.1f}bps "
                f"(net {net:.1f}bps after {total:.1f}bps cost)"
            )
        return False, hurdle - expected_gross_edge_bps, (
            f"REJECT: gross {expected_gross_edge_bps:.1f}bps < hurdle {hurdle:.1f}bps "
            f"| cost {total:.1f}bps (fees {cost.entry_fee_bps + cost.exit_fee_bps:.1f}, "
            f"slip {cost.entry_slippage_bps + cost.exit_slippage_bps:.1f}, "
            f"spread {cost.spread_bps:.1f}, funding {cost.funding_bps:.1f}) "
            f"| net {net:.1f}bps"
        )

    def snapshot(self) -> Dict[str, Any]:
        return {
            "maker_fee_bps": self.cfg.maker_fee_bps,
            "taker_fee_bps": self.cfg.taker_fee_bps,
            "hurdle_multiplier": self.cfg.hurdle_multiplier,
            "min_edge_bps": self.cfg.min_edge_bps,
            "fallback_slippage_bps": self.cfg.fallback_slippage_bps,
            "adverse_selection_bps": self.cfg.adverse_selection_bps,
        }
