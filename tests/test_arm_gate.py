#!/usr/bin/env python3
"""THE ARM GATE — the last control standing between an idle engine and live order placement.

Regression origin
-----------------
The whole `arm_preflight` / `_arm_gate_check` / `arm` trio had been defined on the **BybitWS** class
instead of **GigPilot**, while reading engine state (`self.portfolio`, `self.reconciler`,
`self.positions`, `self.ws`, ...) that BybitWS does not have, and `GigPilot` had no `arm()` at all.
`POST /api/arm` therefore raised before it could evaluate a single safety condition: the engine
could never be armed through the gate, and the gate itself was unreachable dead code.

These tests pin down both the wiring and the fail-closed behaviour of every blocker, so the control
cannot silently regress again.

Run: python3 tests/test_arm_gate.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def test_gate_methods_live_on_the_engine():
    """Structural: the gate must be on the class that owns the state it reads."""
    import inspect

    import gigpilot as gp

    for name in ("arm", "arm_preflight", "_arm_gate_check"):
        assert hasattr(gp.GigPilot, name), f"GigPilot is missing {name}()"
        assert not hasattr(gp.BybitWS, name), f"{name}() is on BybitWS, where its state does not exist"

    src = inspect.getsource(gp.GigPilot._arm_gate_check)
    for attr in ("self.portfolio", "self.reconciler", "self.markets", "self.ws"):
        assert attr in src, f"arm gate no longer consults {attr}"


@pytest.mark.asyncio
async def test_arm_succeeds_when_every_gate_passes(make_engine):
    engine, _ = await _engine(make_engine)
    ok, reasons = await engine.arm()
    assert ok is True, f"expected arm to pass, got {reasons}"
    assert engine.armed is True
    assert engine.store.kv_get("arm_state") == "armed"


@pytest.mark.asyncio
async def test_arm_is_idempotent(make_engine):
    engine, _ = await _engine(make_engine)
    await engine.arm()
    ok, reasons = await engine.arm()
    assert ok is True
    assert any(r.get("code") == "ALREADY_ARMED" for r in reasons), reasons


@pytest.mark.asyncio
async def test_blocks_when_not_authorized_to_trade(make_engine):
    """Authenticating is not authorizing — the exact production state recorded by /health.

    The key reads positions and orders successfully, so the reconciler is `healthy`; only the
    permission probe reveals that order placement would be refused. Arming on this key would create
    an engine that reports itself live and then fails on every entry.
    """
    engine, fake = await _engine(make_engine, trade_permission=False)
    ok, reasons = await engine.arm()
    assert ok is False, "armed on a key that cannot place futures orders"
    assert engine.armed is False
    codes = {r["code"] for r in reasons}
    assert "TRADE_PERMISSION_INVALID" in codes, reasons


@pytest.mark.asyncio
async def test_low_capital_does_not_block_the_arm(make_engine):
    """NO HARDCODED ACCOUNT FLOOR.

    `min_arm_capital_usdt` (67 USDT) refused to arm an operator whose capital was usable at a smaller
    size, and a constant cannot know what the venue will accept. The real threshold is a PER-ORDER
    minimum read from the instrument spec, so below it the engine arms and stays IDLE while the
    dashboard says why. Refusing the ARM also buried the true reason behind a number the operator
    could never reconcile with Bybit's own screen.
    """
    engine, _ = await _engine(make_engine, equity=1.0)
    # What boot reads from the instrument spec (`lotSizeFilter.minNotionalValue`). Seeded explicitly
    # because this fixture does not run the instrument loop, and the assertion is about the ARM
    # decision rather than about fixture wiring.
    engine.min_notional = {"BTCUSDT": 5.0, "ETHUSDT": 5.0}
    ok, reasons = await engine.arm()
    assert "INSUFFICIENT_CAPITAL" not in {r["code"] for r in reasons}, reasons
    assert ok is True, f"low capital must not refuse the arm: {reasons}"
    assert engine.positioning_status == "INSUFFICIENT_EXCHANGE_MINIMUM", (
        "the engine must say WHY it cannot size, not fail silently"
    )


@pytest.mark.asyncio
async def test_blocks_on_stale_market_data(make_engine):
    from gpkg.core.clock import now_ms

    engine, _ = await _engine(make_engine)
    old = now_ms() - 60_000  # a minute old, well beyond the configured staleness window
    for ms in engine.markets.values():
        ms.ts_book_ms = old
        ms.ts_tick_ms = old
    ok, reasons = await engine.arm()
    assert ok is False
    assert "MARKET_DATA_STALE" in {r["code"] for r in reasons}, reasons


@pytest.mark.asyncio
async def test_blocks_when_no_net_edge(make_engine):
    """The core 'DO NOTHING' rule: no verified net edge above hurdle means no arming."""
    engine, _ = await _engine(make_engine, fair_shift_bps=0.0, hurdle_bps=50.0)
    ok, reasons = await engine.arm()
    assert ok is False
    assert "NET_EDGE_GATE_UNHEALTHY" in {r["code"] for r in reasons}, reasons


@pytest.mark.asyncio
async def test_blocks_when_market_data_missing(make_engine):
    engine, _ = await _engine(make_engine)
    for ms in engine.markets.values():
        ms.bids, ms.asks = [], []
    ok, reasons = await engine.arm()
    assert ok is False
    assert "MARKET_DATA_INVALID" in {r["code"] for r in reasons}, reasons


@pytest.mark.asyncio
async def test_blocks_when_websocket_not_connected(make_engine):
    engine, _ = await _engine(make_engine)
    engine.ws._public_ok = False
    engine.ws._private_ok = False
    ok, reasons = await engine.arm()
    assert ok is False
    assert "BYBIT_CONNECTIVITY_INVALID" in {r["code"] for r in reasons}, reasons


@pytest.mark.asyncio
async def test_blocks_on_hedge_position_mode(make_engine):
    engine, _ = await _engine(make_engine)
    engine.position_mode = "hedge"
    ok, reasons = await engine.arm()
    assert ok is False
    assert "POSITION_MODE_INVALID" in {r["code"] for r in reasons}, reasons


@pytest.mark.asyncio
async def test_blocked_arm_is_journalled(make_engine):
    """A refused ARM must leave an audit trail — that is what makes it reviewable.

    Blocked here by STALE MARKET DATA rather than by capital: capital is no longer a blocking gate,
    so a capital-based fixture would assert nothing.
    """
    from gpkg.core.clock import now_ms

    engine, _ = await _engine(make_engine)
    old = now_ms() - 60_000
    for ms in engine.markets.values():
        ms.ts_book_ms = old
        ms.ts_tick_ms = old
    await engine.arm()
    rows = engine.store._conn.execute(
        "SELECT COUNT(*) FROM journal WHERE kind='ARM_BLOCKED'"
    ).fetchone()
    assert rows[0] >= 1, "blocked ARM left no audit record"


@pytest.mark.asyncio
async def test_arm_never_places_an_order(make_engine):
    """Preflight must be strictly non-mutating with respect to the exchange."""
    engine, fake = await _engine(make_engine)
    await engine.arm()
    assert fake.placed_orders == [], f"arm preflight placed orders: {fake.placed_orders}"


async def _engine(make_engine, **kw):
    engine, fake = make_engine(**kw)
    return engine, fake
