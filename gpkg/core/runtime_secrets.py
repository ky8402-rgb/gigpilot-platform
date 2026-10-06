"""Runtime-only exchange secrets: in memory, never persisted, never printable.

WHY THIS MODULE EXISTS
----------------------
The Bybit API secret was sourced from AWS Secrets Manager, environment variables, `.env` and
`.bybit-quant-keys.json`, and then held as a plain `str` on `Config`. Every one of those is a
durable copy: `.env` and the JSON file sit on disk, `os.environ` is readable through
`/proc/self/environ`, and a plain `str` on a dataclass is printed verbatim by `repr()` — so the
secret reaches logs the moment anything logs a config object.

The specification for live trading is stricter than any of that: the secret must be entered BY HAND
each time the system is armed for live trading, must exist only in memory for the lifetime of that
session, and must never appear in logs, tracebacks or telemetry.

This module provides the three things that requires:

  1. `SecretStr` — a wrapper that REFUSES to render itself. `repr`, `str` and `format` all return a
     redaction marker, so an accidental `log.info("%s", cfg)` cannot leak it. Reading the value
     requires an explicit `.reveal()`, which is greppable and reviewable.
  2. `RuntimeSecretStore` — a process-global, memory-only holder. No file is ever written; `clear()`
     overwrites the buffer and drops the reference. It is the ONLY place a live secret may live.
  3. `SecretRedactingFilter` — a logging filter that rewrites the secret out of every record,
     including its common encodings, as a defence in depth for the paths that never touch `SecretStr`
     (vendored libraries, third-party tracebacks, exception arguments).

WHAT THIS DELIBERATELY DOES NOT DO
----------------------------------
It does not attempt to defeat a process memory dump, and it does not claim to. When a secret is used
to sign a request it necessarily exists as plaintext in memory for that moment; a wrapper can reduce
the window and prevent accidental disclosure, but a full memory disclosure is out of scope of any
in-process defence, and saying otherwise would be dishonest. What IS prevented is the far more
likely failure: the secret quietly ending up in a log line, an error trace, a telemetry payload or a
committed file.

THREAD SAFETY
-------------
The store is guarded by an RLock. The engine, the API and the scheduler touch it from different
tasks, and a torn read while `clear()` is running would be a security bug rather than a race.
"""
from __future__ import annotations

import base64
import binascii
import hmac
import logging
import threading
import time
from typing import Any, Iterable, Optional

REDACTED = "***REDACTED***"
BYBIT_SECRET = "bybit_api_secret"
#: The OTHER half of the same credential, defined here beside the secret because the two must be
#: resolved by one rule in one place: `BybitREST` signs with the key it sends in the header, and a
#: mismatch is reported by the venue as an invalid signature — indistinguishable at the call site
#: from a rotated secret.
BYBIT_API_KEY = "bybit_api_key"


class SecretRequired(RuntimeError):
    """Raised when a signed operation is attempted with no usable secret.

    Fail-closed by construction: the alternative — falling back to a value from the environment —
    is exactly the persistence this design exists to remove.
    """


