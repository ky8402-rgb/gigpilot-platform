"""Minimal signed-REST transport shared by the non-Bybit adapters.

Bybit has its own long-standing client (`bybit_rest.py`) which is left untouched. Binance and KuCoin
sign differently enough that each needs its own scheme, but the session handling, retry policy and
error extraction are identical, so they live here rather than being copy-pasted per venue.

Design notes:
  * Errors are classified, never swallowed. A 401/403 becomes `PermissionDenied`; a 429/5xx becomes
    a RETRYABLE `ExchangeError`; anything else is terminal. The caller decides, but it decides with
    the classification rather than by string-matching a message.
  * Retries use bounded exponential backoff and NEVER retry a non-idempotent request that lacks a
    client-order id. Retrying an un-deduplicatable order is how a timeout becomes two positions.
  * A non-JSON response body is reported as an error, not coerced into {}.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from urllib.parse import urlencode

import aiohttp

from gpkg.exchange.base import ExchangeError, PermissionDenied

log = logging.getLogger("gigpilot")

DEFAULT_TIMEOUT_S = 10
DEFAULT_RETRIES = 3


class RestClient:
    """Thin async HTTP helper. One instance per exchange adapter."""

    def __init__(self, exchange: str, base_url: str, timeout_s: int = DEFAULT_TIMEOUT_S):
        self.exchange = exchange
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._sess: aiohttp.ClientSession | None = None

    async def start(self) -> None:
        if self._sess is None:
            self._sess = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout_s),
                headers={"User-Agent": "gigpilot/2.0"},
            )

    async def stop(self) -> None:
        if self._sess:
            await self._sess.close()
            self._sess = None

    async def request(
        self,
        method: str,
        path: str,
        params: dict | None = None,
        body: dict | None = None,
        headers: dict | None = None,
        *,
        retries: int = DEFAULT_RETRIES,
        idempotent: bool = True,
    ) -> Any:
        assert self._sess is not None, "RestClient.start() must be awaited first"
        params = params or {}
        url = f"{self.base_url}{path}"
        last: Exception | None = None

        # A mutating call with no dedup key is not safe to replay. One attempt only.
        attempts = retries if (idempotent or method.upper() == "GET") else 1

        for attempt in range(attempts):
            try:
                kwargs: dict = {"params": params} if params else {}
                if headers:
                    kwargs["headers"] = headers
                if body is not None:
                    kwargs["data"] = json.dumps(body, separators=(",", ":")).encode()
                    kwargs.setdefault("headers", {})
                    kwargs["headers"]["Content-Type"] = "application/json"

                async with self._sess.request(method.upper(), url, **kwargs) as r:
                    text = await r.text()
                    if r.status in (401, 403):
                        raise PermissionDenied(self.exchange, f"HTTP {r.status}: {text[:200]}")
                    if r.status == 429 or r.status >= 500:
                        raise ExchangeError(
                            self.exchange, f"HTTP {r.status}: {text[:200]}", retryable=True
                        )
                    try:
                        data = json.loads(text) if text else {}
                    except json.JSONDecodeError as e:
                        raise ExchangeError(
                            self.exchange, f"non-JSON response (HTTP {r.status}): {text[:200]}"
                        ) from e
                    if r.status >= 400:
                        raise ExchangeError(self.exchange, f"HTTP {r.status}: {text[:200]}")
                    return data
            except (PermissionDenied, ExchangeError) as e:
                if isinstance(e, ExchangeError) and not e.retryable:
                    raise
                if isinstance(e, PermissionDenied):
                    raise
                last = e
            except Exception as e:
                last = e
            if attempt + 1 < attempts:
                await asyncio.sleep(0.4 * (2**attempt))

        raise ExchangeError(self.exchange, f"{method} {path} failed: {last}")


def qs(params: dict) -> str:
    """Deterministic query string. Signatures are order-sensitive on both venues."""
    return urlencode(sorted((k, v) for k, v in params.items() if v is not None))
