"""Single-owner authentication for the GigPilot control plane.

PARITY
------
Behaviour is ported from the Node implementation of record
(`server/trading/ownerAuth.ts`) so both stacks enforce the SAME boundary:

  * owner identity is an email (`OWNER_EMAIL`, default `ky8402@gmail.com`);
  * passwords are PBKDF2-HMAC-SHA512, 100_000 iterations, 64-byte derived key, 16-byte salt;
  * TOTP is RFC 6238 / SHA1 / 6 digits / 30-second step, accepted across a +/-1 step window;
  * a constant-time-compared emergency PIN exists as a break-glass credential;
  * sessions are HS256 JWTs carrying `role="owner"`, valid 30 days;
  * the token is read from `Authorization: Bearer`, `?token=`, or `X-Owner-Token`.

WHY NO THIRD-PARTY DEPENDENCY
-----------------------------
JWT, PBKDF2 and TOTP are all implemented against the standard library. Adding PyJWT/Jose to
`requirements.txt` would widen the supply chain of a process holding live exchange credentials for a
few dozen lines of well-specified code. Nothing here is bespoke cryptography: HS256, PBKDF2 and
TOTP are all composed from `hmac`/`hashlib`, which are OpenSSL-backed.

FAIL-CLOSED
-----------
The engine must never become reachable because of a *missing* credential. Specific rules:

  * No hardcoded default PIN. A legacy literal default would be a public bypass, so if
    `OWNER_AUTH_PIN` is absent a cryptographically random PIN is generated and persisted `0600`.
    (The Node version scrubs a legacy `778899` default for exactly this reason.)
  * An uninitialised owner account mints no session from a password — only the break-glass PIN,
    which is itself a secret, can bootstrap.
  * A token whose signature does not verify, whose `alg` is anything other than HS256, whose
    `exp` has passed, or whose `role` is not `owner`, is refused.
  * `alg: none` and key-confusion are refused explicitly rather than by omission.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException, Request

# RFC 4648 Base32 alphabet (TOTP secrets are shared with authenticator apps as ASCII base32).
_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

JWT_ALG = "HS256"
TOKEN_TTL_SECONDS = 30 * 24 * 3600  # 30 days, matching the Node implementation.
TOTP_STEP_SECONDS = 30
TOTP_DIGITS = 6

PBKDF2_ITERATIONS = 100_000
PBKDF2_DKLEN = 64
PBKDF2_SALT_BYTES = 16


# --------------------------------------------------------------------------------------
# base32 (RFC 4648) — used only for TOTP secrets
# --------------------------------------------------------------------------------------
def base32_decode(data: str) -> bytes:
    cleaned = "".join(c for c in data.upper() if c in _B32)
    bits = 0
    value = 0
    out = bytearray()
    for ch in cleaned:
        value = (value << 5) | _B32.index(ch)
        bits += 5
        if bits >= 8:
            out.append((value >> (bits - 8)) & 0xFF)
            bits -= 8
    return bytes(out)


def base32_encode(raw: bytes) -> str:
    bits = 0
    value = 0
    out = []
    for byte in raw:
        value = (value << 8) | byte
        bits += 8
        while bits >= 5:
            out.append(_B32[(value >> (bits - 5)) & 31])
            bits -= 5
    if bits > 0:
        out.append(_B32[(value << (5 - bits)) & 31])
    return "".join(out)


# --------------------------------------------------------------------------------------
# TOTP (RFC 6238)
# --------------------------------------------------------------------------------------
def generate_totp(secret_base32: str, step_offset: int = 0, at: Optional[int] = None) -> str:
    epoch = int(time.time() if at is None else at)
    counter = epoch // TOTP_STEP_SECONDS + step_offset
    key = base32_decode(secret_base32)
    digest = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    return str(binary % (10**TOTP_DIGITS)).zfill(TOTP_DIGITS)


def verify_totp(token: str, secret_base32: str, at: Optional[int] = None) -> bool:
    """Accepts the current step plus/minus one (a 90-second window for clock skew)."""
    candidate = (token or "").strip()
    if len(candidate) != TOTP_DIGITS or not candidate.isdigit():
        return False
    for offset in (-1, 0, 1):
        if hmac.compare_digest(generate_totp(secret_base32, offset, at=at), candidate):
            return True
    return False


# --------------------------------------------------------------------------------------
# Passwords
# --------------------------------------------------------------------------------------
def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha512", password.encode(), salt.encode(), PBKDF2_ITERATIONS, dklen=PBKDF2_DKLEN
    ).hex()


def _constant_time_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# --------------------------------------------------------------------------------------
# JWT (HS256) — deliberately minimal, standard-library only
# --------------------------------------------------------------------------------------
def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(seg: str) -> bytes:
    pad = "=" * (-len(seg) % 4)
    return base64.urlsafe_b64decode(seg + pad)


class TokenError(Exception):
    """Raised when a token is malformed, mis-signed, confused, expired or wrongly scoped."""


def sign_token(payload: dict, secret: str) -> str:
    header = {"alg": JWT_ALG, "typ": "JWT"}
    h = _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode())
    p = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signing_input = f"{h}.{p}".encode()
    sig = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{h}.{p}.{_b64url_encode(sig)}"


def verify_token(token: str, secret: str, now: Optional[int] = None) -> dict:
    """Verify signature, algorithm, expiry and scope. Raises TokenError on any failure."""
    if not token or not secret:
        raise TokenError("missing token or secret")
    parts = token.split(".")
    if len(parts) != 3:
        raise TokenError("malformed token")

    h_seg, p_seg, s_seg = parts
    try:
        header = json.loads(_b64url_decode(h_seg))
        payload = json.loads(_b64url_decode(p_seg))
        provided_sig = _b64url_decode(s_seg)
    except (binascii.Error, ValueError, UnicodeDecodeError) as exc:
        raise TokenError(f"undecodable token: {exc}") from exc

    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise TokenError("token segments must be JSON objects")

    # Algorithm confusion ("alg: none", or an RS256 token presented to an HS256 verifier) is refused
    # explicitly rather than by omission — this is the classic JWT forgery class.
    if header.get("alg") != JWT_ALG:
        raise TokenError(f"unsupported alg: {header.get('alg')!r}")

    expected_sig = hmac.new(
        secret.encode(), f"{h_seg}.{p_seg}".encode(), hashlib.sha256
    ).digest()
    if not hmac.compare_digest(expected_sig, provided_sig):
        raise TokenError("bad signature")

    now = int(time.time()) if now is None else now
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or int(exp) < now:
        raise TokenError("token expired")

    if payload.get("role") != "owner":
        raise TokenError("token is not an owner token")

    return payload


# --------------------------------------------------------------------------------------
# Owner state
# --------------------------------------------------------------------------------------
@dataclass
class OwnerConfig:
    owner_email: str
    password_salt: str
    password_hash: str
    totp_secret: str
    totp_enabled: bool
    emergency_pin: str
    jwt_secret: str
    created_at: str = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    def to_json(self) -> str:
        return json.dumps(self.__dict__, indent=2)

    @staticmethod
    def from_dict(d: dict) -> "OwnerConfig":
        return OwnerConfig(
            owner_email=str(d.get("ownerEmail") or d.get("owner_email") or "ky8402@gmail.com"),
            password_salt=str(d.get("passwordSalt") or d.get("password_salt") or ""),
            password_hash=str(d.get("passwordHash") or d.get("password_hash") or ""),
            totp_secret=str(d.get("totpSecret") or d.get("totp_secret") or ""),
            totp_enabled=bool(d.get("totpEnabled") or d.get("totp_enabled") or False),
            emergency_pin=str(d.get("emergencyPin") or d.get("emergency_pin") or ""),
            jwt_secret=str(d.get("jwtSecret") or d.get("jwt_secret") or ""),
            created_at=str(d.get("createdAt") or d.get("created_at") or ""),
        )


def _data_dir() -> Path:
    raw = os.getenv("GIGPILOT_DATA_DIR", "").strip()
    return Path(raw) if raw else Path(os.getcwd()) / ".gigpilot-data"


def _config_path() -> Path:
    return _data_dir() / "owner-auth-config.json"


def _load_dotenv_once() -> None:
    """Load the app's `.env` so BOTH stacks resolve the same owner secret.

    The Node backend runs under pm2 with cwd = the app directory and reads `.env` (dotenv). The
    Python engine runs beside it with the same cwd. Without this, the Node-minted owner session
    token could not be verified by the engine, and every Node->engine proxy call would 401.

    `OWNER_SESSION_SECRET` / `JWT_SECRET` therefore act as the shared signing secret across both
    stacks, exactly as `.env.example` already implies. Failure to load is non-fatal: the persisted
    `owner-auth-config.json` (which Node writes and this module reads) carries the fallback
    `jwtSecret`, so the two still converge even with no `.env`.
    """
    try:
        from dotenv import load_dotenv

        load_dotenv(dotenv_path=Path(os.getcwd()) / ".env", override=False)
    except Exception:
        pass


def _load_or_create_config() -> OwnerConfig:
    """Load the owner config, or mint one.

    A fresh config carries NO usable password, so it cannot be logged into with an email+password
    pair. The only way in is the break-glass PIN, which comes from `OWNER_AUTH_PIN` when supplied and
    is otherwise randomly generated and persisted `0600`.
    """
    _load_dotenv_once()
    path = _config_path()
    env_pin = (os.getenv("OWNER_AUTH_PIN") or "").strip()
    env_secret = (os.getenv("JWT_SECRET") or os.getenv("OWNER_SESSION_SECRET") or "").strip()

    if path.is_file():
        try:
            cfg = OwnerConfig.from_dict(json.loads(path.read_text(encoding="utf-8")))
            # Never honour a known-legacy or empty PIN: that would be a public bypass.
            if not cfg.emergency_pin or cfg.emergency_pin == "778899" or len(cfg.emergency_pin) < 6:
                cfg.emergency_pin = env_pin if len(env_pin) >= 6 else secrets.token_hex(4)
                _persist(path, cfg)
            # Signing-secret precedence MUST match the Node implementation
            # (server/trading/ownerAuth.ts):  JWT_SECRET > OWNER_SESSION_SECRET > persisted > random.
            # Preferring the file over the environment would let the two stacks hold DIFFERENT
            # secrets the moment the environment changes, and every Node->engine proxy call would
            # then 401 and degrade to 503 ENGINE UNREACHABLE. An env-supplied secret is used
            # in memory only — it is never written to disk.
            if env_secret:
                cfg.jwt_secret = env_secret
            elif not cfg.jwt_secret:
                cfg.jwt_secret = secrets.token_hex(32)
                _persist(path, cfg)
            return cfg
        except Exception:
            # A corrupt config must not silently fall through to a permissive default.
            pass

    cfg = OwnerConfig(
        owner_email=(os.getenv("OWNER_EMAIL") or "ky8402@gmail.com").strip(),
        password_salt=secrets.token_hex(PBKDF2_SALT_BYTES),
        password_hash="",
        totp_secret=base32_encode(secrets.token_bytes(20)),
        totp_enabled=False,
        emergency_pin=env_pin if len(env_pin) >= 6 else secrets.token_hex(4),
        jwt_secret=env_secret or secrets.token_hex(32),
    )
    _persist(path, cfg)
    return cfg


def _persist(path: Path, cfg: OwnerConfig) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(cfg.to_json())
    except Exception:
        # Read-only filesystem: the in-memory config still applies for this process lifetime.
        pass


class OwnerAuth:
    """Owns the single-owner credential and mints/validates session tokens."""

    def __init__(self, config: Optional[OwnerConfig] = None) -> None:
        self.config = config if config is not None else _load_or_create_config()
        self._pending_totp_secret: Optional[str] = None

    # -- first-run provisioning -----------------------------------------------------
    def initiate_setup(self, email: Optional[str] = None) -> dict:
        """Mint a fresh TOTP secret and return an otpauth URL for the authenticator app."""
        self._pending_totp_secret = base32_encode(secrets.token_bytes(20))
        target = email or self.config.owner_email
        issuer = "GigPilot Bybit Quant"
        from urllib.parse import quote

        otpauth = (
            f"otpauth://totp/{quote(issuer)}:{quote(target)}"
            f"?secret={self._pending_totp_secret}&issuer={quote(issuer)}"
            f"&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_STEP_SECONDS}"
        )
        return {
            "secret": self._pending_totp_secret,
            "otpauthUrl": otpauth,
            "totpEnabled": self.config.totp_enabled,
        }

    def complete_setup(
        self, password: str, totp_code: str, email: Optional[str] = None
    ) -> tuple[bool, str, str]:
        """Bind a password + verified TOTP code to the owner account. Returns (ok, token, error)."""
        if not password or len(password) < 12:
            return False, "", "Owner password must be at least 12 characters long."

        secret = self._pending_totp_secret or self.config.totp_secret
        if not verify_totp(totp_code, secret):
            return False, "", "Invalid Google Authenticator 6-digit code. Check your phone clock."

        self.config.owner_email = (email or self.config.owner_email).strip()
        self.config.password_salt = secrets.token_hex(PBKDF2_SALT_BYTES)
        self.config.password_hash = hash_password(password, self.config.password_salt)
        self.config.totp_secret = secret
        self.config.totp_enabled = True
        self._pending_totp_secret = None
        _persist(_config_path(), self.config)
        return True, self.mint(), ""

    def verify_emergency_pin(self, pin: str) -> bool:
        expected = (self.config.emergency_pin or "").strip()
        given = (pin or "").strip()
        if not expected or not given or len(expected) != len(given):
            return False
        return hmac.compare_digest(expected, given)

    @property
    def is_configured(self) -> bool:
        return bool(self.config.password_hash and self.config.totp_enabled)

    def status(self, authenticated: bool) -> dict:
        return {
            "isAuthenticated": authenticated,
            "isConfigured": self.is_configured,
            "ownerEmail": self.config.owner_email,
            "totpEnabled": self.config.totp_enabled,
            "hasPassword": bool(self.config.password_hash),
        }

    def mint(self, email: Optional[str] = None, now: Optional[int] = None) -> str:
        now = int(time.time()) if now is None else now
        return sign_token(
            {
                "sub": email or self.config.owner_email,
                "role": "owner",
                "iat": now,
                "exp": now + TOKEN_TTL_SECONDS,
            },
            self.config.jwt_secret,
        )

    def verify(self, token: str, now: Optional[int] = None) -> bool:
        try:
            verify_token(token, self.config.jwt_secret, now=now)
            return True
        except TokenError:
            return False

    def login(
        self,
        email: str,
        password: str = "",
        totp_code: str = "",
        emergency_pin: str = "",
    ) -> tuple[bool, str, str]:
        """Returns (success, token, error)."""
        if (email or "").strip().lower() != self.config.owner_email.strip().lower():
            return False, "", "Access denied: personal single-owner account."

        # Break-glass PIN is checked first so a lockout is always recoverable, and it is compared in
        # constant time against a secret that is never a hardcoded literal.
        if emergency_pin and self.config.emergency_pin:
            if _constant_time_eq(
                emergency_pin.strip(), self.config.emergency_pin.strip()
            ) and len(emergency_pin.strip()) == len(self.config.emergency_pin.strip()):
                return True, self.mint(), ""

        if not self.is_configured:
            return False, "", "Owner account is not initialized yet. Complete initial setup first."

        if not password:
            return False, "", "Master password is required."

        if not _constant_time_eq(
            hash_password(password, self.config.password_salt), self.config.password_hash
        ):
            return False, "", "Invalid owner password."

        if not totp_code:
            return False, "", "Google Authenticator 6-digit code is required."

        if not verify_totp(totp_code, self.config.totp_secret):
            return False, "", "Invalid Google Authenticator code. Check your device clock."

        return True, self.mint(), ""


# --------------------------------------------------------------------------------------
# FastAPI integration
# --------------------------------------------------------------------------------------
_OWNER_AUTH: Optional[OwnerAuth] = None


def get_owner_auth() -> OwnerAuth:
    global _OWNER_AUTH
    if _OWNER_AUTH is None:
        _OWNER_AUTH = OwnerAuth()
    return _OWNER_AUTH


def extract_token(request: Request) -> Optional[str]:
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.query_params.get("token") or request.headers.get("x-owner-token")


def require_owner(request: Request) -> bool:
    """FastAPI dependency. Refuses unless a valid owner session token is presented."""
    token = extract_token(request)
    if not token or not get_owner_auth().verify(token):
        raise HTTPException(
            status_code=401,
            detail=(
                "Unauthorized: Valid single-owner authentication token required for this "
                "operational trading endpoint."
            ),
        )
    return True
