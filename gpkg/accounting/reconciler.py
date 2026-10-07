"""Exchange-verified closed PnL and fee accounting reconciler.

Never fabricates local accounting rows; unmatched closes emit ACCT_ORPHAN audit records.
"""
from __future__ import annotations

import logging

from gpkg.core.clock import f
from gpkg.core.metrics import Metrics
from gpkg.exchange.bybit_rest import BybitREST
from gpkg.persistence.store import Store

log = logging.getLogger("gigpilot")


class AccountingReconciler:
    """Back-fills realized_pnl + fees from /v5/position/closed-pnl.

    Unmatched exchange closes emit ACCT_ORPHAN — never fabricate a local row.
    """

    def __init__(self, rest: BybitREST, store: Store, metrics: Metrics | None = None):
        self.rest = rest
        self.store = store
        self._metrics = metrics
        self._seen_order_ids: set[str] = set()

    async def run_once(self) -> int:
        try:
            rows = await self.rest.closed_pnl(limit=100)
        except Exception as e:
            log.warning("closed-pnl fetch failed: %s", e)
            if self._metrics:
                self._metrics.inc("gigpilot_accounting_errors_total")
            return 0
        applied = 0
        for row in rows:
            order_id = str(row.get("orderId", ""))
            if not order_id or order_id in self._seen_order_ids:
                continue
            self._seen_order_ids.add(order_id)
            sym = row.get("symbol", "")
            side = row.get("side", "")
            avg_exit = f(row.get("avgExitPrice"))
            closed_pnl = f(row.get("closedPnl"))
            created_ms = int(f(row.get("createdTime"), 0))
            total_fee = 0.0
            for a, b in (("openFee", "closeFee"), ("cumEntryFee", "cumExitFee")):
                if a in row or b in row:
                    total_fee = f(row.get(a)) + f(row.get(b))
                    break
            if total_fee == 0.0:
                total_fee = f(row.get("execFee"))
            matched = self.store.match_closed_trade(sym, side, created_ms)
            if matched is None:
                log.warning("ACCT: unmatched close %s side=%s pnl=%.4f", sym, side, closed_pnl)
                self.store.journal(
                    "ACCT_ORPHAN",
                    sym,
                    {"orderId": order_id, "side": side, "pnl": closed_pnl, "fee": total_fee},
                )
                if self._metrics:
                    self._metrics.inc("gigpilot_accounting_orphans_total", symbol=sym)
                continue
            self.store.apply_exchange_pnl(matched["id"], avg_exit, closed_pnl, total_fee)
            applied += 1
            if self._metrics:
                self._metrics.inc("gigpilot_accounting_backfilled_total")
            log.info(
                "ACCT: trade#%d %s backfilled pnl=%.4f fee=%.4f (exchange-verified)",
                matched["id"],
                sym,
                closed_pnl,
                total_fee,
            )
        if applied:
            log.info("accounting reconciler applied %d rows", applied)
        return applied
