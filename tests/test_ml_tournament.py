#!/usr/bin/env python3
"""Friction model + champion/challenger tournament.

The tests are grouped by the property they defend, because each group exists to stop a specific
class of wrong answer:

  * FEE/FEE-CONVENTION   — the per-side bug that understated every round trip by 5.5 bps
  * ADVERSE SELECTION    — must be dynamic (OBI + decay) and must never manufacture edge
  * THE 8 BPS GATE       — the spec's exact rejection rule, including at the boundary
  * WALK-FORWARD GEOMETRY— the OOS windows must span the data, not cluster at the front
  * CAUSALITY            — no future bar may influence a past feature
  * FALSIFIABILITY       — the gates MUST be able to admit a genuinely good candidate. Without this,
                           "no candidate passed" is indistinguishable from "the gate is broken",
                           and a negative result becomes unfalsifiable.
  * HOT-SWAP             — promotion requires beating the incumbent recently, not just lifetime

Run: python3 -m pytest tests/test_ml_tournament.py -q
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.ml.friction import (  # noqa: E402
    BYBIT_MAKER_FEE_BPS,
    BYBIT_TAKER_FEE_BPS,
    DEFAULT_HURDLE_BPS,
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
from gpkg.ml.lifecycle import CostBreakdown, ModelEvidence, ModelState, NetTrade  # noqa: E402
from gpkg.ml.tournament import (  # noqa: E402
    STRICT_GATE,
    CandidateParams,
    _fold_geometry,
    compute_features,
    hot_swap_decision,
    simulate,
)


def mk_trade(net_bps: float, ts_ms: int = 1_000_000) -> NetTrade:
    """A trade whose NET equals `net_bps`, expressed as gross with zero cost."""
    return NetTrade(gross_edge_bps=net_bps, realised_gross_pnl_bps=net_bps,
                    costs=CostBreakdown(), timestamp_ms=ts_ms)


# =============================================================================================
# FEE CONVENTION
# =============================================================================================
def test_published_bybit_baselines():
    assert BYBIT_MAKER_FEE_BPS == 2.0, "0.020% maker"
    assert BYBIT_TAKER_FEE_BPS == 5.5, "0.055% taker"


def test_fees_are_charged_per_side_and_multiplied_for_a_round_trip():
    """The bug this pins: charging a per-side rate once understates every round trip by a full fee
    unit — ~5.5 bps at VIP0 taker, enough to admit negative-expectancy trades against a 3 bps hurdle."""
    assert fee_bps("taker") == 11.0
    assert fee_bps("maker") == 4.0
    assert fee_bps("taker", round_trip_multiple=1.0) == 5.5


def test_maker_is_strictly_cheaper_than_taker():
    """This spread (7 bps/round trip) is the economic reason maker-first routing matters."""
    assert fee_bps("taker") - fee_bps("maker") == 7.0


# =============================================================================================
# ADVERSE SELECTION (dynamic, OBI-driven)
# =============================================================================================
def test_obi_sign_convention():
    assert order_book_imbalance(100, 100) == pytest.approx(0.0)
    assert order_book_imbalance(300, 100) > 0, "bid-heavy => positive"
    assert order_book_imbalance(100, 300) < 0, "ask-heavy => negative"
    assert order_book_imbalance(0, 0) == 0.0, "degenerate book must not raise"


def test_hostility_is_directional():
    ask_heavy = order_book_imbalance(20, 300)   # -0.875
    bid_heavy = order_book_imbalance(300, 20)   # +0.875
    assert hostile_imbalance("Buy", ask_heavy) > 0.5, "a resting BUY is exposed to a heavy ASK wall"
    assert hostile_imbalance("Sell", bid_heavy) > 0.5
    assert hostile_imbalance("Buy", bid_heavy) == 0.0, "a favourable book is NOT credited"
    assert hostile_imbalance("Sell", ask_heavy) == 0.0


def test_favourable_imbalance_never_creates_negative_cost():
    """A cost model must not become a signal generator. Crediting favourable imbalance would let a
    hypothesis bank edge that is really just the absence of a cost."""
    for side, obi in [("Buy", 0.9), ("Sell", -0.9)]:
        assert adverse_selection_bps(side=side, spread_bps=5.0, obi=obi) >= 0.0


def test_adverse_selection_is_monotone_in_all_three_drivers():
    base = adverse_selection_bps(side="Buy", spread_bps=2.0, obi=0.0, quote_age_ms=0)
    wider = adverse_selection_bps(side="Buy", spread_bps=6.0, obi=0.0, quote_age_ms=0)
    hostile = adverse_selection_bps(side="Buy", spread_bps=2.0, obi=-0.9, quote_age_ms=0)
    stale = adverse_selection_bps(side="Buy", spread_bps=2.0, obi=-0.9, quote_age_ms=5000)
    assert wider > base, "wider spread => more cost"
    assert hostile > base, "hostile book => more cost"
    assert stale > hostile, "older quote => more cost (L2 information has decayed)"


def test_snapshot_decay_bounds():
    assert snapshot_decay(0) == 0.0
    assert snapshot_decay(-5) == 0.0
    assert 0.0 < snapshot_decay(1000) < 1.0
    assert snapshot_decay(10 ** 9) > 0.99


def test_adverse_selection_is_capped():
    """A pathological input must not let one term dominate the whole model."""
    v = adverse_selection_bps(side="Buy", spread_bps=100.0, obi=-1.0, quote_age_ms=10 ** 9,
                              base_fraction=0.2, obi_sensitivity=0.8, max_multiple=2.0)
    assert v <= 100.0 * 2.0 + 1e-9


def test_market_impact_refuses_an_unreadable_book():
    """An order larger than a book we cannot read has unbounded cost. Returning a finite number
    there would be a fabrication that the hurdle then waves through."""
    assert market_impact_bps(1000.0, 0.0) == math.inf
    assert market_impact_bps(1000.0, -1.0) == math.inf
    assert market_impact_bps(1000.0, 1000.0) == pytest.approx(10.0)
    assert market_impact_bps(100.0, 1000.0) < market_impact_bps(1000.0, 1000.0)


# =============================================================================================
# THE +8.0 BPS GATE
# =============================================================================================
def test_hurdle_is_eight_bps():
    assert DEFAULT_HURDLE_BPS == 8.0


def test_positive_gross_edge_below_hurdle_is_rejected_by_name():
    """The spec's exact rule, and the reason string must name the cause so the audit log shows
    'friction ate the edge' rather than a bare 'rejected'."""
    f = build_friction(liquidity="taker", measured_peak_spread_bps=1.0, side="Buy", obi=0.0,
                       funding_bps=0.0)
    a = evaluate_admission(20.0, f)
    assert a.admitted is False
    assert a.gross_bps > 0
    assert "positive_gross_edge_collapsed_below_hurdle" in a.reason
    assert a.net_bps < 8.0


def test_boundary_is_inclusive_at_exactly_the_hurdle():
    """>= 8.0 admits; a hair below refuses. An off-by-one here silently changes the strategy."""
    f = build_friction(liquidity="maker", measured_peak_spread_bps=0.0, side="Buy", obi=0.0)
    gross = 8.0 + f.total_bps
    assert evaluate_admission(gross, f).admitted is True
    assert evaluate_admission(gross - 0.01, f).admitted is False


def test_unbounded_friction_is_refused_not_admitted():
    f = build_friction(liquidity="maker", measured_peak_spread_bps=1.0, side="Buy", obi=0.0,
                       notional_usd=5000.0, depth_notional_usd=0.0)
    a = evaluate_admission(1000.0, f)
    assert a.admitted is False
    assert a.reason == "friction_unbounded_depth_or_spread"


def test_worst_case_spread_doubles_and_is_infinite_when_unmeasured():
    assert worst_case_spread_bps(2.0) == pytest.approx(4.0)
    assert worst_case_spread_bps(float("inf")) == math.inf


def test_taker_crossing_requires_the_higher_twelve_bps_bar():
    """Crossing pays the fee AND the spread, so it must clear a strictly harder hurdle than resting."""
    extra = (BYBIT_TAKER_FEE_BPS - BYBIT_MAKER_FEE_BPS) * 2 + 2.0   # 9.0 bps
    ok, why = taker_crossing_allowed(25.0, 40.0, taker_extra_cost_bps=extra)
    assert ok is True and "12" in why or "justified" in why
    ok2, why2 = taker_crossing_allowed(12.0, 40.0, taker_extra_cost_bps=extra)
    assert ok2 is False and "below_taker_hurdle" in why2
    ok3, _ = taker_crossing_allowed(50.0, -1.0, taker_extra_cost_bps=extra)
    assert ok3 is False, "no gross edge to cross on"


# =============================================================================================
# STRICT GATE CONFIGURATION
# =============================================================================================
def test_the_engines_config_matches_the_spec_exactly():
    """The previous ValidationConfig defaults were sharpe=0.0, t=0.0, pf=1.05, edge=0.0 — the
    spec's gates were effectively switched off. This pins them ON."""
    assert STRICT_GATE.min_edge_bps == 8.0
    assert STRICT_GATE.min_mean_net_bps == 8.0
    assert STRICT_GATE.min_oos_sharpe == 1.8
    assert STRICT_GATE.min_profit_factor == 1.75
    assert STRICT_GATE.min_t_stat == 3.0
    assert STRICT_GATE.min_walk_forward_folds == 5
    assert STRICT_GATE.min_oos_trades == 30
    assert STRICT_GATE.max_one_sided_p_value <= 0.05


