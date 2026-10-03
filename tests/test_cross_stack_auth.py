#!/usr/bin/env python3
"""CROSS-STACK AUTH — the Node backend and the Python engine must trust ONE owner session.

Why this file exists
--------------------
Adding owner auth to the Python engine introduced a new failure mode that is easy to miss: the Node
backend proxies `/api/trading/gigpilot/{state,arm,disarm,kill}` to the engine. If the engine requires
a session and Node calls it anonymously, every one of those endpoints degrades to
`503 ENGINE UNREACHABLE` — a silent, total loss of the control surface, discovered only in
production. (That is exactly what happened on the first deploy of this change, and it is why the
live proxy is asserted here rather than assumed.)

Convergence is achieved two ways, both asserted below:
  1. `OWNER_SESSION_SECRET` / `JWT_SECRET` from `.env`, which both processes read; and
  2. failing that, the persisted `.gigpilot-data/owner-auth-config.json` `jwtSecret`, which Node
     writes (camelCase) and this package reads.

Run: python3 tests/test_cross_stack_auth.py
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.api import auth as auth_mod  # noqa: E402
from gpkg.api.auth import OwnerAuth  # noqa: E402


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def node_style_token(secret: str, *, role: str = "owner", ttl: int = 30 * 24 * 3600,
                     email: str = "ky8402@gmail.com") -> str:
    """Mint a token byte-for-byte in the shape `jsonwebtoken` produces on the Node side.

    Node: jwt.sign({sub, role, iat}, secret, {expiresIn: '30d'}) with the default HS256 header.
    """
    now = int(time.time())
    head = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64url(json.dumps({"sub": email, "role": role, "iat": now, "exp": now + ttl},
                              separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{_b64url(sig)}"


def _node_shaped_config(secret: str) -> dict:
    """The exact camelCase structure `server/trading/ownerAuth.ts` persists."""
    return {
        "ownerEmail": "ky8402@gmail.com",
        "passwordSalt": "a" * 32,
        "passwordHash": "b" * 128,
        "totpSecret": "JBSWY3DPEHPK3PXP",
        "totpEnabled": True,
        "emergencyPin": "c0ffee42",
        "jwtSecret": secret,
        "createdAt": "2026-10-01T00:00:00.000Z",
    }


def test_python_loads_the_node_written_config_and_shares_its_secret(tmp_path, monkeypatch):
    """The persisted config is the fallback convergence path shared by both stacks."""
    secret = "shared-jwt-secret-from-node-config"
    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    (tmp_path / "owner-auth-config.json").write_text(json.dumps(_node_shaped_config(secret)))

    auth = OwnerAuth()
    assert auth.config.jwt_secret == secret, "engine did not adopt the Node-persisted jwtSecret"
    assert auth.config.owner_email == "ky8402@gmail.com"
    assert auth.config.totp_enabled is True


def test_node_minted_token_verifies_in_python(tmp_path, monkeypatch):
    """The whole point: one session must work on both stacks."""
    secret = "shared-jwt-secret-from-node-config"
    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    (tmp_path / "owner-auth-config.json").write_text(json.dumps(_node_shaped_config(secret)))

    auth = OwnerAuth()
    token = node_style_token(secret)
    assert auth.verify(token) is True, (
        "a Node-minted owner token was rejected by the engine — every Node->engine proxy call "
        "would 401 and degrade to 503 ENGINE UNREACHABLE"
    )


def test_env_secret_is_honoured_and_overrides_the_file(tmp_path, monkeypatch):
    """`OWNER_SESSION_SECRET` from the shared `.env` is the primary convergence path."""
    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_SESSION_SECRET", "env-shared-secret")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    # A DIFFERENT secret is already on disk; the env must win for both stacks to agree.
    (tmp_path / "owner-auth-config.json").write_text(
        json.dumps(_node_shaped_config("stale-file-secret"))
    )

    auth = OwnerAuth()
    assert auth.config.jwt_secret == "env-shared-secret"
    assert auth.verify(node_style_token("env-shared-secret")) is True
    assert auth.verify(node_style_token("stale-file-secret")) is False


def test_python_tokens_are_node_verifiable_in_shape(tmp_path, monkeypatch):
    """The reverse direction: Python-minted sessions must carry the standard HS256 shape."""
    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OWNER_SESSION_SECRET", "shape-secret")
    auth = OwnerAuth()
    token = auth.mint()
    head_seg, body_seg, sig_seg = token.split(".")

    def dec(seg: str) -> dict:
        return json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))

    assert dec(head_seg) == {"alg": "HS256", "typ": "JWT"}
    payload = dec(body_seg)
    assert payload["role"] == "owner"
    assert payload["exp"] - payload["iat"] == 30 * 24 * 3600
    # Independently recompute the signature the way jsonwebtoken does.
    expected = hmac.new(
        b"shape-secret", f"{head_seg}.{body_seg}".encode(), hashlib.sha256
    ).digest()
    assert hmac.compare_digest(
        expected, base64.urlsafe_b64decode(sig_seg + "=" * (-len(sig_seg) % 4))
    )


def test_node_proxy_forwards_the_session_to_the_engine():
    """Structural: every Node->engine proxy that hits a protected route must forward the token.

    Without this, the authenticated owner is rejected by the engine and the endpoint silently
    degrades to 503 — a regression that unit tests on either side alone cannot catch.
    """
    src = (ROOT / "server" / "trading" / "routes.ts").read_text(encoding="utf-8")

    assert "function engineAuthHeaders(" in src, "the engine-auth forwarding helper is missing"
    assert "extractToken(req)" in src, "the helper no longer reads the caller's owner token"

    # The protected engine calls, and how many times each must appear with forwarded auth.
    forwarded = src.count("...engineAuthHeaders(req)")
    assert forwarded >= 4, (
        f"only {forwarded} engine proxy call(s) forward the owner session; "
        "/api/state, /api/arm, /api/disarm and /api/kill all require it"
    )

    for path in ("/api/state", "/api/arm", "/api/disarm", "/api/kill"):
        idx = src.find(f"${{GIGPILOT_URL}}{path}`")
        assert idx != -1, f"{path} proxy call not found"
        window = src[idx: idx + 320]
        assert "engineAuthHeaders(req)" in window, f"{path} proxy does not forward the owner session"

    # The engine's /health is deliberately public (deployment gating depends on it).
    assert "tradingRouter.get('/gigpilot/health', async" in src
    assert "tradingRouter.get('/gigpilot/state', requireOwnerAuth" in src, (
        "/gigpilot/state exposes live equity and positions and must require owner auth"
    )


def test_shared_config_file_is_not_weakened_by_the_engine(tmp_path, monkeypatch):
    """The engine must not overwrite a healthy Node-written config with weaker values."""
    secret = "keep-me"
    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    monkeypatch.delenv("OWNER_AUTH_PIN", raising=False)
    cfg_path = tmp_path / "owner-auth-config.json"
    cfg_path.write_text(json.dumps(_node_shaped_config(secret)))

    OwnerAuth()

    reread = json.loads(cfg_path.read_text())
    assert reread["jwtSecret"] == secret, "engine rewrote the shared signing secret"
    assert reread["emergencyPin"] == "c0ffee42", "engine rewrote the shared break-glass PIN"
    assert reread["passwordHash"] == "b" * 128, "engine dropped the owner password hash"
    assert reread["totpSecret"] == "JBSWY3DPEHPK3PXP"


def test_engine_scrubs_a_weak_pin_in_the_shared_config(tmp_path, monkeypatch):
    """A legacy/weak PIN in the shared file must be replaced, not adopted on both stacks."""
    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("OWNER_AUTH_PIN", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    cfg = _node_shaped_config("s")
    cfg["emergencyPin"] = "778899"
    (tmp_path / "owner-auth-config.json").write_text(json.dumps(cfg))

    auth = OwnerAuth()
    assert auth.config.emergency_pin != "778899"
    assert auth.verify_emergency_pin("778899") is False
