#!/usr/bin/env python3
"""DRY-RUN LIFECYCLE — arm -> entry -> native protection -> close -> exchange-verified accounting.

WHAT THIS IS
------------
An end-to-end exercise of the REAL engine (`GigPilot`, `Executor`, `Reconciler`,
`AccountingReconciler`) against a deterministic fake exchange, with no live capital and no network.

WHAT THIS IS NOT
----------------
It is NOT evidence of profitability, and it is not a substitute for live evidence. Per
AI_EXECUTION_RULES.md rule 9, autonomous optimisation may only be justified with live production
market evidence. The synthetic book here exists solely to drive control flow so that the SAFETY
properties below can be asserted deterministically.

The properties asserted are the ones that would silently corrupt an account if they regressed:
  * a position is never left unprotected (TP/SL registered natively, or the position is flattened);
  * realized PnL and fees come back from the exchange, never invented locally;
  * an unmatched exchange close is journalled as an orphan rather than fabricated into a trade row;
  * a vanished local position is marked pending-verification, not silently dropped;
  * the engine does nothing when no verified net edge exists.

Run: python3 tests/test_paper_lifecycle.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


async def test_full_lifecycle_arm_enter_protect_close_account(make_engine):
    engine, fake = make_engine(equity=500.0, symbols=["BTCUSDT"])
    engine.day_start_equity = 500.0

    # ---- 1. ARM through the real gate -------------------------------------------------
    ok, reasons = await engine.arm()
    assert ok is True, f"arm blocked: {reasons}"
    assert engine.armed is True

    # ---- 2. A strategy tick opens a position ------------------------------------------
    assert fake.placed_orders == []
    await engine._strategy_tick()

    assert len(fake.placed_orders) == 1, f"expected exactly one entry, got {fake.placed_orders}"
    entry = fake.placed_orders[0]
    # The entry now RESTS rather than crossing: measured on a live BTCUSDT quote a taker round trip
    # costs 11.0 bps in fees against 4.0 bps for a maker round trip, so crossing on entry gives up
    # ~7 bps. The assertion moved from "Market" to a post-only limit at a real price, which is
    # strictly stronger — it pins the routing DECISION, not merely that some order was sent.
    assert entry["orderType"] == "Limit", f"entry should rest as a routed limit, got {entry}"
    assert entry["timeInForce"] == "PostOnly", (
        "entry must be post-only so the venue rejects rather than crosses; that is the safety "
        "property stopping us from paying the spread by accident"
    )
    assert float(entry["price"]) > 0, "a resting entry must carry the price it rests at"
    assert entry["category"] == "linear"
    assert entry["orderLinkId"].startswith("gp-"), "orderLinkId must be traceable to this engine"

    symbol = entry["symbol"]
    # The qty must be numerically valid; assert that here rather than binding a name the test
    # never goes on to use.
    float(entry["qty"])

    # ---- 3. Native protection MUST be registered --------------------------------------
    assert len(fake.protections) == 1, (
        "position was opened WITHOUT native TP/SL — an unprotected live position"
    )
    prot = fake.protections[0]
    assert prot["symbol"] == symbol
    assert prot["tpslMode"] == "Full"
    tp, sl = float(prot["takeProfit"]), float(prot["stopLoss"])
    side = entry["side"]
    if side == "Buy":
        assert tp > float(engine.positions[symbol]["entry"]), "long TP must sit above entry"
        assert sl < float(engine.positions[symbol]["entry"]), "long SL must sit below entry"
    else:
        assert tp < float(engine.positions[symbol]["entry"]), "short TP must sit below entry"
        assert sl > float(engine.positions[symbol]["entry"]), "short SL must sit above entry"

    # ---- 4. The trade is persisted and locally tracked ---------------------------------
    open_rows = engine.store.open_trades()
    assert len(open_rows) == 1, open_rows
    trade_id = open_rows[0]["id"]
    status = engine.store._conn.execute(
        "SELECT status FROM trades WHERE id=?", (trade_id,)
    ).fetchone()[0]
    assert status == "open", f"newly opened trade has status {status!r}"
    assert open_rows[0]["order_link_id"] == entry["orderLinkId"]
    assert engine.positions[symbol]["trade_id"] == trade_id

    # ---- 5. Exchange-confirmed close back-fills realized PnL and fees -------------------
    exit_px = round(float(engine.positions[symbol]["entry"]) * 1.001, 4)
    closed_pnl = 0.42
    open_fee, close_fee = 0.03, 0.03

    async def _closed_pnl(limit: int = 100):
        return [{
            "orderId": "exch-close-1",
            "symbol": symbol,
            "side": "Sell" if side == "Buy" else "Buy",
            "avgExitPrice": str(exit_px),
            "closedPnl": str(closed_pnl),
            "openFee": str(open_fee),
            "closeFee": str(close_fee),
            "createdTime": str(open_rows[0]["ts_ms"]),
        }]

    fake.closed_pnl = _closed_pnl
    applied = await engine.accounting.run_once()
    assert applied == 1, f"accounting applied {applied} rows, expected 1"

    row = engine.store._conn.execute(
        "SELECT status, realized_pnl, fees, exit_px FROM trades WHERE id=?", (trade_id,)
    ).fetchone()
    assert row is not None
    assert row[0] == "closed", f"trade status is {row[0]!r}, expected 'closed'"
    assert row[1] == pytest.approx(closed_pnl), "realized PnL must be the EXCHANGE figure"
    assert row[2] == pytest.approx(open_fee + close_fee), "fees must be exchange-confirmed"

    # Bybit closedPnl is already net of trading fees and funding; do not subtract fees twice.
    assert engine.store.realized_today() == pytest.approx(closed_pnl)

    # Replaying the same exchange rows must not double-count.
    again = await engine.accounting.run_once()
    assert again == 0, "accounting double-applied an already-seen close"
    assert engine.store.realized_today() == pytest.approx(closed_pnl)


async def test_unmatched_exchange_close_is_journalled_not_fabricated(make_engine):
    """An exchange close with no local counterpart must NOT invent a trade row."""
    engine, fake = make_engine(symbols=["BTCUSDT"])

    async def _closed_pnl(limit: int = 100):
        return [{
            "orderId": "orphan-1", "symbol": "BTCUSDT", "side": "Sell",
            "avgExitPrice": "100.5", "closedPnl": "9.99",
            "openFee": "0.01", "closeFee": "0.01", "createdTime": "1",
        }]

    fake.closed_pnl = _closed_pnl
    await engine.accounting.run_once()

    trades = engine.store._conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    assert trades == 0, "an unmatched exchange close was fabricated into a local trade row"

    orphan = engine.store._conn.execute(
        "SELECT COUNT(*) FROM journal WHERE kind='ACCT_ORPHAN'"
    ).fetchone()[0]
    assert orphan == 1, "unmatched close was not journalled"

    assert engine.store.realized_today() == 0.0, "an unverified close leaked into realized PnL"


async def test_vanished_position_is_marked_pending_not_dropped(make_engine):
    """If the exchange goes flat under us, the local trade must await verification."""
    engine, fake = make_engine(symbols=["BTCUSDT"])
    engine.day_start_equity = 500.0
    await engine.arm()
    await engine._strategy_tick()

    symbol = next(iter(engine.positions))
    trade_id = engine.positions[symbol]["trade_id"]

    # Exchange now reports flat.
    fake.position_legs = []
    await engine.reconciler.run_once()

    assert symbol not in engine.positions, "stale local position was not cleared"
    status = engine.store._conn.execute(
        "SELECT status FROM trades WHERE id=?", (trade_id,)
    ).fetchone()[0]
    assert status == "pending_verify", (
        f"trade left as {status!r}; it must await exchange-verified PnL, not be closed locally"
    )
    divergences = engine.store._conn.execute(
        "SELECT COUNT(*) FROM journal WHERE kind='CLOSE_PENDING'"
    ).fetchone()[0]
    assert divergences >= 1


async def test_no_verified_edge_means_no_trade(make_engine):
    """The central 'DO NOTHING' rule: no edge, no order — not even a probe."""
    engine, fake = make_engine(fair_shift_bps=0.0, hurdle_bps=50.0)
    engine.day_start_equity = 500.0
    engine.armed = True

    await engine._strategy_tick()

    assert fake.placed_orders == [], f"traded without verified net edge: {fake.placed_orders}"
    assert fake.protections == [], "registered protection without an entry"
    assert engine.store.open_trades() == []


async def test_protection_failure_flattens_the_position(make_engine):
    """If TP/SL cannot be registered, the opened position must be unwound immediately.

    The failure is contained by the entry path (logged + metric) rather than propagating, so the
    assertion is on the resulting exchange actions — that is what actually matters here.
    """
    engine, fake = make_engine(symbols=["BTCUSDT"])
    engine.day_start_equity = 500.0
    await engine.arm()

    async def _failing_stop(**kw):
        raise RuntimeError("exchange refused the TP/SL request")

    fake.trading_stop = _failing_stop
    await engine._strategy_tick()

    # entry, then the compensating flatten
    assert len(fake.placed_orders) == 2, (
        f"expected entry then flatten, got {len(fake.placed_orders)} orders: {fake.placed_orders}"
    )
    entry_order, unwind = fake.placed_orders[0], fake.placed_orders[1]
    assert unwind["reduceOnly"] is True, "the unwind must be reduce-only"
    assert unwind["side"] != entry_order["side"], "unwind must be the opposite side"
    assert unwind["qty"] == entry_order["qty"], "unwind must flatten the full entry quantity"
    assert engine.store.open_trades() == [], "an unprotected position was recorded as open"
    assert engine.positions == {}, "an unprotected position was left in local state"