# =============================================================================================
# WALK-FORWARD GEOMETRY — the bug that made OOS evaluation 0.4% of the data
# =============================================================================================
def test_folds_span_the_dataset_not_just_the_front():
    n = 129_599
    ts = list(range(0, n))
    folds = _fold_geometry(ts, STRICT_GATE)
    assert len(folds) == 5, "must produce exactly 5 folds; one fewer silently fails the fold gate"
    covered = sum(te.stop - te.start for _tr, te in folds)
    frac = covered / n
    assert frac > 0.7, f"OOS coverage too small: {frac:.3f}"
    # The specific regression: windows clustered in the first ~700 bars.
    last_test_end = max(te.stop for _tr, te in folds)
    assert last_test_end > n * 0.9, "the final fold must reach the end of the dataset"


def test_folds_never_overlap_and_are_strictly_ordered():
    ts = list(range(0, 20_000))
    folds = _fold_geometry(ts, STRICT_GATE)
    prev_end = -1
    for tr, te in folds:
        assert tr.stop <= te.start, "training must end before the test window (purge respected)"
        assert te.start >= prev_end, "test windows must not overlap"
        prev_end = te.stop


def test_fold_geometry_degrades_safely_on_tiny_datasets():
    assert _fold_geometry(list(range(0, 100)), STRICT_GATE) == []


