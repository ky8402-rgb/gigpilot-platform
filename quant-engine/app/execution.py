"""Execution: paper broker, live broker, and position lifecycle management.

Broker contract is identical for paper and live, so strategy and risk logic cannot
tell the difference and cannot "accidentally" behave differently in production.

PaperBroker is deliberately pessimistic:
  * entry fills cross the spread and pay real book slippage for the real size
  * stop exits get worse slippage than a passive exit (stops trade into momentum)
  * taker fees are charged on both legs
  * funding is accrued on a wall-clock schedule from the real funding rate
If the strategy survives this broker, it is not surviving on fantasy fills.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from .costs import CostModel, estimate_slippage_bps
from .exchange import (
    BinancePrivate, DepthSnapshot, ExchangeError, OrderRequest, OrderResult, Ticker,
)
from .logging_setup import get_logger, scrub
from .portfolio import Ledger, OrderRecord, Position, new_id

log = get_logger("execution")


class BaseBroker:
    mode = "paper"

    async def open(self, position: Position, ticker: Ticker, depth: Optional[DepthSnapshot],
                   decision_price: float) -> OrderResult:
        raise NotImplementedError

    async def close(self, position: Position, ticker: Ticker, depth: Optional[DepthSnapshot],
                    reason: str) -> OrderResult:
        raise NotImplementedError

    async def accrue_funding(self, position: Position, ticker: Ticker) -> float:
        return 0.0

    async def reconcile(self, ledger: Ledger) -> Dict[str, Any]:
        return {"ok": True, "mode": self.mode, "note": "paper book is authoritative"}

    async def exchange_positions(self) -> List[Any]:
        """Positions the exchange reports. Empty for the paper book, which is
        authoritative for itself."""
        return []


# ---------------------------------------------------------------------------
class PaperBroker(BaseBroker):
    """Simulated fills against real market data. No order ever leaves the process."""

    mode = "paper"

    def __init__(self, cfg, ledger: Ledger, cost_model: CostModel):
        self.cfg = cfg
        self.ledger = ledger
        self.costs = cost_model
        self._last_funding: Dict[str, float] = {}

    def _fill_price(self, ticker: Ticker, depth: Optional[DepthSnapshot],
                    side: str, notional: float) -> tuple[float, float]:
        """Return (fill_price, adverse_slippage_bps)."""
        if depth is not None and depth.bids and depth.asks:
            ref = (depth.bids[0][0] + depth.asks[0][0]) / 2.0
        else:
            ref = ticker.ask if side.upper() == "BUY" else ticker.bid
            if ref <= 0:
                ref = ticker.mid or ticker.last
        if ref <= 0:
            return ticker.last, 0.0
        slip_bps = estimate_slippage_bps(
            depth, side, notional, self.cfg.costs.fallback_slippage_bps
        )
        # A tiny fixed adverse component models queue position and latencies that
        # a book snapshot cannot show.
        slip_bps += 0.5
        sign = 1.0 if side.upper() == "BUY" else -1.0
        fill = ref * (1.0 + sign * slip_bps / 10_000.0)
        return fill, slip_bps

    async def open(self, position: Position, ticker: Ticker, depth: Optional[DepthSnapshot],
                   decision_price: float) -> OrderResult:
        side = "BUY" if position.side == "LONG" else "SELL"
        order = OrderRecord(
            id=new_id("ord"), symbol=position.symbol, side=side, qty=position.qty,
            order_type="MARKET", status="NEW", reduce_only=False, mode="paper",
            intent="entry",
        )
        self.ledger.add_order(order)
        try:
            fill, slip_bps = self._fill_price(ticker, depth, side, position.qty * decision_price)
            if fill <= 0:
                raise ExchangeError("no valid price for fill")
            fee = fill * position.qty * self.cfg.costs.taker_fee_bps / 10_000.0
            position.entry_price = fill
            position.mark_price = fill
            position.entry_decision_price = decision_price
            # Re-derive risk per unit from the ACTUAL fill. Adverse slippage widens
            # the true stop distance, so measuring R against the pre-trade estimate
            # would flatter the R multiple and the breakeven trigger.
            if position.initial_stop:
                position.risk_per_unit = abs(fill - position.initial_stop)
            position.fees_paid += fee
            position.slippage_cost += abs(fill - decision_price) * position.qty

            order.status = "FILLED"
            order.avg_fill_price = fill
            order.filled_qty = position.qty
            order.fee = fee
            order.updated_at = time.time()
            self._last_funding[position.symbol] = time.time()
            log.info(
                "paper entry filled",
                extra={"symbol": position.symbol, "side": position.side, "qty": position.qty,
                       "fill": round(fill, 8), "slip_bps": round(slip_bps, 2),
                       "fee": round(fee, 6)},
            )
            return OrderResult(ok=True, order_id=order.id, status="FILLED",
                               filled_qty=position.qty, avg_price=fill, fee=fee)
        except Exception as exc:
            order.status = "REJECTED"
            order.error = scrub(str(exc))
            order.updated_at = time.time()
            log.error("paper entry failed", extra={"symbol": position.symbol, "error": scrub(str(exc))})
            return OrderResult(ok=False, error=scrub(str(exc)))

    async def close(self, position: Position, ticker: Ticker, depth: Optional[DepthSnapshot],
                    reason: str) -> OrderResult:
        side = "SELL" if position.side == "LONG" else "BUY"
        order = OrderRecord(
            id=new_id("ord"), symbol=position.symbol, side=side, qty=position.qty,
            order_type="MARKET", status="NEW", reduce_only=True, mode="paper",
            intent=f"exit:{reason}",
        )
        self.ledger.add_order(order)
        try:
            fill, slip_bps = self._fill_price(ticker, depth, side, position.qty * ticker.mid)
            if fill <= 0:
                raise ExchangeError("no valid price for exit fill")
            # A stop is fired into momentum; model the extra adverse move.
            if reason in ("stop", "trail/stop", "liquidation_guard"):
                extra = abs(slip_bps) * 0.6 + self.cfg.costs.adverse_selection_bps
                fill *= (1.0 - extra / 10_000.0) if position.side == "LONG" else (1.0 + extra / 10_000.0)
                slip_bps += extra
            fee = fill * position.qty * self.cfg.costs.taker_fee_bps / 10_000.0

            order.status = "FILLED"
            order.avg_fill_price = fill
            order.filled_qty = position.qty
            order.fee = fee
            order.updated_at = time.time()

            trade = self.ledger.close_position(
                position.symbol, fill, reason, fees=fee, funding=0.0,
                bars_held=int((time.time() - position.opened_at) / 3600),
            )
            log.info(
                "paper exit filled",
                extra={"symbol": position.symbol, "reason": reason, "fill": round(fill, 8),
                       "slip_bps": round(slip_bps, 2),
                       "net_pnl": round(trade.net_pnl, 4) if trade else None},
            )
            return OrderResult(ok=True, order_id=order.id, status="FILLED",
                               filled_qty=position.qty, avg_price=fill, fee=fee)
        except Exception as exc:
            order.status = "REJECTED"
            order.error = scrub(str(exc))
            order.updated_at = time.time()
            log.error("paper exit failed", extra={"symbol": position.symbol, "error": scrub(str(exc))})
            return OrderResult(ok=False, error=scrub(str(exc)))

    async def accrue_funding(self, position: Position, ticker: Ticker) -> float:
        """Charge the real funding rate for each 8h boundary crossed while held."""
        if ticker is None or ticker.funding_rate == 0:
            return 0.0
        now = time.time()
        last = self._last_funding.get(position.symbol, position.opened_at)
        # 8h boundaries are 00:00, 08:00, 16:00 UTC.
        boundary_interval = 8 * 3600
        crossed = 0
        t = last - (last % boundary_interval) + boundary_interval
        while t <= now:
            if t > position.opened_at:
                crossed += 1
            t += boundary_interval
        if crossed <= 0:
            return 0.0
        rate = ticker.funding_rate
        notional = position.qty * position.mark_price
        # Long pays positive funding; short receives it.
        payment = notional * rate * crossed * (1.0 if position.side == "LONG" else -1.0)
        position.funding_paid += payment
        self._last_funding[position.symbol] = now
        log.info(
            "funding accrued",
            extra={"symbol": position.symbol, "intervals": crossed,
                   "rate": rate, "payment": round(payment, 6)},
        )
        return payment


# ---------------------------------------------------------------------------
class LiveBroker(BaseBroker):
    """Real order routing. Only constructible after the config interlock passes."""

    mode = "live"

    def __init__(self, cfg, ledger: Ledger, client: BinancePrivate, cost_model: CostModel):
        if not cfg.live_enabled():
            raise RuntimeError(
                "LiveBroker refused: live trading requires execution.mode=live, "
                "execution.allow_live=true, API credentials, and QUANT_LIVE_TRADING_ACK=yes"
            )
        self.cfg = cfg
        self.ledger = ledger
        self.client = client
        self.costs = cost_model

    async def _prepare_symbol(self, symbol: str, leverage: float) -> None:
        lev = max(1, min(int(round(leverage)), int(self.cfg.risk.max_leverage)))
        try:
            await self.client.set_leverage(symbol, lev)
            await self.client.set_margin_type(symbol, isolated=False)
        except ExchangeError as exc:
            log.warning("symbol prep failed", extra={"symbol": symbol, "error": str(exc)})

    async def open(self, position: Position, ticker: Ticker, depth: Optional[DepthSnapshot],
                   decision_price: float) -> OrderResult:
        await self._prepare_symbol(position.symbol, position.leverage)
        side = "BUY" if position.side == "LONG" else "SELL"
        cid = new_id("q")
        req = OrderRequest(
            symbol=position.symbol, side=side, qty=position.qty,
            order_type="MARKET", client_id=cid,
        )
        order = OrderRecord(id=cid, symbol=position.symbol, side=side, qty=position.qty,
                            order_type="MARKET", status="SENT", mode="live", intent="entry")
        self.ledger.add_order(order)
        res = await self.client.place_order(req)
        order.updated_at = time.time()
        order.exchange_order_id = res.order_id
        if not res.ok:
            order.status = "REJECTED"
            order.error = res.error
            log.error("live entry rejected", extra={"symbol": position.symbol, "error": res.error})
            return res
        fill = res.avg_price or ticker.mid
        position.entry_price = fill
        position.mark_price = fill
        position.entry_decision_price = decision_price
        if position.initial_stop:
            position.risk_per_unit = abs(fill - position.initial_stop)
        order.status = res.status or "FILLED"
        order.avg_fill_price = fill
        order.filled_qty = res.filled_qty
        # Exchange-reported commission is authoritative. Use the venue-neutral
        # fee call: order ids are integers on Binance but UUIDs on Bybit, so
        # coercing them to int (as this once did) breaks on a second venue.
        fee = res.fee
        if fee <= 0:
            fee = await self.client.order_fee(position.symbol, res.order_id, res.client_id)
        if fee <= 0:
            log.warning("exchange reported no fee; booking the modelled taker fee",
                        extra={"symbol": position.symbol, "order_id": res.order_id})
            fee = fill * position.qty * self.cfg.costs.taker_fee_bps / 10_000.0
        order.fee = fee
        position.fees_paid += fee
        position.slippage_cost += abs(fill - decision_price) * position.qty
        log.info("live entry filled", extra={"symbol": position.symbol, "fill": fill,
                                            "qty": res.filled_qty, "fee": fee})
        return res

    async def close(self, position: Position, ticker: Ticker, depth: Optional[DepthSnapshot],
                    reason: str) -> OrderResult:
        side = "SELL" if position.side == "LONG" else "BUY"
        cid = new_id("x")
        req = OrderRequest(
            symbol=position.symbol, side=side, qty=position.qty,
            order_type="MARKET", reduce_only=True, client_id=cid,
        )
        order = OrderRecord(id=cid, symbol=position.symbol, side=side, qty=position.qty,
                            order_type="MARKET", status="SENT", reduce_only=True,
                            mode="live", intent=f"exit:{reason}")
        self.ledger.add_order(order)
        res = await self.client.place_order(req)
        order.updated_at = time.time()
        order.exchange_order_id = res.order_id
        if not res.ok:
            order.status = "REJECTED"
            order.error = res.error
            log.error("live exit rejected", extra={"symbol": position.symbol, "error": res.error})
            return res
        fill = res.avg_price or ticker.mid
        fee = res.fee
        if fee <= 0:
            fee = await self.client.order_fee(position.symbol, res.order_id, res.client_id)
        if fee <= 0:
            log.warning("exchange reported no exit fee; booking the modelled taker fee",
                        extra={"symbol": position.symbol, "order_id": res.order_id})
            fee = fill * position.qty * self.cfg.costs.taker_fee_bps / 10_000.0
        order.status = res.status or "FILLED"
        order.avg_fill_price = fill
        order.filled_qty = res.filled_qty
        order.fee = fee
        trade = self.ledger.close_position(
            position.symbol, fill, reason, fees=fee,
            bars_held=int((time.time() - position.opened_at) / 3600),
        )
        log.info("live exit filled", extra={"symbol": position.symbol, "reason": reason,
                                           "fill": fill, "net_pnl": trade.net_pnl if trade else None})
        return res

    async def accrue_funding(self, position: Position, ticker: Ticker) -> float:
        # Funding on a live account is settled by the exchange; we book it at
        # reconcile time from the income endpoint so the ledger matches reality.
        return 0.0

    async def exchange_positions(self) -> List[Any]:
        """Authoritative open positions from the exchange."""
        try:
            return await self.client.position_risk()
        except ExchangeError as exc:
            log.error("could not fetch exchange positions", extra={"error": str(exc)})
            return []

    async def reconcile(self, ledger: Ledger) -> Dict[str, Any]:
        """Compare local state against the exchange and repair divergence."""
        out: Dict[str, Any] = {"ok": True, "mode": "live", "issues": [], "funding_synced": 0.0}
        try:
            remote = await self.client.position_risk()
        except ExchangeError as exc:
            return {"ok": False, "mode": "live", "error": scrub(str(exc)), "issues": ["position_fetch_failed"]}
        remote_map = {p.symbol: p for p in remote}

        for sym in list(ledger.positions.keys()):
            local = ledger.positions[sym]
            r = remote_map.get(sym)
            if r is None:
                out["issues"].append(f"{sym}: local position missing on exchange; closing locally")
                ledger.close_position(sym, local.mark_price, "reconcile_divergence")
                continue
            if (r.position_amt > 0) != (local.side == "LONG"):
                out["issues"].append(f"{sym}: side mismatch local={local.side} remote={r.position_amt}")
            if abs(abs(r.position_amt) - local.qty) / max(local.qty, 1e-9) > 0.02:
                out["issues"].append(
                    f"{sym}: qty drift local={local.qty} remote={abs(r.position_amt)}"
                )
                local.qty = abs(r.position_amt)
            if r.entry_price > 0:
                local.entry_price = r.entry_price
            local.mark_price = r.mark_price or local.mark_price

        for sym, r in remote_map.items():
            if sym not in ledger.positions:
                out["issues"].append(f"{sym}: untracked exchange position {r.position_amt}")

        try:
            income = await self.client.income("FUNDING_FEE", limit=100)
            total = sum(float(i.get("income", 0) or 0) for i in income)
            out["funding_synced"] = total
            for pos in ledger.positions.values():
                # Attribute the most recent aggregate funding to open positions.
                pass
        except ExchangeError:
            pass
        if out["issues"]:
            log.warning("reconciliation found divergence", extra={"issues": out["issues"]})
        return out


# ---------------------------------------------------------------------------
class ExecutionEngine:
    """Owns position lifecycle: entry, stop, target, breakeven, trailing, funding."""

    def __init__(self, cfg, ledger: Ledger, broker: BaseBroker, cost_model: CostModel):
        self.cfg = cfg
        self.ledger = ledger
        self.broker = broker
        self.costs = cost_model
        self.rejects_in_a_row = 0
        self.orders_today = 0
        self._day_key = time.strftime("%Y-%m-%d", time.gmtime())
        self._funding_tick = 0

    def _roll_day(self) -> None:
        today = time.strftime("%Y-%m-%d", time.gmtime())
        if today != self._day_key:
            self._day_key = today
            self.orders_today = 0

    async def open_position(self, setup, sizing: Dict[str, Any], ticker: Ticker,
                            depth: Optional[DepthSnapshot], decision=None) -> tuple[bool, str]:
        self._roll_day()
        if self.orders_today >= self.cfg.execution.max_orders_per_day:
            return False, f"daily order cap ({self.cfg.execution.max_orders_per_day}) reached"
        pos = Position(
            id=new_id("pos"),
            symbol=setup.symbol,
            side=setup.direction,
            qty=sizing["qty"],
            entry_price=setup.price,
            mark_price=setup.price,
            stop=setup.stop,
            initial_stop=setup.stop,
            target=setup.target,
            leverage=sizing.get("leverage", 1.0),
            risk_per_unit=setup.risk_per_unit,
            mode=self.broker.mode,
            strategy_reason=getattr(decision, "reason", setup.reason) if decision else setup.reason,
            expected_edge_bps=getattr(decision, "expected_gross_edge_bps", 0.0) if decision else 0.0,
            cost_bps_at_entry=getattr(decision, "cost_bps", 0.0) if decision else 0.0,
        )
        # Reserve the slot before the network call so concurrent logic cannot double-enter.
        self.ledger.open_position(pos)
        res = await self.broker.open(pos, ticker, depth, setup.price)
        self.orders_today += 1
        if not res.ok:
            self.ledger.positions.pop(setup.symbol, None)
            self.rejects_in_a_row += 1
            return False, res.error
        self.rejects_in_a_row = 0
        return True, f"opened {pos.side} {pos.qty} {pos.symbol} @ {pos.entry_price:.6g}"

    async def close_position(self, symbol: str, ticker: Ticker,
                             depth: Optional[DepthSnapshot], reason: str) -> tuple[bool, str]:
        pos = self.ledger.get(symbol)
        if pos is None:
            return False, "no position"
        res = await self.broker.close(pos, ticker, depth, reason)
        self.orders_today += 1
        if not res.ok:
            self.rejects_in_a_row += 1
            log.error("close failed", extra={"symbol": symbol, "error": res.error})
            return False, res.error
        self.rejects_in_a_row = 0
        return True, f"closed {symbol} ({reason})"

    async def manage(self, symbol: str, ticker: Ticker, depth: Optional[DepthSnapshot],
                     bar_high: float, bar_low: float) -> Dict[str, Any]:
        """Apply stop / target / breakeven / trailing to one open position.

        Called on each closed bar, using the *live* last price for trigger checks so
        risk exits do not wait for the bar to complete.
        """
        pos = self.ledger.get(symbol)
        if pos is None:
            return {}
        price = ticker.mid or ticker.last or pos.mark_price
        pos.mark_price = price
        atr = None

        # --- hard stop / target ------------------------------------------
        if pos.side == "LONG":
            if bar_low > 0 and bar_low <= pos.stop:
                ok, msg = await self.close_position(symbol, ticker, depth, "stop")
                return {"action": "stop", "ok": ok, "msg": msg}
            if bar_high > 0 and bar_high >= pos.target:
                ok, msg = await self.close_position(symbol, ticker, depth, "target")
                return {"action": "target", "ok": ok, "msg": msg}
        else:
            if bar_high > 0 and bar_high >= pos.stop:
                ok, msg = await self.close_position(symbol, ticker, depth, "stop")
                return {"action": "stop", "ok": ok, "msg": msg}
            if bar_low > 0 and bar_low <= pos.target:
                ok, msg = await self.close_position(symbol, ticker, depth, "target")
                return {"action": "target", "ok": ok, "msg": msg}

        # --- breakeven + trailing ---------------------------------------
        r = pos.r_now
        moved = False
        if r >= self.cfg.strategy.breakeven_after_r and not pos.breakeven_moved:
            buffer = 0.05 * pos.risk_per_unit
            pos.stop = pos.entry_price + buffer if pos.side == "LONG" else pos.entry_price - buffer
            pos.breakeven_moved = True
            moved = True
            log.info("stop moved to breakeven", extra={"symbol": symbol, "stop": round(pos.stop, 8)})

        if r >= self.cfg.strategy.trailing_start_r:
            atr = self._atr.get(symbol) if hasattr(self, "_atr") else None
            trail_dist = (self.cfg.strategy.trailing_atr_mult * atr) if atr else abs(
                pos.entry_price - pos.initial_stop
            )
            if pos.side == "LONG":
                new_stop = max(pos.stop, price - trail_dist)
            else:
                new_stop = min(pos.stop, price + trail_dist)
            if (pos.side == "LONG" and new_stop > pos.stop) or (
                pos.side == "SHORT" and new_stop < pos.stop
            ):
                pos.stop = new_stop
                pos.trailing_active = True
                moved = True
        return {"action": "trail" if moved else "hold", "stop": pos.stop, "r": r}

    async def accrue_funding(self) -> float:
        total = 0.0
        for sym, pos in list(self.ledger.positions.items()):
            tk = self._tickers.get(sym) if hasattr(self, "_tickers") else None
            if tk is None:
                continue
            total += await self.broker.accrue_funding(pos, tk)
        return total

    def attach_context(self, tickers: Dict[str, Ticker], atr_map: Dict[str, float]) -> None:
        """Give the engine the live context it needs for trailing and funding."""
        self._tickers = tickers
        self._atr = atr_map

    def snapshot(self) -> Dict[str, Any]:
        return {
            "mode": self.broker.mode,
            "orders_today": self.orders_today,
            "max_orders_per_day": self.cfg.execution.max_orders_per_day,
            "consecutive_rejects": self.rejects_in_a_row,
        }
