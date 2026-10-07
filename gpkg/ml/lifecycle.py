"""Production-safe ML lifecycle primitives for autonomous trading.

The module deliberately has no third-party dependencies so the process holding exchange
credentials does not gain a large ML supply chain. Heavy research/training can happen offline;
this module defines the evidence contract that MUST be satisfied before a prediction may influence
real capital.

Safety properties:
* point-in-time / purged walk-forward validation only;
* explicit out-of-sample evidence;
* objective is realised NET PnL after fees, funding, spread, slippage and adverse selection;
* minimum sample count + one-sided significance hurdle;
* champion/challenger promotion with canary stage;
* drift detection;
* automatic rollback on degraded live evidence;
* no verified evidence => DO NOTHING.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import Enum
from math import erf, isfinite, log, sqrt
from statistics import mean, pstdev


class ModelState(str, Enum):
    RESEARCH = "RESEARCH"
    VALIDATED = "VALIDATED"
    PAPER = "PAPER"
    CANARY = "CANARY"
    CHAMPION = "CHAMPION"
    ROLLED_BACK = "ROLLED_BACK"


@dataclass(frozen=True)
class CostBreakdown:
    fees_bps: float = 0.0
    funding_bps: float = 0.0
    spread_bps: float = 0.0
    slippage_bps: float = 0.0
    adverse_selection_bps: float = 0.0

    @property
    def total_bps(self) -> float:
        return (
            abs(self.fees_bps)
            + abs(self.funding_bps)
            + abs(self.spread_bps)
            + abs(self.slippage_bps)
            + abs(self.adverse_selection_bps)
        )


@dataclass(frozen=True)
class NetTrade:
    """One completely closed out-of-sample trade, expressed in basis points."""

    gross_edge_bps: float
    realised_gross_pnl_bps: float
    costs: CostBreakdown
    timestamp_ms: int

    @property
    def realised_net_pnl_bps(self) -> float:
        return self.realised_gross_pnl_bps - self.costs.total_bps


@dataclass(frozen=True)
class ValidationConfig:
    min_oos_trades: int = 30
    min_mean_net_bps: float = 0.0
    min_profit_factor: float = 1.05
    max_drawdown_bps: float = 500.0
    max_one_sided_p_value: float = 0.05
    min_walk_forward_folds: int = 3
    embargo_samples: int = 1
    min_live_observations: int = 20
    rollback_live_mean_net_bps: float = 0.0
    max_population_stability_index: float = 0.25
    min_t_stat: float = 0.0
    min_oos_sharpe: float = 0.0
    min_edge_bps: float = 0.0


@dataclass(frozen=True)
class ModelEvidence:
    model_id: str
    state: ModelState
    oos_trades: int
    walk_forward_folds: int
    mean_net_bps: float
    total_net_bps: float
    profit_factor: float
    max_drawdown_bps: float
    one_sided_p_value: float
    verified: bool
    verification_reason: str
    evaluated_at_ms: int
    data_cutoff_ms: int
    t_stat: float = 0.0
    oos_sharpe: float = 0.0
    expected_net_edge_bps: float = 0.0
    feature_importance: dict[str, float] = field(default_factory=dict)
    psi_baseline: dict[str, float] = field(default_factory=dict)
    training_start_ms: int = 0
    training_window_ms: int = 0
    model_types: tuple[str, ...] = ()
    calibration_error: float = 0.0


@dataclass(frozen=True)
class PromotionDecision:
    allowed: bool
    target_state: ModelState
    reason: str
    challenger: ModelEvidence
    champion_model_id: str | None = None


@dataclass(frozen=True)
class DriftReport:
    psi: float
    drifted: bool
    reason: str


@dataclass(frozen=True)
class TradingAuthorization:
    allowed: bool
    reason: str
    expected_net_edge_bps: float
    model_id: str | None


class PurgedWalkForward:
    """Strict expanding-window walk-forward splitter with purge/embargo.

    Samples MUST be sorted by timestamp by the caller. The training set always ends before the
    validation window, and the purge/embargo removes adjacent observations whose labels/features
    could overlap the validation horizon.
    """

    def __init__(self, n_splits: int = 5, min_train: int = 100, test_size: int = 50, purge: int = 1):
        if n_splits < 1 or min_train < 1 or test_size < 1 or purge < 0:
            raise ValueError("invalid walk-forward parameters")
        self.n_splits = n_splits
        self.min_train = min_train
        self.test_size = test_size
        self.purge = purge

    def split(self, timestamps_ms: Sequence[int]) -> list[tuple[range, range]]:
        if any(b <= a for a, b in zip(timestamps_ms, timestamps_ms[1:])):
            raise ValueError("timestamps must be strictly increasing; duplicates/leakage are refused")
        n = len(timestamps_ms)
        folds: list[tuple[range, range]] = []
        train_end = self.min_train
        for _ in range(self.n_splits):
            test_start = train_end + self.purge
            test_end = test_start + self.test_size
            if test_end > n:
                break
            folds.append((range(train_end), range(test_start, test_end)))
            train_end = test_end
        return folds


def _normal_sf(z: float) -> float:
    """Upper-tail probability under N(0,1); sufficient as a conservative large-sample gate."""
    return 0.5 * (1.0 - erf(z / sqrt(2.0)))


def _profit_factor(values: Sequence[float]) -> float:
    wins = sum(x for x in values if x > 0)
    losses = abs(sum(x for x in values if x < 0))
    if losses == 0:
        return float("inf") if wins > 0 else 0.0
    return wins / losses


def _max_drawdown(values: Sequence[float]) -> float:
    equity = peak = 0.0
    worst = 0.0
    for x in values:
        equity += x
        peak = max(peak, equity)
        worst = max(worst, peak - equity)
    return worst


def evaluate_candidate(
    model_id: str,
    trades: Sequence[NetTrade],
    *,
    walk_forward_folds: int,
    evaluated_at_ms: int,
    data_cutoff_ms: int,
    config: ValidationConfig = ValidationConfig(),
) -> ModelEvidence:
    """Convert genuinely OOS closed trades into a promotion-grade evidence record."""

    if evaluated_at_ms <= data_cutoff_ms:
        raise ValueError("evaluation time must be after the data cutoff")
    if any(t.timestamp_ms > data_cutoff_ms for t in trades):
        raise ValueError("future trade found beyond data cutoff; leakage refused")
    if any(not isfinite(t.realised_net_pnl_bps) for t in trades):
        raise ValueError("non-finite PnL evidence refused")

    vals = [t.realised_net_pnl_bps for t in trades]
    n = len(vals)
    mu = mean(vals) if vals else 0.0
    sigma = pstdev(vals) if len(vals) > 1 else 0.0
    if n > 1 and sigma > 0:
        z = mu / (sigma / sqrt(n))
        p = _normal_sf(z)
    else:
        p = 0.0 if n > 0 and mu > 0 else 1.0

    pf = _profit_factor(vals)
    dd = _max_drawdown(vals)
    reasons: list[str] = []
    if n < config.min_oos_trades:
        reasons.append(f"oos_trades {n} < {config.min_oos_trades}")
    if walk_forward_folds < config.min_walk_forward_folds:
        reasons.append(f"walk_forward_folds {walk_forward_folds} < {config.min_walk_forward_folds}")
    if mu <= max(config.min_mean_net_bps, config.min_edge_bps):
        reasons.append(f"mean_net_bps {mu:.4f} <= hurdle {max(config.min_mean_net_bps, config.min_edge_bps):.4f}")
    t_stat = (mu / (sigma / sqrt(n))) if n > 1 and sigma > 0 else (float("inf") if mu > 0 else 0.0)
    sharpe = (mu / sigma * sqrt(n)) if n > 1 and sigma > 0 else (float("inf") if mu > 0 else 0.0)
    if t_stat <= config.min_t_stat:
        reasons.append(f"t_stat {t_stat:.4f} <= {config.min_t_stat:.4f}")
    if sharpe <= config.min_oos_sharpe:
        reasons.append(f"oos_sharpe {sharpe:.4f} <= {config.min_oos_sharpe:.4f}")
    if pf < config.min_profit_factor:
        reasons.append(f"profit_factor {pf:.4f} < {config.min_profit_factor:.4f}")
    if dd > config.max_drawdown_bps:
        reasons.append(f"max_drawdown_bps {dd:.4f} > {config.max_drawdown_bps:.4f}")
    if p > config.max_one_sided_p_value:
        reasons.append(f"p_value {p:.6f} > {config.max_one_sided_p_value:.6f}")

    verified = not reasons
    return ModelEvidence(
        model_id=model_id,
        state=ModelState.VALIDATED if verified else ModelState.RESEARCH,
        oos_trades=n,
        walk_forward_folds=walk_forward_folds,
        mean_net_bps=mu,
        total_net_bps=sum(vals),
        profit_factor=pf,
        max_drawdown_bps=dd,
        one_sided_p_value=p,
        verified=verified,
        verification_reason="verified_oos_net_edge" if verified else "; ".join(reasons),
        evaluated_at_ms=evaluated_at_ms,
        data_cutoff_ms=data_cutoff_ms,
        t_stat=t_stat,
        oos_sharpe=sharpe,
        expected_net_edge_bps=mu,
    )


def promote_challenger(
    challenger: ModelEvidence,
    champion: ModelEvidence | None,
    *,
    min_improvement_bps: float = 0.0,
) -> PromotionDecision:
    """Approve a verified challenger for PAPER evaluation only.

    Out-of-sample validation is necessary but not sufficient for real capital. A challenger must
    first survive paper evaluation, after which the durable lifecycle registry may advance PAPER to
    CANARY. This function therefore never authorizes a live state.
    """

    if not challenger.verified:
        return PromotionDecision(False, ModelState.RESEARCH, challenger.verification_reason, challenger,
                                 champion.model_id if champion else None)
    if challenger.state is not ModelState.VALIDATED:
        return PromotionDecision(
            False,
            challenger.state,
            f"paper admission requires VALIDATED state, found {challenger.state.value}",
            challenger,
            champion.model_id if champion else None,
        )
    if champion and champion.verified:
        improvement = challenger.mean_net_bps - champion.mean_net_bps
        if improvement <= min_improvement_bps:
            return PromotionDecision(
                False, ModelState.VALIDATED,
                f"challenger net edge improvement {improvement:.4f} bps <= {min_improvement_bps:.4f}",
                challenger, champion.model_id,
            )
    return PromotionDecision(
        True,
        ModelState.PAPER,
        "verified challenger may enter paper evaluation; live capital remains prohibited",
        challenger,
        champion.model_id if champion else None,
    )


def population_stability_index(
    reference: Sequence[float],
    current: Sequence[float],
    *,
    bins: int = 10,
    max_psi: float = 0.25,
) -> DriftReport:
    """Population Stability Index with reference-derived equal-width bins."""

    if bins < 2 or len(reference) < bins or len(current) < bins:
        return DriftReport(float("inf"), True, "insufficient observations for drift validation")
    lo, hi = min(reference), max(reference)
    if not isfinite(lo) or not isfinite(hi) or hi <= lo:
        return DriftReport(float("inf"), True, "degenerate reference distribution")
    width = (hi - lo) / bins

    def counts(xs: Sequence[float]) -> list[int]:
        out = [0] * bins
        for x in xs:
            if not isfinite(x):
                continue
            idx = int((x - lo) / width)
            idx = 0 if idx < 0 else bins - 1 if idx >= bins else idx
            out[idx] += 1
        return out

    a, b = counts(reference), counts(current)
    eps = 1e-6
    na, nb = max(sum(a), 1), max(sum(b), 1)
    psi = 0.0
    for ca, cb in zip(a, b):
        pa = max(ca / na, eps)
        pb = max(cb / nb, eps)
        psi += (pb - pa) * log(pb / pa)
    return DriftReport(psi, psi > max_psi, f"psi={psi:.4f}, limit={max_psi:.4f}")


def should_rollback(
    evidence: ModelEvidence,
    live_trades: Sequence[NetTrade],
    drift: DriftReport,
    *,
    config: ValidationConfig = ValidationConfig(),
) -> tuple[bool, str]:
    if not evidence.verified or evidence.state not in (ModelState.CANARY, ModelState.CHAMPION):
        return True, "model is not in an approved live state"
    if drift.drifted:
        return True, f"feature drift: {drift.reason}"
    vals = [t.realised_net_pnl_bps for t in live_trades]
    if len(vals) < config.min_live_observations:
        return False, "insufficient live observations; retain current canary state"
    if mean(vals) <= config.rollback_live_mean_net_bps:
        return True, (
            f"live mean net PnL {mean(vals):.4f} bps <= rollback hurdle "
            f"{config.rollback_live_mean_net_bps:.4f}"
        )
    return False, "live evidence remains acceptable"


def authorize_prediction(
    *,
    evidence: ModelEvidence | None,
    state: ModelState,
    predicted_gross_edge_bps: float,
    costs: CostBreakdown,
    confidence: float,
    min_confidence: float,
    risk_hurdle_bps: float,
    drift: DriftReport | None = None,
) -> TradingAuthorization:
    """Final fail-closed capital gate.

    This is intentionally boring: the model never gets the benefit of the doubt. Any missing or
    unverified evidence means DO NOTHING.
    """
    if evidence is None:
        return TradingAuthorization(False, "no verified model evidence", float("-inf"), None)
    if not evidence.verified:
        return TradingAuthorization(False, f"model unverified: {evidence.verification_reason}",
                                    float("-inf"), evidence.model_id)
    if state not in (ModelState.CANARY, ModelState.CHAMPION):
        return TradingAuthorization(False, f"model state {state.value} may not trade real capital",
                                    float("-inf"), evidence.model_id)
    if drift is not None and drift.drifted:
        return TradingAuthorization(False, f"feature drift: {drift.reason}",
                                    float("-inf"), evidence.model_id)
    if not (0.0 <= confidence <= 1.0) or confidence < min_confidence:
        return TradingAuthorization(False, "prediction confidence below verified threshold",
                                    float("-inf"), evidence.model_id)
    net = predicted_gross_edge_bps - costs.total_bps
    if not isfinite(net) or net <= risk_hurdle_bps:
        return TradingAuthorization(
            False,
            f"predicted net edge {net:.4f} bps <= hurdle {risk_hurdle_bps:.4f} bps",
            net,
            evidence.model_id,
        )
    return TradingAuthorization(True, "verified post-cost edge clears hurdle", net, evidence.model_id)
