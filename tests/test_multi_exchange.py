#!/usr/bin/env python3
"""MULTI-EXCHANGE LAYER — credential security, venue parsing, and fail-closed routing.

Scope note: these tests use RECORDED SHAPES taken from the live public APIs (see
`scripts/verify_exchange_adapters.py`, which exercises the real endpoints). A fixture only proves the
adapter agrees with my reading of the wire format; the live script is what proves the reading is
right. Both are needed — the live one to establish correctness, these to keep it from regressing
without a network dependency.

Run: python3 -m pytest tests/test_multi_exchange.py -q
"""
from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.exchange.base import (
    AccountSnapshot,
    CredentialsMissing,
    OrderRequest,
    OrderType,
    Side,
)
from gpkg.exchange.credentials import (
    CredentialStore,
    ExchangeCredential,
    redact,
)
from gpkg.exchange.registry import ExchangeRegistry

MASTER = "test-master-key-with-enough-entropy-for-stretching"


def store(tmp_path: Path, key: str = MASTER) -> CredentialStore:
    return CredentialStore(path=str(tmp_path / "creds.enc"), master_key=key)


def cred(**over) -> ExchangeCredential:
    base = dict(exchange="bybit", api_key="AK1234567890", api_secret="SK-very-secret-value",
                allow_trade=True)
    base.update(over)
    return ExchangeCredential(**base)


# =============================================================================================
# Credential security
# =============================================================================================
def test_round_trip(tmp_path):
    s = store(tmp_path)
    s.upsert(cred())
    got = s.get("bybit")
    assert got is not None
    assert got.api_key == "AK1234567890"
    assert got.api_secret == "SK-very-secret-value"


def test_secrets_are_not_stored_in_plaintext(tmp_path):
    s = store(tmp_path)
    s.upsert(cred(api_secret="UNMISTAKABLE_SECRET_MARKER"))
    blob = (tmp_path / "creds.enc").read_bytes()
    assert b"UNMISTAKABLE_SECRET_MARKER" not in blob, "secret found in the file in the clear"
    assert b"AK1234567890" not in blob


def test_wrong_master_key_raises_rather_than_returning_empty(tmp_path):
    """Returning {} here would look identical to 'no exchanges connected' and silently disable
    trading instead of reporting a broken store."""
    store(tmp_path).upsert(cred())
    bad = store(tmp_path, key="a-completely-different-master-key")
    with pytest.raises(CredentialsMissing):
        bad.load()


def test_missing_master_key_is_a_hard_error(tmp_path, monkeypatch):
    for v in ("GIGPILOT_MASTER_KEY", "EXCHANGE_CREDENTIAL_MASTER_KEY"):
        monkeypatch.delenv(v, raising=False)
    s = CredentialStore(path=str(tmp_path / "c.enc"))
    assert s.is_configured() is False
    with pytest.raises(CredentialsMissing):
        s.load()  # no plaintext fallback, ever


def test_withdrawal_enabled_credential_is_refused_at_write_time(tmp_path):
    """A trading key must never be able to withdraw. Enforced on write because a policy expressed
    only as a default is a policy that eventually gets flipped."""
    with pytest.raises(ValueError, match="withdrawal-enabled"):
        store(tmp_path).upsert(cred(allow_withdraw=True))


def test_empty_key_or_secret_is_refused(tmp_path):
    with pytest.raises(ValueError):
        store(tmp_path).upsert(cred(api_secret=""))


def test_file_permissions_are_0600(tmp_path):
    store(tmp_path).upsert(cred())
    mode = stat.S_IMODE(os.stat(tmp_path / "creds.enc").st_mode)
    assert mode == 0o600, f"expected 0600, got {oct(mode)}"


def test_redact_never_reveals_a_usable_secret():
    assert redact("") == "<unset>"
    assert redact(None) == "<unset>"
    short = redact("abc123")
    assert "abc123" not in short
    long = redact("AKIAIOSFODNN7EXAMPLEKEY")
    assert "IOSFODNN7EXAMPLE" not in long
    assert long.startswith("AKIA")


def test_describe_never_includes_the_secret():
    d = cred(api_secret="SUPERSECRETVALUE").describe()
    assert "SUPERSECRETVALUE" not in json.dumps(d)
    assert d["has_passphrase"] is False


def test_remove(tmp_path):
    s = store(tmp_path)
    s.upsert(cred())
    assert s.remove("bybit") is True
    assert s.remove("bybit") is False
    assert s.get("bybit") is None


