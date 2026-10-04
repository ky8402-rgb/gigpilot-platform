"""Leakage-safe online ML runtime primitives.

These components are deliberately model-agnostic. They transform only information available at
decision time and consume predictions from separately validated artifacts. Nothing here may promote
or authorize an unverified model; final capital authorization remains in lifecycle.authorize_prediction.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from math import exp, isfinite, log, sqrt
from typing import Sequence

from gpkg.market.state import MarketState
from .lifecycle import ModelEvidence, ModelState, TradingAuthorization


class Regime(str, Enum):
    QUIET = "quiet"
    TRENDING = "trending"
    HIGH_VOL = "high_vol"
    ILLIQUID = "illiquid"


@dataclass(frozen=True)
class FeatureVector:
    ts_ms: int
    symbol: str
    mid: float
    spread_bps: float
    imbalance: float
    momentum_bps: float
    atr_bps: float
    funding_bps_8h: float
    basis_bps: float
    bid_depth: float
    ask_depth: float

    def as_model_inputs(self) -> tuple[float, ...]:
        return (
            self.spread_bps, self.imbalance, self.momentum_bps, self.atr_bps,
            self.funding_bps_8h, self.basis_bps, self.bid_depth, self.ask_depth,
        )


def extract_features(ms: MarketState, *, ts_ms: int, levels: int, momentum_window_s: int,
                     max_staleness_ms: int | None = None) -> FeatureVector:
    """Point-in-time feature extraction with explicit anti-leakage checks.

    The feature timestamp is authoritative. Market snapshots stamped after it are refused, and trade
    momentum is computed only from prints at or before it. This makes the same function safe for
    live shadow inference and historical walk-forward replay.
    """
    if ts_ms <= 0:
        raise ValueError("decision timestamp must be positive")
    for name, source_ts in (("book", ms.ts_book_ms), ("ticker", ms.ts_tick_ms)):
        if source_ts > ts_ms:
            raise ValueError(f"future {name} state would leak into decision")
        if max_staleness_ms is not None and source_ts > 0 and ts_ms - source_ts > max_staleness_ms:
            raise ValueError(f"stale {name} state")
    mid = ms.mid
    if mid <= 0 or not ms.bids or not ms.asks:
        raise ValueError("market state is not feature-ready")
    spread = ms.spread_bps
    if not isfinite(spread):
        raise ValueError("non-finite spread")
    mark = ms.mark if ms.mark > 0 else mid
    index = ms.index if ms.index > 0 else mid
    basis = (mark - index) / index * 1e4 if index > 0 else 0.0
    bid_depth = sum(p * q for p, q in ms.bids[:levels])
    ask_depth = sum(p * q for p, q in ms.asks[:levels])
    cutoff = ts_ms - momentum_window_s * 1000
    prints = [t for t in ms.trades if cutoff <= t[0] <= ts_ms]
    if len(prints) >= 5 and prints[0][1] > 0:
        momentum_bps = log(prints[-1][1] / prints[0][1]) * 1e4
    else:
        momentum_bps = 0.0
    return FeatureVector(
        ts_ms=ts_ms,
        symbol=ms.symbol,
        mid=mid,
        spread_bps=spread,
        imbalance=ms.imbalance(levels),
        momentum_bps=momentum_bps,
        atr_bps=ms.atr_bps(max(2, min(50, len(ms.closes_1m) - 1))) if len(ms.closes_1m) >= 3 else 20.0,
        funding_bps_8h=ms.funding_rate * 1e4,
        basis_bps=basis,
        bid_depth=bid_depth,
        ask_depth=ask_depth,
    )


def detect_regime(features: FeatureVector, *, high_vol_bps: float = 35.0,
                  illiquid_spread_bps: float = 8.0, trend_bps: float = 8.0) -> Regime:
    if features.spread_bps >= illiquid_spread_bps or min(features.bid_depth, features.ask_depth) <= 0:
        return Regime.ILLIQUID
    if features.atr_bps >= high_vol_bps:
        return Regime.HIGH_VOL
    if abs(features.momentum_bps) >= trend_bps:
        return Regime.TRENDING
    return Regime.QUIET


class EwmaVolatilityForecaster:
    """Online one-step volatility forecast using only returns observed before the decision."""

    def __init__(self, decay: float = 0.94):
        if not 0.0 < decay < 1.0:
            raise ValueError("decay must be in (0,1)")
        self.decay = decay
        self._variance = 0.0
        self._last_price: float | None = None
        self.observations = 0

    def update(self, price: float) -> float:
        if not isfinite(price) or price <= 0:
            raise ValueError("price must be positive finite")
        if self._last_price is not None:
            r = log(price / self._last_price)
            self._variance = self.decay * self._variance + (1.0 - self.decay) * r * r
            self.observations += 1
        self._last_price = price
        return self.forecast_bps

    @property
    def forecast_bps(self) -> float:
        return sqrt(max(self._variance, 0.0)) * 1e4


def book_impact_bps(ms: MarketState, side: str, qty: float) -> float:
    """Deterministic market-impact/slippage forecast from current executable L2 depth."""
    if qty <= 0 or ms.mid <= 0:
        raise ValueError("invalid quantity or book")
    book = ms.asks if side == "Buy" else ms.bids
    remaining = qty
    notional = 0.0
    filled = 0.0
    for price, size in book:
        take = min(remaining, size)
        notional += take * price
        filled += take
        remaining -= take
        if remaining <= 1e-12:
            break
    if remaining > 1e-12 or filled <= 0:
        return float("inf")
    vwap = notional / filled
    touch = ms.asks[0][0] if side == "Buy" else ms.bids[0][0]
    move = vwap - touch if side == "Buy" else touch - vwap
    return max(0.0, move / ms.mid * 1e4)


class ImpactResidualForecaster:
    """Learns an EWMA residual between quoted-book impact and realized slippage."""

    def __init__(self, decay: float = 0.9):
        if not 0.0 < decay < 1.0:
            raise ValueError("decay must be in (0,1)")
        self.decay = decay
        self.residual_bps = 0.0
        self.observations = 0

    def update(self, predicted_bps: float, realized_bps: float) -> None:
        if not all(isfinite(x) and x >= 0 for x in (predicted_bps, realized_bps)):
            raise ValueError("impact observations must be non-negative finite")
        residual = realized_bps - predicted_bps
        self.residual_bps = self.decay * self.residual_bps + (1.0 - self.decay) * residual
        self.observations += 1

    def forecast(self, book_bps: float) -> float:
        if not isfinite(book_bps):
            return book_bps
        return max(0.0, book_bps + self.residual_bps)


@dataclass(frozen=True)
class Prediction:
    model_id: str
    gross_edge_bps: float
    probability_positive: float
    confidence: float
    volatility_bps: float
    impact_bps: float
    expected_holding_hours: float
    regime: Regime

    def __post_init__(self):
        if not 0.0 <= self.probability_positive <= 1.0:
            raise ValueError("probability_positive must be in [0,1]")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be in [0,1]")
        if self.volatility_bps < 0 or self.impact_bps < 0:
            raise ValueError("forecast costs/volatility cannot be negative")


@dataclass(frozen=True)
class StrategyCandidate:
    strategy_id: str
    evidence: ModelEvidence
    regime: Regime | None = None


def select_verified_strategy(candidates: Sequence[StrategyCandidate], regime: Regime) -> StrategyCandidate | None:
    """Adaptive selection using only verified live-eligible candidates; otherwise DO NOTHING."""
    eligible = [
        c for c in candidates
        if c.evidence.verified
        and c.evidence.state in (ModelState.CANARY, ModelState.CHAMPION)
        and (c.regime is None or c.regime is regime)
    ]
    if not eligible:
        return None
    return max(eligible, key=lambda c: (c.evidence.mean_net_bps, c.evidence.total_net_bps))


def confidence_probability_score(probability_positive: float, calibration_error: float) -> float:
    """Conservative confidence score: calibrated probability edge penalized by known calibration error."""
    if not 0.0 <= probability_positive <= 1.0 or calibration_error < 0:
        raise ValueError("invalid probability/calibration error")
    directional = abs(probability_positive - 0.5) * 2.0
    return max(0.0, min(1.0, directional - calibration_error))


def position_notional(
    authorization: TradingAuthorization,
    *,
    equity: float,
    confidence: float,
    volatility_bps: float,
    max_risk_fraction: float,
    max_notional_fraction: float,
) -> float:
    """Volatility/confidence scaled notional. Any denied authorization produces exactly zero."""
    if not authorization.allowed or equity <= 0:
        return 0.0
    if not (0.0 <= confidence <= 1.0):
        return 0.0
    if volatility_bps <= 0 or max_risk_fraction <= 0 or max_notional_fraction <= 0:
        return 0.0
    risk_budget = equity * min(max_risk_fraction, 1.0) * confidence
    # volatility_bps/1e4 approximates one-sigma fractional move; size so that move consumes risk budget.
    vol_fraction = volatility_bps / 1e4
    vol_limited = risk_budget / vol_fraction
    hard_cap = equity * min(max_notional_fraction, 10.0)
    return max(0.0, min(vol_limited, hard_cap))
