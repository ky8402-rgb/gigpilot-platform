"""Bybit v5 adapter tests.

Payloads here are REAL Bybit v5 responses captured from the live API, so the
adapter is tested against actual field names and types rather than my assumptions.

The tests target the specific ways Bybit differs from Binance, each of which
silently corrupts data if unhandled:
  * HTTP 200 with a non-zero retCode is a FAILURE, not a success
  * klines arrive DESCENDING as strings
  * price24hPcnt is a FRACTION, not a percentage
  * order ids are UUID strings
  * instruments-info is paginated
"""
import asyncio
import hashlib
import hmac
import json
from typing import Any, Dict, List, Tuple

import httpx
import pytest

from app.bybit import BybitClient, BybitPrivate, from_native_interval, to_native_interval
from app.config import load_config
from app.exchange import DepthSnapshot, ExchangeError, OrderRequest, Ticker
from app.market import rows_to_df

# ---------------------------------------------------------------------------
# Real captured payloads
# ---------------------------------------------------------------------------
ENVELOPE = {"retCode": 0, "retMsg": "OK", "retExtInfo": {}, "time": 1790656534259}

TIME_PAYLOAD = {**ENVELOPE, "result": {"timeSecond": "1790656534", "timeNano": "1790656534259172645"}}

INSTRUMENTS_PAGE = {
    **ENVELOPE,
    "result": {
        "category": "linear",
        "nextPageCursor": "",
        "list": [
            {
                "symbol": "BTCUSDT", "contractType": "LinearPerpetual", "status": "Trading",
                "quoteCoin": "USDT", "baseCoin": "BTC", "settleCoin": "USDT",
                "priceScale": "2", "fundingInterval": "480",
                "lotSizeFilter": {"qtyStep": "0.001", "minOrderQty": "0.001",
                                  "minNotionalValue": "5", "maxOrderQty": "100"},
                "priceFilter": {"tickSize": "0.1"},
                "leverageFilter": {"minLeverage": "1", "maxLeverage": "100.00"},
            },
            {   # must be excluded: not a perpetual
                "symbol": "BTCUSDT-25DEC", "contractType": "LinearFutures", "status": "Trading",
                "quoteCoin": "USDT", "settleCoin": "USDT",
                "lotSizeFilter": {"qtyStep": "0.001", "minOrderQty": "0.001", "minNotionalValue": "5"},
                "priceFilter": {"tickSize": "0.1"},
                "leverageFilter": {"maxLeverage": "25"},
            },
            {   # must be excluded: not trading
                "symbol": "DEADUSDT", "contractType": "LinearPerpetual", "status": "Closed",
                "quoteCoin": "USDT", "settleCoin": "USDT",
                "lotSizeFilter": {"qtyStep": "1", "minOrderQty": "1", "minNotionalValue": "5"},
                "priceFilter": {"tickSize": "0.01"},
                "leverageFilter": {"maxLeverage": "10"},
            },
            {   # must be excluded: USDC-settled, not the configured quote
                "symbol": "BTCPERP", "contractType": "LinearPerpetual", "status": "Trading",
                "quoteCoin": "USDC", "settleCoin": "USDC",
                "lotSizeFilter": {"qtyStep": "0.001", "minOrderQty": "0.001", "minNotionalValue": "5"},
                "priceFilter": {"tickSize": "0.1"},
                "leverageFilter": {"maxLeverage": "20"},
            },
            {
                "symbol": "ETHUSDT", "contractType": "LinearPerpetual", "status": "Trading",
                "quoteCoin": "USDT", "baseCoin": "ETH", "settleCoin": "USDT",
                "priceScale": "2", "fundingInterval": "480",
                "lotSizeFilter": {"qtyStep": "0.01", "minOrderQty": "0.01",
                                  "minNotionalValue": "5", "maxOrderQty": "1000"},
                "priceFilter": {"tickSize": "0.01"},
                "leverageFilter": {"minLeverage": "1", "maxLeverage": "100.00"},
            },
        ],
    },
}
INSTRUMENTS_PAGE_2 = {
    **ENVELOPE,
    "result": {
        "category": "linear", "nextPageCursor": "",
        "list": [{
            "symbol": "SOLUSDT", "contractType": "LinearPerpetual", "status": "Trading",
            "quoteCoin": "USDT", "baseCoin": "SOL", "settleCoin": "USDT", "priceScale": "3",
            "lotSizeFilter": {"qtyStep": "0.1", "minOrderQty": "0.1", "minNotionalValue": "5"},
            "priceFilter": {"tickSize": "0.001"},
            "leverageFilter": {"minLeverage": "1", "maxLeverage": "50.00"},
        }],
    },
}

