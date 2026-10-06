"""Economic friction model — the objective function every hypothesis is judged against.

WHY THIS MODULE EXISTS
----------------------
The platform already had a cost model (`gpkg/strategy/edge.py`), but it charges adverse selection
as `spread_bps * adverse_selection_factor` — a CONSTANT fraction of the spread. That is the wrong
shape for the thing it is trying to model. Adverse selection is not a property of the spread; it is
a property of the ORDER FLOW the quote sits in front of. A resting bid in a book that is unloading
into it is far more exposed than the same bid in a balanced book, and a quote whose L2 snapshot is
two seconds old is more exposed than one taken a millisecond ago. A constant cannot express either.

This module replaces that constant with an explicit microstructure model:
  * order-book imbalance (OBI) measures how hostile the book is to the resting side;
  * the L2 snapshot's informational value DECAYS with quote age, so an old quote is penalised more;
  * fees, spread, impact, adverse selection and funding are reported SEPARATELY, so any hypothesis
    whose edge survives only because one term was understated is visible rather than buried.

HONESTY ABOUT CALIBRATION
-------------------------
The OBI sensitivity, the base exposure and the decay half-life are STRUCTURAL parameters, not
measured ones. There is no live fill data in this repository to calibrate them against, and inventing
a calibration would be worse than declaring the absence. They are therefore chosen to be
conservative (they can only ever ADD cost, never remove it) and are exposed as parameters so that
the day real fill data exists, they can be fitted rather than guessed. Every term is monotone in the
direction of more cost, which is the safety property that matters: mis-calibration makes the model
pessimistic, and a pessimistic cost model rejects trades — it does not authorise bad ones.

WHAT THIS MODULE DELIBERATELY DOES NOT DO
-----------------------------------------
It has no third-party imports. This code runs inside the process holding live exchange credentials,
and the lifecycle module in this package set the same precedent for the same reason. Heavy numerics
belong offline in the research loop, not on the trading path.

FEE CONVENTION — THE BUG THIS PINS
----------------------------------
Bybit's `/v5/account/fee-rate` reports the fee PER SIDE. A completed round trip pays it on entry AND
on exit. Charging it once understates every round trip by one full fee unit (~5.5 bps at VIP0 taker)
and, against a 3 bps hurdle, that is enough to admit trades whose true expectancy is negative. Every
helper here takes an explicit `round_trip_multiple` and defaults it to 2.0.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

Liquidity = Literal["maker", "taker"]

# ------------------------------------------------------------------------------------------------
# Bybit V5 non-VIP baseline, PER SIDE. 0.020% maker / 0.055% taker.
# These are the published baseline rates and are used whenever the live fee-rate endpoint is
# unavailable, so that a credential failure degrades to the CONSERVATIVE rate rather than to zero.
# ------------------------------------------------------------------------------------------------
BYBIT_MAKER_FEE_BPS: float = 2.0
BYBIT_TAKER_FEE_BPS: float = 5.5

# Spec: reject any hypothesis whose positive gross edge collapses below +8.0 bps net.
DEFAULT_HURDLE_BPS: float = 8.0
# Spec: taker crossing is permitted only above this higher bar, because crossing pays the spread
# AND the taker fee, so it must clear a strictly harder threshold than a resting order.
DEFAULT_TAKER_CROSS_HURDLE_BPS: float = 12.0


def per_side_fee_bps(liquidity: Liquidity) -> float:
    """Published per-side fee for the given liquidity regime."""
    return BYBIT_MAKER_FEE_BPS if liquidity == "maker" else BYBIT_TAKER_FEE_BPS


def fee_bps(liquidity: Liquidity, *, round_trip_multiple: float = 2.0,
            fee_rate_bps: float | None = None) -> float:
    """Round-trip fee cost in bps.

    `fee_rate_bps` lets callers pass the rate actually returned by `/v5/account/fee-rate` for this
    account (which may be better than baseline). It is still PER SIDE and is still multiplied.
    """
    per_side = per_side_fee_bps(liquidity) if fee_rate_bps is None else float(fee_rate_bps)
    return abs(per_side) * abs(round_trip_multiple)


def order_book_imbalance(bid_depth: float, ask_depth: float) -> float:
    """OBI in [-1, +1]. Positive = bid-heavy book (buy-side pressure).

    Returns 0.0 for a degenerate/empty book rather than raising: an unreadable book must not be
    silently treated as hostile OR as favourable, and 0 makes the adverse-selection term fall back
    to its base exposure, which is the bounded, non-catastrophic answer.
    """
    b = max(0.0, float(bid_depth))
    a = max(0.0, float(ask_depth))
    total = b + a
    if total <= 0 or not math.isfinite(total):
        return 0.0
    return max(-1.0, min(1.0, (b - a) / total))


def hostile_imbalance(side: str, obi: float) -> float:
    """How hostile the book is to a passive order on `side`, in [0, 1].

    A resting BUY is exposed when the book is ASK-heavy (sellers are the ones who will cross into
    it), i.e. OBI < 0. A resting SELL is exposed when the book is BID-heavy, i.e. OBI > 0.

    Only the hostile half is returned; a book leaning in our favour is not credited with a
    NEGATIVE cost. That asymmetry is deliberate: this module may add cost but must never manufacture
    edge. Crediting favourable imbalance would turn a cost model into a signal generator.
    """
    o = max(-1.0, min(1.0, float(obi)))
    buy_side = str(side).strip().lower() in {"buy", "long", "bid"}
    return max(0.0, -o) if buy_side else max(0.0, o)


def snapshot_decay(quote_age_ms: float, *, half_life_ms: float = 1_000.0) -> float:
    """Informational decay of an L2 snapshot, in [0, 1). 0 = fresh, ->1 = stale.

    Exponential so the first fraction of a half-life dominates. The micro-price derived from a stale
    book is a stale price; this is the term that expresses that.
    """
    if not math.isfinite(quote_age_ms) or quote_age_ms <= 0 or half_life_ms <= 0:
        return 0.0
    return 1.0 - math.exp(-quote_age_ms / half_life_ms)


def adverse_selection_bps(
    *,
    side: str,
    spread_bps: float,
    obi: float,
    quote_age_ms: float = 0.0,
    base_fraction: float = 0.20,
    obi_sensitivity: float = 0.80,
    half_life_ms: float = 1_000.0,
    max_multiple: float = 2.0,
) -> float:
    """Adverse-selection cost in bps — the dynamic replacement for a constant spread fraction.

    exposure = base_fraction + obi_sensitivity * hostile_imbalance
    cost     = spread_bps * exposure * (1 + decay)

    At a fresh quote in a balanced book this reduces to `spread * base_fraction`; in a maximally
    hostile, fully-decayed quote it reaches `spread * (base + sensitivity) * 2`, capped by
    `max_multiple` so a pathological input cannot dominate the whole model.

    Monotone non-decreasing in spread, hostility and quote age — the three things that genuinely
    make a fill worse.
    """
    s = abs(float(spread_bps))
    if not math.isfinite(s) or s <= 0:
        return 0.0
    exposure = max(0.0, base_fraction) + max(0.0, obi_sensitivity) * hostile_imbalance(side, obi)
    decay = snapshot_decay(quote_age_ms, half_life_ms=half_life_ms)
    raw = s * exposure * (1.0 + decay)
    cap = s * abs(max_multiple)
    return min(raw, cap) if cap > 0 else raw


def market_impact_bps(notional_usd: float, depth_notional_usd: float, *,
                      coefficient: float = 1.0, exponent: float = 0.5,
                      scale_bps: float = 10.0) -> float:
    """Square-root market impact, in bps.

    impact_bps = coefficient * (notional / depth) ** exponent * scale_bps

    `depth_notional_usd` must be the REAL book depth (exchange-derived), and `scale_bps` anchors the
    curve: at `notional == depth` (consuming the whole visible book) impact equals
    `coefficient * scale_bps`. The default 10 bps is a STRUCTURAL anchor, not a fitted coefficient —
    it is deliberately not tiny, because under-pricing impact is the failure mode that lets
    unprofitable size through.

    A non-positive depth returns `math.inf` so the trade is REFUSED rather than priced: an order
    larger than a book we cannot read has unbounded cost, and returning a finite number there would
    be a fabrication that the hurdle would then wave through.
    """
    n = abs(float(notional_usd))
    d = float(depth_notional_usd)
    if not math.isfinite(n) or n <= 0:
        return 0.0
    if not math.isfinite(d) or d <= 0:
        return math.inf
    return max(0.0, float(coefficient)) * (n / d) ** float(exponent) * abs(float(scale_bps))


@dataclass(frozen=True)
class FrictionBreakdown:
    """Every cost of completing ONE round trip, in basis points, itemised.

    `spread_bps` is the round-trip spread cost (entry + exit). The spec's "2x Peak Spread" is
    encoded by `peak_spread_bps * 2`, where the peak is measured from real L2/data rather than
    assumed — see `worst_case_spread_bps`.
    """

    liquidity: Liquidity
    fees_bps: float
    spread_bps: float
    impact_bps: float
    adverse_bps: float
    funding_bps: float
    # `peak_spread_bps` retained for auditability: the raw measured peak before doubling.
    peak_spread_bps: float = 0.0
    round_trip_multiple: float = 2.0

    @property
    def total_bps(self) -> float:
        """Total friction. `inf` propagates, so an unpriced trade stays refused."""
        return (
            abs(self.fees_bps)
            + abs(self.spread_bps)
            + abs(self.impact_bps)
            + abs(self.adverse_bps)
            + abs(self.funding_bps)
        )


@dataclass(frozen=True)
class Admission:
    """Outcome of applying the hurdle to a hypothesis."""

    admitted: bool
    gross_bps: float
    net_bps: float
    reason: str


def worst_case_spread_bps(measured_peak_spread_bps: float, *, multiple: float = 2.0) -> float:
    """Round-trip spread cost from a MEASURED peak spread.

    The peak (not the mean) is used deliberately: an entry that is fine on average can still be
    ruinous at the moment liquidity is thinnest, and the peak is the observed worst case rather
    than a modelled one.
    """
    p = abs(float(measured_peak_spread_bps))
    return p * abs(float(multiple)) if math.isfinite(p) else math.inf


def build_friction(
    *,
    liquidity: Liquidity,
    measured_peak_spread_bps: float,
    side: str,
    obi: float,
    quote_age_ms: float = 0.0,
    impact_bps: float = 0.0,
    funding_bps: float = 0.0,
    notional_usd: float = 0.0,
    depth_notional_usd: float = 0.0,
    fee_rate_bps: float | None = None,
    round_trip_multiple: float = 2.0,
    spread_passes: float = 2.0,
    adverse_base_fraction: float = 0.20,
    adverse_obi_sensitivity: float = 0.80,
    adverse_half_life_ms: float = 1_000.0,
    impact_scale_bps: float = 10.0,
) -> FrictionBreakdown:
    """Assemble the full friction breakdown for one prospective round trip.

    IMPACT PRECEDENCE: a real order notional paired with real book depth is the more faithful input,
    because it is measured against the actual book, so it WINS when supplied. The scalar
    `impact_bps` is the fallback for callers that have already modelled impact elsewhere. The rule is
    stated explicitly because the previous form of this branch was inverted, which silently ignored
    a supplied notional.
    """
    spread = worst_case_spread_bps(measured_peak_spread_bps, multiple=spread_passes)
    if float(notional_usd) > 0:
        impact = market_impact_bps(notional_usd, depth_notional_usd, scale_bps=impact_scale_bps)
    else:
        impact = float(impact_bps)
    adverse = adverse_selection_bps(
        side=side,
        spread_bps=spread,
        obi=obi,
        quote_age_ms=quote_age_ms,
        base_fraction=adverse_base_fraction,
        obi_sensitivity=adverse_obi_sensitivity,
        half_life_ms=adverse_half_life_ms,
    )
    return FrictionBreakdown(
        liquidity=liquidity,
        fees_bps=fee_bps(liquidity, round_trip_multiple=round_trip_multiple,
                         fee_rate_bps=fee_rate_bps),
        spread_bps=spread,
        impact_bps=impact,
        adverse_bps=adverse,
        funding_bps=abs(float(funding_bps)),
        peak_spread_bps=abs(float(measured_peak_spread_bps)),
        round_trip_multiple=abs(float(round_trip_multiple)),
    )


def evaluate_admission(
    gross_bps: float,
    friction: FrictionBreakdown,
    *,
    hurdle_bps: float = DEFAULT_HURDLE_BPS,
) -> Admission:
    """The hard gate. Net edge must clear `hurdle_bps` after ALL friction.

    The spec's exact rejection rule is implemented here: a hypothesis with POSITIVE gross edge that
    collapses below the hurdle is rejected with that reason named explicitly, so the audit log shows
    not merely "rejected" but "rejected because friction ate the edge".
    """
    g = float(gross_bps)
    if not math.isfinite(g):
        return Admission(False, g, float("-inf"), "gross_edge_not_finite")
    total = friction.total_bps
    net = g - total
    if not math.isfinite(net):
        return Admission(False, g, net, "friction_unbounded_depth_or_spread")
    if net < float(hurdle_bps):
        if g > 0:
            return Admission(
                False, g, net,
                f"positive_gross_edge_collapsed_below_hurdle net={net:.4f}bps "
                f"< hurdle={float(hurdle_bps):.4f}bps (friction={total:.4f}bps)",
            )
        return Admission(False, g, net, f"no_gross_edge net={net:.4f}bps")
    return Admission(True, g, net, "clears_hurdle_after_all_friction")


def taker_crossing_allowed(
    net_bps_if_maker: float,
    gross_bps: float,
    *,
    taker_extra_cost_bps: float,
    hurdle_bps: float = DEFAULT_TAKER_CROSS_HURDLE_BPS,
) -> tuple[bool, str]:
    """Decide whether to give up on the passive fill and cross the spread.

    Crossing costs strictly more than resting (you pay the taker fee and you cross). It is therefore
    only worth doing when the edge is large enough to survive that surcharge AND still clear the
    higher 12 bps bar — the economic meaning of "high-momentum breakout conviction" is exactly that
    the opportunity is large enough to be worth paying up for.

    `taker_extra_cost_bps` is the marginal cost of crossing versus resting
    (taker_per_side - maker_per_side) * round_trip_multiple + the spread crossed.
    """
    net = float(net_bps_if_maker) - abs(float(taker_extra_cost_bps))
    if not math.isfinite(net):
        return False, "taker_crossing_cost_unbounded"
    if float(gross_bps) <= 0:
        return False, "no_gross_edge_to_cross_on"
    if net < float(hurdle_bps):
        return False, f"crossing_net={net:.4f}bps_below_taker_hurdle={float(hurdle_bps):.4f}bps"
    return True, f"crossing_justified net={net:.4f}bps"
