"""Bybit v5 adapter (USDT-margined perpetual futures, `category=linear`).

Implements the SAME method surface and returns the SAME normalised dataclasses as
the Binance adapter, so strategy/risk/execution code is exchange-agnostic.

Bybit v5 differs from Binance in ways that silently corrupt data if unhandled.
Each one is called out at the point of handling:

  1. Envelope: every response is `{retCode, retMsg, result}`; HTTP 200 with a
     non-zero retCode is still a FAILURE. Treating 200 as success is the classic
     way to trade blind.
  2. Klines come back DESCENDING (newest first) as strings, 7 columns.
  3. `price24hPcnt` is a FRACTION (-0.0039 = -0.39%); Binance's equivalent is
     already a percentage. Must be scaled or every 24h change is 100x too small.
  4. Order IDs are UUID strings, not integers.
  5. instruments-info is PAGINATED (nextPageCursor); a single page silently
     truncates the universe.
  6. `fundingInterval` varies per symbol (not always 8h), and it drives the
     funding cost estimate.
  7. Signature payload is `timestamp + api_key + recv_window + (queryString|body)`,
     so the exact bytes signed must be the exact bytes sent.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
import urllib.parse
from typing import Any, Dict, List, Optional

import httpx

from .exchange import (
    Balance, DepthSnapshot, ExchangeError, OrderRequest, OrderResult, PositionRisk,
    SymbolSpec, Ticker,
)
from .logging_setup import get_logger, scrub

log = get_logger("bybit")

CATEGORY = "linear"
MAX_KLINE_LIMIT = 1000

# Interval translation. Bybit uses MINUTES as a bare integer, plus D/W/M.
_BYBIT_INTERVALS = {
    "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720",
    "1d": "D", "1w": "W",
}
_REVERSE_INTERVALS = {v: k for k, v in _BYBIT_INTERVALS.items()}

# retCodes that must never be blindly retried (auth / permission problems).
_FATAL_CODES = {-1, 10002, 10003, 10004, 10005, 10010, 33004, 33034}
# retCode 10006 = too many visits; 10016 = service temporarily unavailable.
_RETRY_CODES = {10006, 10016, 10018}


def to_native_interval(interval: str) -> str:
    """'1h' -> '60'. Already-native values pass through, so a config written in
    Bybit terms still works."""
    if interval in _BYBIT_INTERVALS:
        return _BYBIT_INTERVALS[interval]
    if interval in _REVERSE_INTERVALS:
        return interval
    return interval


def from_native_interval(native: str) -> str:
    return _REVERSE_INTERVALS.get(native, native)


class BybitClient:
    """Public market data + (when credentials exist) signed account/order access.

    A single class serves both roles because Bybit v5 puts public and private
    endpoints on the same host with the same envelope; only the headers differ.
    `require_creds=True` is used for the private role so a misconfigured live
    deployment fails at construction rather than at first order.
    """

    def __init__(self, cfg, require_creds: bool = False, client: Optional[httpx.AsyncClient] = None):
        self.cfg = cfg
        self.ex = cfg.exchange
        self.category = CATEGORY
        self._client = client
        self._own_client = client is None
        self._specs: Dict[str, SymbolSpec] = {}
        self._specs_loaded_at = 0.0
        self._time_offset_ms = 0
        if require_creds and not (self.ex.api_key and self.ex.api_secret):
            raise ExchangeError("private Bybit client requires api_key and api_secret")

    # -- lifecycle ---------------------------------------------------------
    async def __aenter__(self) -> "BybitClient":
        await self._ensure_client()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.ex.rest_url,
                timeout=httpx.Timeout(self.ex.request_timeout_s, connect=5.0),
                headers={"User-Agent": "quant-platform/1.0"},
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
        return self._client

    async def close(self) -> None:
        if self._own_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    # -- envelope / signing ------------------------------------------------
    @staticmethod
    def _unwrap(payload: Any) -> Dict[str, Any]:
        """A Bybit 200 response with retCode != 0 is a FAILURE."""
        if not isinstance(payload, dict):
            raise ExchangeError("unexpected non-object response from Bybit")
        code = int(payload.get("retCode", -1))
        if code != 0:
            raise ExchangeError(
                scrub(str(payload.get("retMsg", "unknown Bybit error"))), code=code
            )
        result = payload.get("result")
        return result if isinstance(result, dict) else {}

    def _auth_headers(self, payload: str) -> Dict[str, str]:
        ts = str(int(time.time() * 1000) + self._time_offset_ms)
        recv = str(self.ex.recv_window_ms)
        # Exact string signed == exact string sent.
        to_sign = ts + self.ex.api_key + recv + payload
        sig = hmac.new(self.ex.api_secret.encode(), to_sign.encode(), hashlib.sha256).hexdigest()
        return {
            "X-BAPI-API-KEY": self.ex.api_key,
            "X-BAPI-TIMESTAMP": ts,
            "X-BAPI-RECV-WINDOW": recv,
            "X-BAPI-SIGN": sig,
            "Content-Type": "application/json",
        }

    async def _resync_time(self) -> None:
        """Correct the local clock against Bybit after a timestamp rejection."""
        try:
            result = self._unwrap(await self._raw_get("/v5/market/time", {}))
            server_ms = int(result.get("timeSecond", "0")) * 1000
            if server_ms:
                self._time_offset_ms = server_ms - int(time.time() * 1000)
                log.warning("resynced clock with bybit", extra={"offset_ms": self._time_offset_ms})
        except Exception as exc:
            log.warning("time resync failed", extra={"error": str(exc)})

    async def _raw_get(self, path: str, params: Dict[str, Any]) -> Any:
        client = await self._ensure_client()
        resp = await client.get(path, params=params or None)
        return resp.json()

    async def _get(self, path: str, params: Optional[Dict[str, Any]] = None,
                   signed: bool = True) -> Dict[str, Any]:
        """GET with optional signing.

        `signed=True` (default) attaches the auth headers, which PRIVATE endpoints
        require — omitting them makes Bybit answer `retCode 10001 apiKey is missing`
        regardless of how correct the signature would have been. Public market-data
        calls pass `signed=False` so credentials are never sent where they are not
        needed.
        """
        client = await self._ensure_client()
        params = {k: v for k, v in (params or {}).items() if v is not None}
        qs = urllib.parse.urlencode(params) if params else ""
        headers: Optional[Dict[str, str]] = None
        if signed and self.ex.api_key and self.ex.api_secret:
            # The signed payload must be exactly the query string that is sent.
            headers = self._auth_headers(qs)
        last_err: Optional[Exception] = None
        for attempt in range(self.ex.max_retries):
            try:
                resp = await client.get(f"{path}?{qs}" if qs else path, headers=headers)
                if resp.status_code in (429, 418):
                    await asyncio.sleep(min(2.0 ** attempt, 20.0))
                    continue
                if resp.status_code >= 500:
                    raise ExchangeError(f"upstream {resp.status_code}", status=resp.status_code)
                try:
                    data = resp.json()
                except json.JSONDecodeError as exc:
                    raise ExchangeError(f"non-JSON response: {scrub(resp.text[:200])}") from exc
                return self._unwrap(data)
            except ExchangeError as exc:
                last_err = exc
                if exc.code == 10002:
                    await self._resync_time()
                    continue
                if exc.code in _FATAL_CODES:
                    raise
                if exc.code in _RETRY_CODES and attempt < self.ex.max_retries - 1:
                    await asyncio.sleep(min(1.0 * (2 ** attempt), 15.0))
                    continue
                if exc.status >= 500 and attempt < self.ex.max_retries - 1:
                    await asyncio.sleep(min(1.0 * (2 ** attempt), 15.0))
                    continue
                raise
            except httpx.HTTPError as exc:
                last_err = exc
                if attempt < self.ex.max_retries - 1:
                    await asyncio.sleep(min(0.5 * (2 ** attempt), 8.0))
        raise ExchangeError(f"GET {path} failed: {scrub(str(last_err))}")

    async def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        client = await self._ensure_client()
        # Compact separators: the bytes signed must equal the bytes sent.
        payload = json.dumps(body, separators=(",", ":"))
        last_err: Optional[Exception] = None
        for attempt in range(self.ex.max_retries):
            try:
                headers = self._auth_headers(payload)
                resp = await client.post(path, content=payload, headers=headers)
                if resp.status_code in (429, 418):
                    await asyncio.sleep(min(2.0 ** attempt, 20.0))
                    continue
                try:
                    data = resp.json()
                except json.JSONDecodeError as exc:
                    raise ExchangeError(f"non-JSON response: {scrub(resp.text[:200])}") from exc
                if resp.status_code >= 500 and not isinstance(data, dict):
                    raise ExchangeError(f"upstream {resp.status_code}", status=resp.status_code)
                return self._unwrap(data)
            except ExchangeError as exc:
                last_err = exc
                if exc.code == 10002:
                    await self._resync_time()
                    continue
                if exc.code in _FATAL_CODES:
                    raise
                if exc.code in _RETRY_CODES and attempt < self.ex.max_retries - 1:
                    await asyncio.sleep(min(1.0 * (2 ** attempt), 15.0))
                    continue
                raise
            except httpx.HTTPError as exc:
                last_err = exc
                if attempt < self.ex.max_retries - 1:
                    await asyncio.sleep(min(0.5 * (2 ** attempt), 8.0))
        raise ExchangeError(f"POST {path} failed: {scrub(str(last_err))}")

    # -- public: connectivity ----------------------------------------------
    async def ping(self) -> float:
        t0 = time.time()
        await self._get("/v5/market/time", signed=False)
        return (time.time() - t0) * 1000.0

    async def server_time(self) -> int:
        result = await self._get("/v5/market/time", signed=False)
        return int(result.get("timeSecond", "0")) * 1000

    # -- public: instruments ----------------------------------------------
    async def exchange_info(self, force: bool = False) -> Dict[str, SymbolSpec]:
        """Tradable USDT perpetuals. PAGINATED: a single page under-reports."""
        if self._specs and not force and (time.time() - self._specs_loaded_at) < 3600:
            return self._specs

        quote = self.cfg.universe.quote
        specs: Dict[str, SymbolSpec] = {}
        cursor: Optional[str] = None
        pages = 0
        while True:
            params = {"category": CATEGORY, "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            result = await self._get("/v5/market/instruments-info", params, signed=False)
            for s in result.get("list", []):
                if s.get("contractType") != "LinearPerpetual":
                    continue
                if s.get("status") != "Trading":
                    continue
                if s.get("quoteCoin") != quote or s.get("settleCoin") != quote:
                    continue
                lot = s.get("lotSizeFilter", {}) or {}
                price = s.get("priceFilter", {}) or {}
                lev = s.get("leverageFilter", {}) or {}
                try:
                    specs[s["symbol"]] = SymbolSpec(
                        symbol=s["symbol"],
                        tick_size=float(price.get("tickSize", 0.01)),
                        step_size=float(lot.get("qtyStep", 0.001)),
                        min_qty=float(lot.get("minOrderQty", 0.0)),
                        min_notional=float(lot.get("minNotionalValue", 5.0)),
                        max_leverage=int(float(lev.get("maxLeverage", 20) or 20)),
                        price_precision=int(float(s.get("priceScale", 2) or 2)),
                        qty_precision=_decimals(lot.get("qtyStep", "0.001")),
                    )
                except (KeyError, TypeError, ValueError):
                    continue
            pages += 1
            cursor = result.get("nextPageCursor")
            if not cursor or pages > 10:
                break
            await asyncio.sleep(0.05)

        self._specs = specs
        self._specs_loaded_at = time.time()
        log.info("bybit instruments loaded", extra={"symbols": len(specs), "pages": pages})
        return specs

    # -- public: tickers ---------------------------------------------------
    async def tickers_24h(self) -> Dict[str, Ticker]:
        """One call returns mark/index/funding too, so we avoid a second round trip."""
        result = await self._get("/v5/market/tickers", {"category": CATEGORY}, signed=False)
        out: Dict[str, Ticker] = {}
        for t in result.get("list", []):
            try:
                out[t["symbol"]] = _parse_ticker(t)
            except (KeyError, TypeError, ValueError):
                continue
        return out

    async def book_ticker(self, symbol: str) -> Ticker:
        result = await self._get("/v5/market/tickers", {"category": CATEGORY, "symbol": symbol}, signed=False)
        items = result.get("list", [])
        if not items:
            raise ExchangeError(f"no ticker for {symbol}")
        return _parse_ticker(items[0])

    async def premium_index(self) -> Dict[str, Dict[str, float]]:
        result = await self._get("/v5/market/tickers", {"category": CATEGORY}, signed=False)
        out: Dict[str, Dict[str, float]] = {}
        for t in result.get("list", []):
            try:
                out[t["symbol"]] = {
                    "mark_price": float(t.get("markPrice") or 0),
                    "index_price": float(t.get("indexPrice") or 0),
                    "funding_rate": float(t.get("fundingRate") or 0),
                    "next_funding_ts": int(float(t.get("nextFundingTime") or 0)),
                    "funding_interval_hours": float(t.get("fundingIntervalHour") or 8),
                }
            except (TypeError, ValueError):
                continue
        return out

    # -- public: candles ---------------------------------------------------
    async def klines(
        self, symbol: str, interval: str, limit: int = 500,
        start_ms: Optional[int] = None, end_ms: Optional[int] = None,
    ) -> List[List[Any]]:
        """Returns NORMALISED ascending rows: [ts_ms, open, high, low, close, volume].

        Bybit returns descending string rows; both differences are corrected here so
        callers see the same contract as the Binance adapter.
        """
        params: Dict[str, Any] = {
            "category": CATEGORY,
            "symbol": symbol,
            "interval": to_native_interval(interval),
            "limit": min(max(int(limit), 1), MAX_KLINE_LIMIT),
        }
        if start_ms is not None:
            params["start"] = int(start_ms)
        if end_ms is not None:
            params["end"] = int(end_ms)
        result = await self._get("/v5/market/kline", params, signed=False)
        rows = result.get("list", []) or []
        normalised: List[List[Any]] = []
        for r in rows:
            try:
                normalised.append([
                    int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]),
                ])
            except (IndexError, TypeError, ValueError):
                continue
        normalised.sort(key=lambda x: x[0])   # descending -> ascending
        return normalised

    async def klines_full(self, symbol: str, interval: str, total_bars: int) -> List[List[Any]]:
        """Page backwards using `end` until enough history is collected."""
        out: List[List[Any]] = []
        end_ms: Optional[int] = None
        remaining = int(total_bars)
        while remaining > 0:
            batch = min(remaining, MAX_KLINE_LIMIT)
            rows = await self.klines(symbol, interval, limit=batch, end_ms=end_ms)
            if not rows:
                break
            out = rows + out
            end_ms = int(rows[0][0]) - 1
            remaining -= len(rows)
            if len(rows) < batch:
                break
            await asyncio.sleep(0.12)
        seen = set()
        dedup: List[List[Any]] = []
        for r in sorted(out, key=lambda x: x[0]):
            if r[0] in seen:
                continue
            seen.add(r[0])
            dedup.append(r)
        return dedup

    async def depth(self, symbol: str, limit: int = 50) -> DepthSnapshot:
        result = await self._get("/v5/market/orderbook",
                                 {"category": CATEGORY, "symbol": symbol, "limit": min(limit, 500)},
                                 signed=False)
        def lv(items: Any) -> List[List[float]]:
            out: List[List[float]] = []
            for p, q in (items or []):
                try:
                    out.append([float(p), float(q)])
                except (TypeError, ValueError):
                    continue
            return out
        return DepthSnapshot(
            symbol=symbol,
            bids=lv(result.get("b")),
            asks=lv(result.get("a")),
            ts=int(float(result.get("ts") or 0)),
        )

    async def funding_history(self, symbol: str, limit: int = 30) -> List[Dict[str, float]]:
        result = await self._get("/v5/market/funding/history",
                                 {"category": CATEGORY, "symbol": symbol, "limit": min(limit, 200)},
                                 signed=False)
        out: List[Dict[str, float]] = []
        for d in result.get("list", []) or []:
            try:
                out.append({"ts": int(float(d["fundingRateTimestamp"])),
                            "rate": float(d["fundingRate"])})
            except (KeyError, TypeError, ValueError):
                continue
        out.sort(key=lambda x: x["ts"])
        return out

    # -- private: account --------------------------------------------------
    async def account_balance(self) -> List[Balance]:
        result = await self._get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
        out: List[Balance] = []
        for acc in result.get("list", []) or []:
            for c in acc.get("coin", []) or []:
                try:
                    wallet = float(c.get("walletBalance") or 0)
                    if wallet == 0 and float(c.get("equity") or 0) == 0:
                        continue
                    out.append(Balance(
                        asset=c.get("coin", ""),
                        wallet_balance=wallet,
                        available_balance=float(c.get("availableToWithdraw") or c.get("free") or 0),
                        unrealized_pnl=float(c.get("unrealisedPnl") or 0),
                        margin_balance=float(c.get("equity") or wallet),
                    ))
                except (TypeError, ValueError):
                    continue
        return out

    async def position_risk(self, symbol: Optional[str] = None) -> List[PositionRisk]:
        params: Dict[str, Any] = {"category": CATEGORY}
        if symbol:
            params["symbol"] = symbol
        else:
            params["settleCoin"] = self.cfg.universe.quote
        result = await self._get("/v5/position/list", params)
        out: List[PositionRisk] = []
        for p in result.get("list", []) or []:
            try:
                size = float(p.get("size") or 0)
                if size == 0:
                    continue
                side = (p.get("side") or "").lower()
                signed = size if side == "buy" else -size
                out.append(PositionRisk(
                    symbol=p["symbol"],
                    position_amt=signed,
                    entry_price=float(p.get("avgPrice") or 0),
                    mark_price=float(p.get("markPrice") or 0),
                    unrealized_pnl=float(p.get("unrealisedPnl") or 0),
                    liquidation_price=float(p.get("liqPrice") or 0),
                    leverage=float(p.get("leverage") or 0),
                    margin_type="isolated" if int(p.get("isIsolated") or 0) else "cross",
                    isolated_wallet=float(p.get("positionIM") or 0),
                ))
            except (KeyError, TypeError, ValueError):
                continue
        return out

    # -- private: settings -------------------------------------------------
    async def set_leverage(self, symbol: str, leverage: int) -> Dict[str, Any]:
        lev = str(int(leverage))
        try:
            return await self._post("/v5/position/set-leverage", {
                "category": CATEGORY, "symbol": symbol,
                "buyLeverage": lev, "sellLeverage": lev,
            })
        except ExchangeError as exc:
            # 110043 = leverage not modified. Idempotent, not an error.
            if exc.code in (110043, 110025):
                return {"msg": "no change"}
            raise

    async def set_margin_type(self, symbol: str, isolated: bool = False) -> Dict[str, Any]:
        """Bybit needs leverage alongside margin mode, so read it first."""
        leverage = "1"
        try:
            pos = await self.position_risk(symbol)
            if pos and pos[0].leverage:
                leverage = str(max(1, int(pos[0].leverage)))
        except ExchangeError:
            pass
        try:
            return await self._post("/v5/position/switch-isolated", {
                "category": CATEGORY, "symbol": symbol,
                "isIsolated": 1 if isolated else 0,
                "buyLeverage": leverage, "sellLeverage": leverage,
            })
        except ExchangeError as exc:
            if exc.code in (110025, 110043, 340030):   # already in that mode
                return {"msg": "no change"}
            raise

    async def change_position_mode(self, dual: bool = False) -> Dict[str, Any]:
        raise ExchangeError(
            "Bybit sets position mode per symbol via /v5/position/switch-mode; "
            "the platform assumes one-way mode (positionIdx=0)"
        )

    # -- private: orders ---------------------------------------------------
    async def place_order(self, req: OrderRequest) -> OrderResult:
        qty = _fmt_qty(req.qty)
        body: Dict[str, Any] = {
            "category": CATEGORY,
            "symbol": req.symbol,
            "side": "Buy" if req.side.upper() == "BUY" else "Sell",
            "orderType": "Market" if req.order_type.upper() == "MARKET" else "Limit",
            "qty": qty,
            "positionIdx": 0,           # one-way mode
        }
        if req.order_type.upper() == "MARKET":
            body["timeInForce"] = "IOC"
        else:
            body["timeInForce"] = "GTC"
            if req.price is not None:
                body["price"] = _fmt_price(req.price)
        if req.reduce_only:
            body["reduceOnly"] = True
        if req.stop_price is not None:
            body["triggerPrice"] = _fmt_price(req.stop_price)
        if req.client_id:
            body["orderLinkId"] = req.client_id

        try:
            result = await self._post("/v5/order/create", body)
        except ExchangeError as exc:
            return OrderResult(ok=False, error=f"[{exc.code}] {exc}", client_id=req.client_id)

        order_id = str(result.get("orderId") or "")
        link_id = str(result.get("orderLinkId") or req.client_id or "")
        # /order/create returns only IDs. Fetch the order so callers get a real
        # fill price and quantity instead of assuming the request was filled.
        filled, avg, status = 0.0, 0.0, "New"
        if order_id or link_id:
            await asyncio.sleep(0.25)
            try:
                info = await self.order_info(req.symbol, order_id or None, link_id or None)
                filled = float(info.get("cumExecQty") or 0)
                avg = float(info.get("avgPrice") or 0)
                status = str(info.get("orderStatus") or "New")
                if avg <= 0 and filled > 0:
                    avg = float(info.get("price") or 0)
            except ExchangeError as exc:
                log.warning("order created but query failed",
                            extra={"symbol": req.symbol, "order_id": order_id, "error": str(exc)})
        return OrderResult(ok=True, order_id=order_id, client_id=link_id, status=status,
                           filled_qty=filled, avg_price=avg, raw=result)

    async def order_info(self, symbol: str, order_id: Optional[str] = None,
                         client_id: Optional[str] = None) -> Dict[str, Any]:
        params: Dict[str, Any] = {"category": CATEGORY, "symbol": symbol}
        if order_id:
            params["orderId"] = order_id
        if client_id:
            params["orderLinkId"] = client_id
        result = await self._get("/v5/order/realtime", params)
        items = result.get("list") or []
        if items:
            return items[0]
        # Fall back to history for orders that filled and left the realtime book.
        hist = await self._get("/v5/order/history", params)
        items = hist.get("list") or []
        return items[0] if items else {}

    async def cancel_order(self, symbol: str, order_id: Optional[str] = None,
                           client_id: Optional[str] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"category": CATEGORY, "symbol": symbol}
        if order_id:
            body["orderId"] = order_id
        if client_id:
            body["orderLinkId"] = client_id
        return await self._post("/v5/order/cancel", body)

    async def open_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"category": CATEGORY}
        if symbol:
            params["symbol"] = symbol
        else:
            params["settleCoin"] = self.cfg.universe.quote
        result = await self._get("/v5/order/realtime", params)
        return result.get("list") or []

    async def all_orders(self, symbol: str, limit: int = 50) -> List[Dict[str, Any]]:
        result = await self._get("/v5/order/history",
                                 {"category": CATEGORY, "symbol": symbol, "limit": min(limit, 50)})
        return result.get("list") or []

    async def user_trades(self, symbol: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Normalised so `commission` and `orderId` are present, as Binance has them."""
        result = await self._get("/v5/execution/list",
                                 {"category": CATEGORY, "symbol": symbol, "limit": min(limit, 100)})
        out: List[Dict[str, Any]] = []
        for e in result.get("list") or []:
            out.append({
                "orderId": str(e.get("orderId") or ""),
                "symbol": e.get("symbol"),
                "side": e.get("side"),
                "qty": float(e.get("execQty") or 0),
                "price": float(e.get("execPrice") or 0),
                "commission": abs(float(e.get("execFee") or 0)),
                "time": int(float(e.get("execTime") or 0)),
                "isMaker": bool(e.get("isMaker")),
            })
        return out

    async def order_fee(self, symbol: str, order_id: str = "",
                        client_id: Optional[str] = None) -> float:
        """Total execution fee for one order, in the settlement currency."""
        try:
            trades = await self.user_trades(symbol, limit=100)
        except ExchangeError:
            return 0.0
        oid = str(order_id or "")
        total = 0.0
        for t in trades:
            if oid and t["orderId"] == oid:
                total += abs(t["commission"])
        return total

    async def income(self, income_type: str = "FUNDING_FEE", limit: int = 200) -> List[Dict[str, Any]]:
        """Funding settlements from the transaction log, normalised to Binance's shape."""
        result = await self._get("/v5/account/transaction-log", {
            "accountType": "UNIFIED",
            "category": CATEGORY,
            "type": "SETTLEMENT",
            "limit": min(limit, 50),
        })
        out: List[Dict[str, Any]] = []
        for e in result.get("list") or []:
            out.append({
                "symbol": e.get("symbol"),
                "incomeType": "FUNDING_FEE",
                "income": float(e.get("funding") or e.get("cashFlow") or 0),
                "time": int(float(e.get("transactionTime") or 0)),
                "asset": e.get("currency"),
            })
        return out

    async def permissions_probe(self) -> Dict[str, Any]:
        """Verify the key's capabilities BEFORE any order is attempted.

        Bybit exposes this directly, which lets the platform refuse a key with
        withdrawal or transfer rights — the single highest-value security check.
        """
        result = await self._get("/v5/user/query-api")
        perms = result.get("permissions") or {}
        report = {
            "ok": True,
            "read_only": bool(result.get("readOnly")),
            "unified_margin": bool(result.get("unified")),
            "ip_allowlist": result.get("ips") or [],
            "expires_at": result.get("expiredAt") or None,
            "permissions": {k: v for k, v in perms.items() if v},
            "can_withdraw": bool(perms.get("Withdraw")),
            "can_transfer": bool(perms.get("Wallet")),
            "can_trade_futures": bool(perms.get("ContractTrade")),
        }
        if report["can_withdraw"]:
            log.error("SECURITY: API key has WITHDRAWAL permission — revoke it immediately",
                      extra={"ip_allowlist": report["ip_allowlist"]})
        if report["can_transfer"]:
            log.warning("SECURITY: API key can move funds between wallets",
                        extra={"permissions": list(report["permissions"].keys())})
        if not report["ip_allowlist"]:
            log.warning("API key has NO IP allowlist — it is usable from anywhere")
        if not report["can_trade_futures"]:
            log.error("API key lacks contract-trade permission; live trading would fail")
        balances = await self.account_balance()
        report["assets"] = [b.asset for b in balances if b.wallet_balance > 0]
        report["equity"] = {b.asset: b.margin_balance for b in balances if b.margin_balance > 0}
        return report


    # -- websocket contract -------------------------------------------------
    def to_native_interval(self, interval: str) -> str:
        return to_native_interval(interval)

    def ws_connect_url(self, interval: str, symbols: List[str]) -> str:
        # One multiplexed public endpoint; subscriptions are sent after connect.
        return self.cfg.exchange.ws_url

    def ws_subscribe_messages(self, interval: str, symbols: List[str]) -> List[str]:
        native = to_native_interval(interval)
        args = [f"kline.{native}.{s.upper()}" for s in symbols]
        # Bybit caps args per subscribe request; chunk to stay within limits.
        out: List[str] = []
        for i in range(0, len(args), 10):
            out.append(json.dumps({"op": "subscribe", "args": args[i:i + 10]}))
        return out

    def ws_heartbeat_message(self) -> Optional[str]:
        # Bybit requires an application-level ping; the protocol nobody sends is
        # the one that gets disconnected 20s later.
        return json.dumps({"op": "ping"})

    def ws_heartbeat_interval(self) -> float:
        return 15.0

    def parse_kline_message(self, raw: str) -> Optional[Dict[str, Any]]:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return None
        topic = msg.get("topic") or ""
        if not topic.startswith("kline."):
            return None
        data = msg.get("data")
        if not isinstance(data, list) or not data:
            return None
        d = data[0]
        # topic == "kline.<interval>.<SYMBOL>"
        parts = topic.split(".")
        symbol = parts[2] if len(parts) >= 3 else d.get("symbol")
        if not symbol:
            return None
        try:
            return {
                "symbol": symbol,
                "ts": int(d["start"]),
                "open": float(d["open"]),
                "high": float(d["high"]),
                "low": float(d["low"]),
                "close": float(d["close"]),
                "volume": float(d["volume"]),
                "closed": bool(d.get("confirm")),
            }
        except (KeyError, TypeError, ValueError):
            return None