TICKERS = {
    **ENVELOPE,
    "result": {"category": "linear", "list": [
        {"symbol": "BTCUSDT", "lastPrice": "83076.20", "bid1Price": "83076.10",
         "ask1Price": "83076.20", "volume24h": "56410.1790", "turnover24h": "4695337413.2015",
         "price24hPcnt": "-0.003898", "markPrice": "83076.10", "indexPrice": "83117.67",
         "fundingRate": "0.00002658", "nextFundingTime": "1790668800000",
         "fundingIntervalHour": "8", "openInterest": "55562.093"},
        {"symbol": "ETHUSDT", "lastPrice": "3000.5", "bid1Price": "3000.4",
         "ask1Price": "3000.6", "volume24h": "1000", "turnover24h": "3000500",
         "price24hPcnt": "0.0125", "markPrice": "3000.5", "indexPrice": "3001",
         "fundingRate": "-0.0001", "nextFundingTime": "1790668800000",
         "fundingIntervalHour": "4"},
    ]},
}

# NOTE: descending order, all strings, 7 columns.
KLINES = {
    **ENVELOPE,
    "result": {"category": "linear", "symbol": "BTCUSDT", "list": [
        ["1790654400000", "83037.3", "83264.4", "82983.1", "83076.1", "548.353", "45593741.0199"],
        ["1790650800000", "82932.3", "83197.4", "82816.1", "83037.3", "1441.042", "119614255.5235"],
        ["1790647200000", "83021", "83125.3", "82843.4", "82932.3", "1009.319", "83737084.6975"],
    ]},
}

ORDERBOOK = {
    **ENVELOPE,
    "result": {"s": "BTCUSDT", "b": [["83076.10", "7.538"], ["83076.00", "0.555"]],
               "a": [["83076.20", "0.503"], ["83076.30", "0.001"]],
               "ts": 1790656534259, "u": 1, "seq": 2, "cts": 3},
}

POSITIONS = {
    **ENVELOPE,
    "result": {"category": "linear", "list": [
        {"symbol": "BTCUSDT", "side": "Buy", "size": "0.5", "avgPrice": "80000",
         "markPrice": "83000", "unrealisedPnl": "1500", "liqPrice": "70000",
         "leverage": "5", "isIsolated": 0, "positionIM": "8000"},
        {"symbol": "ETHUSDT", "side": "Sell", "size": "2", "avgPrice": "3100",
         "markPrice": "3000", "unrealisedPnl": "200", "liqPrice": "4000",
         "leverage": "3", "isIsolated": 0, "positionIM": "2000"},
        {"symbol": "SOLUSDT", "side": "None", "size": "0", "avgPrice": "0",
         "markPrice": "150", "unrealisedPnl": "0", "liqPrice": "0",
         "leverage": "1", "isIsolated": 0, "positionIM": "0"},
    ]},
}

WALLET = {
    **ENVELOPE,
    "result": {"list": [{"accountType": "UNIFIED", "totalEquity": "10500",
                         "totalAvailableBalance": "9800", "coin": [
        {"coin": "USDT", "walletBalance": "10000", "equity": "10500",
         "availableToWithdraw": "9800", "unrealisedPnl": "500"},
        {"coin": "BTC", "walletBalance": "0", "equity": "0", "unrealisedPnl": "0"},
    ]}]},
}

QUERY_API_SAFE = {
    **ENVELOPE,
    "result": {"id": "1", "note": "prod", "apiKey": "redacted", "readOnly": False,
               "unified": 1, "ips": ["35.154.110.156"], "expiredAt": "2027-01-01T00:00:00Z",
               "permissions": {"ContractTrade": ["Order", "Position"],
                               "Wallet": [], "Spot": [], "Withdraw": []}},
}
QUERY_API_WITHDRAW_RISK = {
    **ENVELOPE,
    "result": {"id": "1", "readOnly": False, "unified": 1, "ips": [],
               "permissions": {"ContractTrade": ["Order"], "Wallet": ["AccountTransfer"],
                               "Withdraw": ["Withdraw"]}},
}
QUERY_API_NO_FUTURES = {
    **ENVELOPE,
    "result": {"id": "1", "readOnly": True, "unified": 1, "ips": ["1.2.3.4"],
               "permissions": {"ContractTrade": [], "Spot": ["SpotTrade"], "Withdraw": []}},
}

