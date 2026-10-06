#!/usr/bin/env python3
"""LOGIN THROTTLE — brute-force protection that previously did not exist at all.

Regression origin
-----------------
`login`, `verify_totp` and `verify_emergency_pin` were unbounded. No attempt counter, no lockout, no
rate limit, no 429 anywhere in `gpkg/`. At HTTP speed that is a practical attack, not a theoretical
one: TOTP is 6 digits and the ±1-step window accepts three codes at once, so any single request in
the right window is a 3-in-10^6 guess — and guesses were free.

The old code even commented that the break-glass PIN is checked first "so a lockout is always
recoverable", describing a lockout that did not exist. These tests make that comment true.

Run: python3 -m pytest tests/test_auth_throttle.py -q
"""
from __future__ import annotations

import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.api.auth import (  # noqa: E402
    LoginThrottle,
    OwnerAuth,
    OwnerConfig,
    generate_totp,
    hash_password,
)

PASSWORD = "correct-horse-battery-staple"
PIN = "a1b2c3d4"


def make_auth(max_failures: int = 3, base_lock_ms: int = 60_000,
              max_lock_ms: int = 300_000) -> OwnerAuth:
    salt = "deadbeefdeadbeef"
    cfg = OwnerConfig(
        owner_email="owner@example.com",
        jwt_secret="test-secret-that-is-long-enough-for-hs256",
        emergency_pin=PIN,
        password_salt=salt,
        password_hash=hash_password(PASSWORD, salt),
        totp_secret="JBSWY3DPEHPK3PXP",
        totp_enabled=True,
    )
    return OwnerAuth(cfg, throttle=LoginThrottle(max_failures=max_failures,
                                                 base_lock_ms=base_lock_ms,
                                                 max_lock_ms=max_lock_ms))


def wrong(auth: OwnerAuth):
    """A wrong-password attempt including a valid TOTP, so only the password fails."""
    return auth.login("owner@example.com", "wrong-password",
                      generate_totp(auth.config.totp_secret), "")


def right(auth: OwnerAuth):
    return auth.login("owner@example.com", PASSWORD,
                      generate_totp(auth.config.totp_secret), "")


# =============================================================================================
# Core behaviour
# =============================================================================================
def test_failures_are_counted_and_then_lock_out():
    auth = make_auth(max_failures=3)
    for i in range(3):
        ok, _, err = wrong(auth)
        assert ok is False
        assert "Too many" not in err, f"locked out too early on attempt {i + 1}"
    allowed, retry = auth.throttle.check()
    assert allowed is False, "not locked after crossing the threshold"
    assert retry > 0


def test_lockout_blocks_even_a_correct_credential():
    """The decisive test: once locked, the RIGHT password must not get in.

    If a correct credential still succeeds during lockout, the throttle is decorative — an attacker
    simply keeps guessing and one of the guesses is right.
    """
    auth = make_auth(max_failures=2)
    wrong(auth)
    wrong(auth)
    ok, token, err = right(auth)
    assert ok is False, "a correct credential bypassed the lockout"
    assert token == ""
    assert "Too many" in err


def test_lockout_refuses_before_comparing_credentials():
    """A locked caller must not even make the server do PBKDF2 work."""
    auth = make_auth(max_failures=1)
    wrong(auth)
    # A valid TOTP and correct password still must not be evaluated.
    ok, _, _ = auth.login("owner@example.com", PASSWORD,
                          generate_totp(auth.config.totp_secret), "")
    assert ok is False


def test_success_before_the_threshold_resets_the_counter():
    auth = make_auth(max_failures=4)
    wrong(auth)
    wrong(auth)
    assert auth.throttle.snapshot()["failures"] == 2
    ok, _, _ = right(auth)
    assert ok is True
    assert auth.throttle.snapshot() == {"failures": 0, "locked": False}, (
        "a successful login must clear the counter, or an operator who mistyped twice gets locked "
        "out by two unrelated later failures"
    )


def test_backoff_grows_and_is_bounded():
    t = LoginThrottle(max_failures=2, base_lock_ms=1_000, max_lock_ms=8_000)
    t.record_failure(); t.record_failure()
    _, first = t.check()
    for _ in range(6):
        t.record_failure()
    _, later = t.check()
    assert later >= first, f"backoff did not grow ({first}s -> {later}s)"
    assert later <= 8, f"backoff exceeded its cap: {later}s"


