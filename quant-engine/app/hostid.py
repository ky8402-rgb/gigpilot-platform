"""Host identity verification.

Why this exists
---------------
An exchange API key is bound to specific source IPs. When more than one host is in
play — a build/dev box and a production box, say — the SAME configuration can be
running on a machine whose IP the key does NOT allow. The failure mode is not
subtle (orders are rejected), but the *silent* variant is worse: a key that allows
several IPs, or an operator who allowlists the wrong one, can route live orders from
a host nobody intended.

So the platform can be told which host it is expected to be, and refuses to trade
if it is not that host. This is an explicit opt-in: if `expected_host_ip` is unset,
the check is disabled and the platform behaves exactly as before.
"""
from __future__ import annotations

import ipaddress
from typing import Optional

import httpx

PROVIDERS = (
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
)


def normalize_ip(value: str) -> str:
    return (value or "").strip()


def is_valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(normalize_ip(value))
        return True
    except ValueError:
        return False


async def fetch_public_ip(timeout: float = 8.0) -> Optional[str]:
    """Best-effort outbound public IPv4.

    Tries several providers because a single one being down must not be read as
    "wrong host". Returns None if it cannot be determined — the caller decides
    whether that is fatal (it is, when the operator opted into the check).
    """
    for url in PROVIDERS:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    continue
                candidate = normalize_ip(resp.text)
                if is_valid_ip(candidate):
                    return candidate
        except Exception:
            continue
    return None


async def verify(expected_ip: str) -> dict:
    """Compare this host's outbound IP against the expected one.

    Returns a report; `ok` is False when the check is enabled and cannot be
    satisfied, including when the IP cannot be determined at all (fail closed).
    """
    expected = normalize_ip(expected_ip)
    if not expected:
        return {"enabled": False, "ok": True, "expected": None, "actual": None,
                "detail": "host identity check disabled (expected_host_ip unset)"}

    actual = await fetch_public_ip()
    if actual is None:
        return {"enabled": True, "ok": False, "expected": expected, "actual": None,
                "detail": "could not determine this host's outbound IP; refusing to "
                          "trade rather than risk running on the wrong host"}
    if actual != expected:
        return {"enabled": True, "ok": False, "expected": expected, "actual": actual,
                "detail": f"this host's outbound IP is {actual}, expected {expected}. "
                          f"An exchange API key bound to {expected} cannot authenticate "
                          f"from here."}
    return {"enabled": True, "ok": True, "expected": expected, "actual": actual,
            "detail": f"running on the expected host ({actual})"}
