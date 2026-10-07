#!/usr/bin/env python3
"""DISARM — scrub the credential, cancel the resting orders, and tell the truth about both.

What these tests are protecting
-------------------------------
Disarm is the operator's stop button, so it has three separate jobs and each can fail quietly:

  * the hand-entered API secret must be GONE from process memory afterwards. If it lingers, "enter the
    secret each time you arm" has silently become "enter it once and leave it resident", which is the
    persistence that control exists to remove;
  * resting orders must be cancelled. An order left on the venue can still fill after the operator said
    stop, so "disarmed" would be a claim about intent rather than about the book;
  * and it must NOT imply the position was closed. Cancel and flatten are different instructions;
    quietly flattening on disarm would be a market order nobody asked for.

The scrub must also happen when cancellation FAILS — cancelling is a signed call and needs the very
credential being scrubbed, so the ordering is load-bearing and worth pinning.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pytest  # noqa: E402


def _client(monkeypatch, engine):
    from fastapi.testclient import TestClient

    import gigpilot as gp
    from gpkg.api import auth as auth_mod

    monkeypatch.setenv("OWNER_AUTH_PIN", "test-pin-123456")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    auth_mod._OWNER_AUTH = None
    monkeypatch.setattr(gp, "get_gp", lambda: engine)
    client = TestClient(gp.app, raise_server_exceptions=False)
    return client, {"Authorization": f"Bearer {auth_mod.get_owner_auth().mint()}"}


@pytest.fixture(autouse=True)
def _clean():
    from gpkg.core.credential_vault import CredentialVault
    from gpkg.core.runtime_secrets import RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    CredentialVault.reset_for_tests()
    yield
    RuntimeSecretStore.reset_for_tests()
    CredentialVault.reset_for_tests()


def test_disarm_scrubs_the_runtime_secret(make_engine, monkeypatch):
    from gpkg.core.runtime_secrets import BYBIT_SECRET, RuntimeSecretStore

    engine, _ = make_engine()
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, "a-runtime-secret-value")
    assert store.get(BYBIT_SECRET).reveal() == "a-runtime-secret-value"

    client, headers = _client(monkeypatch, engine)
    r = client.post("/api/disarm", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["armed"] is False and body["runtimeSecretCleared"] is True

    # The scrub is real, not a flag: the store is empty AND any surviving handle reveals nothing.
    assert store.status()["loaded"] == []
    assert store.get(BYBIT_SECRET) is None


def test_disarm_scrubs_even_when_cancellation_fails(make_engine, monkeypatch):
    """The scrub is in a `finally` because cancelling is signed and needs the credential being
    removed. Scrub-then-cancel would fail every time and look like a venue outage."""
    from gpkg.core.runtime_secrets import BYBIT_SECRET, RuntimeSecretStore

    engine, fake = make_engine()
    RuntimeSecretStore.instance().set(BYBIT_SECRET, "a-runtime-secret-value")

    async def boom(symbol):
        raise RuntimeError("venue rejected the cancel")

    monkeypatch.setattr(fake, "cancel_all", boom)

    client, headers = _client(monkeypatch, engine)
    r = client.post("/api/disarm", headers=headers)
    assert r.status_code == 200, r.text

    assert RuntimeSecretStore.instance().status()["loaded"] == [], "secret survived a failed cancel"
    errors = r.json()["cancelErrors"]
    assert any("venue rejected the cancel" in e for e in errors), "the failed cancel was not reported"


def test_disarm_cancels_resting_orders_on_every_configured_symbol(make_engine, monkeypatch):
    engine, fake = make_engine()
    client, headers = _client(monkeypatch, engine)

    r = client.post("/api/disarm", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()

    assert sorted(body["cancelledSymbols"]) == sorted(engine.cfg.symbols)
    cancelled = [c.get("symbol") for c in fake.cancelled if "symbol" in c]
    for sym in engine.cfg.symbols:
        assert sym in cancelled, f"{sym} was left resting after disarm"


def test_disarm_does_not_claim_the_book_is_flat(make_engine, monkeypatch):
    """Cancel != flatten. Reporting "disarmed" must not be read as "no position"."""
    engine, _ = make_engine()
    client, headers = _client(monkeypatch, engine)

    body = client.post("/api/disarm", headers=headers).json()
    assert "openPositionsRemaining" in body
    assert "NOT closed" in body["positionNote"]


def test_rollout_route_exists_and_refuses_to_pretend(monkeypatch, make_engine):
    """/updates/rollout must not 404 AND must not fabricate. It reports that no updater is wired.

    A `{"status": "up_to_date"}` would assert an update check that never ran; a success on POST would
    assert a rollout that never happened. The route answers 501 and says why, like the other unwired
    capabilities (RESEARCH_NOT_VERIFIED, OPTIMIZER_NOT_VERIFIED).
    """
    engine, _ = make_engine()
    client, headers = _client(monkeypatch, engine)

    for method in ("GET", "POST"):
        r = client.request(method, "/api/updates/rollout", headers=headers)
        assert r.status_code == 501, f"{method} returned {r.status_code}"
        body = r.json()
        assert body["error"] == "UPDATER_NOT_WIRED" and body["updaterWired"] is False
        assert body["rolledOut"] is False
        assert "up_to_date" not in r.text, "fabricated an up-to-date claim"


def test_the_compat_disarm_door_is_no_weaker(make_engine, monkeypatch):
    """`/api/trading/gigpilot/disarm` is a DIFFERENT route to the same button.

    It previously only flipped `armed`: no cancellation, no scrub. An operator pressing stop on that
    door left resting orders live on the venue and the hand-entered secret resident in memory, while
    the other door did both. Same button, weaker safety, depending on which route the client picked.
    """
    from gpkg.core.runtime_secrets import BYBIT_SECRET, RuntimeSecretStore

    engine, fake = make_engine()
    RuntimeSecretStore.instance().set(BYBIT_SECRET, "a-runtime-secret-value")

    client, headers = _client(monkeypatch, engine)
    r = client.post("/api/trading/gigpilot/disarm", headers=headers)
    assert r.status_code == 200, r.text

    assert RuntimeSecretStore.instance().status()["loaded"] == [], (
        "the compat stop path left the hand-entered secret resident"
    )
    cancelled = [c.get("symbol") for c in fake.cancelled if "symbol" in c]
    for sym in engine.cfg.symbols:
        assert sym in cancelled, f"{sym} was left resting after a compat disarm"
