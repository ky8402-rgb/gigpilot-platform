"""KuCoin Futures REST client (api-futures.kucoin.com).
Implements the ExchangeAdapter abstraction with authenticated Base64 HMAC-SHA256 signing,
v2 passphrase encryption, and one-way USDT perpetual contract execution.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
from typing import Any, Optional
from urllib.parse import urlencode

import aiohttp

from gpkg.core.clock import f, now_ms
from gpkg.core.config import Config
from gpkg.core.errors import KuCoinError, KUCOIN_DUPLICATE_ORDER_CODE
from gpkg.core.metrics import Metrics
from gpkg.exchange.base import ExchangeAdapter

log = logging.getLogger("gigpilot.kucoin")
KUCOIN_FUTURES_HOST = "https://api-futures.kucoin.com"


class KuCoinAdapter(ExchangeAdapter):
    @property
    def exchange_name(self) -> str:
        return "kucoin"

    @property
    def duplicate_order_code(self) -> int:
        return KUCOIN_DUPLICATE_ORDER_CODE

    def __init__(self, cfg: Config, metrics: Optional[Metrics] = None, host: str = KUCOIN_FUTURES_HOST, passphrase: str = ""):
        self.cfg = cfg
        self.host = host
        self.passphrase = passphrase or getattr(cfg, "api_passphrase", "")
        self._sess: Optional[aiohttp.ClientSession] = None
        self._metrics = metrics

    def _to_kucoin_symbol(self, symbol: str) -> str:
        s = symbol.upper().replace("/", "").replace("-", "")
        if s.startswith("BTC"):
            return "XBTUSDTM"
        if not s.endswith("M"):
            return f"{s}M"
        return s

    async def start(self) -> None:
        if self._sess is None:
            self._sess = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10),
                headers={"User-Agent": "gigpilot-kucoin/1.2"},
            )

    async def stop(self) -> None:
        if self._sess:
            await self._sess.close()
            self._sess = None

    def _sign(self, ts: str, method: str, endpoint: str, body_str: str = "") -> str:
        str_to_sign = ts + method.upper() + endpoint + body_str
        mac = hmac.new(self.cfg.api_secret.encode("utf-8"), str_to_sign.encode("utf-8"), hashlib.sha256)
        return base64.b64encode(mac.digest()).decode("utf-8")

    def _sign_passphrase(self) -> str:
        if not self.passphrase:
            return ""
        mac = hmac.new(self.cfg.api_secret.encode("utf-8"), self.passphrase.encode("utf-8"), hashlib.sha256)
        return base64.b64encode(mac.digest()).decode("utf-8")

    async def _req(
        self,
        method: str,
        path: str,
        params: Optional[dict] = None,
        body: Optional[dict] = None,
        signed: bool = True,
        retries: int = 3,
    ) -> Any:
        assert self._sess is not None
        params = params or {}
        endpoint = path
        if params:
            qs = urlencode(sorted(params.items()))
            endpoint = f"{path}?{qs}"

        body_str = json.dumps(body) if body is not None else ""
        last_err = None

        for attempt in range(retries):
            try:
                headers = {"Content-Type": "application/json"}
                if signed:
                    ts = str(now_ms())
                    headers.update({
                        "KC-API-KEY": self.cfg.api_key,
                        "KC-API-SIGN": self._sign(ts, method, endpoint, body_str),
                        "KC-API-TIMESTAMP": ts,
                        "KC-API-PASSPHRASE": self._sign_passphrase(),
                        "KC-API-KEY-VERSION": "2",
                    })

                url = self.host + endpoint
                if method.upper() == "GET":
                    async with self._sess.get(url, headers=headers) as r:
                        data = await r.json()
                elif method.upper() == "POST":
                    async with self._sess.post(url, data=body_str, headers=headers) as r:
                        data = await r.json()
                elif method.upper() == "DELETE":
                    async with self._sess.delete(url, headers=headers) as r:
                        data = await r.json()
                else:
                    raise ValueError(f"Unsupported method: {method}")

                if isinstance(data, dict):
                    code = int(data.get("code", "200000"))
                    if code not in (200000, 200, 0):
                        msg = data.get("msg", "KuCoin request failed")
                        raise KuCoinError(code, msg)
                    return data.get("data", {})

                return data
            except KuCoinError:
                raise
            except Exception as e:
                last_err = e
                log.warning("KuCoin REST %s %s attempt %d: %s", method, path, attempt + 1, e)
                await asyncio.sleep(0.4 * (2**attempt))

        raise RuntimeError(f"KuCoin REST {method} {path} failed: {last_err}")

    async def tickers(self) -> list[dict]:
        data = await self._req("GET", "/api/v1/allTickers", signed=False)
        result = []
        if isinstance(data, list):
            for t in data:
                sym = t.get("symbol", "").replace("XBTUSDTM", "BTCUSDT").replace("USDTM", "USDT")
                result.append({
                    "symbol": sym,
                    "lastPrice": str(t.get("price", "0")),
                    "markPrice": str(t.get("price", "0")),
                    "fundingRate": "0.0001",
                    "nextFundingTime": "0",
                })
        return result

    async def kline(self, symbol: str, interval: str = "1", limit: int = 200) -> list:
        sym = self._to_kucoin_symbol(symbol)
        data = await self._req("GET", "/api/v1/kline/query", {"symbol": sym, "granularity": str(int(interval) * 60)}, signed=False)
        return data if isinstance(data, list) else []

    async def instrument(self, symbol: str) -> dict:
        sym = self._to_kucoin_symbol(symbol)
        contracts = await self._req("GET", "/api/v1/contracts/active", signed=False)
        contract = next((c for c in contracts if c.get("symbol") == sym), None)
        if not contract:
            return {}
        lot = contract.get("multiplier", 0.001)
        tick = contract.get("tickSize", 0.1)
        return {
            "symbol": symbol.upper(),
            "lotSizeFilter": {"qtyStep": str(abs(lot)), "minOrderQty": str(abs(lot))},
            "priceFilter": {"tickSize": str(tick)},
        }

    async def wallet(self) -> dict:
        acc = await self._req("GET", "/api/v1/account-overview", {"currency": "USDT"})
        eq = f(acc.get("accountEquity"), 0.0)
        avail = f(acc.get("availableBalance"), eq)
        maint = f(acc.get("positionMargin"), 0.0)
        imr = (maint / eq) if eq > 0 else 0.0
        return {
            "list": [
                {
                    "totalEquity": str(eq),
                    "accountIMRate": str(imr),
                    "coin": [
                        {
                            "coin": "USDT",
                            "equity": str(eq),
                            "walletBalance": str(eq),
                            "availableToWithdraw": str(avail),
                        }
                    ],
                }
            ]
        }

    async def fee_rate(self, symbol: str) -> dict:
        return {"takerFeeRate": "0.0006", "makerFeeRate": "0.0002"}

    async def positions(self) -> list[dict]:
        pos_list = await self._req("GET", "/api/v1/positions")
        results = []
        if isinstance(pos_list, list):
            for p in pos_list:
                amt = f(p.get("currentQty"), 0.0)
                if abs(amt) > 0:
                    sym = p.get("symbol", "").replace("XBTUSDTM", "BTCUSDT").replace("USDTM", "USDT")
                    results.append({
                        "symbol": sym,
                        "side": "Buy" if amt > 0 else "Sell",
                        "size": str(abs(amt)),
                        "avgPrice": str(p.get("avgEntryPrice", "0")),
                        "markPrice": str(p.get("markPrice", "0")),
                        "leverage": str(p.get("realLeverage", "1")),
                        "positionIdx": 0,
                    })
        return results

    async def open_orders(self) -> list[dict]:
        data = await self._req("GET", "/api/v1/orders", {"status": "active"})
        items = data.get("items", []) if isinstance(data, dict) else []
        results = []
        for o in items:
            sym = o.get("symbol", "").replace("XBTUSDTM", "BTCUSDT").replace("USDTM", "USDT")
            results.append({
                "symbol": sym,
                "orderId": str(o.get("id")),
                "orderLinkId": str(o.get("clientOid")),
                "side": o.get("side", "").capitalize(),
                "price": str(o.get("price")),
                "qty": str(o.get("size")),
                "leavesQty": str(float(o.get("size", 0)) - float(o.get("dealSize", 0))),
                "orderStatus": "New" if o.get("status") == "open" else "PartiallyFilled",
            })
        return results

    async def api_info(self) -> dict:
        try:
            acc = await self._req("GET", "/api/v1/account-overview", {"currency": "USDT"})
            can_trade = bool(acc and "accountEquity" in acc)
            return {
                "result": {
                    "permissions": {
                        "ContractTrade": ["FuturesTrade"] if can_trade else []
                    },
                    "readOnly": 0 if can_trade else 1,
                }
            }
        except Exception as e:
            return {"result": {"permissions": {}, "readOnly": 1, "error": str(e)}}

    async def closed_pnl(self, limit: int = 100) -> list[dict]:
        data = await self._req("GET", "/api/v1/history-orders", {"status": "done", "pageSize": str(limit)})
        items = data.get("items", []) if isinstance(data, dict) else []
        results = []
        for o in items:
            sym = o.get("symbol", "").replace("XBTUSDTM", "BTCUSDT").replace("USDTM", "USDT")
            results.append({
                "symbol": sym,
                "orderId": str(o.get("id")),
                "side": o.get("side", "").capitalize(),
                "avgExitPrice": str(o.get("price", "0")),
                "closedPnl": str(o.get("realisedPnl", "0")),
                "execFee": str(abs(float(o.get("fee", "0")))),
                "createdTime": str(o.get("createdAt", "0")),
            })
        return results

    async def set_leverage(self, symbol: str, lev: float) -> None:
        sym = self._to_kucoin_symbol(symbol)
        await self._req("POST", "/api/v1/position/risk-limit-level/change", body={"symbol": sym, "level": 1})

    async def place_order(self, **kw) -> dict:
        sym = self._to_kucoin_symbol(str(kw.get("symbol", "")))
        side = "buy" if str(kw.get("side", "")).lower() in ("buy", "long") else "sell"
        order_type = "market" if str(kw.get("orderType", "")).lower() == "market" else "limit"

        body = {
            "clientOid": str(kw.get("orderLinkId", "")),
            "symbol": sym,
            "side": side,
            "type": order_type,
            "size": str(int(f(kw.get("qty", "1")))),
            "leverage": str(int(self.cfg.max_leverage)),
        }
        if order_type == "limit":
            body["price"] = str(kw.get("price", ""))
        if kw.get("reduceOnly"):
            body["reduceOnly"] = True

        data = await self._req("POST", "/api/v1/orders", body=body)
        order_id = data.get("orderId", "") if isinstance(data, dict) else ""
        return {"orderId": str(order_id), "orderLinkId": str(kw.get("orderLinkId", ""))}

    async def cancel_order(self, **kw) -> dict:
        if kw.get("orderLinkId"):
            return await self._req("DELETE", f"/api/v1/orders/client-order/{kw['orderLinkId']}")
        elif kw.get("orderId"):
            return await self._req("DELETE", f"/api/v1/orders/{kw['orderId']}")
        return {}

    async def cancel_all(self, symbol: str) -> dict:
        sym = self._to_kucoin_symbol(symbol)
        return await self._req("DELETE", "/api/v1/orders", params={"symbol": sym})

    async def trading_stop(self, **kw) -> dict:
        sym = self._to_kucoin_symbol(str(kw.get("symbol", "")))
        tp = kw.get("takeProfit")
        sl = kw.get("stopLoss")
        tasks = []
        if tp:
            tasks.append(
                self._req(
                    "POST",
                    "/api/v1/orders",
                    body={
                        "clientOid": f"tp-{kw.get('orderLinkId', 'tp')[:20]}",
                        "symbol": sym,
                        "side": "sell" if kw.get("side") == "Buy" else "buy",
                        "type": "market",
                        "stop": "up" if kw.get("side") == "Buy" else "down",
                        "stopPrice": str(tp),
                        "stopPriceType": "MP",
                        "reduceOnly": True,
                        "size": str(int(f(kw.get("qty", "1")))),
                    },
                )
            )
        if sl:
            tasks.append(
                self._req(
                    "POST",
                    "/api/v1/orders",
                    body={
                        "clientOid": f"sl-{kw.get('orderLinkId', 'sl')[:20]}",
                        "symbol": sym,
                        "side": "sell" if kw.get("side") == "Buy" else "buy",
                        "type": "market",
                        "stop": "down" if kw.get("side") == "Buy" else "up",
                        "stopPrice": str(sl),
                        "stopPriceType": "MP",
                        "reduceOnly": True,
                        "size": str(int(f(kw.get("qty", "1")))),
                    },
                )
            )
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        return {"status": "ok"}
