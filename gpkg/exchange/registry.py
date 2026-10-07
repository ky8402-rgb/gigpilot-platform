"""Cross-exchange registry: discovery, eligibility, and capital routing.

This is where "trade whatever is eligible across my connected exchanges" is actually decided. Every
decision here is deliberately FAIL-CLOSED, because each one can move real money:

  * An exchange is ELIGIBLE only if its live snapshot proves read access, proven trade permission,
    positive equity, AND no withdrawal capability. Absence of proof is ineligibility — not a reason
    to try anyway.
  * Capital is allocated only across eligible exchanges, never above what each one reports as
    available, and never above the operator's declared budget.
  * Market discovery returns only instruments whose lot size, tick size and minimum quantity are all
    known and positive. An instrument we cannot size precisely is not a candidate, because the only
    alternative is guessing at the order size.

Nothing in this module places an order. It answers "where could capital go, and how much", and leaves
execution to the executor behind the risk gate.
"""
from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass, field

from gpkg.core.clock import now_ms
from gpkg.exchange.base import (
    AccountSnapshot,
    ExchangeAdapter,
    ExchangeError,
    Instrument,
)

log = logging.getLogger("gigpilot")


@dataclass
class VenueEligibility:
    """Why an exchange is or is not usable. Recorded so the reason is auditable, not just the verdict."""

    exchange: str
    eligible: bool
    reason: str
    equity_usd: float = 0.0
    available_usd: float = 0.0
    max_alloc_usd: float = 0.0

    def to_dict(self) -> dict:
        return {
            "exchange": self.exchange,
            "eligible": self.eligible,
            "reason": self.reason,
            "equity_usd": round(self.equity_usd, 2),
            "available_usd": round(self.available_usd, 2),
            "max_alloc_usd": round(self.max_alloc_usd, 2),
        }


@dataclass
class AllocationPlan:
    """The result of a routing pass. `allocations` sums to at most the requested budget."""

    requested_usd: float
    allocations: dict[str, float] = field(default_factory=dict)
    skipped: list[VenueEligibility] = field(default_factory=list)
    ts_ms: int = 0

    @property
    def allocated_usd(self) -> float:
        return sum(self.allocations.values())

    def to_dict(self) -> dict:
        return {
            "requested_usd": round(self.requested_usd, 2),
            "allocated_usd": round(self.allocated_usd, 2),
            "allocations": {k: round(v, 2) for k, v in self.allocations.items()},
            "skipped": [s.to_dict() for s in self.skipped],
            "ts_ms": self.ts_ms,
        }


