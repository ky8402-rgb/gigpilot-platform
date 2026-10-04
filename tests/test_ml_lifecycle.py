from __future__ import annotations

import pytest

from gpkg.ml.lifecycle import (
    CostBreakdown,
    ModelState,
    NetTrade,
    PurgedWalkForward,
    ValidationConfig,
    authorize_prediction,
    evaluate_candidate,
    population_stability_index,
    promote_challenger,
    should_rollback,
)


def trade(net_gross: float, ts: int, costs: float = 1.0) -> NetTrade:
    return NetTrade(
        gross_edge_bps=net_gross,
        realised_gross_pnl_bps=net_gross,
        costs=CostBreakdown(fees_bps=costs),
        timestamp_ms=ts,
    )


def verified_evidence():
    # Stable positive OOS distribution: post-cost +4 bps each.
    trades = [trade(5.0, i + 1, 1.0) for i in range(40)]
    return evaluate_candidate(
        "candidate-v1", trades, walk_forward_folds=5,
        evaluated_at_ms=1000, data_cutoff_ms=100,
        config=ValidationConfig(min_oos_trades=30),
    )


def test_no_verified_model_can_never_authorize_real_capital():
    auth = authorize_prediction(
        evidence=None, state=ModelState.CHAMPION, predicted_gross_edge_bps=50,
        costs=CostBreakdown(), confidence=1.0, min_confidence=0.5, risk_hurdle_bps=1.0,
    )
    assert not auth.allowed
    assert "no verified model evidence" in auth.reason


def test_verified_model_still_requires_canary_or_champion_state():
    ev = verified_evidence()
    assert ev.verified
    auth = authorize_prediction(
        evidence=ev, state=ModelState.VALIDATED, predicted_gross_edge_bps=50,
        costs=CostBreakdown(), confidence=1.0, min_confidence=0.5, risk_hurdle_bps=1.0,
    )
    assert not auth.allowed


def test_post_cost_edge_not_accuracy_is_the_live_gate():
    ev = verified_evidence()
    costs = CostBreakdown(
        fees_bps=3, funding_bps=1, spread_bps=2, slippage_bps=2, adverse_selection_bps=1
    )
    blocked = authorize_prediction(
        evidence=ev, state=ModelState.CANARY, predicted_gross_edge_bps=10,
        costs=costs, confidence=0.99, min_confidence=0.6, risk_hurdle_bps=2.0,
    )
    assert not blocked.allowed
    assert blocked.expected_net_edge_bps == pytest.approx(1.0)

    allowed = authorize_prediction(
        evidence=ev, state=ModelState.CANARY, predicted_gross_edge_bps=13,
        costs=costs, confidence=0.99, min_confidence=0.6, risk_hurdle_bps=2.0,
    )
    assert allowed.allowed
    assert allowed.expected_net_edge_bps == pytest.approx(4.0)


def test_future_oos_row_is_rejected_as_leakage():
    with pytest.raises(ValueError, match="future trade"):
        evaluate_candidate(
            "leaky", [trade(5, 101)], walk_forward_folds=5,
            evaluated_at_ms=200, data_cutoff_ms=100,
        )


def test_purged_walk_forward_has_strict_time_order_and_gap():
    ts = list(range(1, 501))
    folds = PurgedWalkForward(n_splits=3, min_train=100, test_size=50, purge=5).split(ts)
    assert len(folds) == 3
    for train, test in folds:
        assert max(train) + 5 < min(test)
        assert max(ts[i] for i in train) < min(ts[i] for i in test)

    with pytest.raises(ValueError, match="strictly increasing"):
        PurgedWalkForward().split([1, 2, 2, 3] * 100)


def test_verified_challenger_can_only_advance_to_paper_first():
    ev = verified_evidence()
    decision = promote_challenger(ev, None)
    assert decision.allowed
    assert decision.target_state is ModelState.PAPER
    assert "paper" in decision.reason.lower()


def test_drift_blocks_trade_and_triggers_rollback():
    ev = verified_evidence()
    drift = population_stability_index(
        [float(i) for i in range(100)],
        [1000.0 + float(i) for i in range(100)],
        bins=10,
    )
    assert drift.drifted
    auth = authorize_prediction(
        evidence=ev, state=ModelState.CANARY, predicted_gross_edge_bps=20,
        costs=CostBreakdown(fees_bps=1), confidence=0.9, min_confidence=0.5,
        risk_hurdle_bps=2, drift=drift,
    )
    assert not auth.allowed

    rollback, reason = should_rollback(
        type(ev)(**{**ev.__dict__, "state": ModelState.CANARY}),
        [trade(5.0, i + 1) for i in range(30)],
        drift,
    )
    assert rollback
    assert "drift" in reason
