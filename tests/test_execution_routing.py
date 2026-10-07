#!/usr/bin/env python3
"""Execution routing: micro-price post-only quoting, the 2,500 ms cancel, and the 12 bps taker gate.

WHY THIS FILE EXISTS
--------------------
Measured on a live BTCUSDT quote, a taker round trip costs 11.0 bps in fees and a maker round trip
4.0 bps. That 7 bps is larger than the entire 3 bps edge hurdle the platform used to trade on, so
routing is the highest-value change available — and it is also the change most able to do harm,
because it sits directly on the order path. The tests are therefore split by the failure each one
prevents:

  * MICRO-PRICE      — pricing at a price the book never offered
  * PASSIVE ROUNDING — sending a "post-only" order that would cross (venue rejects it -> no fill)
  * RE-QUOTE POLICY  — sitting on a stale quote, which is exactly what adverse selection feeds on
  * TAKER GATE       — crossing when the edge cannot pay for it (a certain loss)
  * MAKER LIFECYCLE  — a filled order being mistaken for an empty one, leaving a naked position
  * FILL-DERIVED TP/SL — a stop placed AT the entry price by a mid-based estimate, i.e. instant
                         stop-out. This was a real defect found while wiring the maker path.

Run: python3 -m pytest tests/test_execution_routing.py -q
"""
from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.core.config import Config
from gpkg.execution.executor import Executor
from gpkg.execution.maker import FillState, run_maker_entry
from gpkg.execution.routing import (
    DEFAULT_MAX_QUOTE_AGE_MS,
    DEFAULT_TAKER_HURDLE_BPS,
    QuoteSnapshot,
    drift_ticks,
    evaluate_taker_gate,
    micro_price,
    plan_entry,
    round_passive,
    should_requote,
)
from gpkg.ml.friction import BYBIT_TAKER_FEE_BPS


# =============================================================================================
# MICRO-PRICE
# =============================================================================================
def test_micro_price_is_the_specified_formula():
    """(bid_price * ask_qty + ask_price * bid_qty) / (bid_qty + ask_qty), verbatim."""
    bid, ask, bq, aq = 100.0, 101.0, 3.0, 1.0
    expected = (bid * aq + ask * bq) / (bq + aq)          # (100*1 + 101*3) / 4 = 100.75
    assert micro_price(bid, ask, bq, aq) == pytest.approx(expected)
    assert micro_price(bid, ask, bq, aq) == pytest.approx(100.75)


def test_equal_sizes_collapse_to_the_mid():
    """The mid is the equal-size special case — a useful sanity anchor for the weighting."""
    assert micro_price(100.0, 101.0, 5.0, 5.0) == pytest.approx(100.5)


def test_heavy_bid_pulls_the_price_toward_the_ask():
    """Crossed weighting: a heavy bid absorbs sells, so it supports a HIGHER price."""
    heavy_bid = micro_price(100.0, 101.0, 9.0, 1.0)
    heavy_ask = micro_price(100.0, 101.0, 1.0, 9.0)
    assert heavy_bid > 100.5 > heavy_ask
    assert heavy_bid == pytest.approx((100.0 * 1 + 101.0 * 9) / 10)


def test_degenerate_books_return_nan_not_the_mid():
    """NaN forces the caller to decide. Returning the mid would silently discard the imbalance
    signal that is the entire point of a micro-price."""
    assert micro_price(0, 0, 0, 0) != micro_price(0, 0, 0, 0)      # NaN
    assert micro_price(101.0, 100.0, 1.0, 1.0) != micro_price(101.0, 100.0, 1.0, 1.0)  # crossed
    assert micro_price(100.0, 101.0, 0.0, 0.0) != micro_price(100.0, 101.0, 0.0, 0.0)


def test_quote_snapshot_usable_and_spread():
    q = QuoteSnapshot(bid_px=100.0, ask_px=100.1, bid_qty=1.0, ask_qty=1.0)
    assert q.is_usable() is True
    assert q.spread_bps == pytest.approx(0.1 / 100.05 * 1e4)
    assert QuoteSnapshot(0.0, 100.0, 1.0, 1.0).is_usable() is False
    assert QuoteSnapshot(101.0, 100.0, 1.0, 1.0).is_usable() is False


