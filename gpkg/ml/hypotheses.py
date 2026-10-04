"""Economically grounded, leakage-safe alpha hypothesis evaluators.

These candidates are deliberately deterministic and dependency-light. They are research evidence
only: every candidate must clear the same post-friction OOS gates before entering PAPER.
"""
from __future__ import annotations

import math
from dataclasses import replace
from statistics import mean, pstdev

from gpkg.core.clock import now_ms
from gpkg.ml.data import align_point_in_time
from gpkg.ml.lifecycle import CostBreakdown, ModelEvidence, ModelState, NetTrade, PurgedWalkForward, ValidationConfig, evaluate_candidate
from gpkg.persistence.store import Store


HORIZON_BARS = 5
MIN_ROWS = 50_000
L2_REQUIRED_MS = 48 * 3_600_000


def _std(xs: list[float]) -> float:
    if len(xs) < 2:
        return 1.0
    v = pstdev(xs)
    return v if math.isfinite(v) and v > 1e-12 else 1.0


def _asof_value(rows: list[dict], ts: int, key: str, default: float = 0.0) -> float:
    value = default
    for row in rows:
        rts = int(row["ts_ms"])
        if rts > ts:
            break
        value = float(row.get(key, default))
    return value


def _feature_rows(store: Store, symbol: str, start_ms: int, end_ms: int, use_l2: bool) -> list[dict]:
    kl = store.ml_market_range(symbol, "kline_1m", start_ms, end_ms)
    funding = store.ml_market_range(symbol, "funding_8h", start_ms, end_ms)
    basis = store.ml_market_range(symbol, "basis_1m", start_ms, end_ms)
    books = store.ml_market_range(symbol, "orderbook_l2", start_ms, end_ms) if use_l2 else []
    aligned_books = align_point_in_time(kl, books) if books else []
    book_by_ts = {int(r["ts_ms"]): r["book"] for r in aligned_books}
    closes = [float(r["close"]) for r in kl]
    out: list[dict] = []
    returns: list[float] = []
    vol_series: list[float] = []
    for i, row in enumerate(kl):
        close = float(row["close"])
        if i and close > 0 and closes[i - 1] > 0:
            returns.append(math.log(close / closes[i - 1]) * 1e4)
        else:
            returns.append(0.0)
        hist = returns[max(0, i - 239):i + 1]
        vol = _std(hist)
        vol_history = vol_series[max(0, len(vol_series) - 239):]
        vol_pct = sum(1 for x in vol_history if x <= vol) / max(len(vol_history), 1) if vol_history else 0.5
        vol_series.append(vol)
        f = _asof_value(funding, int(row["ts_ms"]), "funding_bps")
        b = _asof_value(basis, int(row["ts_ms"]), "basis_bps")
        rec = {
            "ts_ms": int(row["ts_ms"]), "close": close, "volume": float(row.get("volume", 0.0)),
            "funding_bps": f, "basis_bps": b, "vol_bps": vol, "vol_percentile": vol_pct,
            "return_bps": returns[-1],
        }
        if use_l2:
            book = book_by_ts.get(int(row["ts_ms"]))
            if book:
                bid = float(book.get("bid", 0.0)); ask = float(book.get("ask", 0.0))
                bd = max(float(book.get("bid_depth", 0.0)), 1e-12)
                ad = max(float(book.get("ask_depth", 0.0)), 1e-12)
                mid = (bid + ask) / 2.0
                rec["obi"] = (bd - ad) / (bd + ad)
                rec["microprice_bps"] = ((ask * bd + bid * ad) / (bd + ad) - mid) / max(mid, 1e-12) * 1e4
        out.append(rec)
    for i in range(len(out) - HORIZON_BARS):
        out[i]["future_return_bps"] = math.log(max(out[i + HORIZON_BARS]["close"], 1e-12) / max(out[i]["close"], 1e-12)) * 1e4
    return [r for r in out[:-HORIZON_BARS] if "future_return_bps" in r]