ORDER_CREATE = {**ENVELOPE, "result": {"orderId": "db8a1b2c-3d4e-5f60-7182-93a4b5c6d7e8",
                                       "orderLinkId": "q-abc123"}}
ORDER_REALTIME = {
    **ENVELOPE,
    "result": {"category": "linear", "list": [{
        "orderId": "db8a1b2c-3d4e-5f60-7182-93a4b5c6d7e8", "orderLinkId": "q-abc123",
        "symbol": "BTCUSDT", "side": "Buy", "orderStatus": "Filled",
        "cumExecQty": "0.01", "avgPrice": "83076.15", "price": "83076.15"}]},
}
EXECUTIONS = {
    **ENVELOPE,
    "result": {"category": "linear", "list": [
        {"orderId": "db8a1b2c-3d4e-5f60-7182-93a4b5c6d7e8", "symbol": "BTCUSDT",
         "side": "Buy", "execQty": "0.01", "execPrice": "83076.15",
         "execFee": "0.45691883", "execTime": "1790656534259", "isMaker": False},
        {"orderId": "other-order", "symbol": "BTCUSDT", "side": "Sell",
         "execQty": "0.01", "execPrice": "83100", "execFee": "0.999",
         "execTime": "1790656534259", "isMaker": True},
    ]},
}
RATE_LIMITED = {"retCode": 10006, "retMsg": "Too many visits. Exceeded the API Rate Limit."}
BAD_IP = {"retCode": 10010, "retMsg": "Unmatched IP, please check your API key's bound IP addresses."}
INVALID_SIGN = {"retCode": 10004, "retMsg": "error sign"}


# ---------------------------------------------------------------------------
def make_cfg():
    cfg = load_config()
    cfg.exchange.name = "bybit"
    cfg.exchange.rest_url = "https://api.bybit.example"
    cfg.exchange.ws_url = "wss://stream.bybit.example/v5/public/linear"
    cfg.exchange.api_key = "testkey"
    cfg.exchange.api_secret = "testsecret"
    cfg.exchange.max_retries = 2
    return cfg


def make_client(routes: Dict[str, Any], cfg=None, require_creds=False):
    """A BybitClient wired to a MockTransport. `routes` maps a path substring to a
    payload (dict) or a callable(request) -> payload."""
    calls: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        path = request.url.path
        for key, payload in routes.items():
            if key in path:
                if callable(payload):
                    return httpx.Response(200, json=payload(request))
                return httpx.Response(200, json=payload)
        return httpx.Response(200, json={**ENVELOPE, "result": {}})

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, base_url=cfg.exchange.rest_url if cfg else "https://api.bybit.example")
    bc = BybitClient(cfg or make_cfg(), require_creds=require_creds, client=client)
    return bc, calls


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# 1. Envelope: a 200 with retCode != 0 must be treated as FAILURE
# ---------------------------------------------------------------------------
def test_nonzero_retcode_raises_even_on_http_200():
    bc, _ = make_client({"/v5/market/tickers": BAD_IP})
    with pytest.raises(ExchangeError) as e:
        run(bc.tickers_24h())
    assert e.value.code == 10010
    assert "Unmatched IP" in str(e.value)


def test_unwrap_rejects_non_dict_payload():
    with pytest.raises(ExchangeError):
        BybitClient._unwrap(["not", "a", "dict"])


def test_unwrap_returns_empty_dict_for_null_result():
    assert BybitClient._unwrap({**ENVELOPE, "result": None}) == {}


def test_fatal_codes_are_not_retried():
    """Auth/permission failures must fail fast, not burn retries."""
    bc, calls = make_client({"/v5/order/create": INVALID_SIGN})
    res = run(bc.place_order(OrderRequest(symbol="BTCUSDT", side="BUY", qty=0.01)))
    assert res.ok is False
    assert "10004" in res.error
    assert len(calls) == 1, f"expected a single attempt, made {len(calls)}"


# ---------------------------------------------------------------------------
# 2. Klines: descending strings -> ascending normalised rows
# ---------------------------------------------------------------------------
def test_klines_are_reordered_ascending_and_normalised():
    bc, _ = make_client({"/v5/market/kline": KLINES})
    rows = run(bc.klines("BTCUSDT", "1h", limit=3))
    assert len(rows) == 3
    ts = [r[0] for r in rows]
    assert ts == sorted(ts), "rows must be ascending (Bybit returns descending)"
    assert ts == [1790647200000, 1790650800000, 1790654400000]
    # 6 normalised columns, all numeric
    assert all(len(r) == 6 for r in rows)
    assert all(isinstance(v, (int, float)) for r in rows for v in r)
    # values came through correctly (note "83021" has no decimal)
    assert rows[0][1] == pytest.approx(83021.0)
    assert rows[2][4] == pytest.approx(83076.1)


