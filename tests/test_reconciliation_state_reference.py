from __future__ import annotations

import pytest

from gigpilot import GigPilot
from gpkg.core.config import Config


class FakeRest:
    async def wallet(self):
        return {
            "list": [{
                "totalEquity": "1000",
                "accountIMRate": "0.05",
            }]
        }

    async def positions(self):
        return [{
            "symbol": "BTCUSDT",
            "size": "0.01",
            "markPrice": "50000",
            "avgPrice": "49000",
            "side": "Buy",
        }]


@pytest.mark.asyncio
async def test_refresh_portfolio_preserves_reconciler_position_reference(tmp_path):
    cfg = Config(
        api_key="k",
        api_secret="s",
        symbols=["BTCUSDT"],
        db_path=str(tmp_path / "state.db"),
    )
    gp = GigPilot(cfg)
    gp.rest = FakeRest()

    shared = gp.positions
    assert gp.reconciler.positions is shared

    await gp._refresh_portfolio()

    # Reconciler must observe the same live dictionary after refresh. Rebinding
    # gp.positions would strand reconciliation on the pre-refresh object.
    assert gp.positions is shared
    assert gp.reconciler.positions is shared
    assert gp.reconciler.positions["BTCUSDT"]["qty"] == pytest.approx(0.01)
