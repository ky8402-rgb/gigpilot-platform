#!/usr/bin/env python3
"""EXCHANGE-NATIVE RISK BOUNDS — protection on the ENTRY order, and Cancel on Disconnect.

WHY THIS EXISTS
---------------
The engine held credentials in memory only, so a restart left it unable to sign anything. That is fine
while flat and catastrophic otherwise: the previous entry sequence placed the order and then made a
SECOND call to register TP/SL, and a crash in that interval left a naked leveraged position that the
local daemon could no longer close, because it no longer had a secret to sign with.

Attaching `takeProfit`/`stopLoss` to the entry order moves the bound to the venue — the only party
still running and still able to act. Cancel on Disconnect covers the OTHER half: the venue cancels open
UNFILLED orders if our connection drops. CoD does not touch positions and native TP/SL does not cancel
resting orders; the two cover different failure modes and neither substitutes for the other.

Verified against the official Bybit V5 docs, not from memory:
  * POST /v5/order/create accepts `takeProfit`, `stopLoss`, `tpTriggerBy`, `slTriggerBy`, `tpslMode`
    (its own linear example sends exactly this shape), and `timeInForce: PostOnly` alongside them —
    so resting passively and being protected from the instant of the fill are NOT in tension.
  * POST /v5/order/disconnected-cancel-all with `{"disconnectedCancelAll": true}` is Cancel on
    Disconnect.
  * `tpOrderType` accepts only Market or Limit — there is NO post-only TP/SL leg. This is why
    "enforce PostOnly for exits" and "exchange-native TP/SL" cannot both hold; see the report.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.api.compat import BOOT_WARNING, _with_boot_warning
from gpkg.core.config import Config
from gpkg.exchange.bybit_rest import BybitREST
from gpkg.execution.executor import Executor

TICK = 0.1
REF = 25_000.0


class _RecordingREST:
    """Stands in for BybitREST and records the exact body the entry path would send."""

    def __init__(self, fail_first_with: str | None = None) -> None:
        self.calls: list[dict] = []
        self._fail_first_with = fail_first_with

    async def place_order(self, **kw):
        self.calls.append(kw)
        if self._fail_first_with and len(self.calls) == 1:
            raise RuntimeError(self._fail_first_with)
        return {"orderId": "oid-1", "orderLinkId": kw.get("orderLinkId")}


def _executor(rest) -> Executor:
    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"])
    return Executor(cfg, rest, {"BTCUSDT": 0.001})


# ------------------------------------------------------------------------------------------------
# 1. THE REQUIRED ASSERTION: TP/SL are structurally present in the order payload
# ------------------------------------------------------------------------------------------------
def test_entry_payload_carries_stoploss_and_takeprofit():
    rest = _RecordingREST()
    ex = _executor(rest)
    protection = ex._protection_kwargs("Buy", REF, tp_bps=30.0, sl_bps=20.0, tick_size=TICK)

    asyncio.run(ex._submit_order("BTCUSDT", "Buy", "0.001", 0, "link-1", protection=protection))

    body = rest.calls[-1]
    assert "stopLoss" in body and "takeProfit" in body, (
        "every entry must carry its protection on the ORDER itself, so the venue arms it at the "
        "instant of the fill rather than one round trip later"
    )
    assert body["tpTriggerBy"] == "MarkPrice" and body["slTriggerBy"] == "MarkPrice"
    assert body["tpslMode"] == "Full"


def test_the_attached_levels_sit_on_the_correct_side_of_the_entry():
    """A stop at or inside the entry is an instant stop-out, so this is a correctness check, not a
    formatting one. Cross-checked against the level the order rests at, not the mid.
    """
    rest = _RecordingREST()
    ex = _executor(rest)
    protection = ex._protection_kwargs("Buy", REF, tp_bps=30.0, sl_bps=20.0, tick_size=TICK)
    asyncio.run(ex._submit_order("BTCUSDT", "Buy", "0.001", 0, "link-2", protection=protection))

    body = rest.calls[-1]
    tp, sl = float(body["takeProfit"]), float(body["stopLoss"])
    assert sl < REF < tp, f"stop {sl} / entry {REF} / target {tp}"
    assert tp == pytest.approx(REF * 1.003, rel=1e-6)
    assert sl == pytest.approx(REF * 0.998, rel=1e-6)


def test_a_sell_is_mirrored():
    rest = _RecordingREST()
    ex = _executor(rest)
    protection = ex._protection_kwargs("Sell", REF, tp_bps=30.0, sl_bps=20.0, tick_size=TICK)
    asyncio.run(ex._submit_order("BTCUSDT", "Sell", "0.001", 0, "link-3", protection=protection))

    body = rest.calls[-1]
    assert float(body["takeProfit"]) < REF < float(body["stopLoss"])


def test_a_degenerate_estimate_cannot_produce_a_zero_distance_stop():
    """The geometry guard must hold for the attached levels too — a maker fill happens at the rest
    price, which is exactly the case that made a mid-based stop reachable at the entry itself.
    """
    ex = _executor(_RecordingREST())
    for tp_bps, sl_bps in ((0.0, 0.0), (1e-9, 1e-9)):
        p = ex._protection_kwargs("Buy", REF, tp_bps=tp_bps, sl_bps=sl_bps, tick_size=TICK)
        assert float(p["stopLoss"]) < REF, f"tp={tp_bps} sl={sl_bps} produced a stop at/inside entry"
        assert float(p["takeProfit"]) > REF


def test_no_protection_is_attached_without_bps_inputs():
    """Omitting protection must degrade to today's behaviour, never to a malformed order."""
    ex = _executor(_RecordingREST())
    assert ex._protection_kwargs("Buy", REF, tp_bps=None, sl_bps=20.0, tick_size=TICK) == {}
    assert ex._protection_kwargs("Buy", 0.0, tp_bps=30.0, sl_bps=20.0, tick_size=TICK) == {}


