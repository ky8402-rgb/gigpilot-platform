"""Regressions for evidence labelling and loop-latency telemetry.

Two operator-facing behaviours are pinned here, both of which were wrong in practice:

1. ``edge_reliable`` was derived from a substring check on ``rejected_by`` alone, so it
   reported ``True`` for a symbol where **no setup — and therefore no edge estimate —
   had ever existed**. The dashboard then printed a concrete edge number where it should
   have printed "n/a". That reads as "verified, and the edge is zero" when the truth is
   "never measured", which is exactly the kind of green-looking signal an operator should
   never be handed by a strategy whose whole job is refusing to trade.

2. Nothing measured loop latency, so the engine could fall behind its own cadence with no
   counter showing it. On a closed-bar strategy a delayed tick delays entry evaluation.
"""
from __future__ import annotations

import pytest

from app.engine import EngineStatus
from app.strategy import Decision, edge_is_reliable


# ---------------------------------------------------------------------------
# edge_reliable — the evidence test must fail closed
# ---------------------------------------------------------------------------
def test_no_decision_is_not_reliable():
    """A symbol with no evaluation yet has no measured edge."""
    assert edge_is_reliable(None, 10) is False


def test_flat_symbol_with_zero_samples_is_not_reliable():
    """The exact case that was wrong: no setup, so no edge was ever estimated.

    ``no_setup`` is not an edge verdict, and must not be reported as one. Before the fix
    this returned True purely because "insufficient_edge_evidence" was absent from
    ``rejected_by`` — the rejection list was empty because nothing was ever tested.
    """
    dec = Decision(symbol="BTCUSDT", action="HOLD", samples=0, rejected_by=["no_setup"])
    assert edge_is_reliable(dec, 10) is False


def test_empty_rejection_list_without_samples_is_not_reliable():
    """Absence of a rejection is not evidence of a measured edge."""
    dec = Decision(symbol="BTCUSDT", action="HOLD", samples=0)
    assert edge_is_reliable(dec, 10) is False


def test_below_minimum_samples_is_not_reliable():
    dec = Decision(symbol="BTCUSDT", action="SKIP", samples=9, rejected_by=[])
    assert edge_is_reliable(dec, 10) is False


def test_insufficient_evidence_rejection_is_not_reliable():
    """A measured-but-unreliable edge is still not a verified edge."""
    dec = Decision(
        symbol="BTCUSDT", action="SKIP", samples=40,
        rejected_by=["insufficient_edge_evidence"],
    )
    assert edge_is_reliable(dec, 10) is False


def test_measured_edge_with_enough_samples_is_reliable():
    """A genuine measured edge (enough samples, no evidence objection) is reliable."""
    dec = Decision(symbol="BTCUSDT", action="OPEN_LONG", samples=36, rejected_by=[])
    assert edge_is_reliable(dec, 10) is True


def test_reliable_edge_survives_an_unrelated_rejection():
    """Being blocked for size or spread does not invalidate the edge measurement."""
    dec = Decision(
        symbol="BTCUSDT", action="SKIP", samples=36, rejected_by=["spread_too_wide"],
    )
    assert edge_is_reliable(dec, 10) is True


@pytest.mark.parametrize("bad_min", [0, -5])
def test_non_positive_minimum_is_treated_as_one(bad_min):
    """A mis-set threshold must not make every decision look reliable."""
    assert edge_is_reliable(Decision(symbol="X", action="HOLD", samples=0), bad_min) is False
    assert edge_is_reliable(Decision(symbol="X", action="HOLD", samples=1), bad_min) is True


# ---------------------------------------------------------------------------
# Loop-latency telemetry
# ---------------------------------------------------------------------------
def test_record_tick_tracks_last_and_max():
    st = EngineStatus()
    assert st.last_tick_ms == 0.0
    assert st.max_tick_ms == 0.0
    assert st.slow_ticks == 0

    st.record_tick(0.25, 5.0)
    assert st.last_tick_ms == pytest.approx(250.0)
    assert st.max_tick_ms == pytest.approx(250.0)

    st.record_tick(0.10, 5.0)
    assert st.last_tick_ms == pytest.approx(100.0), "last reflects the most recent tick"
    assert st.max_tick_ms == pytest.approx(250.0), "max must not shrink"


def test_slow_ticks_counts_only_budget_overruns():
    st = EngineStatus()
    st.record_tick(1.0, 5.0)   # within budget
    st.record_tick(5.0, 5.0)   # exactly at budget: not an overrun
    st.record_tick(5.5, 5.0)   # overrun
    st.record_tick(9.9, 5.0)   # overrun
    assert st.slow_ticks == 2


def test_latency_is_exposed_in_the_snapshot():
    st = EngineStatus()
    st.record_tick(0.3, 5.0)
    st.record_tick(7.0, 5.0)
    d = st.as_dict()
    for key in ("last_tick_ms", "max_tick_ms", "slow_ticks"):
        assert key in d, f"{key} missing from the engine snapshot"
    assert d["last_tick_ms"] == pytest.approx(7000.0, abs=0.1)
    assert d["max_tick_ms"] == pytest.approx(7000.0, abs=0.1)
    assert d["slow_ticks"] == 1
