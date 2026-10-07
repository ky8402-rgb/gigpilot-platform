"""Execution engine for Bybit Linear perpetuals (One-Way mode).

Safety invariants:
  - Refuses unknown or missing instrument step sizes.
  - Bounded quantity precision rounded down to contract lot step.
  - Guaranteed execution idempotency on orderLinkId: duplicate returns 110072 (treated as already accepted).
  - Position protection enforcement: immediately flattens and unwinds position if TP/SL registration fails.
"""
from __future__ import annotations

import asyncio
import logging
import math
import uuid
from collections.abc import Awaitable, Callable
from decimal import ROUND_FLOOR, Decimal, InvalidOperation
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:  # typing-only: the executor must not import the strategy package at runtime
    from gpkg.strategy.vpin import ToxicityPolicy

from gpkg.core.clock import now_ms
from gpkg.core.config import Config
from gpkg.core.errors import DUPLICATE_ORDER_LINK_CODE, BybitError
from gpkg.core.metrics import Metrics
from gpkg.exchange.base import (
    ExchangeAdapter,
    OrderRequest,
    OrderType,
    Side,
    TimeInForce,
)
from gpkg.exchange.bybit_rest import BybitREST
from gpkg.execution.maker import FillState, run_maker_entry
from gpkg.execution.routing import EntryPlan, QuoteSnapshot, plan_entry

log = logging.getLogger("gigpilot")


def _dec(value) -> Decimal:
    """Exact Decimal for a quantity, step or price.

    NEVER use `Decimal(float)`: that imports the binary representation error
    (`Decimal(0.3) == 0.29999999999999998889...`), reproducing the very bug this exists to remove.
    `Decimal(str(x))` uses the shortest representation that round-trips — the value the caller
    actually meant — and passes strings through untouched, which is how exchange payloads arrive.
    """
    if isinstance(value, Decimal):
        return value
    if isinstance(value, str):
        return Decimal(value.strip())
    return Decimal(str(value))


def _fmt_qty(v: Decimal) -> str:
    """Plain decimal string, no trailing zeros, never scientific notation.

    `format(..., 'f')` is required: `Decimal.normalize()` turns 100 into `1E+2`, and `str()` of that
    would go on the wire as `1E+2`, which no venue accepts.
    """
    return format(v.normalize(), "f")


