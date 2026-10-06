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

from .runtime import (
    EwmaVolatilityForecaster,
    FeatureVector,
    ImpactResidualForecaster,
    Prediction,
    Regime,
    StrategyCandidate,
    book_impact_bps,
    confidence_probability_score,
    detect_regime,
    extract_features,
    position_notional,
    select_verified_strategy,
)

__all__ += [
    "EwmaVolatilityForecaster",
    "FeatureVector",
    "ImpactResidualForecaster",
    "Prediction",
    "Regime",
    "StrategyCandidate",
    "book_impact_bps",
    "confidence_probability_score",
    "detect_regime",
    "extract_features",
    "position_notional",
    "select_verified_strategy",
]

from .registry import ModelRegistry

__all__ += ["ModelRegistry"]

from .friction import (
    BYBIT_MAKER_FEE_BPS,
    BYBIT_TAKER_FEE_BPS,
    DEFAULT_HURDLE_BPS,
    DEFAULT_TAKER_CROSS_HURDLE_BPS,
    Admission,
    FrictionBreakdown,
    adverse_selection_bps,
    build_friction,
    evaluate_admission,
    fee_bps,
    hostile_imbalance,
    market_impact_bps,
    order_book_imbalance,
    snapshot_decay,
    taker_crossing_allowed,
    worst_case_spread_bps,
)

__all__ += [
    "BYBIT_MAKER_FEE_BPS",
    "BYBIT_TAKER_FEE_BPS",
    "DEFAULT_HURDLE_BPS",
    "DEFAULT_TAKER_CROSS_HURDLE_BPS",
    "Admission",
    "FrictionBreakdown",
    "adverse_selection_bps",
    "build_friction",
    "evaluate_admission",
    "fee_bps",
    "hostile_imbalance",
    "market_impact_bps",
    "order_book_imbalance",
    "snapshot_decay",
    "taker_crossing_allowed",
    "worst_case_spread_bps",
]

from .tournament import (
    STRICT_GATE,
    CandidateOutcome,
    CandidateParams,
    TournamentResult,
    evaluate_params,
    hot_swap_decision,
    load_latest_tournament,
    run_tournament,
)

__all__ += [
    "STRICT_GATE",
    "CandidateOutcome",
    "CandidateParams",
    "TournamentResult",
    "evaluate_params",
    "hot_swap_decision",
    "load_latest_tournament",
    "run_tournament",
]
