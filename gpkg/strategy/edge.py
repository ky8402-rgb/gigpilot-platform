"""Fair value, micro-structure edge estimation, and trade feasibility analysis.

Deducts:
  - Exchange taker/maker fee rate.
  - Bid-ask spread.
  - Estimated slippage.
  - Expected carrying cost (funding rate over target holding period).
Only clears hurdle when net edge >= configured hurdle basis points.
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


class EdgeEngine:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def evaluate(
        self,
        ms: MarketState,
        side: str,
        fee_rate_bps: float,
        holding_hours: float,
        required_notional: float,
    ) -> EdgeEstimate:
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
        fee_bps = fee_rate_bps
        spread_bps = ms.spread_bps
        if not math.isfinite(spread_bps):
            return self._no(ms.symbol, side, "no_spread")
        if ms.depth_notional(side, self.cfg.book_levels) < required_notional:
            return EdgeEstimate(
                ms.symbol, side, gross_bps, fee_bps, spread_bps, 0.0, 0.0, 0.0, False, "insufficient_depth", now_ms()
            )
        slip_bps = spread_bps * self.cfg.slippage_factor
        funding_bps = abs(ms.funding_rate) * 1e4 * (holding_hours / 8.0)
        net = gross_bps - fee_bps - spread_bps - slip_bps - funding_bps
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
        )

    @staticmethod
    def _no(symbol: str, side: str, reason: str) -> EdgeEstimate:
        return EdgeEstimate(symbol, side, 0, 0, 0, 0, 0, 0, False, reason, now_ms())
