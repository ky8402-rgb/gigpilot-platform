"""Ledger arithmetic and the paper broker.

The ledger is where 'net PnL' is defined, so its identities are asserted exactly:
    net = gross - fees - funding
    equity = starting + realized_net + unrealized_net
"""
import asyncio
import time

import pytest

from app.config import load_config
from app.costs import CostModel
from app.exchange import DepthSnapshot, Ticker
from app.execution import ExecutionEngine, PaperBroker
from app.portfolio import Ledger, Position
from app.risk import size_position
from app.strategy import Setup


@pytest.fixture
def cfg():
    return load_config()


class Spec:
    step_size = 0.001
    min_qty = 0.001
    min_notional = 5.0


def mk_ticker(mid=100.0, spread_bps=2.0, funding=0.0):
    half = mid * spread_bps / 10_000.0 / 2
    return Ticker(symbol="TUSDT", last=mid, bid=mid - half, ask=mid + half,
                  quote_volume_24h=1e9, price_change_pct_24h=0.0,
                  mark_price=mid, funding_rate=funding, next_funding_ts=0)


def mk_book(mid=100.0, spread_bps=2.0):
    half = mid * spread_bps / 10_000.0 / 2
    return DepthSnapshot(
        symbol="TUSDT",
        bids=[[mid - half - i * 0.01, 50.0] for i in range(30)],
        asks=[[mid + half + i * 0.01, 50.0] for i in range(30)],
    )


def test_ledger_net_pnl_identity(tmp_path):
    led = Ledger(1_000.0, tmp_path / "t.db", persist=True)
    pos = Position(id="p1", symbol="TUSDT", side="LONG", qty=10.0,
                   entry_price=100.0, mark_price=100.0, risk_per_unit=2.0)
    led.open_position(pos)

    led.mark({"TUSDT": 110.0})
    assert pos.unrealized_gross == pytest.approx(100.0)
    assert led.equity == pytest.approx(1_100.0)

    trade = led.close_position("TUSDT", 110.0, "target", fees=5.0, funding=1.0)
    assert trade is not None
    assert trade.gross_pnl == pytest.approx(100.0)
    assert trade.net_pnl == pytest.approx(100.0 - 5.0 - 1.0)
    assert led.realized_net == pytest.approx(94.0)
    assert led.equity == pytest.approx(1_094.0)
    assert led.total_fees == pytest.approx(5.0)
    assert led.total_funding == pytest.approx(1.0)


def test_ledger_short_pnl_identity(tmp_path):
    led = Ledger(1_000.0, tmp_path / "t.db")
    led.open_position(Position(id="p", symbol="S", side="SHORT", qty=10.0,
                               entry_price=100.0, mark_price=100.0, risk_per_unit=2.0))
    led.mark({"S": 90.0})
    assert led.positions["S"].unrealized_gross == pytest.approx(100.0)
    led.mark({"S": 105.0})
    assert led.positions["S"].unrealized_gross == pytest.approx(-50.0)


def test_ledger_stats_and_drawdown(tmp_path):
    led = Ledger(1_000.0, tmp_path / "t.db")
    for profit, exit_p in ((100.0, 110.0), (-50.0, 95.0)):
        led.open_position(Position(id="p", symbol="X", side="LONG", qty=10.0,
                                   entry_price=100.0, mark_price=100.0, risk_per_unit=1.0))
        led.close_position("X", exit_p, "t", fees=0.0, funding=0.0)
        led.record_equity()
    s = led.stats()
    assert s["trades"] == 2
    assert s["wins"] == 1 and s["losses"] == 1
    assert s["win_rate"] == pytest.approx(50.0)
    assert s["realized_net"] == pytest.approx(50.0)
    assert s["max_drawdown_pct"] >= 0


def test_close_missing_position_returns_none(tmp_path):
    led = Ledger(100.0, tmp_path / "t.db")
    assert led.close_position("NOPE", 1.0, "x") is None


def test_equity_persistence_roundtrip(tmp_path):
    from app.portfolio import load_equity_curve, load_trades

    db = tmp_path / "p.db"
    led = Ledger(500.0, db)
    led.open_position(Position(id="p", symbol="X", side="LONG", qty=1.0,
                               entry_price=100.0, mark_price=100.0, risk_per_unit=1.0))
    led.close_position("X", 105.0, "target", fees=1.0, funding=0.5)
    led.record_equity()
    led._conn.commit()

    curve = load_equity_curve(db)
    assert len(curve) >= 1
    trades = load_trades(db)
    assert len(trades) == 1
    assert trades[0]["net_pnl"] == pytest.approx(5.0 - 1.0 - 0.5)