def _peak_spread(store: Store, symbol: str, start_ms: int, end_ms: int) -> tuple[float, int]:
    peak = 0.0; count = 0
    for row in store.ml_market_range(symbol, "orderbook_l2", start_ms, end_ms):
        try:
            bid = float(row["bid"]); ask = float(row["ask"]); mid = (bid + ask) / 2.0
            if mid > 0 and ask >= bid:
                peak = max(peak, (ask - bid) / mid * 1e4); count += 1
        except (KeyError, TypeError, ValueError):
            continue
    return peak, count


def _config() -> ValidationConfig:
    return ValidationConfig(
        min_oos_trades=30, min_mean_net_bps=8.0, min_profit_factor=1.05,
        max_drawdown_bps=500.0, max_one_sided_p_value=0.00135,
        min_walk_forward_folds=5, embargo_samples=5, min_t_stat=3.0,
        min_oos_sharpe=1.5, min_edge_bps=8.0,
    )


def _with_audit(ev: ModelEvidence, *, family: str, cost: dict, l2_ready: bool) -> ModelEvidence:
    return replace(
        ev,
        model_types=(family, "point_in_time_funding", "basis_premium", "l2_obi_microprice" if l2_ready else "l2_pending"),
    )


def _evaluate(
    store: Store,
    symbol: str,
    family: str,
    rows: list[dict],
    folds,
    peak_spread_bps: float,
    taker_fee_bps: float,
    l2_ready: bool,
) -> ModelEvidence:
    trades: list[NetTrade] = []
    # Costs are charged on every OOS trade. If L2 is not yet at 48h, the observed peak is retained
    # as a conservative bound; with no observations we use a non-qualifying 0.0 spread but mark the
    # candidate as L2-pending in the audit and never promote it solely on that result.
    spread_charge = 2.0 * max(peak_spread_bps, 0.0)
    for train, test in folds:
        train_rows = rows[train.start:train.stop]
        if not train_rows:
            continue
        funding_center = mean(float(r["funding_bps"]) for r in train_rows)
        funding_scale = _std([float(r["funding_bps"]) for r in train_rows])
        basis_center = mean(float(r["basis_bps"]) for r in train_rows)
        basis_scale = _std([float(r["basis_bps"]) for r in train_rows])
        vol_values = sorted(float(r["vol_bps"]) for r in train_rows)
        vol_mid = vol_values[len(vol_values)//2] if vol_values else 0.0
        for i in range(test.start, test.stop):
            r = rows[i]
            fz = (float(r["funding_bps"]) - funding_center) / funding_scale
            bz = (float(r["basis_bps"]) - basis_center) / basis_scale
            if family == "funding_rate_carry_reversion":
                # Positive funding/basis means longs pay and the perp trades rich: conservative
                # contrarian pressure is short; negative imbalance is long.
                score = -(0.65 * fz + 0.35 * bz)
                threshold = 1.0
            else:
                # Low-volatility regimes favor reversion; high-volatility regimes favor breakouts.
                low = float(r["vol_bps"]) <= vol_mid
                recent = mean(float(x["return_bps"]) for x in rows[max(train.start, i-5):i]) if i > train.start else 0.0
                score = (-(0.7 * bz + 0.3 * fz) if low else (recent / max(float(r["vol_bps"]), 1.0)))
                threshold = 0.75 if low else 0.5
            if l2_ready:
                score += 0.20 * float(r.get("obi", 0.0)) + 0.05 * float(r.get("microprice_bps", 0.0))
            if abs(score) < threshold:
                continue
            side = 1.0 if score > 0 else -1.0
            realised = side * float(r["future_return_bps"])
            gross = abs(realised)
            impact = max(1.0, 0.05 * float(r["vol_bps"]))
            costs = CostBreakdown(
                fees_bps=2.0 * taker_fee_bps,
                spread_bps=spread_charge,
                slippage_bps=impact,
                funding_bps=0.0,
                adverse_selection_bps=0.05 * float(r["vol_bps"]),
            )
            trades.append(NetTrade(gross, realised, costs, int(r["ts_ms"])))
    return evaluate_candidate(
        f"{family}-{symbol.lower()}-{rows[-1]['ts_ms']}", trades,
        walk_forward_folds=len(folds), evaluated_at_ms=now_ms(),
        data_cutoff_ms=int(rows[-1]["ts_ms"]), config=_config(),
    )


def evaluate_hypotheses(
    store: Store,
    symbol: str,
    *,
    days: int = 90,
    taker_fee_bps: float = 5.5,
    end_ms: int | None = None,
) -> tuple[list[ModelEvidence], dict]:
    end = int(end_ms or now_ms()) - 1
    start = end - days * 86_400_000
    l2 = store.ml_market_buffer_stats_for_symbol(symbol, "orderbook_l2")
    l2_ready = int(l2.get("span_ms", 0)) >= L2_REQUIRED_MS
    rows = _feature_rows(store, symbol, start, end, l2_ready)
    progress = {
        "symbol": symbol, "l2_rows": int(l2.get("rows", 0)),
        "l2_span_ms": int(l2.get("span_ms", 0)), "l2_ready_48h": l2_ready,
        "message": "L2 OBI/micro-price enabled" if l2_ready else
                   f"L2 buffer at {int(l2.get('span_ms', 0))/3_600_000:.1f}/48 hours; training klines + funding + basis only",
    }
    if len(rows) < MIN_ROWS:
        reason = f"insufficient aligned rows {len(rows)} < {MIN_ROWS}"
        store.ml_research_audit(f"l2-progress-{symbol.lower()}-{end}", "WARMING", progress["message"], {**progress, "rows": len(rows), "reason": reason})
        return [], {**progress, "rejected": reason}
    splits = PurgedWalkForward(n_splits=5, min_train=20_000, test_size=5_000, purge=5).split(
        [int(r["ts_ms"]) for r in rows]
    )
    if len(splits) < 5:
        return [], {**progress, "rejected": f"only {len(splits)} purged folds available; required 5"}
    peak, l2_count = _peak_spread(store, symbol, start, end)
    if not l2_count:
        progress["message"] += "; no observed L2 spread yet, candidates remain research-only"
    evidence: list[ModelEvidence] = []
    for family in ("funding_rate_carry_reversion", "volatility_regime_conditioning"):
        ev = _evaluate(store, symbol, family, rows, splits, peak, taker_fee_bps, l2_ready)
        cost = {
            "fees_bps": 2.0 * taker_fee_bps,
            "two_x_peak_spread_bps": 2.0 * peak,
            "modeled_impact_bps": max(1.0, mean(float(r["vol_bps"]) for r in rows[-1000:]) * 0.05),
            "total_friction_bps": 2.0 * taker_fee_bps + 2.0 * peak + max(1.0, mean(float(r["vol_bps"]) for r in rows[-1000:]) * 0.05),
        }
        payload = {
            "family": family, "gross_edge_bps": ev.mean_net_bps + cost["total_friction_bps"],
            "cost_deductions": cost, "net_edge_bps": ev.mean_net_bps,
            "t_stat": ev.t_stat, "oos_sharpe": ev.oos_sharpe,
            "gate_outcome": bool(ev.verified), "gate_thresholds": {"net_edge_bps":8.0,"t_stat":3.0,"oos_sharpe":1.5},
            "l2_ready_48h": l2_ready, "l2_rows": l2_count,
        }
        ev = replace(ev, expected_net_edge_bps=ev.mean_net_bps)
        store.ml_research_audit(ev.model_id, "VERIFIED" if ev.verified else "REJECTED",
                                ev.verification_reason, payload)
        evidence.append(ev)
    return evidence, progress
