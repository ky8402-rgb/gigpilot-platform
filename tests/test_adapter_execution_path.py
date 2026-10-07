from __future__ import annotations

from pathlib import Path

import pytest

from gpkg.core.config import Config
from gpkg.exchange.base import (
    AccountSnapshot,
    ExchangeAdapter,
    FeeRate,
    OrderRequest,
    OrderResult,
    OrderStatus,
    Position,
    Side,
    Ticker,
)
from gpkg.execution.executor import Executor


class RecordingAdapter(ExchangeAdapter):
    name = "recording"

    def __init__(self, fail_protection: bool = False):
        self.orders: list[OrderRequest] = []
        self.protections: list[tuple] = []
        self.fail_protection = fail_protection

    async def start(self): pass
    async def stop(self): pass
    async def instruments(self): return []
    async def instrument(self, symbol): raise NotImplementedError
    async def ticker(self, symbol): return Ticker(self.name, symbol, 1, 1, 1)
    async def fee_rate(self, symbol): return FeeRate(self.name, symbol, 1, 1)
    async def account(self): return AccountSnapshot(exchange=self.name)
    async def positions(self) -> list[Position]: return []
    async def open_orders(self): return []
    async def closed_pnl(self, limit=100): return []
    async def trade_permission(self): return True, ""
    async def set_leverage(self, symbol, leverage): pass

    async def place_order(self, req: OrderRequest) -> OrderResult:
        self.orders.append(req)
        return OrderResult(
            exchange=self.name, symbol=req.symbol, order_id=f"o{len(self.orders)}",
            client_order_id=req.client_order_id, status=OrderStatus.OPEN,
        )

    async def cancel_order(self, symbol, order_id): pass
    async def cancel_all(self, symbol): pass

    async def set_protection(self, symbol, side, qty, take_profit, stop_loss):
        self.protections.append((symbol, side, qty, take_profit, stop_loss))
        if self.fail_protection:
            raise RuntimeError("protection failed")


def executor(adapter: ExchangeAdapter) -> Executor:
    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"], db_path=":memory:")
    return Executor(cfg, adapter, {"BTCUSDT": 0.001}, min_sizes={"BTCUSDT": 0.001})


@pytest.mark.asyncio
async def test_live_entry_uses_normalized_adapter_request_and_native_protection():
    a = RecordingAdapter()
    ex = executor(a)
    out = await ex.open_protected("BTCUSDT", "Buy", 0.1234, 110.0, 95.0)

    assert len(a.orders) == 1
    req = a.orders[0]
    assert req.exchange == "recording"
    assert req.side is Side.BUY
    assert req.qty == "0.123"
    assert req.reduce_only is False
    assert req.client_order_id and req.client_order_id.startswith("gp-")
    assert a.protections == [("BTCUSDT", Side.BUY, "0.123", "110.0", "95.0")]
    assert out["qty"] == "0.123"


@pytest.mark.asyncio
async def test_close_market_uses_adapter_reduce_only():
    a = RecordingAdapter()
    ex = executor(a)
    await ex.close_market("BTCUSDT", "Buy", "0.123")
    assert len(a.orders) == 1
    assert a.orders[0].side is Side.SELL
    assert a.orders[0].reduce_only is True


@pytest.mark.asyncio
async def test_protection_failure_fails_closed_and_unwinds_through_adapter():
    a = RecordingAdapter(fail_protection=True)
    ex = executor(a)
    with pytest.raises(RuntimeError, match="PROTECTION_FAILED_POSITION_FLATTENED"):
        await ex.open_protected("BTCUSDT", "Buy", 0.123, 110.0, 95.0)

    assert len(a.orders) == 2
    assert a.orders[0].reduce_only is False
    assert a.orders[1].reduce_only is True
    assert a.orders[1].side is Side.SELL


def test_production_orchestrator_passes_adapter_not_raw_rest_to_executor():
    source = Path("gigpilot.py").read_text(encoding="utf-8")
    assert "self.exchange = BybitAdapter(cfg, rest=self.rest" in source
    assert "Executor(self.cfg, self.exchange" in source
    assert "Executor(self.cfg, self.rest, self.step_size" not in source