def test_paper_broker_entry_charges_fee_and_slippage(tmp_path, cfg):
    led = Ledger(10_000.0, tmp_path / "t.db")
    cm = CostModel(cfg)
    broker = PaperBroker(cfg, led, cm)
    pos = Position(id="p", symbol="TUSDT", side="LONG", qty=1.0, entry_price=100.0,
                   mark_price=100.0, risk_per_unit=2.0)
    led.open_position(pos)
    res = asyncio.run(broker.open(pos, mk_ticker(), mk_book(), decision_price=100.0))
    assert res.ok
    # A long entry crosses the spread, so it fills at or above the decision price.
    assert pos.entry_price >= 100.0
    assert pos.fees_paid > 0
    assert pos.slippage_cost >= 0
    assert led.orders and led.orders[-1].status == "FILLED"


def test_paper_broker_round_trip_loses_the_costs_on_a_flat_move(tmp_path, cfg):
    """Buy and immediately sell at the same mid: the result must be a LOSS equal to
    roughly the round-trip cost. This is the single most important property of the
    paper broker — if it were profitable here, every downstream number would be a lie."""
    led = Ledger(10_000.0, tmp_path / "t.db")
    cm = CostModel(cfg)
    broker = PaperBroker(cfg, led, cm)
    pos = Position(id="p", symbol="TUSDT", side="LONG", qty=1.0, entry_price=100.0,
                   mark_price=100.0, risk_per_unit=2.0)
    led.open_position(pos)
    asyncio.run(broker.open(pos, mk_ticker(), mk_book(), decision_price=100.0))
    asyncio.run(broker.close(pos, mk_ticker(), mk_book(), "manual"))
    trade = led.trades[-1]
    assert trade.net_pnl < 0
    # Roughly two taker fees plus slippage on a ~$100 notional.
    assert -1.0 < trade.net_pnl < 0.0


def test_paper_broker_stop_exit_is_worse_than_passive(tmp_path, cfg):
    led = Ledger(10_000.0, tmp_path / "t.db")
    cm = CostModel(cfg)
    broker = PaperBroker(cfg, led, cm)

    def run(reason):
        p = Position(id="p", symbol="TUSDT", side="LONG", qty=1.0, entry_price=100.0,
                     mark_price=100.0, risk_per_unit=2.0)
        led.open_position(p)
        asyncio.run(broker.open(p, mk_ticker(), mk_book(), decision_price=100.0))
        asyncio.run(broker.close(p, mk_ticker(), mk_book(), reason))
        return led.trades[-1]

    passive = run("manual")
    stopped = run("stop")
    assert stopped.exit_price <= passive.exit_price
    assert stopped.net_pnl <= passive.net_pnl


def test_paper_broker_funding_charges_long_on_positive_rate(tmp_path, cfg):
    led = Ledger(10_000.0, tmp_path / "t.db")
    broker = PaperBroker(cfg, led, CostModel(cfg))
    pos = Position(id="p", symbol="TUSDT", side="LONG", qty=1.0, entry_price=100.0,
                   mark_price=100.0, risk_per_unit=2.0)
    # Pretend it has been open for >24h so three 8h boundaries are crossed.
    pos.opened_at = time.time() - 25 * 3600
    broker._last_funding["TUSDT"] = pos.opened_at
    paid = asyncio.run(broker.accrue_funding(pos, mk_ticker(funding=0.0005)))
    assert paid > 0
    assert pos.funding_paid == pytest.approx(paid)

    # A short receives on positive funding.
    short = Position(id="p2", symbol="TUSDT", side="SHORT", qty=1.0, entry_price=100.0,
                     mark_price=100.0, risk_per_unit=2.0)
    short.opened_at = time.time() - 25 * 3600
    broker._last_funding["TUSDT"] = short.opened_at
    got = asyncio.run(broker.accrue_funding(short, mk_ticker(funding=0.0005)))
    assert got < 0


def test_execution_engine_enforces_daily_order_cap(tmp_path, cfg):
    led = Ledger(10_000.0, tmp_path / "t.db")
    broker = PaperBroker(cfg, led, CostModel(cfg))
    eng = ExecutionEngine(cfg, led, broker, CostModel(cfg))
    eng.orders_today = cfg.execution.max_orders_per_day
    ok, msg = asyncio.run(eng.open_position(
        Setup(symbol="TUSDT", direction="LONG", price=100, stop=98, target=105, risk_per_unit=2),
        {"qty": 1.0, "notional": 100.0, "leverage": 1.0},
        mk_ticker(), mk_book(),
    ))
    assert ok is False and "cap" in msg


