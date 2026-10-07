"""Position, order, and credential authorization reconciler.

Invariants:
  - Divergence self-healing between local state and Bybit exchange truth.
  - Orphan client order cleanup.
  - Authentic trade authorization probing: verifies ContractTrade permission on live API key.
"""
from __future__ import annotations

import logging

from gpkg.core.clock import f, now_ms
from gpkg.core.config import Config
from gpkg.core.metrics import Metrics
from gpkg.exchange.bybit_rest import BybitREST
from gpkg.persistence.store import Store

log = logging.getLogger("gigpilot")


class Reconciler:
    def __init__(
        self,
        cfg: Config,
        rest: BybitREST,
        store: Store,
        positions: dict,
        metrics: Metrics | None = None,
    ):
        self.cfg = cfg
        self.rest = rest
        self.store = store
        self.positions = positions
        self._metrics = metrics
        self.healthy = False
        self.last_error: str | None = "not_run"
        self.last_run_ms = 0
        # Trade AUTHORIZATION, tracked separately from authentication.
        self.trade_permissions_ok = False
        self.trade_permissions_error: str | None = "not_run"
        self.trade_permissions_ms = 0

    async def run_once(self) -> None:
        try:
            exch = {p["symbol"]: p for p in await self.rest.positions() if f(p.get("size")) > 0}
        except Exception as e:
            self.healthy = False
            self.last_error = str(e)
            self.last_run_ms = now_ms()
            log.warning("reconcile positions: %s", e)
            if self._metrics:
                self._metrics.inc("gigpilot_reconcile_errors_total")
            return

        for sym in list(self.positions.keys()):
            if sym not in exch:
                log.warning("RECONCILE: local %s, exchange flat — pending verify", sym)
                local = self.positions.pop(sym)
                if local.get("trade_id"):
                    self.store.mark_closed_pending(local["trade_id"], "exchange_flat")
                if self._metrics:
                    self._metrics.inc("gigpilot_reconcile_divergences_total", kind="local_open_exch_flat")
                continue
            ep = exch[sym]
            e_qty = f(ep.get("size"))
            if abs(e_qty - self.positions[sym].get("qty", 0.0)) > 1e-9:
                self.positions[sym]["qty"] = e_qty
                if self._metrics:
                    self._metrics.inc("gigpilot_reconcile_divergences_total", kind="size")

        for sym, ep in exch.items():
            if sym not in self.positions:
                log.warning("RECONCILE: adopting untracked %s", sym)
                self.positions[sym] = {
                    "side": ep.get("side", "Buy"),
                    "qty": f(ep.get("size")),
                    "entry": f(ep.get("avgPrice")),
                    "trade_id": None,
                }
                if self._metrics:
                    self._metrics.inc("gigpilot_reconcile_divergences_total", kind="adopt")

        try:
            for o in await self.rest.open_orders():
                link = o.get("orderLinkId", "")
                if not link.startswith("gp-"):
                    continue
                try:
                    await self.rest.cancel_order(category="linear", symbol=o["symbol"], orderLinkId=link)
                    if self._metrics:
                        self._metrics.inc("gigpilot_reconcile_divergences_total", kind="orphan_cancelled")
                except Exception:
                    pass
        except Exception as e:
            self.healthy = False
            self.last_error = str(e)
            self.last_run_ms = now_ms()
            log.warning("reconcile orders: %s", e)
            return

        # --- trade-authorization probe (non-mutating) ---
        try:
            info = (await self.rest.api_info()).get("result", {}) or {}
            perms = info.get("permissions", {}) or {}
            contract_trade = perms.get("ContractTrade") or []
            read_only = int(info.get("readOnly", 0) or 0)
            if read_only != 0:
                self.trade_permissions_ok = False
                self.trade_permissions_error = "API key is READ-ONLY; it cannot place orders"
            elif not contract_trade:
                self.trade_permissions_ok = False
                self.trade_permissions_error = "API key lacks the ContractTrade permission; it cannot place futures orders"
            else:
                self.trade_permissions_ok = True
                self.trade_permissions_error = None
        except Exception as e:
            self.trade_permissions_ok = False
            self.trade_permissions_error = str(e)
        self.trade_permissions_ms = now_ms()

        self.healthy = True
        self.last_error = None
        self.last_run_ms = now_ms()
