#!/usr/bin/env python3
"""LIVE adapter verification against the REAL public exchange APIs.

WHY THIS IS SEPARATE FROM `tests/`
----------------------------------
These checks talk to api.bybit.com, fapi.binance.com and api-futures.kucoin.com. They are the only
way to prove the instrument parsing is correct — a fixture only proves the adapter agrees with MY
assumption about the wire format, which is exactly the assumption under test. A fixture generated
from a wrong reading of the docs produces a passing test and a broken adapter.

They are NOT part of the default test run because a network dependency would make CI flaky and
because a venue changing a field name should surface as a monitoring signal, not a red build.

WHAT IS AND IS NOT VERIFIED HERE
--------------------------------
VERIFIED against real responses: instrument discovery, lot/tick/leverage parsing, symbol mapping,
tradeable() gating, cross-venue market discovery. All read-only, no credentials, no orders.
NOT VERIFIABLE here: every signed endpoint (balances, positions, order placement). Those need real
credentials, and claiming them verified without them would be a fabrication.

Run: python3 scripts/verify_exchange_adapters.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.core.config import Config
from gpkg.exchange.adapters import (
    BinanceAdapter,
    BybitAdapter,
    KucoinAdapter,
)
from gpkg.exchange.base import ExchangeError
from gpkg.exchange.registry import ExchangeRegistry

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail and not cond else ""))


def make_cfg() -> Config:
    return Config(api_key="", api_secret="", symbols=[], host="https://api.bybit.com",
                  ws_public="", db_path=":memory:")


async def verify_exchange(label: str, adapter) -> dict:
    print(f"\n=== {label} ({adapter.name}) ===")
    await adapter.start()
    result = {}
    try:
        instruments = await adapter.instruments()
        check(f"{label}: instrument discovery returns data", len(instruments) > 0,
              f"got {len(instruments)}")
        if not instruments:
            return result

        btc = next((i for i in instruments if i.unified == "BTC/USDT"), None)
        check(f"{label}: BTC/USDT perpetual present", btc is not None)
        if btc is None:
            return result

        # The fields the executor cannot function without.
        check(f"{label}: qty_step parsed and positive", float(btc.qty_step) > 0, btc.qty_step)
        check(f"{label}: min_qty parsed and positive", float(btc.min_qty) > 0, btc.min_qty)
        check(f"{label}: tick_size parsed and positive", float(btc.tick_size) > 0, btc.tick_size)
        check(f"{label}: max_leverage >= 1", btc.max_leverage >= 1.0, str(btc.max_leverage))
        check(f"{label}: BTC/USDT is tradeable()", btc.tradeable())
        result["btc"] = btc

        # Every returned instrument must satisfy tradeable() or be excluded — never a partial spec.
        incomplete = [i for i in instruments
                      if i.tradeable() and not (float(i.qty_step) > 0 and float(i.tick_size) > 0)]
        check(f"{label}: no tradeable instrument has a missing spec", not incomplete,
              f"{len(incomplete)} offenders")

        try:
            t = await adapter.ticker("BTCUSDT" if adapter.name != "kucoin" else "XBTUSDTM")
            check(f"{label}: ticker returns a usable price", t.mid > 0, str(t.mid))
            check(f"{label}: spread is finite and non-negative", 0 <= t.spread_bps < 10_000,
                  str(t.spread_bps))
            result["spread_bps"] = t.spread_bps
        except ExchangeError as e:
            check(f"{label}: ticker readable", False, str(e))
    finally:
        await adapter.stop()
    return result


async def main() -> int:
    print("=" * 78)
    print("LIVE EXCHANGE ADAPTER VERIFICATION (public endpoints, no credentials, no orders)")
    print("=" * 78)

    cfg = make_cfg()
    results = {}
    results["bybit"] = await verify_exchange("Bybit", BybitAdapter(cfg))
    results["binance"] = await verify_exchange("Binance", BinanceAdapter())
    kucoin = KucoinAdapter()
    results["kucoin"] = await verify_exchange("KuCoin", kucoin)

    # KuCoin's symbol alphabet is the venue quirk most likely to silently break routing.
    print("\n=== KuCoin symbol mapping ===")
    check("KuCoin maps BTC/USDT -> XBTUSDTM", kucoin.unified_to_native("BTC/USDT") == "XBTUSDTM",
          str(kucoin.unified_to_native("BTC/USDT")))
    check("KuCoin maps ETH/USDT -> ETHUSDTM", kucoin.unified_to_native("ETH/USDT") == "ETHUSDTM",
          str(kucoin.unified_to_native("ETH/USDT")))

    # Cross-venue discovery: the premise of the whole multi-exchange build.
    print("\n=== Cross-exchange market discovery ===")
    reg = ExchangeRegistry([BybitAdapter(cfg), BinanceAdapter(), KucoinAdapter()])
    await reg.start()
    try:
        markets = await reg.discover_markets(quote="USDT")
        check("discovery returns unified markets", len(markets) > 0, f"{len(markets)} markets")
        multi = await reg.multi_venue_markets(quote="USDT", min_venues=2)
        check("at least one market is listed on >=2 exchanges", len(multi) > 0,
              f"{len(multi)} multi-venue markets")
        btc = multi.get("BTC/USDT", [])
        check("BTC/USDT discovered on >=2 exchanges", len(btc) >= 2,
              f"venues: {[i.exchange for i in btc]}")
        if btc:
            print(f"    BTC/USDT venues: {', '.join(sorted(i.exchange for i in btc))}")
            for i in sorted(btc, key=lambda x: x.exchange):
                print(f"      {i.exchange:8s} native={i.symbol:12s} step={i.qty_step:>10s} "
                      f"min={i.min_qty:>10s} tick={i.tick_size:>8s} maxLev={i.max_leverage:.0f}")
    finally:
        await reg.stop()

    print("\n" + "=" * 78)
    print(f"{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILURES:")
        for f in FAIL:
            print(f"  - {f}")
    print("=" * 78)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
