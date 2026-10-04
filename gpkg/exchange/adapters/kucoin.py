"""KuCoin Futures adapter.

Three things make this venue different from Bybit and Binance, and each one is a place where a
careless adapter silently mis-trades:

1. A PASSPHRASE is part of the credential and of the signature. Version-2 keys sign the passphrase
   itself: `KC-API-PASSPHRASE = base64(HMAC-SHA256(secret, passphrase))`.

2. Quantities are in CONTRACTS, not base units. A contract carries a `multiplier` (e.g. 0.001 BTC),
   so one contract is NOT one BTC. The unified `qty_step`/`min_qty` are therefore expressed in
   contracts, and the executor's sizing stays in the venue's own unit — which is the only unit the
   venue accepts. Converting to base units anywhere else would mis-size every order by `multiplier`.

3. The SYMBOL ALPHABET DIFFERS. KuCoin writes Bitcoin as `XBT`, so the perpetual is `XBTUSDTM`
   (the trailing `M` marks a multiplier contract). This adapter owns that mapping in both directions.

Response envelope: KuCoin returns HTTP 200 for almost everything and puts the real outcome in a
string `code`. Treating a 200 as success without checking `code` is the single most common way to
read an error as data, so `_data()` is the only path to a response body here.

UNVERIFIED SURFACES (stated, not hidden): without a live KuCoin credential the signed methods below
cannot be exercised against the venue. `set_leverage` deliberately RAISES rather than pretending to
succeed — KuCoin governs leverage through risk-limit level and margin mode, and reporting a
leverage change that did not happen would let the arm-time read-back verification pass on a value
the venue never accepted. Because it raises, the preflight refuses to arm KuCoin until this is
implemented and verified against a real account. That is the intended, fail-closed outcome.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from typing import Optional

from gpkg.core.clock import now_ms
from gpkg.exchange.adapters._http import RestClient, qs
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
    MarginMode,
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

FUTURES = "https://api-futures.kucoin.com"
OK_CODE = "200000"

# KuCoin's symbol alphabet. XBT is Bitcoin; the mapping must be reversible for order routing.
_ALIAS = {"XBT": "BTC"}
_ALIAS_REVERSE = {v: k for k, v in _ALIAS.items()}

_STATUS = {
    "open": OrderStatus.OPEN,
    "done": OrderStatus.FILLED,
    "match": OrderStatus.PARTIALLY_FILLED,
    "canceled": OrderStatus.CANCELLED,
}


class KucoinAdapter(ExchangeAdapter):
    name = "kucoin"

    def __init__(self, api_key: str = "", api_secret: str = "", passphrase: str = "",
                 allow_trade: bool = False, rest: Optional[RestClient] = None):
        self.api_key = api_key
        self.api_secret = api_secret
        self.passphrase = passphrase
        self.allow_trade = allow_trade
        self.rest = rest or RestClient(self.name, FUTURES)
        self._cache: dict[str, Instrument] = {}

    async def start(self) -> None:
        await self.rest.start()

    async def stop(self) -> None:
        await self.rest.stop()

    # -- signing ---------------------------------------------------------------------
    def _headers(self, method: str, path: str, body: str = "") -> dict:
        if not self.api_key or not self.api_secret or not self.passphrase:
            raise CredentialsMissing(
                self.name, "KuCoin requires api_key, api_secret AND passphrase"
            )
        ts = str(now_ms())
        msg = f"{ts}{method.upper()}{path}{body}"
        sign = base64.b64encode(
            hmac.new(self.api_secret.encode(), msg.encode(), hashlib.sha256).digest()
        ).decode()
        # v2 keys sign the passphrase; v1 keys sent it in the clear. v2 is assumed and stated.
        signed_pass = base64.b64encode(
            hmac.new(self.api_secret.encode(), self.passphrase.encode(), hashlib.sha256).digest()
        ).decode()
        return {
            "KC-API-KEY": self.api_key,
            "KC-API-SIGN": sign,
            "KC-API-TIMESTAMP": ts,
            "KC-API-PASSPHRASE": signed_pass,
            "KC-API-KEY-VERSION": "2",
        }

    def _data(self, resp: dict, what: str) -> object:
        """The ONLY way to read a KuCoin body. A 200 with a non-200000 code is an error."""
        if not isinstance(resp, dict):
            raise ExchangeError(self.name, f"{what}: unexpected response type {type(resp).__name__}")
        code = str(resp.get("code", ""))
        if code and code != OK_CODE:
            msg = f"{what}: KuCoin code {code}: {resp.get('msg') or resp.get('message') or ''}"
            if code in ("400003", "400004", "401000"):
                raise PermissionDenied(self.name, msg)
            raise ExchangeError(self.name, msg, code=code)
        return resp.get("data")

    async def _signed(self, method: str, path: str, params: Optional[dict] = None,
                      body: Optional[dict] = None, idempotent: bool = True):
        import json as _json
        body_str = _json.dumps(body, separators=(",", ":")) if body else ""
        headers = self._headers(method, path, body_str)
        return await self.rest.request(method, path, params=params or {}, body=body or None,
                                       headers=headers, idempotent=idempotent)

    # -- discovery -------------------------------------------------------------------
    async def instruments(self) -> list[Instrument]:
        d = self._data(await self.rest.request("GET", "/api/v1/contracts/active"), "contracts")
        return [i for i in (self._parse(it) for it in (d or [])) if i is not None]

    async def instrument(self, symbol: str) -> Instrument:
        if symbol in self._cache:
            return self._cache[symbol]
        d = self._data(await self.rest.request("GET", "/api/v1/contracts/active"), "contracts")
        for it in (d or []):
            if it.get("symbol") == symbol:
                parsed = self._parse(it)
                if parsed is None:
                    raise InstrumentUnknown(self.name, f"unparseable contract {symbol}")
                self._cache[symbol] = parsed
                return parsed
        raise InstrumentUnknown(self.name, f"{symbol} is not listed")

    def _parse(self, it: dict) -> Optional[Instrument]:
        try:
            sym = it.get("symbol") or ""
            base_raw = it.get("baseCurrency") or ""
            quote = it.get("quoteCurrency") or "USDT"
            if not sym or not base_raw:
                return None
            initial_margin = float(it.get("initialMargin") or 0.0)
            # KuCoin publishes margin requirements, not a leverage number; 1/initialMargin is the
            # maximum. Guarded so a missing value cannot become an infinite ceiling.
            max_lev = (1.0 / initial_margin) if initial_margin > 0 else 1.0
            lot = str(it.get("lotSize") or "1")
            return Instrument(
                exchange=self.name,
                symbol=sym,
                unified=f"{_ALIAS.get(base_raw, base_raw)}/{quote}",
                base=base_raw,
                quote=quote,
                # Quantities are CONTRACTS on this venue; lotSize is both the step and the minimum.
                qty_step=lot,
                min_qty=lot,
                tick_size=str(it.get("tickSize") or ""),
                max_leverage=max_lev,
                contract_type="PERPETUAL",
                status=it.get("status", ""),
                raw=it,
            )
        except Exception:
            return None

    def unified_to_native(self, unified: str) -> Optional[str]:
        """`BTC/USDT` -> `XBTUSDTM`. Exposed because callers must not guess the mapping."""
        if "/" not in unified:
            return None
        base, quote = unified.split("/", 1)
        return f"{_ALIAS_REVERSE.get(base, base)}{quote}M"

    async def ticker(self, symbol: str) -> Ticker:
        d = self._data(await self.rest.request("GET", "/api/v1/ticker", params={"symbol": symbol}),
                       f"ticker {symbol}") or {}
        try:
            f = self._data(await self.rest.request(
                "GET", f"/api/v1/funding-rate/{symbol}/current"), "funding") or {}
        except ExchangeError:
            f = {}
        return Ticker(
            exchange=self.name,
            symbol=symbol,
            last=float(d.get("price") or 0.0),
            bid=float(d.get("bestBidPrice") or 0.0),
            ask=float(d.get("bestAskPrice") or 0.0),
            funding_rate=float(f.get("value") or f.get("fundingRate") or 0.0),
            next_funding_ms=int(f.get("timePoint") or 0),
        )

    async def fee_rate(self, symbol: str) -> FeeRate:
        inst = await self.instrument(symbol)
        raw = inst.raw or {}
        return FeeRate(self.name, symbol,
                       taker_bps=float(raw.get("takerFeeRate") or 0.0) * 1e4,
                       maker_bps=float(raw.get("makerFeeRate") or 0.0) * 1e4)

    # -- account ---------------------------------------------------------------------
    async def account(self) -> AccountSnapshot:
        snap = AccountSnapshot(exchange=self.name)
        try:
            d = self._data(await self._signed("GET", "/api/v1/account-overview",
                                              {"currency": "USDT"}), "account") or {}
        except Exception as e:
            snap.permission_error = str(e)
            return snap
        snap.read_ok = True
        snap.equity_usd = float(d.get("accountEquity") or 0.0)
        snap.available_usd = float(d.get("availableBalance") or 0.0)
        snap.balances = [Balance(self.name, "USDT", snap.available_usd,
                                 float(d.get("orderMargin") or 0.0)
                                 + float(d.get("positionMargin") or 0.0),
                                 snap.equity_usd, raw=d)]
        ok, reason = await self.trade_permission()
        snap.trade_permission_ok = ok
        snap.permission_error = "" if ok else reason
        return snap

    async def positions(self) -> list[Position]:
        d = self._data(await self._signed("GET", "/api/v1/positions"), "positions") or []
        out: list[Position] = []
        for p in d:
            qty = float(p.get("currentQty") or 0.0)
            if qty == 0:
                continue
            out.append(Position(
                exchange=self.name,
                symbol=p.get("symbol", ""),
                side=Side.BUY if qty > 0 else Side.SELL,
                qty=abs(qty),
                entry_price=float(p.get("avgEntryPrice") or 0.0),
                mark_price=float(p.get("markPrice") or 0.0),
                leverage=float(p.get("leverage") or 0.0),
                unrealized_pnl=float(p.get("unrealisedPnl") or 0.0),
                liquidation_price=float(p.get("liquidationPrice") or 0.0),
                raw=p,
            ))
        return out

    async def open_orders(self) -> list[Order]:
        d = self._data(await self._signed("GET", "/api/v1/orders", {"status": "active"}),
                       "open orders") or []
        out: list[Order] = []
        for o in (d.get("items") if isinstance(d, dict) else d) or []:
            out.append(Order(
                exchange=self.name,
                symbol=o.get("symbol", ""),
                order_id=str(o.get("id", "")),
                client_order_id=o.get("clientOid") or None,
                side=Side.BUY if o.get("side") == "buy" else Side.SELL,
                qty=float(o.get("size") or 0.0),
                price=float(o.get("price") or 0.0),
                status=_STATUS.get(o.get("status", ""), OrderStatus.UNKNOWN),
                reduce_only=bool(o.get("reduceOnly")),
                raw=o,
            ))
        return out

    async def closed_pnl(self, limit: int = 100) -> list[Fill]:
        """KuCoin reports realized PnL per fill with the fee attached, closest to Bybit's shape."""
        try:
            d = self._data(await self._signed(
                "GET", "/api/v1/fills", {"pageSize": min(limit, 100)}), "fills") or []
        except ExchangeError:
            return []
        out: list[Fill] = []
        for f in (d.get("items") if isinstance(d, dict) else d) or []:
            pnl = float(f.get("realisedPnl") or 0.0)
            fee = float(f.get("fee") or 0.0)
            out.append(Fill(
                exchange=self.name,
                symbol=f.get("symbol", ""),
                order_id=str(f.get("orderId", "")),
                side=Side.BUY if (f.get("side") or "").lower() == "buy" else Side.SELL,
                qty=float(f.get("size") or 0.0),
                price=float(f.get("price") or 0.0),
                closed_pnl=pnl,
                fees=abs(fee),
                ts_ms=int(f.get("createdAt") or 0),
                raw=f,
            ))
        return out

    # -- permissions -----------------------------------------------------------------
    async def trade_permission(self) -> tuple[bool, str]:
        """Fail-closed, and HONEST about how the answer was reached.

        KuCoin exposes no documented endpoint that states "this key may trade futures". So the check
        is: (a) the operator explicitly marked the credential `allow_trade`, and (b) the key
        successfully performs an AUTHENTICATED futures read. (b) proves the key is valid and
        scoped to the futures account; it does NOT prove trade rights, so the reason string says so
        rather than implying a verification that did not happen.
        """
        if not (self.api_key and self.api_secret and self.passphrase):
            return False, "KuCoin requires api_key, api_secret and passphrase"
        if not self.allow_trade:
            return False, "credential is not marked allow_trade, so it may only read"
        try:
            await self._signed("GET", "/api/v1/account-overview", {"currency": "USDT"})
        except Exception as e:
            return False, f"KuCoin key failed an authenticated futures read: {e}"
        return True, "trade permission is OPERATOR-ASSERTED for KuCoin (no venue endpoint reports it)"

    # -- mutation --------------------------------------------------------------------
    async def set_leverage(self, symbol: str, leverage: float) -> None:
        raise ExchangeError(
            self.name,
            "set_leverage is not implemented for KuCoin: leverage there is governed by "
            "risk-limit level and margin mode, not by a direct set-leverage call. Raising rather "
            "than reporting success keeps the arm-time read-back verification honest — it will "
            "refuse to arm until this is implemented and verified against a live account.",
            retryable=False,
        )

    async def place_order(self, req: OrderRequest) -> OrderResult:
        req.validate()
        # `leverage` is deliberately omitted: KuCoin derives it from the position's margin mode and
        # risk-limit level, and sending a value here without having verified the venue accepted it
        # would let an order carry a leverage the risk gate never approved.
        body = {
            "symbol": req.symbol,
            "side": "buy" if req.side is Side.BUY else "sell",
            "type": req.order_type.value.lower(),
            "size": req.qty,
        }
        if req.client_order_id:
            body["clientOid"] = req.client_order_id
        if req.order_type is OrderType.LIMIT:
            body["price"] = req.price
        if req.reduce_only:
            body["reduceOnly"] = True
        try:
            d = self._data(await self._signed("POST", "/api/v1/orders", body=body,
                                              idempotent=bool(req.client_order_id)),
                           "place order") or {}
        except ExchangeError as e:
            if req.client_order_id and ("clientOid" in str(e) or "already" in str(e).lower()):
                return OrderResult(self.name, req.symbol, order_id="",
                                   client_order_id=req.client_order_id,
                                   status=OrderStatus.UNKNOWN, duplicate=True)
            raise
        return OrderResult(
            self.name, req.symbol,
            order_id=str(d.get("orderId", "")),
            client_order_id=d.get("clientOid") or req.client_order_id,
            status=OrderStatus.OPEN,
        )

    async def cancel_order(self, symbol: str, order_id: str) -> None:
        await self._signed("DELETE", f"/api/v1/orders/{order_id}")

    async def cancel_all(self, symbol: str) -> None:
        await self._signed("DELETE", "/api/v1/orders", {"symbol": symbol})

    async def set_protection(self, symbol: str, side: Side, qty: str,
                             take_profit: Optional[str], stop_loss: Optional[str]) -> None:
        """KuCoin has no position-level TP/SL, so both legs are reduce-only stop orders."""
        if not take_profit and not stop_loss:
            return
        closing = "sell" if side is Side.BUY else "buy"
        for trigger, kind in ((stop_loss, "market"), (take_profit, "market")):
            if not trigger:
                continue
            body = {
                "symbol": symbol,
                "side": closing,
                "type": kind,
                "size": qty,
                "stop": trigger,
                "stopPriceType": "MP",
                "reduceOnly": True,
            }
            await self._signed("POST", "/api/v1/orders", body=body)