def test_execution_engine_stop_closes_position(tmp_path, cfg):
    led = Ledger(10_000.0, tmp_path / "t.db")
    broker = PaperBroker(cfg, led, CostModel(cfg))
    eng = ExecutionEngine(cfg, led, broker, CostModel(cfg))
    setup = Setup(symbol="TUSDT", direction="LONG", price=100.0, stop=98.0,
                  target=105.0, risk_per_unit=2.0)
    ok, _ = asyncio.run(eng.open_position(
        setup, {"qty": 1.0, "notional": 100.0, "leverage": 1.0}, mk_ticker(), mk_book()))
    assert ok and "TUSDT" in led.positions

    tk = mk_ticker(mid=97.0)
    res = asyncio.run(eng.manage("TUSDT", tk, mk_book(mid=97.0), bar_high=100.0, bar_low=97.0))
    assert res.get("action") == "stop"
    assert "TUSDT" not in led.positions
    assert led.trades[-1].exit_reason == "stop"


def test_execution_engine_target_closes_position(tmp_path, cfg):
    led = Ledger(10_000.0, tmp_path / "t.db")
    eng = ExecutionEngine(cfg, led, PaperBroker(cfg, led, CostModel(cfg)), CostModel(cfg))
    setup = Setup(symbol="TUSDT", direction="LONG", price=100.0, stop=98.0,
                  target=105.0, risk_per_unit=2.0)
    asyncio.run(eng.open_position(setup, {"qty": 1.0, "notional": 100.0, "leverage": 1.0},
                                  mk_ticker(), mk_book()))
    res = asyncio.run(eng.manage("TUSDT", mk_ticker(mid=106.0), mk_book(mid=106.0),
                                 bar_high=106.0, bar_low=100.0))
    assert res.get("action") == "target"
    assert led.trades[-1].exit_reason == "target"


def test_breakeven_move_after_1R(tmp_path, cfg):
    led = Ledger(10_000.0, tmp_path / "t.db")
    eng = ExecutionEngine(cfg, led, PaperBroker(cfg, led, CostModel(cfg)), CostModel(cfg))
    setup = Setup(symbol="TUSDT", direction="LONG", price=100.0, stop=98.0,
                  target=200.0, risk_per_unit=2.0)
    asyncio.run(eng.open_position(setup, {"qty": 1.0, "notional": 100.0, "leverage": 1.0},
                                  mk_ticker(), mk_book()))
    pos = led.positions["TUSDT"]
    assert pos.breakeven_moved is False

    # R is now measured from the actual (slipped) fill, so move comfortably past 1R.
    assert pos.entry_price >= 100.0
    above_1r = pos.entry_price + pos.risk_per_unit * 1.2
    asyncio.run(eng.manage("TUSDT", mk_ticker(mid=above_1r), mk_book(mid=above_1r),
                           bar_high=above_1r * 1.001, bar_low=pos.entry_price))
    assert pos.breakeven_moved is True
    # Breakeven stop must sit at or above the true entry, never below it.
    assert pos.stop >= pos.entry_price


def test_r_multiple_uses_actual_fill_not_decision_price(tmp_path, cfg):
    """Adverse slippage widens true risk; R must not be flattered by it."""
    led = Ledger(10_000.0, tmp_path / "t.db")
    eng = ExecutionEngine(cfg, led, PaperBroker(cfg, led, CostModel(cfg)), CostModel(cfg))
    setup = Setup(symbol="TUSDT", direction="LONG", price=100.0, stop=98.0,
                  target=200.0, risk_per_unit=2.0)
    asyncio.run(eng.open_position(setup, {"qty": 1.0, "notional": 100.0, "leverage": 1.0},
                                  mk_ticker(), mk_book()))
    pos = led.positions["TUSDT"]
    assert pos.risk_per_unit == pytest.approx(abs(pos.entry_price - 98.0))
    assert pos.risk_per_unit >= 2.0


def test_sizing_snapshot_is_json_serialisable(cfg):
    import json

    r = size_position(Setup(symbol="X", direction="LONG", price=100.0, stop=98.0,
                            target=105.0, risk_per_unit=2.0),
                      10_000, mk_ticker(), Spec(), cfg)
    json.dumps(r)
