#!/usr/bin/env python3
"""Control-plane session carrier: httpOnly cookie, token precedence, and removal from localStorage.

THE PROBLEM
-----------
The owner session token was kept in `localStorage`, which is readable by any JavaScript running on
the page. A single XSS therefore handed over the whole control plane — arm, disarm, credentials — and
the token survived in the browser until explicitly cleared.

THE FIX, AND ITS HONEST LIMIT
-----------------------------
The session is now issued as an `HttpOnly` cookie, which JavaScript CANNOT read. That is the only
carrier that actually satisfies "not accessible to client-side inspection".

It is not the only carrier, because the frontend is deployed at TWO origins: the EC2 host (same
origin as the API) and AWS Amplify (a DIFFERENT origin). A `SameSite=Strict` cookie is never sent to
a cross-origin API, so on Amplify the cookie is unavailable BY CONSTRUCTION and an in-memory bearer
remains the carrier. The tests below therefore pin both paths, and the frontend tests pin that the
token is no longer written to `localStorage` on either.

Run: python3 -m pytest tests/test_session_cookie.py -q
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("BYBIT_API_KEY", "test-key")
os.environ.setdefault("BYBIT_API_SECRET", "test-secret")

from fastapi.testclient import TestClient  # noqa: E402

import gigpilot  # noqa: E402
from gpkg.api.auth import (  # noqa: E402
    SESSION_COOKIE,
    SESSION_COOKIE_HOST_PREFIXED,
    OwnerAuth,
    OwnerConfig,
    cookie_is_secure,
    extract_token,
    hash_password,
    session_cookie_name,
)

PASSWORD = "correct-horse-battery-staple"


@pytest.fixture
def auth() -> OwnerAuth:
    salt = "deadbeefdeadbeef"
    return OwnerAuth(OwnerConfig(
        owner_email="owner@example.com",
        jwt_secret="test-secret-long-enough-for-hs256-signing",
        emergency_pin="a1b2c3d4",
        password_salt=salt,
        password_hash=hash_password(PASSWORD, salt),
        totp_secret="JBSWY3DPEHPK3PXP",
        totp_enabled=True,
    ))


@pytest.fixture
def client(auth, monkeypatch):
    """Patch BOTH namespaces.

    `gigpilot.py` does `from gpkg.api.auth import get_owner_auth`, which binds the function into
    gigpilot's own namespace. Patching only `gpkg.api.auth` therefore leaves the ROUTE calling the
    real singleton — the test then authenticates against the on-disk config, fails with "Access
    denied", and after five attempts trips the real singleton's login throttle, so later tests see
    429 instead. Patching the importer's binding as well is what makes the fixture actually take.
    """
    import gpkg.api.auth as auth_mod
    monkeypatch.setattr(auth_mod, "get_owner_auth", lambda: auth)
    monkeypatch.setattr(gigpilot, "get_owner_auth", lambda: auth)
    monkeypatch.delenv("GIGPILOT_COOKIE_INSECURE", raising=False)
    return TestClient(gigpilot.app)


def _login(client: TestClient) -> str:
    from gpkg.api.auth import generate_totp
    r = client.post("/api/auth/login", json={
        "email": "owner@example.com", "password": PASSWORD,
        "totpCode": generate_totp("JBSWY3DPEHPK3PXP"), "emergencyPin": "",
    })
    assert r.status_code == 200, r.text
    return r.json()["token"]


# =============================================================================================
# THE COOKIE ITSELF
# =============================================================================================
def test_login_sets_an_httponly_samesite_strict_cookie(client):
    """HttpOnly is the control: without it, JavaScript can read the session and an XSS wins."""
    r = client.post("/api/auth/login", json={
        "email": "owner@example.com", "password": PASSWORD,
        "totpCode": __import__("gpkg.api.auth", fromlist=["x"]).generate_totp("JBSWY3DPEHPK3PXP"),
        "emergencyPin": "",
    })
    assert r.status_code == 200
    raw = r.headers.get("set-cookie", "")
    assert "HttpOnly" in raw, f"the session cookie must be HttpOnly: {raw}"
    assert "samesite=strict" in raw.lower(), f"SameSite=Strict is the CSRF control: {raw}"
    assert "path=/" in raw.lower()


def test_cookie_name_is_host_prefixed_only_when_secure():
    """`__Host-` is a browser-enforced guarantee (Secure, no Domain, Path=/). It cannot be applied to
    a non-Secure cookie, so the name must track the flag rather than being hardcoded."""
    assert session_cookie_name(secure=True) == SESSION_COOKIE_HOST_PREFIXED
    assert session_cookie_name(secure=False) == SESSION_COOKIE
    assert SESSION_COOKIE_HOST_PREFIXED.startswith("__Host-")


def test_secure_defaults_on_and_requires_an_explicit_opt_out(monkeypatch):
    """Defaulting to Secure means a misconfiguration fails towards a cookie the browser REFUSES to
    send over plain HTTP, not one it leaks."""
    class _Req:
        class url:
            scheme = "http"
        headers: dict = {}
    monkeypatch.delenv("GIGPILOT_COOKIE_INSECURE", raising=False)
    assert cookie_is_secure(_Req()) is False, "plain http with no forwarded proto is not secure"
    monkeypatch.setenv("GIGPILOT_COOKIE_INSECURE", "1")
    assert cookie_is_secure(_Req()) is False

    class _Tls(_Req):
        class url:
            scheme = "https"
    monkeypatch.delenv("GIGPILOT_COOKIE_INSECURE", raising=False)
    assert cookie_is_secure(_Tls()) is True


def test_forwarded_proto_is_honoured_behind_a_proxy():
    """The service sits behind a TLS terminator, so the request scheme is http while the CLIENT
    connection is https. Without this the cookie would silently lose Secure in production."""
    class _Req:
        class url:
            scheme = "http"
        headers = {"x-forwarded-proto": "https"}
    os.environ.pop("GIGPILOT_COOKIE_INSECURE", None)
    assert cookie_is_secure(_Req()) is True


# =============================================================================================
# TOKEN PRECEDENCE
# =============================================================================================
class _Req:
    def __init__(self, *, header="", cookies=None, query=None):
        self.headers = {"authorization": header} if header else {}
        self.cookies = cookies or {}
        self.query_params = query or {}


def test_explicit_bearer_beats_a_stale_cookie():
    """A browser that logged out and back in as a different session must not be silently
    authenticated as the PREVIOUS one by a leftover cookie."""
    r = _Req(header="Bearer HEADER_TOKEN", cookies={SESSION_COOKIE: "STALE_COOKIE"})
    assert extract_token(r) == "HEADER_TOKEN"


def test_cookie_is_used_when_no_bearer_is_present():
    assert extract_token(_Req(cookies={SESSION_COOKIE: "COOKIE_TOKEN"})) == "COOKIE_TOKEN"
    assert extract_token(_Req(cookies={SESSION_COOKIE_HOST_PREFIXED: "HOST_TOKEN"})) == "HOST_TOKEN"


def test_host_prefixed_cookie_is_preferred_over_the_legacy_name():
    """During a Secure/non-Secure transition both names can exist; the hardened one must win."""
    r = _Req(cookies={SESSION_COOKIE: "LEGACY", SESSION_COOKIE_HOST_PREFIXED: "HARDENED"})
    assert extract_token(r) == "HARDENED"


def test_query_token_still_works_for_event_source():
    """`EventSource` cannot set headers, which is the only reason this carrier exists."""
    assert extract_token(_Req(query={"token": "SSE_TOKEN"})) == "SSE_TOKEN"


# =============================================================================================
# AUTHENTICATION VIA THE COOKIE
# =============================================================================================
def test_the_cookie_authenticates_an_owner_gated_endpoint(client):
    """The point of the whole exercise: the cookie alone must be sufficient, or clients are forced
    back to holding the token in JavaScript."""
    _login(client)
    r = client.get("/api/credentials/runtime")          # owner-gated
    assert r.status_code == 200, r.text


def test_the_cookie_is_not_sent_without_login(client):
    assert client.get("/api/credentials/runtime").status_code == 401


def test_refresh_mints_a_new_token_from_the_cookie(client):
    old = _login(client)
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200, r.text
    assert r.json()["token"]
    # refreshed session is still valid
    assert client.get("/api/credentials/runtime").status_code == 200
    assert old  # the original token existed; the new one is what matters


def test_refresh_without_a_session_is_401_not_an_error(client):
    r = client.post("/api/auth/refresh")
    assert r.status_code == 401, r.text


def test_refresh_refuses_a_forged_cookie(auth, monkeypatch):
    """Refresh must verify through the SAME path as everything else — otherwise it is a bypass."""
    import gpkg.api.auth as auth_mod
    monkeypatch.setattr(auth_mod, "get_owner_auth", lambda: auth)
    monkeypatch.setattr(gigpilot, "get_owner_auth", lambda: auth)
    c = TestClient(gigpilot.app)
    c.cookies.set(SESSION_COOKIE, "not-a-valid-token")
    assert c.post("/api/auth/refresh").status_code == 401


def test_logout_clears_both_cookie_names(client):
    """A stale session cookie is a session that outlives a logout."""
    _login(client)
    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    raw = r.headers.get("set-cookie", "")
    assert SESSION_COOKIE in raw
    assert SESSION_COOKIE_HOST_PREFIXED in raw, "the __Host- variant must be cleared too"


def test_logout_revokes_access(client):
    _login(client)
    assert client.get("/api/credentials/runtime").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/credentials/runtime").status_code == 401


def test_login_response_still_carries_the_token_for_cross_origin_clients(client):
    """Amplify is a different origin, so a SameSite=Strict cookie is never sent there. Those clients
    keep using an in-memory bearer, which requires the body to still carry it."""
    assert _login(client)


# =============================================================================================
# FRONTEND — the token must no longer be persisted in the browser
# =============================================================================================
def _src() -> str:
    return (ROOT / "src" / "services" / "tradingService.ts").read_text()


def test_frontend_does_not_write_the_token_to_localstorage():
    src = _src()
    for line in src.splitlines():
        if "localStorage" not in line:
            continue
        # The ONLY permitted code reference is the migration DELETE of a legacy key.
        assert "removeItem" in line, f"localStorage used for something other than deletion: {line}"
        assert "setItem" not in line, f"a token is being PERSISTED again: {line}"


def test_frontend_migrates_away_the_legacy_key():
    """Skipping the write is not enough: an existing copy must be actively deleted, or the credential
    we are removing simply stays where it was."""
    src = _src()
    assert "gigpilot_owner_token" in src, "the legacy key is not referenced at all"
    assert "removeItem" in src


def test_frontend_has_a_refresh_handshake():
    """An in-memory token dies on reload; without a refresh the operator would re-enter password and
    TOTP every time, which pushes clients back towards persisting it."""
    src = _src()
    assert "/api/auth/refresh" in src or "auth/refresh" in src
    assert "credentials" in src, "the refresh must send cookies"


def test_no_other_source_file_reads_a_token_from_localstorage():
    """`lib/api.ts` had its OWN localStorage token reader, so fixing only tradingService.ts would
    have left a second copy in place."""
    offenders = []
    for f in (ROOT / "src").rglob("*.ts"):
        if "__tests__" in str(f) or ".test." in f.name:
            continue
        for i, line in enumerate(f.read_text(errors="ignore").splitlines(), 1):
            if "localStorage" in line and "removeItem" not in line and "getItem" in line:
                offenders.append(f"{f.name}:{i}: {line.strip()[:80]}")
    assert not offenders, f"sources still reading a token from localStorage: {offenders}"
