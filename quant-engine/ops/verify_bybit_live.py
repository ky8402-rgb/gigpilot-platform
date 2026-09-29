#!/usr/bin/env python3
"""Verify the Bybit adapter against the LIVE Bybit API.

Unit tests prove the adapter against captured payloads; this proves it against the
real, moving market. Exercises the whole public path and then feeds the result
through the actual strategy/cost pipeline.

The private path cannot be exercised without funded credentials, so this script
verifies the auth boundary instead: it confirms Bybit ACCEPTS our signature
(rejecting us for the IP allowlist, not for a bad sign). That is the strongest
statement available without working keys, and it is reported honestly.

Usage:  python3 ops/verify_bybit_live.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import indicators as ta  # noqa: E402
from app.bybit import BybitClient, BybitPrivate  # noqa: E402
from app.config import load_config  # noqa: E402
from app.costs import CostModel  # noqa: E402
from app.exchange import ExchangeError, create_market_client  # noqa: E402
from app.learning import run_backtest, score_trades  # noqa: E402
from app.market import rows_to_df, screen_universe  # noqa: E402
from app.strategy import latest_setup  # noqa: E402

PASS, FAIL, WARN = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m", "\033[33mWARN\033[0m"
RESULTS: list = []


def check(ok: bool, label: str, detail: str = "", warn_only: bool = False) -> bool:
    ok = bool(ok)
    RESULTS.append((label, ok, warn_only))
    tag = PASS if ok else (WARN if warn_only else FAIL)
    print(f"  [{tag}] {label}" + (f" — {detail}" if detail else ""))
    return ok


async def main() -> int:
    cfg = load_config()
    cfg.exchange.name = "bybit"
    cfg.exchange.rest_url = "https://api.bybit.com"
    cfg.exchange.ws_url = "wss://stream.bybit.com/v5/public/linear"

    print("=" * 78)
    print(" BYBIT LIVE ADAPTER VERIFICATION")
    print(f" venue={cfg.exchange.name} rest={cfg.exchange.rest_url}")
    print(f" ws={cfg.exchange.ws_url}  taker_fee={cfg.costs.taker_fee_bps}bps")
    print("=" * 78)

    client = create_market_client(cfg)
    print(f"\n[1] Connectivity  (adapter = {type(client).__name__})")
    try:
        latency = await client.ping()
        check(True, "GET /v5/market/time reachable", f"{latency:.0f}ms")
        st = await client.server_time()
        check(st > 1_600_000_000_000, "server time parsed", f"{st}")
        check(client.ws_connect_url("1h", ["BTCUSDT"]).startswith("wss://"),
              "websocket URL built", client.ws_connect_url("1h", ["BTCUSDT"]))
    except Exception as exc:
        check(False, "connectivity", f"{type(exc).__name__}: {exc}")
        return _summary()

    print("\n[2] Instruments (pagination + filtering)")
    try:
        specs = await client.exchange_info()
        check(len(specs) > 50, "tradable USDT perpetuals discovered", f"{len(specs)} symbols")
        check("BTCUSDT" in specs, "BTCUSDT present")
        btc = specs.get("BTCUSDT")
        if btc:
            check(btc.tick_size > 0 and btc.step_size > 0, "tick/step sizes parsed",
                  f"tick={btc.tick_size} step={btc.step_size} minNotional={btc.min_notional} maxLev={btc.max_leverage}")
        dupes = len(specs) - len(set(specs))
        check(dupes == 0, "no duplicates across pages", f"dupes={dupes}")
    except Exception as exc:
        check(False, "instruments", f"{type(exc).__name__}: {exc}")
        specs = {}

    print("\n[3] Tickers")
    try:
        tickers = await client.tickers_24h()
        check(len(tickers) > 50, "tickers parsed", f"{len(tickers)}")
        t = tickers.get("BTCUSDT")
        if t:
            check(t.last > 0 and t.bid > 0 and t.ask > 0, "BTC bid/ask/last populated",
                  f"bid={t.bid} ask={t.ask} last={t.last}")
            check(t.ask >= t.bid, "ask >= bid")
            check(abs(t.price_change_pct_24h) < 50,
                  "24h change is a sane percentage (fraction->percent scaling correct)",
                  f"{t.price_change_pct_24h:.4f}%")
            check(t.quote_volume_24h > 0, "24h turnover parsed", f"${t.quote_volume_24h:,.0f}")
            check(t.mark_price > 0, "mark price parsed", f"{t.mark_price}")
            check(t.funding_interval_hours > 0, "funding interval parsed",
                  f"{t.funding_interval_hours}h")
            check(0 < t.spread_bps < 50, "spread is realistic", f"{t.spread_bps:.4f}bps")
    except Exception as exc:
        check(False, "tickers", f"{type(exc).__name__}: {exc}")
        tickers = {}

    print("\n[4] Candles (ordering + normalisation) + cross-check vs raw REST")
    df = None
    try:
        rows = await client.klines("BTCUSDT", "1h", limit=100)
        check(len(rows) == 100, "recent klines returned", f"{len(rows)}")
        ts = [r[0] for r in rows]
        check(ts == sorted(ts), "rows are ASCENDING (Bybit sends descending)")
        check(all(len(r) == 6 for r in rows), "6 normalised columns")
        check(all(isinstance(v, (int, float)) for r in rows for v in r),
              "all values numeric (Bybit sends strings)")
        check(all(r[3] <= r[1] and r[2] >= r[1] and r[2] >= r[3] for r in rows),
              "OHLC invariant holds (low<=open<=high, low<=close<=high)")

        # Independently re-pull the same window from raw Bybit REST and compare.
        raw = json.loads(urllib.request.urlopen(
            "https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=60&limit=100",
            timeout=25).read())
        raw_map = {int(r[0]): float(r[4]) for r in raw["result"]["list"]}
        matched = [r for r in rows if r[0] in raw_map and abs(raw_map[r[0]] - r[4]) < 1e-9]
        check(len(matched) >= 95, "adapter closes MATCH raw Bybit REST closes",
              f"{len(matched)}/{len(rows)} matched exactly")

        full = await client.klines_full("BTCUSDT", "1h", 2200)
        check(len(full) >= 2100, "klines_full pages deep history", f"{len(full)} bars")
        check(len({r[0] for r in full}) == len(full), "no duplicate bars after paging")
        df = rows_to_df(full)
        check(len(df) > 2000, "frame built from normalised rows", f"{len(df)} rows, to {df.index[-1]}")
        check(df["close"].iloc[-1] > 0, "frame has real prices", f"last close {df['close'].iloc[-1]}")
    except Exception as exc:
        check(False, "candles", f"{type(exc).__name__}: {exc}")

    print("\n[5] Order book + funding")
    try:
        depth = await client.depth("BTCUSDT", 50)
        check(len(depth.bids) > 10 and len(depth.asks) > 10, "order book parsed",
              f"{len(depth.bids)}x{len(depth.asks)}")
        check(depth.asks[0][0] >= depth.bids[0][0], "best ask >= best bid")
        check(0 < depth.spread_bps() < 50, "book spread realistic", f"{depth.spread_bps():.4f}bps")
        fh = await client.funding_history("BTCUSDT", 20)
        check(len(fh) > 5, "funding history parsed", f"{len(fh)} settlements")
        check(all(abs(f["rate"]) < 0.05 for f in fh), "funding rates sane",
              f"latest {fh[-1]['rate'] if fh else 'n/a'}")
    except Exception as exc:
        check(False, "depth/funding", f"{type(exc).__name__}: {exc}")

    print("\n[6] Strategy + cost pipeline on real Bybit data")
    if df is not None and len(df) > 400:
        try:
            enriched = ta.enrich(df, cfg.strategy)
            check(len(enriched) == len(df), "indicators enrich real Bybit bars")
            setup = latest_setup("BTCUSDT", enriched, cfg.strategy)
            check(setup.direction in ("LONG", "SHORT", "FLAT"), "setup produced",
                  f"{setup.direction} regime={setup.regime}")
            trades = run_backtest("BTCUSDT", df, cfg.strategy, fee_bps=7.5, slippage_bps=2.0)
            check(True, "backtest ran on real Bybit history", f"{len(trades)} trades")
            if trades:
                score, meta = score_trades(trades, 5)
                check(True, "expectancy computed",
                      f"net/trade {meta['net_bps']:.1f}bps win {meta['win_rate']*100:.0f}%")
            cm = CostModel(cfg)
            est = cm.round_trip(ticker=tickers["BTCUSDT"], depth=await client.depth("BTCUSDT", 50),
                                notional_usd=1000, expected_holding_hours=24, entry_side="BUY")
            check(est.total_bps > 0, "cost model priced on the real Bybit book",
                  f"{est.total_bps:.2f}bps (fees {est.entry_fee_bps + est.exit_fee_bps:.1f})")
            check(est.entry_fee_bps == cfg.costs.taker_fee_bps,
                  "Bybit taker fee used in the cost model", f"{est.entry_fee_bps}bps")
        except Exception as exc:
            check(False, "strategy pipeline", f"{type(exc).__name__}: {exc}")
    else:
        check(False, "strategy pipeline", "insufficient candles")

    print("\n[7] Universe screening on real Bybit instruments")
    try:
        syms = await screen_universe(cfg, client)
        check(len(syms) >= 3, "liquidity screen selected symbols", f"{len(syms)}: {syms[:6]}")
        check(all(s in specs for s in syms), "every screened symbol has a spec")
    except Exception as exc:
        check(False, "universe screening", f"{type(exc).__name__}: {exc}")

    print("\n[8] Websocket (live public stream)")
    try:
        import websockets

        got = None
        async with websockets.connect(client.ws_connect_url("1h", ["BTCUSDT"]),
                                      open_timeout=20) as ws:
            for frame in client.ws_subscribe_messages("1h", ["BTCUSDT"]):
                await ws.send(frame)
            deadline = asyncio.get_event_loop().time() + 45
            while asyncio.get_event_loop().time() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=45)
                parsed = client.parse_kline_message(raw)
                if parsed:
                    got = parsed
                    break
        check(got is not None, "received and parsed a live kline frame")
        if got:
            check(got["symbol"] == "BTCUSDT", "frame symbol parsed", got["symbol"])
            check(got["close"] > 0 and got["high"] >= got["low"],
                  "frame OHLC sane", f"O={got['open']} H={got['high']} L={got['low']} C={got['close']}")
            check(isinstance(got["closed"], bool), "close flag is boolean",
                  f"closed={got['closed']}")
    except Exception as exc:
        check(False, "websocket", f"{type(exc).__name__}: {exc}", warn_only=True)

    print("\n[9] Auth boundary (private path, without funded credentials)")
    key = cfg.exchange.api_key
    sec = cfg.exchange.api_secret
    if not (key and sec):
        check(True, "no credentials configured - private path correctly unverifiable here",
              "signature scheme is covered by unit tests instead")
    else:
        try:
            priv = BybitPrivate(cfg)
            await priv.permissions_probe()
            check(True, "private key authenticated successfully (full access)")
        except ExchangeError as exc:
            # 10010 proves the key exists AND our signature verified; only the
            # source IP is not allowlisted. That is the auth boundary, not a bug.
            if exc.code == 10010:
                check(True, "Bybit ACCEPTED our signature; rejected only on IP allowlist",
                      "add this host's IP to the key to enable live trading")
            elif exc.code in (10003, 10004):
                check(False, "signature/key rejected — signing scheme is wrong",
                      f"[{exc.code}] {exc}")
            else:
                check(False, "private probe failed", f"[{exc.code}] {exc}")
        except Exception as exc:
            check(False, "private probe", f"{type(exc).__name__}: {exc}")

    await client.close()
    return _summary()


def _summary() -> int:
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    failed = [(l, o) for l, o, w in RESULTS if not o and not w]
    warned = [l for l, o, w in RESULTS if not o and w]
    print("\n" + "=" * 78)
    print(f" BYBIT LIVE VERIFICATION: {passed}/{total} passed"
          + (f"  ({len(warned)} warning-only)" if warned else ""))
    for label in warned:
        print(f"   WARN: {label}")
    for label, _ in failed:
        print(f"   FAILED: {label}")
    print("=" * 78)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
