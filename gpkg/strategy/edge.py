"""Fair value, micro-structure edge estimation, and trade feasibility analysis.

Deducts, in basis points, EVERY direct cost of completing a round trip:
  - Exchange fee, charged on BOTH legs (the venue quotes it per side).
  - Bid-ask spread, crossed on entry and on exit.
  - Estimated slippage beyond the quoted touch.
  - Expected carrying cost (funding over the target holding period).
  - Adverse selection.

Only clears the hurdle when net edge >= the configured hurdle, so a trade is refused whenever the
measured edge does not survive its own costs.

The fee leg is the one that matters most and is easy to get wrong: `/v5/account/fee-rate` returns a
PER-SIDE rate, and a completed trade pays it twice. Charging it once understated every round trip by
a full fee unit (~5.5 bps at VIP0 taker) — enough, against a 3 bps hurdle, to admit trades whose true
expectancy was negative. The multiplier is explicit in `fee_round_trip_multiple` so the arithmetic is
reviewable rather than assumed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from gpkg.core.clock import now_ms
from gpkg.core.config import Config
from gpkg.market.state import MarketState


@dataclass
class EdgeEstimate:
    symbol: str
    side: str
    gross_bps: float
    fee_bps: float
    spread_bps: float
    slip_bps: float
    funding_bps: float
    net_bps: float
    tradable: bool
    reason: str
    ts_ms: int
    # Appended with a default so every existing positional construction stays valid. Reported so the
    # cost breakdown is inspectable rather than buried in `net_bps`.
    adverse_bps: float = 0.0


class EdgeEngine:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def evaluate(
        self,
        ms: MarketState,
        side: str,
        one_way_fee_bps: float = 0.0,
        holding_hours: float = 1.0,
        required_notional: float = 0.0,
        *,
        fee_rate_bps: float | None = None,
    ) -> EdgeEstimate:
        effective_fee = fee_rate_bps if fee_rate_bps is not None else one_way_fee_bps
        if not ms.bids or not ms.asks:
            return self._no(ms.symbol, side, "no_book")
        if now_ms() - ms.ts_book_ms > self.cfg.staleness_ms:
            return self._no(ms.symbol, side, "stale_book")
        if now_ms() - ms.ts_tick_ms > self.cfg.staleness_ms:
            return self._no(ms.symbol, side, "stale_tick")
        mid = ms.mid
        if mid <= 0:
            return self._no(ms.symbol, side, "no_mid")

        imb = ms.imbalance(self.cfg.book_levels)
        mom = ms.momentum(self.cfg.momentum_window_s)
        signal = max(-1.0, min(1.0, 0.65 * imb + 0.35 * math.tanh(mom * 500.0)))
        fair = mid * (1.0 + signal * self.cfg.signal_fair_shift_bps / 1e4)
        entry = ms.asks[0][0] if side == "Buy" else ms.bids[0][0]
        gross_bps = ((fair - entry) if side == "Buy" else (entry - fair)) / mid * 1e4
        # `one_way_fee_bps` is the venue's PER-SIDE rate. A round trip pays it on entry and on exit.
        fee_bps = effective_fee * self.cfg.fee_round_trip_multiple
        spread_bps = ms.spread_bps
        if not math.isfinite(spread_bps):
            return self._no(ms.symbol, side, "no_spread")
        if ms.depth_notional(side, self.cfg.book_levels) < required_notional:
            return EdgeEstimate(
                ms.symbol, side, gross_bps, fee_bps, spread_bps, 0.0, 0.0, 0.0, False, "insufficient_depth", now_ms()
            )
        slip_bps = spread_bps * self.cfg.slippage_factor
        funding_bps = abs(ms.funding_rate) * 1e4 * (holding_hours / 8.0)
        # Adverse selection: the cost of being filled because the market was about to move against
        # the resting/aggressing side.
        adverse_bps = spread_bps * self.cfg.adverse_selection_factor
        net = gross_bps - fee_bps - spread_bps - slip_bps - funding_bps - adverse_bps
        ok = net >= self.cfg.edge_hurdle_bps
        return EdgeEstimate(
            ms.symbol,
            side,
            gross_bps,
            fee_bps,
            spread_bps,
            slip_bps,
            funding_bps,
            net,
            ok,
            "clears_hurdle" if ok else f"net_{net:.2f}bps_lt_{self.cfg.edge_hurdle_bps}",
            now_ms(),
            adverse_bps,
        )

    @staticmethod
    def _no(symbol: str, side: str, reason: str) -> EdgeEstimate:
        return EdgeEstimate(symbol, side, 0, 0, 0, 0, 0, 0, False, reason, now_ms())
