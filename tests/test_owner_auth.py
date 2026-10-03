#!/usr/bin/env python3
"""OWNER AUTHENTICATION — the control plane's front door.

These tests exist because the Python control plane previously had NO authentication at all: any
caller who could reach the port could arm live trading or trip the kill switch. The tests below
prove both halves of that: that a credential is now required, and that the credential cannot be
forged.

Run: python3 tests/test_owner_auth.py
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.api.auth import (  # noqa: E402
    OwnerAuth,
    OwnerConfig,
    TokenError,
    base32_decode,
    base32_encode,
    generate_totp,
    hash_password,
    sign_token,
    verify_token,
    verify_totp,
)

FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    """Assert a named condition.

    This RAISES on failure rather than only recording it. A soft recorder that merely tallies
    failures is invisible to pytest — the suite reports green while the property is broken, which is
    strictly worse than having no test. (Learned the hard way: an alg-confusion regression was
    initially reported as "detected" only because the mutation run predated this fix.)
    """
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(name)
        raise AssertionError(f"{name}" + (f" — {detail}" if detail else ""))


def make_auth(tmp_path: Path, pin: str = "pin-abcdef123") -> OwnerAuth:
    cfg = OwnerConfig(
        owner_email="owner@example.com",
        password_salt="0123456789abcdef",
        password_hash=hash_password("correct horse battery", "0123456789abcdef"),
        totp_secret=base32_encode(b"01234567890123456789"),
        totp_enabled=True,
        emergency_pin=pin,
        jwt_secret="unit-test-secret",
    )
    return OwnerAuth(cfg)


def test_token_roundtrip(tmp_path):
    print("\n1. Token mint/verify round trip")
    auth = make_auth(tmp_path)
    token = auth.mint()
    check("minted token verifies", auth.verify(token) is True)
    payload = verify_token(token, auth.config.jwt_secret)
    check("payload carries role=owner", payload.get("role") == "owner")
    check("payload has 30-day expiry",
          payload["exp"] - payload["iat"] == 30 * 24 * 3600,
          f"exp-iat={payload['exp'] - payload['iat']}")


def test_forgery_is_refused(tmp_path):
    print("\n2. Forgery, tampering and algorithm confusion are refused")
    auth = make_auth(tmp_path)
    secret = auth.config.jwt_secret
    token = auth.mint()
    h, p, s = token.split(".")

    # (a) flipped bit in the signature
    bad_sig = ("A" if s[0] != "A" else "B") + s[1:]
    check("bit-flipped signature refused", auth.verify(f"{h}.{p}.{bad_sig}") is False)

    # (b) tampered payload claiming owner role on a different secret
    forged = sign_token({"sub": "attacker", "role": "owner",
                         "iat": int(time.time()), "exp": int(time.time()) + 9999}, "wrong-secret")
    check("token signed with wrong secret refused", auth.verify(forged) is False)

    # (c) alg:none — the classic JWT bypass
    def b64(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    none_token = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'role': 'owner', 'exp': int(time.time()) + 9999})}."
    check("alg:none refused", auth.verify(none_token) is False,
          "alg:none was accepted — unsigned tokens would grant owner access")

    # (c2) algorithm confusion with a CORRECTLY SIGNED token.
    # The signature is genuinely valid HMAC-SHA256; only the header's declared `alg` is a lie. A
    # verifier that trusts the header — or that merely checks the signature — accepts this. Only an
    # explicit "the header must say HS256" rule rejects it.
    def b64url(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    def signed_with_alg(payload: dict, alg: str) -> str:
        head = b64url(json.dumps({"alg": alg, "typ": "JWT"}, separators=(",", ":")).encode())
        body = b64url(json.dumps(payload, separators=(",", ":")).encode())
        sig = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
        return f"{head}.{body}.{b64url(sig)}"

    for alg in ("RS256", "HS512", "none", "", "hs256"):
        forged_token = signed_with_alg({"role": "owner", "exp": int(time.time()) + 9999}, alg)
        check(f"correctly-signed token declaring alg={alg!r} refused",
              auth.verify(forged_token) is False,
              f"alg={alg!r} was accepted — algorithm confusion is exploitable")

    # Control: the same payload with a HONEST header must be accepted, proving the rejection above
    # is caused by the algorithm check and not by the payload shape.
    honest = sign_token({"role": "owner", "exp": int(time.time()) + 9999}, secret)
    check("control: honest HS256 token with the same payload IS accepted",
          auth.verify(honest) is True)

    # (d) correct signature but non-owner role
    non_owner = sign_token({"role": "viewer", "exp": int(time.time()) + 9999}, secret)
    check("non-owner role refused", auth.verify(non_owner) is False)

    # (e) expired
    expired = sign_token({"role": "owner", "exp": int(time.time()) - 10}, secret)
    check("expired token refused", auth.verify(expired) is False)

    # (f) structurally invalid
    for label, bad in [("empty", ""), ("two segments", "a.b"), ("garbage", "not-a-token")]:
        check(f"{label} token refused", auth.verify(bad) is False)


def test_password_login(tmp_path):
    print("\n3. Password + TOTP login")
    auth = make_auth(tmp_path)
    code = generate_totp(auth.config.totp_secret)

    ok, token, err = auth.login("owner@example.com", "correct horse battery", code)
    check("valid password + TOTP succeeds", ok and bool(token), err)
    check("issued token verifies", auth.verify(token))

    ok, _, err = auth.login("owner@example.com", "wrong password", code)
    check("wrong password refused", not ok, err)

    ok, _, err = auth.login("someone@else.com", "correct horse battery", code)
    check("non-owner email refused", not ok, err)

    ok, _, err = auth.login("owner@example.com", "correct horse battery", "000000")
    check("wrong TOTP refused", not ok, err)

    ok, _, err = auth.login("owner@example.com", "correct horse battery", "")
    check("missing TOTP refused", not ok, err)


def test_totp_window_and_shape(tmp_path):
    print("\n4. TOTP verification window and input shape")
    auth = make_auth(tmp_path)
    secret = auth.config.totp_secret
    now = int(time.time())
    check("current code accepted", verify_totp(generate_totp(secret, 0, at=now), secret, at=now))
    check("previous step accepted (clock skew)",
          verify_totp(generate_totp(secret, -1, at=now), secret, at=now))
    check("next step accepted (clock skew)",
          verify_totp(generate_totp(secret, +1, at=now), secret, at=now))
    check("code 5 steps away refused",
          not verify_totp(generate_totp(secret, 5, at=now), secret, at=now))
    for bad in ("", "12345", "1234567", "abcdef", "  "):
        check(f"malformed code {bad!r} refused", not verify_totp(bad, secret, at=now))


def test_emergency_pin(tmp_path):
    print("\n5. Break-glass PIN")
    auth = make_auth(tmp_path, pin="secret-pin-999")
    ok, token, err = auth.login("owner@example.com", emergency_pin="secret-pin-999")
    check("correct PIN mints a session", ok and bool(token), err)
    ok, _, _ = auth.login("owner@example.com", emergency_pin="wrong-pin-999")
    check("wrong PIN refused", not ok)
    ok, _, _ = auth.login("owner@example.com", emergency_pin="secret-pin-99")
    check("truncated PIN refused (length differs)", not ok)


def test_no_hardcoded_default_pin(tmp_path, monkeypatch):
    print("\n6. No hardcoded default credential")
    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(tmp_path / "fresh"))
    monkeypatch.delenv("OWNER_AUTH_PIN", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    fresh = OwnerAuth()
    # Value-withholding comparison: a bare equality assert makes pytest render both operands on
    # failure, which is exactly how a live secret escaped into a world-readable Actions log.
    check("generated PIN is not the legacy literal 778899",
          (fresh.config.emergency_pin == "778899") is False, "value withheld: secret")
    check("generated PIN is not empty", bool(fresh.config.emergency_pin))
    check("generated PIN has real entropy (>=8 chars)", len(fresh.config.emergency_pin) >= 8,
          f"len={len(fresh.config.emergency_pin)}")
    check("fresh account is NOT configured (cannot password-login)",
          fresh.is_configured is False)
    ok, _, _ = fresh.login("ky8402@gmail.com", "anything", "123456")
    check("uninitialised account refuses password login", not ok)

    cfg_path = tmp_path / "fresh" / "owner-auth-config.json"
    check("config persisted to disk", cfg_path.is_file())
    if cfg_path.is_file():
        mode = cfg_path.stat().st_mode & 0o777
        check("config file is 0600 (owner-only)", mode == 0o600, f"mode={oct(mode)}")


def test_legacy_pin_is_scrubbed(tmp_path, monkeypatch):
    print("\n7. A persisted legacy 778899 PIN is replaced, not honoured")
    data = tmp_path / "legacy"
    data.mkdir(parents=True)
    (data / "owner-auth-config.json").write_text(json.dumps({
        "ownerEmail": "ky8402@gmail.com", "passwordSalt": "x", "passwordHash": "",
        "totpSecret": base32_encode(b"abc"), "totpEnabled": False,
        "emergencyPin": "778899", "jwtSecret": "s",
    }))
    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(data))
    monkeypatch.delenv("OWNER_AUTH_PIN", raising=False)
    auth = OwnerAuth()
    check("legacy 778899 not retained", auth.config.emergency_pin != "778899")
    ok, _, _ = auth.login("ky8402@gmail.com", emergency_pin="778899")
    check("logging in with 778899 fails", not ok)


def test_base32_roundtrip():
    print("\n8. Base32 codec (TOTP secret transport)")
    for raw in (b"", b"a", b"hello world", bytes(range(20))):
        check(f"roundtrip {raw!r}", base32_decode(base32_encode(raw)) == raw)


def main() -> int:
    import tempfile

    print("=" * 78)
    print("OWNER AUTHENTICATION")
    print("=" * 78)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        cases = [
            ("token roundtrip", lambda: test_token_roundtrip(tmp)),
            ("forgery refused", lambda: test_forgery_is_refused(tmp)),
            ("password login", lambda: test_password_login(tmp)),
            ("totp window", lambda: test_totp_window_and_shape(tmp)),
            ("emergency pin", lambda: test_emergency_pin(tmp)),
            ("no default pin", lambda: test_no_hardcoded_default_pin(tmp, _monkey(tmp))),
            ("legacy pin scrubbed", lambda: test_legacy_pin_is_scrubbed(tmp, _monkey(tmp))),
            ("base32 codec", test_base32_roundtrip),
        ]
        for label, fn in cases:
            try:
                fn()
            except AssertionError as exc:
                print(f"  !! section '{label}' failed: {exc}")

    print("\n" + "=" * 78)
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}): " + ", ".join(FAILURES))
        return 1
    print("ALL OWNER-AUTH CHECKS PASSED")
    return 0


class _Monkey:
    """Minimal monkeypatch stand-in so this file can also run standalone (no pytest needed)."""

    def __init__(self, tmp: Path):
        self.tmp = tmp

    def setenv(self, k, v):
        import os
        os.environ[k] = v

    def delenv(self, k, raising=True):
        import os
        os.environ.pop(k, None)


def _monkey(tmp: Path) -> _Monkey:
    return _Monkey(tmp)


if __name__ == "__main__":
    raise SystemExit(main())
