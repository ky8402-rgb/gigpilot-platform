"""Per-exchange credential storage, encrypted at rest and fail-closed.

THREAT MODEL
------------
The credentials this file protects can move real money. The realistic failure modes are not exotic:

  * A secret written to disk in the clear and then swept up by a backup, a log shipper, a `git add
    -A`, or a support bundle. Encryption at rest means a leaked FILE is not a leaked KEY.
  * A secret rendered into a log line or an exception traceback. Every rendered form of a credential
    goes through `redact()`; nothing here interpolates a secret into a message.
  * A withdrawal-enabled key used for trading. A trading key must never be able to withdraw, so
    `allow_withdraw` is refused at WRITE time rather than merely defaulted to False — a policy that
    can only be expressed as a default is a policy that will eventually be flipped.
  * A missing master key silently degrading to plaintext. There is NO plaintext fallback. If the
    master key is absent or wrong, reading credentials FAILS.

VENUE DIFFERENCES THAT MATTER
-----------------------------
Bybit and Binance sign with HMAC-SHA256 over key+secret. KuCoin additionally requires a
PASSPHRASE in the signature, so `passphrase` is part of the model rather than a KuCoin special case
bolted on later. Binance and Bybit leave it empty.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import base64
import hashlib
import json
import logging
import os
import secrets
from dataclasses import asdict, dataclass, field
from pathlib import Path

from gpkg.core.clock import now_ms
from gpkg.exchange.base import CredentialsMissing, ExchangeError

log = logging.getLogger("gigpilot")

# Fernet (AES-128-CBC + HMAC-SHA256). `cryptography` is a declared dependency; a missing library is
# a hard error rather than a reason to store secrets in the clear.
# The OPTIONAL-dependency fallback, expressed ONCE instead of suppressed at every use site.
# mypy analyses the `TYPE_CHECKING` branch, so it sees the REAL classes and needs no `# type: ignore`;
# the interpreter never runs that branch and takes the `else`, which is the graceful degradation.
# The previous form assigned `None`/`Exception` over the imported names behind two `# type: ignore`
# comments, which is exactly the "suppress rather than express" pattern — and it still leaked an error,
# because `InvalidToken = Exception` rebinds a TYPE, which `ignore[assignment]` does not cover.
if TYPE_CHECKING:  # pragma: no cover
    from cryptography.fernet import Fernet, InvalidToken

    _FERNET_AVAILABLE: bool
else:
    try:
        from cryptography.fernet import Fernet, InvalidToken

        _FERNET_AVAILABLE = True
    except ImportError:  # pragma: no cover - exercised only when the dep is absent
        Fernet = None
        InvalidToken = Exception
        _FERNET_AVAILABLE = False


MASTER_KEY_ENV = ("GIGPILOT_MASTER_KEY", "EXCHANGE_CREDENTIAL_MASTER_KEY")
DEFAULT_STORE = ".gigpilot-data/exchange-credentials.enc"


# =====================================================================================
# Redaction — the only sanctioned way to render a credential
# =====================================================================================
def redact(value: str | None, keep: int = 4) -> str:
    """Render a secret for logs: never the whole thing, and never nothing.

    Keeping a short prefix lets an operator confirm WHICH key is in play without disclosing it.
    Short values are fully masked, because for a short secret even 4 characters is a meaningful
    fraction of the entropy.
    """
    if not value:
        return "<unset>"
    if len(value) <= keep * 2:
        return "*" * len(value)
    return f"{value[:keep]}{'*' * 8}{value[-2:]}"


# =====================================================================================
# Model
# =====================================================================================
@dataclass
class ExchangeCredential:
    exchange: str
    api_key: str
    # repr=False on EVERY secret field. The generated __repr__ renders all fields, so without this a
    # single `log.debug("%s", cred)` — or any traceback printing the object — publishes the live
    # secret. `describe()` already redacted deliberately; this closes the accidental path.
    api_secret: str = field(repr=False)
    passphrase: str = field(default="", repr=False)  # KuCoin requires it; Bybit/Binance leave it empty
    label: str = ""
    allow_trade: bool = False     # autonomous routing requires this to be explicitly granted
    allow_read: bool = True
    # Withdrawals must never be reachable from a trading key. Stored ONLY so the readiness layer can
    # assert that the venue agrees; a True here is a refusal, not a grant.
    allow_withdraw: bool = False
    added_ms: int = field(default_factory=now_ms)

    def signature_fields(self) -> tuple[str, ...]:
        """Which fields this venue's signature actually consumes."""
        return ("api_key", "api_secret", "passphrase") if self.passphrase else ("api_key", "api_secret")

    def describe(self) -> dict:
        """Safe representation. Never includes a secret, in whole or in part beyond `redact`."""
        return {
            "exchange": self.exchange,
            "label": self.label,
            "api_key": redact(self.api_key),
            "has_passphrase": bool(self.passphrase),
            "allow_trade": self.allow_trade,
            "allow_read": self.allow_read,
            "allow_withdraw": self.allow_withdraw,
            "added_ms": self.added_ms,
        }


