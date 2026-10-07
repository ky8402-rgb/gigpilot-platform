#!/usr/bin/env python3
"""PERSISTED-CREDENTIAL PURGE, AND THE TWO SCRUB TRIGGERS THAT WERE MISSING.

What was actually wrong (production was in exactly this state)
----------------------------------------------------------------
`runtime_secrets.py` had built the whole in-memory design — `SecretStr`, `RuntimeSecretStore`,
redaction — and it worked. But it was only ever reached when `GIGPILOT_REQUIRE_RUNTIME_SECRET=1`
was set in the CI environment. Unset is the default, so the DEFAULT path still hydrated the secret
from AWS Secrets Manager, `.env` and `.bybit-quant-keys.json` and held it on `Config`. Live
production reported `engine_state=PAPER` with persisted credentials: the control existed and was
switched off. A control that is off unless someone remembers to enable it is a preference.

Three further defects surfaced while wiring it:

  1. the private WebSocket signed with `self.cfg.api_secret` directly, while REST failed closed
     through the runtime store. Enabling the control would have authenticated REST and broken the
     WS — silently losing position/order/execution/wallet events behind a log line that reads like a
     transient socket problem. One credential, two rules;
  2. `RuntimeSecretStore` documented scrub "on disarm and at shutdown", but ONLY disarm existed.
     The one case that never scrubbed was the graceful restart;
  3. no trigger existed for a FATAL WebSocket auth rejection.

These tests are written against BEHAVIOUR where behaviour is reachable, and against source only where
the property is genuinely "this code path must not exist" — the purge is a claim about absence, and
absence cannot be observed by calling anything.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pytest  # noqa: E402

from gpkg.core import config as config_mod  # noqa: E402
from gpkg.core.config import Config  # noqa: E402


# ------------------------------------------------------------------------------------------------
# 1. The secret can no longer be read from disk — proven by putting one there
# ------------------------------------------------------------------------------------------------
def test_a_secret_sitting_on_disk_is_never_read(tmp_path, monkeypatch):
    """The strongest form of the claim: write a real secret to both disk locations and show that
    neither can reach the engine. The key still loads, because it identifies rather than authorises.
    """
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("BYBIT_API_KEY=disk-key\nBYBIT_API_SECRET=disk-secret\n")
    (tmp_path / ".bybit-quant-keys.json").write_text(
        '{"apiKey": "json-key", "apiSecret": "json-secret"}')
    monkeypatch.delenv("BYBIT_API_KEY", raising=False)
    monkeypatch.delenv("BYBIT_API_SECRET", raising=False)

    key, secret = config_mod._maybe_load_local_keys()

    # Either location may supply the identifier — the JSON keyfile is consulted before `.env`, so
    # asserting one specific winner would be pinning precedence rather than the security property.
    assert key in {"json-key", "disk-key"}, "the KEY is an identifier and may come from disk"
    assert key, "the key must still load: it identifies, it does not authorise"
    assert secret == "", "the SECRET must never be readable from disk, whatever is written there"

    # And with the keyfile gone, `.env` still supplies the key — never the secret.
    (tmp_path / ".bybit-quant-keys.json").unlink()
    key2, secret2 = config_mod._maybe_load_local_keys()
    assert key2 == "disk-key"
    assert secret2 == ""


def test_secrets_manager_never_copies_the_secret_into_the_environment():
    """`os.environ` is readable through /proc/self/environ, so hydrating the secret there is a durable
    copy. The SM path previously wrote BOTH halves with a loop over both key names.
    """
    src = (ROOT / "gpkg/core/config.py").read_text(encoding="utf-8")
    assert 'os.environ["BYBIT_API_SECRET"]' not in src
    assert 'os.environ[k] = str(payload[k])' not in src


# ------------------------------------------------------------------------------------------------
# 2. The purge is unconditional, not flag-gated
# ------------------------------------------------------------------------------------------------
def test_from_env_requires_a_runtime_secret_even_when_the_old_flag_is_off(monkeypatch):
    """The flag is the whole defect: strictness must not depend on a CI variable being set."""
    monkeypatch.setenv("BYBIT_API_KEY", "identifier-only")
    monkeypatch.delenv("BYBIT_API_SECRET", raising=False)
    monkeypatch.setenv("GIGPILOT_REQUIRE_RUNTIME_SECRET", "0")  # explicitly NOT strict

    cfg = Config.from_env()

    assert cfg.require_runtime_secret is True, "strictness must not be optional"
    assert cfg.api_secret == "", "no secret may be carried on Config"


def test_booting_with_no_secret_is_survivable(monkeypatch):
    """Removing hydration must not make the daemon exit: systemd would crash-loop it. The designed
    state is `AWAITING_SECRET`, which the deploy health check treats as healthy.
    """
    monkeypatch.setenv("BYBIT_API_KEY", "identifier-only")
    monkeypatch.delenv("BYBIT_API_SECRET", raising=False)

    cfg = Config.from_env()  # must NOT raise SystemExit

    assert cfg.api_secret == ""
    assert cfg.require_runtime_secret is True


def test_booting_without_even_a_key_still_refuses(monkeypatch, tmp_path):
    """The key remains required — signing needs both halves, and an empty key cannot be sent."""
    monkeypatch.chdir(tmp_path)
    for var in ("BYBIT_API_KEY", "BYBIT_API_SECRET", "BYBIT_SECRET_ARN"):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(SystemExit):
        Config.from_env()


# ------------------------------------------------------------------------------------------------
# 3. ONE resolution rule for both halves and both callers
# ------------------------------------------------------------------------------------------------
def test_the_websocket_no_longer_bypasses_the_runtime_secret():
    """The defect: `cfg.api_secret` was signed with directly, so runtime-secret mode authenticated
    REST and then failed the private socket.
    """
    src = (ROOT / "gpkg/exchange/bybit_ws.py").read_text(encoding="utf-8")
    assert "cfg.api_secret.encode()" not in src, (
        "the private WS must not sign with the config secret; that bypasses the runtime store"
    )
    assert "resolve_api_credentials" in src


def test_rest_and_websocket_resolve_by_the_same_rule():
    """Two independent resolutions is how they drifted apart in the first place."""
    for rel in ("gpkg/exchange/bybit_rest.py", "gpkg/exchange/bybit_ws.py"):
        src = (ROOT / rel).read_text(encoding="utf-8")
        assert "resolve_api_credentials" in src, f"{rel} must use the shared resolver"


def test_the_shared_resolver_prefers_the_runtime_secret_and_fails_closed(monkeypatch):
    from gpkg.core.runtime_secrets import (
        BYBIT_API_KEY,
        BYBIT_SECRET,
        RuntimeSecretStore,
        SecretRequired,
        resolve_api_credentials,
    )

    RuntimeSecretStore.reset_for_tests()
    try:
        cfg = Config(api_key="config-key", api_secret="config-secret", symbols=["BTCUSDT"])
        cfg.require_runtime_secret = True

        with pytest.raises(SecretRequired):
            resolve_api_credentials(cfg)  # nothing in the store: refuse, never fall back

        RuntimeSecretStore.instance().set(BYBIT_API_KEY, "runtime-key")
        RuntimeSecretStore.instance().set(BYBIT_SECRET, "runtime-secret")
        assert resolve_api_credentials(cfg) == ("runtime-key", "runtime-secret")
    finally:
        RuntimeSecretStore.reset_for_tests()


# ------------------------------------------------------------------------------------------------
# 4. The two scrub triggers that did not exist
# ------------------------------------------------------------------------------------------------
def test_graceful_shutdown_scrubs_the_runtime_store():
    """Documented as "on disarm and at shutdown"; only disarm was ever implemented, so the graceful
    restart was precisely the case that did not scrub.
    """
    src = (ROOT / "gigpilot.py").read_text(encoding="utf-8")
    # Bounded by the END OF THE FUNCTION, not a character count. A fixed window silently stops
    # covering the body once anything above it grows — which is how this assertion first broke.
    start = src.index("async def lifespan")
    block = src[start:src.index("\napp = FastAPI(", start)]
    assert "RuntimeSecretStore" in block, "the shutdown path must clear the runtime store"
    assert ".clear()" in block
    assert "await gp.stop()" in block, "and it must run after the engine has stopped"


def test_a_fatal_ws_auth_rejection_scrubs_and_does_not_log_the_reply():
    """An auth rejection is deterministic: the credential in memory will not sign anything else, so
    retrying forever at 30s backoff would look like a healthy retry while the engine was blind to
    every fill. The reply is not logged verbatim because an auth failure can echo request material.
    """
    src = (ROOT / "gpkg/exchange/bybit_ws.py").read_text(encoding="utf-8")
    assert "RuntimeSecretStore.instance().clear()" in src
    assert 'f"private WS auth failed: {resp}"' not in src, (
        "the raw venue reply must not be interpolated into a log line"
    )


# ------------------------------------------------------------------------------------------------
# 5. The deploy cannot write a secret to disk either
# ------------------------------------------------------------------------------------------------
def test_the_deploy_never_writes_a_secret_to_disk():
    """Matches the WRITE, not a mention: `remove_env_key` legitimately names the variable."""
    src = (ROOT / "scripts/deploy-ec2.sh").read_text(encoding="utf-8")
    assert 'set_env_value "BYBIT_API_SECRET"' not in src
    assert 'remove_env_key "BYBIT_API_SECRET"' in src, (
        "the deploy must actively REMOVE a secret left by an earlier release"
    )
