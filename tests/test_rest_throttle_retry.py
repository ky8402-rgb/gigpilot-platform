#!/usr/bin/env python3
"""A THROTTLE IS NOT A FAILURE.

Bybit reports throttling as a non-zero `retCode` on an HTTP 200 — 10006, "Too many visits". This
client raised it as a `BybitError`, so it was immediately fatal for the calling route, while
`gpkg/ml/data.py` already retried the same code. That asymmetry is what makes a rate limit look like a
half-dead venue: the public WebSocket is a SEPARATE connection, so the feed keeps ticking while every
REST route fails. The dashboard symptom is "Live Bybit universe unavailable" on a system whose market
feed is demonstrably alive.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.core.config import Config  # noqa: E402
from gpkg.core.errors import BybitError  # noqa: E402
from gpkg.exchange.bybit_rest import RETRYABLE_RET_CODES, BybitREST  # noqa: E402


class _Resp:
    def __init__(self, body, status=200):
        self._body = body
        self.status = status
        self.headers: dict = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._body


class _Sess:
    def __init__(self, bodies):
        self._bodies = list(bodies)
        self.calls = 0

    def get(self, url, params=None, headers=None, timeout=None):
        idx = min(self.calls, len(self._bodies) - 1)
        self.calls += 1
        return _Resp(self._bodies[idx])


def _rest(bodies) -> tuple[BybitREST, _Sess]:
    rest = BybitREST(Config(api_key="k", api_secret="s", symbols=["BTCUSDT"]))
    sess = _Sess(bodies)
    rest._sess = sess  # type: ignore[assignment]
    return rest, sess


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    async def _instant(_s):
        return None
    monkeypatch.setattr(asyncio, "sleep", _instant)


def test_a_throttled_call_is_retried_not_raised():
    rest, sess = _rest([
        {"retCode": 10006, "retMsg": "Too many visits"},
        {"retCode": 0, "result": {"list": [{"symbol": "BTCUSDT"}]}},
    ])
    out = asyncio.run(rest._req("GET", "/v5/market/tickers", {"category": "linear"}, signed=False))
    assert out["list"][0]["symbol"] == "BTCUSDT"
    assert sess.calls == 2, "10006 must be retried, not raised"


def test_10006_is_recognised_as_retryable():
    assert 10006 in RETRYABLE_RET_CODES


def test_a_non_retryable_bybit_error_still_fails_fast():
    """A real business error must NOT be retried — retrying it would just delay the truth."""
    rest, sess = _rest([{"retCode": 10001, "retMsg": "params error"}])
    with pytest.raises(BybitError):
        asyncio.run(rest._req("GET", "/v5/market/tickers", signed=False))
    assert sess.calls == 1


def test_a_persistent_throttle_is_bounded_and_names_the_cause():
    """Bounded, and the raised message must say WHAT failed — `str(TimeoutError())` is empty, which is
    how an exhausted-retry timeout once produced 'failed: ' with nothing after the colon."""
    rest, sess = _rest([{"retCode": 10006, "retMsg": "Too many visits"}])
    with pytest.raises(RuntimeError) as exc:
        asyncio.run(rest._req("GET", "/v5/market/tickers", signed=False, retries=3))
    msg = str(exc.value)
    assert sess.calls == 3, "bounded retries"
    assert "/v5/market/tickers" in msg and "3 attempt(s)" in msg
    assert "BybitError" in msg and "10006" in msg
