"""Maker entry lifecycle: place post-only at the micro-price, re-quote while it does not fill.

WHY THIS IS A SEPARATE MODULE FROM `routing.py`
-----------------------------------------------
`routing.py` decides WHAT to do and has no I/O, so it can be tested exhaustively. This module does
the I/O and is therefore the part that can actually lose money. Keeping them apart means the
policy is never tested indirectly through a venue, and this module can be driven end-to-end by
FAKES — which is the only way to prove the 2,500 ms cancel and the partial-fill handling work
without a funded account and a live book.

THE SAFETY ARGUMENT
-------------------
Everything here is fail-closed in one direction: a maker entry that does not fill leaves NO
position. The only way this module can produce exposure is a genuine fill, and any fill is
immediately handed to the caller to protect or flatten.

The dangerous case is a PARTIAL fill followed by a cancel, because that leaves a real but
unprotected position. It is handled explicitly: whatever quantity is filled is reported, the
executor protects THAT quantity, and the unfilled remainder is dropped. The module never reports a
fill it did not observe, and never treats "cancelled" as "nothing happened" — the filled quantity is
re-read AFTER the cancel, because the cancel response is not a reliable statement about fills that
landed just before it.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from gpkg.execution.routing import (
    DEFAULT_MAX_QUOTE_AGE_MS,
    QuoteSnapshot,
    should_requote,
)

log = logging.getLogger("gigpilot")


class MakerIO(Protocol):
    """The exchange surface this module needs. Implemented by the executor, faked by tests."""

    async def place_post_only(self, price: Decimal, link: str, side: str, qty: str) -> str:
        """Submit a post-only limit. Returns the venue order id.

        MUST raise if the venue rejects the order for crossing (Bybit rejects rather than silently
        taking), so the loop can fall through to the taker gate.
        """
        ...

    async def cancel(self, order_id: str, link: str) -> None:
        ...

    async def state(self, link: str) -> FillState:
        """Current fill state for our client order id. Must never raise for an unknown order."""
        ...

    async def book(self) -> QuoteSnapshot | None:
        ...


@dataclass
class FillState:
    filled_qty: float = 0.0
    avg_price: float = 0.0
    status: str = "unknown"   # open | filled | cancelled | rejected | unknown


@dataclass
class MakerOutcome:
    filled_qty: float
    avg_price: float
    requotes: int
    reason: str
    placed_any: bool = True
    # The client order id the VENUE actually saw, which for a re-quoted entry is a per-attempt child
    # (`...-q0`, `...-q1`), not the parent. The parent link would not match any order at the venue,
    # so recording it against the position would break the first reconciliation that tried to look
    # the order up — trading would look like it had produced an order the exchange has never heard of.
    filled_link: str = ""

    @property
    def filled(self) -> bool:
        return self.filled_qty > 0


async def run_maker_entry(
    io: MakerIO,
    *,
    side: str,
    qty: str,
    tick: float,
    link_prefix: str,
    now_ms: Callable[[], int],
    sleep: Callable[[float], Awaitable[None]],
    max_age_ms: int = DEFAULT_MAX_QUOTE_AGE_MS,
    max_requotes: int = 2,
    poll_interval_s: float = 0.15,
    max_wall_ms: int = 12_000,
) -> MakerOutcome:
    """Try to get filled as a maker. Returns what actually filled; never invents a fill.

    Bounded on three axes so a pathological book cannot spin forever: attempts (requotes), the age
    of a single quote, and total wall-clock time.
    """
    target = float(qty)
    if target <= 0:
        return MakerOutcome(0.0, 0.0, 0, "qty_not_positive", placed_any=False)

    requotes = 0
    started = now_ms()
    best_filled = 0.0
    best_px = 0.0
    last_reason = "no_attempt"

    for attempt in range(max(1, max_requotes + 1)):
        if now_ms() - started > max_wall_ms:
            last_reason = "wall_clock_budget_exhausted"
            break

        book = await io.book()
        if book is None or not book.is_usable():
            last_reason = "no_usable_book"
            break

        from gpkg.execution.routing import round_passive
        try:
            price = round_passive(book.micro_price, tick, side,
                                  bid_px=book.bid_px, ask_px=book.ask_px)
        except (ValueError, ArithmeticError):
            last_reason = "micro_price_unavailable"
            break
        if price <= 0:
            last_reason = "non_positive_limit"
            break

        link = f"{link_prefix}-q{attempt}"
        try:
            order_id = await io.place_post_only(price, link, side, qty)
        except Exception as exc:
            # A post-only rejection is INFORMATION, not a failure to retry blindly: it means the book
            # moved through our price between reading it and sending the order. Stop quoting and let
            # the caller apply the taker gate.
            log.info("post-only rejected for %s at %s: %s", link, price, exc)
            last_reason = f"post_only_rejected:{type(exc).__name__}"
            break

        placed_at = now_ms()
        # ---- poll this quote until it fills, goes stale, or drifts ----
        while True:
            st = await io.state(link)
            if st.filled_qty > 0:
                best_filled = max(best_filled, st.filled_qty)
                best_px = st.avg_price or best_px
            if st.filled_qty >= target:
                return MakerOutcome(st.filled_qty, st.avg_price or float(price), requotes,
                                    "filled_as_maker", filled_link=link)
            if st.status in ("cancelled", "rejected"):
                break
            age = now_ms() - placed_at
            if age > max_age_ms:
                break
            cur = await io.book()
            if cur is None or not cur.is_usable():
                break
            dec = should_requote(
                order_price=float(price), side=side,
                bid_px=cur.bid_px, ask_px=cur.ask_px, tick=tick,
                age_ms=age, max_age_ms=max_age_ms,
            )
            if dec.action == "cancel_requote":
                last_reason = dec.reason
                break
            await sleep(poll_interval_s)

        # ---- pull the quote, then re-read state: a fill can land between the check and the cancel
        # and the cancel response does NOT describe it ----
        try:
            await io.cancel(order_id, link)
        except Exception as exc:
            log.warning("cancel failed for %s: %s", link, exc)
        st_after = await io.state(link)
        if st_after.filled_qty > best_filled:
            best_filled = st_after.filled_qty
            best_px = st_after.avg_price or best_px
        if best_filled >= target:
            return MakerOutcome(best_filled, best_px, requotes, "filled_on_cancel_race",
                                filled_link=link)
        if best_filled > 0:
            # Partial: stop quoting. Chasing the remainder with a fresh passive order would widen
            # exposure that is currently unprotected, and the caller can protect what exists.
            return MakerOutcome(best_filled, best_px, requotes, "partial_fill_stopped",
                                filled_link=link)
        requotes += 1
        if requotes > max_requotes:
            last_reason = "requote_budget_exhausted"
            break

    return MakerOutcome(best_filled, best_px, requotes, last_reason)
