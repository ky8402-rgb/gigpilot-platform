"""GigPilot — modular Python trading platform (migration target).

This package (root name `gpkg`, not `gp`) is the clean, modular home for the platform. `gigpilot.py` (the original monolith) is
being dismantled into it package-by-package, with `gigpilot.py` keeping backwards-compatible
re-exports so nothing breaks mid-migration.

Layout (per migration/MIGRATION_PLAN.md, with the root named `gpkg/` to avoid colliding with the still-present
`gigpilot.py` AND with the very common local alias `import gigpilot as gp`):

    gpkg/core/          config, clock, logging, errors, metrics, background ownership
    gpkg/exchange/      Bybit REST + WebSocket, instruments, idempotency
    gpkg/market/        feeds, orderbook, candles, universe selection
    gpkg/strategy/      regime, signals, edge scoring, sizing
    gpkg/risk/          limits, reserve, exposure, circuit breakers
    gpkg/execution/     order router, idempotency keys, reconciliation
    gpkg/accounting/    fills, fees, funding, realized/net PnL
    gpkg/persistence/   state store, migrations, audit log
    gpkg/api/           FastAPI app and routes
    gpkg/web/           dashboard delivery

Rule for every extraction: the module must be importable without side effects, and `gigpilot.py`'s
public names must keep resolving so the deployed engine is unaffected.
"""

__all__ = ["core"]