# =============================================================================================
# CAUSALITY — no future bar may influence a past feature
# =============================================================================================
def _synth_klines(n: int, seed: int = 5) -> list[dict]:
    rng = random.Random(seed)
    px = 20_000.0
    out = []
    for i in range(n):
        o = px
        r = rng.gauss(0, 0.0006)
        px = px * (1 + r)
        hi = max(o, px) * (1 + abs(rng.gauss(0, 0.0002)))
        lo = min(o, px) * (1 - abs(rng.gauss(0, 0.0002)))
        out.append({"ts_ms": 1_700_000_000_000 + i * 60_000, "open": o, "high": hi, "low": lo,
                    "close": px, "volume": 1.0})
    return out


def test_features_are_causal():
    """Truncating the series must not change any feature at an earlier index. If it does, the
    feature saw the future and every backtest using it is fiction."""
    full = _synth_klines(1000)
    f_full = compute_features(full)
    cut = 700
    f_cut = compute_features(full[:cut + 1])
    for i in (200, 400, 700):
        assert f_cut.vol_bps[i] == pytest.approx(f_full.vol_bps[i])
        assert f_cut.atr[i] == pytest.approx(f_full.atr[i])
        assert f_cut.momentum[i] == pytest.approx(f_full.momentum[i])


def test_funding_series_is_forward_filled_not_back_filled():
    """A bar BEFORE the first funding print must show no funding. Back-filling would hand the past a
    number that did not exist yet."""
    kl = _synth_klines(500)
    rows = [{"ts_ms": kl[300]["ts_ms"], "funding_bps": 1.0},
            {"ts_ms": kl[400]["ts_ms"], "funding_bps": 2.0}]
    f = compute_features(kl, funding_rows=rows)
    assert f.funding_bps[100] == 0.0, "no funding existed at bar 100"
    assert f.funding_bps[350] == pytest.approx(1.0), "holds the last print"
    assert f.funding_bps[450] == pytest.approx(2.0)


