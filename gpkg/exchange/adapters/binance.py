"""Binance USDⓈ-M futures adapter.

Signing: HMAC-SHA256 over the exact query string, hex digest, passed as `signature`, with the key in
`X-MBX-APIKEY`. The query string must be byte-identical to what the signature covers, so every
request is built once through `_signed()` rather than being assembled twice.

KNOWN VENUE LIMITATIONS (surfaced rather than hidden)
-----------------------------------------------------
* `max_leverage` is NOT published in `exchangeInfo`. The authoritative per-symbol bracket lives at
  `/fapi/v1/leverageBracket`, which requires authentication. The value used here is a conservative
  provisional ceiling — safe because the risk gate caps leverage far below it (`cfg.max_leverage`),
  so this field can never authorise an exposure the risk gate would refuse.
* `closed_pnl` maps `/fapi/v1/income`, whose rows are per INCOME TYPE (REALIZED_PNL, COMMISSION,
  FUNDING_FEE...). Unlike Bybit's single closed-pnl row per close, one logical close produces
  several rows. Each row is surfaced as its own `Fill` with the type preserved in `raw['incomeType']`
  so the accounting layer can group them; nothing is silently summed into a fake single row.
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Any
from urllib.parse import urlencode

from gpkg.core.clock import now_ms
from gpkg.exchange.adapters._http import RestClient
from gpkg.exchange.base import (
    AccountSnapshot,
    Balance,
    CredentialsMissing,
    ExchangeAdapter,
    ExchangeError,
    FeeRate,
    Fill,
    Instrument,
    InstrumentUnknown,
    Order,
    OrderRequest,
    OrderResult,
    OrderStatus,
    OrderType,
    PermissionDenied,
    Position,
    Side,
    Ticker,
)

FAPI = "https://fapi.binance.com"
SAPI = "https://api.binance.com"

# Provisional only — see the module docstring. Never treated as authoritative.
_PROVISIONAL_MAX_LEVERAGE = 20.0

_STATUS = {
    "NEW": OrderStatus.OPEN,
    "PARTIALLY_FILLED": OrderStatus.PARTIALLY_FILLED,
    "FILLED": OrderStatus.FILLED,
    "CANCELED": OrderStatus.CANCELLED,
    "REJECTED": OrderStatus.REJECTED,
    "EXPIRED": OrderStatus.CANCELLED,
}


class BinanceAdapter(ExchangeAdapter):
    name = "binance"

    def __init__(self, api_key: str = "", api_secret: str = "", allow_trade: bool = False,
                 rest: RestClient | None = None, sapi: RestClient | None = None):
        self.api_key = api_key
        self.api_secret = api_secret
        self.allow_trade = allow_trade
        self.rest = rest or RestClient(self.name, FAPI)
        self.sapi = sapi or RestClient(self.name, SAPI)
        self._cache: dict[str, Instrument] = {}

    async def start(self) -> None:
        await self.rest.start()
        await self.sapi.start()

    async def stop(self) -> None:
        await self.rest.stop()
        await self.sapi.stop()

    # -- signing ---------------------------------------------------------------------
    def _headers(self) -> dict:
        if not self.api_key:
            raise CredentialsMissing(self.name, "no Binance API key configured")
        return {"X-MBX-APIKEY": self.api_key}

    def _signed_params(self, params: dict) -> dict:
        if not self.api_secret:
            raise CredentialsMissing(self.name, "no Binance API secret configured")
        p = dict(params)
        p["timestamp"] = str(now_ms())
        p["recvWindow"] = "5000"
        # Sign the EXACT string that is sent. Building it twice is how signature mismatches happen.
        query = urlencode(sorted((k, v) for k, v in p.items() if v is not None))
        sig = hmac.new(self.api_secret.encode(), query.encode(), hashlib.sha256).hexdigest()
        p["signature"] = sig
        return p

    async def _get(self, path: str, params: dict | None = None, signed: bool = True,
                   host: RestClient | None = None) -> dict:
        client = host or self.rest
        p = self._signed_params(params or {}) if signed else dict(params or {})
        hdrs = self._headers() if signed else None
        try:
            return await client.request("GET", path, params=p, headers=hdrs)
        except PermissionDenied:
            raise
        except ExchangeError as e:
            # Binance reports authorisation faults in the body with a negative code, so a 400 with
            # -2015 is a permission problem rather than a malformed request.
            if e.code is None and "-2015" in str(e):
                raise PermissionDenied(self.name, str(e)) from e
            raise

    # -- discovery -------------------------------------------------------------------
    async def instruments(self) -> list[Instrument]:
        d = await self.rest.request("GET", "/fapi/v1/exchangeInfo")
        return [i for i in (self._parse(it) for it in d.get("symbols", [])) if i is not None]

    async def instrument(self, symbol: str) -> Instrument:
        if symbol in self._cache:
            return self._cache[symbol]
        d = await self.rest.request("GET", "/fapi/v1/exchangeInfo")
        for it in d.get("symbols", []):
            if it.get("symbol") == symbol:
                parsed = self._parse(it)
                if parsed is None:
                    raise InstrumentUnknown(self.name, f"unparseable filters for {symbol}")
                self._cache[symbol] = parsed
                return parsed
        raise InstrumentUnknown(self.name, f"{symbol} is not listed")

    def _parse(self, it: dict) -> Instrument | None:
        try:
            filters = {f.get("filterType"): f for f in (it.get("filters") or [])}
            lot = filters.get("LOT_SIZE") or filters.get("MARKET_LOT_SIZE") or {}
            price = filters.get("PRICE_FILTER") or {}
            sym = it.get("symbol") or ""
            if not sym:
                return None
            contract = it.get("contractType", "PERPETUAL")
            # Dated futures share base/quote with the perpetual (BTCUSDT, BTCUSDT_261225), so the
            # unified key is disambiguated for non-perpetuals. Without this the three contracts
            # collapse into one market and venue selection can pick a quarterly by accident.
            unified = f"{it.get('baseAsset','')}/{it.get('quoteAsset','')}"
            if contract.upper() not in Instrument._PERPETUAL_TYPES:
                suffix = sym.split("_")[-1] if "_" in sym else contract
                unified = f"{unified}:{suffix}"
            return Instrument(
                exchange=self.name,
                symbol=sym,
                unified=unified,
                base=it.get("baseAsset", ""),
                quote=it.get("quoteAsset", ""),
                qty_step=str(lot.get("stepSize", "")),
                min_qty=str(lot.get("minQty", "")),
                tick_size=str(price.get("tickSize", "")),
                max_leverage=_PROVISIONAL_MAX_LEVERAGE,
                contract_type=it.get("contractType", "PERPETUAL"),
                status=it.get("status", ""),
                raw=it,
            )
        except Exception:
            return None

    async def ticker(self, symbol: str) -> Ticker:
        b = await self.rest.request("GET", "/fapi/v1/ticker/bookTicker", params={"symbol": symbol})
        try:
            prem = await self.rest.request("GET", "/fapi/v1/premiumIndex", params={"symbol": symbol})
        except ExchangeError:
            prem = {}
        return Ticker(
            exchange=self.name,
            symbol=symbol,
            last=float(prem.get("markPrice") or b.get("bidPrice") or 0.0),
            bid=float(b.get("bidPrice") or 0.0),
            ask=float(b.get("askPrice") or 0.0),
            funding_rate=float(prem.get("lastFundingRate") or 0.0),
            next_funding_ms=int(prem.get("nextFundingTime") or 0),
        )

    async def fee_rate(self, symbol: str) -> FeeRate:
        d = await self._get("/fapi/v1/commissionRate", {"symbol": symbol})
        return FeeRate(self.name, symbol,
                       taker_bps=float(d.get("takerCommissionRate") or 0.0) * 1e4,
                       maker_bps=float(d.get("makerCommissionRate") or 0.0) * 1e4)

    # -- account ---------------------------------------------------------------------
    async def account(self) -> AccountSnapshot:
        snap = AccountSnapshot(exchange=self.name)
        try:
            d = await self._get("/fapi/v2/account", {})
        except Exception as e:
            snap.permission_error = str(e)
            return snap
        snap.read_ok = True
        snap.equity_usd = float(d.get("totalMarginBalance") or 0.0)
        snap.available_usd = float(d.get("availableBalance") or 0.0)
        snap.balances = [
            Balance(self.name, a.get("asset", ""),
                    float(a.get("availableBalance") or 0.0),
                    float(a.get("walletBalance") or 0.0) - float(a.get("availableBalance") or 0.0),
                    float(a.get("walletBalance") or 0.0),
                    raw=a)
            for a in (d.get("assets") or [])
        ]
        ok, reason = await self.trade_permission()
        snap.trade_permission_ok = ok
        snap.permission_error = "" if ok else reason
        return snap

    async def positions(self) -> list[Position]:
        rows = await self._get("/fapi/v2/positionRisk", {})
        out: list[Position] = []
        response_rows: list[dict[str, Any]] = rows if isinstance(rows, list) else []
        for p in response_rows:
            amt = float(p.get("positionAmt") or 0.0)
            if amt == 0:
                continue
            out.append(Position(
                exchange=self.name,
                symbol=p.get("symbol", ""),
                side=Side.BUY if amt > 0 else Side.SELL,
                qty=abs(amt),
                entry_price=float(p.get("entryPrice") or 0.0),
                mark_price=float(p.get("markPrice") or 0.0),
                leverage=float(p.get("leverage") or 0.0),
                unrealized_pnl=float(p.get("unRealizedProfit") or 0.0),
                liquidation_price=float(p.get("liquidationPrice") or 0.0),
                raw=p,
            ))
        return out

    async def open_orders(self) -> list[Order]:
        rows = await self._get("/fapi/v1/openOrders", {})
        out: list[Order] = []
        response_rows: list[dict[str, Any]] = rows if isinstance(rows, list) else []
        for o in response_rows:
            out.append(Order(
                exchange=self.name,
                symbol=o.get("symbol", ""),
                order_id=str(o.get("orderId", "")),
                client_order_id=o.get("clientOrderId") or None,
                side=Side.BUY if o.get("side") == "BUY" else Side.SELL,
                qty=float(o.get("origQty") or 0.0),
                price=float(o.get("price") or 0.0),
                status=_STATUS.get(o.get("status", ""), OrderStatus.UNKNOWN),
                reduce_only=bool(o.get("reduceOnly")),
                raw=o,
            ))
        return out

    async def closed_pnl(self, limit: int = 100) -> list[Fill]:
        rows = await self._get("/fapi/v1/income", {"limit": limit})
        out: list[Fill] = []
        response_rows: list[dict[str, Any]] = rows if isinstance(rows, list) else []
        for r in response_rows:
            amt = float(r.get("income") or 0.0)
            kind = r.get("incomeType", "")
            out.append(Fill(
                exchange=self.name,
                symbol=r.get("symbol", ""),
                order_id=str(r.get("tranId", "")),
                side=Side.BUY,  # income rows carry no side; preserved in `raw` for the accountant
                qty=0.0,
                price=0.0,
                closed_pnl=amt if kind == "REALIZED_PNL" else 0.0,
                fees=abs(amt) if kind == "COMMISSION" else 0.0,
                funding=amt if kind == "FUNDING_FEE" else 0.0,
                ts_ms=int(r.get("time") or 0),
                raw=r,
            ))
        return out

    # -- permissions -----------------------------------------------------------------
    async def trade_permission(self) -> tuple[bool, str]:
        """POSITIVE check via `/sapi/v1/account/apiRestrictions`.

        This is the only Binance endpoint that states futures and withdrawal capability outright.
        Anything short of `enableFutures == true` is a denial, and `enableWithdrawals == true` is a
        refusal regardless of trading rights — a trading key must never be able to withdraw.
        """
        if not self.api_key or not self.api_secret:
            return False, "no Binance credentials configured"
        if not self.allow_trade:
            return False, "credential is not marked allow_trade, so it may only read"
        try:
            d = await self._get("/sapi/v1/account/apiRestrictions", {}, host=self.sapi)
        except Exception as e:
            return False, f"cannot verify Binance futures permission: {e}"
        if not d.get("enableFutures"):
            return False, "API key does not have futures enabled"
        if d.get("enableWithdrawals"):
            return False, "API key can withdraw; refusing to use a withdrawal-enabled key for trading"
        return True, ""

    # -- mutation --------------------------------------------------------------------
    async def set_leverage(self, symbol: str, leverage: float) -> None:
        p = self._signed_params({"symbol": symbol, "leverage": int(leverage)})
        await self.rest.request("POST", "/fapi/v1/leverage", params=p, headers=self._headers(),
                                idempotent=True)

    async def place_order(self, req: OrderRequest) -> OrderResult:
        req.validate()
        params: dict[str, str] = {
            "symbol": req.symbol,
            "side": req.side.value.upper(),
            "type": req.order_type.value.upper(),
            "quantity": req.qty,
        }
        if req.client_order_id:
            params["newClientOrderId"] = req.client_order_id
        if req.order_type is OrderType.LIMIT:
            if req.price is None:
                raise ValueError("LIMIT order requires a price")
            params["price"] = req.price
            params["timeInForce"] = "GTC"
        if req.reduce_only:
            params["reduceOnly"] = "true"
        p = self._signed_params(params)
        # Idempotent ONLY when a client order id is present: Binance rejects a duplicate
        # newClientOrderId, so a replay is safe and detectable.
        try:
            r = await self.rest.request("POST", "/fapi/v1/order", params=p,
                                        headers=self._headers(),
                                        idempotent=bool(req.client_order_id))
        except PermissionDenied:
            raise
        except ExchangeError as e:
            if req.client_order_id and "-2022" in str(e):
                return OrderResult(self.name, req.symbol, order_id="",
                                   client_order_id=req.client_order_id,
                                   status=OrderStatus.UNKNOWN, duplicate=True)
            raise
        return OrderResult(
            self.name, req.symbol,
            order_id=str(r.get("orderId", "")),
            client_order_id=r.get("clientOrderId") or req.client_order_id,
            status=_STATUS.get(r.get("status", ""), OrderStatus.OPEN),
            filled_qty=float(r.get("executedQty") or 0.0),
            avg_price=float(r.get("avgPrice") or 0.0),
        )

    async def cancel_order(self, symbol: str, order_id: str) -> None:
        p = self._signed_params({"symbol": symbol, "orderId": order_id})
        await self.rest.request("DELETE", "/fapi/v1/order", params=p, headers=self._headers())

    async def cancel_all(self, symbol: str) -> None:
        p = self._signed_params({"symbol": symbol})
        await self.rest.request("DELETE", "/fapi/v1/allOpenOrders", params=p,
                                headers=self._headers())

    async def set_protection(self, symbol: str, side: Side, qty: str,
                             take_profit: str | None, stop_loss: str | None) -> None:
        """Binance has no position-level TP/SL, so protection is placed as reduce-only triggers.

        `closePosition=true` makes each trigger flatten the whole position, which is the closest
        equivalent to Bybit's position-level tpslMode=Full. Both legs are STOP_MARKET/TAKE_PROFIT_MARKET
        so they survive price gaps that a LIMIT-based exit would miss.
        """
        if not take_profit and not stop_loss:
            return
        closing = "SELL" if side is Side.BUY else "BUY"
        for trigger, kind in ((stop_loss, "STOP_MARKET"), (take_profit, "TAKE_PROFIT_MARKET")):
            if not trigger:
                continue
            params = {
                "symbol": symbol,
                "side": closing,
                "type": kind,
                "stopPrice": trigger,
                "closePosition": "true",
                "workingType": "MARK_PRICE",
            }
            p = self._signed_params(params)
            await self.rest.request("POST", "/fapi/v1/order", params=p, headers=self._headers())