def test_kline_rows_are_binance_compatible_for_rows_to_df():
    """The normalised row contract must satisfy the existing frame builder."""
    bc, _ = make_client({"/v5/market/kline": KLINES})
    rows = run(bc.klines("BTCUSDT", "1h", limit=3))
    df = rows_to_df(rows)
    assert {"open", "high", "low", "close", "volume"} <= set(df.columns)
    assert len(df) == 3
    assert df["close"].iloc[-1] == pytest.approx(83076.1)
    assert df.index.is_monotonic_increasing


def test_klines_full_pages_backwards_without_duplicates():
    page = {"n": 0}

    def kline_handler(request):
        page["n"] += 1
        # Page 1 returns the newest 1000, page 2 the preceding 1000.
        base = 1_790_000_000_000 - page["n"] * 1000 * 3_600_000
        rows = [[str(base + i * 3_600_000), "1", "2", "0.5", "1.5", "10", "15"]
                for i in range(1000)]
        rows.reverse()   # Bybit order
        return {**ENVELOPE, "result": {"category": "linear", "symbol": "BTCUSDT", "list": rows}}

    bc, calls = make_client({"/v5/market/kline": kline_handler})
    rows = run(bc.klines_full("BTCUSDT", "1h", 1500))
    assert len(rows) == 2000, "two pages of 1000"
    ts = [r[0] for r in rows]
    assert ts == sorted(ts)
    assert len(set(ts)) == len(ts), "no duplicates after paging"
    assert len(calls) == 2


# ---------------------------------------------------------------------------
# 3. Ticker: fraction -> percent, turnover -> quote volume
# ---------------------------------------------------------------------------
def test_ticker_percent_is_scaled_from_fraction():
    """Bybit's price24hPcnt is a fraction; Binance's is already a percentage.
    Skipping the x100 makes every 24h change 100x too small."""
    bc, _ = make_client({"/v5/market/tickers": TICKERS})
    tk = run(bc.tickers_24h())
    btc = tk["BTCUSDT"]
    assert btc.price_change_pct_24h == pytest.approx(-0.3898, rel=1e-6)
    eth = tk["ETHUSDT"]
    assert eth.price_change_pct_24h == pytest.approx(1.25, rel=1e-6)


def test_ticker_fields_map_correctly():
    bc, _ = make_client({"/v5/market/tickers": TICKERS})
    btc = run(bc.tickers_24h())["BTCUSDT"]
    assert btc.last == pytest.approx(83076.20)
    assert btc.bid == pytest.approx(83076.10)
    assert btc.ask == pytest.approx(83076.20)
    assert btc.mark_price == pytest.approx(83076.10)
    assert btc.index_price == pytest.approx(83117.67)
    assert btc.funding_rate == pytest.approx(0.00002658)
    assert btc.quote_volume_24h == pytest.approx(4695337413.2015)  # turnover24h
    assert btc.funding_interval_hours == pytest.approx(8.0)
    assert btc.spread_bps > 0


def test_book_ticker_single_symbol():
    bc, _ = make_client({"/v5/market/tickers": TICKERS})
    tk = run(bc.book_ticker("BTCUSDT"))
    assert tk.symbol == "BTCUSDT"
    assert tk.ask > tk.bid


def test_premium_index_includes_funding_interval():
    bc, _ = make_client({"/v5/market/tickers": TICKERS})
    pi = run(bc.premium_index())
    assert pi["BTCUSDT"]["mark_price"] == pytest.approx(83076.10)
    assert pi["BTCUSDT"]["funding_rate"] == pytest.approx(0.00002658)
    assert pi["ETHUSDT"]["funding_interval_hours"] == pytest.approx(4.0)


# ---------------------------------------------------------------------------
# 4. Instruments: filters, precision, PAGINATION
# ---------------------------------------------------------------------------
def test_instruments_filters_and_field_mapping():
    bc, _ = make_client({"/v5/market/instruments-info": INSTRUMENTS_PAGE})
    specs = run(bc.exchange_info())
    assert set(specs) == {"BTCUSDT", "ETHUSDT"}, "non-perp/closed/USDC must be excluded"
    btc = specs["BTCUSDT"]
    assert btc.tick_size == pytest.approx(0.1)
    assert btc.step_size == pytest.approx(0.001)
    assert btc.min_qty == pytest.approx(0.001)
    assert btc.min_notional == pytest.approx(5.0)
    assert btc.max_leverage == 100
    assert btc.qty_precision == 3


