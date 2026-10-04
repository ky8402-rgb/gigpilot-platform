from __future__ import annotations

import pytest

from gpkg.core.config import Config
from gpkg.exchange.adapters.bybit import BybitAdapter


class Rest:
    async def closed_pnl(self, limit=100):
        return [{
            "symbol": "BTCUSDT", "orderId": "o1", "side": "Sell", "qty": "0.2",
            "avgExitPrice": "105", "closedPnl": "3.0", "openFee": "0.12",
            "closeFee": "0.18", "createdTime": "123",
        }]


@pytest.mark.asyncio
async def test_bybit_closed_fill_preserves_round_trip_open_and_close_fees():
    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"], db_path=":memory:")
    fills = await BybitAdapter(cfg, rest=Rest()).closed_pnl()
    assert len(fills) == 1
    assert fills[0].fees == pytest.approx(0.30)
    assert fills[0].closed_pnl == pytest.approx(3.0)
