from __future__ import annotations

import pytest

from gpkg.core.config import Config
from gpkg.exchange.adapters.bybit import BybitAdapter


class PermissionREST:
    async def api_info(self):
        return self.info

    def __init__(self, info):
        self.info = info


@pytest.mark.parametrize(
    "permissions",
    [
        {"ContractTrade": ["Order"], "Wallet": ["Withdraw"]},
        {"ContractTrade": ["Order"], "Spot": ["Withdraw"]},
        {"ContractTrade": ["Order"], "Wallet": {"Withdraw": True}},
    ],
)
@pytest.mark.asyncio
async def test_bybit_trade_permission_rejects_withdrawal_capable_keys(permissions):
    rest = PermissionREST({"readOnly": 0, "permissions": permissions})
    adapter = BybitAdapter(
        Config(api_key="k", api_secret="s", symbols=["BTCUSDT"]),
        rest=rest,
    )
    ok, reason = await adapter.trade_permission()
    assert ok is False
    assert "withdrawal permission" in reason


@pytest.mark.asyncio
async def test_bybit_trade_permission_requires_contract_order():
    rest = PermissionREST({"readOnly": 0, "permissions": {"ContractTrade": ["Position"]}})
    adapter = BybitAdapter(
        Config(api_key="k", api_secret="s", symbols=["BTCUSDT"]),
        rest=rest,
    )
    ok, reason = await adapter.trade_permission()
    assert ok is False
    assert "ContractTrade" in reason


def test_config_defaults_are_fail_closed_for_execution(monkeypatch):
    monkeypatch.setenv("BYBIT_API_KEY", "k")
    monkeypatch.setenv("BYBIT_API_SECRET", "s")
    monkeypatch.delenv("GIGPILOT_EXECUTION_MODE", raising=False)
    monkeypatch.delenv("GIGPILOT_LIVE_ARMED", raising=False)
    cfg = Config.from_env()
    # LIVE-ONLY: the platform has no simulation mode, so the default IS live. The exchange
    # boundary is still closed, because `live_armed` defaults to False.
    assert cfg.execution_mode == "live"
    assert cfg.live_armed is False
    assert cfg.max_daily_loss_pct == 2.0
    assert cfg.taker_min_net_edge_bps == 12.0
    assert cfg.max_signal_to_ack_drift_bps == 2.5


def test_a_closed_boundary_is_idle_not_fatal(monkeypatch):
    """LIVE-ONLY: `GIGPILOT_LIVE_ARMED=0` keeps the exchange boundary CLOSED.

    This asserted SystemExit before. It no longer can, and must not: the mode is now unconditionally
    "live", so a closed boundary is the NORMAL resting state rather than a misconfiguration — the
    deploy pins LIVE_ARMED=0 deliberately. A fatal here would crash-loop every rollout. The protection
    is unchanged: crossing still requires live_armed AND the runtime secret AND an owner ARM.
    """
    monkeypatch.setenv("BYBIT_API_KEY", "k")
    monkeypatch.setenv("BYBIT_API_SECRET", "s")
    monkeypatch.setenv("GIGPILOT_EXECUTION_MODE", "live")
    monkeypatch.setenv("GIGPILOT_LIVE_ARMED", "0")

    cfg = Config.from_env()  # must NOT exit
    assert cfg.execution_mode == "live"
    assert cfg.live_armed is False


def test_a_non_live_mode_is_refused_outright(monkeypatch):
    """Live-only means the simulator cannot be reached BY CONFIGURATION. Any other value fails loudly
    at boot rather than silently falling back to a mode that looks safe."""
    monkeypatch.setenv("BYBIT_API_KEY", "k")
    monkeypatch.setenv("GIGPILOT_LIVE_ARMED", "1")
    for mode in ("paper", "sim", "testnet", "demo", "mock"):
        monkeypatch.setenv("GIGPILOT_EXECUTION_MODE", mode)
        with pytest.raises(SystemExit) as exc:
            Config.from_env()
        assert exc.value.code == 2, mode