# =============================================================================================
# PASSIVE ROUNDING — must never produce a crossing price
# =============================================================================================
def test_buy_rounds_down_and_sell_rounds_up():
    assert round_passive(100.55, 0.1, "Buy", bid_px=100.4, ask_px=100.8) == Decimal("100.5")
    assert round_passive(100.51, 0.1, "Sell", bid_px=100.4, ask_px=100.8) == Decimal("100.6")


def test_one_tick_spread_quotes_the_near_touch():
    """With a single tick between the touches, passive means exactly bid (buy) / ask (sell)."""
    assert round_passive(100.55, 0.1, "Buy", bid_px=100.5, ask_px=100.6) == Decimal("100.5")
    assert round_passive(100.55, 0.1, "Sell", bid_px=100.5, ask_px=100.6) == Decimal("100.6")


def test_rounded_price_never_crosses_the_book():
    """A crossing price sent as post-only is REJECTED by the venue, turning an intended maker fill
    into no fill at all. This is the property that makes POST_ONLY safe to send."""
    for bid, ask in [(100.0, 100.1), (100.0, 101.0), (99.9, 100.0)]:
        for px in [bid, (bid + ask) / 2, ask, bid - 0.05, ask + 0.05]:
            b = round_passive(px, 0.1, "Buy", bid_px=bid, ask_px=ask)
            s = round_passive(px, 0.1, "Sell", bid_px=bid, ask_px=ask)
            assert b < Decimal(str(ask)), f"buy {b} crosses ask {ask}"
            assert s > Decimal(str(bid)), f"sell {s} crosses bid {bid}"


def test_zero_tick_is_refused():
    with pytest.raises(ValueError):
        round_passive(100.0, 0.0, "Buy", bid_px=99.9, ask_px=100.1)


# =============================================================================================
# RE-QUOTE POLICY
# =============================================================================================
def test_drift_is_measured_against_the_touch_we_compete_at():
    """A buy competes at the BID; comparing against the ask would flag drift merely because the
    spread widened, which is not a reason to surrender queue position."""
    assert drift_ticks(100.5, "Buy", bid_px=100.5, ask_px=101.0, tick=0.1) == pytest.approx(0.0)
    assert drift_ticks(100.5, "Sell", bid_px=100.5, ask_px=101.0, tick=0.1) == pytest.approx(5.0)


def test_stale_quote_is_cancelled_at_2500ms():
    d = should_requote(order_price=100.5, side="Buy", bid_px=100.5, ask_px=100.6, tick=0.1,
                       age_ms=DEFAULT_MAX_QUOTE_AGE_MS + 1)
    assert d.action == "cancel_requote"
    assert "quote_age" in d.reason and "2500" in d.reason


def test_age_boundary_is_not_premature():
    """At exactly the budget the quote is still live: pulling a fraction early costs fills."""
    at_budget = should_requote(order_price=100.5, side="Buy", bid_px=100.5, ask_px=100.6, tick=0.1,
                               age_ms=DEFAULT_MAX_QUOTE_AGE_MS)
    assert at_budget.action == "hold"


def test_drift_over_one_tick_triggers_a_requote():
    d = should_requote(order_price=100.5, side="Buy", bid_px=100.8, ask_px=100.9, tick=0.1, age_ms=10)
    assert d.action == "cancel_requote"
    assert "touch_drift" in d.reason


def test_fresh_and_on_price_holds():
    d = should_requote(order_price=100.5, side="Buy", bid_px=100.5, ask_px=100.6, tick=0.1, age_ms=10)
    assert d.action == "hold"


def test_a_no_longer_passive_price_requotes_immediately():
    """Precedence: if our resting price is no longer passive the situation changed materially, and
    waiting out the age timer would leave us resting through the book."""
    d = should_requote(order_price=100.9, side="Buy", bid_px=100.8, ask_px=100.85, tick=0.1, age_ms=1)
    assert d.action == "cancel_requote"
    assert "passive" in d.reason