# =============================================================================================
# Instrument parsing (shapes recorded from live APIs)
# =============================================================================================
BINANCE_PERP = {
    "symbol": "BTCUSDT", "pair": "BTCUSDT", "contractType": "PERPETUAL", "status": "TRADING",
    "baseAsset": "BTC", "quoteAsset": "USDT",
    "filters": [{"filterType": "PRICE_FILTER", "tickSize": "0.10"},
                {"filterType": "LOT_SIZE", "minQty": "0.001", "stepSize": "0.001"}],
}
BINANCE_QUARTERLY = {
    "symbol": "BTCUSDT_261225", "pair": "BTCUSDT", "contractType": "CURRENT_QUARTER",
    "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USDT",
    "filters": [{"filterType": "PRICE_FILTER", "tickSize": "0.10"},
                {"filterType": "LOT_SIZE", "minQty": "0.001", "stepSize": "0.001"}],
}

KUCOIN_CONTRACT = {
    "symbol": "XBTUSDTM", "baseCurrency": "XBT", "quoteCurrency": "USDT", "status": "Open",
    "lotSize": 1, "tickSize": 0.1, "multiplier": 0.001, "initialMargin": 0.01,
    "takerFeeRate": 0.0006, "makerFeeRate": 0.0002,
}

BYBIT_PERP = {
    "symbol": "BTCUSDT", "baseCoin": "BTC", "quoteCoin": "USDT", "status": "Trading",
    "contractType": "LinearPerpetual",
    "lotSizeFilter": {"qtyStep": "0.001", "minOrderQty": "0.001"},
    "priceFilter": {"tickSize": "0.10"},
    "leverageFilter": {"maxLeverage": "150"},
}


def test_binance_parses_perpetual():
    from gpkg.exchange.adapters.binance import BinanceAdapter
    a = BinanceAdapter()
    i = a._parse(BINANCE_PERP)
    assert i is not None
    assert i.unified == "BTC/USDT"
    assert i.qty_step == "0.001" and i.min_qty == "0.001" and i.tick_size == "0.10"
    assert i.is_perpetual() and i.tradeable()


def test_binance_dated_future_does_not_collide_with_the_perpetual():
    """Live bug: BTCUSDT, BTCUSDT_261225 and BTCUSDT_270326 all mapped to 'BTC/USDT', so venue
    selection could route a perpetual strategy into a quarterly contract."""
    from gpkg.exchange.adapters.binance import BinanceAdapter
    a = BinanceAdapter()
    perp = a._parse(BINANCE_PERP)
    qtr = a._parse(BINANCE_QUARTERLY)
    assert perp.unified != qtr.unified, "dated future collides with the perpetual"
    assert qtr.unified == "BTC/USDT:261225"
    assert qtr.is_perpetual() is False, "a quarterly future must not be treated as a perpetual"
    assert qtr.tradeable() is False


def test_binance_malformed_filters_are_skipped_not_guessed():
    from gpkg.exchange.adapters.binance import BinanceAdapter
    assert BinanceAdapter()._parse({"symbol": "XUSDT", "filters": []}) is not None
    bad = BinanceAdapter()._parse({"symbol": "XUSDT", "filters": [], "contractType": "PERPETUAL"})
    assert bad.tradeable() is False, "missing step/tick must not be tradeable"


def test_kucoin_parses_contract_and_derives_leverage_from_margin():
    from gpkg.exchange.adapters.kucoin import KucoinAdapter
    i = KucoinAdapter()._parse(KUCOIN_CONTRACT)
    assert i is not None
    assert i.unified == "BTC/USDT", "XBT must map to BTC"
    assert i.base == "XBT"
    # Quantities are CONTRACTS on KuCoin; lotSize is both step and minimum.
    assert i.qty_step == "1" and i.min_qty == "1"
    assert i.tick_size == "0.1"
    assert i.max_leverage == pytest.approx(100.0)  # 1 / 0.01
    assert i.tradeable()


def test_kucoin_symbol_mapping_round_trips():
    from gpkg.exchange.adapters.kucoin import KucoinAdapter
    a = KucoinAdapter()
    assert a.unified_to_native("BTC/USDT") == "XBTUSDTM"
    assert a.unified_to_native("ETH/USDT") == "ETHUSDTM"
    assert a.unified_to_native("NOTAPAIR") is None


def test_bybit_parses_perpetual():
    from gpkg.core.config import Config
    from gpkg.exchange.adapters.bybit import BybitAdapter
    a = BybitAdapter(Config(api_key="k", api_secret="s", symbols=[], db_path=":memory:"))
    i = a._parse_instrument(BYBIT_PERP)
    assert i is not None
    assert i.unified == "BTC/USDT"
    assert i.max_leverage == pytest.approx(150.0)
    assert i.tradeable()


# =============================================================================================
# Order request safety
# =============================================================================================
def test_entry_order_requires_a_client_order_id():
    """Without it a retry after a timeout cannot be deduplicated and becomes a double position."""
    with pytest.raises(ValueError, match="client_order_id"):
        OrderRequest(exchange="bybit", symbol="BTCUSDT", side=Side.BUY, qty="0.1").validate()


def test_reduce_only_order_may_omit_client_order_id():
    OrderRequest(exchange="bybit", symbol="BTCUSDT", side=Side.SELL, qty="0.1",
                 reduce_only=True).validate()