class SecretStr:
    """A string that will not render itself.

    The value is readable only through `reveal()`. That single method is the whole audit surface:
    anything that needs the plaintext has to call it explicitly, so `grep -rn 'reveal()'` shows every
    place a secret is exposed.
    """

    __slots__ = ("_value", "_scrubbed", "_variant_cache")

    def __init__(self, value: str) -> None:
        if not isinstance(value, str):
            raise TypeError("SecretStr requires a str")
        self._value = value
        self._scrubbed = False
        self._variant_cache: Optional[tuple[str, ...]] = None

    # ---- explicit, auditable access ----
    def reveal(self) -> str:
        return "" if self._scrubbed else self._value

    def scrub(self) -> None:
        """Overwrite the buffer and mark this handle dead.

        Called on disarm and at shutdown. The old object is replaced rather than merely dropped so
        that a stray reference elsewhere in the process finds an empty string, not the secret.
        """
        self._value = ""
        self._scrubbed = True
        self._variant_cache = None

    @property
    def is_scrubbed(self) -> bool:
        return self._scrubbed

    # ---- everything that could print it ----
    def __repr__(self) -> str:
        return f"SecretStr({REDACTED})"

    def __str__(self) -> str:
        return REDACTED

    def __format__(self, _spec: str) -> str:
        return REDACTED

    def __bool__(self) -> bool:
        return bool(self._value)

    def __len__(self) -> int:
        # Deliberately NOT the real length: length narrows a brute-force search and is the kind of
        # metadata that looks harmless in a log and is not.
        return 0 if self._scrubbed or not self._value else len(REDACTED)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, SecretStr):
            return hmac.compare_digest(self.reveal(), other.reveal())
        if isinstance(other, str):
            return hmac.compare_digest(self.reveal(), other)
        return NotImplemented

    def __ne__(self, other: object) -> bool:
        result = self.__eq__(other)
        return result if result is NotImplemented else not result

    def __hash__(self) -> int:
        return hash(REDACTED)

    def variants(self) -> tuple[str, ...]:
        """Encodings of the secret that could realistically appear in a payload or a log line.

        A secret rarely leaks as itself. It leaks base64-encoded in a config dump, hex-encoded in a
        debug print, or URL-quoted in a query string. Redacting only the raw form would miss those.
        """
        if self._scrubbed or not self._value:
            return ()
        if self._variant_cache is None:
            raw = self._value
            out = {raw}
            try:
                b = raw.encode()
                out.add(base64.b64encode(b).decode())
                out.add(b.hex())
                out.add(base64.urlsafe_b64encode(b).decode())
            except (UnicodeEncodeError, binascii.Error):
                pass
            from urllib.parse import quote
            out.add(quote(raw, safe=""))
            # Shortest first so a nested encoding is replaced before its own substring.
            self._variant_cache = tuple(sorted((v for v in out if v), key=len))
        return self._variant_cache


class RuntimeSecretStore:
    """Process-global, memory-only secret holder. Writes nothing, anywhere.

    Not persisted on purpose, and not persisted even in an encrypted form: an on-disk copy is a copy
    that survives a reboot, a backup, a snapshot and a support bundle, which defeats the entire point
    of entering the secret by hand for each armed session.
    """

    _lock = threading.RLock()
    _singleton: Optional["RuntimeSecretStore"] = None

    def __init__(self) -> None:
        self._secrets: dict[str, SecretStr] = {}
        self._meta: dict[str, dict] = {}

    @classmethod
    def instance(cls) -> "RuntimeSecretStore":
        with cls._lock:
            if cls._singleton is None:
                cls._singleton = RuntimeSecretStore()
            return cls._singleton

    @classmethod
    def reset_for_tests(cls) -> None:
        with cls._lock:
            if cls._singleton is not None:
                cls._singleton.clear()
            cls._singleton = RuntimeSecretStore()

    # ------------------------------------------------------------------ mutation
    def set(self, name: str, value: str, *, source: str = "manual") -> None:
        """Store a secret, scrubbing any previous value for the same name FIRST.

        Scrubbing before overwrite rather than letting the assignment drop the old reference matters:
        it guarantees the previous buffer is cleared even if another object still holds the old
        `SecretStr`, so a rotated key cannot linger in a handle someone else kept.
        """
        if not value:
            raise ValueError("refusing to store an empty secret")
        with self._lock:
            prior = self._secrets.pop(name, None)
            if prior is not None:
                prior.scrub()
            self._secrets[name] = SecretStr(value)
            self._meta[name] = {"source": source, "set_at_ms": int(time.time() * 1000)}

    def clear(self, name: Optional[str] = None) -> None:
        """Scrub one secret, or all of them."""
        with self._lock:
            if name is None:
                for s in self._secrets.values():
                    s.scrub()
                self._secrets.clear()
                self._meta.clear()
                return
            # Membership check rather than `pop(name, None)`: the values are never Optional, so a
            # None default misleads both the type checker and a reader into thinking they might be.
            if name in self._secrets:
                self._secrets.pop(name).scrub()
            self._meta.pop(name, None)  # _meta values are plain dicts; the default is harmless here

    # ------------------------------------------------------------------ read
    def get(self, name: str) -> Optional[SecretStr]:
        with self._lock:
            return self._secrets.get(name)

    def reveal(self, name: str) -> str:
        s = self.get(name)
        return s.reveal() if s is not None else ""

    def has(self, name: str) -> bool:
        s = self.get(name)
        return bool(s is not None and s.reveal())

    def all_variants(self) -> tuple[str, ...]:
        with self._lock:
            out: list[str] = []
            for s in self._secrets.values():
                out.extend(s.variants())
            # Longest first: replacing a longer variant before a shorter one that is its substring
            # avoids leaving a partially-redacted remainder behind.
            return tuple(sorted(set(out), key=len, reverse=True))

    def status(self) -> dict:
        """Safe to log, return over HTTP and put in telemetry: NEVER contains a value or a length."""
        with self._lock:
            return {
                "loaded": sorted(self._secrets.keys()),
                "count": len(self._secrets),
                "detail": {
                    k: {"source": m.get("source"), "set_at_ms": m.get("set_at_ms")}
                    for k, m in self._meta.items()
                },
            }


