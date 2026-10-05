"""Bybit v5 linear-perpetual adapter.

Wraps the existing, already-verified `BybitREST` client (HMAC-SHA256, retCode handling, backoff) and
translates its raw v5 shapes into the unified model. Keeping the transport untouched means the venue
behaviour the engine already relies on — including the duplicate-order-link handling — is preserved
exactly.

Symbol convention: Bybit uses the same `BTCUSDT` form as the unified base/quote concatenation, so
`unified` is derived rather than mapped. This is NOT true of KuCoin (`XBTUSDTM`), which is why the
mapping lives in the adapter rather than in a shared helper.
"""
from __future__ import annotations

from typing import Optional

from gpkg.core.config import Config
from gpkg.core.errors import BybitError
from gpkg.exchange.base import (
    AccountSnapshot,
    Balance,
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
from gpkg.exchange.bybit_rest import BybitREST

# Bybit order status -> unified. Anything unrecognised becomes UNKNOWN rather than being coerced to
# a happy value; the reconciler treats UNKNOWN as "do not assume".
_STATUS = {
    "New": OrderStatus.OPEN,
    "PartiallyFilled": OrderStatus.PARTIALLY_FILLED,
    "Untriggered": OrderStatus.OPEN,
    "Filled": OrderStatus.FILLED,
    "Cancelled": OrderStatus.CANCELLED,
    "PartiallyFilledCanceled": OrderStatus.CANCELLED,
    "Rejected": OrderStatus.REJECTED,
    "Deactivated": OrderStatus.CANCELLED,
}


def _unified(symbol: str, quote: str = "USDT") -> str:
    if symbol.endswith(quote):
        return f"{symbol[:-len(quote)]}/{quote}"
    return symbol


class BybitAdapter(ExchangeAdapter):
    name = "bybit"

    def __init__(self, cfg: Config, rest: Optional[BybitREST] = None, metrics=None):
        self.cfg = cfg
        self.rest = rest or BybitREST(cfg, metrics=metrics)
        self._cache: dict[str, Instrument] = {}

    async def start(self) -> None:
        await self.rest.start()

    async def stop(self) -> None:
        await self.rest.stop()

    # -- discovery -------------------------------------------------------------------
    async def instruments(self) -> list[Instrument]:
        r = await self.rest._req(
            "GET", "/v5/market/instruments-info", {"category": "linear", "limit": 1000}, signed=False
        )
        out: list[Instrument] = []
        for it in r.get("list", []):
            parsed = self._parse_instrument(it)
            if parsed:
                out.append(parsed)
        return out

    async def instrument(self, symbol: str) -> Instrument:
        if symbol in self._cache:
            return self._cache[symbol]
        it = await self.rest.instrument(symbol)
        parsed = self._parse_instrument(it)
        if parsed is None:
            raise InstrumentUnknown(self.name, f"cannot determine spec for {symbol!r}: {it!r}")
        self._cache[symbol] = parsed
        return parsed

    def _parse_instrument(self, it: dict) -> Optional[Instrument]:
        try:
            lot = it.get("lotSizeFilter") or {}
            pr = it.get("priceFilter") or {}
            lev = it.get("leverageFilter") or {}
            sym = it.get("symbol") or ""
            if not sym:
                return None
            return Instrument(
                exchange=self.name,
                symbol=sym,
                unified=_unified(sym),
                base=it.get("baseCoin", ""),
                quote=it.get("quoteCoin", "USDT"),
                qty_step=str(lot.get("qtyStep", "")),
                min_qty=str(lot.get("minOrderQty", "")),
                tick_size=str(pr.get("tickSize", "")),
                max_leverage=float(lev.get("maxLeverage") or 1.0),
                contract_type=it.get("contractType", "LinearPerpetual"),
                status=it.get("status", ""),
                raw=it,
            )
        except Exception:
            # A malformed row is skipped, not guessed at. `tradeable()` will also reject it.
            return None

    async def ticker(self, symbol: str) -> Ticker:
        for t in await self.rest.tickers():
            if t.get("symbol") == symbol:
                return Ticker(
                    exchange=self.name,
                    symbol=symbol,
                    last=float(t.get("lastPrice") or 0.0),
                    bid=float(t.get("bid1Price") or 0.0),
                    ask=float(t.get("ask1Price") or 0.0),
                    funding_rate=float(t.get("fundingRate") or 0.0),
                    next_funding_ms=int(t.get("nextFundingTime") or 0),
                )
        raise ExchangeError(self.name, f"no ticker for {symbol}")

    async def fee_rate(self, symbol: str) -> FeeRate:
        r = await self.rest.fee_rate(symbol)
        return FeeRate(self.name, symbol,
                       taker_bps=float(r.get("takerFeeRate") or 0.0) * 1e4,
                       maker_bps=float(r.get("makerFeeRate") or 0.0) * 1e4)

    # -- account ---------------------------------------------------------------------
    async def account(self) -> AccountSnapshot:
        snap = AccountSnapshot(exchange=self.name)
        try:
            w = await self.rest.wallet()
        except Exception as e:
            snap.permission_error = str(e)
            return snap  # read_ok stays False -> unusable for autonomous routing
        lst = w.get("list") or []
        if not lst:
            snap.permission_error = "wallet-balance returned no account rows"
            return snap
        acct = lst[0]
        snap.read_ok = True
        snap.balances = [
            Balance(self.name, c.get("coin", ""),
                    float(c.get("availableToWithdraw") or 0.0),
                    float(c.get("locked") or 0.0),
                    float(c.get("walletBalance") or 0.0),
                    raw=c)
            for c in (acct.get("coin") or [])
        ]
        snap.equity_usd = float(acct.get("totalEquity") or 0.0)
        snap.available_usd = sum(b.free for b in snap.balances if b.asset == "USDT")
        ok, reason = await self.trade_permission()
        snap.trade_permission_ok = ok
        snap.permission_error = "" if ok else reason
        return snap

    async def positions(self) -> list[Position]:
        out: list[Position] = []
        for p in await self.rest.positions():
            size = float(p.get("size") or 0.0)
            if size <= 0:
                continue
            out.append(Position(
                exchange=self.name,
                symbol=p.get("symbol", ""),
                side=Side.BUY if p.get("side") == "Buy" else Side.SELL,
                qty=size,
                entry_price=float(p.get("avgPrice") or 0.0),
                mark_price=float(p.get("markPrice") or 0.0),
                leverage=float(p.get("leverage") or 0.0),
                unrealized_pnl=float(p.get("unrealisedPnl") or 0.0),
                liquidation_price=float(p.get("liqPrice") or 0.0),
                position_idx=int(p.get("positionIdx") or 0),
                raw=p,
            ))
        return out

    async def open_orders(self) -> list[Order]:
        out: list[Order] = []
        for o in await self.rest.open_orders():
            out.append(Order(
                exchange=self.name,
                symbol=o.get("symbol", ""),
                order_id=o.get("orderId", ""),
                client_order_id=o.get("orderLinkId") or None,
                side=Side.BUY if o.get("side") == "Buy" else Side.SELL,
                qty=float(o.get("qty") or 0.0),
                price=float(o.get("price") or 0.0),
                status=_STATUS.get(o.get("orderStatus", ""), OrderStatus.UNKNOWN),
                reduce_only=bool(o.get("reduceOnly")),
                raw=o,
            ))
        return out

    async def closed_pnl(self, limit: int = 100) -> list[Fill]:
        out: list[Fill] = []
        for c in await self.rest.closed_pnl(limit=limit):
            # Closed-PnL now exposes full round-trip open/close fees. Preserve both costs through
            # the unified Fill instead of falling back to a per-execution fee and understating
            # realised trading cost.
            open_fee = float(c.get("openFee") or c.get("cumEntryFee") or 0.0)
            close_fee = float(c.get("closeFee") or c.get("cumExitFee") or 0.0)
            fee = open_fee + close_fee
            if fee == 0.0:
                fee = float(c.get("execFee") or 0.0)
            out.append(Fill(
                exchange=self.name,
                symbol=c.get("symbol", ""),
                order_id=c.get("orderId", ""),
                side=Side.BUY if c.get("side") == "Buy" else Side.SELL,
                qty=float(c.get("qty") or 0.0),
                price=float(c.get("avgExitPrice") or 0.0),
                closed_pnl=float(c.get("closedPnl") or 0.0),
                fees=fee,
                ts_ms=int(c.get("createdTime") or 0),
                raw=c,
            ))
        return out

    # -- permissions -----------------------------------------------------------------
    async def trade_permission(self) -> tuple[bool, str]:
        """Positive authorization check; withdrawal-capable keys are always rejected.

        Authentication is not authorization, and trading authorization is not sufficient if the same
        key can withdraw funds. This process therefore requires ContractTrade Order permission and
        explicitly rejects any withdrawal capability. Unknown permission shapes fail closed.
        """
        try:
            info = await self.rest.api_info()
        except BybitError as e:
            return False, f"permission probe failed: {e}"
        except Exception as e:
            return False, f"permission probe failed: {e}"
        if int(info.get("readOnly") or 0) == 1:
            return False, "API key is read-only"

        perms = info.get("permissions") or {}
        for group_name, values in perms.items():
            if isinstance(values, dict):
                normalized = {str(v).strip().lower() for v in values.keys()}
                if any("withdraw" in v for v in normalized):
                    return False, f"API key has withdrawal permission in {group_name}; refusing live execution"
            if isinstance(values, (list, tuple, set)):
                normalized = {str(v).strip().lower() for v in values}
                if any("withdraw" in v for v in normalized):
                    return False, f"API key has withdrawal permission in {group_name}; refusing live execution"
            elif isinstance(values, str) and "withdraw" in values.lower():
                return False, f"API key has withdrawal permission in {group_name}; refusing live execution"

        contract = perms.get("ContractTrade") or []
        if "Order" not in contract:
            return False, "API key lacks the ContractTrade permission; it cannot place futures orders"
        return True, ""

    # -- mutation --------------------------------------------------------------------
    async def set_leverage(self, symbol: str, leverage: float) -> None:
        await self.rest.set_leverage(symbol, leverage)

    async def place_order(self, req: OrderRequest) -> OrderResult:
        req.validate()
        body = {
            "category": "linear",
            "symbol": req.symbol,
            "side": req.side.value,
            "orderType": req.order_type.value,
            "qty": req.qty,
            "positionIdx": req.position_idx,
        }
        if req.client_order_id:
            body["orderLinkId"] = req.client_order_id
        if req.order_type is OrderType.LIMIT:
            body["price"] = req.price
            body["timeInForce"] = "GTC"
        if req.reduce_only:
            body["reduceOnly"] = True
        try:
            r = await self.rest.place_order(**body)
        except BybitError as e:
            # 110072: orderLinkId already exists -> the venue deduplicated our retry. Report it as a
            # duplicate instead of an error so the caller does not treat a successful placement as a
            # failure and re-issue it.
            if e.code == 110072:
                return OrderResult(self.name, req.symbol, order_id="",
                                   client_order_id=req.client_order_id,
                                   status=OrderStatus.UNKNOWN, duplicate=True)
            raise PermissionDenied(self.name, str(e), code=str(e.code)) if e.code in (10005, 10010) else ExchangeError(
                self.name, str(e), code=str(e.code)
            ) from e
        return OrderResult(
            self.name, req.symbol,
            order_id=r.get("orderId", ""),
            client_order_id=r.get("orderLinkId") or req.client_order_id,
            status=OrderStatus.OPEN,
        )

    async def cancel_order(self, symbol: str, order_id: str) -> None:
        await self.rest.cancel_order(category="linear", symbol=symbol, orderId=order_id)

    async def cancel_all(self, symbol: str) -> None:
        await self.rest.cancel_all(symbol)

    async def set_protection(self, symbol: str, side: Side, qty: str,
                             take_profit: Optional[str], stop_loss: Optional[str]) -> None:
        """Position-level native TP/SL — it lives on the venue, so it survives this process dying."""
        body = {
            "category": "linear",
            "symbol": symbol,
            "tpslMode": "Full",
            "positionIdx": 0,
        }
        if take_profit:
            body["takeProfit"] = take_profit
        if stop_loss:
            body["stopLoss"] = stop_loss
        await self.rest.trading_stop(**body)
