"""Fail-closed machine-learning trading primitives.

Nothing in this package may authorize capital by itself. Runtime trading must consume a
`PromotionDecision` produced from verified out-of-sample evidence.
"""
from .lifecycle import (
    CostBreakdown,
    DriftReport,
    ModelEvidence,
    ModelState,
    NetTrade,
    PromotionDecision,
    PurgedWalkForward,
    TradingAuthorization,
    ValidationConfig,
    authorize_prediction,
    evaluate_candidate,
    population_stability_index,
    promote_challenger,
    should_rollback,
)

__all__ = [
    "CostBreakdown",
    "DriftReport",
    "ModelEvidence",
    "ModelState",
    "NetTrade",
    "PromotionDecision",
    "PurgedWalkForward",
    "TradingAuthorization",
    "ValidationConfig",
    "authorize_prediction",
    "evaluate_candidate",
    "population_stability_index",
    "promote_challenger",
    "should_rollback",
]