# ---------------------------------------------------------------------------------------------
# Log redaction
# ---------------------------------------------------------------------------------------------
class SecretRedactingFilter(logging.Filter):
    """Rewrites live secrets out of every log record, as defence in depth.

    `SecretStr` protects the paths that route through it, but most leaks do not: a vendored HTTP
    library logging a request body, a `repr()` of a dict that happens to contain the plaintext, or an
    exception whose message interpolated it. A filter sees every record regardless of origin, so it
    catches what type discipline cannot.
    """

    def __init__(self, store: Optional[RuntimeSecretStore] = None) -> None:
        super().__init__()
        self._store = store or RuntimeSecretStore.instance()

    def filter(self, record: logging.LogRecord) -> bool:
        variants = self._store.all_variants()
        if not variants:
            return True
        try:
            # `msg` and `args` are redacted BEFORE `getMessage()` is ever called, so lazy `%s`
            # formatting cannot resurrect the plaintext downstream.
            if isinstance(record.msg, str):
                record.msg = _redact(record.msg, variants)
            if record.args:
                if isinstance(record.args, dict):
                    record.args = {k: _redact(v, variants) for k, v in record.args.items()}
                else:
                    record.args = tuple(_redact(a, variants) for a in record.args)
            extra = getattr(record, "extra", None)
            if isinstance(extra, dict):
                record.extra = {k: _redact(v, variants) for k, v in extra.items()}
        except Exception:
            # A filter must never break logging — but it must also never let a record through
            # unredacted when it is unsure, so on failure the message is replaced outright.
            record.msg = "[redaction failed; message suppressed]"
            record.args = ()
        return True


def _redact(value: Any, variants: Iterable[str]) -> Any:
    """Replace every variant inside a str; recurse into containers; summarise anything else."""
    if isinstance(value, str):
        out = value
        for v in variants:
            if v and v in out:
                out = out.replace(v, REDACTED)
        return out
    if isinstance(value, dict):
        return {k: _redact(v, variants) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        cls = type(value)
        return cls(_redact(v, variants) for v in value)  # type: ignore[call-arg]
    return value


def install_redaction(store: Optional[RuntimeSecretStore] = None) -> SecretRedactingFilter:
    """Attach the redaction filter to the root logger and every existing handler."""
    store = store or RuntimeSecretStore.instance()
    f = SecretRedactingFilter(store)
    root = logging.getLogger()
    root.addFilter(f)
    for h in root.handlers:
        h.addFilter(f)
    return f


def scrub_text(text: str) -> str:
    """Best-effort redaction of a plain string, for exception messages and HTTP error bodies."""
    variants = RuntimeSecretStore.instance().all_variants()
    return _redact(text, variants) if variants else text


def safe_exception_message(exc: BaseException) -> str:
    """`f"{exc}"` with any live secret removed, and the type preserved.

    Used for anything that returns an error upstream: exception text routinely embeds request bodies
    (many HTTP libraries include the payload in their error), and with a signed Bybit request that
    payload's signature is derived from the secret.
    """
    return scrub_text(f"{type(exc).__name__}: {exc}")
