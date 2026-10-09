"""Behavioural tests for the stochastic quoting operators.

These assert the MATHEMATICAL contract, not a snapshot of output digits: a test that pinned exact
floats would break on the first legitimate re-tuning, while a test that pins the relationship (a bid
moves closer when buy pressure rises, a spread widens under a vol spike, a sub-minimum size snaps to
the venue minimum) survives re-tuning and still catches a broken operator.
"""
from __future__ import annotations

import pytest

from gpkg.risk.allocation import fractional_kelly, size_order_qty
from gpkg.strategy.operators import (
    StochasticQuoter,
    atr_step,
    is_toxic_spike,
    kinetic_energy,
    momentum_skew,
    toxicity_spread,
)


# ---------------------------------------------------------------------------
# Operator 1 — momentum-based asymmetric skewing
# ---------------------------------------------------------------------------
class TestMomentumSkew:
    MID = 100.0
    HALF = 0.5  # half-spread in price units

    def test_zero_obi_is_static_mid_centring(self):
        skew = momentum_skew(self.MID, 0.0, self.HALF, alpha=0.5)
        assert skew.reference == pytest.approx(self.MID)
        assert skew.bid_offset == pytest.approx(self.HALF)
        assert skew.ask_offset == pytest.approx(self.HALF)
        assert skew.nearest_bid < skew.reference < skew.nearest_ask

    def test_positive_obi_pulls_bids_in_and_asks_out(self):
        """Buy pressure -> reference up, bids closer to the inside, asks held deeper."""
        skew = momentum_skew(self.MID, 1.0, self.HALF, alpha=0.5)
        assert skew.reference > self.MID
        assert skew.bid_offset < self.HALF           # bid rests CLOSER to the inside
        assert skew.ask_offset > self.HALF           # ask rests DEEPER
        assert skew.bid_offset < skew.ask_offset

    def test_negative_obi_mirrors_the_effect(self):
        skew = momentum_skew(self.MID, -1.0, self.HALF, alpha=0.5)
        assert skew.reference < self.MID
        assert skew.ask_offset < self.HALF           # ask pulled in on sell pressure
        assert skew.bid_offset > self.HALF           # bid held deeper
        assert skew.ask_offset < skew.bid_offset

    def test_obi_is_clamped_to_the_unit_interval(self):
        beyond = momentum_skew(self.MID, 7.0, self.HALF, alpha=1.0)
        at_one = momentum_skew(self.MID, 1.0, self.HALF, alpha=1.0)
        assert beyond.reference == pytest.approx(at_one.reference)

    def test_alpha_zero_degrades_to_static_centring(self):
        skew = momentum_skew(self.MID, 0.9, self.HALF, alpha=0.0)
        assert skew.reference == pytest.approx(self.MID)
        assert skew.bid_offset == pytest.approx(skew.ask_offset)


# ---------------------------------------------------------------------------
# Operator 2 — kinetic energy & toxicity spacing
# ---------------------------------------------------------------------------
class TestToxicitySpacing:
    def test_spread_grows_superlinearly_with_volatility(self):
        base = 20.0
        calm = toxicity_spread(base, 2.0, 0.05)
        spike = toxicity_spread(base, 2.0, 0.5)
        assert spike > calm
        # Squared term: doubling the volatility MORE than doubles the added spread.
        assert toxicity_spread(base, 2.0, 0.2) > toxicity_spread(base, 2.0, 0.1)

    def test_zero_volatility_returns_the_base_spread(self):
        assert toxicity_spread(20.0, 2.0, 0.0) == pytest.approx(20.0)

    def test_toxic_spike_is_detected_above_the_threshold(self):
        assert is_toxic_spike(0.5, 0.4) is True
        assert is_toxic_spike(0.3, 0.4) is False

    def test_kinetic_energy_is_zero_for_a_flat_series(self):
        assert kinetic_energy([10.0, 10.0, 10.0, 10.0]) == pytest.approx(0.0)

    def test_kinetic_energy_rises_with_acceleration(self):
        trending = kinetic_energy([100.0, 100.1, 100.2, 100.3])  # constant velocity, ~zero accel
        accelerating = kinetic_energy([100.0, 100.1, 100.3, 100.6])  # growing velocity
        assert accelerating > trending

    def test_quoter_floors_spacing_at_the_market_spread(self):
        """Never cross the spread: grid spacing can widen but never narrow below the venue spread."""
        quoter = StochasticQuoter()
        plan = quoter.quote(
            mid=100.0,
            obi=0.0,
            spread_half=0.5,
            normalized_vol=0.0,
            atr_bps=20.0,
            market_spread_bps=10.0,
        )
        assert plan.spacing_bps >= 10.0
        assert plan.skew.nearest_bid < plan.skew.nearest_ask  # a resting bid never crosses an ask


