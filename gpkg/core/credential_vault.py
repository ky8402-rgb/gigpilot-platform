"""CREDENTIAL VAULT — owner-facing entry of exchange keys, and the withdrawal allowlist.

WHY THIS MODULE EXISTS
----------------------
The engine could already accept a hand-typed Bybit API SECRET for the armed session, but there was
no way to enter an API KEY, no second exchange, and nowhere to record where profit is allowed to go.
This module adds exactly those three things and nothing else.

It is a thin layer over `RuntimeSecretStore` on purpose. That store is the component that already
gets the hard part right — memory-only, scrub-on-overwrite, log redaction — and duplicating any of
that logic here would create a second implementation to keep correct.

SECURITY INVARIANTS — each is ENFORCED below, not merely intended
-----------------------------------------------------------------
1. NOTHING IS PERSISTED. Credentials go into `RuntimeSecretStore`, which writes to no file, no
   environment, no database and no cache. A restart loses them, and that is the design: an on-disk
   copy survives a reboot, a backup, a snapshot and a support bundle, which defeats the point of
   entering them by hand. The vault holds no separate copy of its own.

2. NOTHING IS ECHOED. `exchange_status()` reports booleans and timestamps. It has no code path that
   returns a value, a prefix, a suffix, or a LENGTH — a length is a side channel, and it is the
   detail a "masked" credential panel usually leaks.

3. THE WITHDRAWAL ADDRESS IS AN ALLOWLIST, NOT A TRANSPORT. This module can record and display the
   address profit is permitted to move to. It deliberately contains NO code that signs, submits or
   triggers a transfer, and no caller can use it to reach one. Changing the allowlist is also the
   single highest-risk action in the whole product, so it demands an explicit confirmation phrase —
   absent that, a stolen owner session could silently redirect future profit.

4. A WITHDRAWAL-CAPABLE TRADING KEY IS STILL REFUSED. `GigPilot.verify_credentials()` refuses to
   arm with a key that carries withdrawal permission, and this module does not weaken, bypass or
   re-order that check. The allowlist above exists so that trading credentials never NEED withdrawal
   rights in the first place; the two controls are complements, not alternatives.

VALIDATION IS REAL, AND ITS LIMITS ARE STATED
---------------------------------------------
An address that silently loses a character is unrecoverable, so the checks here are strict — and
where a check cannot be performed, the input is REFUSED rather than waved through:

  * Tron (TRC20): full Base58Check. The trailing 4 bytes are double-SHA256 of the payload, so a
    single mistyped character fails the checksum. This is a complete validation.
  * EVM (ERC20/BEP20/Arbitrum/Optimism/Polygon/Base): `0x` + 40 hex digits. A MIXED-CASE address
    asserts an EIP-55 checksum, which requires Keccak-256 — and `hashlib` provides SHA3-256, which
    is a DIFFERENT function that would validate the wrong addresses. No Keccak backend is available
    here, and this repo's dependency rule forbids adding one for this, so a mixed-case address is
    REJECTED with an explanation and the owner is asked for the all-lowercase form. Refusing to
    verify is honest; pretending to verify is not.
  * Solana: Base58 decode to exactly 32 bytes.
"""
from __future__ import annotations

import hashlib
import re
import threading
import time
from dataclasses import dataclass
from typing import Optional

from gpkg.core.runtime_secrets import BYBIT_SECRET, RuntimeSecretStore

# ---------------------------------------------------------------------------------------------
# Exchange registry
# ---------------------------------------------------------------------------------------------
BYBIT_API_KEY_SLOT = "bybit_api_key"
BINANCE_API_KEY_SLOT = "binance_api_key"
BINANCE_SECRET_SLOT = "binance_api_secret"


@dataclass(frozen=True)
class ExchangeSpec:
    exchange: str
    label: str
    api_key_slot: str
    api_secret_slot: str
    #: Where a human goes to create the key. Displayed so the operator is not guessing.
    key_console_url: str
    #: permissions the key must have, and the one it must NOT.
    required_permissions: str
    forbidden_permissions: str


EXCHANGES: dict[str, ExchangeSpec] = {
    "bybit": ExchangeSpec(
        exchange="bybit",
        label="Bybit",
        api_key_slot=BYBIT_API_KEY_SLOT,
        api_secret_slot=BYBIT_SECRET,
        key_console_url="https://www.bybit.com/app/user/api-management",
        required_permissions="ContractTrade (Unified Trading), Wallet read",
        forbidden_permissions="Withdraw",
    ),
    "binance": ExchangeSpec(
        exchange="binance",
        label="Binance",
        api_key_slot=BINANCE_API_KEY_SLOT,
        api_secret_slot=BINANCE_SECRET_SLOT,
        key_console_url="https://www.binance.com/en/my/settings/api-management",
        required_permissions="Enable Futures, Read",
        forbidden_permissions="Enable Withdrawals",
    ),
}