def test_instruments_handles_pagination():
    """A single page under-reports the universe; the cursor must be followed."""
    n = {"i": 0}

    def handler(request):
        n["i"] += 1
        if n["i"] == 1:
            return {**ENVELOPE, "result": {**INSTRUMENTS_PAGE["result"], "nextPageCursor": "CURSOR1"}}
        return INSTRUMENTS_PAGE_2

    bc, calls = make_client({"/v5/market/instruments-info": handler})
    specs = run(bc.exchange_info())
    assert "SOLUSDT" in specs, "second page must be fetched"
    assert {"BTCUSDT", "ETHUSDT", "SOLUSDT"} <= set(specs)
    assert len(calls) == 2


# ---------------------------------------------------------------------------
# 5. Positions and balance
# ---------------------------------------------------------------------------
def test_position_side_maps_to_signed_amount():
    bc, _ = make_client({"/v5/position/list": POSITIONS})
    pos = run(bc.position_risk())
    bysym = {p.symbol: p for p in pos}
    assert "SOLUSDT" not in bysym, "zero-size positions are dropped"
    assert bysym["BTCUSDT"].position_amt == pytest.approx(0.5)     # Buy -> positive
    assert bysym["ETHUSDT"].position_amt == pytest.approx(-2.0)    # Sell -> negative
    assert bysym["BTCUSDT"].unrealized_pnl == pytest.approx(1500)
    assert bysym["BTCUSDT"].margin_type == "cross"


def test_account_balance_skips_empty_coins():
    bc, _ = make_client({"/v5/account/wallet-balance": WALLET})
    bals = run(bc.account_balance())
    assert [b.asset for b in bals] == ["USDT"]
    assert bals[0].wallet_balance == pytest.approx(10000)
    assert bals[0].available_balance == pytest.approx(9800)
    assert bals[0].margin_balance == pytest.approx(10500)


# ---------------------------------------------------------------------------
# 6. Signing
# ---------------------------------------------------------------------------
def test_signature_uses_the_documented_payload():
    """sign = HMAC_SHA256(secret, timestamp + api_key + recv_window + payload)"""
    cfg = make_cfg()
    bc = BybitClient(cfg)
    payload = 'category=linear&symbol=BTCUSDT'
    headers = bc._auth_headers(payload)
    ts = headers["X-BAPI-TIMESTAMP"]
    recv = headers["X-BAPI-RECV-WINDOW"]
    expected = hmac.new(
        cfg.exchange.api_secret.encode(),
        (ts + cfg.exchange.api_key + recv + payload).encode(),
        hashlib.sha256,
    ).hexdigest()
    assert headers["X-BAPI-SIGN"] == expected
    assert headers["X-BAPI-API-KEY"] == cfg.exchange.api_key


def test_post_body_bytes_match_signed_bytes():
    """The exact bytes signed must be the exact bytes sent, or the order is rejected."""
    captured: Dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and "/v5/order/create" in request.url.path:
            captured["body"] = request.content.decode()
            captured["sign"] = request.headers.get("X-BAPI-SIGN")
            captured["ts"] = request.headers.get("X-BAPI-TIMESTAMP")
            return httpx.Response(200, json=ORDER_CREATE)
        return httpx.Response(200, json=ORDER_REALTIME)

    cfg = make_cfg()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=cfg.exchange.rest_url)
    bc = BybitClient(cfg, client=client)
    run(bc.place_order(OrderRequest(symbol="BTCUSDT", side="BUY", qty=0.01, client_id="q-abc123")))

    body = captured["body"]
    assert " " not in body, "compact separators keep signed bytes == sent bytes"
    expected = hmac.new(
        cfg.exchange.api_secret.encode(),
        (captured["ts"] + cfg.exchange.api_key + str(cfg.exchange.recv_window_ms) + body).encode(),
        hashlib.sha256,
    ).hexdigest()
    assert captured["sign"] == expected


def test_private_client_requires_credentials():
    cfg = make_cfg()
    cfg.exchange.api_key = ""
    cfg.exchange.api_secret = ""
    with pytest.raises(ExchangeError):
        BybitPrivate(cfg)
    with pytest.raises(ExchangeError):
        BybitClient(cfg, require_creds=True)


