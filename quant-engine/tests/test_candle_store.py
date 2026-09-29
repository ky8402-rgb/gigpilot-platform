"""Candle store: venue isolation and schema migration.

Regression tests for a real bug: the store was keyed by (symbol, interval) with no
venue dimension, so after switching exchanges the same series contained Binance
bars spliced into Bybit bars. Two venues quote genuinely different prices for the
same instrument, so the resulting series existed on no real exchange — and every
indicator, backtest and edge estimate built on it was fiction.

Found by cross-checking the running service's candles against raw Bybit REST:
4 of the 10 most recent bars matched exactly, the rest were another venue's bars.
"""
import sqlite3

import pandas as pd
import pytest

from app.market import CandleStore, rows_to_df


def frame(closes, start="2024-01-01"):
    idx = pd.date_range(start, periods=len(closes), freq="1h", tz="UTC")
    return pd.DataFrame(
        {"open": closes, "high": closes, "low": closes, "close": closes,
         "volume": [1.0] * len(closes)},
        index=idx,
    )


def test_venues_are_isolated(tmp_path):
    db = tmp_path / "s.db"
    bybit = CandleStore(db, persist=True, venue="bybit")
    bybit.put_history("BTCUSDT", "1h", frame([100, 101, 102]))

    binance = CandleStore(db, persist=True, venue="binance")
    assert len(binance.load_from_db("BTCUSDT", "1h")) == 0, \
        "a different venue must not see another venue's candles"

    binance.put_history("BTCUSDT", "1h", frame([200, 201, 202]))
    # Each venue reads back only its own series.
    assert list(bybit.load_from_db("BTCUSDT", "1h")["close"]) == [100, 101, 102]
    assert list(binance.load_from_db("BTCUSDT", "1h")["close"]) == [200, 201, 202]


def test_same_key_different_venue_does_not_overwrite(tmp_path):
    """Identical (symbol, interval, ts) from two venues must coexist, not collide."""
    db = tmp_path / "s.db"
    a = CandleStore(db, persist=True, venue="bybit")
    b = CandleStore(db, persist=True, venue="binance")
    a.put_history("BTCUSDT", "1h", frame([100]))
    b.put_history("BTCUSDT", "1h", frame([999]))
    assert a.load_from_db("BTCUSDT", "1h")["close"].iloc[0] == 100
    assert b.load_from_db("BTCUSDT", "1h")["close"].iloc[0] == 999
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT COUNT(*) FROM candles").fetchone()[0] == 2


def test_in_memory_keys_are_namespaced_by_venue(tmp_path):
    db = tmp_path / "s.db"
    st = CandleStore(db, persist=True, venue="bybit")
    assert st._key("BTCUSDT", "1h") == "bybit:BTCUSDT:1h"
    other = CandleStore(db, persist=True, venue="binance")
    assert other._key("BTCUSDT", "1h") != st._key("BTCUSDT", "1h")


def test_legacy_schema_without_venue_is_dropped(tmp_path):
    """A pre-venue table cannot be repaired: nothing in the rows says which
    exchange wrote them, so it must be discarded and re-fetched."""
    db = tmp_path / "s.db"
    conn = sqlite3.connect(db)
    conn.execute(
        """CREATE TABLE candles (
               symbol TEXT NOT NULL, interval TEXT NOT NULL, ts INTEGER NOT NULL,
               open REAL, high REAL, low REAL, close REAL, volume REAL,
               PRIMARY KEY (symbol, interval, ts))"""
    )
    conn.execute("INSERT INTO candles VALUES ('BTCUSDT','1h',1000,1,1,1,1,1)")
    conn.execute("INSERT INTO candles VALUES ('ETHUSDT','1h',1000,2,2,2,2,2)")
    conn.commit()
    conn.close()

    store = CandleStore(db, persist=True, venue="bybit")
    cols = [r[1] for r in sqlite3.connect(db).execute("PRAGMA table_info(candles)")]
    assert "venue" in cols, "schema must be migrated to include the venue"
    rows = sqlite3.connect(db).execute("SELECT COUNT(*) FROM candles").fetchone()[0]
    assert rows == 0, "contaminated legacy history must be discarded"
    assert store.load_from_db("BTCUSDT", "1h").empty


def test_migration_is_idempotent(tmp_path):
    db = tmp_path / "s.db"
    s1 = CandleStore(db, persist=True, venue="bybit")
    s1.put_history("BTCUSDT", "1h", frame([1, 2, 3]))
    # Re-opening must not drop the (now venue-scoped) data.
    s2 = CandleStore(db, persist=True, venue="bybit")
    assert len(s2.load_from_db("BTCUSDT", "1h")) == 3


def test_null_venue_defaults_safely(tmp_path):
    st = CandleStore(tmp_path / "s.db", persist=True, venue="")
    assert st.venue == "unknown"


def test_no_persistence_still_works_in_memory():
    st = CandleStore(None, persist=False, venue="bybit")
    st.put_history("BTCUSDT", "1h", frame([1, 2]))
    assert len(st.frame("BTCUSDT", "1h")) == 2


def test_rows_to_df_accepts_normalised_rows():
    """The contract both adapters must satisfy: [ts, o, h, l, c, v]."""
    df = rows_to_df([[1000, 1.0, 2.0, 0.5, 1.5, 10.0],
                     [3600000, 1.5, 2.5, 1.0, 2.0, 20.0]])
    assert list(df["close"]) == [1.5, 2.0]
    assert df.index.is_monotonic_increasing


def test_rows_to_df_deduplicates_and_sorts():
    df = rows_to_df([[3600000, 1.5, 2.5, 1.0, 2.0, 20.0],
                     [1000, 1.0, 2.0, 0.5, 1.5, 10.0],
                     [1000, 1.0, 2.0, 0.5, 9.9, 10.0]])
    assert len(df) == 2
    assert df.index.is_monotonic_increasing