# ---------------------------------------------------------------------------------------------
# Withdrawal networks and address validation
# ---------------------------------------------------------------------------------------------
#: Network -> family. The family selects the validator; a network not listed here cannot be used,
#: because an unvalidated address is exactly the mistake this feature must not make possible.
NETWORK_FAMILIES: dict[str, str] = {
    "ERC20": "evm",
    "BEP20": "evm",
    "ARBITRUM": "evm",
    "OPTIMISM": "evm",
    "POLYGON": "evm",
    "BASE": "evm",
    "TRC20": "tron",
    "SOL": "solana",
}

_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_HEX40_RE = re.compile(r"^[0-9a-f]{40}$")


def _base58_decode(value: str) -> bytes:
    """Strict Base58 decode: returns b'' on any character outside the alphabet."""
    num = 0
    for ch in value:
        idx = _BASE58_ALPHABET.find(ch)
        if idx < 0:
            return b""
        num = num * 58 + idx
    body = num.to_bytes((num.bit_length() + 7) // 8, "big") if num else b""
    # Leading '1's encode leading zero bytes; `.to_bytes` above drops them.
    padding = len(value) - len(value.lstrip("1"))
    return b"\x00" * padding + body


def validate_tron_address(address: str) -> tuple[bool, str]:
    """Full Base58Check validation — a single mistyped character fails the checksum."""
    if not address.startswith("T"):
        return False, "a TRC20 (Tron) address must start with 'T'"
    raw = _base58_decode(address)
    if len(raw) != 25:
        return False, "not a valid Base58Check payload length for Tron"
    payload, checksum = raw[:21], raw[21:]
    expected = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    if checksum != expected:
        return False, ("Base58Check checksum failed — the address has a typo. Copy it again from the "
                       "exchange; do not retype it by hand.")
    return True, "valid TRC20 address (Base58Check verified)"


def validate_solana_address(address: str) -> tuple[bool, str]:
    raw = _base58_decode(address)
    if len(raw) != 32:
        return False, "not a valid Solana address (expected 32 bytes of Base58)"
    return True, "valid Solana address"


def validate_evm_address(address: str) -> tuple[bool, str]:
    """Structural EVM validation, with EIP-55 handled honestly rather than faked.

    See the module docstring: a mixed-case EVM address carries an EIP-55 checksum we cannot verify
    without Keccak-256, so it is refused rather than accepted on trust. The all-lowercase form is
    accepted because it is explicitly checksum-free — nothing is being claimed that we are failing
    to check.
    """
    if not address.startswith("0x") and not address.startswith("0X"):
        return False, "an EVM address must start with '0x'"
    body = address[2:]
    if len(body) != 40:
        return False, f"an EVM address must have 40 hex digits after '0x' (found {len(body)})"
    if not _HEX40_RE.match(body.lower()):
        return False, "an EVM address may contain only hex digits 0-9 and a-f"
    if body != body.lower() and body != body.upper():
        return False, (
            "this is a mixed-case (EIP-55 checksummed) address and no Keccak-256 backend is present "
            "to verify the checksum. Paste the all-lowercase form instead: refusing to verify is "
            "safer than appearing to."
        )
    if body == "0" * 40:
        return False, "the zero address is not a valid destination"
    return True, "valid EVM address (structural; not checksum-verified)"


def validate_withdrawal_address(network: str, address: str) -> tuple[bool, str]:
    """Dispatch to the right validator. Unknown networks are refused, not skipped."""
    net = str(network or "").strip().upper()
    family = NETWORK_FAMILIES.get(net)
    if family is None:
        return False, (f"unsupported network {network!r}; supported: "
                       f"{', '.join(sorted(NETWORK_FAMILIES))}")
    addr = str(address or "").strip()
    if not addr:
        return False, "address is empty"
    if len(addr) > 128:
        return False, "address is implausibly long"
    if family == "evm":
        return validate_evm_address(addr)
    if family == "tron":
        return validate_tron_address(addr)
    return validate_solana_address(addr)


# ---------------------------------------------------------------------------------------------
# The vault
# ---------------------------------------------------------------------------------------------
#: Phrase required to change a withdrawal destination. Not security theatre: it converts a
#: single-click CSRF/XSS-driven redirect of future profit into a deliberate, typed act.
WITHDRAWAL_CONFIRMATION_PHRASE = "CONFIRM-WITHDRAWAL-ADDRESS"


class CredentialVault:
    """Owner-only credential entry and withdrawal allowlist. Memory-only, like the store beneath it."""

    _lock = threading.RLock()
    _singleton: Optional["CredentialVault"] = None

    def __init__(self) -> None:
        self._addresses: dict[str, dict] = {}

    @classmethod
    def instance(cls) -> "CredentialVault":
        with cls._lock:
            if cls._singleton is None:
                cls._singleton = CredentialVault()
            return cls._singleton

    @classmethod
    def reset_for_tests(cls) -> None:
        with cls._lock:
            cls._singleton = CredentialVault()

    # ------------------------------------------------------------------ credentials
    def store_exchange_credentials(self, exchange: str, api_key: str, api_secret: str,
                                   *, source: str = "manual") -> None:
        """Store one exchange's key pair in memory. Raises ValueError on invalid input.

        Both halves are validated for shape before EITHER is written. Writing the key and then
        discovering the secret is empty would leave a half-configured exchange behind, and a later
        caller reading "key present" would conclude the pair is usable.
        """
        spec = _require_exchange(exchange)
        key = str(api_key or "").strip()
        secret = str(api_secret or "").strip()
        if not key:
            raise ValueError("apiKey is required")
        if not secret:
            raise ValueError("apiSecret is required")
        # Loose shape checks only. Exchange key formats change without notice, and a strict regex
        # that rejects a legitimate key is worse than no regex: it blocks the operator at the exact
        # moment they are trying to restore service.
        if len(key) < 8 or len(key) > 256:
            raise ValueError("apiKey length is not plausible for an exchange key")
        if len(secret) < 8 or len(secret) > 256:
            raise ValueError("apiSecret length is not plausible for an exchange secret")
        if any(c.isspace() for c in key) or any(c.isspace() for c in secret):
            raise ValueError("credentials must not contain whitespace (a copy/paste artefact)")

        store = RuntimeSecretStore.instance()
        store.set(spec.api_key_slot, key, source=source)
        store.set(spec.api_secret_slot, secret, source=source)

    def clear_exchange_credentials(self, exchange: str) -> None:
        spec = _require_exchange(exchange)
        store = RuntimeSecretStore.instance()
        store.clear(spec.api_key_slot)
        store.clear(spec.api_secret_slot)

    def exchange_status(self) -> dict:
        """Per-exchange presence and provenance. Never a value, never a length."""
        store = RuntimeSecretStore.instance()
        out: dict[str, dict] = {}
        for name, spec in EXCHANGES.items():
            has_key = store.has(spec.api_key_slot)
            has_secret = store.has(spec.api_secret_slot)
            out[name] = {
                "label": spec.label,
                "keyLoaded": has_key,
                "secretLoaded": has_secret,
                # Both halves or nothing: a half-loaded pair cannot trade, and reporting it as
                # merely "partial" understates that it is unusable.
                "ready": bool(has_key and has_secret),
                "keyConsoleUrl": spec.key_console_url,
                "requiredPermissions": spec.required_permissions,
                "forbiddenPermissions": spec.forbidden_permissions,
            }
        return out

    # ------------------------------------------------------------------ withdrawal allowlist
    def set_withdrawal_address(self, exchange: str, network: str, address: str,
                               *, confirmation: str, label: str = "") -> dict:
        """Record the ONE destination profit may be withdrawn to. Never triggers a transfer."""
        spec = _require_exchange(exchange)
        if str(confirmation or "").strip() != WITHDRAWAL_CONFIRMATION_PHRASE:
            raise PermissionError(
                "changing a withdrawal destination requires the explicit confirmation phrase"
            )
        ok, reason = validate_withdrawal_address(network, address)
        if not ok:
            raise ValueError(reason)
        entry = {
            "exchange": spec.exchange,
            "network": str(network).strip().upper(),
            "address": str(address).strip(),
            "label": str(label or "").strip()[:64],
            "set_at_ms": int(time.time() * 1000),
        }
        with self._lock:
            self._addresses[spec.exchange] = entry
        return self.withdrawal_addresses()

    def clear_withdrawal_address(self, exchange: str) -> dict:
        spec = _require_exchange(exchange)
        with self._lock:
            self._addresses.pop(spec.exchange, None)
        return self.withdrawal_addresses()

    def withdrawal_addresses(self) -> dict:
        """The allowlist. The ADDRESS is returned (the owner must be able to verify what is set);
        nothing secret is."""
        with self._lock:
            return {k: dict(v) for k, v in self._addresses.items()}

    def withdrawal_destination(self, exchange: str) -> Optional[str]:
        """The single allowed destination for an exchange, or None.

        The intended consumer is a future withdrawal path, which must look its destination up HERE
        and nowhere else — a destination supplied by a request body must never be honoured.
        """
        spec = _require_exchange(exchange)
        with self._lock:
            entry = self._addresses.get(spec.exchange)
        return entry["address"] if entry else None


def _require_exchange(exchange: str) -> ExchangeSpec:
    key = str(exchange or "").strip().lower()
    spec = EXCHANGES.get(key)
    if spec is None:
        raise ValueError(f"unknown exchange {exchange!r}; supported: {', '.join(sorted(EXCHANGES))}")
    return spec