def test_non_positive_qty_is_refused():
    with pytest.raises(ValueError, match="positive"):
        OrderRequest(exchange="bybit", symbol="BTCUSDT", side=Side.BUY, qty="0",
                     client_order_id="x").validate()


def test_limit_order_requires_a_price():
    with pytest.raises(ValueError, match="price"):
        OrderRequest(exchange="bybit", symbol="BTCUSDT", side=Side.BUY, qty="1",
                     order_type=OrderType.LIMIT, client_order_id="x").validate()


# =============================================================================================
# Routing / eligibility — fail closed
# =============================================================================================
class FakeAdapter:
    """Minimal adapter double. Only `account()` and lifecycle are needed for routing tests."""

    def __init__(self, name, snapshot):
        self.name = name
        self._snap = snapshot

    async def start(self): pass
    async def stop(self): pass

    async def account(self):
        return self._snap

    async def instruments(self):
        return []


def snap(name, **over) -> AccountSnapshot:
    s = AccountSnapshot(exchange=name, read_ok=True, trade_permission_ok=True,
                        equity_usd=1000.0, available_usd=1000.0)
    for k, v in over.items():
        setattr(s, k, v)
    return s


@pytest.mark.asyncio
async def test_eligibility_denies_by_default():
    reg = ExchangeRegistry([FakeAdapter("x", AccountSnapshot(exchange="x"))])
    v = (await reg.evaluate_eligibility())[0]
    assert v.eligible is False
    assert "read failed" in v.reason


@pytest.mark.asyncio
async def test_eligibility_requires_proven_trade_permission():
    """The live account is exactly this shape: reads fine, cannot place a futures order."""
    reg = ExchangeRegistry([FakeAdapter("bybit", snap("bybit", trade_permission_ok=False,
                                                     permission_error="lacks ContractTrade"))])
    v = (await reg.evaluate_eligibility())[0]
    assert v.eligible is False
    assert "trade not permitted" in v.reason


@pytest.mark.asyncio
async def test_withdraw_enabled_venue_is_refused():
    reg = ExchangeRegistry([FakeAdapter("binance", snap("binance", withdraw_enabled=True))])
    v = (await reg.evaluate_eligibility())[0]
    assert v.eligible is False
    assert "withdraw" in v.reason


@pytest.mark.asyncio
async def test_zero_balance_venue_is_not_eligible():
    reg = ExchangeRegistry([FakeAdapter("kucoin", snap("kucoin", equity_usd=0.0, available_usd=0.0))])
    assert (await reg.evaluate_eligibility())[0].eligible is False


@pytest.mark.asyncio
async def test_allocation_is_empty_when_nothing_is_eligible():
    reg = ExchangeRegistry([FakeAdapter("bybit", snap("bybit", trade_permission_ok=False))])
    plan = await reg.allocate(500.0)
    assert plan.allocations == {}
    assert plan.allocated_usd == 0.0
    assert len(plan.skipped) == 1


@pytest.mark.asyncio
async def test_allocation_never_exceeds_budget_or_available():
    reg = ExchangeRegistry([
        FakeAdapter("a", snap("a", equity_usd=10_000, available_usd=10_000)),
        FakeAdapter("b", snap("b", equity_usd=10_000, available_usd=10_000)),
    ])
    plan = await reg.allocate(300.0)
    assert plan.allocated_usd <= 300.0 + 1e-9
    assert plan.allocations == {"a": pytest.approx(150.0), "b": pytest.approx(150.0)}


@pytest.mark.asyncio
async def test_allocation_respects_a_small_venue_balance():
    """The venue with less free cash must not be handed more than it holds."""
    reg = ExchangeRegistry([
        FakeAdapter("rich", snap("rich", equity_usd=100_000, available_usd=100_000)),
        FakeAdapter("poor", snap("poor", equity_usd=100.0, available_usd=100.0)),
    ])
    plan = await reg.allocate(1000.0)
    assert plan.allocations["poor"] <= 100.0 + 1e-9
    assert plan.allocated_usd <= 1000.0 + 1e-9


@pytest.mark.asyncio
async def test_only_eligible_venues_receive_capital():
    reg = ExchangeRegistry([
        FakeAdapter("good", snap("good", equity_usd=500, available_usd=500)),
        FakeAdapter("bad", snap("bad", trade_permission_ok=False, equity_usd=500, available_usd=500)),
    ])
    plan = await reg.allocate(200.0)
    assert "bad" not in plan.allocations
    assert "good" in plan.allocations
    assert plan.allocated_usd <= 200.0 + 1e-9


@pytest.mark.asyncio
async def test_negative_or_zero_budget_allocates_nothing():
    reg = ExchangeRegistry([FakeAdapter("a", snap("a"))])
    assert (await reg.allocate(0.0)).allocations == {}
    assert (await reg.allocate(-50.0)).allocations == {}
