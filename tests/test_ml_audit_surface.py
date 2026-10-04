from gpkg.ml.audit import normalize_audit


def test_normalize_audit_preserves_statistical_gate_and_cost_breakdown():
    row = normalize_audit({
        "ts_ms": 123,
        "model_id": "funding-btc",
        "outcome": "REJECTED",
        "reason": "t_stat 2.1 <= 3.0",
        "payload": {
            "family": "funding_rate_carry_reversion",
            "gross_edge_bps": 19.5,
            "cost_deductions": {
                "fees_bps": 11.0,
                "two_x_peak_spread_bps": 4.0,
                "modeled_impact_bps": 2.5,
                "total_friction_bps": 17.5,
            },
            "net_edge_bps": 2.0,
            "t_stat": 2.1,
            "oos_sharpe": 0.9,
            "gate_outcome": False,
            "gate_thresholds": {"net_edge_bps": 8.0, "t_stat": 3.0, "oos_sharpe": 1.5},
        },
    })
    assert row["model_family"] == "funding_rate_carry_reversion"
    assert row["gross_edge_bps"] == 19.5
    assert row["cost_deductions"]["total_friction_bps"] == 17.5
    assert row["net_edge_bps"] == 2.0
    assert row["t_stat"] == 2.1
    assert row["oos_sharpe"] == 0.9
    assert row["gate_outcome"] is False
    assert row["gate_thresholds"]["net_edge_bps"] == 8.0
    assert row["gate_failures"] == ["t_stat 2.1 <= 3.0"]


def test_normalize_audit_adds_total_friction_for_legacy_records():
    row = normalize_audit({
        "ts_ms": 1,
        "model_id": "legacy",
        "outcome": "REJECTED",
        "reason": "insufficient data",
        "payload": {
            "cost_deductions": {
                "fees_bps": 11.0,
                "two_x_peak_spread_bps": 3.0,
                "modeled_impact_bps": 2.0,
            }
        },
    })
    assert row["cost_deductions"]["total_friction_bps"] == 16.0
    assert row["gate_outcome"] is False
