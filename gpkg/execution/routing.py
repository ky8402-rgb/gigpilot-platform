"""Execution routing policy: micro-price maker quoting, re-quote, and the taker gate.

WHY THIS EXISTS — the number that drives it
-------------------------------------------
Measured on a live BTCUSDT quote: a taker round trip costs **11.0 bps** in fees alone and a maker
round trip costs **4.0 bps**. That 7 bps difference is larger than the entire 3 bps edge hurdle the
platform used to trade on, and fees are ~90% of all friction (11.0 of 12.19 bps). At a 1-tick spread
of ~0.012 bps for BTC, the spread is economically irrelevant — the FEE is the cost, and the only way
to stop paying the taker fee is to stop taking.

So this module answers three questions, in order:
  1. Where should a passive order rest?   -> `micro_price`, rounded to the tick, clamped passive
  2. When is a resting order stale?       -> `should_requote` (age > 2500 ms, or the touch moved)
  3. When is taking justified after all?  -> `evaluate_taker_gate` (>= 12.0 bps net, taker fees paid)

WHAT THIS MODULE IS NOT
-----------------------
It is pure: no I/O, no clock, no exchange. Every decision is a function of its arguments, so the
policy can be exhaustively tested without a venue, and the code that ACTUALLY talks to Bybit
(`gpkg/execution/maker.py`) only executes decisions made here. Splitting them is deliberate — the
part that can lose money is the part that cannot be tested without capital.

TICK ARITHMETIC IS DECIMAL
--------------------------
Rounding is done in `Decimal`, consistent with the rest of the repo. A float tick-round can land a
"passive" buy a hair above the ask, and Bybit answers that with a post-only REJECTION — so a float
slipping upward turns an intended maker fill into no fill at all. Rounding DOWN for a buy and UP for
a sell (in Decimal) is what keeps the order genuinely passive.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_DOWN, ROUND_UP, Decimal
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:  # import only for typing: `vpin` must not be pulled in at runtime by the router
    from gpkg.strategy.vpin import ToxicityPolicy

from gpkg.ml.friction import (
    DEFAULT_TAKER_CROSS_HURDLE_BPS,
    FrictionBreakdown,
    build_friction,
    evaluate_admission,
)

# Spec: cancel and re-quote an unfilled order once it is older than this.
DEFAULT_MAX_QUOTE_AGE_MS = 2_500
# Spec: re-quote once the touch has drifted more than this many ticks from the open order price.
DEFAULT_MAX_DRIFT_TICKS = 1.0
# Spec: route as taker only above this net edge, after taker fees and 2x peak spread.
DEFAULT_TAKER_HURDLE_BPS = DEFAULT_TAKER_CROSS_HURDLE_BPS  # 12.0

Action = Literal["hold", "cancel_requote", "abandon"]


def _dec(v) -> Decimal:
    """Decimal via str(): never Decimal(float), which imports the binary error."""
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v).strip())


@dataclass(frozen=True)
class QuoteSnapshot:
    """Top-of-book. Only the touch is needed: the micro-price is a touch-weighted quantity."""

    bid_px: float
    ask_px: float
    bid_qty: float
    ask_qty: float
    ts_ms: int = 0

    @property
    def mid(self) -> float:
        return (self.bid_px + self.ask_px) / 2.0

    @property
    def spread_bps(self) -> float:
        m = self.mid
        if m <= 0:
            return float("inf")
        return (self.ask_px - self.bid_px) / m * 1e4

    @property
    def micro_price(self) -> float:
        return micro_price(self.bid_px, self.ask_px, self.bid_qty, self.ask_qty)

    def is_usable(self) -> bool:
        """A book we can price against: both sides present, positive, and not crossed."""
        try:
            b, a = float(self.bid_px), float(self.ask_px)
            bq, aq = float(self.bid_qty), float(self.ask_qty)
        except (TypeError, ValueError):
            return False
        if not (b > 0 and a > 0 and bq > 0 and aq > 0):
            return False
        return a > b


def micro_price(bid_px: float, ask_px: float, bid_qty: float, ask_qty: float) -> float:
    """Size-weighted top-of-book price.

    (bid_price * ask_qty + ask_price * bid_qty) / (bid_qty + ask_qty)

    The weights are CROSSED on purpose: the ask size is what supports the bid price, and vice versa.
    A heavy bid (large bid_qty) pulls the micro-price toward the ASK, because the bid will absorb
    the sells that would otherwise push price down. Equivalently, the micro-price is the volume
    weighted average of the touch, weighted by the OPPOSITE side's size.

    This deliberately does NOT fall back to mid on a degenerate book. Also skipping the
    decomposition into two terms is not possible: `mid` is the equal-size special case, so returning
    it here would silently discard the imbalance signal that is the entire point.

    Returns NaN for a degenerate book so the caller must decide — the routing planner treats NaN as
    "cannot price" and refuses the maker path rather than guessing a price.
    """
    try:
        b, a = float(bid_px), float(ask_px)
        bq, aq = float(bid_qty), float(ask_qty)
    except (TypeError, ValueError):
        return float("nan")
    total = bq + aq
    if not (b > 0 and a > 0 and bq >= 0 and aq >= 0) or total <= 0 or a <= b:
        return float("nan")
    return (b * aq + a * bq) / total


def round_passive(price: float, tick: float, side: str, *, bid_px: float, ask_px: float,
                  extra_ticks: int = 0) -> Decimal:
    """Round `price` to the tick such that the result CANNOT cross the book.

    A buy rounds DOWN, a sell rounds UP, and the result is additionally clamped to the near touch
    minus/plus `1 + extra_ticks` ticks. Both steps matter:
      * directional rounding alone can still land on a price that equals or crosses the far touch
        when bid and ask are one tick apart;
      * clamping alone can round AWAY from the touch and lose queue priority for no benefit.

    `extra_ticks` is the adverse-selection retreat: it moves the quote FURTHER from the touch, so a
    buy rests lower and a sell rests higher. That is the correct direction — a wider quote is filled
    less often, and the fills it does get are ones the market had to come to us for. Used by the VPIN
    toxicity policy.

    Never returns a crossing price for a usable book, which is what makes POST_ONLY safe to send.
    """
    t = _dec(tick)
    if t <= 0:
        raise ValueError(f"tick size must be positive, got {tick!r}")
    p = _dec(price)
    extra = max(0, int(extra_ticks))
    buy = str(side).strip().lower() in {"buy", "long", "bid"}
    if buy:
        q = (p / t).to_integral_value(rounding=ROUND_DOWN) * t
        ceiling = _dec(ask_px) - t * (1 + extra)
        if q > ceiling:
            q = (ceiling / t).to_integral_value(rounding=ROUND_DOWN) * t
    else:
        q = (p / t).to_integral_value(rounding=ROUND_UP) * t
        floor_ = _dec(bid_px) + t * (1 + extra)
        if q < floor_:
            q = (floor_ / t).to_integral_value(rounding=ROUND_UP) * t
    return q


def drift_ticks(order_price: float, side: str, *, bid_px: float, ask_px: float,
                tick: float) -> float:
    """How far the relevant touch has moved from our resting price, in ticks.

    The reference is the touch a resting order competes at: the BID for a buy, the ASK for a sell.
    Comparing against the far touch would flag drift whenever the spread widened, which is not a
    reason to abandon queue position.
    """
    t = float(tick)
    if t <= 0:
        return 0.0
    buy = str(side).strip().lower() in {"buy", "long", "bid"}
    ref = float(bid_px) if buy else float(ask_px)
    return abs(ref - float(order_price)) / t


@dataclass(frozen=True)
class RequoteDecision:
    action: Action
    reason: str
    drift_ticks: float
    age_ms: int


def should_requote(
    *,
    order_price: float,
    side: str,
    bid_px: float,
    ask_px: float,
    tick: float,
    age_ms: int,
    max_age_ms: int = DEFAULT_MAX_QUOTE_AGE_MS,
    max_drift_ticks: float = DEFAULT_MAX_DRIFT_TICKS,
) -> RequoteDecision:
    """Decide whether a resting maker order should be pulled and re-quoted.

    Two independent triggers, because they catch different failures:
      * AGE — the market has had 2.5s to fill us and has not. Queue priority is worth less than the
        option value of a fresh quote, and a stale resting order is exactly what adverse selection
        is made of.
      * DRIFT — the touch moved more than a tick, so our price is no longer the micro-price. Holding
        it means sitting at a price the book has already left.

    A crossed/through price takes precedence over both: if our resting price is no longer passive,
    the situation has changed materially and the order must be re-evaluated immediately rather than
    waiting out the age timer.
    """
    t = float(tick)
    d = drift_ticks(order_price, side, bid_px=bid_px, ask_px=ask_px, tick=t)
    buy = str(side).strip().lower() in {"buy", "long", "bid"}
    crossed = (float(order_price) >= float(ask_px)) if buy else (float(order_price) <= float(bid_px))
    age = max(0, int(age_ms))
    if crossed:
        return RequoteDecision("cancel_requote", "resting_price_no_longer_passive", d, age)
    if age > int(max_age_ms):
        return RequoteDecision(
            "cancel_requote",
            f"quote_age {age}ms > {int(max_age_ms)}ms",
            d, age,
        )
    if d > float(max_drift_ticks):
        return RequoteDecision(
            "cancel_requote",
            f"touch_drift {d:.3f} ticks > {float(max_drift_ticks):.3f} ticks",
            d, age,
        )
    return RequoteDecision("hold", "fresh_and_on_price", d, age)


@dataclass(frozen=True)
class TakerGate:
    allowed: bool
    net_bps: float
    reason: str
    friction: FrictionBreakdown


def evaluate_taker_gate(
    *,
    gross_edge_bps: float,
    peak_spread_bps: float,
    funding_bps: float = 0.0,
    impact_bps: float = 0.0,
    obi: float = 0.0,
    quote_age_ms: float = 0.0,
    side: str = "Buy",
    hurdle_bps: float = DEFAULT_TAKER_HURDLE_BPS,
    fee_rate_bps: float | None = None,
    notional_usd: float = 0.0,
    depth_notional_usd: float = 0.0,
) -> TakerGate:
    """May we cross the spread, or must we keep trying to rest?

    Crossing is charged the FULL taker cost — taker fee on both legs (0.055% x 2 = 11.0 bps) plus
    2x the measured peak spread — and must still clear 12.0 bps net. That is a strictly harder bar
    than the 8.0 bps the platform applies to a hypothesis, because crossing is the expensive option
    and the honest comparison is against resting, not against doing nothing.

    `peak_spread_bps` must come from MEASURED data. A default of 0 would make crossing look free and
    is therefore not offered.
    """
    friction = build_friction(
        liquidity="taker",
        measured_peak_spread_bps=peak_spread_bps,
        side=side,
        obi=obi,
        quote_age_ms=quote_age_ms,
        impact_bps=impact_bps,
        funding_bps=funding_bps,
        notional_usd=notional_usd,
        depth_notional_usd=depth_notional_usd,
        fee_rate_bps=fee_rate_bps,
    )
    adm = evaluate_admission(gross_edge_bps, friction, hurdle_bps=hurdle_bps)
    if adm.admitted:
        reason = f"taker_cross_justified net={adm.net_bps:.3f}bps >= {float(hurdle_bps):.3f}bps"
    else:
        reason = f"rest_instead: {adm.reason}"
    return TakerGate(allowed=adm.admitted, net_bps=adm.net_bps, reason=reason, friction=friction)


Mode = Literal["maker", "taker"]


@dataclass(frozen=True)
class EntryPlan:
    """What the executor should do for this entry. `mode="none"` means DO NOTHING."""

    mode: Literal["maker", "taker", "none"]
    reason: str
    limit_price: Decimal | None = None
    tick: Decimal | None = None
    taker: TakerGate | None = None


def plan_entry(
    *,
    quote: QuoteSnapshot | None,
    side: str,
    tick: float | None,
    gross_edge_bps: float,
    peak_spread_bps: float,
    funding_bps: float = 0.0,
    impact_bps: float = 0.0,
    obi: float = 0.0,
    quote_age_ms: float = 0.0,
    taker_hurdle_bps: float = DEFAULT_TAKER_HURDLE_BPS,
    fee_rate_bps: float | None = None,
    notional_usd: float = 0.0,
    depth_notional_usd: float = 0.0,
    toxicity: ToxicityPolicy | None = None,
) -> EntryPlan:
    """Prefer resting at the micro-price; take only when the 12 bps gate is genuinely cleared.

    TOXICITY OVERRIDE: when order flow is one-sided (high VPIN) the passive quote is the thing being
    picked off, so the plan retreats — first by widening (`widen_ticks`), and at extremes by not
    quoting at all. Pausing returns `mode="none"` even if the taker gate WOULD have allowed crossing,
    because crossing into informed flow pays the spread to be adversely selected faster.

    FAIL-CLOSED ORDERING. Every path that cannot quote safely ends in "taker-if-justified, else
    none" — never in "market anyway":
      * no quote, unusable book, or unknown tick  -> cannot price a passive order
      * unresolvable micro-price (NaN)            -> cannot price a passive order

    Returning `mode="none"` is a real outcome and the correct one when the taker gate also fails.
    Declining to trade costs nothing; crossing a spread on an edge that cannot pay for it is a
    guaranteed loss.
    """
    # THE TAKER GATE IS ALWAYS COMPUTED, even when the maker path is chosen.
    #
    # The first version returned early on the maker branch with `taker=None`, which meant the taker
    # crossing decision — requirement 3 of the spec — could NEVER fire: a maker quote that failed to
    # fill had no gate to fall back on and was always abandoned. The fallback is the whole point of
    # the gate, so it must be evaluated independently of which mode is initially preferred.
    gate = evaluate_taker_gate(
        gross_edge_bps=gross_edge_bps, peak_spread_bps=peak_spread_bps, funding_bps=funding_bps,
        impact_bps=impact_bps, obi=obi, quote_age_ms=quote_age_ms, side=side,
        hurdle_bps=taker_hurdle_bps, fee_rate_bps=fee_rate_bps,
        notional_usd=notional_usd, depth_notional_usd=depth_notional_usd,
    )

    can_quote = (
        quote is not None
        and quote.is_usable()
        and tick is not None
        and float(tick) > 0
    )
    mp = quote.micro_price if can_quote and quote is not None else float("nan")
    if toxicity is not None and toxicity.pause:
        return EntryPlan(
            mode="none", taker=gate,
            reason=f"toxicity_pause: {toxicity.reason} "
                   f"(vpin={toxicity.vpin}, p90={toxicity.threshold})",
        )

    widen = max(0, int(getattr(toxicity, "widen_ticks", 0))) if toxicity is not None else 0
    # EXPLICIT guards, not an implicit one. The old condition was `can_quote and mp == mp`, so the
    # proof that `quote.bid_px` was reachable lived inside a NaN comparison — invisible to a reader and
    # to a type checker. `tick` was worse: `float(None)` raises TypeError, which the handler below did
    # NOT catch, so an instrument spec with no tickSize let a TypeError escape `plan_entry` and kill
    # the caller's tick loop. Guarding here rather than returning early keeps the taker fall-through.
    if can_quote and quote is not None and tick is not None and tick > 0 and not math.isnan(mp):
        try:
            limit = round_passive(mp, float(tick), side,
                                  bid_px=quote.bid_px, ask_px=quote.ask_px,
                                  extra_ticks=widen)
        except (ValueError, ArithmeticError, TypeError):
            limit = None
        if limit is not None and limit > 0:
            suffix = f" (toxicity widened by {widen} tick(s))" if widen else ""
            return EntryPlan(mode="maker", reason=f"rest_at_micro_price {limit}{suffix}",
                             limit_price=limit, tick=_dec(tick), taker=gate)

    why = "no_usable_quote" if not can_quote else "micro_price_unavailable"
    if gate.allowed:
        return EntryPlan(mode="taker", reason=f"{why}; {gate.reason}", taker=gate)
    return EntryPlan(mode="none", reason=f"{why}; {gate.reason}", taker=gate)