# =============================================================================================
# THE 12 BPS TAKER GATE
# =============================================================================================
def test_taker_hurdle_is_twelve_bps():
    assert DEFAULT_TAKER_HURDLE_BPS == 12.0


def test_gate_charges_full_taker_fees_and_2x_spread():
    g = evaluate_taker_gate(gross_edge_bps=0.0, peak_spread_bps=2.0)
    # The two components the spec names, charged in full and round-trip:
    #   11.0 bps taker fee (0.055% x 2 legs) + 4.0 bps (2 x peak spread)
    assert g.friction.fees_bps == pytest.approx(BYBIT_TAKER_FEE_BPS * 2)
    assert g.friction.spread_bps == pytest.approx(4.0)
    # Adverse selection is an ADDITIONAL, spread-derived term, so total cost exceeds fees+spread.
    assert g.friction.adverse_bps > 0.0
    assert g.friction.total_bps == pytest.approx(
        g.friction.fees_bps + g.friction.spread_bps + g.friction.impact_bps
        + g.friction.adverse_bps + g.friction.funding_bps
    )
    assert g.net_bps == pytest.approx(-g.friction.total_bps)
    assert g.net_bps < -15.0, "a taker round trip must cost more than fees + spread alone"


def test_below_the_hurdle_must_rest():
    g = evaluate_taker_gate(gross_edge_bps=20.0, peak_spread_bps=1.0)
    assert g.allowed is False
    assert "rest_instead" in g.reason


def test_above_the_hurdle_may_cross():
    g = evaluate_taker_gate(gross_edge_bps=60.0, peak_spread_bps=1.0)
    assert g.allowed is True
    assert g.net_bps >= 12.0
    assert "justified" in g.reason


def test_boundary_is_inclusive_at_twelve_bps():
    base = evaluate_taker_gate(gross_edge_bps=0.0, peak_spread_bps=1.0)
    cost = base.friction.total_bps
    assert evaluate_taker_gate(gross_edge_bps=cost + 12.0, peak_spread_bps=1.0).allowed is True
    assert evaluate_taker_gate(gross_edge_bps=cost + 11.99, peak_spread_bps=1.0).allowed is False


def test_a_wide_spread_raises_the_bar():
    """Peak spread is a real cost input, so a wide book must make crossing harder, not equally hard."""
    tight = evaluate_taker_gate(gross_edge_bps=30.0, peak_spread_bps=0.5)
    wide = evaluate_taker_gate(gross_edge_bps=30.0, peak_spread_bps=20.0)
    assert wide.net_bps < tight.net_bps
    assert wide.allowed is False


def test_unmeasurable_liquidity_refuses_crossing():
    """An unreadable book cannot be priced, so it must block crossing rather than assume it is free."""
    g = evaluate_taker_gate(gross_edge_bps=500.0, peak_spread_bps=1.0,
                            notional_usd=5000.0, depth_notional_usd=0.0)
    assert g.allowed is False


# =============================================================================================
# ENTRY PLANNING
# =============================================================================================
def test_plan_prefers_maker_when_a_book_exists():
    q = QuoteSnapshot(bid_px=100.0, ask_px=100.2, bid_qty=1.0, ask_qty=1.0)
    p = plan_entry(quote=q, side="Buy", tick=0.1, gross_edge_bps=100.0, peak_spread_bps=1.0)
    assert p.mode == "maker"
    assert p.limit_price is not None and p.limit_price > 0


def test_plan_falls_back_to_taker_only_above_the_hurdle():
    q = QuoteSnapshot(bid_px=100.0, ask_px=100.2, bid_qty=1.0, ask_qty=1.0)
    rich = plan_entry(quote=q, side="Buy", tick=0.1, gross_edge_bps=100.0, peak_spread_bps=1.0)
    assert rich.mode == "maker"
    # no book -> cannot rest -> only a large edge justifies crossing
    thin = plan_entry(quote=None, side="Buy", tick=0.1, gross_edge_bps=20.0, peak_spread_bps=1.0)
    assert thin.mode == "none", "a thin edge with no book must NOT cross"
    fat = plan_entry(quote=None, side="Buy", tick=0.1, gross_edge_bps=60.0, peak_spread_bps=1.0)
    assert fat.mode == "taker"