class BybitPrivate(BybitClient):
    """Live order-routing role: refuses to construct without credentials."""

    def __init__(self, cfg, client: Optional[httpx.AsyncClient] = None):
        super().__init__(cfg, require_creds=True, client=client)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _parse_ticker(t: Dict[str, Any]) -> Ticker:
    # price24hPcnt is a FRACTION; Binance's equivalent is already a percentage.
    pct = t.get("price24hPcnt")
    change_pct = float(pct) * 100.0 if pct not in (None, "") else 0.0
    return Ticker(
        symbol=t["symbol"],
        last=float(t.get("lastPrice") or 0),
        bid=float(t.get("bid1Price") or 0),
        ask=float(t.get("ask1Price") or 0),
        quote_volume_24h=float(t.get("turnover24h") or 0),
        price_change_pct_24h=change_pct,
        mark_price=float(t.get("markPrice") or 0),
        index_price=float(t.get("indexPrice") or 0),
        funding_rate=float(t.get("fundingRate") or 0),
        next_funding_ts=int(float(t.get("nextFundingTime") or 0)),
        funding_interval_hours=float(t.get("fundingIntervalHour") or 8),
        ts=int(time.time() * 1000),
    )


def _decimals(step: Any) -> int:
    s = str(step)
    if "." in s:
        return len(s.split(".", 1)[1].rstrip("0"))
    return 0


def _fmt_qty(qty: float) -> str:
    return f"{qty:.10f}".rstrip("0").rstrip(".") or "0"


def _fmt_price(price: float) -> str:
    return f"{price:.10f}".rstrip("0").rstrip(".") or "0"
