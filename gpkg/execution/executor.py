"""Execution engine for Bybit Linear perpetuals (One-Way mode).

Safety invariants:
  - Refuses unknown or missing instrument step sizes.
  - Bounded quantity precision rounded down to contract lot step.
  - Guaranteed execution idempotency on orderLinkId: duplicate returns 110072 (treated as already accepted).
  - Position protection enforcement: immediately flattens and unwinds position if TP/SL registration fails.
"""
from __future__ import annotations

import logging
import math
import uuid
from decimal import ROUND_FLOOR, Decimal, InvalidOperation

from gpkg.core.config import Config
from gpkg.core.errors import BybitError, DUPLICATE_ORDER_LINK_CODE
from gpkg.core.metrics import Metrics
from gpkg.exchange.bybit_rest import BybitREST

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
        rest: BybitREST,
        step_sizes: dict[str, float],
        metrics: Metrics | None = None,
        min_sizes: dict[str, float] | None = None,
    ):
        self.cfg = cfg
        self.rest = rest
        self.step_size = step_sizes
        self.min_size = min_sizes or {}
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

    def check_entry_size(self, symbol: str, qty) -> tuple[bool, str]:
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
        return True, "ok"

    async def open_protected(
        self,
        symbol: str,
        side: str,
        qty: float,
        tp_price: float,
        sl_price: float,
        position_idx: int = 0,
    ) -> dict:
        qty_s = self._round_qty(symbol, qty)
        link = f"gp-{uuid.uuid4().hex[:26]}"
        await self._place_idempotent(
            link,
            category="linear",
            symbol=symbol,
            side=side,
            orderType="Market",
            qty=qty_s,
            positionIdx=position_idx,
        )
        try:
            await self.rest.trading_stop(
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
        return {"orderLinkId": link, "qty": qty_s, "tp": tp_price, "sl": sl_price}

    async def _place_idempotent(self, link: str, **kw):
        """Submit an order, treating a DUPLICATE client order id as SUCCESS.

        Bybit dedupes on orderLinkId, so a retry after a lost response is answered with
        DUPLICATE_ORDER_LINK_CODE even though the first attempt created the order. Every order path
        in this class therefore submits through here, so the rule is applied once instead of being
        re-derived per call site.

        Returns the exchange result for a fresh submit, or None when the order already existed.
        Every other error is re-raised, so a genuine failure is never hidden.
        """
        try:
            return await self.rest.place_order(orderLinkId=link, **kw)
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
            await self._place_idempotent(
                f"gp-unwind-{uuid.uuid4().hex[:20]}",
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
        return await self._place_idempotent(
            f"gp-close-{uuid.uuid4().hex[:20]}",
            category="linear",
            symbol=symbol,
            side=opp,
            orderType="Market",
            qty=qty_s,
            reduceOnly=True,
            positionIdx=position_idx,
        )
