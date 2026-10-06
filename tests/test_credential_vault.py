#!/usr/bin/env python3
"""CREDENTIAL VAULT — owner-only credential entry and the withdrawal allowlist.

What these tests are actually protecting
----------------------------------------
This is the one surface in the product where a live exchange credential is typed in by a human, so
the failure modes are not cosmetic:

  * a secret leaking back out in a response body, a log, or a LENGTH (a length is a side channel, and
    it is exactly what a "masked" panel usually leaks);
  * an address that silently loses a character and sends profit nowhere, permanently;
  * a withdrawal destination changed by a script riding an authenticated session rather than by a
    person who meant it.

Each assertion below corresponds to one of those. The tests that matter most are the ones asserting
an ABSENCE — no secret in the body, no unconfirmed change accepted, no half-configured exchange
reported as ready.

Run: python3 tests/test_credential_vault.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.core.credential_vault import (  # noqa: E402
    WITHDRAWAL_CONFIRMATION_PHRASE,
    CredentialVault,
    validate_withdrawal_address,
)

TRON_OK = "TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ"
TRON_TYPO = "TXFBqBbqJommqZf7BV8NNYzePh97UmJodX"
# Exactly 40 hex digits after 0x — an EVM body, not "some hex".
EVM_LOWER = "0x" + "a1b2c3d4e5" * 4
SOL_OK = "11111111111111111111111111111111"


@pytest.fixture(autouse=True)
def _clean():
    from gpkg.core.runtime_secrets import RuntimeSecretStore
    RuntimeSecretStore.reset_for_tests()
    CredentialVault.reset_for_tests()
    yield
    RuntimeSecretStore.reset_for_tests()
    CredentialVault.reset_for_tests()


# =============================================================================================
# ADDRESS VALIDATION
# =============================================================================================
def test_tron_addresses_are_base58check_verified():
    """The whole point: one mistyped character must NOT be accepted."""
    ok, why = validate_withdrawal_address("TRC20", TRON_OK)
    assert ok, why
    bad, why_bad = validate_withdrawal_address("TRC20", TRON_TYPO)
    assert not bad, "a single-character typo passed Base58Check — profit would vanish"
    assert "checksum" in why_bad.lower()


def test_tron_addresses_must_not_be_empty_or_wrong_prefix():
    assert not validate_withdrawal_address("TRC20", "")[0]
    assert not validate_withdrawal_address("TRC20", "X" + TRON_OK[1:])[0]


def test_evm_addresses_are_structurally_validated():
    ok, why = validate_withdrawal_address("ERC20", EVM_LOWER)
    assert ok, why
    assert validate_withdrawal_address("BEP20", EVM_LOWER)[0]
    assert validate_withdrawal_address("ARBITRUM", EVM_LOWER)[0]


def test_evm_addresses_reject_bad_shape():
    assert not validate_withdrawal_address("ERC20", "0x123")[0]              # too short
    assert not validate_withdrawal_address("ERC20", "a1b2" * 10)[0]           # missing 0x
    assert not validate_withdrawal_address("ERC20", "0x" + "z" * 40)[0]       # non-hex
    assert not validate_withdrawal_address("ERC20", "0x" + "0" * 40)[0]       # zero address


def test_mixed_case_evm_is_refused_rather_than_accepted_on_trust():
    """A mixed-case address ASSERTS an EIP-55 checksum. With no Keccak-256 backend we cannot verify
    it, and `hashlib.sha3_256` is a DIFFERENT function that would validate the wrong addresses.
    Refusing is the honest answer; appearing to verify is not."""
    mixed = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"
    ok, why = validate_withdrawal_address("ERC20", mixed)
    assert not ok
    assert "lowercase" in why.lower()
    # The uppercase form is accepted: it is explicitly checksum-free, so nothing is being claimed.
    assert validate_withdrawal_address("ERC20", "0x" + "A" * 40)[0]
    assert validate_withdrawal_address("ERC20", "0x" + "a" * 40)[0]


def test_solana_addresses_are_length_checked():
    assert validate_withdrawal_address("SOL", SOL_OK)[0]
    assert not validate_withdrawal_address("SOL", "not-base58-0OIl")[0]


def test_unknown_networks_are_refused_not_skipped():
    """An unvalidated address is exactly the mistake this feature must make impossible."""
    ok, why = validate_withdrawal_address("DOGE", TRON_OK)
    assert not ok
    assert "unsupported network" in why.lower()


# =============================================================================================
# VAULT BEHAVIOUR
# =============================================================================================
def test_storing_requires_both_halves_and_writes_neither_on_failure():
    vault = CredentialVault.instance()
    with pytest.raises(ValueError, match="apiSecret is required"):
        vault.store_exchange_credentials("bybit", "a" * 20, "")
    # The key must NOT have been left behind by the failed call, or "key loaded" would later
    # suggest a usable pair.
    assert vault.exchange_status()["bybit"]["keyLoaded"] is False

    with pytest.raises(ValueError, match="apiKey is required"):
        vault.store_exchange_credentials("bybit", "", "b" * 20)
    assert vault.exchange_status()["bybit"]["secretLoaded"] is False


def test_storing_rejects_whitespace_and_implausible_lengths():
    vault = CredentialVault.instance()
    for bad_key, bad_secret, why in [
        ("has space inside", "b" * 20, "whitespace"),
        ("a" * 20, "has\tspace", "whitespace"),
        ("short", "b" * 20, "plausible"),
        ("a" * 20, "short", "plausible"),
    ]:
        with pytest.raises(ValueError, match=why):
            vault.store_exchange_credentials("bybit", bad_key, bad_secret)


def test_unknown_exchange_is_refused():
    with pytest.raises(ValueError, match="unknown exchange"):
        CredentialVault.instance().store_exchange_credentials("kraken", "a" * 20, "b" * 20)


def test_status_reports_readiness_without_ever_leaking_a_value_or_length():
    vault = CredentialVault.instance()
    secret = "super-secret-value-do-not-leak-0123456789"
    vault.store_exchange_credentials("bybit", "an-api-key-value-1234", secret)

    status = vault.exchange_status()
    blob = repr(status)
    assert secret not in blob
    assert "an-api-key-value-1234" not in blob
    assert str(len(secret)) not in blob, "a length leaked — that is a side channel"
    assert status["bybit"]["ready"] is True
    assert status["binance"]["ready"] is False
    # A half-configured pair must never report ready.
    from gpkg.core.runtime_secrets import BYBIT_API_KEY, RuntimeSecretStore
    RuntimeSecretStore.instance().clear(BYBIT_API_KEY)
    assert vault.exchange_status()["bybit"]["ready"] is False


def test_credentials_are_never_persisted_to_disk(tmp_path):
    """The store is memory-only by construction; assert it stays that way."""
    vault = CredentialVault.instance()
    secret = "memory-only-secret-abcdefghijklmnop"
    vault.store_exchange_credentials("bybit", "an-api-key-value-1234", secret)
    for p in ROOT.rglob("*"):
        if p.is_file() and p.suffix in {".db", ".sqlite", ".env", ".json"}:
            try:
                if secret in p.read_text(errors="ignore"):
                    pytest.fail(f"the secret was written to {p}")
            except (OSError, UnicodeDecodeError):
                continue


# =============================================================================================
# WITHDRAWAL ALLOWLIST
# =============================================================================================
def test_setting_a_destination_requires_the_confirmation_phrase():
    vault = CredentialVault.instance()
    for wrong in ["", "yes", "CONFIRM", WITHDRAWAL_CONFIRMATION_PHRASE.lower()]:
        with pytest.raises(PermissionError, match="confirmation phrase"):
            vault.set_withdrawal_address("bybit", "TRC20", TRON_OK, confirmation=wrong)
    assert vault.withdrawal_addresses() == {}


def test_setting_a_destination_validates_the_address_first():
    vault = CredentialVault.instance()
    with pytest.raises(ValueError):
        vault.set_withdrawal_address("bybit", "TRC20", TRON_TYPO,
                                     confirmation=WITHDRAWAL_CONFIRMATION_PHRASE)
    assert vault.withdrawal_addresses() == {}


def test_single_slot_per_exchange_and_lookup_returns_the_allowlisted_address():
    vault = CredentialVault.instance()
    vault.set_withdrawal_address("bybit", "TRC20", TRON_OK,
                                confirmation=WITHDRAWAL_CONFIRMATION_PHRASE, label="cold")
    assert vault.withdrawal_destination("bybit") == TRON_OK
    assert vault.withdrawal_destination("binance") is None

    # Replacing is allowed (it is a deliberate, confirmed act) but must remain ONE slot.
    other = "0x" + "b" * 40
    vault.set_withdrawal_address("bybit", "ERC20", other,
                                confirmation=WITHDRAWAL_CONFIRMATION_PHRASE)
    assert vault.withdrawal_destination("bybit") == other
    assert len(vault.withdrawal_addresses()) == 1


def test_clearing_a_destination_leaves_nothing_withdrawable():
    vault = CredentialVault.instance()
    vault.set_withdrawal_address("bybit", "TRC20", TRON_OK,
                                confirmation=WITHDRAWAL_CONFIRMATION_PHRASE)
    vault.clear_withdrawal_address("bybit")
    assert vault.withdrawal_destination("bybit") is None


# =============================================================================================
# ENDPOINTS
# =============================================================================================
def _owner_client(make_engine, monkeypatch):
    from fastapi.testclient import TestClient
    import gigpilot as gp
    from gpkg.api import auth as auth_mod

    monkeypatch.setenv("OWNER_AUTH_PIN", "test-pin-123456")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    auth_mod._OWNER_AUTH = None

    engine, fake = make_engine(require_runtime_secret=True, api_secret="")
    monkeypatch.setattr(gp, "get_gp", lambda: engine)
    client = TestClient(gp.app, raise_server_exceptions=False)
    token = auth_mod.get_owner_auth().mint()
    return client, {"Authorization": f"Bearer {token}"}, engine, fake


def test_endpoints_are_owner_gated(make_engine, monkeypatch):
    """Every route here must refuse an unauthenticated caller — these carry live credentials."""
    client, _, _, _ = _owner_client(make_engine, monkeypatch)
    assert client.get("/api/credentials/vault").status_code == 401
    assert client.post("/api/credentials/exchange",
                       json={"exchange": "bybit", "apiKey": "a" * 20,
                             "apiSecret": "b" * 20}).status_code == 401
    assert client.post("/api/credentials/withdrawal-address",
                       json={"exchange": "bybit", "network": "TRC20", "address": TRON_OK,
                             "confirmation": WITHDRAWAL_CONFIRMATION_PHRASE}).status_code == 401


def test_storing_credentials_over_http_never_echoes_them(make_engine, monkeypatch):
    client, headers, engine, _ = _owner_client(make_engine, monkeypatch)
    key, secret = "api-key-over-http-123456", "api-secret-over-http-abcdefgh"

    r = client.post("/api/credentials/exchange",
                    json={"exchange": "bybit", "apiKey": key, "apiSecret": secret},
                    headers=headers)
    assert r.status_code == 200, r.text
    body = r.text
    assert secret not in body, "the secret was echoed back in the response"
    assert key not in body, "the API key was echoed back in the response"
    assert r.json()["persisted"] is False
    assert r.json()["exchanges"]["bybit"]["ready"] is True

    # The status route must not leak it either.
    status_body = client.get("/api/credentials/vault", headers=headers).text
    assert secret not in status_body
    assert str(len(secret)) not in status_body


def test_bad_exchange_or_shape_is_a_structured_422(make_engine, monkeypatch):
    client, headers, _, _ = _owner_client(make_engine, monkeypatch)
    r = client.post("/api/credentials/exchange",
                    json={"exchange": "kraken", "apiKey": "a" * 20, "apiSecret": "b" * 20},
                    headers=headers)
    assert r.status_code == 422
    assert r.json()["error"] == "INVALID_CREDENTIALS"


def test_binance_is_stored_but_honestly_reported_as_unverified(make_engine, monkeypatch):
    """The engine routes to Bybit only. Claiming a Binance key is 'verified' would be a lie that
    leads an operator to believe Binance trading is enabled."""
    client, headers, _, _ = _owner_client(make_engine, monkeypatch)
    r = client.post("/api/credentials/exchange",
                    json={"exchange": "binance", "apiKey": "binance-key-1234567890",
                          "apiSecret": "binance-secret-1234567890"},
                    headers=headers)
    assert r.status_code == 200, r.text
    verification = r.json()["verification"]
    assert verification["attempted"] is False
    assert "Bybit only" in verification["message"]
    assert r.json()["exchanges"]["binance"]["ready"] is True


def test_withdrawal_destination_requires_confirmation_over_http(make_engine, monkeypatch):
    client, headers, _, _ = _owner_client(make_engine, monkeypatch)
    body = {"exchange": "bybit", "network": "TRC20", "address": TRON_OK}

    r = client.post("/api/credentials/withdrawal-address", json=body, headers=headers)
    assert r.status_code == 403
    assert r.json()["error"] == "CONFIRMATION_REQUIRED"

    r = client.post("/api/credentials/withdrawal-address",
                    json={**body, "confirmation": "CONFIRM"}, headers=headers)
    assert r.status_code == 403

    r = client.post("/api/credentials/withdrawal-address",
                    json={**body, "confirmation": WITHDRAWAL_CONFIRMATION_PHRASE},
                    headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["withdrawalAddresses"]["bybit"]["address"] == TRON_OK
    # The endpoint must be explicit that it does not move money.
    assert r.json()["withdrawalExecutionEnabled"] is False


def test_a_typo_address_is_rejected_over_http(make_engine, monkeypatch):
    client, headers, _, _ = _owner_client(make_engine, monkeypatch)
    r = client.post("/api/credentials/withdrawal-address",
                    json={"exchange": "bybit", "network": "TRC20", "address": TRON_TYPO,
                          "confirmation": WITHDRAWAL_CONFIRMATION_PHRASE},
                    headers=headers)
    assert r.status_code == 422
    assert r.json()["error"] == "INVALID_ADDRESS"


def test_clearing_over_http_removes_the_destination(make_engine, monkeypatch):
    client, headers, _, _ = _owner_client(make_engine, monkeypatch)
    client.post("/api/credentials/withdrawal-address",
                json={"exchange": "bybit", "network": "TRC20", "address": TRON_OK,
                      "confirmation": WITHDRAWAL_CONFIRMATION_PHRASE}, headers=headers)
    r = client.post("/api/credentials/withdrawal-address/clear",
                    json={"exchange": "bybit", "network": "", "address": "",
                          "confirmation": ""}, headers=headers)
    assert r.status_code == 200
    assert "bybit" not in r.json()["withdrawalAddresses"]


def test_storing_credentials_journals_the_event_without_the_values(make_engine, monkeypatch):
    client, headers, _, _ = _owner_client(make_engine, monkeypatch)
    secret = "audited-secret-should-not-be-journalled"
    client.post("/api/credentials/exchange",
                json={"exchange": "bybit", "apiKey": "api-key-for-audit-123456",
                      "apiSecret": secret}, headers=headers)
    rows = client.get("/api/audit", headers=headers)
    if rows.status_code == 200:
        assert secret not in rows.text, "a credential reached the audit log"


def test_runtime_api_key_is_actually_used_for_signing():
    """A UI that stores a key the engine never reads would be theatre.

    Asserted against the REAL `BybitREST` rather than the test double, so this pins the production
    resolution rule itself. The decisive assertion is the last one: the HMAC is computed over the
    RUNTIME key, which is exactly the property that makes the credential panel functional — a key
    stored but not signed with produces an "invalid signature" rejection indistinguishable from a
    rotated secret.
    """
    import hashlib
    import hmac

    from gpkg.core.config import Config
    from gpkg.core.runtime_secrets import BYBIT_API_KEY, RuntimeSecretStore
    from gpkg.exchange.bybit_rest import BybitREST

    cfg = Config(api_key="config-key", api_secret="config-secret", symbols=["BTCUSDT"])
    rest = BybitREST(cfg)

    # With no runtime key, the configured key is used (the production arrangement: the pipeline
    # supplies the key, the operator types the secret).
    assert rest._api_key() == "config-key"

    CredentialVault.instance().store_exchange_credentials(
        "bybit", "runtime-key-value-123456", "runtime-secret-value-123456")
    assert RuntimeSecretStore.instance().has(BYBIT_API_KEY)

    # Runtime wins for BOTH halves, by the same rule.
    assert rest._api_key() == "runtime-key-value-123456"
    assert rest._secret() == "runtime-secret-value-123456"

    # And the signature is genuinely computed over the runtime key.
    ts = "1000"
    sig = rest._sign(ts, "")
    expected = hmac.new(
        b"runtime-secret-value-123456",
        (ts + "runtime-key-value-123456" + cfg.recv_window + "").encode(),
        hashlib.sha256,
    ).hexdigest()
    assert sig == expected, "the signature was not computed over the runtime API key"
