#!/usr/bin/env python3
"""ROUND-TRIP COST MODEL — every direct cost of completing a trade must be charged.

Regression origin
-----------------
`EdgeEngine.evaluate` deducted the exchange fee ONCE while the venue quotes it PER SIDE
(`/v5/account/fee-rate` -> `takerFeeRate`). A completed trade pays that rate on entry AND on exit, so
the model understated every round trip by one full fee unit — at VIP0 taker that is ~5.5 bps.

Against a 3 bps hurdle that is the difference between refusing a trade and taking it: a setup whose
true expectancy was negative could clear the gate, because the missing 5.5 bps had simply been left
out of the arithmetic. The engine is supposed to prefer doing nothing over a negative-expectancy
trade, so this is exactly the class of error that must never be reachable.

Adverse selection was also absent from the model entirely (zero occurrences anywhere in the cost
path), despite being a named, unavoidable cost of taker execution.

These tests pin the arithmetic and, more importantly, pin the DECISION: the regression case below is
a trade that the old model admitted and the corrected model must refuse.

Run: python3 -m pytest tests/test_cost_model.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pytest  # noqa: E402

from gpkg.core.config import Config  # noqa: E402
from gpkg.core.clock import now_ms  # noqa: E402
from gpkg.market.state import MarketState  # noqa: E402
from gpkg.strategy.edge import EdgeEngine  # noqa: E402

HURDLE = 3.0
ONEWAY_FEE_BPS = 5.5  # VIP0 linear taker, as returned by the venue


def make_cfg(**over):
    base = dict(
        api_key="k",
        api_secret="s",
        symbols=["BTCUSDT"],
        edge_hurdle_bps=HURDLE,
        fee_round_trip_multiple=2.0,
        adverse_selection_factor=0.5,
        slippage_factor=0.5,
        signal_fair_shift_bps=30.0,
        staleness_ms=1500,
        book_levels=5,
    )
    base.update(over)
    return Config(**base)


def make_book(bid=99.98, ask=100.02, bid_sz=1_000_000.0, ask_sz=1.0, funding=0.0):
    """A fresh, non-stale market with a known 4 bps spread."""
    ms = MarketState(symbol="BTCUSDT", funding_rate=funding)
    ms.apply_book_snapshot([[bid, bid_sz]], [[ask, ask_sz]])
    ms.ts_tick_ms = now_ms()
    return ms


def evaluate(cfg, ms, side="Buy", req=50.0):
    return EdgeEngine(cfg).evaluate(ms, side, ONEWAY_FEE_BPS, 1.0, req)


# ---------------------------------------------------------------------------------------------
def test_spread_baseline_is_as_expected():
    ms = make_book()
    assert ms.spread_bps == pytest.approx(4.0, abs=1e-9), ms.spread_bps
    assert ms.mid == pytest.approx(100.0)


def test_fee_is_charged_on_both_legs():
    """The venue quotes per side; a round trip pays twice."""
    cfg = make_cfg()
    est = evaluate(cfg, make_book())
    assert est.fee_bps == pytest.approx(ONEWAY_FEE_BPS * 2.0), (
        f"fee charged {est.fee_bps} bps; a round trip at a {ONEWAY_FEE_BPS} bps per-side rate is "
        f"{ONEWAY_FEE_BPS * 2.0} bps"
    )


def test_round_trip_multiple_is_load_bearing():
    """Setting the multiplier to 1.0 reproduces the OLD, buggy one-way charge."""
    est = evaluate(make_cfg(fee_round_trip_multiple=1.0), make_book())
    assert est.fee_bps == pytest.approx(ONEWAY_FEE_BPS)


def test_adverse_selection_is_charged():
    cfg = make_cfg()
    est = evaluate(cfg, make_book())
    assert est.adverse_bps == pytest.approx(4.0 * 0.5), est.adverse_bps
    assert est.adverse_bps > 0, "adverse selection must not be silently zero"


def test_adverse_selection_factor_zero_disables_the_term():
    est = evaluate(make_cfg(adverse_selection_factor=0.0), make_book())
    assert est.adverse_bps == pytest.approx(0.0)


def test_net_is_exactly_gross_minus_every_cost():
    """The identity must hold term by term, so no cost can quietly drop out again."""
    est = evaluate(make_cfg(), make_book())
    expected = (
        est.gross_bps
        - est.fee_bps
        - est.spread_bps
        - est.slip_bps
        - est.funding_bps
        - est.adverse_bps
    )
    assert est.net_bps == pytest.approx(expected, abs=1e-9), (
        f"net={est.net_bps} but gross-minus-costs={expected}"
    )


def test_funding_is_deducted_and_scales_with_holding_time():
    # funding_rate=0.0001 -> 1 bps per 8h window; the model holds 1.0h, i.e. 1/8 of that window.
    short = evaluate(make_cfg(), make_book(funding=0.0001))
    assert short.funding_bps == pytest.approx(0.125, abs=1e-9), short.funding_bps
    assert short.funding_bps > 0
    assert short.net_bps < evaluate(make_cfg(), make_book(funding=0.0)).net_bps


def test_depth_gate_measures_the_side_actually_consumed():
    """A Buy consumes ASKS, so ask depth must decide admissibility — not bid depth."""
    # Deep bids, thin asks: a Buy cannot actually be filled at the modelled price.
    thin_asks = make_book(bid_sz=1_000_000.0, ask_sz=1.0)
    # Deep asks, thin bids: the same Buy is perfectly fillable.
    deep_asks = make_book(bid_sz=1.0, ask_sz=1_000_000.0)

    assert deep_asks.depth_notional("Buy", 5) > thin_asks.depth_notional("Buy", 5), (
        "Buy depth must track the ask book"
    )

    cfg = make_cfg()
    blocked = EdgeEngine(cfg).evaluate(thin_asks, "Buy", ONEWAY_FEE_BPS, 1.0, 50_000.0)
    allowed = EdgeEngine(cfg).evaluate(deep_asks, "Buy", ONEWAY_FEE_BPS, 1.0, 50_000.0)

    assert blocked.tradable is False, (
        "a Buy was admitted against a book whose ASK side cannot fill it — the depth gate is "
        "measuring the wrong side"
    )
    assert blocked.reason == "insufficient_depth", blocked.reason
    assert allowed.reason != "insufficient_depth", (
        f"a Buy into a deep ask book was rejected for depth: {allowed.reason}"
    )


def test_sell_depth_tracks_the_bid_book():
    ms = make_book(bid_sz=1.0, ask_sz=1_000_000.0)
    assert ms.depth_notional("Sell", 5) < 1_000.0, "Sell depth must track the bid book"


# ---------------------------------------------------------------------------------------------
def test_regression_trade_admitted_by_the_old_model_must_now_be_refused():
    """THE POINT OF THIS FILE.

    A setup with ~17.5 bps gross edge against a 4 bps spread. Under the old arithmetic (fee charged
    once) the net was ~+6.0 bps and it CLEARED the 3 bps hurdle. Charging the fee on both legs and
    adding adverse selection puts the true net below zero.

    Asserting this trade is refused is what stops the fee leg from being understated again: the
    assertion fails the moment anyone reverts the multiplier or drops the adverse-selection term.
    """
    ms = make_book()

    old = evaluate(make_cfg(fee_round_trip_multiple=1.0, adverse_selection_factor=0.0), ms)
    new = evaluate(make_cfg(), ms)

    assert old.tradable is True, (
        f"precondition: the old model should have admitted this trade (net={old.net_bps:.2f}); "
        "if this fails the fixture no longer demonstrates the regression"
    )

    assert new.net_bps < 0, f"corrected net should be negative, got {new.net_bps:.2f}"
    assert new.tradable is False, (
        f"trade with net={new.net_bps:.2f} bps was admitted against a {HURDLE} bps hurdle"
    )
    assert new.net_bps == pytest.approx(old.net_bps - ONEWAY_FEE_BPS - 2.0, abs=1e-6), (
        "the difference between the models must be exactly one fee unit plus adverse selection"
    )


def test_no_trade_without_positive_expectancy():
    """Sweep the fair-value shift: nothing below the hurdle may ever be tradable."""
    cfg = make_cfg()
    for shift in [0.0, 5.0, 10.0, 20.0, 30.0, 40.0, 60.0, 100.0]:
        est = evaluate(make_cfg(signal_fair_shift_bps=shift), make_book())
        if est.tradable:
            assert est.net_bps >= HURDLE, (
                f"tradable at net={est.net_bps:.3f} < hurdle {HURDLE} (shift={shift})"
            )
        else:
            assert est.net_bps < HURDLE


def test_depth_shortfall_still_refuses():
    est = evaluate(make_cfg(), make_book(), req=10_000.0)
    assert est.tradable is False
    assert est.reason == "insufficient_depth"


def test_costs_are_deducted_for_the_sell_side_too():
    sell = evaluate(make_cfg(), make_book(bid_sz=1.0, ask_sz=1_000_000.0), side="Sell")
    assert sell.fee_bps == pytest.approx(ONEWAY_FEE_BPS * 2.0)
    assert sell.adverse_bps > 0


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q", "--no-header"]))