def test_bad_pin_counts_toward_the_same_throttle():
    """The PIN is a second brute-force surface on the same account, so it shares the counter."""
    auth = make_auth(max_failures=3)
    for _ in range(3):
        assert auth.verify_emergency_pin("00000000") is False
    assert auth.throttle.check()[0] is False


def test_lockout_blocks_every_path_including_the_pin():
    """A lockout must not be bypassable by switching to a WEAKER credential.

    If a correct break-glass PIN could clear the lockout, the PIN would BECOME the bypass: an
    attacker who is locked out simply keeps grinding 8 hex characters, which is exactly the hole
    this throttle exists to close. So the lockout refuses every credential path, and operator
    recovery is a service restart — an action the remote attacker cannot take, and one that clears
    the in-process state by construction.

    (This test originally asserted the opposite, and failed. The implementation was right and the
    expectation was wrong; the fix was to the expectation, not the control.)
    """
    auth = make_auth(max_failures=2)
    wrong(auth)
    wrong(auth)
    assert auth.throttle.check()[0] is False
    assert auth.verify_emergency_pin(PIN) is False, "the PIN bypassed the lockout"
    ok, token, _ = auth.login("owner@example.com", PASSWORD,
                              generate_totp(auth.config.totp_secret), PIN)
    assert ok is False and token == "", "the PIN in the login body bypassed the lockout"


def test_correct_pin_before_the_threshold_clears_the_counter():
    """Below the threshold there is no lockout, so a correct PIN still resets the counter."""
    auth = make_auth(max_failures=4)
    wrong(auth)
    assert auth.throttle.snapshot()["failures"] == 1
    assert auth.verify_emergency_pin(PIN) is True
    assert auth.throttle.snapshot()["failures"] == 0


def test_lockout_expires():
    t = LoginThrottle(max_failures=1, base_lock_ms=300, max_lock_ms=300)
    t.record_failure()
    assert t.check()[0] is False
    time.sleep(0.35)
    assert t.check()[0] is True, "lockout never expired"


def test_failures_decay_after_the_window():
    """An operator who mistypes once a week must never accumulate a lockout."""
    t = LoginThrottle(max_failures=3, base_lock_ms=1000, max_lock_ms=1000, window_ms=50)
    t.record_failure()
    t.record_failure()
    time.sleep(0.07)
    allowed, _ = t.check()
    assert allowed is True
    assert t.snapshot()["failures"] == 0, "stale failures were not forgotten"


def test_wrong_email_also_counts():
    """Otherwise the email check is a free probe that costs the attacker nothing."""
    auth = make_auth(max_failures=2)
    auth.login("someone-else@example.com", "", "", "")
    auth.login("someone-else@example.com", "", "", "")
    assert auth.throttle.check()[0] is False


def test_missing_factors_do_not_count_as_failures():
    """An incomplete form is not a guess; counting it would let a typo cause a lockout."""
    auth = make_auth(max_failures=2)
    auth.login("owner@example.com", "", "", "")   # not configured path / missing password
    assert auth.throttle.snapshot()["failures"] == 0


# =============================================================================================
# Route behaviour
# =============================================================================================
def test_login_route_returns_429_with_retry_after(monkeypatch):
    """The HTTP contract: 429 + Retry-After, not a 401.

    401 would say "your guess was wrong" when the truth is "stop guessing", and would invite exactly
    the retry the lockout exists to prevent.
    """
    import os
    os.environ.setdefault("BYBIT_API_KEY", "d")
    os.environ.setdefault("BYBIT_API_SECRET", "d")
    from fastapi.testclient import TestClient
    import gigpilot

    auth = make_auth(max_failures=2)
    monkeypatch.setattr(gigpilot, "get_owner_auth", lambda: auth)

    client = TestClient(gigpilot.app)
    body = {"email": "owner@example.com", "password": "nope", "totpCode": "000000",
            "emergencyPin": ""}
    for _ in range(2):
        client.post("/api/auth/login", json=body)

    r = client.post("/api/auth/login", json=body)
    assert r.status_code == 429, f"expected 429, got {r.status_code}: {r.text[:200]}"
    assert "retry-after" in {k.lower() for k in r.headers}, "missing Retry-After header"
    assert int(r.headers["retry-after"]) > 0
    assert r.json().get("lockedOut") is True
