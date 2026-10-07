"""Bybit v5 WebSocket streaming feeds (Public Linear L2/Tickers/Trades + Private Positions/Orders/Executions).

Safety guarantees:
  - Separate public and private connection tracking (_public_ok, _private_ok).
  - Exponential reconnect backoff up to 30 seconds.
  - Heartbeat pings to maintain persistent socket connectivity.
  - Authenticated private channel subscription (position, order, execution, wallet).
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
from typing import Callable, Coroutine, Optional

import aiohttp

from gpkg.core.clock import f, now_ms
from gpkg.core.config import Config
from gpkg.core.metrics import Metrics
from gpkg.market.state import MarketState

log = logging.getLogger("gigpilot")


class BybitWS:
    def __init__(
        self,
        cfg: Config,
        markets: dict[str, MarketState],
        on_private_event: Optional[Callable[[dict], Coroutine]] = None,
        metrics: Optional[Metrics] = None,
    ):
        self.cfg = cfg
        self.markets = markets
        self.on_private_event = on_private_event
        self._metrics = metrics
        self._stop = asyncio.Event()
        self._public_ok = False
        self._private_ok = False
        self._tasks: list[asyncio.Task] = []

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._public_loop(), name="ws-public"),
            asyncio.create_task(self._private_loop(), name="ws-private"),
        ]

    async def stop(self) -> None:
        self._stop.set()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _public_loop(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=60)
                ) as sess:
                    async with sess.ws_connect(self.cfg.ws_public, heartbeat=20) as ws:
                        self._public_ok = True
                        if self._metrics:
                            self._metrics.set("gigpilot_ws_connected", 1, stream="public")
                        backoff = 1.0
                        args = []
                        for s in self.cfg.symbols:
                            args += [f"orderbook.50.{s}", f"tickers.{s}", f"publicTrade.{s}"]
                        await ws.send_json({"op": "subscribe", "args": args})
                        log.info("public WS subscribed: %s", self.cfg.symbols)
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                self._handle_public(json.loads(msg.data))
                            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                break
            except asyncio.CancelledError:
                return
            except Exception as e:
                log.warning("public WS: %s", e)
            finally:
                self._public_ok = False
                if self._metrics:
                    self._metrics.set("gigpilot_ws_connected", 0, stream="public")
            if self._stop.is_set():
                return
            await asyncio.sleep(backoff)
            backoff = min(30.0, backoff * 2)

    def _handle_public(self, msg: dict) -> None:
        topic = msg.get("topic", "")
        if not topic:
            return
        mtype = msg.get("type")
        data = msg.get("data")
        if topic.startswith("orderbook."):
            parts = topic.split(".")
            if len(parts) < 3:
                return
            sym = parts[2]
            ms = self.markets.get(sym)
            if ms is None or not isinstance(data, dict):
                return
            b, a = data.get("b") or [], data.get("a") or []
            if mtype == "snapshot":
                ms.apply_book_snapshot(b, a)
            else:
                ms.apply_book_delta(b, a)
            if self._metrics:
                self._metrics.set("gigpilot_tick_age_ms", now_ms() - ms.ts_book_ms, symbol=sym)
        elif topic.startswith("tickers."):
            sym = topic.split(".", 1)[1]
            ms = self.markets.get(sym)
            if ms is None or not isinstance(data, dict):
                return
            ms.last = f(data.get("lastPrice"), ms.last)
            ms.mark = f(data.get("markPrice"), ms.mark)
            ms.index = f(data.get("indexPrice"), ms.index)
            ms.funding_rate = f(data.get("fundingRate"), ms.funding_rate)
            ms.next_funding_ms = int(f(data.get("nextFundingTime"), 0))
            ms.ts_tick_ms = now_ms()
            if self._metrics:
                self._metrics.set("gigpilot_tick_age_ms", 0, symbol=sym)
                self._metrics.set("gigpilot_funding_rate", ms.funding_rate, symbol=sym)
        elif topic.startswith("publicTrade."):
            sym = topic.split(".", 1)[1]
            ms = self.markets.get(sym)
            if ms is None or not isinstance(data, list):
                return
            for t in data:
                px = f(t.get("p"))
                ts = int(f(t.get("T"), now_ms()))
                if px > 0:
                    ms.trades.append((ts, px))

    async def _private_loop(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                async with aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=60)
                ) as sess:
                    async with sess.ws_connect(self.cfg.ws_private, heartbeat=20) as ws:
                        expires = int((time.time() + 10) * 1000)
                        # Resolved by the SAME rule as REST, not read off `cfg`. Reading
                        # `cfg.api_secret` here meant runtime-secret mode authenticated REST and then
                        # failed this socket, silently losing every position/order/execution/wallet
                        # event while the connection looked like a transient WS problem.
                        from gpkg.core.runtime_secrets import (
                            RuntimeSecretStore,
                            SecretRequired,
                            resolve_api_credentials,
                        )
                        api_key, api_secret = resolve_api_credentials(self.cfg)
                        sig = hmac.new(api_secret.encode(), f"GET/realtime{expires}".encode(),
                                       hashlib.sha256).hexdigest()
                        del api_secret  # drop the reference as soon as the digest exists
                        await ws.send_json({"op": "auth", "args": [api_key, expires, sig]})
                        resp = await ws.receive_json()
                        if not resp.get("success"):
                            # FATAL, and deterministic: the venue rejected THIS signature, so the
                            # credential in memory will not sign anything else either. Scrub it and
                            # require re-entry, rather than reconnecting forever — with backoff capped
                            # at 30s that loop would otherwise look like a healthy retry while the
                            # engine silently could not see fills. The reply is NOT logged verbatim:
                            # an auth-failure payload can echo the request material that produced it.
                            RuntimeSecretStore.instance().clear()
                            raise SecretRequired(
                                "private WS auth rejected — runtime credential scrubbed from memory; "
                                "re-arm to retry"
                            )
                        self._private_ok = True
                        if self._metrics:
                            self._metrics.set("gigpilot_ws_connected", 1, stream="private")
                        backoff = 1.0
                        await ws.send_json({"op": "subscribe", "args": ["position", "order", "execution", "wallet"]})
                        log.info("private WS subscribed")
                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT and self.on_private_event:
                                try:
                                    await self.on_private_event(json.loads(msg.data))
                                except Exception as e:
                                    log.error("private handler: %s", e)
                            elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                break
            except asyncio.CancelledError:
                return
            except Exception as e:
                log.warning("private WS: %s", e)
            finally:
                self._private_ok = False
                if self._metrics:
                    self._metrics.set("gigpilot_ws_connected", 0, stream="private")
            if self._stop.is_set():
                return
            await asyncio.sleep(backoff)
            backoff = min(30.0, backoff * 2)