def test_plan_refuses_when_the_tick_is_unknown():
    q = QuoteSnapshot(bid_px=100.0, ask_px=100.2, bid_qty=1.0, ask_qty=1.0)
    p = plan_entry(quote=q, side="Buy", tick=None, gross_edge_bps=20.0, peak_spread_bps=1.0)
    assert p.mode == "none", "cannot price a passive order without a tick"


def test_a_maker_plan_still_carries_the_taker_gate():
    """REGRESSION GUARD for a real bug: the maker branch used to return with `taker=None`, so the
    taker fallback could never fire and a failed maker quote was always abandoned. The gate must be
    computed regardless of which mode is preferred, because it is only ever consulted AFTER the maker
    attempt fails."""
    q = QuoteSnapshot(bid_px=100.0, ask_px=100.2, bid_qty=1.0, ask_qty=1.0)
    cheap = plan_entry(quote=q, side="Buy", tick=0.1, gross_edge_bps=5.0, peak_spread_bps=1.0)
    assert cheap.mode == "maker"
    assert cheap.taker is not None, "maker plan lost its taker gate — the fallback is dead again"
    assert cheap.taker.allowed is False

    rich = plan_entry(quote=q, side="Buy", tick=0.1, gross_edge_bps=80.0, peak_spread_bps=1.0)
    assert rich.mode == "maker"
    assert rich.taker is not None and rich.taker.allowed is True, (
        "a large edge must leave the fallback ARMED even when the maker path is preferred"
    )


# =============================================================================================
# MAKER LIFECYCLE — the 2,500 ms cancel, proven with a fake clock
# =============================================================================================
class _Clock:
    def __init__(self) -> None:
        self.t = 1_000_000

    def now(self) -> int:
        return self.t

    async def sleep(self, _s: float) -> None:
        self.t += 200          # every poll advances 200 ms, so 2500 ms arrives in ~13 polls


class _FakeIO:
    """Scriptable maker surface. `fill_after_ms=None` models a book that never trades with us."""

    def __init__(self, clock: _Clock, *, fill_after_ms: int | None = None,
                 partial: float = 0.0, reject_post_only: bool = False,
                 book_flips: bool = True) -> None:
        self.clock = clock
        self.fill_after_ms = fill_after_ms
        self.partial = partial
        self.reject_post_only = reject_post_only
        self.book_flips = book_flips
        self.placed: list[dict] = []
        self.cancelled: list[str] = []
        self._placed_at: dict[str, int] = {}

    async def book(self) -> QuoteSnapshot:
        # Price drifts away over time so a stale quote is also a drifted one.
        shift = 0.5 if (self.book_flips and self.placed and self.clock.now() % 400 == 0) else 0.0
        return QuoteSnapshot(bid_px=100.0 + shift, ask_px=100.1 + shift,
                             bid_qty=1.0, ask_qty=1.0, ts_ms=self.clock.now())

    async def place_post_only(self, price, link, side, qty) -> str:
        if self.reject_post_only:
            raise RuntimeError("post-only order would cross")
        self.placed.append({"link": link, "price": price, "side": side, "qty": qty})
        self._placed_at[link] = self.clock.now()
        return f"oid-{len(self.placed)}"

    async def cancel(self, order_id: str, link: str) -> None:
        self.cancelled.append(link)

    async def state(self, link: str) -> FillState:
        placed_at = self._placed_at.get(link, 0)
        if self.fill_after_ms is not None and self.clock.now() - placed_at >= self.fill_after_ms:
            q = float(next(p["qty"] for p in self.placed if p["link"] == link))
            return FillState(q, 100.0, "filled")
        if self.partial and link in self.cancelled:
            return FillState(self.partial, 100.0, "cancelled")
        return FillState(0.0, 0.0, "open")


