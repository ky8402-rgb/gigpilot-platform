from __future__ import annotations

from collections import deque

import pytest

from gpkg.market.state import MarketState
from gpkg.ml.lifecycle import ModelEvidence, ModelState, TradingAuthorization
from gpkg.ml.runtime import (
    EwmaVolatilityForecaster, ImpactResidualForecaster, Regime, StrategyCandidate,
    book_impact_bps, confidence_probability_score, detect_regime, extract_features,
    position_notional, select_verified_strategy,
)


def market() -> MarketState:
    m = MarketState("BTCUSDT")
    m.bids = [(100.0, 1.0), (99.9, 2.0)]
    m.asks = [(100.1, 1.0), (100.2, 2.0)]
    m.mark = 100.05
    m.index = 100.0
    m.funding_rate = 0.0001
    m.closes_1m = deque([100 + i * .01 for i in range(30)], maxlen=200)
    m.trades = deque([(1, 100.0), (2, 100.01), (3, 100.02), (4, 100.03), (5, 100.04)], maxlen=512)
    return m


def evidence(model_id: str, mean_net: float, state=ModelState.CANARY, verified=True):
    return ModelEvidence(model_id, state, 50, 5, mean_net, mean_net * 50, 1.2, 20.0, .01,
                         verified, "ok" if verified else "no", 200, 100)


def test_feature_extraction_is_point_in_time_and_regime_is_deterministic(monkeypatch):
    m = market()
    monkeypatch.setattr("gpkg.market.state.now_ms", lambda: 5_000)
    f = extract_features(m, ts_ms=5_000, levels=2, momentum_window_s=10)
    assert f.symbol == "BTCUSDT"
    assert f.spread_bps > 0
    assert detect_regime(f, high_vol_bps=10_000, trend_bps=10_000) is Regime.QUIET


def test_book_impact_uses_executable_side_and_refuses_insufficient_depth():
    m = market()
    assert book_impact_bps(m, "Buy", 2.0) > 0
    assert book_impact_bps(m, "Sell", 2.0) > 0
    assert book_impact_bps(m, "Buy", 99.0) == float("inf")


def test_online_forecasts_use_only_prior_observations():
    v = EwmaVolatilityForecaster()
    assert v.update(100.0) == 0
    assert v.update(101.0) > 0
    imp = ImpactResidualForecaster(decay=.5)
    imp.update(2.0, 4.0)
    assert imp.forecast(2.0) == pytest.approx(3.0)


def test_strategy_selection_never_selects_unverified_or_research_model():
    bad = StrategyCandidate("bad", evidence("bad", 100, verified=False))
    research = StrategyCandidate("research", evidence("research", 100, state=ModelState.RESEARCH))
    good = StrategyCandidate("good", evidence("good", 3))
    better = StrategyCandidate("better", evidence("better", 5), Regime.QUIET)
    assert select_verified_strategy([bad, research], Regime.QUIET) is None
    assert select_verified_strategy([good, better], Regime.QUIET).strategy_id == "better"


def test_probability_confidence_is_penalized_by_calibration_error():
    assert confidence_probability_score(.8, .1) == pytest.approx(.5)
    assert confidence_probability_score(.52, .2) == 0.0


def test_position_sizing_is_zero_on_denied_trade_and_capped_when_allowed():
    denied = TradingAuthorization(False, "no", -1, None)
    assert position_notional(denied, equity=1000, confidence=1, volatility_bps=100,
                             max_risk_fraction=.01, max_notional_fraction=2) == 0
    allowed = TradingAuthorization(True, "ok", 5, "m")
    n = position_notional(allowed, equity=1000, confidence=.5, volatility_bps=100,
                          max_risk_fraction=.01, max_notional_fraction=2)
    assert 0 < n <= 2000
