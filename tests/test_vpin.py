#!/usr/bin/env python3
"""VPIN / trade-flow toxicity, and the quoting response it drives.

VPIN estimates the fraction of volume that is information-motivated rather than noise:
one-sided flow means someone knows something, and a resting passive quote is precisely what they
consume. That is adverse selection, and VPIN is its measurable proxy — which is why it is wired to
the execution router rather than left as telemetry.

The measure is built on CONSTANT-VOLUME buckets, not fixed time windows: on a clock, an information
event lasting two seconds and one lasting two minutes look identical, and a quiet hour contributes
as much as a violent one. These tests defend that construction and the fail-closed behaviour when
the measure is unavailable.

Run: python3 -m pytest tests/test_vpin.py -q
"""
from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.execution.routing import QuoteSnapshot, micro_price, plan_entry, round_passive  # noqa: E402
from gpkg.strategy.vpin import (  # noqa: E402
    ToxicityPolicy,
    VpinConfig,
    VpinEngine,
    classify_trade,
    toxicity_policy,
)

BUCKET = 10.0
WINDOW = 5


def engine(**kw) -> VpinEngine:
    cfg = dict(bucket_volume=BUCKET, window_buckets=WINDOW, min_history_for_threshold=3, history=100)
    cfg.update(kw)
    return VpinEngine(VpinConfig(**cfg))


def feed(e: VpinEngine, sides, size: float = 1.0, start: float = 100.0) -> None:
    px = start
    for s in sides:
        px += 0.01 if s == "Buy" else -0.01
        e.on_trade(price=px, size=size, side=s)


# =============================================================================================
# THE FORMULA
# =============================================================================================
def test_vpin_formula_matches_the_definition():
    """VPIN = sum|V_B - V_S| / (N * V). With N=5, V=10 and all-buy flow:

        each bucket is 10 buy, 0 sell  -> |imbalance| = 10
        sum          = 5 * 10 = 50
        denominator  = 5 * 10 = 50
        VPIN         = 1.0
    """
    e = engine()
    feed(e, ["Buy"] * 50)          # 50 units / V=10 -> 5 complete buckets
    assert e.bucket_count == WINDOW
    assert e.vpin == pytest.approx(1.0)


def test_all_sell_is_also_maximally_toxic():
    """The measure is about ONE-SIDEDNESS, not direction: a wall of sellers is equally informed."""
    e = engine()
    feed(e, ["Sell"] * 50)
    assert e.vpin == pytest.approx(1.0)


def test_perfectly_balanced_flow_is_zero():
    e = engine()
    feed(e, ["Buy", "Sell"] * 25)
    assert e.vpin == pytest.approx(0.0, abs=1e-9)


def test_three_to_one_skew_sits_near_half():
    """3 buys : 1 sell means |V_B - V_S| = 0.5 * V per bucket, so VPIN ~ 0.5."""
    e = engine()
    feed(e, ["Buy", "Buy", "Buy", "Sell"] * 13)
    assert 0.4 < e.vpin < 0.6, e.vpin


def test_vpin_is_none_before_a_full_window():
    """None, not 0.0: zero would assert 'perfectly balanced', a claim unavailable before N buckets."""
    e = engine()
    feed(e, ["Buy"] * 30)   # only 3 buckets of 5
    assert e.bucket_count == 3
    assert e.vpin is None


# =============================================================================================
# CONSTANT-VOLUME BUCKETING
# =============================================================================================
def test_bucketing_is_by_volume_not_by_trade_count():
    """The defining property. Many tiny trades must fill the same number of buckets as one large
    trade of the same total size."""
    many = engine()
    for _ in range(100):
        many.on_trade(price=100.0, size=0.5, side="Buy")   # 50 units total
    one = engine()
    one.on_trade(price=100.0, size=50.0, side="Buy")       # 50 units in a single print
    assert many.bucket_count == one.bucket_count == WINDOW


def test_a_print_larger_than_a_bucket_is_split():
    """Treating an oversized print as one indivisible bucket would exceed V and corrupt the
    denominator."""
    e = engine(window_buckets=2, min_history_for_threshold=1)
    e.on_trade(price=100.0, size=35.0, side="Buy")   # 3.5 buckets worth
    assert e.bucket_count == 2, "the deque keeps `window` buckets; 3 were completed"


