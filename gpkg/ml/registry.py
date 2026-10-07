"""Durable, fail-closed model lifecycle registry.

The registry is the only supported bridge between validation evidence and live model state. It
persists every transition atomically with an append-only audit event, rejects illegal state jumps,
and refuses any live-eligible state for unverified evidence.
"""
from __future__ import annotations

import builtins
from dataclasses import asdict, replace

from gpkg.core.metrics import Metrics
from gpkg.persistence.store import Store

from .lifecycle import (
    DriftReport,
    ModelEvidence,
    ModelState,
    NetTrade,
    ValidationConfig,
    should_rollback,
)

_ALLOWED: dict[ModelState | None, set[ModelState]] = {
    None: {ModelState.RESEARCH, ModelState.VALIDATED},
    ModelState.RESEARCH: {ModelState.RESEARCH, ModelState.VALIDATED},
    ModelState.VALIDATED: {ModelState.VALIDATED, ModelState.PAPER, ModelState.ROLLED_BACK},
    ModelState.PAPER: {ModelState.PAPER, ModelState.CANARY, ModelState.ROLLED_BACK},
    ModelState.CANARY: {ModelState.CANARY, ModelState.CHAMPION, ModelState.ROLLED_BACK},
    ModelState.CHAMPION: {ModelState.CHAMPION, ModelState.ROLLED_BACK},
    ModelState.ROLLED_BACK: {ModelState.ROLLED_BACK, ModelState.RESEARCH, ModelState.VALIDATED},
}


def _evidence_dict(e: ModelEvidence) -> dict:
    d = asdict(e)
    d["state"] = e.state.value
    return d


def _from_record(record: dict) -> ModelEvidence:
    d = dict(record["evidence"])
    d["state"] = ModelState(record["state"])
    d["verified"] = bool(record["verified"])
    return ModelEvidence(**d)


class ModelRegistry:
    def __init__(self, store: Store, metrics: Metrics | None = None):
        self.store = store
        self.metrics = metrics
        # Rehydrate gauges after restart without fabricating lifecycle event counters.
        if self.metrics:
            for evidence in self.list():
                self._set_gauges(evidence)

    def get(self, model_id: str) -> ModelEvidence | None:
        rec = self.store.ml_get_evidence(model_id)
        return None if rec is None else _from_record(rec)

    def list(self) -> list[ModelEvidence]:
        return [_from_record(r) for r in self.store.ml_list_evidence()]

    def persist_evidence(self, evidence: ModelEvidence, *, reason: str = "validation_evidence") -> ModelEvidence:
        current = self.get(evidence.model_id)
        current_state = current.state if current else None
        target = evidence.state
        self._validate_transition(current_state, target, evidence.verified)
        self.store.ml_upsert_evidence(
            evidence.model_id,
            target.value,
            evidence.verified,
            _evidence_dict(evidence),
            reason=reason,
            expected_from_state=current_state.value if current_state else None,
        )
        self._metrics(evidence, "evidence")
        return evidence

    def transition(self, model_id: str, target: ModelState, *, reason: str) -> ModelEvidence:
        current = self.get(model_id)
        if current is None:
            raise ValueError(f"unknown model {model_id}")
        self._validate_transition(current.state, target, current.verified)
        updated = replace(current, state=target)
        self.store.ml_upsert_evidence(
            model_id,
            target.value,
            updated.verified,
            _evidence_dict(updated),
            reason=reason,
            expected_from_state=current.state.value,
        )
        self._metrics(updated, "transition")
        return updated

    def rollback_if_needed(
        self,
        model_id: str,
        live_trades: builtins.list[NetTrade],
        drift: DriftReport,
        *,
        config: ValidationConfig = ValidationConfig(),
    ) -> tuple[bool, str, ModelEvidence]:
        current = self.get(model_id)
        if current is None:
            raise ValueError(f"unknown model {model_id}")
        rollback, reason = should_rollback(current, live_trades, drift, config=config)
        if not rollback:
            self._metrics(current, "monitor")
            return False, reason, current
        if current.state is ModelState.ROLLED_BACK:
            self._metrics(current, "rollback")
            return True, reason, current
        rolled = self.transition(model_id, ModelState.ROLLED_BACK, reason=f"automatic_rollback: {reason}")
        if self.metrics:
            self.metrics.inc("gigpilot_ml_rollbacks_total", model=model_id)
        return True, reason, rolled

    def live_eligible(self, model_id: str) -> ModelEvidence | None:
        """Return evidence only when it is verified and explicitly live-eligible."""
        evidence = self.get(model_id)
        if evidence is None or not evidence.verified:
            return None
        if evidence.state not in (ModelState.CANARY, ModelState.CHAMPION):
            return None
        return evidence

    @staticmethod
    def _validate_transition(
        current: ModelState | None,
        target: ModelState,
        verified: bool,
    ) -> None:
        if target in (ModelState.VALIDATED, ModelState.PAPER, ModelState.CANARY, ModelState.CHAMPION) and not verified:
            raise ValueError(f"unverified evidence cannot enter {target.value}")
        if target not in _ALLOWED.get(current, set()):
            src = "NONE" if current is None else current.value
            raise ValueError(f"illegal model transition {src}->{target.value}")
        if current is ModelState.VALIDATED and target is ModelState.CANARY:
            raise ValueError("PAPER stage is mandatory before CANARY")
        if current is ModelState.PAPER and target is ModelState.CHAMPION:
            raise ValueError("CANARY stage is mandatory before CHAMPION")

    def _set_gauges(self, evidence: ModelEvidence) -> None:
        if not self.metrics:
            return
        self.metrics.set("gigpilot_ml_model_verified", 1 if evidence.verified else 0, model=evidence.model_id)
        self.metrics.set(
            "gigpilot_ml_model_live_eligible",
            1 if evidence.verified and evidence.state in (ModelState.CANARY, ModelState.CHAMPION) else 0,
            model=evidence.model_id,
        )
        self.metrics.set("gigpilot_ml_model_mean_net_bps", evidence.mean_net_bps, model=evidence.model_id)
        self.metrics.set("gigpilot_ml_model_p_value", evidence.one_sided_p_value, model=evidence.model_id)

    def _metrics(self, evidence: ModelEvidence, event: str) -> None:
        if not self.metrics:
            return
        self._set_gauges(evidence)
        self.metrics.inc("gigpilot_ml_lifecycle_events_total", model=evidence.model_id, event=event)
