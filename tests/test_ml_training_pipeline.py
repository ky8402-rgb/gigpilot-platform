from __future__ import annotations

from gpkg.ml.data import align_point_in_time
from gpkg.ml.lifecycle import CostBreakdown, ModelState, NetTrade, ValidationConfig, evaluate_candidate, PurgedWalkForward


def test_point_in_time_alignment_rejects_future_and_uses_latest_snapshot():
    bars = [{"ts_ms": 100, "close": 10.0}, {"ts_ms": 200, "close": 11.0}]
    books = [
        {"ts_ms": 90, "bid": 9.9, "ask": 10.1},
        {"ts_ms": 210, "bid": 10.9, "ask": 11.1},
    ]
    out = align_point_in_time(bars, books)
    assert [x["book"]["ts_ms"] for x in out] == [90, 90]


def test_strict_oos_gate_records_tstat_and_sharpe():
    trades = [
        NetTrade(30.0, 30.0, CostBreakdown(fees_bps=5.0, spread_bps=2.0, slippage_bps=3.0), i)
        for i in range(40)
    ]
    ev = evaluate_candidate(
        "strict", trades, walk_forward_folds=5, evaluated_at_ms=2000, data_cutoff_ms=1000,
        config=ValidationConfig(
            min_oos_trades=30, min_mean_net_bps=8.0, min_edge_bps=8.0,
            min_t_stat=3.0, min_oos_sharpe=1.5, min_walk_forward_folds=5,
        ),
    )
    assert ev.verified
    assert ev.t_stat > 3.0
    assert ev.oos_sharpe > 1.5
    assert ev.state is ModelState.VALIDATED


def test_strict_oos_gate_rejects_cost_eroded_candidate():
    trades = [
        NetTrade(12.0, 12.0, CostBreakdown(fees_bps=5.5, spread_bps=3.0, slippage_bps=2.0), i)
        for i in range(40)
    ]
    ev = evaluate_candidate(
        "cost-eroded", trades, walk_forward_folds=5, evaluated_at_ms=2000, data_cutoff_ms=1000,
        config=ValidationConfig(
            min_oos_trades=30, min_mean_net_bps=8.0, min_edge_bps=8.0,
            min_t_stat=3.0, min_oos_sharpe=1.5, min_walk_forward_folds=5,
        ),
    )
    assert not ev.verified
    assert "mean_net_bps" in ev.verification_reason


def test_purged_training_requires_five_folds():
    folds = PurgedWalkForward(n_splits=5, min_train=100, test_size=50, purge=5).split(list(range(1, 1000)))
    assert len(folds) == 5
    for train, test in folds:
        assert max(train) + 5 < min(test)