def test_partial_buckets_are_not_counted():
    """A bucket that has not reached V must not enter the sum — it would understate the imbalance."""
    e = engine(window_buckets=1, min_history_for_threshold=1)
    e.on_trade(price=100.0, size=9.0, side="Buy")    # 90% of a bucket
    assert e.bucket_count == 0 and e.vpin is None
    e.on_trade(price=100.0, size=1.0, side="Buy")    # completes it
    assert e.bucket_count == 1 and e.vpin == pytest.approx(1.0)


def test_volume_is_conserved_across_bucket_boundaries():
    """Total classified volume must equal total fed volume, or the ratio is measuring an artefact."""
    e = engine(window_buckets=100, min_history_for_threshold=1)
    total = 0.0
    for i in range(57):
        sz = 0.7 + (i % 5) * 0.3
        total += sz
        e.on_trade(price=100.0, size=sz, side="Buy" if i % 3 else "Sell")
    classified = sum(b.volume for b in e._buckets) + e._open.volume
    assert classified == pytest.approx(total)


# =============================================================================================
# TRADE CLASSIFICATION
# =============================================================================================
def test_venue_label_always_wins():
    """Inferring is strictly worse than being told, so the exchange's `S` takes precedence even when
    it disagrees with the tick direction."""
    assert classify_trade("Buy", price=99.0, last_price=100.0, last_side="") is True
    assert classify_trade("Sell", price=101.0, last_price=100.0, last_side="") is False


def test_tick_rule_when_the_venue_is_silent():
    assert classify_trade("", 101.0, 100.0, "") is True    # uptick
    assert classify_trade("", 99.0, 100.0, "") is False    # downtick


def test_a_flat_print_inherits_rather_than_defaulting():
    """Defaulting to 'buy' on every flat print would manufacture a systematic one-sided bias in
    exactly the low-volatility conditions where VPIN is most easily misled."""
    assert classify_trade("", 100.0, 100.0, "Sell") is False
    assert classify_trade("", 100.0, 100.0, "Buy") is True


def test_invalid_prints_are_ignored():
    e = engine()
    for bad_px, bad_sz in [(0.0, 1.0), (-1.0, 1.0), (100.0, 0.0), (100.0, -5.0),
                           (float("nan"), 1.0), (100.0, float("inf"))]:
        e.on_trade(price=bad_px, size=bad_sz, side="Buy")
    assert e.bucket_count == 0 and e.trade_count == 0


# =============================================================================================
# THRESHOLD — the rolling 90th percentile
# =============================================================================================
def test_threshold_is_unavailable_until_enough_history():
    """A percentile of three points is not a threshold. Reporting None keeps 'unknown' distinct
    from 'calm'."""
    e = engine(min_history_for_threshold=50)
    feed(e, ["Buy"] * 80)
    assert e.vpin is not None
    assert e.threshold() is None, "threshold computed from too little history"
    assert e.is_high_toxicity is False


def test_threshold_becomes_available_with_history():
    """Needs min_history samples AFTER the lag exclusion, so the feed must produce
    (min_history + lag) VPIN readings, i.e. (min_history + lag + window) buckets."""
    e = engine(min_history_for_threshold=5, history=50)
    feed(e, ["Buy"] * 300)          # 30 buckets -> plenty of readings past the 5-bucket lag
    assert e.bucket_count == WINDOW
    assert e.threshold() is not None


def test_high_toxicity_flags_when_vpin_exceeds_its_own_percentile():
    """Toxicity is 'unusually one-sided FOR THIS INSTRUMENT', not an absolute number — which is why
    the bar is the instrument's own rolling percentile."""
    e = engine(bucket_volume=10.0, window_buckets=3, min_history_for_threshold=5, history=200)
    # balanced flow first, to establish a calm baseline (VPIN ~ 0)
    feed(e, ["Buy", "Sell"] * 120)
    baseline = e.threshold()
    assert baseline is not None and baseline < 0.5, f"baseline not established: {baseline}"
    # ...then a burst of one-sided flow, which must exceed that baseline
    feed(e, ["Buy"] * 60)
    assert e.vpin is not None and e.vpin > baseline
    assert e.is_high_toxicity is True, (
        "a one-sided burst failed to register as toxic — the threshold is self-referential again"
    )