class Executor:
    def __init__(
        self,
        cfg: Config,
        rest: BybitREST | ExchangeAdapter,
        step_sizes: dict[str, float],
        metrics: Metrics | None = None,
        min_sizes: dict[str, float] | None = None,
        min_notionals: dict[str, float] | None = None,
    ):
        self.cfg = cfg
        # Backward-compatible constructor for tests/migration, but production passes an
        # ExchangeAdapter. Keeping the raw REST object only as a legacy seam prevents a flag-day
        # rewrite while making the adapter the real live mutation path.
        self.adapter = rest if isinstance(rest, ExchangeAdapter) else None
        self.rest = rest.rest if self.adapter is not None and hasattr(rest, "rest") else rest
        self.step_size = step_sizes
        self.min_size = min_sizes or {}
        #: Bybit's `lotSizeFilter.minNotionalValue`. The EXCHANGE minimum, read from the instrument
        #: spec rather than hardcoded, so the eligibility decision tracks reality instead of a number
        #: someone typed once. A quantity can clear `minOrderQty` and still be refused for notional.
        self.min_notional = min_notionals or {}
        self._metrics = metrics

    def _round_qty(self, symbol: str, qty) -> str:
        """Round DOWN to the contract lot step, in DECIMAL. Used by BOTH entry and exit paths.

        WHY DECIMAL AND NOT FLOAT
        -------------------------
        This was `math.floor(qty / step) * step` on Python floats. Binary floats cannot represent
        most decimal lot steps, so the division lands just BELOW the intended integer and the floor
        drops a whole extra step. Measured against real step sizes:

            step 0.001:  1.005 -> 1.004
            step 0.1:    0.3   -> 0.2      <-- 33% under
            step 0.1:    2.675 -> 2.6
            step 0.1:    8.2   -> 8.1

        That is not conservative rounding, it is corruption of quantities that were ALREADY exact
        multiples of the step. The consequences compound:
          * the position is not the size the risk gate just sized, so realized risk-per-trade is not
            the modelled risk-per-trade;
          * on the EXIT path a close of 0.3 that sends 0.2 leaves a residual position behind;
          * step 0.1 is common on altcoin perpetuals, so this is routine, not exotic.

        Deliberately does NOT enforce `minOrderQty`: this method is on the emergency unwind and
        close paths, and a size guard there could refuse to flatten a position that has become
        smaller than the entry minimum — turning a protective action into a stuck position. The
        minimum is enforced on ENTRY only, by `check_entry_size` below.
        """
        step = _dec(self.step_size.get(symbol, 0.0))
        if step <= 0:
            raise RuntimeError(f"step size unknown for {symbol} — refusing to trade")
        try:
            q = _dec(qty)
        except (InvalidOperation, ValueError) as e:
            raise RuntimeError(f"unparseable qty {qty!r} for {symbol}") from e
        if not q.is_finite() or q <= 0:
            raise RuntimeError(f"qty {qty!r} is not a positive finite number for {symbol}")
        v = (q / step).to_integral_value(rounding=ROUND_FLOOR) * step
        if v <= 0:
            raise RuntimeError(f"qty {qty} rounds to 0 at step {step} for {symbol}")
        return _fmt_qty(v)

    def check_entry_size(self, symbol: str, qty, price: float | None = None) -> tuple[bool, str]:
        """Entry-time eligibility: the rounded quantity must satisfy the instrument minimum.

        Submitting below `minOrderQty` is rejected by Bybit, so catching it here turns a guaranteed
        exchange error into a clean, metric-visible skip. Returns (ok, reason).

        The comparison is Decimal so it cannot reintroduce the float error fixed in `_round_qty`.
        """
        try:
            qty_s = self._round_qty(symbol, qty)
        except RuntimeError as e:
            return False, str(e)
        mn = _dec(self.min_size.get(symbol, 0.0))
        if mn > 0 and _dec(qty_s) < mn:
            return False, f"qty_{qty_s}_below_min_{_fmt_qty(mn)}"
        # NOTIONAL minimum, checked only when a price is supplied (the exit/unwind path does not pass
        # one, and must never be blocked by an entry-eligibility rule).
        if price is not None and price > 0:
            min_notional = _dec(self.min_notional.get(symbol, 0.0))
            if min_notional > 0 and _dec(qty_s) * _dec(price) < min_notional:
                return False, (f"notional_{float(_dec(qty_s) * _dec(price)):.2f}"
                               f"_below_min_{float(min_notional):.2f}")
        return True, "ok"

    async def open_protected(
        self,
        symbol: str,
        side: str,
        # `float | str`. PRODUCTION passes the exact decimal STRING from `_round_qty` — the call
        # site is explicit that the decimal string goes on the wire rather than a float round-trip
        # of it — while the tests pass floats. Both are real callers, so the honest type is the
        # union; `float` alone made the documented, intended call a type error.
        qty: float | str,
        tp_price: float,
        sl_price: float,
        position_idx: int = 0,
        *,
        quote_fn: Callable[[], Awaitable[QuoteSnapshot | None]] | None = None,
        tick_size: float | None = None,
        gross_edge_bps: float | None = None,
        peak_spread_bps: float | None = None,
        funding_bps: float = 0.0,
        impact_bps: float = 0.0,
        obi: float = 0.0,
        tp_bps: float | None = None,
        sl_bps: float | None = None,
        toxicity: ToxicityPolicy | None = None,
    ) -> dict:
        """Enter with protection, routing the entry through the maker/taker decision.

        ROUTING IS OPT-IN VIA `quote_fn`. Without a top-of-book we cannot compute a micro-price, so
        the method falls back to the pre-existing market path with NO behaviour change. That is
        deliberate: a routing layer that cannot source a price must not be able to strand an entry,
        and it also means this change is inert until the caller supplies a book.

        When a book IS supplied, the sequence is:
          1. rest post-only at the micro-price;
          2. re-quote if the quote ages past the budget or the touch drifts more than a tick;
          3. if it never fills, cross ONLY if the 12 bps taker gate clears;
          4. otherwise ENTER NOTHING and return a skip.

        Step 4 is the economic point of the whole exercise. Declining a trade costs nothing;
        crossing a spread on an edge that cannot pay for it is a certain loss. Every failure path
        here therefore ends in "no position", never in "market anyway".
        """
        qty_s = self._round_qty(symbol, qty)
        link = f"gp-{uuid.uuid4().hex[:26]}"

        routing_on = (
            bool(getattr(self.cfg, "maker_entry_enabled", False))
            and quote_fn is not None
            and tick_size is not None
            and float(tick_size) > 0
        )
        # The explicit re-check of the two Optional params is what lets mypy narrow them for the rest
        # of the block; without it every use of `quote_fn`/`tick_size` below is an Optional error.
        if routing_on and quote_fn is not None and tick_size is not None:
            plan = await self._plan_entry(
                quote_fn=quote_fn, side=side, tick_size=float(tick_size),
                gross_edge_bps=gross_edge_bps, peak_spread_bps=peak_spread_bps,
                funding_bps=funding_bps, impact_bps=impact_bps, obi=obi,
                toxicity=toxicity,
            )
            if plan.mode == "maker":
                io = _MakerIO(
                    self, symbol, position_idx, quote_fn=quote_fn,
                    protection_fn=lambda px: self._protection_kwargs(
                        side, px, tp_bps=tp_bps, sl_bps=sl_bps, tick_size=tick_size),
                )
                outcome = await run_maker_entry(
                    io, side=side, qty=qty_s, tick=float(tick_size), link_prefix=link,
                    now_ms=now_ms, sleep=asyncio.sleep,
                    max_age_ms=int(getattr(self.cfg, "maker_max_quote_age_ms", 2500)),
                    max_requotes=int(getattr(self.cfg, "maker_max_requotes", 2)),
                )
                if outcome.filled:
                    # Protect exactly what FILLED. A partial fill is a real position and the
                    # remainder is abandoned rather than chased.
                    qty_s = self._round_qty(symbol, outcome.filled_qty)
                    # RE-DERIVE the protection from the price we actually got.
                    #
                    # The caller computes TP/SL from a pre-trade estimate (the mid). A maker fill
                    # happens at the touch, which for a buy is BETTER — lower — than that estimate.
                    # Keeping the caller's levels would place the stop at or even above the fill, so
                    # a long would be stopped out on the tick it opened. Concretely, a mid-based SL
                    # of 99.9 against a bid fill of 99.9 is a zero-distance stop.
                    tp_price, sl_price = self._protection_from_fill(
                        symbol=symbol, side=side, fill_px=outcome.avg_price,
                        tp_price=tp_price, sl_price=sl_price,
                        tp_bps=tp_bps, sl_bps=sl_bps,
                        tick_size=float(tick_size),
                    )
                    if self._metrics:
                        self._metrics.inc("gigpilot_entry_routing_total", mode="maker_filled")
                    # Record the CHILD link the venue saw, not the parent — see MakerOutcome.filled_link.
                    return await self._protect_entry(
                        symbol, side, qty_s, tp_price, sl_price, position_idx,
                        outcome.filled_link or link,
                        route="maker", extra={"maker_requotes": outcome.requotes,
                                              "maker_reason": outcome.reason,
                                              "fill_px": outcome.avg_price})
                # BEFORE concluding "no fill", verify against the ACTUAL position.
                # A maker order that never filled and one that filled but whose state we could not
                # read look identical from the loop's perspective. Concluding "no fill" on the second
                # would leave a real position with no stop, so the position — not the order
                # bookkeeping — is the authority.
                exposure = await self._open_position_qty(symbol)
                if exposure is None:
                    # Cannot verify. Refuse to guess: raising routes this into the engine's
                    # fail-closed error path rather than trading on an unknown.
                    raise RuntimeError("POSITION_STATE_UNVERIFIED_AFTER_MAKER")
                if exposure > 0:
                    log.warning(
                        "maker reported no fill for %s but position size is %s — protecting it",
                        symbol, exposure,
                    )
                    return await self._protect_entry(
                        symbol, side, self._round_qty(symbol, exposure), tp_price, sl_price,
                        position_idx, outcome.filled_link or link, route="maker_verified",
                        extra={"maker_reason": outcome.reason, "recovered_position": exposure})
                if plan.taker is not None and plan.taker.allowed:
                    if self._metrics:
                        self._metrics.inc("gigpilot_entry_routing_total", mode="taker_cross")
                    cross_quote = await quote_fn()
                    await self._submit_taker_cross(
                        symbol, side, qty_s, position_idx, link, quote=cross_quote,
                        protection=self._cross_protection(side, cross_quote, tp_bps, sl_bps, tick_size))
                    return await self._protect_entry(
                        symbol, side, qty_s, tp_price, sl_price, position_idx, link,
                        route="taker", extra={"taker_net_bps": round(plan.taker.net_bps, 4),
                                              "maker_reason": outcome.reason})
                return self._skip_entry(symbol, side, plan, reason=outcome.reason)
            if quote_fn is not None and plan.mode == "taker":
                if self._metrics:
                    self._metrics.inc("gigpilot_entry_routing_total", mode="taker_cross")
                cross_quote2 = await quote_fn()
                await self._submit_taker_cross(
                    symbol, side, qty_s, position_idx, link, quote=cross_quote2,
                    protection=self._cross_protection(side, cross_quote2, tp_bps, sl_bps, tick_size))
                return await self._protect_entry(
                    symbol, side, qty_s, tp_price, sl_price, position_idx, link,
                        route="taker",
                        extra={"taker_net_bps": round(plan.taker.net_bps, 4)
                               if plan.taker else 0.0})
            return self._skip_entry(symbol, side, plan, reason=plan.reason)

        # ---- legacy path: no book supplied, so levels come from the caller's pre-trade estimate ----
        await self._submit_order(symbol, side, qty_s, position_idx, link,
                                 protection=self._protection_from_levels(tp_price, sl_price))
        return await self._protect_entry(
            symbol, side, qty_s, tp_price, sl_price, position_idx, link, route="market")

    async def _open_position_qty(self, symbol: str) -> float | None:
        """Absolute position size for `symbol`, or None when it cannot be determined.

        None is deliberately distinct from 0.0: 0.0 asserts "flat" and is a safe basis for abandoning
        an entry, whereas None admits "unknown" and must not be treated as flat.
        """
        try:
            adapter = self.adapter_or_none
            if adapter is not None:
                total = 0.0
                for p in await adapter.positions():
                    if getattr(p, "symbol", None) == symbol:
                        total += abs(float(getattr(p, "size", 0.0) or 0.0))
                return total
            raw = await self.rest.positions()
            total = 0.0
            for p in raw or []:
                if isinstance(p, dict) and p.get("symbol") == symbol:
                    total += abs(_num(p.get("size")))
            return total
        except Exception as exc:
            log.warning("position read failed for %s: %s", symbol, exc)
            return None

    @property
    def adapter_or_none(self) -> ExchangeAdapter | None:
        """Typed accessor for the optional adapter.

        WHY THIS EXISTS: `if getattr(self, "adapter", None) is not None:` does NOT narrow the
        ATTRIBUTE, so every `self.adapter.x` after that guard is still `Optional[ExchangeAdapter]` to
        the type checker and therefore an error. Assigning this to a local and testing THAT is what
        lets narrowing work, and it keeps the adapter access readable at each call site.
        """
        return getattr(self, "adapter", None)

    @staticmethod
    def _round_nearest_tick(px: float, tick: float) -> float:
        t = _dec(tick)
        if t <= 0 or not math.isfinite(px):
            return px
        return float((_dec(px) / t).to_integral_value() * t)

    def _protection_kwargs(self, side: str, ref_px: float, *,
                           tp_bps: float | None, sl_bps: float | None,
                           tick_size: float | None) -> dict:
        """TP/SL to ATTACH to the entry order, anchored to the price it will fill at.

        Why attach rather than follow up: the previous sequence placed the entry and then made a second
        call to register TP/SL. A crash in between left a naked leveraged position that nothing local
        could close — and in runtime-secret mode the credential is gone too, so there is no local
        rescue at all. Attaching moves the bound to the VENUE, which is the only party still running.

        The anchor is the price the order actually rests at, NOT the mid. For a maker entry that rest
        price IS the fill price, so the levels land correctly; anchoring to the mid is what produced
        the zero-distance stop the post-fill path exists to repair.
        """
        if tp_bps is None or sl_bps is None or tick_size is None:
            return {}
        try:
            px, tk = float(ref_px), float(tick_size)
        except (TypeError, ValueError):
            return {}
        if not (px > 0 and tk > 0 and math.isfinite(px)):
            return {}
        buy = str(side).strip().lower() in {"buy", "long"}
        if buy:
            tp, sl = px * (1.0 + float(tp_bps) / 1e4), px * (1.0 - float(sl_bps) / 1e4)
        else:
            tp, sl = px * (1.0 - float(tp_bps) / 1e4), px * (1.0 + float(sl_bps) / 1e4)
        tp, sl = self._round_nearest_tick(tp, tk), self._round_nearest_tick(sl, tk)
        # Same geometry guard as the post-fill path: a stop at or inside the entry is an instant
        # stop-out, and anchoring to a resting price makes that reachable.
        if buy:
            if sl >= px:
                sl = self._round_nearest_tick(px - tk, tk)
            if tp <= px:
                tp = self._round_nearest_tick(px + tk, tk)
        else:
            if sl <= px:
                sl = self._round_nearest_tick(px + tk, tk)
            if tp >= px:
                tp = self._round_nearest_tick(px - tk, tk)
        return {"takeProfit": f"{tp}", "stopLoss": f"{sl}", "tpTriggerBy": "MarkPrice",
                "slTriggerBy": "MarkPrice", "tpslMode": "Full"}

    @staticmethod
    def _protection_from_levels(tp_price: float, sl_price: float) -> dict:
        """Attach the caller's ABSOLUTE levels (market entry, where the fill is only estimated).

        The post-fill re-anchor still corrects these to the realised price, so a worse-than-expected
        fill is repaired rather than inherited. Attaching them means the tail is bounded from the
        moment the fill happens instead of one round trip later.
        """
        if not (tp_price > 0 and sl_price > 0):
            return {}
        return {"takeProfit": f"{tp_price}", "stopLoss": f"{sl_price}",
                "tpTriggerBy": "MarkPrice", "slTriggerBy": "MarkPrice", "tpslMode": "Full"}

    async def _place_entry(self, link: str, body: dict, protection: dict) -> None:
        """Submit an entry with attached protection, degrading to a bare order if the venue refuses.

        The fallback is deliberately NARROW — it fires only when the rejection names the protection
        fields. A blanket retry would mask unrelated failures and could resubmit an order that was
        rejected for a real reason. With it, attaching protection can only ever ADD a bound: if the
        venue will not accept them, behaviour is exactly what it is today.
        """
        if not protection:
            await self._place_idempotent(link, **body)
            return
        try:
            await self._place_idempotent(link, **body, **protection)
        except Exception as exc:
            blob = f"{exc}".lower()
            if not any(k in blob for k in ("takeprofit", "stoploss", "tpsl", "tp_", "sl_")):
                raise
            log.warning(
                "entry protection rejected by the venue (%s) — resubmitting WITHOUT attached TP/SL; "
                "post-fill protection still applies and remains authoritative", exc)
            await self._place_idempotent(link, **body)

    def _protection_from_fill(
        self,
        *,
        symbol: str,
        side: str,
        fill_px: float,
        tp_price: float,
        sl_price: float,
        tp_bps: float | None,
        sl_bps: float | None,
        tick_size: float,
    ) -> tuple[float, float]:
        """Re-derive TP/SL from the realised fill, then verify they sit on the correct side.

        TWO JOBS, the second of which is the important one.

        1. SCALE from the actual entry. The caller sizes TP/SL from a pre-trade estimate (the mid),
           and a maker fill happens at the touch. For a buy the touch is BETTER — lower — than the
           mid, so keeping the caller's absolute levels makes the stop start closer than intended, or
           worse, at the entry itself.

        2. ENFORCE the geometry. A stop at or inside the entry price is an instant stop-out, and the
           maker path makes that reachable for the first time because it fills at the touch. This was
           a REAL defect observed in the lifecycle test: a mid-based SL of 99.9 against a bid fill of
           99.9 is a zero-distance stop, so the position would have been closed on the tick it opened.
           The guard makes the failure impossible rather than merely unlikely.
        """
        buy = str(side).strip().lower() in {"buy", "long"}
        px = float(fill_px)
        if px > 0 and tp_bps is not None and sl_bps is not None:
            if buy:
                tp_price = px * (1.0 + float(tp_bps) / 1e4)
                sl_price = px * (1.0 - float(sl_bps) / 1e4)
            else:
                tp_price = px * (1.0 - float(tp_bps) / 1e4)
                sl_price = px * (1.0 + float(sl_bps) / 1e4)
        if not (px > 0):
            return tp_price, sl_price
        tp_price = self._round_nearest_tick(tp_price, tick_size)
        sl_price = self._round_nearest_tick(sl_price, tick_size)
        t = float(tick_size)
        if buy:
            if sl_price >= px:
                sl_price = self._round_nearest_tick(px - t, tick_size)
            if tp_price <= px:
                tp_price = self._round_nearest_tick(px + t, tick_size)
        else:
            if sl_price <= px:
                sl_price = self._round_nearest_tick(px + t, tick_size)
            if tp_price >= px:
                tp_price = self._round_nearest_tick(px - t, tick_size)
        if not (math.isfinite(tp_price) and math.isfinite(sl_price)) or sl_price <= 0:
            raise RuntimeError(f"non-positive protection derived for {symbol}: tp={tp_price} sl={sl_price}")
        return tp_price, sl_price

    async def _plan_entry(
        self,
        *,
        quote_fn: Callable[[], Awaitable[QuoteSnapshot | None]],
        side: str,
        tick_size: float,
        gross_edge_bps: float | None,
        peak_spread_bps: float | None,
        funding_bps: float = 0.0,
        impact_bps: float = 0.0,
        obi: float = 0.0,
        toxicity: ToxicityPolicy | None = None,
    ) -> EntryPlan:
        """Read the book and ask the routing policy what to do.

        `peak_spread_bps` defaults to the CURRENT spread when the caller supplies none — a live
        spread is a real measurement, whereas 0.0 would make crossing look free. It is a weaker
        input than a measured peak, which is why the caller is expected to pass one.
        """
        quote = await quote_fn()
        peak = peak_spread_bps
        if peak is None:
            peak = quote.spread_bps if (quote is not None and quote.is_usable()) else float("inf")
        return plan_entry(
            quote=quote, side=side, tick=tick_size,
            gross_edge_bps=float(gross_edge_bps or 0.0),
            peak_spread_bps=float(peak),
            funding_bps=funding_bps, impact_bps=impact_bps, obi=obi,
            taker_hurdle_bps=float(getattr(self.cfg, "taker_min_net_edge_bps", 12.0)),
            toxicity=toxicity,
        )

    async def _submit_order(self, symbol: str, side: str, qty_s: str, position_idx: int,
                            link: str, *, price: str | None = None,
                            tif: TimeInForce = TimeInForce.GTC,
                            protection: dict | None = None) -> None:
        """The single submission point for entries. Never bypasses `_place_idempotent`.

        `protection` rides on the entry order so the venue arms TP/SL at the instant of the fill.
        """
        protection = protection or {}
        adapter = self.adapter_or_none
        if adapter is not None:
            await adapter.place_order(OrderRequest(
                exchange=adapter.name,
                symbol=symbol,
                side=Side.BUY if side == "Buy" else Side.SELL,
                qty=qty_s,
                order_type=OrderType.MARKET if price is None else OrderType.LIMIT,
                price=price,
                time_in_force=tif,
                client_order_id=link,
                position_idx=position_idx,
                take_profit=protection.get("takeProfit"),
                stop_loss=protection.get("stopLoss"),
            ))
            return
        body = {
            "category": "linear",
            "symbol": symbol,
            "side": side,
            "qty": qty_s,
            "positionIdx": position_idx,
        }
        if price is None:
            body["orderType"] = "Market"
        else:
            body["orderType"] = "Limit"
            body["price"] = price
            body["timeInForce"] = tif.value
        await self._place_entry(link, body, protection)

    def _cross_protection(self, side: str, quote: QuoteSnapshot | None,
                          tp_bps: float | None, sl_bps: float | None,
                          tick_size: float | None) -> dict:
        """Protection anchored to the TOUCH we are about to cross into.

        The crossing price is the touch, so that is the best pre-trade estimate of the fill and the
        correct anchor. Reading the book first is also what keeps the anchor honest: without a usable
        book there is no estimate, and the caller's absolute levels are used instead.
        """
        if quote is not None and quote.is_usable():
            buy = str(side).strip().lower() in {"buy", "long"}
            return self._protection_kwargs(side, quote.ask_px if buy else quote.bid_px,
                                           tp_bps=tp_bps, sl_bps=sl_bps,
                                           tick_size=tick_size)
        return {}

    async def _submit_taker_cross(self, symbol: str, side: str, qty_s: str, position_idx: int,
                                  link: str, *, quote: QuoteSnapshot | None,
                                  protection: dict | None = None) -> None:
        """Cross the spread with an aggressive IOC limit.

        IOC rather than MARKET so the fill is price-capped: a market order into a thin book can
        execute arbitrarily far through it, which would obliterate the very edge the gate just
        approved. If the touch is unknown we fall back to MARKET — the gate has already established
        the edge is large enough to pay for crossing.
        """
        price_s: str | None = None
        if quote is not None and quote.is_usable():
            tif = TimeInForce.IOC
            px = quote.ask_px if side == "Buy" else quote.bid_px
            price_s = f"{px}"
        else:
            tif = TimeInForce.GTC
        await self._submit_order(symbol, side, qty_s, position_idx, link, price=price_s, tif=tif,
                                 protection=protection)

    def _skip_entry(self, symbol: str, side: str, plan: EntryPlan, *, reason: str) -> dict:
        """Decline the entry. No order is sent and no position is opened.

        A skip is a SUCCESS outcome, and it is metric-visible so a strategy that never trades
        because its edge cannot pay the spread is distinguishable from a broken engine.
        """
        detail = f"{plan.reason}; maker={reason}"
        log.info("entry skipped %s %s: %s", symbol, side, detail)
        if self._metrics:
            self._metrics.inc("gigpilot_entry_skips_total", reason="routing_gate", symbol=symbol)
        return {"skipped": True, "reason": detail, "qty": "0", "tp": None, "sl": None}

    async def _protect_entry(self, symbol: str, side: str, qty_s: str, tp_price: float,
                             sl_price: float, position_idx: int, link: str, *,
                             route: str, extra: dict | None = None) -> dict:
        """Register native TP/SL, and flatten if that fails.

        Unchanged semantics from the original path: a position that cannot be protected must not
        exist, so a protection failure unwinds and raises rather than leaving naked exposure.
        """
        try:
            adapter = self.adapter_or_none
            if adapter is not None:
                await adapter.set_protection(
                    symbol,
                    Side.BUY if side == "Buy" else Side.SELL,
                    qty_s,
                    str(tp_price),
                    str(sl_price),
                )
            else:
                # `self.rest` is declared as the union, and `adapter_or_none` is a PROPERTY, so mypy
                # cannot carry the narrowing across it. The invariant is real — this is the else of
                # "an adapter exists", so the client IS the REST client — and it is stated with a
                # `cast` rather than an isinstance guard. An isinstance here would ALSO reject the
                # duck-typed clients the idempotency tests use, turning a type complaint into a
                # broken test; a cast is runtime-free and keeps the duck-typing.
                rest = cast(BybitREST, self.rest)
                await rest.trading_stop(
                    category="linear",
                    symbol=symbol,
                    tpslMode="Full",
                    positionIdx=position_idx,
                    takeProfit=str(tp_price),
                    stopLoss=str(sl_price),
                    tpTriggerBy="MarkPrice",
                    slTriggerBy="MarkPrice",
                )
        except Exception as e:
            log.error("protection failed %s — unwinding: %s", symbol, e)
            await self._unwind(symbol, side, qty_s, position_idx)
            raise RuntimeError("PROTECTION_FAILED_POSITION_FLATTENED")
        if self._metrics:
            self._metrics.inc("gigpilot_trades_total", side=side, result="opened")
            self._metrics.inc("gigpilot_entry_route_total", route=route)
        out = {"orderLinkId": link, "qty": qty_s, "tp": tp_price, "sl": sl_price, "route": route}
        if extra:
            out.update(extra)
        return out

    async def _place_idempotent(self, link: str, **kw):
        """Submit an order, treating a DUPLICATE client order id as SUCCESS.

        Bybit dedupes on orderLinkId, so a retry after a lost response is answered with
        DUPLICATE_ORDER_LINK_CODE even though the first attempt created the order. Every order path
        in this class therefore submits through here, so the rule is applied once instead of being
        re-derived per call site.

        Returns the exchange result for a fresh submit, or None when the order already existed.
        Every other error is re-raised, so a genuine failure is never hidden.
        """
        # Reachable ONLY from the non-adapter branches: both `_submit_order` and `place_post_only`
        # return early when an adapter is present. `orderLinkId` exists on the REST client and not on
        # `ExchangeAdapter`, which is exactly why mypy flags the union. Casting documents the contract
        # without a runtime isinstance that would reject duck-typed clients.
        rest = cast(BybitREST, self.rest)
        try:
            return await rest.place_order(orderLinkId=link, **kw)
        except BybitError as e:
            if e.code == DUPLICATE_ORDER_LINK_CODE:
                log.warning(
                    "place_order %s: duplicate orderLinkId -> already accepted by Bybit; "
                    "treating as submitted (not a failure)",
                    link,
                )
                return None
            raise

    async def _unwind(self, symbol: str, side: str, qty_s: str, position_idx: int) -> None:
        opp = "Sell" if side == "Buy" else "Buy"
        try:
            link = f"gp-unwind-{uuid.uuid4().hex[:20]}"
            adapter = self.adapter_or_none
            if adapter is not None:
                await adapter.place_order(OrderRequest(
                    exchange=adapter.name,
                    symbol=symbol,
                    side=Side.BUY if opp == "Buy" else Side.SELL,
                    qty=qty_s,
                    order_type=OrderType.MARKET,
                    reduce_only=True,
                    client_order_id=link,
                    position_idx=position_idx,
                ))
            else:
                await self._place_idempotent(
                    link,
                    category="linear",
                    symbol=symbol,
                    side=opp,
                    orderType="Market",
                    qty=qty_s,
                    reduceOnly=True,
                    positionIdx=position_idx,
                )
        except Exception as e:
            log.critical("UNWIND FAILED %s: %s", symbol, e)

    async def close_market(self, symbol: str, side: str, qty_s: str, position_idx: int = 0):
        opp = "Sell" if side == "Buy" else "Buy"
        link = f"gp-close-{uuid.uuid4().hex[:20]}"
        adapter = self.adapter_or_none
        if adapter is not None:
            return await adapter.place_order(OrderRequest(
                exchange=adapter.name,
                symbol=symbol,
                side=Side.BUY if opp == "Buy" else Side.SELL,
                qty=qty_s,
                order_type=OrderType.MARKET,
                reduce_only=True,
                client_order_id=link,
                position_idx=position_idx,
            ))
        return await self._place_idempotent(
            link,
            category="linear",
            symbol=symbol,
            side=opp,
            orderType="Market",
            qty=qty_s,
            reduceOnly=True,
            positionIdx=position_idx,
        )