def test_funding_row_accepts_both_stored_keys():
    """The store writes `funding_bps` and `funding_rate`. Reading a key named `rate` silently yielded
    0.0 for every symbol, which made the funding family untradeable without any error surfacing."""
    from gpkg.ml.tournament import _funding_row_bps
    assert _funding_row_bps({"funding_bps": 0.35}) == pytest.approx(0.35)
    assert _funding_row_bps({"funding_rate": 3.5e-05}) == pytest.approx(0.35)
    assert _funding_row_bps({}) is None, "unknown schema must be None, never a plausible 0.0"


# =============================================================================================
# SIMULATION
# =============================================================================================
def _bar(ts, o, h, l, c):
    return {"ts_ms": ts, "open": o, "high": h, "low": l, "close": c, "volume": 1.0}


def test_stop_wins_when_one_bar_could_hit_both():
    """Pessimistic tie-break. Assuming the target instead is how a backtest invents an edge."""
    bars = []
    # flat lead-in so ATR is computable and small
    for i in range(60):
        bars.append(_bar(1_700_000_000_000 + i * 60_000, 100.0, 100.1, 99.9, 100.0))
    # a bar that spans far beyond both stop and target
    bars.append(_bar(1_700_000_000_000 + 60 * 60_000, 100.0, 130.0, 70.0, 100.0))
    for i in range(61, 200):
        bars.append(_bar(1_700_000_000_000 + i * 60_000, 100.0, 100.1, 99.9, 100.0))
    f = compute_features(bars)
    p = CandidateParams(symbol="T", family="vol_regime", vol_low_bps=0.0, vol_high_bps=1e9,
                        funding_horizon_bars=1, microprice_lookahead_bars=0,
                        entry_threshold=0.0, liquidity="maker",
                        atr_stop_mult=0.5, atr_tp_mult=0.5, max_holding_bars=50)
    trades = simulate(f, p, spread_bps=0.0, l2_ready=True, funding_bps=0.0)
    assert trades, "expected at least one trade"
    assert all(t.realised_gross_pnl_bps <= 0 for t in trades), (
        "a bar spanning both stop and target must be resolved as the STOP (negative gross)"
    )


def test_simulate_charges_friction_on_every_trade():
    f = compute_features(_synth_klines(600))
    p = CandidateParams(symbol="T", family="vol_regime", vol_low_bps=0.0, vol_high_bps=1e9,
                        funding_horizon_bars=1, microprice_lookahead_bars=0,
                        entry_threshold=0.1, liquidity="maker")
    trades = simulate(f, p, spread_bps=1.0, l2_ready=True, funding_bps=0.0)
    assert trades
    for t in trades:
        assert t.costs.total_bps > 0.0, "no trade may be frictionless"
        assert t.realised_net_pnl_bps == pytest.approx(
            t.realised_gross_pnl_bps - t.costs.total_bps)


# =============================================================================================
# FALSIFIABILITY — the gates MUST be able to pass
# =============================================================================================
def _momentum_klines(n: int = 6000, seed: int = 3, drift: float = 0.0016) -> list[dict]:
    """A series with genuine, self-reinforcing momentum.

    Built deliberately so that a trend-following hypothesis has real gross edge exceeding friction.
    Without a series like this the suite could only ever prove that nothing passes — which is
    exactly the unfalsifiable position this test exists to prevent.
    """
    rng = random.Random(seed)
    px = 20_000.0
    hist: list[float] = []
    out = []
    for i in range(n):
        o = px
        if len(hist) >= 30:
            m = (px - hist[-30]) / hist[-30]
        else:
            m = 0.0
        r = drift * (1.0 if m > 0 else (-1.0 if m < 0 else 0.0)) + rng.gauss(0, 0.00015)
        px = px * (1 + r)
        hi = max(o, px) * (1 + 0.0004)
        lo = min(o, px) * (1 - 0.0004)
        out.append({"ts_ms": 1_700_000_000_000 + i * 60_000, "open": o, "high": hi, "low": lo,
                    "close": px, "volume": 1.0})
        hist.append(px)
    return out


