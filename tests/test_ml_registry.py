from __future__ import annotations

import pytest

from gpkg.core.metrics import Metrics
from gpkg.ml.lifecycle import (
    CostBreakdown,
    DriftReport,
    ModelEvidence,
    ModelState,
    NetTrade,
    ValidationConfig,
)
from gpkg.ml.registry import ModelRegistry
from gpkg.persistence.store import Store


def ev(model="m1", state=ModelState.VALIDATED, verified=True, mean=4.0) -> ModelEvidence:
    return ModelEvidence(
        model_id=model,
        state=state,
        oos_trades=50,
        walk_forward_folds=5,
        mean_net_bps=mean,
        total_net_bps=200.0,
        profit_factor=1.4,
        max_drawdown_bps=50.0,
        one_sided_p_value=.01,
        verified=verified,
        verification_reason="verified" if verified else "failed",
        evaluated_at_ms=2000,
        data_cutoff_ms=1000,
    )


def trade(net: float, ts: int) -> NetTrade:
    return NetTrade(net, net, CostBreakdown(), ts)


def test_registry_persists_restart_safe_evidence_and_audit(tmp_path):
    path = str(tmp_path / "models.db")
    s1 = Store(path)
    r1 = ModelRegistry(s1)
    r1.persist_evidence(ev(), reason="walk_forward_oos")

    s2 = Store(path)
    r2 = ModelRegistry(s2)
    loaded = r2.get("m1")
    assert loaded is not None and loaded.verified
    assert loaded.state is ModelState.VALIDATED

    events = s2.ml_events("m1")
    assert events[0]["to_state"] == "VALIDATED"
    assert events[0]["reason"] == "walk_forward_oos"


def test_unverified_evidence_can_never_enter_live_or_validated_state(tmp_path):
    reg = ModelRegistry(Store(str(tmp_path / "m.db")))
    with pytest.raises(ValueError, match="unverified"):
        reg.persist_evidence(ev(state=ModelState.VALIDATED, verified=False))

    research = ev(state=ModelState.RESEARCH, verified=False)
    reg.persist_evidence(research)
    with pytest.raises(ValueError, match="unverified"):
        reg.transition("m1", ModelState.PAPER, reason="should fail")


def test_paper_and_canary_stages_are_mandatory(tmp_path):
    reg = ModelRegistry(Store(str(tmp_path / "m.db")))
    reg.persist_evidence(ev())
    with pytest.raises(ValueError, match="illegal|PAPER"):
        reg.transition("m1", ModelState.CANARY, reason="skip")
    reg.transition("m1", ModelState.PAPER, reason="paper passed")
    with pytest.raises(ValueError, match="illegal|CANARY"):
        reg.transition("m1", ModelState.CHAMPION, reason="skip")
    reg.transition("m1", ModelState.CANARY, reason="paper passed")
    champion = reg.transition("m1", ModelState.CHAMPION, reason="canary beat champion")
    assert champion.state is ModelState.CHAMPION
    assert reg.live_eligible("m1") is not None


def test_automatic_rollback_is_durable_and_removes_live_eligibility(tmp_path):
    metrics = Metrics()
    reg = ModelRegistry(Store(str(tmp_path / "m.db")), metrics)
    reg.persist_evidence(ev())
    reg.transition("m1", ModelState.PAPER, reason="paper")
    reg.transition("m1", ModelState.CANARY, reason="canary")

    rolled, _reason, current = reg.rollback_if_needed(
        "m1",
        [trade(-2.0, i) for i in range(30)],
        DriftReport(0.01, False, "stable"),
        config=ValidationConfig(min_live_observations=20, rollback_live_mean_net_bps=0.0),
    )
    assert rolled
    assert current.state is ModelState.ROLLED_BACK
    assert reg.live_eligible("m1") is None
    assert 'gigpilot_ml_rollbacks_total{model="m1"} 1.0' in metrics.render()

    reloaded = ModelRegistry(Store(str(tmp_path / "m.db"))).get("m1")
    assert reloaded is not None and reloaded.state is ModelState.ROLLED_BACK


def test_drift_forces_immediate_rollback_even_before_pnl_sample_threshold(tmp_path):
    reg = ModelRegistry(Store(str(tmp_path / "m.db")))
    reg.persist_evidence(ev())
    reg.transition("m1", ModelState.PAPER, reason="paper")
    reg.transition("m1", ModelState.CANARY, reason="canary")

    rolled, reason, state = reg.rollback_if_needed(
        "m1", [], DriftReport(.4, True, "psi=.4"),
    )
    assert rolled
    assert "drift" in reason
    assert state.state is ModelState.ROLLED_BACK


def test_optimistic_transition_guard_rejects_stale_writer(tmp_path):
    store = Store(str(tmp_path / "m.db"))
    reg = ModelRegistry(store)
    reg.persist_evidence(ev())
    # Simulate a concurrent lifecycle worker changing the state first.
    reg.transition("m1", ModelState.PAPER, reason="worker A")
    with pytest.raises(RuntimeError, match="stale ML transition"):
        store.ml_upsert_evidence(
            "m1", "CANARY", True, {"model_id": "m1"},
            reason="stale worker B", expected_from_state="VALIDATED",
        )