class ExchangeRegistry:
    """Holds the connected adapters and answers routing questions about them."""

    def __init__(self, adapters: Iterable[ExchangeAdapter] = ()):
        self._adapters: dict[str, ExchangeAdapter] = {a.name: a for a in adapters}

    # -- membership ------------------------------------------------------------------
    def add(self, adapter: ExchangeAdapter) -> None:
        self._adapters[adapter.name] = adapter

    def get(self, exchange: str) -> ExchangeAdapter | None:
        return self._adapters.get(exchange)

    @property
    def exchanges(self) -> list[str]:
        return sorted(self._adapters)

    async def start(self) -> None:
        started = []
        for name, a in self._adapters.items():
            try:
                await a.start()
                started.append(name)
            except ExchangeError as e:
                # One venue failing to initialise must not take the others down with it.
                log.warning("exchange %s failed to start: %s", name, e)
        log.info("exchanges started: %s", ", ".join(started) or "<none>")

    async def stop(self) -> None:
        for a in self._adapters.values():
            try:
                await a.stop()
            except Exception:
                pass

    # -- discovery -------------------------------------------------------------------
    async def discover_markets(self, quote: str = "USDT") -> dict[str, list[Instrument]]:
        """unified symbol -> the instruments offering it, across every connected exchange.

        Only `tradeable()` instruments are returned. A venue that errors is logged and skipped
        rather than aborting discovery for the venues that answered.
        """
        out: dict[str, list[Instrument]] = {}
        for name, a in self._adapters.items():
            try:
                instruments = await a.instruments()
            except ExchangeError as e:
                log.warning("instrument discovery failed for %s: %s", name, e)
                continue
            for inst in instruments:
                # `tradeable()` already requires a perpetual contract type; the explicit check here
                # documents that excluding dated futures is intentional, not incidental.
                if inst.quote != quote or not inst.tradeable() or not inst.is_perpetual():
                    continue
                out.setdefault(inst.unified, []).append(inst)
        return out

    async def multi_venue_markets(self, quote: str = "USDT", min_venues: int = 2) -> dict[str, list[Instrument]]:
        """Only markets listed on at least `min_venues` exchanges — these are the ones where venue
        selection is actually a choice and therefore worth comparing on cost."""
        markets = await self.discover_markets(quote=quote)
        return {k: v for k, v in markets.items() if len(v) >= min_venues}

    # -- eligibility -----------------------------------------------------------------
    async def snapshots(self) -> dict[str, AccountSnapshot]:
        out: dict[str, AccountSnapshot] = {}
        for name, a in self._adapters.items():
            try:
                out[name] = await a.account()
            except ExchangeError as e:
                s = AccountSnapshot(exchange=name)
                s.permission_error = str(e)
                out[name] = s
        return out

    async def evaluate_eligibility(self) -> list[VenueEligibility]:
        """One verdict per connected exchange, with the reason recorded either way."""
        out: list[VenueEligibility] = []
        for name, snap in (await self.snapshots()).items():
            if not snap.read_ok:
                out.append(VenueEligibility(name, False,
                                            f"read failed: {snap.permission_error or 'unknown'}"))
                continue
            if not snap.trade_permission_ok:
                out.append(VenueEligibility(name, False,
                                            f"trade not permitted: {snap.permission_error}",
                                            equity_usd=snap.equity_usd,
                                            available_usd=snap.available_usd))
                continue
            if snap.withdraw_enabled:
                out.append(VenueEligibility(name, False,
                                            "credential can withdraw; refusing autonomous routing",
                                            equity_usd=snap.equity_usd,
                                            available_usd=snap.available_usd))
                continue
            if snap.equity_usd <= 0 or snap.available_usd <= 0:
                out.append(VenueEligibility(name, False,
                                            "no usable balance",
                                            equity_usd=snap.equity_usd,
                                            available_usd=snap.available_usd))
                continue
            out.append(VenueEligibility(name, True, "eligible",
                                        equity_usd=snap.equity_usd,
                                        available_usd=snap.available_usd,
                                        max_alloc_usd=snap.available_usd))
        return out

    async def eligible_exchanges(self) -> list[str]:
        return [e.exchange for e in await self.evaluate_eligibility() if e.eligible]

    # -- capital routing -------------------------------------------------------------
    async def allocate(self, budget_usd: float, *, per_exchange_cap_pct: float = 100.0) -> AllocationPlan:
        """Split `budget_usd` across eligible exchanges, weighted by each one's AVAILABLE balance.

        Weighting by available (not total) balance matters: equity can be fully consumed by margin
        already posted, and allocating against equity would commit funds that are not free to use.

        The result never exceeds the requested budget, never exceeds an exchange's own available
        balance, and never exceeds the operator's per-exchange cap. If nothing is eligible the plan
        is empty — an honest "no venue can take capital right now", not an error to route around.
        """
        plan = AllocationPlan(requested_usd=budget_usd, ts_ms=now_ms())
        verdicts = await self.evaluate_eligibility()
        plan.skipped = [v for v in verdicts if not v.eligible]
        eligible = [v for v in verdicts if v.eligible]

        if not eligible or budget_usd <= 0:
            return plan

        total_available = sum(v.available_usd for v in eligible)
        if total_available <= 0:
            return plan

        caps = {v.exchange: v.available_usd * per_exchange_cap_pct / 100.0 for v in eligible}
        remaining = budget_usd
        # Two passes: a proportional split, then a redistribution of anything an exchange could not
        # absorb within its cap. One pass would strand budget silently whenever a cap bound.
        for _ in range(2):
            if remaining <= 1e-9:
                break
            weight_total = sum(v.available_usd for v in eligible) or total_available
            if weight_total <= 0:
                break
            progressed = False
            for v in list(eligible):
                share = remaining * (v.available_usd / weight_total)
                room = caps[v.exchange] - plan.allocations.get(v.exchange, 0.0)
                take = max(0.0, min(share, room))
                if take > 1e-9:
                    plan.allocations[v.exchange] = plan.allocations.get(v.exchange, 0.0) + take
                    progressed = True
            new_remaining = budget_usd - sum(plan.allocations.values())
            if not progressed or abs(new_remaining - remaining) < 1e-9:
                remaining = new_remaining
                break
            remaining = new_remaining

        # Never hand out more than was asked for, or more than a venue holds.
        for ex, amt in list(plan.allocations.items()):
            plan.allocations[ex] = min(amt, caps[ex])
        return plan

    def describe(self) -> list[dict]:
        return [{"exchange": a.name, "adapter": type(a).__name__} for a in self._adapters.values()]
