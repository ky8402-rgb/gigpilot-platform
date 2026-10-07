from __future__ import annotations

from pathlib import Path

import pytest

from gigpilot import AccountingReconciler, Reconciler
from gpkg.core.config import Config
from gpkg.exchange.base import (
    AccountSnapshot,
    ExchangeAdapter,
    FeeRate,
    Fill,
    Order,
    OrderRequest,
    OrderResult,
    OrderStatus,
    Position,
    Side,
    Ticker,
)


class Adapter(ExchangeAdapter):
    name = "test"

    def __init__(self):
        self.cancelled = []
        self.cancelled_all = []
        self._positions = [
            Position(self.name, "BTCUSDT", Side.BUY, 0.2, 100.0, 101.0, 1.0)
        ]
        self._orders = [
            Order(self.name, "BTCUSDT", "oid-1", "gp-orphan", Side.BUY, 0.2, 0.0, OrderStatus.OPEN)
        ]
        self._fills = [
            Fill(self.name, "BTCUSDT", "close-1", Side.SELL, 0.2, 105.0, 3.0, 0.4, ts_ms=123)
        ]

    async def start(self): pass
    async def stop(self): pass
    async def instruments(self): return []
    async def instrument(self, symbol): raise NotImplementedError
    async def ticker(self, symbol): return Ticker(self.name, symbol, 1, 1, 1)
    async def fee_rate(self, symbol): return FeeRate(self.name, symbol, 1, 1)
    async def account(self): return AccountSnapshot(exchange=self.name)
    async def positions(self): return list(self._positions)
    async def open_orders(self): return list(self._orders)
    async def closed_pnl(self, limit=100): return list(self._fills)
    async def trade_permission(self): return True, ""
    async def set_leverage(self, symbol, leverage): pass
    async def place_order(self, req: OrderRequest): return OrderResult(self.name, req.symbol, "x", req.client_order_id, OrderStatus.OPEN)
    async def cancel_order(self, symbol, order_id): self.cancelled.append((symbol, order_id))
    async def cancel_all(self, symbol): self.cancelled_all.append(symbol)
    async def set_protection(self, symbol, side, qty, take_profit, stop_loss): pass


class Store:
    def __init__(self):
        self.closed_pending = []
        self.applied = []
        self.journaled = []

    def mark_closed_pending(self, *args): self.closed_pending.append(args)
    def match_closed_trade(self, symbol, side, created_ms):
        return {"id": 7} if (symbol, side, created_ms) == ("BTCUSDT", "Sell", 123) else None
    def apply_exchange_pnl(self, *args): self.applied.append(args)
    def journal(self, *args): self.journaled.append(args)


@pytest.mark.asyncio
async def test_reconciliation_uses_adapter_models_and_adapter_cancel():
    a = Adapter()
    store = Store()
    positions = {}
    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"], db_path=":memory:")
    r = Reconciler(cfg, a, store, positions)

    await r.run_once()

    assert r.healthy
    assert r.trade_permissions_ok
    assert positions["BTCUSDT"]["qty"] == pytest.approx(0.2)
    assert positions["BTCUSDT"]["side"] == "Buy"
    assert a.cancelled == [("BTCUSDT", "oid-1")]


@pytest.mark.asyncio
async def test_accounting_uses_normalized_fill_cost_and_verified_pnl():
    a = Adapter()
    store = Store()
    accounting = AccountingReconciler(a, store)

    applied = await accounting.run_once()

    assert applied == 1
    assert store.applied == [(7, 105.0, 3.0, 0.4)]
    assert not store.journaled


def test_orchestrator_routes_recon_accounting_and_kill_cancel_through_adapter():
    source = Path("gigpilot.py").read_text(encoding="utf-8")
    assert "Reconciler(cfg, self.exchange" in source
    assert "AccountingReconciler(self.exchange" in source
    assert "gp.exchange.cancel_all(sym)" in source