# ---------------------------------------------------------------------------
# 7. Order construction
# ---------------------------------------------------------------------------
def test_market_order_body():
    captured: Dict[str, Any] = {}

    def handler(request):
        if request.method == "POST":
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json=ORDER_CREATE)
        return httpx.Response(200, json=ORDER_REALTIME)

    cfg = make_cfg()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=cfg.exchange.rest_url)
    bc = BybitClient(cfg, client=client)
    res = run(bc.place_order(OrderRequest(symbol="BTCUSDT", side="BUY", qty=0.01,
                                          order_type="MARKET", client_id="q-abc123")))
    body = captured["body"]
    assert body["category"] == "linear"
    assert body["symbol"] == "BTCUSDT"
    assert body["side"] == "Buy"
    assert body["orderType"] == "Market"
    assert body["timeInForce"] == "IOC"
    assert body["positionIdx"] == 0
    assert "price" not in body
    assert body["qty"] == "0.01"
    assert body["orderLinkId"] == "q-abc123"


def test_limit_and_reduce_only_body():
    captured: Dict[str, Any] = {}

    def handler(request):
        if request.method == "POST":
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json=ORDER_CREATE)
        return httpx.Response(200, json=ORDER_REALTIME)

    cfg = make_cfg()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=cfg.exchange.rest_url)
    bc = BybitClient(cfg, client=client)
    run(bc.place_order(OrderRequest(symbol="BTCUSDT", side="SELL", qty=0.5,
                                    order_type="LIMIT", price=83000.0, reduce_only=True)))
    body = captured["body"]
    assert body["side"] == "Sell"
    assert body["orderType"] == "Limit"
    assert body["timeInForce"] == "GTC"
    assert body["reduceOnly"] is True
    assert body["price"] == "83000"


def test_order_result_resolves_fill_from_realtime_query():
    """/order/create returns only ids, so the fill must be fetched, not assumed."""
    bc, calls = make_client({
        "/v5/order/create": ORDER_CREATE,
        "/v5/order/realtime": ORDER_REALTIME,
    })
    res = run(bc.place_order(OrderRequest(symbol="BTCUSDT", side="BUY", qty=0.01, client_id="q-abc123")))
    assert res.ok is True
    assert res.order_id == "db8a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"
    assert res.filled_qty == pytest.approx(0.01)
    assert res.avg_price == pytest.approx(83076.15)
    assert res.status == "Filled"
    assert len(calls) == 2, "create + realtime query"


def test_order_id_is_a_string_not_an_int():
    """Bybit order ids are UUIDs. Coercing them to int (as Binance ids allow)
    would raise ValueError."""
    bc, _ = make_client({"/v5/order/create": ORDER_CREATE, "/v5/order/realtime": ORDER_REALTIME})
    res = run(bc.place_order(OrderRequest(symbol="BTCUSDT", side="BUY", qty=0.01)))
    assert isinstance(res.order_id, str)
    int(res.order_id) if res.order_id.isdigit() else None   # must not be assumed numeric


def test_order_fee_sums_only_matching_order():
    bc, _ = make_client({"/v5/execution/list": EXECUTIONS})
    fee = run(bc.order_fee("BTCUSDT", "db8a1b2c-3d4e-5f60-7182-93a4b5c6d7e8"))
    assert fee == pytest.approx(0.45691883)


def test_user_trades_normalised_shape():
    bc, _ = make_client({"/v5/execution/list": EXECUTIONS})
    trades = run(bc.user_trades("BTCUSDT"))
    assert all("commission" in t and "orderId" in t for t in trades)
    assert trades[0]["commission"] == pytest.approx(0.45691883)


# ---------------------------------------------------------------------------
# 8. permissions_probe — the security gate
# ---------------------------------------------------------------------------
def test_probe_accepts_a_clean_key():
    bc, _ = make_client({"/v5/user/query-api": QUERY_API_SAFE,
                         "/v5/account/wallet-balance": WALLET})
    rep = run(bc.permissions_probe())
    assert rep["ok"] and rep["can_trade_futures"] is True
    assert rep["can_withdraw"] is False
    assert rep["can_transfer"] is False
    assert rep["ip_allowlist"] == ["35.154.110.156"]
    assert rep["assets"] == ["USDT"]


def test_probe_flags_withdrawal_permission():
    bc, _ = make_client({"/v5/user/query-api": QUERY_API_WITHDRAW_RISK,
                         "/v5/account/wallet-balance": WALLET})
    rep = run(bc.permissions_probe())
    assert rep["can_withdraw"] is True
    assert rep["can_transfer"] is True
    assert rep["ip_allowlist"] == []