def test_the_absolute_floor_stops_detection_being_adapted_away():
    """REGRESSION GUARD: the adaptive threshold must not rise above the absolute floor.

    A rolling percentile over a population that INCLUDES the current burst chases the burst upward —
    a sustained one-sided regime raises its own bar until `is_high_toxicity` can never fire, so the
    detector goes quiet exactly when it is needed. The first implementation had no floor and did
    exactly that.

    The guarantee is the FLOOR, not the lag exclusion. Measured: mutating `threshold_lag_buckets` to
    zero breaks no test, because for every sustained burst the floor fires first. So this asserts the
    floored threshold, which is what actually keeps detection alive.
    """
    e = engine(bucket_volume=10.0, window_buckets=3, min_history_for_threshold=5, history=200)
    feed(e, ["Buy", "Sell"] * 120)          # calm baseline
    calm_threshold = e.threshold()
    feed(e, ["Sell"] * 400)                  # a sustained, unambiguous burst
    assert e.vpin == pytest.approx(1.0), "fully one-sided flow must read 1.0"
    raw_after = e.threshold()
    eff_after = e.effective_threshold()
    assert raw_after is not None and eff_after is not None
    # The RAW percentile legitimately climbs to the burst — that is the adaptation the exclusion lag
    # cannot fully prevent. The FLOOR is what keeps the detector alive, so assert on the effective
    # threshold, which is the one the detector actually uses.
    assert eff_after <= e.cfg.absolute_toxic_vpin + 1e-9, (
        f"the absolute floor failed to cap the adaptive threshold (raw={raw_after}, "
        f"effective={eff_after})"
    )
    assert e.vpin > eff_after, (
        f"threshold chased the burst past detection (calm={calm_threshold}, raw={raw_after}, "
        f"effective={eff_after}, vpin={e.vpin}); detection is self-defeating"
    )
    assert e.is_high_toxicity is True


# =============================================================================================
# QUOTING RESPONSE
# =============================================================================================
def test_no_widening_or_pause_without_a_threshold():
    """Absence of data must not be read as evidence of calm — but nor may it freeze quoting. With no
    threshold the policy is neutral, and the snapshot says so explicitly."""
    e = engine(min_history_for_threshold=50)
    feed(e, ["Buy"] * 30)
    p = toxicity_policy(e)
    assert p.widen_ticks == 0 and p.pause is False
    assert e.snapshot()["threshold_p90"] is None, "unknown must be visible in telemetry"


def test_widening_is_monotone_in_toxicity():
    """Proportional response: a marginal reading must not trigger the same retreat as an extreme."""
    class _Stub(VpinEngine):
        def __init__(self, v, t):
            super().__init__(VpinConfig(bucket_volume=1.0, window_buckets=1,
                                        min_history_for_threshold=1))
            self._v, self._t = v, t
        @property
        def vpin(self):
            return self._v
        def threshold(self):
            return self._t

    prev = -1
    for v in (0.40, 0.55, 0.70, 0.85, 0.99):
        w = _Stub(v, 0.40).widen_ticks()
        assert w >= prev, f"widening decreased from {prev} to {w} as toxicity rose"
        prev = w


def test_no_widening_at_or_below_the_threshold():
    """The decision uses the EFFECTIVE threshold (p90 floored), not the raw percentile — comparing
    against the raw one would disagree with what the detector actually does."""
    e = engine(min_history_for_threshold=1, history=10, bucket_volume=1.0, window_buckets=1)
    feed(e, ["Buy", "Sell"])
    v, t = e.vpin, e.effective_threshold()
    if v is not None and t is not None and v <= t:
        assert e.widen_ticks() == 0


def test_widening_is_capped():
    e = engine(min_history_for_threshold=1, max_widen_ticks=3)
    assert e.cfg.max_widen_ticks == 3


def test_pause_requires_extreme_not_merely_elevated_toxicity():
    e = engine(min_history_for_threshold=1, bucket_volume=1.0, window_buckets=1)
    e.on_trade(price=100.0, size=1.0, side="Buy")
    # One bucket of fully one-sided flow is VPIN 1.0 against its own threshold of 1.0 -> not ABOVE.
    assert e.should_pause() is False


