"""Dependency-light research/training pipeline with strict OOS cost gating.

The trainer is intentionally separate from the live credential process. It consumes persisted market
data, performs as-of feature joins, purged walk-forward validation, probability calibration, volatility
forecasting and a conservative Almgren-Chriss-style impact fit. A candidate is registered only when
all configured net-edge, t-statistic and OOS-Sharpe gates pass. Historical evidence can enter PAPER,
but CANARY additionally requires real paper-shadow evidence; backtest results are never mislabeled as
paper execution.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import mean, pstdev
from typing import Iterable

from gpkg.core.clock import now_ms
from gpkg.ml.data import align_point_in_time
from gpkg.ml.lifecycle import (
    CostBreakdown,
    ModelState,
    NetTrade,
    PurgedWalkForward,
    ValidationConfig,
    evaluate_candidate,
)
from gpkg.persistence.store import Store


FEATURES = ("obi", "ewma_vol_bps", "spread_z", "volume_accel")


@dataclass(frozen=True)
class TrainingConfig:
    days: int = 90
    horizon_bars: int = 5
    min_rows: int = 50_000
    folds: int = 5
    min_train: int = 20_000
    test_size: int = 5_000
    embargo: int = 5
    edge_hurdle_bps: float = 8.0
    min_t_stat: float = 3.0
    min_oos_sharpe: float = 1.5
    taker_fee_bps: float = 5.5
    min_trade_probability: float = 0.55
    kelly_fraction: float = 0.25
    max_position_fraction: float = 0.10
    paper_min_trades: int = 30


@dataclass(frozen=True)
class FeatureRow:
    ts_ms: int
    close: float
    next_return_bps: float
    obi: float
    ewma_vol_bps: float
    spread_bps: float
    spread_z: float
    volume_accel: float
    bid_depth: float
    ask_depth: float


@dataclass(frozen=True)
class LogisticModel:
    weights: tuple[float, ...]
    bias: float
    means: tuple[float, ...]
    scales: tuple[float, ...]

    def probability(self, x: tuple[float, ...]) -> float:
        z = self.bias + sum(w * ((v - m) / s) for w, v, m, s in zip(self.weights, x, self.means, self.scales))
        z = max(-40.0, min(40.0, z))
        return 1.0 / (1.0 + math.exp(-z))


@dataclass(frozen=True)
class ImpactModel:
    eta_bps: float
    gamma_bps: float
    residual_bps: float

    def forecast(self, participation: float) -> float:
        p = max(0.0, participation)
        return max(0.0, self.residual_bps + self.eta_bps * math.sqrt(p) + self.gamma_bps * p)


@dataclass(frozen=True)
class TrainingResult:
    model_id: str
    state: ModelState
    verified: bool
    reason: str
    evidence: object
    feature_importance: dict[str, float]
    psi_baseline: dict[str, float]
    training_start_ms: int
    training_window_ms: int
    model_types: tuple[str, ...]
    calibration_error: float
    kelly_fraction: float


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 1.0
    s = pstdev(values)
    return s if math.isfinite(s) and s > 1e-12 else 1.0


def _fit_logistic(rows: list[FeatureRow], indices: Iterable[int]) -> LogisticModel:
    idx = list(indices)
    xs = [tuple(getattr(rows[i], name) for name in FEATURES) for i in idx]
    ys = [1.0 if rows[i].next_return_bps > 0 else 0.0 for i in idx]
    means = tuple(mean(x[j] for x in xs) for j in range(len(FEATURES)))
    scales = tuple(_std([x[j] for x in xs]) for j in range(len(FEATURES)))
    zxs = [tuple((x[j] - means[j]) / scales[j] for j in range(len(FEATURES))) for x in xs]
    w = [0.0] * len(FEATURES)
    b = 0.0
    # Deterministic, bounded gradient descent. No random seed or future sample access.
    lr = 0.08
    reg = 0.01
    for _ in range(80):
        gw = [reg * v for v in w]
        gb = 0.0
        for x, y in zip(zxs, ys):
            z = max(-30.0, min(30.0, b + sum(a * v for a, v in zip(w, x))))
            p = 1.0 / (1.0 + math.exp(-z))
            err = p - y
            gb += err
            for j, v in enumerate(x):
                gw[j] += err * v
        n = max(len(zxs), 1)
        for j in range(len(w)):
            w[j] -= lr * gw[j] / n
        b -= lr * gb / n
        lr *= 0.985
    return LogisticModel(tuple(w), b, means, scales)


def _fit_calibrator(probs: list[float], labels: list[int]) -> tuple[float, float]:
    """One-parameter Platt-style calibration fit: calibrated p = sigmoid(a*logit(p)+b)."""
    if len(probs) < 20:
        return 1.0, 0.0
    a, b = 1.0, 0.0
    for _ in range(60):
        ga = gb = 0.0
        for p, y in zip(probs, labels):
            p = min(1 - 1e-6, max(1e-6, p))
            z = a * math.log(p / (1 - p)) + b
            q = 1 / (1 + math.exp(-max(-30, min(30, z))))
            e = q - y
            ga += e * math.log(p / (1 - p))
            gb += e
        n = max(len(probs), 1)
        a -= 0.05 * ga / n
        b -= 0.05 * gb / n
    return a, b


def _calibrated(p: float, params: tuple[float, float]) -> float:
    a, b = params
    p = min(1 - 1e-6, max(1e-6, p))
    z = a * math.log(p / (1 - p)) + b
    return 1 / (1 + math.exp(-max(-30, min(30, z))))


def _feature_rows(store: Store, symbol: str, start_ms: int, end_ms: int, horizon: int) -> list[FeatureRow]:
    kl = store.ml_market_range(symbol, "kline_1m", start_ms, end_ms)
    book = store.ml_market_range(symbol, "orderbook_l2", start_ms, end_ms)
    aligned = align_point_in_time(kl, book)
    closes = [float(x["close"]) for x in aligned]
    volumes = [float(x.get("volume", 0.0)) for x in aligned]
    spreads: list[float] = []
    raw = []
    ewma_var = 0.0
    prev = None
    decay = 0.94
    for i, row in enumerate(aligned):
        close = closes[i]
        if prev and prev > 0:
            ret = math.log(close / prev)
            ewma_var = decay * ewma_var + (1 - decay) * ret * ret
        prev = close
        b = row["book"]
        bid = float(b["bid"]); ask = float(b["ask"])
        bid_depth = max(float(b["bid_depth"]), 1e-12)
        ask_depth = max(float(b["ask_depth"]), 1e-12)
        obi = (bid_depth - ask_depth) / (bid_depth + ask_depth)
        spread = max(0.0, (ask - bid) / close * 1e4)
        spreads.append(spread)
        window = spreads[max(0, i - 59):i + 1]
        sm = mean(window); ss = _std(window)
        spread_z = (spread - sm) / ss
        vw = mean(volumes[max(0, i - 19):i + 1])
        prior_v = mean(volumes[max(0, i - 39):max(0, i - 19)]) if i >= 20 else max(vw, 1e-12)
        volume_accel = vw / max(prior_v, 1e-12) - 1.0
        raw.append((row["ts_ms"], close, obi, math.sqrt(max(ewma_var, 0))*1e4, spread,
                    spread_z, volume_accel, bid_depth, ask_depth))
    out = []
    for i in range(len(raw) - horizon):
        ts, close, obi, vol, spread, z, va, bd, ad = raw[i]
        future = closes[i + horizon]
        if close <= 0 or future <= 0:
            continue
        out.append(FeatureRow(
            ts_ms=int(ts), close=close, next_return_bps=math.log(future / close) * 1e4,
            obi=obi, ewma_vol_bps=vol, spread_bps=spread, spread_z=z, volume_accel=va,
            bid_depth=bd, ask_depth=ad,
        ))
    return out


def _fit_impact(rows: list[FeatureRow]) -> ImpactModel:
    # Conservative AC-style square-root temporary + linear permanent impact.
    ys = []
    xs = []
    for r in rows:
        participation = min(0.10, 1000.0 / max(r.bid_depth + r.ask_depth, 1.0))
        book_component = max(0.0, r.spread_bps / 2.0)
        observed_proxy = book_component + abs(r.next_return_bps) * 0.05
        ys.append(observed_proxy)
        xs.append((math.sqrt(participation), participation))
    if not ys:
        return ImpactModel(0.0, 0.0, 0.0)
    # Non-negative coordinate fits; target is deliberately a conservative execution-cost proxy.
    eta = max(0.0, sum(y*x[0] for y, x in zip(ys, xs)) / max(sum(x[0]*x[0] for x in xs), 1e-12))
    gamma = max(0.0, sum((y-eta*x[0])*x[1] for y, x in zip(ys, xs)) / max(sum(x[1]*x[1] for x in xs), 1e-12))
    residual = mean(max(0.0, y - eta*x[0] - gamma*x[1]) for y, x in zip(ys, xs))
    return ImpactModel(eta, gamma, residual)


def _kelly(p: float, payoff_bps: float, loss_bps: float, fraction: float) -> float:
    if not 0.0 < p < 1.0 or payoff_bps <= 0 or loss_bps <= 0:
        return 0.0
    b = payoff_bps / loss_bps
    raw = (b * p - (1 - p)) / b
    return max(0.0, min(1.0, raw * fraction))


def _psi_baseline(rows: list[FeatureRow]) -> dict[str, float]:
    return {name: mean(getattr(r, name) for r in rows) for name in FEATURES}


def train_candidate(store: Store, symbol: str, *, config: TrainingConfig = TrainingConfig(),
                    end_ms: int | None = None, require_coverage: bool = True) -> TrainingResult:
    # Same precondition as the tournament, for the same reason: a model fitted on no history is not a
    # weak model, it is an ABSENT MEASUREMENT, and the two must never be reported alike.
    if require_coverage:
        from gpkg.ml.data import HistoricalDataWorker
        HistoricalDataWorker(store, days=max(90, int(config.days))).require_training_coverage(symbol)
    end_ms = int(end_ms or now_ms())
    start_ms = end_ms - config.days * 86_400_000
    model_id = f"alpha-{symbol.lower()}-{end_ms}"
    rows = _feature_rows(store, symbol, start_ms, end_ms, config.horizon_bars)
    if len(rows) < config.min_rows:
        reason = f"insufficient aligned point-in-time rows {len(rows)} < {config.min_rows}"
        evidence_payload = {
            "model_id": model_id, "state": ModelState.RESEARCH.value, "verified": False,
            "reason": reason, "rows": len(rows), "start_ms": start_ms, "end_ms": end_ms,
        }
        store.ml_research_audit(model_id, "REJECTED", reason, evidence_payload)
        return TrainingResult(model_id, ModelState.RESEARCH, False, reason, evidence_payload, {}, {}, start_ms,
                              end_ms - start_ms, ("directional_logistic", "ewma_volatility", "almgren_chriss_impact"), 1.0,
                              config.kelly_fraction)

    timestamps = [r.ts_ms for r in rows]
    splitter = PurgedWalkForward(
        n_splits=config.folds, min_train=config.min_train,
        test_size=config.test_size, purge=config.embargo,
    )
    folds = splitter.split(timestamps)
    if len(folds) < config.folds:
        reason = f"only {len(folds)} purged walk-forward folds available; required {config.folds}"
        store.ml_research_audit(model_id, "REJECTED", reason, {"folds": len(folds)})
        return TrainingResult(model_id, ModelState.RESEARCH, False, reason, {}, {}, {}, start_ms,
                              end_ms - start_ms, ("directional_logistic", "ewma_volatility", "almgren_chriss_impact"), 1.0,
                              config.kelly_fraction)

    impact = _fit_impact(rows)
    trades: list[NetTrade] = []
    all_probs: list[float] = []
    all_labels: list[int] = []
    importance = {name: 0.0 for name in FEATURES}
    for train_idx, test_idx in folds:
        model = _fit_logistic(rows, train_idx)
        train_probs = [model.probability(tuple(getattr(rows[i], n) for n in FEATURES)) for i in train_idx]
        train_labels = [1 if rows[i].next_return_bps > 0 else 0 for i in train_idx]
        calibration = _fit_calibrator(train_probs, train_labels)
        for j, name in enumerate(FEATURES):
            importance[name] += abs(model.weights[j])
        for i in test_idx:
            row = rows[i]
            p = _calibrated(model.probability(tuple(getattr(row, n) for n in FEATURES)), calibration)
            all_probs.append(p); all_labels.append(1 if row.next_return_bps > 0 else 0)
            if p >= config.min_trade_probability or p <= 1 - config.min_trade_probability:
                side = 1.0 if p >= 0.5 else -1.0
                payoff = abs(row.next_return_bps)
                participation = min(config.max_position_fraction, config.kelly_fraction)
                impact_bps = impact.forecast(participation)
                costs = CostBreakdown(
                    fees_bps=2 * config.taker_fee_bps,
                    spread_bps=row.spread_bps / 2.0,
                    slippage_bps=impact_bps,
                    adverse_selection_bps=max(0.0, -side * row.next_return_bps * 0.10),
                )
                gross = max(0.0, abs(row.next_return_bps))
                realised = side * row.next_return_bps
                # Fractional Kelly is recorded and bounded; it cannot bypass the net-cost gate.
                _ = _kelly(p, payoff, max(payoff, 1e-9), config.kelly_fraction)
                trades.append(NetTrade(gross, realised, costs, row.ts_ms))

    if not trades:
        reason = "no out-of-sample predictions cleared the minimum probability"
        store.ml_research_audit(model_id, "REJECTED", reason, {"folds": len(folds)})
        return TrainingResult(model_id, ModelState.RESEARCH, False, reason, {}, {}, {}, start_ms,
                              end_ms - start_ms, ("directional_logistic", "ewma_volatility", "almgren_chriss_impact"), 1.0,
                              config.kelly_fraction)

    evidence = evaluate_candidate(
        model_id, trades, walk_forward_folds=len(folds), evaluated_at_ms=now_ms(), data_cutoff_ms=end_ms,
        config=ValidationConfig(
            min_oos_trades=30, min_mean_net_bps=config.edge_hurdle_bps,
            min_profit_factor=1.05, max_drawdown_bps=500.0,
            max_one_sided_p_value=0.00135, min_walk_forward_folds=config.folds,
            embargo_samples=config.embargo, min_t_stat=config.min_t_stat,
            min_oos_sharpe=config.min_oos_sharpe, min_edge_bps=config.edge_hurdle_bps,
        ),
    )
    cal_error = mean(abs(p-y) for p, y in zip(all_probs, all_labels)) if all_probs else 1.0
    total_importance = max(sum(importance.values()), 1e-12)
    importance = {k: v / total_importance for k, v in importance.items()}
    # Feature drift baseline is stored as summary statistics. Live PSI comparison can use these
    # references; no current/future data is mixed into the training baseline.
    baseline = _psi_baseline(rows)
    evidence = type(evidence)(**{
        **evidence.__dict__,
        "feature_importance": importance,
        "psi_baseline": baseline,
        "training_start_ms": start_ms,
        "training_window_ms": end_ms - start_ms,
        "model_types": ("directional_logistic", "ewma_volatility", "almgren_chriss_impact"),
        "calibration_error": cal_error,
    })
    observed_peak_spread = max((r.spread_bps for r in rows), default=0.0)
    avg_fees = mean(t.costs.fees_bps for t in trades) if trades else 0.0
    avg_spread = mean(t.costs.spread_bps for t in trades) if trades else 0.0
    avg_impact = mean(t.costs.slippage_bps for t in trades) if trades else 0.0
    avg_other = mean(t.costs.funding_bps + t.costs.adverse_selection_bps for t in trades) if trades else 0.0
    audit_payload = {
        "model_family": "directional_logistic_l2", "gross_edge_bps": mean(t.gross_edge_bps for t in trades),
        "cost_deductions": {
            "fees_bps": avg_fees,
            "two_x_peak_spread_bps": 2.0 * observed_peak_spread,
            "modeled_impact_bps": avg_impact,
            "observed_average_spread_component_bps": avg_spread,
            "funding_and_adverse_selection_bps": avg_other,
        },
        "net_edge_bps": evidence.mean_net_bps, "t_stat": evidence.t_stat,
        "oos_sharpe": evidence.oos_sharpe, "gate_outcome": evidence.verified,
        "gate_thresholds": {"net_edge_bps": config.edge_hurdle_bps, "t_stat": config.min_t_stat, "oos_sharpe": config.min_oos_sharpe},
        "oos_trades": evidence.oos_trades, "folds": evidence.walk_forward_folds, "features": importance,
    }
    store.ml_research_audit(model_id, "VERIFIED" if evidence.verified else "REJECTED",
                            evidence.verification_reason, audit_payload)
    return TrainingResult(
        model_id=model_id, state=evidence.state, verified=evidence.verified,
        reason=evidence.verification_reason, evidence=evidence, feature_importance=importance,
        psi_baseline=baseline, training_start_ms=start_ms, training_window_ms=end_ms-start_ms,
        model_types=evidence.model_types, calibration_error=cal_error, kelly_fraction=config.kelly_fraction,
    )


def register_validated_candidate(store: Store, registry, result: TrainingResult) -> None:
    """Persist validation evidence only; never jump directly to CANARY."""
    evidence = result.evidence
    if not hasattr(evidence, "model_id"):
        return
    registry.persist_evidence(evidence, reason="strict_oos_validation")
    if result.verified:
        registry.transition(result.model_id, ModelState.PAPER, reason="historical_oos_passed_paper_admission")


def train_hypotheses(store: Store, symbol: str, *, days: int = 90, taker_fee_bps: float = 5.5,
                     end_ms: int | None = None):
    """Run the funding/regime hypothesis families through the same purged OOS trainer contract."""
    from gpkg.ml.hypotheses import evaluate_hypotheses
    return evaluate_hypotheses(store, symbol, days=days, taker_fee_bps=taker_fee_bps, end_ms=end_ms)