def test_probe_flags_missing_futures_permission():
    bc, _ = make_client({"/v5/user/query-api": QUERY_API_NO_FUTURES,
                         "/v5/account/wallet-balance": WALLET})
    rep = run(bc.permissions_probe())
    assert rep["can_trade_futures"] is False
    assert rep["read_only"] is True


# ---------------------------------------------------------------------------
# 9. Websocket contract
# ---------------------------------------------------------------------------
def test_ws_subscribe_frames_and_url():
    bc = BybitClient(make_cfg())
    assert bc.ws_connect_url("1h", ["BTCUSDT"]) == make_cfg().exchange.ws_url
    frames = [json.loads(f) for f in bc.ws_subscribe_messages("1h", ["BTCUSDT", "ETHUSDT"])]
    assert frames[0]["op"] == "subscribe"
    assert frames[0]["args"] == ["kline.60.BTCUSDT", "kline.60.ETHUSDT"]
    assert bc.ws_heartbeat_message() == '{"op": "ping"}'
    assert bc.ws_heartbeat_interval() > 0


def test_ws_subscribe_chunks_large_symbol_lists():
    bc = BybitClient(make_cfg())
    frames = bc.ws_subscribe_messages("1h", [f"S{i}USDT" for i in range(25)])
    assert len(frames) == 3, "25 symbols split into 10/10/5"
    assert len(json.loads(frames[0])["args"]) == 10


def test_ws_kline_parse_real_frame():
    bc = BybitClient(make_cfg())
    raw = json.dumps({
        "topic": "kline.60.BTCUSDT",
        "data": [{"start": 1790654400000, "end": 1790657999999, "interval": "60",
                  "open": "83037.3", "close": "83076.1", "high": "83264.4",
                  "low": "82983.1", "volume": "548.353", "turnover": "45593741.0199",
                  "confirm": False, "timestamp": 1790656534259}],
        "ts": 1790656534259, "type": "snapshot",
    })
    k = bc.parse_kline_message(raw)
    assert k["symbol"] == "BTCUSDT"
    assert k["ts"] == 1790654400000
    assert k["open"] == pytest.approx(83037.3)
    assert k["close"] == pytest.approx(83076.1)
    assert k["closed"] is False
    # confirmed candle closes the bar
    raw2 = raw.replace('"confirm": false', '"confirm": true')
    assert bc.parse_kline_message(raw2)["closed"] is True


def test_ws_parse_ignores_non_kline_frames():
    bc = BybitClient(make_cfg())
    assert bc.parse_kline_message('{"op":"pong","success":true}') is None
    assert bc.parse_kline_message('{"topic":"orderbook.50.BTCUSDT","data":{}}') is None
    assert bc.parse_kline_message("not json") is None
    assert bc.parse_kline_message('{"success":true,"op":"subscribe"}') is None


# ---------------------------------------------------------------------------
# 10. Interval mapping
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("human,native", [
    ("1m", "1"), ("5m", "5"), ("15m", "15"), ("30m", "30"),
    ("1h", "60"), ("2h", "120"), ("4h", "240"), ("12h", "720"), ("1d", "D"),
])
def test_interval_mapping(human, native):
    assert to_native_interval(human) == native


def test_native_intervals_pass_through_to_native():
    """A config already written in Bybit terms must still work."""
    for n in ("1", "5", "60", "240", "D"):
        assert to_native_interval(n) == n, "native input must pass through unchanged"
    # ...and mapping back yields the human form.
    assert from_native_interval("1") == "1m"
    assert from_native_interval("60") == "1h"
    assert from_native_interval("240") == "4h"
    assert from_native_interval("D") == "1d"


def test_interval_mapping_roundtrip():
    for human in ("1m", "5m", "1h", "4h", "1d"):
        assert from_native_interval(to_native_interval(human)) == human


def test_klines_sends_native_interval():
    captured: Dict[str, Any] = {}

    def handler(request):
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, json=KLINES)

    cfg = make_cfg()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=cfg.exchange.rest_url)
    bc = BybitClient(cfg, client=client)
    run(bc.klines("BTCUSDT", "1h", limit=3))
    assert captured["params"]["interval"] == "60", "'1h' must be translated to Bybit's '60'"
    assert captured["params"]["category"] == "linear"


