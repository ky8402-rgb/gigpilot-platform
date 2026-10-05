"""Binance USDT-M Futures REST client (fapi.binance.com).
Implements the ExchangeAdapter abstraction with authenticated HMAC-SHA256 signing,
rate-limit tracking, and one-way mode position controls.
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
from gpkg.core.errors import BinanceError, BINANCE_DUPLICATE_ORDER_CODE
from gpkg.core.metrics import Metrics
from gpkg.exchange.base import ExchangeAdapter

log = logging.getLogger("gigpilot.binance")
BINANCE_FUTURES_HOST = "https://fapi.binance.com"


class BinanceAdapter(ExchangeAdapter):
    @property
    def exchange_name(self) -> str:
        return "binance"

    @property
    def duplicate_order_code(self) -> int:
        return BINANCE_DUPLICATE_ORDER_CODE

    def __init__(self, cfg: Config, metrics: Optional[Metrics] = None, host: str = BINANCE_FUTURES_HOST):
        self.cfg = cfg
        self.host = host
        self._sess: Optional[aiohttp.ClientSession] = None
        self._metrics = metrics

    async def start(self) -> None:
        if self._sess is None:
            self._sess = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10),
                headers={"User-Agent": "gigpilot-binance/1.2"},
            )

    async def stop(self) -> None:
        if self._sess:
            await self._sess.close()
            self._sess = None

    def _sign(self, query_string: str) -> str:
        return hmac.new(self.cfg.api_secret.encode("utf-8"), query_string.encode("utf-8"), hashlib.sha256).hexdigest()

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
        last_err = None

        for attempt in range(retries):
            try:
                headers = {"X-MBX-APIKEY": self.cfg.api_key}
                req_params = dict(params)
                if signed:
                    req_params["timestamp"] = str(now_ms())
                    req_params["recvWindow"] = self.cfg.recv_window or "5000"
                    qs = urlencode(sorted(req_params.items()))
                    signature = self._sign(qs)
                    req_params["signature"] = signature

                url = self.host + path
                if method.upper() == "GET":
                    async with self._sess.get(url, params=req_params, headers=headers) as r:
                        data = await r.json()
                        used_weight = r.headers.get("x-mbx-used-weight-1m")
                        if used_weight and self._metrics:
                            self._metrics.set("gigpilot_binance_used_weight_1m", f(used_weight))
                elif method.upper() == "POST":
                    async with self._sess.post(url, data=req_params, headers=headers) as r:
                        data = await r.json()
                elif method.upper() == "DELETE":
                    async with self._sess.delete(url, params=req_params, headers=headers) as r:
                        data = await r.json()
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")

                if isinstance(data, dict) and data.get("code") and data.get("code") != 200 and int(data.get("code", 0)) < 0:
                    code = int(data.get("code", -1))
                    msg = data.get("msg", "Unknown error")
                    raise BinanceError(code, msg)

                return data
            except BinanceError:
                raise
            except Exception as e:
                last_err = e
                log.warning("Binance REST %s %s attempt %d: %s", method, path, attempt + 1, e)
                await asyncio.sleep(0.4 * (2**attempt))

        raise RuntimeError(f"Binance REST {method} {path} failed: {last_err}")

    async def tickers(self) -> list[dict]:
        data = await self._req("GET", "/fapi/v1/ticker/24hr", signed=False)
        result = []
        if isinstance(data, list):
            for t in data:
                result.append({
                    "symbol": t.get("symbol"),
                    "lastPrice": t.get("lastPrice"),
                    "markPrice": t.get("lastPrice"),
                    "fundingRate": "0.0001",
                    "nextFundingTime": "0",
                })
        return result

    async def kline(self, symbol: str, interval: str = "1", limit: int = 200) -> list:
        interval_map = {"1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "D": "1d"}
        bin_interval = interval_map.get(interval, f"{interval}m")
        return await self._req(
            "GET",
            "/fapi/v1/klines",
            {"symbol": symbol.upper(), "interval": bin_interval, "limit": limit},
            signed=False,
        )

    async def instrument(self, symbol: str) -> dict:
        info = await self._req("GET", "/fapi/v1/exchangeInfo", signed=False)
        symbols = info.get("symbols", [])
        sym_info = next((s for s in symbols if s.get("symbol") == symbol.upper()), None)
        if not sym_info:
            return {}

        qty_step = "0.001"
        tick_size = "0.01"
        for flt in sym_info.get("filters", []):
            if flt.get("filterType") == "LOT_SIZE":
                qty_step = flt.get("stepSize", "0.001")
            elif flt.get("filterType") == "PRICE_FILTER":
                tick_size = flt.get("tickSize", "0.01")

        return {
            "symbol": symbol.upper(),
            "lotSizeFilter": {"qtyStep": qty_step, "minOrderQty": qty_step},
            "priceFilter": {"tickSize": tick_size},
        }

    async def wallet(self) -> dict:
        account = await self._req("GET", "/fapi/v2/account")
        assets = account.get("assets", [])
        usdt = next((a for a in assets if a.get("asset") == "USDT"), {})
        equity = f(usdt.get("marginBalance"), 0.0)
        avail = f(usdt.get("availableBalance"), 0.0)
        maint_margin = f(account.get("totalMaintMargin"), 0.0)
        margin_balance = f(account.get("totalMarginBalance"), 1.0)
        im_rate = (maint_margin / margin_balance) if margin_balance > 0 else 0.0

        return {
            "list": [
                {
                    "totalEquity": str(equity),
                    "accountIMRate": str(im_rate),
                    "coin": [
                        {
                            "coin": "USDT",
                            "equity": str(equity),
                            "walletBalance": str(f(usdt.get("walletBalance"), 0.0)),
                            "availableToWithdraw": str(avail),
                        }
                    ],
                }
            ]
        }

    async def fee_rate(self, symbol: str) -> dict:
        rate = await self._req("GET", "/fapi/v1/commissionRate", {"symbol": symbol.upper()})
        return {
            "takerFeeRate": rate.get("takerCommissionRate", "0.0005"),
            "makerFeeRate": rate.get("makerCommissionRate", "0.0002"),
        }

    async def positions(self) -> list[dict]:
        pos_list = await self._req("GET", "/fapi/v2/positionRisk")
        results = []
        for p in pos_list:
            amt = f(p.get("positionAmt"), 0.0)
            if abs(amt) > 0:
                side = "Buy" if amt > 0 else "Sell"
                results.append({
                    "symbol": p.get("symbol"),
                    "side": side,
                    "size": str(abs(amt)),
                    "avgPrice": str(p.get("entryPrice", "0")),
                    "markPrice": str(p.get("markPrice", "0")),
                    "leverage": str(p.get("leverage", "1")),
                    "positionIdx": 0,
                })
        return results

    async def open_orders(self) -> list[dict]:
        orders = await self._req("GET", "/fapi/v1/openOrders")
        results = []
        for o in orders:
            results.append({
                "symbol": o.get("symbol"),
                "orderId": str(o.get("orderId")),
                "orderLinkId": str(o.get("clientOrderId")),
                "side": o.get("side", "").capitalize(),
                "price": str(o.get("price")),
                "qty": str(o.get("origQty")),
                "leavesQty": str(float(o.get("origQty", 0)) - float(o.get("executedQty", 0))),
                "orderStatus": "New" if o.get("status") == "NEW" else "PartiallyFilled",
            })
        return results

    async def api_info(self) -> dict:
        try:
            account = await self._req("GET", "/fapi/v2/account")
            can_trade = account.get("canTrade", False)
            return {
                "result": {
                    "permissions": {
                        "ContractTrade": ["FuturesTrading"] if can_trade else []
                    },
                    "readOnly": 0 if can_trade else 1,
                }
            }
        except Exception as e:
            return {
                "result": {
                    "permissions": {},
                    "readOnly": 1,
                    "error": str(e),
                }
            }

    async def closed_pnl(self, limit: int = 100) -> list[dict]:
        trades = await self._req("GET", "/fapi/v1/userTrades", {"limit": limit})
        results = []
        for t in trades:
            results.append({
                "symbol": t.get("symbol"),
                "orderId": str(t.get("orderId")),
                "side": "Buy" if t.get("buyer") else "Sell",
                "avgExitPrice": str(t.get("price")),
                "closedPnl": str(t.get("realizedPnl")),
                "execFee": str(t.get("commission")),
                "createdTime": str(t.get("time")),
            })
        return results

    async def set_leverage(self, symbol: str, lev: float) -> None:
        await self._req("POST", "/fapi/v1/leverage", {"symbol": symbol.upper(), "leverage": int(lev)})

    async def place_order(self, **kw) -> dict:
        side = "BUY" if str(kw.get("side", "")).upper() in ("BUY", "LONG") else "SELL"
        order_type = str(kw.get("orderType", "MARKET")).upper()
        params = {
            "symbol": str(kw.get("symbol", "")).upper(),
            "side": side,
            "type": order_type,
            "quantity": str(kw.get("qty", kw.get("quantity", ""))),
            "newClientOrderId": str(kw.get("orderLinkId", "")),
        }
        if order_type == "LIMIT":
            params["price"] = str(kw.get("price", ""))
            params["timeInForce"] = kw.get("timeInForce", "GTC")
        if kw.get("reduceOnly"):
            params["reduceOnly"] = "true"

        resp = await self._req("POST", "/fapi/v1/order", params)
        return {"orderId": str(resp.get("orderId", "")), "orderLinkId": str(resp.get("clientOrderId", ""))}

    async def cancel_order(self, **kw) -> dict:
        params = {"symbol": str(kw.get("symbol", "")).upper()}
        if kw.get("orderLinkId"):
            params["origClientOrderId"] = str(kw["orderLinkId"])
        elif kw.get("orderId"):
            params["orderId"] = str(kw["orderId"])
        return await self._req("DELETE", "/fapi/v1/order", params)

    async def cancel_all(self, symbol: str) -> dict:
        return await self._req("DELETE", "/fapi/v1/allOpenOrders", {"symbol": symbol.upper()})

    async def trading_stop(self, **kw) -> dict:
        symbol = str(kw.get("symbol", "")).upper()
        tp = kw.get("takeProfit")
        sl = kw.get("stopLoss")
        tasks = []
        if tp:
            tasks.append(
                self._req(
                    "POST",
                    "/fapi/v1/order",
                    {
                        "symbol": symbol,
                        "side": "SELL" if kw.get("side") == "Buy" else "BUY",
                        "type": "TAKE_PROFIT_MARKET",
                        "stopPrice": str(tp),
                        "closePosition": "true",
                    },
                )
            )
        if sl:
            tasks.append(
                self._req(
                    "POST",
                    "/fapi/v1/order",
                    {
                        "symbol": symbol,
                        "side": "SELL" if kw.get("side") == "Buy" else "BUY",
                        "type": "STOP_MARKET",
                        "stopPrice": str(sl),
                        "closePosition": "true",
                    },
                )
            )
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        return {"status": "ok"}
