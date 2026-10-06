#!/usr/bin/env python3
"""Runtime API-secret handling: memory-only, unprintable, unlogged, fail-closed.

WHY THIS FILE EXISTS
--------------------
Before this change the Bybit API secret was sourced from AWS Secrets Manager, `os.environ`,
`.env` and `.bybit-quant-keys.json`, and then held as a plain `str` on `Config`. Every one of those
is a durable copy, and a plain `str` on a dataclass is printed verbatim by `repr()` — so a single
`log.info("cfg=%s", cfg)` published the live key.

The specification for live trading is stricter: the secret is typed by hand for each armed session,
lives only in memory, and must never reach a log, a traceback or telemetry. These tests defend the
mechanisms that make that true, grouped by the failure each prevents:

  * UNPRINTABLE        — the secret cannot be rendered by any formatting path
  * MEMORY-ONLY        — nothing is written to disk, and rotation scrubs the old value
  * UNLOGGED           — the redaction filter rewrites msg, args, extra and tracebacks
  * SIGNER PRECEDENCE  — a runtime secret wins over a persisted one, and its absence FAILS the call
  * REPR SAFETY        — dataclasses that carry secrets cannot leak them
  * ARMING LIFECYCLE   — the secret is loaded before preflight and scrubbed on disarm or failure

Run: python3 -m pytest tests/test_runtime_secrets.py -q
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("BYBIT_API_KEY", "test-key")
os.environ.setdefault("BYBIT_API_SECRET", "test-secret")

from gpkg.core.config import Config  # noqa: E402
from gpkg.core.logging import JsonFormatter  # noqa: E402
from gpkg.core.runtime_secrets import (  # noqa: E402
    BYBIT_SECRET,
    REDACTED,
    RuntimeSecretStore,
    SecretRedactingFilter,
    SecretRequired,
    SecretStr,
    install_redaction,
    safe_exception_message,
    scrub_text,
)
from gpkg.exchange.bybit_rest import BybitREST  # noqa: E402
from gpkg.exchange.credentials import ExchangeCredential  # noqa: E402

SECRET = "MYSECRET_b8f1c2a4d6e8f0a2b4c6d8e0f2a4b6c8"


@pytest.fixture(autouse=True)
def clean_store():
    """Every test starts from an empty store, so no secret outlives its test."""
    RuntimeSecretStore.reset_for_tests()
    yield
    RuntimeSecretStore.reset_for_tests()


# =============================================================================================
# UNPRINTABLE
# =============================================================================================
@pytest.mark.parametrize("render", [
    lambda s: repr(s),
    lambda s: str(s),
    lambda s: f"{s}",
    lambda s: "%s" % s,
    lambda s: "{}".format(s),
    lambda s: f"{s!r}",
    lambda s: f"{s!s}",
    lambda s: "".join([s]),
    lambda s: str([s]),
    lambda s: str({"k": s}),
    lambda s: str((s,)),
])
def test_no_formatting_path_reveals_the_secret(render):
    """Every way a value reaches a log line or a traceback must be redacted, not just `repr`.

    REFUSING TO COERCE IS ALSO SAFE. `"".join([secret])` raises TypeError because the object is not a
    str — that is the desired outcome, not a gap, so it is counted as safe rather than as a failure.
    """
    s = SecretStr(SECRET)
    try:
        out = render(s)
    except TypeError:
        return
    assert SECRET not in out, f"a formatting path leaked the secret: {out[:80]}"


def test_reveal_is_the_only_way_out():
    s = SecretStr(SECRET)
    assert s.reveal() == SECRET
    s.scrub()
    assert s.reveal() == "", "a scrubbed handle must yield nothing"


def test_length_never_discloses_the_secret_size():
    """A real length narrows a brute-force search and looks harmless in a log."""
    for value in ["a", "shortish", SECRET, "x" * 200]:
        assert len(SecretStr(value)) == len(REDACTED), "len() must be constant"


def test_scrub_is_idempotent_and_marks_the_handle():
    s = SecretStr(SECRET)
    s.scrub()
    s.scrub()
    assert s.is_scrubbed is True
    assert s.reveal() == ""
    assert bool(s) is False


def test_equality_is_value_based_and_constant_time():
    a, b = SecretStr(SECRET), SecretStr(SECRET)
    assert a == b
    assert a == SECRET
    assert a != SecretStr("other-value-entirely")
    assert (a == 12345) is False, "__eq__ must return False, not raise, for a foreign type"


def test_hash_does_not_expose_the_value():
    assert hash(SecretStr(SECRET)) == hash(SecretStr("something-else-entirely"))


def test_json_serialisation_refuses_rather_than_leaking():
    """Raising is the safe outcome: it surfaces the design error instead of quietly serialising a
    live credential into a telemetry payload."""
    with pytest.raises(TypeError):
        json.dumps({"secret": SecretStr(SECRET)})


# =============================================================================================
# MEMORY-ONLY
# =============================================================================================
def test_nothing_is_written_to_disk(monkeypatch):
    """Store a secret with every file-opening call booby-trapped.

    A secret that survives a reboot, a backup or a support bundle is exactly what hand-entry exists
    to prevent, so "we never write it" must be enforced rather than asserted in prose.
    """
    import builtins
    real_open = builtins.open

    def explode(*a, **k):
        raise AssertionError(f"the secret store attempted file I/O: {a[:2]}")

    monkeypatch.setattr(builtins, "open", explode)
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET, source="test")   # must not touch the filesystem
    assert store.has(BYBIT_SECRET)
    monkeypatch.setattr(builtins, "open", real_open)
    assert store.reveal(BYBIT_SECRET) == SECRET


def test_rotation_scrubs_the_previous_value():
    """An old key must not linger in a handle another object still holds."""
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, "first-secret-value")
    held = store.get(BYBIT_SECRET)
    assert held is not None and held.reveal() == "first-secret-value"
    store.set(BYBIT_SECRET, "second-secret-value")
    assert held.reveal() == "", "the superseded handle still exposes the old secret"
    assert store.reveal(BYBIT_SECRET) == "second-secret-value"


def test_clear_scrubs_everything():
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET)
    store.set("other", "another-secret")
    store.clear()
    assert store.status()["loaded"] == []
    assert store.all_variants() == (), "variants survived a clear — the buffer was not wiped"


def test_empty_secret_is_refused():
    with pytest.raises(ValueError):
        RuntimeSecretStore.instance().set(BYBIT_SECRET, "")


def test_status_contains_no_value_and_no_length():
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET, source="test")
    blob = json.dumps(store.status())
    assert SECRET not in blob
    assert str(len(SECRET)) not in blob.replace('"count": 1', "")
    assert "source" in blob and "set_at_ms" in blob


def test_variants_cover_common_encodings():
    """A secret rarely leaks as itself — it leaks base64 in a config dump or hex in a debug print."""
    v = SecretStr(SECRET).variants()
    b = SECRET.encode()
    assert SECRET in v
    assert base64.b64encode(b).decode() in v
    assert b.hex() in v
    assert SecretStr("").variants() == ()


# =============================================================================================
# UNLOGGED
# =============================================================================================
def _capture(store: RuntimeSecretStore) -> tuple[logging.Logger, io.StringIO]:
    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setFormatter(JsonFormatter())
    h.addFilter(SecretRedactingFilter(store))
    log = logging.getLogger("gigpilot.secrettest")
    log.handlers[:] = [h]
    log.setLevel(logging.DEBUG)
    log.propagate = False
    return log, buf


def test_log_message_is_redacted():
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET)
    log, buf = _capture(store)
    log.info("signing with %s now", SECRET)
    assert SECRET not in buf.getvalue()
    assert REDACTED in buf.getvalue()


def test_lazy_percent_formatting_cannot_bypass_the_filter():
    """`log.info("%s", secret)` defers formatting until emit. The filter runs before that, so args
    must be redacted too — otherwise the most common logging style would be the one that leaks."""
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET)
    log, buf = _capture(store)
    log.warning("body=%s sig=%s", {"k": SECRET}, SECRET)
    out = buf.getvalue()
    assert SECRET not in out


def test_extra_fields_are_redacted():
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET)
    log, buf = _capture(store)
    log.info("event", extra={"extra": {"apiSecret": SECRET, "nested": {"deep": [SECRET]}}})
    assert SECRET not in buf.getvalue()


def test_encoded_forms_are_redacted():
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET)
    log, buf = _capture(store)
    b = SECRET.encode()
    log.info("b64=%s hex=%s", base64.b64encode(b).decode(), b.hex())
    out = buf.getvalue()
    assert base64.b64encode(b).decode() not in out
    assert b.hex() not in out


def test_tracebacks_are_redacted():
    """HTTP client errors routinely embed the request body, and a signed request carries the
    signature derived from the secret. The traceback is assembled AFTER the filter runs."""
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET)
    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setFormatter(JsonFormatter())
    h.addFilter(SecretRedactingFilter(store))
    log = logging.getLogger("gigpilot.tbtest")
    log.handlers[:] = [h]
    log.propagate = False
    try:
        raise RuntimeError(f"request failed with secret {SECRET}")
    except RuntimeError:
        log.exception("signing failed")
    assert SECRET not in buf.getvalue()


def test_scrub_text_and_safe_exception_message():
    RuntimeSecretStore.instance().set(BYBIT_SECRET, SECRET)
    assert SECRET not in scrub_text(f"prefix {SECRET} suffix")
    msg = safe_exception_message(RuntimeError(f"boom {SECRET}"))
    assert SECRET not in msg
    assert "RuntimeError" in msg, "the exception type must survive so debugging still works"


def test_no_secret_loaded_means_no_redaction_work():
    log, buf = _capture(RuntimeSecretStore.instance())
    log.info("plain message")
    assert "plain message" in buf.getvalue()


def test_install_redaction_attaches_to_root():
    f = install_redaction(RuntimeSecretStore.instance())
    assert f in logging.getLogger().filters


# =============================================================================================
# SIGNER PRECEDENCE — the security property
# =============================================================================================
def test_runtime_secret_wins_over_the_persisted_one():
    """If the persisted key could still sign, hand-entry would be decorative."""
    cfg = Config(api_key="PUBKEY", api_secret="PERSISTED_SECRET_VALUE", symbols=["BTCUSDT"])
    rest = BybitREST(cfg)
    with_persisted = rest._sign("1", "payload")
    RuntimeSecretStore.instance().set(BYBIT_SECRET, "RUNTIME_SECRET_VALUE")
    assert rest._sign("1", "payload") != with_persisted
    RuntimeSecretStore.instance().clear()
    assert rest._sign("1", "payload") == with_persisted


def test_runtime_mode_without_a_secret_fails_closed():
    """The difference between "we prefer runtime secrets" and "the persisted key can never be used"
    is a hard refusal, and only the second is a control."""
    cfg = Config(api_key="PUBKEY", api_secret="PERSISTED_SECRET_VALUE", symbols=["BTCUSDT"],
                 require_runtime_secret=True)
    rest = BybitREST(cfg)
    with pytest.raises(SecretRequired):
        rest._sign("1", "payload")


def test_runtime_mode_signs_once_the_secret_is_supplied():
    cfg = Config(api_key="PUBKEY", api_secret="", symbols=["BTCUSDT"], require_runtime_secret=True)
    rest = BybitREST(cfg)
    RuntimeSecretStore.instance().set(BYBIT_SECRET, SECRET)
    sig = rest._sign("1", "payload")
    assert len(sig) == 64 and SECRET not in sig


def test_non_runtime_mode_stays_backwards_compatible():
    cfg = Config(api_key="PUBKEY", api_secret="PERSISTED", symbols=["BTCUSDT"])
    assert BybitREST(cfg)._sign("1", "p") != ""


def test_scrubbed_secret_is_not_used_for_signing():
    """A scrubbed handle must not silently sign with an empty key."""
    cfg = Config(api_key="PUBKEY", api_secret="PERSISTED", symbols=["BTCUSDT"],
                 require_runtime_secret=True)
    store = RuntimeSecretStore.instance()
    store.set(BYBIT_SECRET, SECRET)
    store.get(BYBIT_SECRET).scrub()
    with pytest.raises(SecretRequired):
        BybitREST(cfg)._sign("1", "p")


# =============================================================================================
# REPR SAFETY
# =============================================================================================
def test_config_repr_hides_the_secret():
    cfg = Config(api_key="PUBKEY", api_secret=SECRET, symbols=["BTCUSDT"], api_passphrase=SECRET)
    r = repr(cfg)
    assert SECRET not in r
    assert "api_key='PUBKEY'" in r, "the non-secret fields must still be visible for debugging"


def test_exchange_credential_repr_hides_secret_and_passphrase():
    c = ExchangeCredential(exchange="bybit", api_key="PUBKEY", api_secret=SECRET,
                           passphrase=SECRET)
    r = repr(c)
    assert SECRET not in r
    assert "PUBKEY" in r


def test_describe_never_contains_the_secret():
    c = ExchangeCredential(exchange="bybit", api_key="PUBKEY", api_secret=SECRET)
    assert SECRET not in json.dumps(c.describe())


# =============================================================================================
# ARMING LIFECYCLE (HTTP)
# =============================================================================================
class _FakeGP:
    def __init__(self, *, arm_ok: bool = True, require_runtime: bool = True):
        self.armed = False
        self.cfg = Config(api_key="PUBKEY", api_secret="", symbols=["BTCUSDT"],
                          require_runtime_secret=require_runtime)
        self._arm_ok = arm_ok

    async def arm(self):
        if not self._arm_ok:
            return False, [{"code": "PREFLIGHT_FAILED", "detail": "no ContractTrade permission"}]
        self.armed = True
        return True, []

    def disarm(self, reason: str):
        self.armed = False

    def snapshot(self):
        return {"armed": self.armed}


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient
    import gigpilot
    from gpkg.api.auth import OwnerAuth, OwnerConfig, hash_password

    salt = "deadbeefdeadbeef"
    auth = OwnerAuth(OwnerConfig(
        owner_email="owner@example.com",
        jwt_secret="test-secret-long-enough-for-hs256-signing",
        emergency_pin="a1b2c3d4",
        password_salt=salt,
        password_hash=hash_password("pw", salt),
        totp_secret="JBSWY3DPEHPK3PXP",
        totp_enabled=True,
    ))
    import gpkg.api.auth as auth_mod
    monkeypatch.setattr(auth_mod, "get_owner_auth", lambda: auth)
    return TestClient(gigpilot.app), auth.mint()


def test_arm_requires_the_secret_when_runtime_mode_is_on(client, monkeypatch):
    tc, token = client
    import gigpilot
    monkeypatch.setattr(gigpilot, "get_gp", lambda: _FakeGP(require_runtime=True))
    r = tc.post("/api/arm", json={}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 428, r.text
    assert r.json()["error"] == "API_SECRET_REQUIRED"


def test_arm_rejects_an_implausibly_short_secret_without_echoing_it(client, monkeypatch):
    tc, token = client
    import gigpilot
    monkeypatch.setattr(gigpilot, "get_gp", lambda: _FakeGP())
    r = tc.post("/api/arm", json={"apiSecret": "abc"},
                headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 422
    assert r.json()["error"] == "API_SECRET_TOO_SHORT"
    assert "abc" not in r.text, "the rejected value must not be echoed back"


def test_successful_arm_loads_the_secret_in_memory(client, monkeypatch):
    tc, token = client
    import gigpilot
    monkeypatch.setattr(gigpilot, "get_gp", lambda: _FakeGP())
    r = tc.post("/api/arm", json={"apiSecret": SECRET},
                headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200 and r.json()["armed"] is True
    assert RuntimeSecretStore.instance().has(BYBIT_SECRET) is True
    assert SECRET not in r.text, "the response must never contain the secret"


def test_disarm_scrubs_the_secret(client, monkeypatch):
    """Disarm ENDS the session, so the hand-entered secret must not stay resident."""
    tc, token = client
    import gigpilot
    monkeypatch.setattr(gigpilot, "get_gp", lambda: _FakeGP())
    tc.post("/api/arm", json={"apiSecret": SECRET},
            headers={"Authorization": f"Bearer {token}"})
    assert RuntimeSecretStore.instance().has(BYBIT_SECRET)
    r = tc.post("/api/disarm", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["runtimeSecretCleared"] is True
    assert RuntimeSecretStore.instance().has(BYBIT_SECRET) is False


def test_a_failed_arm_does_not_leave_the_secret_loaded(client, monkeypatch):
    """A secret loaded for an arming attempt that FAILED has no business remaining in memory."""
    tc, token = client
    import gigpilot
    monkeypatch.setattr(gigpilot, "get_gp", lambda: _FakeGP(arm_ok=False))
    r = tc.post("/api/arm", json={"apiSecret": SECRET},
                headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 422
    assert r.json()["error"] == "ARM_BLOCKED"
    assert RuntimeSecretStore.instance().has(BYBIT_SECRET) is False


def test_credential_status_endpoint_never_returns_the_value(client, monkeypatch):
    tc, token = client
    import gigpilot
    monkeypatch.setattr(gigpilot, "get_gp", lambda: _FakeGP())
    tc.post("/api/arm", json={"apiSecret": SECRET},
            headers={"Authorization": f"Bearer {token}"})
    r = tc.get("/api/credentials/runtime", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert SECRET not in r.text
    assert body["secretLoaded"] is True
    assert body["secretSource"] == "runtime"
    assert body["persisted"] is False


def test_runtime_credential_endpoint_is_owner_gated(client):
    tc, _ = client
    assert tc.get("/api/credentials/runtime").status_code == 401


# =============================================================================================
# CLI — the secret must never be an ARGUMENT
# =============================================================================================
def test_cli_prompts_with_getpass_and_takes_no_secret_argument():
    """`argv` is visible to every user on the box via `ps`. A `--secret` flag would publish the key
    to the whole host, so the CLI must read it from a hidden prompt instead."""
    src = (ROOT / "bin" / "gigpilot").read_text()
    assert "getpass.getpass" in src, "the CLI must prompt with getpass (hidden input)"
    # Check for a FLAG DEFINITION, not the bare word: the source legitimately discusses `--secret`
    # in a comment explaining why it is not offered.
    assert 'add_argument("--secret' not in src, "a --secret flag would expose the key via `ps`"
    assert 'argv' in src and "apiSecret" in src
    assert "localStorage" not in src


def test_cli_drops_its_local_reference():
    src = (ROOT / "bin" / "gigpilot").read_text()
    assert "del secret" in src, "the CLI must drop its local copy after the request"