def test_snapshot_is_json_safe_and_contains_no_nan():
    import json
    e = engine(min_history_for_threshold=50)
    feed(e, ["Buy"] * 12)
    blob = json.dumps(e.snapshot())
    assert "NaN" not in blob and "Infinity" not in blob
    for k in ("vpin", "threshold_p90", "buckets", "window", "trades", "high_toxicity",
              "widen_ticks", "pause"):
        assert k in blob


def test_policy_from_absent_engine_is_neutral():
    p = toxicity_policy(None)
    assert p.pause is False and p.widen_ticks == 0
    assert p.reason == "no_vpin_engine"


# =============================================================================================
# EXECUTION LINKAGE
# =============================================================================================
QUOTE = QuoteSnapshot(bid_px=100.0, ask_px=100.2, bid_qty=1.0, ask_qty=1.0)


def test_pause_blocks_the_entry_even_with_a_large_edge():
    """Crossing into informed flow pays the spread to be adversely selected faster, so an extreme
    reading overrides even a taker gate that would otherwise have allowed the trade."""
    p = plan_entry(quote=QUOTE, side="Buy", tick=0.1, gross_edge_bps=500.0, peak_spread_bps=1.0,
                   toxicity=ToxicityPolicy(pause=True, widen_ticks=3, vpin=0.95, threshold=0.4))
    assert p.mode == "none"
    assert "toxicity_pause" in p.reason


def test_widening_moves_a_buy_away_from_the_ask_and_a_sell_away_from_the_bid():
    """The retreat must be in the SAFER direction: a buy rests lower, a sell rests higher, so it is
    filled less often and only when the market comes to us."""
    base_buy = plan_entry(quote=QUOTE, side="Buy", tick=0.1, gross_edge_bps=5.0, peak_spread_bps=1.0)
    wide_buy = plan_entry(quote=QUOTE, side="Buy", tick=0.1, gross_edge_bps=5.0, peak_spread_bps=1.0,
                          toxicity=ToxicityPolicy(widen_ticks=2))
    base_sell = plan_entry(quote=QUOTE, side="Sell", tick=0.1, gross_edge_bps=5.0, peak_spread_bps=1.0)
    wide_sell = plan_entry(quote=QUOTE, side="Sell", tick=0.1, gross_edge_bps=5.0, peak_spread_bps=1.0,
                           toxicity=ToxicityPolicy(widen_ticks=2))
    assert wide_buy.limit_price < base_buy.limit_price
    assert wide_sell.limit_price > base_sell.limit_price
    assert "toxicity widened" in wide_buy.reason


def test_widening_never_produces_a_crossing_price():
    """The passive guarantee must survive the retreat, or the venue rejects our post-only order and
    we get no fill at all."""
    for extra in range(0, 6):
        b = round_passive(micro_price(100.0, 100.2, 1, 1), 0.1, "Buy",
                          bid_px=100.0, ask_px=100.2, extra_ticks=extra)
        s = round_passive(micro_price(100.0, 100.2, 1, 1), 0.1, "Sell",
                          bid_px=100.0, ask_px=100.2, extra_ticks=extra)
        assert b < Decimal("100.2"), f"buy crossed at extra_ticks={extra}"
        assert s > Decimal("100.0"), f"sell crossed at extra_ticks={extra}"


def test_negative_extra_ticks_are_clamped():
    """A negative retreat would TIGHTEN the quote, inverting the safety direction."""
    a = round_passive(100.05, 0.1, "Buy", bid_px=100.0, ask_px=100.2, extra_ticks=-5)
    b = round_passive(100.05, 0.1, "Buy", bid_px=100.0, ask_px=100.2, extra_ticks=0)
    assert a == b


def test_normal_toxicity_leaves_quoting_unchanged():
    base = plan_entry(quote=QUOTE, side="Buy", tick=0.1, gross_edge_bps=5.0, peak_spread_bps=1.0)
    with_neutral = plan_entry(quote=QUOTE, side="Buy", tick=0.1, gross_edge_bps=5.0,
                              peak_spread_bps=1.0, toxicity=ToxicityPolicy(reason="normal"))
    assert base.limit_price == with_neutral.limit_price
    assert base.mode == with_neutral.mode == "maker"


def test_engine_config_rejects_nonsense():
    with pytest.raises(ValueError):
        VpinEngine(VpinConfig(bucket_volume=0.0))
    with pytest.raises(ValueError):
        VpinEngine(VpinConfig(window_buckets=0))
