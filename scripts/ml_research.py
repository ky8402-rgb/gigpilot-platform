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

from gpkg.ml.audit import normalize_audit



def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=(
        "ingest", "collect-l2", "train", "audit-summary", "tournament", "tournament-status",
    ))
    parser.add_argument("--db", default=os.getenv("GIGPILOT_DB", ".gigpilot-data/gigpilot.db"))
    parser.add_argument("--symbol", default=None)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--format", choices=("json", "table"), default="json")
    parser.add_argument("--generations", type=int, default=4)
    parser.add_argument("--population", type=int, default=12)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--window-days", type=int, default=90)
    args = parser.parse_args()

    if args.command == "tournament-status":
        from gpkg.ml.tournament import load_latest_tournament
        from gpkg.persistence.store import Store
        summary = load_latest_tournament(Store(args.db), args.symbol)
        if summary is None:
            print(json.dumps({
                "available": False,
                "message": "no tournament has run yet; run `gigpilot ml tournament`",
            }, indent=2))
            return 0
        if args.format == "table":
            print(f"  symbol            {summary['symbol']}")
            print(f"  outcome           {summary['outcome']}")
            print(f"  evaluated         {summary['candidates_evaluated']}")
            print(f"  admitted          {summary['candidates_admitted']}")
            print(f"  bars              {summary['bars_used']:,}")
            print(f"  l2_ready          {summary['l2_ready']}")
            print(f"  peak_spread_bps   {summary['peak_spread_bps']}")
            g = summary["gates"]
            print(f"  gates             net>={g['min_net_edge_bps']} sharpe>{g['min_oos_sharpe']} "
                  f"pf>{g['min_profit_factor']} t>{g['min_t_stat']} folds={g['min_walk_forward_folds']}")
            champ = summary.get("champion")
            print(f"  champion          {champ['model_id'] if champ else '(none cleared the gates)'}")
            print("  closest rejected:")
            for r in summary.get("rejected_ranked", [])[:5]:
                if r["oos_trades"] < g["min_oos_trades"]:
                    continue
                print(f"    {r['family']:14s} net={r['net_edge_bps']:9.3f} sharpe={r['oos_sharpe']:8.3f} "
                      f"t={r['t_stat']:8.3f} trades={r['oos_trades']}")
            return 0
        print(json.dumps(summary, indent=2, sort_keys=True, default=str))
        return 0

    if args.command == "tournament":
        import time as _time
        from gpkg.ml.data import HistoricalDataWorker
        from gpkg.ml.tournament import run_tournament
        from gpkg.persistence.store import Store
        store = Store(args.db)
        worker = HistoricalDataWorker(store)
        symbols = (args.symbol,) if args.symbol else worker.symbols
        rc = 0
        for symbol in symbols:
            try:
                t0 = _time.time()
                res = run_tournament(
                    store, symbol,
                    generations=max(1, args.generations),
                    population_size=max(2, args.population),
                    seed=args.seed,
                    window_days=args.window_days,
                )
                j = res.to_json()
                print(f"{symbol} {j['outcome']} evaluated={j['candidates_evaluated']} "
                      f"admitted={j['candidates_admitted']} in {_time.time() - t0:.1f}s")
                if j["champion"]:
                    print(f"  champion {j['champion']['model_id']} net={j['champion']['net_edge_bps']} bps")
                else:
                    print("  no candidate cleared the strict gates "
                          f"(net>=8.0 bps, sharpe>1.8, pf>1.75, t>3.0)")
            except Exception as exc:
                store.ml_research_audit(f"tournament-{symbol.lower()}-error", "ERROR", str(exc),
                                        {"symbol": symbol})
                print(f"{symbol} TOURNAMENT_ERROR {exc}")
                rc = 1
        return rc

    if args.command == "audit-summary":
        from gpkg.persistence.store import Store
        import json
        store = Store(args.db)
        audits = [normalize_audit(row) for row in store.ml_research_audits(limit=max(1, min(args.limit, 1000)))]
        if args.format == "table":
            headers = ("TIME", "FAMILY", "GROSS", "FEES", "2xPEAK", "IMPACT", "NET", "T", "SHARPE", "GATE")
            print(" ".join(f"{h:>12}" for h in headers))
            print("-" * 132)
            for row in audits:
                costs = row["cost_deductions"]
                values = (
                    str(row["ts_ms"]), row["model_family"][:24], f"{row['gross_edge_bps']:.2f}",
                    f"{costs['fees_bps']:.2f}", f"{costs['two_x_peak_spread_bps']:.2f}",
                    f"{costs['modeled_impact_bps']:.2f}", f"{row['net_edge_bps']:.2f}",
                    f"{row['t_stat']:.2f}", f"{row['oos_sharpe']:.2f}",
                    "PASS" if row["gate_outcome"] else "REJECT",
                )
                print(" ".join(f"{v:>12}" for v in values))
                if row["gate_failures"]:
                    print("  reason:", " | ".join(str(x) for x in row["gate_failures"]))
            return 0
        print(json.dumps(audits, indent=2, sort_keys=True, default=str))
        return 0

    from gpkg.ml.baseline import qualify_conservative_baseline, register_baseline_paper
    from gpkg.ml.data import HistoricalDataWorker
    from gpkg.ml.registry import ModelRegistry
    from gpkg.ml.training import (
        TrainingConfig,
        register_validated_candidate,
        train_candidate,
        train_hypotheses,
    )
    from gpkg.persistence.store import Store
    store = Store(args.db)
    worker = HistoricalDataWorker(store)

    if args.command == "ingest":
        async def run():
            for symbol in worker.symbols:
                klines = await worker.ingest_klines(symbol)
                funding, basis = await worker.ingest_funding_and_basis(symbol)
                print(symbol, "klines", klines, "funding_8h", funding, "basis_1m", basis)
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
        strict_verified=False
        try:
            try:
                funding, basis = asyncio.run(worker.ingest_funding_and_basis(symbol))
                print(symbol, "funding_8h_refresh", funding, "basis_1m_refresh", basis)
            except Exception as exc:
                store.ml_research_audit(f"market-data-{symbol.lower()}-funding-basis", "ERROR", str(exc), {"symbol": symbol})
            result=train_candidate(store,symbol,config=config); print(symbol,result.state.value,result.verified,result.reason)
            if result.verified: register_validated_candidate(store,registry,result); strict_verified=True
        except Exception as exc:
            store.ml_research_audit(f"alpha-{symbol.lower()}-training-error","ERROR",str(exc),{"symbol":symbol}); print(symbol,"STRICT_REJECTED",str(exc))
        try:
            hypotheses, progress = train_hypotheses(store, symbol, taker_fee_bps=config.taker_fee_bps)
            print(symbol, "HYPOTHESES", progress)
            for evidence in hypotheses:
                registry.persist_evidence(evidence, reason="funding_regime_walk_forward")
                if evidence.verified:
                    from gpkg.ml.lifecycle import ModelState
                    registry.transition(evidence.model_id, ModelState.PAPER, reason="strict_funding_regime_oos_passed_paper_admission")
                    strict_verified = True
        except Exception as exc:
            store.ml_research_audit(f"hypotheses-{symbol.lower()}-training-error","ERROR",str(exc),{"symbol":symbol})

        if not strict_verified:
            try:
                evidence,reason=qualify_conservative_baseline(store,symbol,taker_fee_bps=config.taker_fee_bps,hurdle_bps=config.edge_hurdle_bps)
                verified=bool(evidence and evidence.verified); print(symbol,"BASELINE",verified,reason)
                if verified: register_baseline_paper(registry,evidence)
            except Exception as exc:
                store.ml_research_audit(f"baseline-{symbol.lower()}-training-error","ERROR",str(exc),{"symbol":symbol}); print(symbol,"BASELINE_REJECTED",str(exc)); rc=1
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
