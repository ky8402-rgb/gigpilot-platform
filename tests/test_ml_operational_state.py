from __future__ import annotations

from gigpilot import GigPilot
from gpkg.core.config import Config
from gpkg.ml.lifecycle import ModelEvidence, ModelState


def evidence() -> ModelEvidence:
    return ModelEvidence(
        "shadow-v1", ModelState.VALIDATED, 40, 4, 2.5, 100.0, 1.2, 50.0, .02,
        True, "verified_oos_net_edge", 2000, 1000,
    )


def test_authenticated_state_snapshot_discloses_explicit_ml_no_trade_status(tmp_path):
    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"], db_path=str(tmp_path / "s.db"))
    gp = GigPilot(cfg)
    snap = gp.snapshot()
    assert snap["ml"]["models"] == []
    assert snap["ml"]["live_eligible_count"] == 0


def test_snapshot_reports_persisted_model_but_not_live_eligible_before_canary(tmp_path):
    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"], db_path=str(tmp_path / "s.db"))
    gp = GigPilot(cfg)
    gp.model_registry.persist_evidence(evidence())
    snap = gp.snapshot()
    assert snap["ml"]["models"][0]["model_id"] == "shadow-v1"
    assert snap["ml"]["models"][0]["state"] == "VALIDATED"
    assert snap["ml"]["models"][0]["live_eligible"] is False
    assert snap["ml"]["live_eligible_count"] == 0
    assert snap["ml"]["recent_events"][0]["to_state"] == "VALIDATED"