def test_a_genuinely_good_candidate_can_pass_all_four_gates():
    """The decisive falsifiability test.

    It proves the gate configuration is capable of admitting evidence rather than being an
    always-false predicate. Without it, 'no candidate cleared the gates' on real data cannot be
    distinguished from a broken gate, and the whole tournament's negative results mean nothing.
    """
    from gpkg.ml.tournament import evaluate_params
    from gpkg.core.clock import now_ms

    class _S:
        def ml_market_range(self, *a, **k):
            return []
        def ml_research_audit(self, *a, **k):
            pass

    kl = _momentum_klines()
    f = compute_features(kl)
    p = CandidateParams(symbol="SYN", family="vol_regime", vol_low_bps=0.0, vol_high_bps=1e9,
                        funding_horizon_bars=1, microprice_lookahead_bars=0,
                        entry_threshold=0.5, liquidity="maker",
                        atr_stop_mult=3.0, atr_tp_mult=6.0, max_holding_bars=240)
    oc = evaluate_params(_S(), p, features=f, spread_bps=1.0, l2_ready=True, funding_bps=0.0,
                         evaluated_at_ms=now_ms() + 10 ** 9, window_days=90)
    assert oc.trades >= STRICT_GATE.min_oos_trades, f"only {oc.trades} OOS trades"
    assert oc.folds == 5
    assert oc.admission is True, (
        f"a synthetic series with real momentum failed the gates: {oc.rejection}"
    )
    assert oc.net_bps >= 8.0
    assert oc.evidence.oos_sharpe > 1.8
    assert oc.evidence.profit_factor > 1.75
    assert oc.evidence.t_stat > 3.0


def test_insufficient_oos_sample_is_rejected_even_with_attractive_net():
    """A large positive net edge on a handful of trades is noise. This is a real observed case:
    a funding-carry candidate showed +16.6 bps net on 8 OOS trades, which must never be promoted."""
    from gpkg.ml.lifecycle import evaluate_candidate
    trades = [mk_trade(20.0, ts_ms=1_000_000 + i) for i in range(8)]
    ev = evaluate_candidate("tiny", trades, walk_forward_folds=5,
                            evaluated_at_ms=2_000_000, data_cutoff_ms=1_500_000,
                            config=STRICT_GATE)
    assert ev.verified is False
    assert "oos_trades 8 < 30" in ev.verification_reason


def test_evidence_with_future_trades_is_refused():
    """Leakage guard: a trade timestamped after the data cutoff means the evaluation saw the future."""
    from gpkg.ml.lifecycle import evaluate_candidate
    trades = [mk_trade(10.0, ts_ms=999_999_999)]
    with pytest.raises(ValueError, match="leakage refused"):
        evaluate_candidate("leak", trades, walk_forward_folds=5,
                           evaluated_at_ms=2_000_000, data_cutoff_ms=1_000_000,
                           config=STRICT_GATE)


# =============================================================================================
# HOT-SWAP
# =============================================================================================
def _ev(model_id: str, net: float, verified: bool = True,
        state: ModelState = ModelState.VALIDATED) -> ModelEvidence:
    return ModelEvidence(
        model_id=model_id, state=state, oos_trades=100, walk_forward_folds=5,
        mean_net_bps=net, total_net_bps=net * 100, profit_factor=2.0, max_drawdown_bps=10.0,
        one_sided_p_value=0.001, verified=verified,
        verification_reason="ok" if verified else "failed gates",
        evaluated_at_ms=1, data_cutoff_ms=0, t_stat=4.0, oos_sharpe=2.5,
    )


def test_hot_swap_refuses_an_unverified_challenger():
    ok, why = hot_swap_decision(_ev("c", 20.0), _ev("x", 30.0, verified=False))
    assert ok is False and "failed strict gates" in why


def test_first_verified_challenger_takes_an_empty_slot():
    ok, why = hot_swap_decision(None, _ev("x", 10.0))
    assert ok is True and "no incumbent" in why


def test_hot_swap_refuses_a_recent_regression_despite_a_better_lifetime_mean():
    """The trap this closes: a challenger with a strong lifetime mean that has STOPPED working.
    Promoting on the lifetime number is how a desk buys a regime change."""
    ok, why = hot_swap_decision(
        _ev("champ", 6.0), _ev("chal", 12.0),
        champion_recent_net_bps=9.0, challenger_recent_net_bps=4.0,
    )
    assert ok is False
    assert "regression" in why
    assert "14d" in why