@pytest.mark.asyncio
async def test_unfilled_order_is_cancelled_when_it_exceeds_2500ms():
    """THE spec requirement: cancel and re-quote an unfilled order older than 2,500 ms."""
    clock = _Clock()
    io = _FakeIO(clock, fill_after_ms=None)
    out = await run_maker_entry(
        io, side="Buy", qty="1.0", tick=0.1, link_prefix="gp-test",
        now_ms=clock.now, sleep=clock.sleep, max_age_ms=2500, max_requotes=2,
        poll_interval_s=0.2, max_wall_ms=60_000,
    )
    assert out.filled is False
    assert io.cancelled, "the unfilled quote was never cancelled — the 2500 ms rule did not fire"
    assert out.requotes >= 1, f"no re-quote happened: {out.reason}"
    assert out.reason in ("requote_budget_exhausted", "touch_drift")


@pytest.mark.asyncio
async def test_requotes_are_bounded():
    clock = _Clock()
    io = _FakeIO(clock, fill_after_ms=None)
    out = await run_maker_entry(
        io, side="Buy", qty="1.0", tick=0.1, link_prefix="gp-test",
        now_ms=clock.now, sleep=clock.sleep, max_age_ms=2500, max_requotes=2,
        poll_interval_s=0.2, max_wall_ms=60_000,
    )
    assert out.filled is False
    assert len(io.placed) <= 3, f"requote loop is unbounded: placed {len(io.placed)}"


@pytest.mark.asyncio
async def test_a_fill_returns_the_link_the_venue_saw():
    """The recorded order link must be one the venue actually has, or the first reconciliation
    reports a position with an order the exchange has never heard of."""
    clock = _Clock()
    io = _FakeIO(clock, fill_after_ms=0)
    out = await run_maker_entry(
        io, side="Buy", qty="1.0", tick=0.1, link_prefix="gp-test",
        now_ms=clock.now, sleep=clock.sleep, max_age_ms=2500, max_requotes=2,
    )
    assert out.filled is True
    assert out.filled_link == "gp-test-q0"
    assert io.cancelled == [], "a filled order must not be cancelled"


@pytest.mark.asyncio
async def test_partial_fill_stops_and_is_reported():
    """A partial fill is a REAL position. Chasing the remainder would widen unprotected exposure,
    so the loop stops and reports exactly what filled."""
    clock = _Clock()
    io = _FakeIO(clock, fill_after_ms=None, partial=0.4)
    out = await run_maker_entry(
        io, side="Buy", qty="1.0", tick=0.1, link_prefix="gp-test",
        now_ms=clock.now, sleep=clock.sleep, max_age_ms=2500, max_requotes=3,
        poll_interval_s=0.2, max_wall_ms=60_000,
    )
    assert out.filled_qty == pytest.approx(0.4)
    assert out.reason == "partial_fill_stopped"
    assert out.filled is True


@pytest.mark.asyncio
async def test_post_only_rejection_stops_instead_of_looping():
    """A rejection means the book moved through our price between reading and sending. Retrying
    blindly would just burn attempts; the caller must apply the taker gate."""
    clock = _Clock()
    io = _FakeIO(clock, reject_post_only=True)
    out = await run_maker_entry(
        io, side="Buy", qty="1.0", tick=0.1, link_prefix="gp-test",
        now_ms=clock.now, sleep=clock.sleep, max_age_ms=2500, max_requotes=3,
    )
    assert out.filled is False
    assert "post_only_rejected" in out.reason
    assert len(io.placed) == 0


@pytest.mark.asyncio
async def test_non_positive_qty_is_refused_before_touching_the_venue():
    clock = _Clock()
    io = _FakeIO(clock)
    out = await run_maker_entry(io, side="Buy", qty="0", tick=0.1, link_prefix="gp-test",
                                now_ms=clock.now, sleep=clock.sleep)
    assert out.placed_any is False
    assert io.placed == []


