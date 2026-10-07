#!/usr/bin/env python3
"""THE FUTURES UNIVERSE CONTRACT — the shape the React terminal actually consumes.

Regression origin
-----------------
This route returned the Node-era legacy shape `{"category": "linear", "pairs": [symbols...]}` while
`fetchFuturesUniverse()` requires `{"success": true, "markets": [...]}` and throws on anything else. So
the market selector sat on "Select a market", every quote read "—", and the chart stayed blank: the UI
was calling an endpoint that EXISTED but answered a different question. Nothing failed loudly, because
a 200 with unreadable fields looks like success.

The tests that matter here are the ones asserting what must NOT be present (no fabricated score) and
what must happen when the venue cannot be read (fail visibly, never an empty list that implies "this
venue has no markets").

Run: python3 tests/test_futures_universe.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

REQUIRED = {
    "exchange", "symbol", "baseAsset", "quoteAsset", "contractType", "status", "price",
    "volume24h", "change24hPct", "fundingRate", "bid", "ask", "spreadBps", "eligible", "reasons",
}


def _client(make_engine, monkeypatch):
    from fastapi.testclient import TestClient

    import gigpilot as gp
    from gpkg.api import auth as auth_mod

    monkeypatch.setenv("OWNER_AUTH_PIN", "test-pin-123456")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    auth_mod._OWNER_AUTH = None

    engine, fake = make_engine()
    monkeypatch.setattr(gp, "get_gp", lambda: engine)
    client = TestClient(gp.app, raise_server_exceptions=False)
    return client, {"Authorization": f"Bearer {auth_mod.get_owner_auth().mint()}"}, engine


def test_universe_matches_the_ui_contract(make_engine, monkeypatch):
    client, headers, engine = _client(make_engine, monkeypatch)
    r = client.get("/api/trading/futures/universe", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["success"] is True, "the UI throws unless `success` is exactly true"
    assert isinstance(body["markets"], list) and body["markets"], "an empty list renders as 'no markets'"
    # The legacy shape must be gone: `pairs` of bare strings is what broke the selector.
    assert "pairs" not in body

    for m in body["markets"]:
        missing = REQUIRED - set(m)
        assert not missing, f"{m.get('symbol')}: missing {sorted(missing)}"
        assert m["exchange"] == "BYBIT" and m["contractType"] == "PERPETUAL"
        assert isinstance(m["price"], (int, float)) and m["price"] > 0
        assert isinstance(m["bid"], (int, float)) and isinstance(m["ask"], (int, float))

    bysym = {m["symbol"]: m for m in body["markets"]}
    # Non-USDT contracts are not part of a USDT-perp universe.
    assert "BTCUSD" not in bysym, "a non-USDT contract leaked into the USDT universe"


def test_eligible_reflects_the_engines_configured_universe(make_engine, monkeypatch):
    """Browsing the whole venue is fine; claiming an untradeable market is eligible is not."""
    client, headers, _ = _client(make_engine, monkeypatch)
    body = client.get("/api/trading/futures/universe", headers=headers).json()
    bysym = {m["symbol"]: m for m in body["markets"]}

    sym = "BTCUSDT"
    assert bysym[sym]["eligible"] is True
    assert bysym[sym]["reasons"] == []

    other = "DOGEUSDT"
    assert bysym[other]["eligible"] is False, "a symbol outside cfg.symbols must not claim eligibility"
    assert bysym[other]["reasons"], "an ineligible market must say WHY"


def test_no_metric_is_fabricated_to_satisfy_the_type(make_engine, monkeypatch):
    """The engine measures no liquidity/execution score. Omitting them is honest; a number would not be."""
    client, headers, _ = _client(make_engine, monkeypatch)
    body = client.get("/api/trading/futures/universe", headers=headers).json()
    for m in body["markets"]:
        assert "liquidityScore" not in m, "a liquidity score nobody measures was invented"
        assert "executionScore" not in m


def test_a_broken_venue_read_fails_visibly_not_emptily(make_engine, monkeypatch):
    """An empty universe is a factual claim. A failed read must not be dressed as it."""
    client, headers, engine = _client(make_engine, monkeypatch)

    async def boom():
        raise RuntimeError("venue unreachable")

    monkeypatch.setattr(engine.rest, "tickers", boom)
    r = client.get("/api/trading/futures/universe", headers=headers)
    assert r.status_code == 503, "a failed ticker read must not return 200 with an empty universe"
    assert r.json()["error"] == "TICKERS_UNAVAILABLE"
    assert "venue unreachable" in r.json()["message"]


def test_universe_is_owner_gated(make_engine, monkeypatch):
    client, _, _ = _client(make_engine, monkeypatch)
    assert client.get("/api/trading/futures/universe").status_code == 401
