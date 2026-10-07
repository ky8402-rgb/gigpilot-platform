#!/usr/bin/env python3
"""CONTROL-PLANE AUTHORIZATION — every operational route must refuse an anonymous caller.

Regression origin
-----------------
The Python control plane had no authentication layer whatsoever. `/api/arm`, `/api/disarm` and
`/api/kill` were reachable by anyone who could open a socket, so an unauthenticated caller could
start live trading or trip the emergency stop. The Node stack enforced `requireOwnerAuth` on the
equivalent routes; Python enforced nothing.

The contract asserted here:

  * unauthenticated  -> 401 on every operational route;
  * authenticated    -> the route executes;
  * `/health` stays public (deployment gating depends on it) and never leaks credentials;
  * the token is accepted via `Authorization: Bearer`, `?token=`, and `X-Owner-Token`, which is what
    the React dashboard and EventSource can actually send.

Run: python3 tests/test_control_plane_auth.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Routes that mutate trading state or disclose account state. ALL must require an owner session.
PROTECTED = [
    ("GET", "/api/state"),
    ("POST", "/api/arm"),
    ("POST", "/api/disarm"),
    ("POST", "/api/kill"),
    ("GET", "/metrics"),
    ("GET", "/events"),
]


def test_anonymous_is_refused_everywhere(authed_client):
    client, _engine, _token, _owner = authed_client
    for method, path in PROTECTED:
        r = client.request(method, path)
        assert r.status_code == 401, (
            f"{method} {path} returned {r.status_code} without a token — an anonymous caller "
            f"could reach an operational endpoint"
        )
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        assert "detail" in body or "error" in body, f"{method} {path} 401 lacked an error body"


def test_invalid_tokens_are_refused(authed_client):
    client, _engine, _token, _owner = authed_client
    for label, tok in [
        ("garbage", "not-a-token"),
        ("forged", "eyJhbGciOiJub25lIn0.eyJyb2xlIjoib3duZXIifQ."),
        ("empty-ish", " "),
    ]:
        r = client.get("/api/state", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401, f"{label} token was accepted ({r.status_code})"


def test_valid_token_grants_access(authed_client):
    client, _engine, token, _owner = authed_client
    r = client.get("/api/state", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"valid owner token rejected: {r.status_code} {r.text[:200]}"
    assert "equity" in r.json()


def test_token_accepted_from_all_three_transports(authed_client):
    """The dashboard uses Bearer; EventSource can only use a query parameter."""
    client, _engine, token, _owner = authed_client

    r = client.get("/api/state", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, "Bearer transport failed"

    r = client.get("/api/state", headers={"X-Owner-Token": token})
    assert r.status_code == 200, "X-Owner-Token transport failed"

    r = client.get(f"/api/state?token={token}")
    assert r.status_code == 200, "query-param transport failed"


def test_health_remains_public_and_leaks_no_credentials(authed_client):
    client, _engine, _token, _owner = authed_client
    for path in ("/health", "/api/health", "/api/trading/gigpilot/health"):
        r = client.get(path)
        assert r.status_code in (200, 503), f"{path} -> {r.status_code}; health must stay reachable"
        text = r.text
        for needle in ("api_secret", "apiSecret", "test-secret", "jwt_secret"):
            assert needle not in text, f"{path} leaked {needle}"


def test_health_declares_not_trading_ready_when_unverified(authed_client):
    """Absence of a failure is not readiness: a never-validated credential must not read as ready.

    The detailed fields are requested with the OWNER token, because `credentials_ok`,
    `trade_permissions_ok` and `trading_blockers` are now owner-only — they carry verbatim
    credential-failure text that must not be served to anonymous callers. `trading_ready` itself
    stays public so monitoring can still alarm on it, so BOTH tiers are asserted: that way a future
    change to the split cannot silently break either audience.
    """
    client, _engine, token, _owner = authed_client

    anon = client.get("/health").json()
    assert anon.get("trading_ready") is False, "trading_ready must remain visible to monitoring"
    assert "trading_blockers" not in anon, "blocker detail leaked to an anonymous caller"

    body = client.get("/health", headers={"Authorization": f"Bearer {token}"}).json()
    assert body.get("trading_ready") is False, body.get("trading_ready")
    assert body.get("credentials_ok") is False, "reconciler never ran, so credentials are not validated"
    assert body.get("trade_permissions_ok") is False
    assert body.get("trading_blockers"), "not-ready must come with explicit blockers"


def test_login_requires_the_right_secret(authed_client):
    client, _engine, _token, owner = authed_client
    r = client.post("/api/auth/login", json={"email": owner.config.owner_email,
                                             "emergencyPin": "definitely-wrong"})
    assert r.status_code == 401, "wrong break-glass PIN was accepted"

    r = client.post("/api/auth/login", json={"email": owner.config.owner_email,
                                             "emergencyPin": owner.config.emergency_pin})
    assert r.status_code == 200, r.text
    issued = r.json()["token"]
    assert owner.verify(issued), "login issued a token that does not verify"
    assert client.get("/api/state", headers={"Authorization": f"Bearer {issued}"}).status_code == 200


def test_status_endpoint_reports_configuration_without_secrets(authed_client):
    client, _engine, _token, _owner = authed_client
    r = client.get("/api/auth/status")
    assert r.status_code == 200
    body = r.json()
    assert body["isConfigured"] is False, "a fresh account must not report itself configured"
    assert "jwt_secret" not in r.text and "emergency_pin" not in r.text
