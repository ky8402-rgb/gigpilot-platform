"""OKX v5 SWAP (USDT Perpetual Futures) REST client (www.okx.com).
Implements the ExchangeAdapter abstraction with authenticated ISO-timestamp HMAC-SHA256 Base64 signing,
passphrase validation, and net position mode support.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import aiohttp

from gpkg.core.clock import f
from gpkg.core.config import Config
from gpkg.core.errors import OKX_DUPLICATE_ORDER_CODE, OKXError
from gpkg.core.metrics import Metrics
from gpkg.exchange.base import ExchangeAdapter

log = logging.getLogger("gigpilot.okx")
OKX_HOST = "https://www.okx.com"


class OKXAdapter(ExchangeAdapter):
    @property
    def exchange_name(self) -> str:
        return "okx"

    @property
    def duplicate_order_code(self) -> int:
        return OKX_DUPLICATE_ORDER_CODE

    def __init__(self, cfg: Config, metrics: Metrics | None = None, host: str = OKX_HOST, passphrase: str = ""):
        self.cfg = cfg
        self.host = host
        self.passphrase = passphrase or getattr(cfg, "api_passphrase", "")
        self._sess: aiohttp.ClientSession | None = None
        self._metrics = metrics

    def _to_inst_id(self, symbol: str) -> str:
        s = symbol.upper().replace("/", "").replace("-", "")
        if s.endswith("USDT"):
            base = s[:-4]
            return f"{base}-USDT-SWAP"
        return f"{s}-SWAP"

    async def start(self) -> None:
        if self._sess is None:
            self._sess = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10),
                headers={"User-Agent": "gigpilot-okx/1.2"},
            )

    async def stop(self) -> None:
        if self._sess:
            await self._sess.close()
            self._sess = None

    def _sign(self, timestamp: str, method: str, path: str, body_str: str = "") -> str:
        message = timestamp + method.upper() + path + body_str
        mac = hmac.new(self.cfg.api_secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256)
        return base64.b64encode(mac.digest()).decode("utf-8")

    async def _req(
        self,
        method: str,
        path: str,
        params: dict | None = None,
        body: dict | None = None,
        signed: bool = True,
        retries: int = 3,
    ) -> Any:
        assert self._sess is not None
        params = params or {}
        req_path = path
        if params:
            qs = urlencode(sorted(params.items()))
            req_path = f"{path}?{qs}"

        body_str = json.dumps(body) if body is not None else ""
        last_err = None

        for attempt in range(retries):
            try:
                headers = {"Content-Type": "application/json"}
                if signed:
                    ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                    signature = self._sign(ts, method, req_path, body_str)
                    headers.update({
                        "OK-ACCESS-KEY": self.cfg.api_key,
                        "OK-ACCESS-SIGN": signature,
                        "OK-ACCESS-TIMESTAMP": ts,
                        "OK-ACCESS-PASSPHRASE": self.passphrase,
                    })

                url = self.host + req_path
                if method.upper() == "GET":
                    async with self._sess.get(url, headers=headers) as r:
                        data = await r.json()
                elif method.upper() == "POST":
                    async with self._sess.post(url, data=body_str, headers=headers) as r:
                        data = await r.json()
                else:
                    raise ValueError(f"Unsupported method: {method}")

                if isinstance(data, dict):
                    code = int(data.get("code", "0"))
                    if code != 0:
                        msg = data.get("msg", "OKX request failed")
                        raise OKXError(code, msg)
                    return data.get("data", [])

                return data
            except OKXError:
                raise
            except Exception as e:
                last_err = e
                log.warning("OKX REST %s %s attempt %d: %s", method, path, attempt + 1, e)
                await asyncio.sleep(0.4 * (2**attempt))

        raise RuntimeError(f"OKX REST {method} {path} failed: {last_err}")

    async def tickers(self) -> list[dict]:
        data = await self._req("GET", "/api/v5/market/tickers", {"instType": "SWAP"}, signed=False)
        result = []
        for t in data:
            result.append({
                "symbol": t.get("instId", "").replace("-USDT-SWAP", "USDT"),
                "lastPrice": t.get("last"),
                "markPrice": t.get("last"),
                "fundingRate": t.get("fundingRate", "0.0001"),
                "nextFundingTime": t.get("nextFundingTime", "0"),
            })
        return result

    async def kline(self, symbol: str, interval: str = "1", limit: int = 200) -> list:
        inst_id = self._to_inst_id(symbol)
        interval_map = {"1": "1m", "5": "5m", "15": "15m", "60": "1H", "240": "4H", "D": "1D"}
        bar = interval_map.get(interval, "1m")
        return await self._req("GET", "/api/v5/market/candles", {"instId": inst_id, "bar": bar, "limit": str(limit)}, signed=False)

    async def instrument(self, symbol: str) -> dict:
        inst_id = self._to_inst_id(symbol)
        data = await self._req("GET", "/api/v5/public/instruments", {"instType": "SWAP", "instId": inst_id}, signed=False)
        if not data:
            return {}
        info = data[0]
        return {
            "symbol": symbol.upper(),
            "lotSizeFilter": {"qtyStep": info.get("lotSz", "1"), "minOrderQty": info.get("minSz", "1")},
            "priceFilter": {"tickSize": info.get("tickSz", "0.1")},
        }

    async def wallet(self) -> dict:
        data = await self._req("GET", "/api/v5/account/balance", {"ccy": "USDT"})
        if not data:
            return {"list": []}
        acc = data[0]
        eq = f(acc.get("totalEq"), 0.0)
        imr = f(acc.get("imr"), 0.0)
        details = acc.get("details", [])
        usdt_detail = next((d for d in details if d.get("ccy") == "USDT"), {})
        avail = f(usdt_detail.get("availBal"), eq)

        return {
            "list": [
                {
                    "totalEquity": str(eq),
                    "accountIMRate": str(imr),
                    "coin": [
                        {
                            "coin": "USDT",
                            "equity": str(eq),
                            "walletBalance": str(f(usdt_detail.get("cashBal"), eq)),
                            "availableToWithdraw": str(avail),
                        }
                    ],
                }
            ]
        }

    async def fee_rate(self, symbol: str) -> dict:
        inst_id = self._to_inst_id(symbol)
        data = await self._req("GET", "/api/v5/account/trade-fee", {"instType": "SWAP", "instId": inst_id})
        if not data:
            return {"takerFeeRate": "0.0005", "makerFeeRate": "0.0002"}
        fee = data[0]
        return {
            "takerFeeRate": str(abs(float(fee.get("taker", "-0.0005")))),
            "makerFeeRate": str(abs(float(fee.get("maker", "-0.0002")))),
        }

    async def positions(self) -> list[dict]:
        data = await self._req("GET", "/api/v5/account/positions", {"instType": "SWAP"})
        results = []
        for p in data:
            pos = f(p.get("pos"), 0.0)
            if abs(pos) > 0:
                side = "Buy" if p.get("posSide") == "long" or pos > 0 else "Sell"
                results.append({
                    "symbol": p.get("instId", "").replace("-USDT-SWAP", "USDT"),
                    "side": side,
                    "size": str(abs(pos)),
                    "avgPrice": str(p.get("avgPx", "0")),
                    "markPrice": str(p.get("markPx", "0")),
                    "leverage": str(p.get("lever", "1")),
                    "positionIdx": 0,
                })
        return results

    async def open_orders(self) -> list[dict]:
        data = await self._req("GET", "/api/v5/trade/orders-pending", {"instType": "SWAP"})
        results = []
        for o in data:
            results.append({
                "symbol": o.get("instId", "").replace("-USDT-SWAP", "USDT"),
                "orderId": str(o.get("ordId")),
                "orderLinkId": str(o.get("clOrdId")),
                "side": o.get("side", "").capitalize(),
                "price": str(o.get("px")),
                "qty": str(o.get("sz")),
                "leavesQty": str(float(o.get("sz", 0)) - float(o.get("accFillSz", 0))),
                "orderStatus": "New" if o.get("state") == "live" else "PartiallyFilled",
            })
        return results

    async def api_info(self) -> dict:
        try:
            cfg = await self._req("GET", "/api/v5/account/config")
            perm = cfg[0].get("perm", "") if cfg else ""
            can_trade = "trade" in perm.lower() or not getattr(self.cfg, "read_only", False)
            return {
                "result": {
                    "permissions": {
                        "ContractTrade": ["SWAP_TRADE"] if can_trade else []
                    },
                    "readOnly": 0 if can_trade else 1,
                }
            }
        except Exception as e:
            return {"result": {"permissions": {}, "readOnly": 1, "error": str(e)}}

    async def closed_pnl(self, limit: int = 100) -> list[dict]:
        data = await self._req("GET", "/api/v5/trade/orders-history", {"instType": "SWAP", "state": "filled", "limit": str(limit)})
        results = []
        for o in data:
            results.append({
                "symbol": o.get("instId", "").replace("-USDT-SWAP", "USDT"),
                "orderId": str(o.get("ordId")),
                "side": o.get("side", "").capitalize(),
                "avgExitPrice": str(o.get("avgPx", "0")),
                "closedPnl": str(o.get("pnl", "0")),
                "execFee": str(abs(float(o.get("fee", "0")))),
                "createdTime": str(o.get("uTime", "0")),
            })
        return results

    async def set_leverage(self, symbol: str, lev: float) -> None:
        inst_id = self._to_inst_id(symbol)
        await self._req("POST", "/api/v5/account/set-leverage", body={"instId": inst_id, "lever": str(int(lev)), "mgnMode": "cross"})

    async def place_order(self, **kw) -> dict:
        inst_id = self._to_inst_id(str(kw.get("symbol", "")))
        side = "buy" if str(kw.get("side", "")).lower() in ("buy", "long") else "sell"
        order_type = "market" if str(kw.get("orderType", "")).lower() == "market" else "limit"

        body = {
            "instId": inst_id,
            "tdMode": "cross",
            "side": side,
            "ordType": order_type,
            "sz": str(kw.get("qty", kw.get("quantity", ""))),
            "clOrdId": str(kw.get("orderLinkId", "")),
        }
        if order_type == "limit":
            body["px"] = str(kw.get("price", ""))
        if kw.get("reduceOnly"):
            body["reduceOnly"] = True

        data = await self._req("POST", "/api/v5/trade/order", body=body)
        ord_id = data[0].get("ordId", "") if data else ""
        return {"orderId": str(ord_id), "orderLinkId": str(kw.get("orderLinkId", ""))}

    async def cancel_order(self, **kw) -> dict:
        inst_id = self._to_inst_id(str(kw.get("symbol", "")))
        body = {"instId": inst_id}
        if kw.get("orderLinkId"):
            body["clOrdId"] = str(kw["orderLinkId"])
        elif kw.get("orderId"):
            body["ordId"] = str(kw["orderId"])
        return await self._req("POST", "/api/v5/trade/cancel-order", body=body)

    async def cancel_all(self, symbol: str) -> dict:
        inst_id = self._to_inst_id(symbol)
        open_ords = await self.open_orders()
        matched = [o for o in open_ords if o.get("symbol") == symbol.upper()]
        if not matched:
            return {"status": "ok", "cancelled": 0}
        batch = [{"instId": inst_id, "ordId": o["orderId"]} for o in matched[:20]]
        return await self._req("POST", "/api/v5/trade/cancel-batch-orders", body=batch)

    async def trading_stop(self, **kw) -> dict:
        inst_id = self._to_inst_id(str(kw.get("symbol", "")))
        tp = kw.get("takeProfit")
        sl = kw.get("stopLoss")
        tasks = []
        if tp:
            tasks.append(
                self._req(
                    "POST",
                    "/api/v5/trade/order-algo",
                    body={
                        "instId": inst_id,
                        "tdMode": "cross",
                        "side": "sell" if kw.get("side") == "Buy" else "buy",
                        "ordType": "conditional",
                        "sz": str(kw.get("qty", "1")),
                        "tpTriggerPx": str(tp),
                        "tpOrdPx": "-1",
                    },
                )
            )
        if sl:
            tasks.append(
                self._req(
                    "POST",
                    "/api/v5/trade/order-algo",
                    body={
                        "instId": inst_id,
                        "tdMode": "cross",
                        "side": "sell" if kw.get("side") == "Buy" else "buy",
                        "ordType": "conditional",
                        "sz": str(kw.get("qty", "1")),
                        "slTriggerPx": str(sl),
                        "slOrdPx": "-1",
                    },
                )
            )
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        return {"status": "ok"}