# =============================================================================================
# EXECUTOR INTEGRATION
# =============================================================================================
class _RoutingREST:
    """Stand-in BybitREST. Records orders; exposes fill state per orderLinkId."""

    def __init__(self, *, fill_maker: bool = True, position_size: str = "0",
                 positions_raise: bool = False) -> None:
        self.orders: list[dict] = []
        self.cancels: list[dict] = []
        self.protections: list[dict] = []
        self.fills: dict[str, dict] = {}
        self.fill_maker = fill_maker
        self.position_size = position_size
        self.positions_raise = positions_raise
        self._links: set[str] = set()

    async def place_order(self, **kw):
        link = kw.get("orderLinkId", "")
        if link in self._links:
            from gpkg.core.errors import DUPLICATE_ORDER_LINK_CODE, BybitError
            raise BybitError(DUPLICATE_ORDER_LINK_CODE, "duplicate")
        self._links.add(link)
        self.orders.append(kw)
        if kw.get("timeInForce") == "PostOnly" and self.fill_maker:
            self.fills[link] = {"orderId": f"o{len(self.orders)}", "orderLinkId": link,
                                "symbol": kw.get("symbol"), "cumExecQty": kw.get("qty"),
                                "avgPrice": kw.get("price"), "orderStatus": "Filled"}
        return {"orderId": f"o{len(self.orders)}", "orderLinkId": link}

    async def cancel_order(self, **kw):
        self.cancels.append(kw)
        return {}

    async def open_orders(self):
        return []

    async def order_history(self, symbol, order_link_id=None, limit=50):
        rows = [v for v in self.fills.values() if v["symbol"] == symbol]
        if order_link_id:
            rows = [v for v in rows if v["orderLinkId"] == order_link_id]
        return rows

    async def trading_stop(self, **kw):
        self.protections.append(kw)
        return {}

    async def positions(self):
        if self.positions_raise:
            raise RuntimeError("positions unavailable")
        return [{"symbol": "BTCUSDT", "size": self.position_size, "avgPrice": "100.0"}]


def _executor(rest: _RoutingREST, **cfg_overrides) -> Executor:
    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"])
    for k, v in cfg_overrides.items():
        setattr(cfg, k, v)
    return Executor(cfg, rest, {"BTCUSDT": 0.001})


def _book(bid=100.0, ask=100.2, bq=1.0, aq=1.0):
    async def fn() -> QuoteSnapshot:
        return QuoteSnapshot(bid_px=bid, ask_px=ask, bid_qty=bq, ask_qty=aq)
    return fn


@pytest.mark.asyncio
async def test_entry_rests_post_only_at_the_micro_price():
    rest = _RoutingREST()
    ex = _executor(rest)
    res = await ex.open_protected("BTCUSDT", "Buy", 1.0, 105.0, 95.0,
                                  quote_fn=_book(), tick_size=0.1,
                                  gross_edge_bps=30.0, peak_spread_bps=1.0,
                                  tp_bps=100.0, sl_bps=50.0)
    entry = rest.orders[0]
    assert entry["orderType"] == "Limit"
    assert entry["timeInForce"] == "PostOnly", "the entry must be post-only"
    assert entry["price"] == "100.1", f"expected the micro-price, got {entry['price']}"
    assert res["route"] == "maker"
    assert rest.protections, "a filled entry must be protected"


@pytest.mark.asyncio
async def test_entry_without_a_book_keeps_the_legacy_market_path():
    """No quote means no price to rest at, so behaviour must be UNCHANGED rather than broken."""
    rest = _RoutingREST()
    ex = _executor(rest)
    res = await ex.open_protected("BTCUSDT", "Buy", 1.0, 105.0, 95.0)
    assert rest.orders[0]["orderType"] == "Market"
    assert "timeInForce" not in rest.orders[0]
    assert res["route"] == "market"


@pytest.mark.asyncio
async def test_a_thin_edge_cannot_cross_and_is_skipped():
    """The economic core: no fill as a maker + an edge that cannot pay the taker cost = NO TRADE."""
    rest = _RoutingREST(fill_maker=False)
    ex = _executor(rest)
    res = await ex.open_protected("BTCUSDT", "Buy", 1.0, 105.0, 95.0,
                                  quote_fn=_book(), tick_size=0.1,
                                  gross_edge_bps=6.0, peak_spread_bps=1.0)
    assert res.get("skipped") is True
    assert rest.protections == [], "registered protection without a position"
    assert all(o.get("orderType") != "Market" for o in rest.orders), (
        "a thin edge must never be crossed as a market order"
    )


