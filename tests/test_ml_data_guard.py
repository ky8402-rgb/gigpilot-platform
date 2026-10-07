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

import asyncio
import inspect

import pytest

from gpkg.ml.data import (
    L2_REQUIRED,
    InsufficientDataError,
    RateLimitedError,
)
from gpkg.persistence.store import Store


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


# --------------------------------------------------------------------------------------------------
# VENUE-RESILIENCE — why the retry policy is tested directly
# --------------------------------------------------------------------------------------------------
# L2 depth is FORWARD-ONLY: Bybit publishes no historical order book, so a snapshot that is not taken
# as it happens cannot be re-fetched later at any price. A throttle that ENDS a collection run does not
# delay the data, it destroys it. That makes the retry policy load-bearing for a 7-day unattended run,
# and makes `_get` worth testing even though it is private.

class _FakeResp:
    def __init__(self, status=200, body=None, headers=None):
        self.status = status
        self._body = {"retCode": 0, "result": {}} if body is None else body
        self.headers = headers or {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._body


class _FakeSession:
    """Replays a scripted sequence, then keeps returning the last response."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def get(self, url, params=None):
        idx = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        return self._responses[idx]


def _sleep_recorder(record):
    async def _sleep(seconds):
        record.append(seconds)
    return _sleep


@pytest.fixture()
def worker(tmp_path):
    from gpkg.ml.data import HistoricalDataWorker
    return HistoricalDataWorker(Store(str(tmp_path / "worker.db")))


def test_a_throttled_request_is_retried_not_fatal(monkeypatch, worker):
    slept = []
    monkeypatch.setattr(asyncio, "sleep", _sleep_recorder(slept))
    sess = _FakeSession([_FakeResp(429), _FakeResp(200)])
    body = asyncio.run(worker._get(sess, "kline", {}))
    assert body["retCode"] == 0
    assert sess.calls == 2, "a 429 must be retried; ending the run loses forward-only data forever"


def test_bybit_throttle_is_recognised_on_http_200(monkeypatch, worker):
    """Bybit answers a throttle with retCode 10006 and HTTP 200 — status alone would miss it."""
    slept = []
    monkeypatch.setattr(asyncio, "sleep", _sleep_recorder(slept))
    sess = _FakeSession([_FakeResp(200, {"retCode": 10006, "retMsg": "Too many visits"}),
                         _FakeResp(200)])
    body = asyncio.run(worker._get(sess, "kline", {}))
    assert body["retCode"] == 0
    assert sess.calls == 2


def test_retry_after_wins_over_the_guessed_backoff(monkeypatch, worker):
    slept = []
    monkeypatch.setattr(asyncio, "sleep", _sleep_recorder(slept))
    sess = _FakeSession([_FakeResp(429, headers={"Retry-After": "7"}), _FakeResp(200)])
    asyncio.run(worker._get(sess, "kline", {}))
    assert slept == [7.0], (
        "the venue knows when its budget resets; a shorter guess just spends another 429"
    )


def test_a_bad_request_fails_immediately_and_is_never_retried(monkeypatch, worker):
    """Retrying a request this code built wrong turns a clear error into a slow one."""
    slept = []
    monkeypatch.setattr(asyncio, "sleep", _sleep_recorder(slept))
    sess = _FakeSession([_FakeResp(400), _FakeResp(200)])
    with pytest.raises(RuntimeError, match="HTTP 400"):
        asyncio.run(worker._get(sess, "kline", {}))
    assert sess.calls == 1
    assert slept == []


def test_a_non_retryable_bybit_error_fails_immediately(monkeypatch, worker):
    slept = []
    monkeypatch.setattr(asyncio, "sleep", _sleep_recorder(slept))
    sess = _FakeSession([_FakeResp(200, {"retCode": 10001, "retMsg": "params error"}),
                         _FakeResp(200)])
    with pytest.raises(RuntimeError, match="params error"):
        asyncio.run(worker._get(sess, "kline", {}))
    assert sess.calls == 1


def test_exhausted_retries_report_rate_limited_not_a_generic_error(monkeypatch, worker):
    """'Venue is throttling us' and 'the model failed' need different operator responses."""
    slept = []
    monkeypatch.setattr(asyncio, "sleep", _sleep_recorder(slept))
    sess = _FakeSession([_FakeResp(429)])
    with pytest.raises(RateLimitedError, match="giving up after 5 attempts"):
        asyncio.run(worker._get(sess, "kline", {}))
    assert sess.calls == 5, "bounded: an unbounded loop would never report that the venue is down"
    assert len(slept) == 4, "no sleep after the final attempt"


def test_the_backoff_is_capped_so_one_call_cannot_stall_the_run(monkeypatch, worker):
    slept = []
    monkeypatch.setattr(asyncio, "sleep", _sleep_recorder(slept))
    sess = _FakeSession([_FakeResp(429, headers={"Retry-After": "99999"})])
    with pytest.raises(RateLimitedError):
        asyncio.run(worker._get(sess, "kline", {}))
    assert max(slept) <= 30.0


def test_the_backoff_grows_exponentially_when_the_venue_gives_no_hint():
    from gpkg.ml.data import HistoricalDataWorker as W
    assert [W._backoff_s(None, n) for n in (1, 2, 3, 4)] == [0.5, 1.0, 2.0, 4.0]
    assert W._backoff_s("garbage", 3) == 2.0, "an unparseable Retry-After falls back, not crashes"


def test_the_l2_threshold_has_exactly_one_definition():
    """The gate, the CLI's ETA and the tests must not be able to drift apart."""
    import inspect as _inspect

    from gpkg.ml.data import HistoricalDataWorker as W
    default = _inspect.signature(W.require_training_coverage).parameters[
        "min_liquidity_snapshots"].default
    assert default == L2_REQUIRED == 10_000


def test_the_ml_cli_stays_importable_without_aiohttp():
    """The deployed `/usr/local/bin/gigpilot` wrapper runs under SYSTEM python, which has no aiohttp.

    That is why every heavy import in `scripts/ml_research.py` is lazy BY DESIGN. A module-level
    `from gpkg.ml.data import ...` breaks EVERY subcommand at once, including ones that never touch the
    network — and on the real host it failed only AFTER the app had been activated and health-checked,
    so a green-looking release was reported as a failure. This pins the lazy-import discipline.
    """
    import subprocess
    code = ("import sys; sys.modules['aiohttp'] = None\n"
            "import scripts.ml_research\n"
            "print('ok')\n")
    proc = subprocess.run([sys.executable, "-c", code], cwd=ROOT,
                          capture_output=True, text=True, timeout=120,
                          check=False)  # the assertion below inspects returncode itself
    assert proc.returncode == 0, (
        "scripts/ml_research.py must import with aiohttp ABSENT because it runs under system python "
        f"on the host. stderr: {proc.stderr[-400:]}"
    )
    assert "ok" in proc.stdout