# =====================================================================================
# Store
# =====================================================================================
class CredentialStore:
    """Encrypted, per-exchange credential store.

    The master key comes from the environment (or is supplied directly in tests). Everything else
    lives in one encrypted file, written 0600.
    """

    def __init__(self, path: str | None = None, master_key: str | None = None):
        # `or DEFAULT_STORE` on the OUTSIDE: `os.getenv` is `str | None`, so `path or os.getenv(...)`
        # could still be None and `Path(None)` raises — the fallback has to cover the env var too.
        self.path = Path(path or os.getenv("GIGPILOT_CREDENTIAL_STORE") or DEFAULT_STORE)
        self._explicit_key = master_key
        self._cache: dict[str, ExchangeCredential] | None = None

    # -- master key ------------------------------------------------------------------
    def _master_key(self) -> str:
        if self._explicit_key:
            return self._explicit_key
        for name in MASTER_KEY_ENV:
            v = os.getenv(name)
            if v and v.strip():
                return v.strip()
        raise CredentialsMissing(
            "multi-exchange",
            "no credential master key configured. Set GIGPILOT_MASTER_KEY (or "
            "EXCHANGE_CREDENTIAL_MASTER_KEY). There is deliberately NO plaintext fallback: "
            "storing exchange secrets unencrypted because a key was missing is exactly the "
            "failure this store exists to prevent.",
        )

    def _fernet(self) -> Fernet:
        if not _FERNET_AVAILABLE:
            raise CredentialsMissing(
                "multi-exchange",
                "the `cryptography` package is required to read or write exchange credentials",
            )
        key = self._master_key().strip()
        # Accept either a ready-made Fernet key or an arbitrary passphrase, which is stretched to a
        # valid key. Operators should not have to learn Fernet's base64 format to set a secret.
        try:
            return Fernet(key.encode())
        except Exception:
            digest = hashlib.sha256(key.encode()).digest()
            return Fernet(base64.urlsafe_b64encode(digest))

    def is_configured(self) -> bool:
        try:
            self._master_key()
            return True
        except ExchangeError:
            return False

    def exists(self) -> bool:
        return self.path.is_file()

    # -- io --------------------------------------------------------------------------
    def load(self) -> dict[str, ExchangeCredential]:
        """Read and decrypt. Raises rather than returning {} on failure.

        Returning an empty map on a decryption error would look identical to "no exchanges
        connected", and the allocator would then treat a broken credential store as a configuration
        with no exchanges — silently disabling trading instead of reporting the fault.
        """
        if self._cache is not None:
            return dict(self._cache)
        # Validate the master key BEFORE the file-existence shortcut.
        #
        # Returning {} for a missing file without checking the key makes "no master key configured"
        # indistinguishable from "no exchanges connected". The store would then look legitimately
        # empty rather than misconfigured, and the allocator would quietly route nothing instead of
        # reporting the fault. A store that cannot be operated must say so, not present an empty
        # result that reads as a valid answer.
        self._master_key()
        if not self.path.is_file():
            self._cache = {}
            return {}
        try:
            blob = self.path.read_bytes()
            plain = self._fernet().decrypt(blob)
            raw = json.loads(plain.decode("utf-8"))
        except InvalidToken as e:
            raise CredentialsMissing(
                "multi-exchange",
                f"credential store {self.path} could not be decrypted: the master key is wrong or "
                f"the file is corrupt. Refusing to continue — treating this as 'no exchanges "
                f"configured' would silently disable trading.",
            ) from e
        except Exception as e:
            raise ExchangeError("multi-exchange", f"credential store unreadable: {e}", retryable=False) from e

        out: dict[str, ExchangeCredential] = {}
        for name, entry in (raw.get("credentials") or {}).items():
            out[name] = ExchangeCredential(**entry)
        self._cache = out
        return dict(out)

    def save(self, creds: dict[str, ExchangeCredential]) -> None:
        for name, c in creds.items():
            self._assert_storable(c)
        payload = {"version": 1, "saved_ms": now_ms(),
                   "credentials": {k: asdict(v) for k, v in creds.items()}}
        blob = self._fernet().encrypt(json.dumps(payload).encode("utf-8"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_bytes(blob)
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)  # atomic: a crash cannot leave a half-written store
        self._cache = dict(creds)
        # Log the SHAPE of the change, never the contents.
        log.info("credential store updated: %s", ", ".join(sorted(creds)) or "<empty>")

    @staticmethod
    def _assert_storable(c: ExchangeCredential) -> None:
        if c.allow_withdraw:
            raise ValueError(
                f"refusing to store a withdrawal-enabled credential for {c.exchange!r}. "
                "A key used for trading must never be able to withdraw; this is enforced at write "
                "time because a policy expressed only as a default will eventually be flipped."
            )
        if not c.api_key or not c.api_secret:
            raise ValueError(f"{c.exchange!r}: api_key and api_secret are both required")

    # -- mutation --------------------------------------------------------------------
    def upsert(self, cred: ExchangeCredential) -> None:
        creds = self.load()
        creds[cred.exchange] = cred
        self.save(creds)

    def remove(self, exchange: str) -> bool:
        creds = self.load()
        if exchange not in creds:
            return False
        del creds[exchange]
        self.save(creds)
        return True

    def get(self, exchange: str) -> ExchangeCredential | None:
        return self.load().get(exchange)

    def describe_all(self) -> list[dict]:
        return [c.describe() for c in self.load().values()]


def generate_master_key() -> str:
    """A fresh master key. Printed by the CLI helper, not stored by this module."""
    return secrets.token_urlsafe(48)