class _MakerIO:
    """Exchange surface for the maker lifecycle, bound to one symbol and position index.

    WHY `state()` READS ORDER HISTORY
    ---------------------------------
    An order that has left the realtime book has either **FILLED** or been **CANCELLED**, and those
    demand opposite responses. Reading only `/v5/order/realtime` cannot tell them apart, so a filled
    order would look exactly like an empty one and its position would be left unprotected — the most
    dangerous possible failure of a maker-first strategy. `state()` therefore falls back to
    `/v5/order/history` to resolve the terminal status before reporting anything.

    If the history lookup ALSO fails, `state()` returns status "unknown" with zero filled. It does
    not guess. The caller is required to verify flatness against the actual position before
    concluding "no fill", which is what makes an unresolvable read safe rather than silent.
    """

    def __init__(self, ex: Executor, symbol: str, position_idx: int, *, quote_fn,
                 protection_fn=None) -> None:
        self.ex = ex
        self.symbol = symbol
        self.position_idx = position_idx
        self.quote_fn = quote_fn
        # Maps the price this quote will rest at -> the TP/SL to attach. A callback rather than fixed
        # levels because the rest price is chosen inside the quoting loop, and for a maker fill that
        # rest price IS the fill price — so it is the only correct anchor available pre-trade.
        self.protection_fn = protection_fn

    async def book(self) -> QuoteSnapshot | None:
        try:
            return await self.quote_fn()
        except Exception as exc:
            log.info("book read failed for %s: %s", self.symbol, exc)
            return None

    async def place_post_only(self, price: Decimal, link: str, side: str, qty: str) -> str:
        buy = str(side).strip().lower() in {"buy", "long", "bid"}
        prot = self.protection_fn(float(price)) if self.protection_fn else {}
        ex_adapter = self.ex.adapter_or_none
        if ex_adapter is not None:
            res = await ex_adapter.place_order(OrderRequest(
                exchange=ex_adapter.name,
                symbol=self.symbol,
                side=Side.BUY if buy else Side.SELL,
                qty=qty,
                order_type=OrderType.LIMIT,
                price=str(price),
                time_in_force=TimeInForce.POST_ONLY,
                client_order_id=link,
                position_idx=self.position_idx,
                take_profit=prot.get("takeProfit"),
                stop_loss=prot.get("stopLoss"),
            ))
            return res.order_id or ""
        r = await self.ex._place_idempotent(
            link,
            category="linear",
            symbol=self.symbol,
            side="Buy" if buy else "Sell",
            orderType="Limit",
            qty=qty,
            price=str(price),
            timeInForce=TimeInForce.POST_ONLY.value,
            positionIdx=self.position_idx,
            # A post-only entry can carry native TP/SL: Bybit supports `timeInForce=PostOnly` alongside
            # `takeProfit`/`stopLoss` on /v5/order/create, so resting passively and being protected from
            # the instant of the fill are not in tension.
            **prot,
        )
        return (r or {}).get("orderId", "")

    async def cancel(self, order_id: str, link: str) -> None:
        ex_adapter = self.ex.adapter_or_none
        if ex_adapter is not None:
            if order_id:
                await ex_adapter.cancel_order(self.symbol, order_id)
            return
        body: dict = {"category": "linear", "symbol": self.symbol}
        if order_id:
            body["orderId"] = order_id
        else:
            body["orderLinkId"] = link
        await self.ex.rest.cancel_order(**body)

    async def state(self, link: str) -> FillState:
        raw = None
        ex_adapter = self.ex.adapter_or_none
        try:
            orders = (
                await ex_adapter.open_orders()
                if ex_adapter is not None
                else await self.ex.rest.open_orders()
            )
            raw = _match_link(orders, link)
            if raw is None:
                # `order_history` exists on BybitREST but NOT on the adapter ABC, so it is resolved
                # dynamically rather than assumed. If an adapter lacks it, the terminal status stays
                # "unknown" and the caller's position check catches it — better a slower safe path
                # than an import-time type error.
                hist_fn = getattr(self.ex.rest, "order_history", None)
                hist = await hist_fn(self.symbol, order_link_id=link) if hist_fn else []
                raw = _match_link(hist, link)
        except Exception as exc:
            log.warning("order state unreadable for %s: %s", link, exc)
            return FillState(0.0, 0.0, "unknown")
        if raw is None:
            return FillState(0.0, 0.0, "not_found")
        return FillState(
            filled_qty=_num(raw.get("cumExecQty")),
            avg_price=_num(raw.get("avgPrice")),
            status=_TERMINAL.get(str(raw.get("orderStatus") or "").strip().lower(), "unknown"),
        )


def _match_link(rows, link: str):
    """Find our order in a list of raw dicts OR adapter `Order` objects."""
    for o in rows or []:
        d = o if isinstance(o, dict) else getattr(o, "raw", None)
        if d is None:
            continue
        if (d.get("orderLinkId") or getattr(o, "client_order_id", None)) == link:
            return d
    return None


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# Bybit order lifecycle -> our three meaningful states. "New"/"PartiallyFilled" stay OPEN: a partial
# fill is not terminal, and treating it as terminal would abandon the unfilled remainder while the
# order is still live on the book.
_TERMINAL = {
    "new": "open",
    "created": "open",
    "untriggered": "open",
    "partiallyfilled": "open",
    "filled": "filled",
    "cancelled": "cancelled",
    "partiallyfilledcanceled": "cancelled",
    "deactivated": "cancelled",
    "rejected": "rejected",
}
