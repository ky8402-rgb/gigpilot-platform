"""QuantEngine live-execution wiring — behavioural tests.

These drive the REAL `GigPilot._strategy_tick` / `GigPilot._try_enter` against the deterministic
fake exchange (see conftest) and assert that the stochastic quoting engine is now part of the live
entry path, not a formula that exists in isolation:

  * `_strategy_tick` invokes `QuantEngine` every tick and records an admissible `QuantDecision`;
  * `_try_enter` prices the passive order from the OBI-skewed reference (momentum operator);
  * a missing VPIN refuses the entry FAIL-CLOSED (no order, named reason);
  * a VPIN pause holds the entry off (toxicity hold);
  * sub-minimum capital refuses the entry cleanly (no snap up to the venue minimum).

As with `test_paper_lifecycle.py`, the synthetic book exists only to drive control flow so the
SAFETY properties can be asserted deterministically — it is not evidence of profitability.
"""
from __future__ import annotations

import pytest

from gpkg.core.clock import now_ms
from gpkg.strategy.edge import EdgeEstimate
from gpkg.trading.quant_engine import QuantDecision


def _tradable(symbol: str = "BTCUSDT", side: str = "Buy") -> EdgeEstimate:
    """A tradable edge estimate: net edge well above the hurdle, all cost fields populated."""
    return EdgeEstimate(
        symbol=symbol, side=side, gross_bps=50.0, fee_bps=0.0, spread_bps=20.0,
        slip_bps=0.0, funding_bps=0.0, net_bps=50.0, tradable=True,
        reason="clears_hurdle", ts_ms=now_ms(),
    )


class _ToxicVpin:
    """VPIN stand-in that reports extreme one-sided flow -> `toxicity_policy` returns pause."""

    vpin = 0.95

    def snapshot(self) -> dict:
        return {
            "vpin": 0.95, "threshold_p90": 0.8, "effective_threshold": 0.8,
            "buckets": 50, "window": 50, "trades": 100,
            "high_toxicity": True, "widen_ticks": 0, "pause": True,
        }


async def test_strategy_tick_invokes_quant_engine_and_admits_entry(make_engine):
    """The strategy tick composes a fresh `QuantDecision` and, when inputs are fresh, enters."""
    engine, fake = make_engine(equity=500.0, symbols=["BTCUSDT"])
    engine.day_start_equity = 500.0
    await engine.arm()

    await engine._strategy_tick()

    qd = engine.quant_decisions["BTCUSDT"]
    assert isinstance(qd, QuantDecision)
    assert qd.admissible is True
    assert qd.plan is not None
    assert qd.obi is not None and qd.vpin is not None and qd.atr_bps > 0
    assert fake.placed_orders, "a fresh quant decision should admit the entry"


async def test_obi_skew_adjusts_maker_limit_price(make_engine):
    """The OBI-driven momentum operator moves the passive rest price, not the raw micro-price."""
    engine, fake = make_engine(equity=500.0, symbols=["BTCUSDT"])
    engine.day_start_equity = 500.0
    engine.armed = True
    engine.portfolio.equity = 500.0
    engine.portfolio.available_usdt = 500.0

    ms = engine.markets["BTCUSDT"]
    # Wide, asymmetric book: mid 100, spread 2.0, order-book imbalance ~ +0.8 (heavy bids).
    ms.apply_book_snapshot([[99.0, 900.0]], [[101.0, 100.0]])
    engine.tick_size["BTCUSDT"] = 0.01

    decision = engine._quant_decision("BTCUSDT")
    assert decision.admissible, decision.reason
    # The skew operator moved the reference off mid (OBI != 0 must not degenerate to mid-centring).
    assert decision.plan.skew.reference != pytest.approx(ms.mid, abs=1e-9)

    await engine._try_enter("BTCUSDT", _tradable(), decision)

    assert fake.placed_orders, "expected a maker entry"
    order = fake.placed_orders[0]
    assert order["timeInForce"] == "PostOnly"
    # The resting price is the skew reference, clamped passive — NOT the unskewed micro-price.
    assert float(order["price"]) == pytest.approx(decision.plan.skew.reference, abs=0.011)


async def test_missing_vpin_fails_closed(make_engine):
    """No VPIN coverage -> refuse the entry and name the reason; existing stops stay untouched."""
    engine, fake = make_engine(equity=500.0, symbols=["BTCUSDT"])
    engine.day_start_equity = 500.0
    engine.armed = True
    engine.portfolio.equity = 500.0
    engine.portfolio.available_usdt = 500.0

    engine.ws.vpin["BTCUSDT"] = None

    await engine._try_enter("BTCUSDT", _tradable())

    assert fake.placed_orders == []
    assert fake.cancelled == [], "fail-closed must not disturb existing protection"
    assert engine.positioning_status == "QUANT_NO_VPIN"


async def test_vpin_pause_holds_off_entry(make_engine):
    """Extreme one-sided flow (VPIN pause) holds new entries off rather than resting into it."""
    engine, fake = make_engine(equity=500.0, symbols=["BTCUSDT"])
    engine.day_start_equity = 500.0
    engine.armed = True
    engine.portfolio.equity = 500.0
    engine.portfolio.available_usdt = 500.0

    engine.ws.vpin["BTCUSDT"] = _ToxicVpin()

    await engine._try_enter("BTCUSDT", _tradable())

    assert fake.placed_orders == []
    assert engine.positioning_status == "TOXICITY_HOLD"


async def test_subminimum_capital_refuses_cleanly(make_engine):
    """Capital below the venue minimum lot is a refusal, never a silent snap up to the minimum."""
    engine, fake = make_engine(equity=1.0, symbols=["BTCUSDT"])
    engine.day_start_equity = 1.0
    engine.armed = True
    engine.portfolio.equity = 1.0
    engine.portfolio.available_usdt = 1.0

    await engine._try_enter("BTCUSDT", _tradable())

    assert fake.placed_orders == [], "must not borrow from the budget to satisfy the minimum lot"
    assert engine.positioning_status == "INSUFFICIENT_EXCHANGE_MINIMUM"
