from __future__ import annotations

import pytest

from gigpilot import Reconciler
from gpkg.core.config import Config


class Rest:
    async def positions(self): return []
    async def open_orders(self): return []
    async def api_info(self):
        # This is the shape BybitREST.api_info() actually returns: _req already removed
        # the top-level {retCode,result} envelope.
        return {"readOnly": 0, "permissions": {"ContractTrade": ["Order", "Position"]}}


class Store:
    def mark_closed_pending(self, *args, **kwargs): pass


@pytest.mark.asyncio
async def test_reconciler_accepts_unwrapped_trade_permission_payload():
    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"], db_path=":memory:")
    rec = Reconciler(cfg, Rest(), Store(), {})
    await rec.run_once()
    assert rec.healthy is True
    assert rec.trade_permissions_ok is True
    assert rec.trade_permissions_error is None


@pytest.mark.asyncio
async def test_reconciler_still_fails_closed_without_contract_trade():
    class NoTrade(Rest):
        async def api_info(self):
            return {"readOnly": 0, "permissions": {"ContractTrade": []}}

    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"], db_path=":memory:")
    rec = Reconciler(cfg, NoTrade(), Store(), {})
    await rec.run_once()
    assert rec.healthy is True
    assert rec.trade_permissions_ok is False
    assert "lacks the ContractTrade permission" in (rec.trade_permissions_error or "")