def test_hot_swap_promotes_on_recent_improvement():
    ok, why = hot_swap_decision(
        _ev("champ", 6.0), _ev("chal", 12.0),
        champion_recent_net_bps=4.0, challenger_recent_net_bps=11.0,
    )
    assert ok is True and "no regression" in why


def test_hot_swap_requires_improvement_when_no_recent_window_exists():
    ok, why = hot_swap_decision(_ev("champ", 12.0), _ev("chal", 6.0))
    assert ok is False and "does not improve" in why


# =============================================================================================
# CLI SURFACES — EVERY output format is a code path and must be exercised
# =============================================================================================
@pytest.mark.parametrize("fmt", ["json", "table"])
def test_tournament_status_cli_works_in_both_formats(tmp_path, monkeypatch, capsys, fmt):
    """`--format json` shipped BROKEN with an UnboundLocalError.

    `import json` lived inside the sibling `audit-summary` branch, which made `json` a function-local
    name — unbound when `tournament-status` reached it. Manual testing only ran `--format table`, so
    the DEFAULT path was broken and CI's linter found it as F821 before a user did. The lesson is
    that an output format is a code path, and an unexercised code path is one that ships broken.
    """
    from scripts.ml_research import main
    db = tmp_path / "cli.db"
    monkeypatch.setattr(sys, "argv",
                        ["gigpilot", "tournament-status", "--db", str(db), "--format", fmt])
    rc = main()
    out = capsys.readouterr().out
    assert rc == 0, "the CLI must exit 0 with no tournament, not raise"
    assert "no tournament has run yet" in out
    if fmt == "json":
        assert json.loads(out)["available"] is False, "JSON path must emit parseable JSON"


def test_audit_summary_json_still_works_after_shared_import(tmp_path, monkeypatch, capsys):
    """`audit-summary` previously did its own function-local `import json`. Hoisting it to module
    level is what fixes the sibling command, so this pins that the ORIGINAL command still works."""
    from scripts.ml_research import main
    db = tmp_path / "cli2.db"
    monkeypatch.setattr(sys, "argv", ["gigpilot", "audit-summary", "--db", str(db), "--format", "json"])
    assert main() == 0
    assert json.loads(capsys.readouterr().out) == []


def test_gigpilot_cli_rejects_an_unknown_ml_subcommand():
    """A typo must fail loudly rather than silently dispatch to a different parser."""
    src = (ROOT / "bin" / "gigpilot").read_text()
    assert "unknown ml subcommand" in src
    for cmd in ("tournament", "tournament-status"):
        assert cmd in src, f"{cmd} must be reachable from the operator CLI"


# =============================================================================================
# DUPLICATE SUPPRESSION
# =============================================================================================
def test_repeated_candidates_are_not_reported_twice():
    """Elites carry into the next generation. Without memoisation the same hypothesis was
    re-evaluated (wasted compute) AND appended again to the report, so the 'closest to passing'
    list showed duplicates and read as though several candidates had tied."""
    from gpkg.ml.tournament import run_tournament

    class _Store:
        def __init__(self):
            self.kv = {}
            self.audits = []
        def ml_market_range(self, symbol, kind, start, end):
            if kind == "kline_1m":
                return [{"ts_ms": k["ts_ms"], "open": k["open"], "high": k["high"],
                         "low": k["low"], "close": k["close"], "volume": 1.0}
                        for k in _momentum_klines(2500)]
            return []
        def ml_research_audit(self, model_id, outcome, reason, payload):
            self.audits.append((model_id, outcome))
        def kv_set(self, k, v):
            self.kv[k] = v
        def kv_get(self, k):
            return self.kv.get(k)

    st = _Store()
    res = run_tournament(st, "SYN", generations=3, population_size=6, seed=4, window_days=90)
    ids = [r["model_id"] for r in res.rejected_summary]
    assert len(ids) == len(set(ids)), f"duplicate candidates reported: {len(ids)} rows, {len(set(ids))} unique"
    audit_ids = [a[0] for a in st.audits if a[1] in ("ADMIT", "REJECT")]
    assert len(audit_ids) == len(set(audit_ids)), "the same candidate was audited more than once"
    assert res.evaluated == len(set(ids))
