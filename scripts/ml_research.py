#!/usr/bin/env python3
"""ML data/training operator.

Examples:
  python scripts/ml_research.py ingest --db .gigpilot-data/gigpilot.db
  python scripts/ml_research.py train --db .gigpilot-data/gigpilot.db --symbol BTCUSDT
  python scripts/ml_research.py collect-l2 --db .gigpilot-data/gigpilot.db
"""
from __future__ import annotations

import argparse
import asyncio
import os

from gpkg.core.config import Config
from gpkg.ml.data import HistoricalDataWorker
from gpkg.ml.training import TrainingConfig, register_validated_candidate, train_candidate
from gpkg.ml.registry import ModelRegistry
from gpkg.persistence.store import Store


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("ingest", "collect-l2", "train"))
    parser.add_argument("--db", default=os.getenv("GIGPILOT_DB", ".gigpilot-data/gigpilot.db"))
    parser.add_argument("--symbol", default=None)
    args = parser.parse_args()
    store = Store(args.db)
    worker = HistoricalDataWorker(store)

    if args.command == "ingest":
        async def run():
            for symbol in worker.symbols:
                print(symbol, await worker.ingest_klines(symbol))
        asyncio.run(run())
        return 0

    if args.command == "collect-l2":
        async def run():
            await worker.collect_forever()
        asyncio.run(run())
        return 0

    symbols = (args.symbol,) if args.symbol else worker.symbols
    registry = ModelRegistry(store)
    config = TrainingConfig()
    rc = 0
    for symbol in symbols:
        try:
            result = train_candidate(store, symbol, config=config)
            print(symbol, result.state.value, result.verified, result.reason)
            if result.verified:
                register_validated_candidate(store, registry, result)
        except Exception as exc:
            model_id = f"alpha-{symbol.lower()}-training-error"
            store.ml_research_audit(model_id, "ERROR", str(exc), {"symbol": symbol})
            print(symbol, "REJECTED", str(exc))
            rc = 1
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
