"""Bybit v5 REST client for linear perpetual futures.

Features:
  - HMAC-SHA256 request signing with UTC timestamp and configurable recv_window.
  - Exponential backoff retry on network failures.
  - Explicit Bybit retCode error extraction.
  - Rate limit telemetry via Metrics.
  - Non-mutating API permission query (/v5/user/query-api) for trade authorization probing.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
from typing import Optional
from urllib.parse import urlencode

import aiohttp

from gpkg.core.clock import f, now_ms
from gpkg.core.config import Config
from gpkg.core.errors import BybitError
from gpkg.core.metrics import Metrics

log = logging.getLogger("gigpilot")


class BybitREST:
    def __init__(self, cfg: Config, metrics: Optional[Metrics] = None):
        self.cfg = cfg
        self._sess: Optional[aiohttp.ClientSession] = None
        if metrics is None:
            try:
                import gigpilot
                self._metrics = getattr(gigpilot, "METRICS", None)
            except Exception:
                self._metrics = None
        else:
            self._metrics = metrics

    async def start(self) -> None:
        if self._sess is None:
            self._sess = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10),
                headers={"User-Agent": "gigpilot/1.2"},
            )

    async def stop(self) -> None:
        if self._sess:
            await self._sess.close()
            self._sess = None

    def _secret(self) -> str:
        """The API secret to sign with: runtime-injected first, config second — or FAIL.

        ORDERING IS THE WHOLE POINT. A secret the operator typed for THIS armed session must win over
        one left lying in `.env`, `os.environ` or Secrets Manager, otherwise the hand-entry control is
        decorative: the system would silently keep signing with the persisted key.

        `require_runtime_secret` makes the absence of a runtime secret a hard refusal rather than a
        fallback to the persisted one. That is the difference between "we prefer runtime secrets" and
        "the persisted secret can never be used for live signing", and only the second is a control.

        This is also the only place in the process where the plaintext exists, and it exists for the
        duration of one HMAC. It is deliberately not cached on the instance: caching would put the
        secret on an object that gets `repr()`ed, logged and pickled.
        """
        # Delegated to ONE resolver shared with the private WebSocket. Duplicating the ordering here
        # is what allowed the two callers to drift apart.
        from gpkg.core.runtime_secrets import resolve_api_credentials

        return resolve_api_credentials(self.cfg)[1]

    def _api_key(self) -> str:
        """The API key to identify with, resolved by the SAME rule as `_secret()`.

        Runtime-first, config-second, fail-closed when neither exists. This mirrors `_secret()`
        deliberately, because the key and the secret are two halves of ONE credential: signing with
        one key while sending another produces an "invalid signature" rejection that looks exactly
        like a rotated secret at the call site. One rule, both halves.

        Unlike the secret, the config fallback is not suppressed by `require_runtime_secret`. That
        mode exists to stop a PERSISTED SECRET from ever signing; the key identifies, it does not
        authorise, and the production deployment deliberately supplies the key while the operator
        supplies the secret by hand. Raising here would break that arrangement rather than harden it.
        """
        from gpkg.core.runtime_secrets import resolve_api_credentials

        return resolve_api_credentials(self.cfg)[0]

    def _sign(self, ts: str, payload: str) -> str:
        msg = ts + self._api_key() + self.cfg.recv_window + payload
        secret = self._secret()
        # `del` the local as soon as the digest exists: the string is immutable, so this only drops
        # the reference, but it shortens the window in which a usable plaintext is reachable from
        # this frame — including from a traceback captured while signing.
        digest = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
        del secret
        return digest

    async def _req(
        self,
        method: str,
        path: str,
        params: Optional[dict] = None,
        body: Optional[dict] = None,
        signed: bool = True,
        retries: int = 3,
    ) -> dict:
        assert self._sess is not None
        params = params or {}
        url = self.cfg.host + path
        last_err = None
        for attempt in range(retries):
            try:
                if signed:
                    ts = str(now_ms())
                    if method == "GET":
                        payload = urlencode(sorted(params.items()))
                        headers = {
                            "X-BAPI-API-KEY": self._api_key(),
                            "X-BAPI-TIMESTAMP": ts,
                            "X-BAPI-RECV-WINDOW": self.cfg.recv_window,
                            "X-BAPI-SIGN": self._sign(ts, payload),
                        }
                        async with self._sess.get(url, params=params, headers=headers) as r:
                            data = await r.json()
                            rem = r.headers.get("X-Bapi-Limit-Status")
                            if rem and self._metrics:
                                self._metrics.set("gigpilot_rest_rate_limit_remaining", f(rem))
                    else:
                        bs = json.dumps(body or {}, separators=(",", ":"))
                        headers = {
                            "X-BAPI-API-KEY": self._api_key(),
                            "X-BAPI-TIMESTAMP": ts,
                            "X-BAPI-RECV-WINDOW": self.cfg.recv_window,
                            "X-BAPI-SIGN": self._sign(ts, bs),
                            "Content-Type": "application/json",
                        }
                        async with self._sess.post(url, data=bs, headers=headers) as r:
                            data = await r.json()
                else:
                    async with self._sess.get(url, params=params) as r:
                        data = await r.json()
                if not isinstance(data, dict):
                    raise BybitError(-1, f"non-dict: {data}")
                if data.get("retCode") != 0:
                    raise BybitError(int(data.get("retCode", -1)), data.get("retMsg", "?"))
                return data.get("result", {})
            except BybitError:
                raise
            except Exception as e:
                last_err = e
                log.warning("REST %s %s attempt %d: %s", method, path, attempt + 1, e)
                await asyncio.sleep(0.4 * (2**attempt))
        raise RuntimeError(f"REST {method} {path} failed: {last_err}")

    async def tickers(self) -> list:
        return (await self._req("GET", "/v5/market/tickers", {"category": "linear"}, signed=False)).get("list", [])

    async def kline(self, symbol: str, interval: str = "1", limit: int = 200) -> list:
        return (
            await self._req(
                "GET",
                "/v5/market/kline",
                {"category": "linear", "symbol": symbol, "interval": interval, "limit": limit},
                signed=False,
            )
        ).get("list", [])

    async def instrument(self, symbol: str) -> dict:
        r = await self._req("GET", "/v5/market/instruments-info", {"category": "linear", "symbol": symbol}, signed=False)
        lst = r.get("list", [])
        return lst[0] if lst else {}

    async def wallet(self) -> dict:
        return await self._req("GET", "/v5/account/wallet-balance", {"accountType": "UNIFIED"})

    async def fee_rate(self, symbol: str) -> dict:
        r = await self._req("GET", "/v5/account/fee-rate", {"category": "linear", "symbol": symbol})
        lst = r.get("list", [])
        return lst[0] if lst else {}

    async def positions(self) -> list:
        return (await self._req("GET", "/v5/position/list", {"category": "linear", "settleCoin": "USDT"})).get("list", [])

    async def open_orders(self) -> list:
        return (await self._req("GET", "/v5/order/realtime", {"category": "linear", "settleCoin": "USDT"})).get("list", [])

    async def order_history(self, symbol: str, order_link_id: str | None = None,
                            limit: int = 50) -> list:
        """Recently-finalised orders, optionally filtered to one client order id.

        Needed to answer the question that decides whether an unfilled maker quote is safe to
        abandon: an order missing from `/v5/order/realtime` has either FILLED or been cancelled, and
        those demand opposite responses. Without this the two are indistinguishable, so a filled
        order would look like an empty one and its position would be left unprotected.
        """
        params: dict = {"category": "linear", "symbol": symbol, "limit": int(limit)}
        if order_link_id:
            params["orderLinkId"] = order_link_id
        return (await self._req("GET", "/v5/order/history", params)).get("list", [])

    async def api_info(self) -> dict:
        """Describe THIS API key: permissions and read-only status.

        Non-mutating (unlike cancel-all), so it is safe to poll. It answers the question that
        actually matters for trading readiness — NOT "does the key authenticate?" (a key can read
        positions and orders perfectly well while being refused on every order-mutating endpoint)
        but "is this key AUTHORISED TO TRADE?".
        """
        return await self._req("GET", "/v5/user/query-api", {})

    async def closed_pnl(self, limit: int = 100) -> list:
        return (await self._req("GET", "/v5/position/closed-pnl", {"category": "linear", "limit": limit})).get("list", [])

    async def set_leverage(self, symbol: str, lev: float) -> None:
        try:
            await self._req(
                "POST",
                "/v5/position/set-leverage",
                body={
                    "category": "linear",
                    "symbol": symbol,
                    "buyLeverage": str(lev),
                    "sellLeverage": str(lev),
                },
            )
        except BybitError as e:
            if e.code != 110043:
                raise

    async def place_order(self, **kw) -> dict:
        return await self._req("POST", "/v5/order/create", body=kw)

    async def cancel_order(self, **kw) -> dict:
        return await self._req("POST", "/v5/order/cancel", body=kw)

    async def cancel_all(self, symbol: str) -> dict:
        return await self._req("POST", "/v5/order/cancel-all", body={"category": "linear", "symbol": symbol})

    async def trading_stop(self, **kw) -> dict:
        return await self._req("POST", "/v5/position/trading-stop", body=kw)