def test_the_adapter_path_carries_the_same_fields():
    """Production passes an ExchangeAdapter, so the REST body is not the only path that matters."""
    from gpkg.exchange.adapters.bybit import BybitAdapter
    from gpkg.exchange.base import OrderRequest, OrderType, Side, TimeInForce

    rest = _RecordingREST()
    adapter = BybitAdapter(Config(api_key="k", api_secret="s", symbols=["BTCUSDT"]), rest)
    req = OrderRequest(
        exchange="bybit", symbol="BTCUSDT", side=Side.BUY, qty="0.001",
        order_type=OrderType.LIMIT, price="25000", time_in_force=TimeInForce.POST_ONLY,
        client_order_id="link-4", take_profit="25075.0", stop_loss="24950.0",
    )
    asyncio.run(adapter.place_order(req))

    body = rest.calls[-1]
    assert body["takeProfit"] == "25075.0" and body["stopLoss"] == "24950.0"
    assert body["tpslMode"] == "Full"
    assert body["timeInForce"] == "PostOnly", "protection must not cost the passive entry"


# ------------------------------------------------------------------------------------------------
# 2. The fallback must be NARROW — adding a bound can never make things worse
# ------------------------------------------------------------------------------------------------
def test_a_venue_refusing_the_protection_still_gets_a_bare_order():
    """If the venue will not accept the attached fields, the entry must still happen: attaching
    protection may only ever ADD a bound, and today's post-fill path remains authoritative.
    """
    rest = _RecordingREST(fail_first_with="params error: takeProfit invalid")
    ex = _executor(rest)
    protection = ex._protection_kwargs("Buy", REF, tp_bps=30.0, sl_bps=20.0, tick_size=TICK)

    asyncio.run(ex._submit_order("BTCUSDT", "Buy", "0.001", 0, "link-5", protection=protection))

    assert len(rest.calls) == 2, "must retry once, bare"
    assert "takeProfit" not in rest.calls[-1] and "stopLoss" not in rest.calls[-1]


