#!/usr/bin/env python3
"""ENTRY SIZING AND EXCHANGE LOT RULES.

Two rules that must not be confused with each other:

  1. Quantity is rounded DOWN to the contract lot step, always. Rounding up can exceed the intended
     risk budget, and Bybit rejects a non-conforming quantity outright.
  2. `minOrderQty` is an ENTRY eligibility rule, not an exit brake. Enforcing it on the close or
     unwinding path could refuse to flatten a position that had shrunk below the entry minimum —
     turning a protective action into a stuck position. It is therefore enforced only where a
     position is opened.

Run: python3 tests/test_entry_sizing.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.core.config import Config  # noqa: E402
from gpkg.execution.executor import Executor  # noqa: E402


def make_executor(step: float = 0.001, min_qty: float = 0.01):
    from tests.conftest import FakeREST

    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"])
    rest = FakeREST(symbols=["BTCUSDT"])
    return Executor(cfg, rest, {"BTCUSDT": step}, min_sizes={"BTCUSDT": min_qty}), rest


def test_rounds_down_to_step():
    ex, _ = make_executor(step=0.001, min_qty=0.0)
    assert ex._round_qty("BTCUSDT", 1.2349) == "1.234"
    assert ex._round_qty("BTCUSDT", 1.234) == "1.234"
    # Rounding must never go UP: 1.2349 -> 1.234, never 1.235 (that would exceed the risk budget).
    assert ex._round_qty("BTCUSDT", 1.2349999) == "1.234"
    # Floors to zero -> refuse rather than submit a zero-quantity order.
    with pytest.raises(RuntimeError, match="rounds to 0"):
        ex._round_qty("BTCUSDT", 0.0009)


def test_unknown_step_refuses_to_trade():
    """An instrument whose lot step could not be read must not be traded on a guess."""
    ex, _ = make_executor(step=0.0, min_qty=0.0)
    with pytest.raises(RuntimeError, match="step size unknown"):
        ex._round_qty("BTCUSDT", 1.0)


def test_entry_rejects_below_min_order_qty():
    ex, _ = make_executor(step=0.001, min_qty=0.01)
    ok, reason = ex.check_entry_size("BTCUSDT", 0.005)
    assert ok is False, "sub-minimum entry size was accepted"
    assert "below_min" in reason

    ok, reason = ex.check_entry_size("BTCUSDT", 0.01)
    assert ok is True, reason


def test_entry_rejects_qty_that_floors_to_zero():
    ex, _ = make_executor(step=1.0, min_qty=0.0)
    ok, reason = ex.check_entry_size("BTCUSDT", 0.4)
    assert ok is False
    assert "rounds to 0" in reason


def test_min_size_does_not_block_the_exit_path():
    """The critical asymmetry: a position below minOrderQty must still be closable."""
    ex, rest = make_executor(step=0.001, min_qty=0.01)

    # `_round_qty` — used by close/unwind — must NOT raise on a sub-minimum quantity.
    assert ex._round_qty("BTCUSDT", 0.005) == "0.005"

    import asyncio

    # Drive the coroutine explicitly so the test does not depend on an ambient event loop.
    async def _close():
        return await ex.close_market("BTCUSDT", "Buy", "0.005")

    asyncio.run(_close())
    assert rest.placed_orders, "close_market did not submit an order"
    sent = rest.placed_orders[-1]
    assert sent["reduceOnly"] is True, "close was not reduce-only"
    assert sent["qty"] == "0.005", f"close quantity was altered: {sent['qty']}"


def test_duplicate_order_link_is_treated_as_success():
    """A lost response must not be reported as a failure — that is how a position is reported
    'not opened' while it is in fact open."""
    ex, rest = make_executor(step=0.001, min_qty=0.0)
    import asyncio

    async def _twice():
        first = await ex._place_idempotent("gp-fixed", category="linear", symbol="BTCUSDT",
                                           side="Buy", orderType="Market", qty="1")
        second = await ex._place_idempotent("gp-fixed", category="linear", symbol="BTCUSDT",
                                            side="Buy", orderType="Market", qty="1")
        return first, second

    first, second = asyncio.run(_twice())
    assert first is not None, "first submit should return the exchange result"
    assert second is None, "duplicate orderLinkId should be reported as already-accepted, not an error"
    assert len(rest.placed_orders) == 1, "duplicate submit reached the exchange twice"
