#!/usr/bin/env python3
"""THE CANDLE / QUOTE CONTRACT — `snapshot()` must emit what the terminal actually reads.

Regression origin
-----------------
`FuturesCommandCenter` renders Bid, Ask and an OHLC chart from `markets[].bid`, `markets[].ask` and
`markets[].candles`. The snapshot emitted NONE of the three — only `mid`, `mark`, `last` and
`spread_bps` — so the quote row read "—" and the chart read "Live candles unavailable" permanently,
while the L2 book and the `kline.1` stream supplying them were both live in the same process. Nothing
raised: a missing key and a genuinely absent market look identical on screen.

These tests pin BOTH sides of the contract, because testing either alone is what let this ship.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.market.state import MarketState  # noqa: E402


def _bar(start, o, h, l, c):
    return {"start": start, "open": o, "high": h, "low": l, "close": c, "confirm": False}


def test_a_forming_bar_is_upserted_not_appended():
    """Bybit re-sends the forming bar on every update. Appending would fill the chart with one minute
    repeated hundreds of times — a chart that looks populated and is wrong."""
    ms = MarketState(symbol="BTCUSDT")
    ms.apply_kline(_bar(60_000, 100.0, 105.0, 99.0, 101.0))
    assert len(ms.candles_1m) == 1
    ms.apply_kline(_bar(60_000, 100.0, 108.0, 98.0, 107.0))  # same minute, moved
    assert len(ms.candles_1m) == 1, "the forming bar was appended instead of upserted"
    assert ms.candles_1m[0]["h"] == 108.0 and ms.candles_1m[0]["c"] == 107.0


def test_a_new_minute_appends_exactly_once():
    ms = MarketState(symbol="BTCUSDT")
    for i in range(3):
        ms.apply_kline(_bar(60_000 * (i + 1), 100.0, 101.0, 99.0, 100.5))
    assert [b["t"] for b in ms.candles_1m] == [60_000, 120_000, 180_000]


def test_an_out_of_order_replay_replaces_its_slot_and_keeps_order():
    ms = MarketState(symbol="BTCUSDT")
    for i in range(3):
        ms.apply_kline(_bar(60_000 * (i + 1), 100.0, 101.0, 99.0, 100.0))
    ms.apply_kline(_bar(60_000, 100.0, 102.0, 98.0, 101.5))  # replayed older bar
    assert [b["t"] for b in ms.candles_1m] == [60_000, 120_000, 180_000], "series lost its ordering"
    assert ms.candles_1m[0]["c"] == 101.5, "the replayed bar did not replace its own slot"


def test_unusable_bars_are_ignored_rather_than_plotted():
    """A partial bar is worse than a missing one: it renders as real price history."""
    ms = MarketState(symbol="BTCUSDT")
    ms.apply_kline({"start": 0, "open": 1, "high": 1, "low": 1, "close": 1})
    ms.apply_kline({"start": 60_000, "open": 0, "high": 0, "low": 0, "close": 0})
    ms.apply_kline({"start": 60_000, "close": 0})
    ms.apply_kline({"start": "not-a-time", "open": 1, "high": 1, "low": 1, "close": 1})
    assert list(ms.candles_1m) == []


def test_best_bid_and_ask_come_from_the_book():
    ms = MarketState(symbol="BTCUSDT")
    assert ms.best_bid == 0.0 and ms.best_ask == 0.0  # honest emptiness, not a guess
    ms.apply_book_snapshot([["100.0", "5"], ["99.5", "9"]], [["100.5", "3"], ["101.0", "7"]])
    assert ms.best_bid == 100.0 and ms.best_ask == 100.5


def test_snapshot_emits_bid_ask_and_candles(make_engine):
    """The cross-side assertion: what the backend PRODUCES must include what the UI READS."""
    engine, _ = make_engine(symbols=["BTCUSDT"])
    ms = engine.markets["BTCUSDT"]
    ms.apply_book_snapshot([["100.0", "5"]], [["100.5", "3"]])
    ms.apply_kline(_bar(60_000, 100.0, 101.0, 99.0, 100.5))

    entry = next(m for m in engine.snapshot()["markets"] if m["symbol"] == "BTCUSDT")
    for key in ("bid", "ask", "candles"):
        assert key in entry, f"snapshot() still omits `{key}`, which the terminal reads"
    assert entry["bid"] == 100.0 and entry["ask"] == 100.5
    assert entry["candles"] == [{"t": 60_000, "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.5}]