# ---------------------------------------------------------------------------
# Operator 3 — frequency-adaptive step size
# ---------------------------------------------------------------------------
class TestAtrStep:
    def test_step_compresses_during_consolidation(self):
        assert atr_step(10.0, 10.0, 20.0) == pytest.approx(5.0)

    def test_step_expands_during_wide_swings(self):
        assert atr_step(10.0, 40.0, 20.0) == pytest.approx(20.0)

    def test_step_is_base_at_baseline(self):
        assert atr_step(10.0, 20.0, 20.0) == pytest.approx(10.0)

    def test_non_positive_baseline_falls_back_to_base(self):
        assert atr_step(10.0, 5.0, 0.0) == pytest.approx(10.0)


# ---------------------------------------------------------------------------
# Operator 4 — dynamic capital-velocity sizing
# ---------------------------------------------------------------------------
class TestKellyAllocation:
    def test_kelly_is_zero_without_a_positive_edge(self):
        assert fractional_kelly(0.4, 1.0) == 0.0   # negative edge
        assert fractional_kelly(0.5, 1.0) == 0.0   # zero edge
        assert fractional_kelly(0.0, 2.0) == 0.0   # never wins
        assert fractional_kelly(1.0, 2.0) == 0.0   # never loses -> still degenerate inputs

    def test_quarter_kelly_is_conservative(self):
        full = (0.6 * (2.0 + 1.0) - 1.0) / 2.0     # = 0.4
        assert fractional_kelly(0.6, 2.0, 0.25) == pytest.approx(0.25 * full)

    def test_size_is_a_step_aligned_decimal_string(self):
        sizing = size_order_qty(equity=10_000.0, kelly_f=0.1, price=100.0, step_size=0.01, min_qty=0.01)
        assert sizing.reason == "ok"
        assert sizing.qty == "10"  # 10_000*0.1/100 = 10, exact and step-aligned

    def test_size_floors_to_the_contract_step(self):
        sizing = size_order_qty(equity=10_000.0, kelly_f=0.1, price=30_000.0, step_size=0.001, min_qty=0.001)
        # 10_000*0.1/30_000 = 0.033333..., floored to 0.033
        assert sizing.qty == "0.033"

    def test_sub_minimum_size_falls_back_to_the_venue_minimum(self):
        sizing = size_order_qty(equity=10_000.0, kelly_f=0.1, price=1_000_000.0, step_size=0.001, min_qty=0.01)
        # Kelly notional -> 0.001 lots, below the 0.01 minimum: snap up and say why.
        assert sizing.reason == "snapped_to_min"
        assert sizing.qty == "0.01"

    def test_no_trade_when_equity_price_or_kelly_is_non_positive(self):
        assert size_order_qty(0.0, 0.1, 100.0, 0.01, 0.01).reason == "no_trade"
        assert size_order_qty(10_000.0, 0.0, 100.0, 0.01, 0.01).reason == "no_trade"
        assert size_order_qty(10_000.0, 0.1, 0.0, 0.01, 0.01).reason == "no_trade"