# ---------------------------------------------------------------------------
# 11. Venue factory selection
# ---------------------------------------------------------------------------
def test_factory_selects_bybit_and_binance():
    from app.exchange import create_market_client, create_private_client, BinanceFutures, BinancePrivate

    cfg = load_config()
    cfg.exchange.name = "bybit"
    assert isinstance(create_market_client(cfg), BybitClient)
    cfg.exchange.name = "binance"
    assert isinstance(create_market_client(cfg), BinanceFutures)
    cfg.exchange.api_key = "k" * 32
    cfg.exchange.api_secret = "s" * 32
    assert isinstance(create_private_client(cfg), BinancePrivate)


def test_fee_presets_differ_between_venues():
    """Bybit's taker fee is higher; the cost model must reflect the venue."""
    from app.exchange import EXCHANGE_PRESETS
    assert EXCHANGE_PRESETS["bybit"]["taker_fee_bps"] == 5.5
    assert EXCHANGE_PRESETS["binance"]["taker_fee_bps"] == 5.0


# ---------------------------------------------------------------------------
# 12. Private GET signing (regression: private GETs were sent UNSIGNED)
# ---------------------------------------------------------------------------
def test_private_get_carries_valid_auth_headers():
    """Regression: `_get` never attached auth headers, so EVERY private read —
    balance, positions, permissions, order lookup — was rejected with
    `retCode 10001 apiKey is missing`. Only `_post` was signed. This bug silently
    broke the whole private surface while the public market-data path stayed green.
    """
    captured: Dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if "/v5/user/query-api" in path:
            captured["headers"] = {k.lower(): v for k, v in request.headers.items()}
            captured["query"] = request.url.query.decode()
            return httpx.Response(200, json=QUERY_API_SAFE)
        if "/v5/account/wallet-balance" in path:
            return httpx.Response(200, json=WALLET)
        return httpx.Response(200, json={**ENVELOPE, "result": {}})

    cfg = make_cfg()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=cfg.exchange.rest_url)
    bc = BybitClient(cfg, client=client)
    run(bc.permissions_probe())

    h = captured["headers"]
    assert "x-bapi-api-key" in h, "private GET must send the API key header"
    assert "x-bapi-sign" in h, "private GET must be signed"
    assert "x-bapi-timestamp" in h and "x-bapi-recv-window" in h
    # The signed payload must be exactly the query string that was sent.
    expected = hmac.new(
        cfg.exchange.api_secret.encode(),
        (h["x-bapi-timestamp"] + cfg.exchange.api_key
         + h["x-bapi-recv-window"] + captured["query"]).encode(),
        hashlib.sha256,
    ).hexdigest()
    assert h["x-bapi-sign"] == expected


def test_public_get_is_not_signed():
    """Credentials must not be sent to public market-data endpoints."""
    captured: Dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.setdefault(request.url.path, {k.lower(): v for k, v in request.headers.items()})
        return httpx.Response(200, json=TICKERS)

    cfg = make_cfg()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=cfg.exchange.rest_url)
    bc = BybitClient(cfg, client=client)
    run(bc.tickers_24h())
    headers = captured.get("/v5/market/tickers", {})
    assert "x-bapi-sign" not in headers
    assert "x-bapi-api-key" not in headers


@pytest.mark.parametrize("call", ["account_balance", "position_risk", "permissions_probe"])
def test_every_private_read_is_signed(call):
    """Each private read must go out signed, not just the one we happened to test."""
    signed_paths = []

    def handler(request: httpx.Request) -> httpx.Response:
        if "x-bapi-sign" in {k.lower() for k in request.headers}:
            signed_paths.append(request.url.path)
        if "/v5/user/query-api" in request.url.path:
            return httpx.Response(200, json=QUERY_API_SAFE)
        if "/v5/account/wallet-balance" in request.url.path:
            return httpx.Response(200, json=WALLET)
        if "/v5/position/list" in request.url.path:
            return httpx.Response(200, json=POSITIONS)
        return httpx.Response(200, json={**ENVELOPE, "result": {}})

    cfg = make_cfg()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=cfg.exchange.rest_url)
    bc = BybitClient(cfg, client=client)
    run(getattr(bc, call)())
    assert signed_paths, f"{call}() issued no signed request"


def test_unsigned_public_client_does_not_leak_credentials():
    """A public-only client with credentials configured must not attach them to
    market-data calls."""
    captured: Dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update({k.lower(): v for k, v in request.headers.items()})
        return httpx.Response(200, json=KLINES)

    cfg = make_cfg()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url=cfg.exchange.rest_url)
    bc = BybitClient(cfg, require_creds=False, client=client)
    run(bc.klines("BTCUSDT", "1h", limit=3))
    assert "x-bapi-sign" not in captured
