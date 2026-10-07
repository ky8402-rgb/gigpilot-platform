#!/usr/bin/env python3
"""THE DATA GUARD — a tournament must refuse to score nothing.

Regression origin
-----------------
`require_training_coverage` was defined on `HistoricalDataWorker` and called NOWHERE. Every table in
the ML database held 0 market rows, yet the tournament printed a confident

    BTCUSDT NO_CANDIDATE_CLEARED_GATES evaluated=35 admitted=0

which reads as a rigorous negative result and was in fact a verdict formed over no data at all. That is
the most misleading output this system can produce, precisely because it looks like science: a user
would conclude "we searched 35 candidates and none had an edge", when the truth was "we searched
nothing".

A model fitted on no history is not a weak model. It is an ABSENT MEASUREMENT, and the two must never
be reported alike — hence a distinct error type rather than a generic RuntimeError.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import inspect  # noqa: E402

import pytest  # noqa: E402

from gpkg.ml.data import InsufficientDataError  # noqa: E402
from gpkg.persistence.store import Store  # noqa: E402


@pytest.fixture()
def empty_store(tmp_path):
    """A real schema with no market history in it — exactly the state that produced the false verdict."""
    return Store(str(tmp_path / "empty.db"))


def test_tournament_refuses_on_an_empty_database(empty_store):
    from gpkg.ml.tournament import run_tournament

    with pytest.raises(InsufficientDataError) as e:
        run_tournament(empty_store, "BTCUSDT")
    msg = str(e.value)
    assert "insufficient 1m history" in msg
    assert "98.000% over 90 days" in msg, "the refusal must state the requirement, not just fail"


def test_training_refuses_on_an_empty_database(empty_store):
    from gpkg.ml.training import train_candidate

    with pytest.raises(InsufficientDataError):
        train_candidate(empty_store, "BTCUSDT")


def test_the_refusal_is_a_distinct_state_not_a_generic_failure(empty_store):
    """A bare RuntimeError made "no data" and "model failed" indistinguishable in the log."""
    from gpkg.ml.tournament import run_tournament

    with pytest.raises(InsufficientDataError):
        run_tournament(empty_store, "BTCUSDT")
    assert issubclass(InsufficientDataError, RuntimeError), "must stay catchable as RuntimeError"


def test_the_guard_is_on_by_default_and_only_an_explicit_opt_out_skips_it():
    """The escape hatch exists for synthetic fixtures, and it must never be the default.

    If this default ever flips, an unguarded tournament silently returns to scoring empty databases and
    every assertion in this file becomes decorative.
    """
    from gpkg.ml.tournament import run_tournament
    from gpkg.ml.training import train_candidate

    for fn in (run_tournament, train_candidate):
        p = inspect.signature(fn).parameters["require_coverage"]
        assert p.default is True, f"{fn.__name__}.require_coverage no longer defaults to True"
        assert p.kind is inspect.Parameter.KEYWORD_ONLY, (
            "must be keyword-only so it cannot be flipped by a positional argument by accident"
        )


def test_measuring_nothing_is_not_the_same_as_measuring_zero(empty_store):
    """The coverage report must expose the gap, so an operator can see how far off they are."""
    from gpkg.ml.data import HistoricalDataWorker

    report = HistoricalDataWorker(empty_store).coverage("BTCUSDT")
    assert report["kline_count"] == 0
    assert report["expected_1m_bars"] > 100_000
    assert report["kline_coverage"] == 0.0
    assert report["liquidity_snapshot_count"] < 10_000
    assert report["l2_48h_ready"] is False