@pytest.mark.asyncio
async def test_a_large_edge_may_cross_as_ioc():
    rest = _RoutingREST(fill_maker=False)
    ex = _executor(rest)
    res = await ex.open_protected("BTCUSDT", "Buy", 1.0, 105.0, 95.0,
                                  quote_fn=_book(), tick_size=0.1,
                                  gross_edge_bps=80.0, peak_spread_bps=1.0,
                                  tp_bps=100.0, sl_bps=50.0)
    assert res["route"] == "taker"
    cross = rest.orders[-1]
    assert cross["orderType"] == "Limit"
    assert cross["timeInForce"] == "IOC", "crossing must be an IOC limit so the fill is price-capped"
    assert float(cross["price"]) == pytest.approx(100.2), "cross at the ask"


@pytest.mark.asyncio
async def test_a_position_the_loop_did_not_see_is_still_protected():
    """THE dangerous case. `fill_maker=False` makes the loop conclude "no fill", but the venue
    reports a position. Treating that as flat would leave a real position with no stop."""
    rest = _RoutingREST(fill_maker=False, position_size="0.7")
    ex = _executor(rest)
    res = await ex.open_protected("BTCUSDT", "Buy", 1.0, 105.0, 95.0,
                                  quote_fn=_book(), tick_size=0.1,
                                  gross_edge_bps=6.0, peak_spread_bps=1.0)
    assert res.get("route") == "maker_verified"
    assert rest.protections, "an observed position MUST be protected even when the loop saw no fill"


@pytest.mark.asyncio
async def test_an_unreadable_position_refuses_rather_than_guessing():
    rest = _RoutingREST(fill_maker=False, positions_raise=True)
    ex = _executor(rest)
    with pytest.raises(RuntimeError, match="POSITION_STATE_UNVERIFIED_AFTER_MAKER"):
        await ex.open_protected("BTCUSDT", "Buy", 1.0, 105.0, 95.0,
                                quote_fn=_book(), tick_size=0.1,
                                gross_edge_bps=6.0, peak_spread_bps=1.0)


@pytest.mark.asyncio
async def test_protection_is_re_derived_from_the_fill_not_the_estimate():
    """The defect found while wiring the maker path: a mid-based SL against a better bid fill lands
    AT the entry, i.e. an instant stop-out."""
    rest = _RoutingREST()
    ex = _executor(rest)
    # Caller's estimate is the mid-based 100.0; the maker fill lands at the 100.1 micro-price.
    res = await ex.open_protected("BTCUSDT", "Buy", 1.0, 100.0, 99.9,
                                  quote_fn=_book(), tick_size=0.1,
                                  gross_edge_bps=30.0, peak_spread_bps=1.0,
                                  tp_bps=100.0, sl_bps=50.0)
    fill = float(res["fill_px"])
    tp, sl = float(res["tp"]), float(res["sl"])
    assert sl < fill, f"stop {sl} is not below the fill {fill} — instant stop-out"
    assert tp > fill, f"target {tp} is not above the fill {fill}"
    assert sl == pytest.approx(fill * (1 - 50.0 / 1e4), rel=1e-3), "SL must scale from the fill"


@pytest.mark.asyncio
async def test_declining_to_trade_is_metric_visible():
    rest = _RoutingREST(fill_maker=False)
    ex = _executor(rest)
    res = await ex.open_protected("BTCUSDT", "Buy", 1.0, 105.0, 95.0,
                                  quote_fn=_book(), tick_size=0.1,
                                  gross_edge_bps=6.0, peak_spread_bps=1.0)
    assert res["skipped"] is True
    assert res["qty"] == "0"
    assert res.get("reason")


@pytest.mark.asyncio
async def test_routing_can_be_disabled_by_config():
    """An operator must be able to revert to crossing without a code change."""
    rest = _RoutingREST()
    ex = _executor(rest, maker_entry_enabled=False)
    await ex.open_protected("BTCUSDT", "Buy", 1.0, 105.0, 95.0,
                            quote_fn=_book(), tick_size=0.1,
                            gross_edge_bps=30.0, peak_spread_bps=1.0)
    assert rest.orders[0]["orderType"] == "Market"