def test_an_unrelated_rejection_is_never_retried():
    """A blanket retry would mask real failures and could resubmit an order rejected for a good
    reason — the fallback fires only when the rejection names the protection fields.
    """
    rest = _RecordingREST(fail_first_with="insufficient balance")
    ex = _executor(rest)
    protection = ex._protection_kwargs("Buy", REF, tp_bps=30.0, sl_bps=20.0, tick_size=TICK)

    with pytest.raises(RuntimeError, match="insufficient balance"):
        asyncio.run(ex._submit_order("BTCUSDT", "Buy", "0.001", 0, "link-6", protection=protection))
    assert len(rest.calls) == 1, "the order must NOT be resubmitted on an unrelated error"


# ------------------------------------------------------------------------------------------------
# 3. Cancel on Disconnect
# ------------------------------------------------------------------------------------------------
def test_cancel_on_disconnect_hits_the_right_endpoint(monkeypatch):
    captured: dict = {}

    async def fake_req(self, method, path, **kw):
        captured["method"], captured["path"], captured["body"] = method, path, kw.get("body")
        return {"retCode": 0}

    monkeypatch.setattr(BybitREST, "_req", fake_req)
    rest = BybitREST.__new__(BybitREST)

    asyncio.run(rest.enable_cancel_on_disconnect())

    assert captured["method"] == "POST"
    assert captured["path"] == "/v5/order/disconnected-cancel-all"
    assert captured["body"] == {"disconnectedCancelAll": True}


def test_cancel_on_disconnect_is_not_a_position_close():
    """CoD cancels ORDERS. Recording the limitation in a test keeps it from being mistaken for the
    control that protects a filled position — that is what the attached TP/SL are for.
    """
    src = (ROOT / "gpkg/exchange/bybit_rest.py").read_text(encoding="utf-8")
    i = src.index("async def enable_cancel_on_disconnect")
    # Bounded by the NEXT function definition, not a character window: a fixed window runs into the
    # following method and then asserts about code that was never under test.
    block = src[i:src.index("async def ", i + 10)]
    assert "positions" in block.lower(), "the limitation must be stated where the control lives"
    assert "position/trading-stop" not in block, "CoD must not be wired to close positions"


# ------------------------------------------------------------------------------------------------
# 4. Boot alert
# ------------------------------------------------------------------------------------------------
def test_the_reboot_warning_is_attached_only_while_awaiting_a_secret():
    awaiting = _with_boot_warning({"engine_state": "AWAITING_SECRET", "equity": 1.0})
    assert awaiting["boot_warning"] == BOOT_WARNING
    assert "Verify exchange manually for unmanaged positions" in BOOT_WARNING

    for steady in ("ARMED", "DISARMED"):
        assert "boot_warning" not in _with_boot_warning({"engine_state": steady})


def test_the_warning_is_attached_to_a_copy_not_the_live_snapshot():
    """`snapshot()` returns the engine's live dict; mutating it would leak the warning into every
    other consumer of the same object.
    """
    live = {"engine_state": "AWAITING_SECRET", "equity": 1.0}
    _with_boot_warning(live)
    assert "boot_warning" not in live


def test_the_daemon_announces_the_state_on_stdout_at_boot():
    src = (ROOT / "gigpilot.py").read_text(encoding="utf-8")
    i = src.index("async def lifespan")
    block = src[i:i + 1600]
    assert "SYSTEM REBOOTED: Credentials purged" in block
    assert "print(" in block and "flush=True" in block, "a console banner must not sit in a buffer"
    # `engine_state` is a PROPERTY. Calling it raised TypeError inside startup, so the app failed to
    # boot and the deploy failed while the whole suite was green — a grep test cannot see that, so
    # assert the call SHAPE explicitly.
    assert "gp.engine_state()" not in block, "engine_state is a property, not a method"
    assert "gp.engine_state ==" in block


def test_the_ui_renders_the_warning_as_an_alert():
    src = (ROOT / "src/components/trading/FuturesCommandCenter.tsx").read_text(encoding="utf-8")
    assert "boot_warning" in src, "the UI must surface the warning, not merely receive it"
    assert 'role="alert"' in src
