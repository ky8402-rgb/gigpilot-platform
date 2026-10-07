#!/usr/bin/env python3
"""VPIN BUCKET CALIBRATION — the bucket size must follow each instrument's own volume.

Regression origin
-----------------
Every symbol was sized at a flat 25 base units. As a dollar figure that is ~$1.6M per bucket on BTC
(a window spanning weeks) and ~$4k per bucket on SOL (single-trade buckets averaging tick noise).
The same constant was therefore simultaneously far too coarse and far too fine, and neither failure
raised — a wrong sampling rate just measures something else, quietly.

These tests pin the property that matters: for ANY volume distribution, the sizing rule produces a
window of roughly one trading day. That is what makes VPIN comparable across instruments instead of
being an artefact of the guess baked into the default.

Run: python3 tests/test_vpin_calibration.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.strategy.vpin import (
    DEFAULT_BUCKET_VOLUME,
    VpinConfig,
    VpinEngine,
)
from gpkg.strategy.vpin_calibration import (
    BUCKETS_PER_DAY,
    FALLBACK_BUCKET_VOLUME,
    GENERIC_FALLBACK_BUCKET_VOLUME,
    SOURCE_ADV,
    SOURCE_FALLBACK_GENERIC,
    SOURCE_FALLBACK_SYMBOL,
    SOURCE_OVERRIDE,
    adv_from_klines,
    bucket_volume_from_adv,
    describe_resolution,
    is_degraded_source,
    resolve_bucket_volume,
)

# Plausible 24h base-volume distributions, deliberately an order of magnitude apart in UNITS so a
# flat default could not possibly serve both.
BTC_ADV_24H = 800_000.0     # BTC
ETH_ADV_24H = 500_000.0     # ETH
SOL_ADV_24H = 12_000_000.0  # SOL


def _day_of_klines(volume_per_bar: float, bars: int = 288) -> list[list]:
    """`bars` 5-minute klines, NEWEST FIRST, exactly as Bybit returns them."""
    rows = [[i * 300_000, "1", "1", "1", "1", str(volume_per_bar)] for i in range(bars)]
    return list(reversed(rows))


# =============================================================================================
# THE CORE PROPERTY: ~50 buckets per 24h on EVERY distribution
# =============================================================================================
@pytest.mark.parametrize("symbol,adv", [
    ("BTCUSDT", BTC_ADV_24H),
    ("ETHUSDT", ETH_ADV_24H),
    ("SOLUSDT", SOL_ADV_24H),
])
def test_bucket_volume_targets_a_full_window_per_day(symbol, adv):
    """V = ADV/50, so one day of volume is exactly one window — for any instrument."""
    volume, source = resolve_bucket_volume(symbol, adv_24h=adv)
    assert source == SOURCE_ADV
    assert volume == pytest.approx(adv / BUCKETS_PER_DAY)
    # The property, stated directly: a day's volume fills BUCKETS_PER_DAY buckets.
    assert adv / volume == pytest.approx(float(BUCKETS_PER_DAY))


def test_btc_and_eth_get_different_bucket_sizes_from_the_same_rule():
    """The whole point: one rule, two very different instruments, two different answers."""
    btc, btc_src = resolve_bucket_volume("BTCUSDT", adv_24h=BTC_ADV_24H)
    eth, eth_src = resolve_bucket_volume("ETHUSDT", adv_24h=ETH_ADV_24H)
    assert btc_src == eth_src == SOURCE_ADV
    # BTC trades ~1.6x the unit volume, so its bucket is ~1.6x larger. A flat default would make
    # these identical, which is the defect this replaces.
    assert btc > eth
    assert btc / eth == pytest.approx(BTC_ADV_24H / ETH_ADV_24H)
    # And neither is the deprecated constant by accident.
    assert btc != DEFAULT_BUCKET_VOLUME and eth != DEFAULT_BUCKET_VOLUME


def test_bucket_size_adapts_to_the_instrument_not_to_a_baked_in_default():
    """A flat default cannot satisfy two distributions that differ by orders of magnitude."""
    btc, _ = resolve_bucket_volume("BTCUSDT", adv_24h=BTC_ADV_24H)
    sol, _ = resolve_bucket_volume("SOLUSDT", adv_24h=SOL_ADV_24H)
    assert sol / btc > 10.0, "SOL's ADV is 15x BTC's in units; the bucket must track that"
    # Both still yield one window per day, which is the invariant a flat default breaks.
    assert BTC_ADV_24H / btc == pytest.approx(SOL_ADV_24H / sol, rel=1e-9)


def test_end_to_end_a_calibrated_engine_fills_one_window_per_24h():
    """Feed a day of volume and assert the bucket COUNT, not just the arithmetic.

    This is the assertion that would have caught the flat default: driving the real engine with BTC's
    and ETH's volumes, a correct calibration completes ~50 buckets in each case.

    The tolerance is ±1 and the reason is arithmetic rather than leniency. `VpinEngine` closes a
    bucket when its volume reaches `bucket_volume - 1e-12`, an ABSOLUTE epsilon, and summing 288
    slices of a repeating decimal (ETH: 1736.111... per slice) accumulates a residue larger than
    1e-12. The final bucket therefore sits at 99.99999999967% full and stays open, then closes on the
    very next print — a boundary artefact of perfectly uniform synthetic volume, not a sizing error.
    Asserting exactly 50 would be testing the epsilon, not the calibration; the precise claim about
    the SIZE is made by the arithmetic test above, and the claim about the COUNT is "one window per
    day", which ±1 states honestly.
    """
    for symbol, adv in (("BTCUSDT", BTC_ADV_24H), ("ETHUSDT", ETH_ADV_24H)):
        volume, _ = resolve_bucket_volume(symbol, adv_24h=adv)
        engine = VpinEngine(VpinConfig(bucket_volume=volume, window_buckets=BUCKETS_PER_DAY))
        # One day of volume, fed in 288 even slices, alternating aggressor so VPIN stays meaningful.
        slice_volume = adv / 288.0
        for i in range(288):
            engine.on_trade(price=100.0, size=slice_volume, side="Buy" if i % 2 else "Sell")
        assert abs(engine.bucket_count - BUCKETS_PER_DAY) <= 1, (
            f"{symbol}: a day of volume produced {engine.bucket_count} buckets, "
            f"expected ~{BUCKETS_PER_DAY}"
        )


def test_a_flat_default_would_not_have_scaled_across_instruments():
    """Quantifies the defect being fixed, so the fix cannot be reverted on a hunch.

    BTC's ADV over a flat 25-unit bucket is a wild number of buckets per day; ETH's is a different
    wild number. Neither is 50, and they disagree with each other — which is exactly why no single
    constant could be right.
    """
    btc_buckets_per_day = BTC_ADV_24H / DEFAULT_BUCKET_VOLUME
    eth_buckets_per_day = ETH_ADV_24H / DEFAULT_BUCKET_VOLUME
    assert btc_buckets_per_day != 50.0
    assert eth_buckets_per_day != 50.0
    assert btc_buckets_per_day != eth_buckets_per_day


# =============================================================================================
# ADV DERIVATION
# =============================================================================================
def test_adv_sums_the_last_24h_of_klines():
    rows = _day_of_klines(10.0)
    assert adv_from_klines(rows) == pytest.approx(288 * 10.0)


def test_adv_excludes_bars_older_than_the_window():
    """A 48h page must not be summed as if it were 24h — that would halve the bucket size."""
    rows = _day_of_klines(10.0, bars=576)
    adv = adv_from_klines(rows)
    assert adv == pytest.approx(288 * 10.0), "the older 24h of bars leaked into the ADV"


def test_adv_is_none_rather_than_zero_when_there_is_nothing_to_measure():
    """None, not 0.0: an unmeasurable ADV is not a measurement of zero, and 0.0 would size the
    bucket to nothing and divide by it downstream."""
    assert adv_from_klines([]) is None
    assert adv_from_klines([[0, 0, 0, 0, 0]]) is None          # too few columns
    assert adv_from_klines([["x", "y", "z", "w", "v", "u"]]) is None  # unparseable
    assert adv_from_klines(None) is None


def test_adv_ignores_rows_with_non_finite_or_negative_volume():
    rows = [[1000, "1", "1", "1", "1", "nan"], [0, "1", "1", "1", "1", "-5"],
            [500, "1", "1", "1", "1", "30"]]
    assert adv_from_klines(rows) == pytest.approx(30.0)


def test_bucket_volume_from_adv_rejects_unusable_input():
    assert bucket_volume_from_adv(None) is None
    assert bucket_volume_from_adv(0.0) is None
    assert bucket_volume_from_adv(-1.0) is None
    assert bucket_volume_from_adv(float("nan")) is None
    assert bucket_volume_from_adv(float("inf")) is None
    assert bucket_volume_from_adv("not-a-number") is None
    assert bucket_volume_from_adv(500.0) == pytest.approx(10.0)


# =============================================================================================
# PRECEDENCE AND FALLBACKS
# =============================================================================================
def test_operator_override_beats_measured_adv():
    """Someone who has measured this instrument outranks the estimator."""
    volume, source = resolve_bucket_volume("BTCUSDT", adv_24h=BTC_ADV_24H, override=7.5)
    assert (volume, source) == (7.5, SOURCE_OVERRIDE)
    assert not is_degraded_source(source), "a deliberate override is not a degradation"


def test_ignores_a_non_positive_override_rather_than_using_it():
    """A zero/negative override must not produce a zero bucket; fall through to the real estimate."""
    volume, source = resolve_bucket_volume("BTCUSDT", adv_24h=BTC_ADV_24H, override=0.0)
    assert source == SOURCE_ADV
    assert volume > 0


def test_documented_fallbacks_are_used_only_when_adv_is_unmeasurable():
    btc, btc_src = resolve_bucket_volume("BTCUSDT")
    eth, eth_src = resolve_bucket_volume("ETHUSDT")
    assert (btc, btc_src) == (FALLBACK_BUCKET_VOLUME["BTCUSDT"], SOURCE_FALLBACK_SYMBOL)
    assert (eth, eth_src) == (FALLBACK_BUCKET_VOLUME["ETHUSDT"], SOURCE_FALLBACK_SYMBOL)
    # The requested operating figures.
    assert btc == 5.0 and eth == 50.0
    # A fallback is a degradation and must say so.
    assert is_degraded_source(btc_src) and is_degraded_source(eth_src)


def test_unknown_symbol_without_adv_uses_the_generic_fallback_and_is_flagged():
    volume, source = resolve_bucket_volume("WEIRDUSDT")
    assert volume == GENERIC_FALLBACK_BUCKET_VOLUME
    assert source == SOURCE_FALLBACK_GENERIC
    assert is_degraded_source(source)


def test_symbol_matching_is_case_and_whitespace_insensitive():
    """Symbols arrive from env and config; a formatting difference must not silently demote a known
    instrument to the generic fallback."""
    volume, source = resolve_bucket_volume("  btcusdt ", adv_24h=None)
    assert (volume, source) == (FALLBACK_BUCKET_VOLUME["BTCUSDT"], SOURCE_FALLBACK_SYMBOL)


def test_resolution_descriptions_are_honest_about_their_source():
    measured = describe_resolution("BTCUSDT", 16000.0, SOURCE_ADV, BTC_ADV_24H)
    assert "ADV" in measured and "fallback" not in measured.lower()
    degraded = describe_resolution("WEIRDUSDT", 1.0, SOURCE_FALLBACK_GENERIC, None)
    assert "GENERIC fallback" in degraded and "degraded" in degraded.lower()


# =============================================================================================
# ENGINE RECALIBRATION
# =============================================================================================
def test_engine_adopts_a_new_bucket_size_before_ingestion():
    engine = VpinEngine(VpinConfig(bucket_volume=25.0))
    engine.recalibrate(16000.0)
    assert engine.cfg.bucket_volume == 16000.0


def test_engine_refuses_to_recalibrate_after_ingestion_begins():
    """Mixing bucket sizes would silently scale the denominator away from the volumes measured."""
    engine = VpinEngine(VpinConfig(bucket_volume=1.0))
    engine.on_trade(price=100.0, size=0.5, side="Buy")
    with pytest.raises(RuntimeError, match="ingestion has begun"):
        engine.recalibrate(2.0)


def test_engine_refuses_a_non_positive_bucket_size():
    engine = VpinEngine(VpinConfig(bucket_volume=1.0))
    for bad in (0.0, -1.0, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            engine.recalibrate(bad)


def test_recalibration_actually_changes_the_bucketing():
    """Not just a stored number: the engine must bucket at the NEW size."""
    engine = VpinEngine(VpinConfig(bucket_volume=100.0, window_buckets=2))
    engine.recalibrate(10.0)
    engine.on_trade(price=100.0, size=30.0, side="Buy")
    assert engine.bucket_count == 2, "the pre-calibration size was still in force"
