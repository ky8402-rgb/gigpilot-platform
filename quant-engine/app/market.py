"""Market data: candle store, websocket streaming feed, REST fallback.

Design notes
------------
* Only **closed** candles are ever handed to the strategy. The in-progress bar is
  tracked separately as `last_price` for display and for stop/target checks, so we
  can never make a decision on a bar that has not finished forming.
* The feed is self-healing: if the websocket dies it reconnects with exponential
  backoff, and an independent REST poller keeps the store fresh regardless.
* Everything is timestamped so staleness can be detected and trading halted.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import pandas as pd

from .exchange import BinanceFutures, ExchangeError, Ticker
from .logging_setup import get_logger

log = get_logger("market")

OHLCV_COLS = ["ts", "open", "high", "low", "close", "volume"]


def rows_to_df(rows: List[List[Any]]) -> pd.DataFrame:
    """Binance kline payload -> OHLCV frame indexed by UTC timestamp."""
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame(
        [
            {
                "ts": int(r[0]),
                "open": float(r[1]),
                "high": float(r[2]),
                "low": float(r[3]),
                "close": float(r[4]),
                "volume": float(r[5]),
            }
            for r in rows
        ]
    )
    df = df.drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
    df["time"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df.set_index("time")


class CandleStore:
    """In-memory OHLCV per (venue, symbol, interval) with SQLite persistence.

    The VENUE is part of the key, and that is not cosmetic. Two exchanges quote
    different prices for the same instrument (basis, different books), so storing
    both under `(symbol, interval)` silently splices one venue's bars into the
    other's series. Indicators and backtests then run on a price series that never
    existed on any real exchange, which manufactures edges out of nothing.
    """

    def __init__(self, db_path: Optional[Path] = None, persist: bool = True,
                 venue: str = "unknown"):
        self._data: Dict[str, pd.DataFrame] = {}
        self._persist = persist
        self.venue = (venue or "unknown").lower()
        self.db_path = Path(db_path) if db_path else None
        self._conn: Optional[sqlite3.Connection] = None
        if self._persist and self.db_path:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._migrate_legacy_schema()
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS candles (
                       venue TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL,
                       ts INTEGER NOT NULL,
                       open REAL, high REAL, low REAL, close REAL, volume REAL,
                       PRIMARY KEY (venue, symbol, interval, ts))"""
            )
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_candles_lookup "
                "ON candles(venue, symbol, interval, ts)"
            )
            self._conn.commit()

    def _migrate_legacy_schema(self) -> None:
        """Drop a pre-venue candles table.

        A schema without a venue column cannot be repaired, because the rows it
        holds may already be a mixture of several exchanges and nothing in the data
        says which. Re-fetching history is cheap; trading on contaminated bars is
        not, so we discard and re-download.
        """
        assert self._conn is not None
        try:
            cols = [r[1] for r in self._conn.execute("PRAGMA table_info(candles)")]
        except sqlite3.Error:
            return
        if not cols:
            return
        if "venue" not in cols:
            n = self._conn.execute("SELECT COUNT(*) FROM candles").fetchone()[0]
            log.warning(
                "candle schema has no venue column — dropping contaminated history",
                extra={"rows_discarded": n, "note": "history will be re-fetched per venue"},
            )
            self._conn.execute("DROP TABLE candles")
            self._conn.commit()

    def _key(self, symbol: str, interval: str) -> str:
        return f"{self.venue}:{symbol}:{interval}"

    def put_history(self, symbol: str, interval: str, df: pd.DataFrame) -> None:
        key = self._key(symbol, interval)
        self._data[key] = df
        if self._conn is not None and not df.empty:
            try:
                self._conn.executemany(
                    "INSERT OR REPLACE INTO candles VALUES (?,?,?,?,?,?,?,?,?)",
                    [
                        (self.venue, symbol, interval, int(t.timestamp() * 1000),
                         float(r.open), float(r.high), float(r.low),
                         float(r.close), float(r.volume))
                        for t, r in df.iterrows()
                    ],
                )
                self._conn.commit()
            except sqlite3.Error as exc:  # persistence is best-effort, never fatal
                log.warning("candle persist failed", extra={"error": str(exc)})

    def upsert(self, symbol: str, interval: str, row: Dict[str, float], closed: bool) -> None:
        """Apply one live kline tick. Only closed bars are appended."""
        key = self._key(symbol, interval)
        df = self._data.get(key)
        if df is None or df.empty:
            return
        ts_ms = int(row["ts"])
        ts = pd.to_datetime(ts_ms, unit="ms", utc=True)
        if ts in df.index:
            if closed:
                df.loc[ts, ["open", "high", "low", "close", "volume"]] = [
                    row["open"], row["high"], row["low"], row["close"], row["volume"]
                ]
            else:
                # Update the forming bar's extremes in place (kept out of the
                # strategy's view by `closed_frame`).
                df.loc[ts, ["high", "low", "close", "volume"]] = [
                    max(row["high"], float(df.loc[ts, "high"])),
                    min(row["low"], float(df.loc[ts, "low"])),
                    row["close"], row["volume"],
                ]
        elif closed:
            new = pd.DataFrame(
                [{**row, "time": ts}], columns=["time", *OHLCV_COLS[1:]]
            ).set_index("time")
            self._data[key] = pd.concat([df, new])

    def frame(self, symbol: str, interval: str, closed_only: bool = True) -> pd.DataFrame:
        df = self._data.get(self._key(symbol, interval))
        if df is None or df.empty:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        if closed_only:
            now_ms = int(time.time() * 1000)
            iv = _interval_ms(interval)
            # Drop a bar whose window has not elapsed.
            if not df.empty and (int(df.index[-1].timestamp() * 1000) + iv) > now_ms:
                return df.iloc[:-1]
        return df

    def last_ts_ms(self, symbol: str, interval: str) -> int:
        df = self._data.get(self._key(symbol, interval))
        if df is None or df.empty:
            return 0
        return int(df.index[-1].timestamp() * 1000)

    def symbols(self) -> List[str]:
        return sorted({k.split(":")[0] for k in self._data})

    def load_from_db(self, symbol: str, interval: str, limit: int = 5000) -> pd.DataFrame:
        """Load this VENUE's history only. Mixing venues corrupts the series."""
        if self._conn is None:
            return pd.DataFrame()
        cur = self._conn.execute(
            "SELECT ts,open,high,low,close,volume FROM candles "
            "WHERE venue=? AND symbol=? AND interval=? ORDER BY ts DESC LIMIT ?",
            (self.venue, symbol, interval, limit),
        )
        rows = cur.fetchall()
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows, columns=OHLCV_COLS).sort_values("ts")
        df["time"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
        return df.set_index("time")[["open", "high", "low", "close", "volume"]]


@dataclass
class FeedHealth:
    connected: bool = False
    last_message_ts: float = 0.0
    reconnects: int = 0
    errors: int = 0
    last_error: str = ""
    rest_polls: int = 0
    subscriptions: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        age = (time.time() - self.last_message_ts) if self.last_message_ts else None
        return {
            "connected": self.connected,
            "last_message_age_s": round(age, 1) if age is not None else None,
            "reconnects": self.reconnects,
            "errors": self.errors,
            "last_error": self.last_error,
            "rest_polls": self.rest_polls,
            "subscriptions": list(self.subscriptions),
        }


class MarketFeed:
    """Owns ticker state + websocket kline streaming + REST reconciliation."""

    def __init__(self, cfg, client: BinanceFutures, store: CandleStore):
        self.cfg = cfg
        self.client = client
        self.store = store
        self.tickers: Dict[str, Ticker] = {}
        self.last_price: Dict[str, float] = {}
        self.health = FeedHealth()
        self._symbols: List[str] = []
        self._interval = cfg.data.primary_interval
        self._running = False
        self._tasks: List[asyncio.Task] = []
        self._on_update: List[Callable[[str], None]] = []
        self._lock = asyncio.Lock()

    # -- lifecycle ---------------------------------------------------------
    def subscribe_updates(self, cb: Callable[[str], None]) -> None:
        self._on_update.append(cb)

    def _notify(self, symbol: str) -> None:
        for cb in self._on_update:
            try:
                cb(symbol)
            except Exception as exc:  # a bad subscriber must not kill the feed
                log.warning("update callback failed", extra={"error": str(exc)})

    async def start(self, symbols: List[str]) -> None:
        self._symbols = list(symbols)
        self._running = True
        await self.bootstrap()
        if self.cfg.data.ws_enabled:
            self._tasks.append(asyncio.create_task(self._ws_loop(), name="ws"))
        self._tasks.append(asyncio.create_task(self._rest_loop(), name="rest"))
        self._tasks.append(asyncio.create_task(self._ticker_loop(), name="tickers"))

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        self.health.connected = False

    async def bootstrap(self) -> None:
        """Warm up candles from REST (and the local DB when available)."""
        for sym in self._symbols:
            try:
                need = self.cfg.data.history_bars
                df = self.store.load_from_db(sym, self._interval, need)
                have = len(df)
                if have < need:
                    # Cold start (or a venue switch): fetch the full window.
                    rows = await self.client.klines_full(sym, self._interval, need)
                    df = rows_to_df(rows)
                else:
                    # Warm start: always re-pull the recent tail. Loading purely from
                    # the DB would leave a gap for every bar missed while the process
                    # was down, and a gap silently distorts every indicator.
                    tail = min(need, 500)
                    rows = await self.client.klines(sym, self._interval, limit=tail)
                    if rows:
                        fresh = rows_to_df(rows)
                        merged = pd.concat([df, fresh])
                        merged = merged[~merged.index.duplicated(keep="last")].sort_index()
                        df = merged.tail(need)
                self.store.put_history(sym, self._interval, df)
                log.info("history loaded", extra={"symbol": sym, "bars": len(df),
                                                 "from_db": have >= need})
            except ExchangeError as exc:
                self.health.errors += 1
                self.health.last_error = str(exc)
                log.error("history bootstrap failed", extra={"symbol": sym, "error": str(exc)})
            await asyncio.sleep(0.15)

    # -- REST reconcile ----------------------------------------------------
    async def _rest_loop(self) -> None:
        interval = self.cfg.data.rest_poll_seconds
        while self._running:
            try:
                await asyncio.sleep(interval)
                await self.refresh_rest()
            except asyncio.CancelledError:
                return
            except Exception as exc:  # keep the loop alive no matter what
                self.health.errors += 1
                self.health.last_error = str(exc)
                log.warning("rest loop error", extra={"error": str(exc)})
                await asyncio.sleep(5)

    async def refresh_rest(self) -> None:
        """Pull the last few candles per symbol and heal any gaps."""
        iv_ms = _interval_ms(self._interval)
        now_ms = int(time.time() * 1000)
        for sym in self._symbols:
            try:
                rows = await self.client.klines(sym, self._interval, limit=5)
                for r in rows:
                    # Derive closure from the bar window rather than reading a
                    # venue-specific close-time column (Binance has one, Bybit
                    # does not, so index 6 raised IndexError on Bybit).
                    closed = (int(r[0]) + iv_ms) <= now_ms
                    self.store.upsert(
                        sym, self._interval,
                        {"ts": int(r[0]), "open": float(r[1]), "high": float(r[2]),
                         "low": float(r[3]), "close": float(r[4]), "volume": float(r[5])},
                        closed=closed,
                    )
                if rows:
                    self.last_price[sym] = float(rows[-1][4])
                self.health.rest_polls += 1
                self.health.last_message_ts = time.time()
                self._notify(sym)
            except ExchangeError as exc:
                self.health.errors += 1
                self.health.last_error = str(exc)
            await asyncio.sleep(0.12)

    # -- tickers -----------------------------------------------------------
    async def _ticker_loop(self) -> None:
        while self._running:
            try:
                prem = await self.client.premium_index()
                tickers = await self.client.tickers_24h()
                for sym in self._symbols:
                    t = tickers.get(sym)
                    if t is None:
                        continue
                    p = prem.get(sym, {})
                    t.mark_price = p.get("mark_price", t.last)
                    t.index_price = p.get("index_price", 0.0)
                    t.funding_rate = p.get("funding_rate", 0.0)
                    t.next_funding_ts = int(p.get("next_funding_ts", 0))
                    self.tickers[sym] = t
                    if t.last > 0:
                        self.last_price[sym] = t.last
                self.health.last_message_ts = time.time()
                self._notify("__tickers__")
            except Exception as exc:
                self.health.errors += 1
                self.health.last_error = str(exc)
                log.warning("ticker loop error", extra={"error": str(exc)})
            await asyncio.sleep(10)

    async def refresh_book_ticker(self) -> None:
        """Cheap fast loop for spreads used by the entry cost check."""
        for sym in self._symbols:
            try:
                t = await self.client.book_ticker(sym)
                prev = self.tickers.get(sym)
                if prev is not None:
                    t.quote_volume_24h = prev.quote_volume_24h
                    t.price_change_pct_24h = prev.price_change_pct_24h
                self.tickers[sym] = t
            except ExchangeError:
                pass

    async def depth(self, symbol: str) -> Optional[Any]:
        try:
            return await self.client.depth(symbol, self.cfg.exchange.depth_levels)
        except ExchangeError as exc:
            log.warning("depth fetch failed", extra={"symbol": symbol, "error": str(exc)})
            return None

    # -- websocket ---------------------------------------------------------
    async def _heartbeat(self, ws, message: str, interval: float) -> None:
        """Application-level heartbeat (Bybit requires one; Binance does not)."""
        try:
            while self._running:
                await asyncio.sleep(interval)
                await ws.send(message)
        except asyncio.CancelledError:
            return
        except Exception as exc:
            log.debug("heartbeat stopped", extra={"error": str(exc)})

    async def _ws_loop(self) -> None:
        """Stream klines. Reconnects forever with capped exponential backoff.

        Venue-agnostic: the adapter supplies the URL, the subscribe frames, the
        heartbeat and the frame parser, so this loop contains no venue specifics.
        """
        import websockets

        adapter = self.client
        backoff = 1.0
        while self._running:
            hb_task = None
            try:
                url = adapter.ws_connect_url(self._interval, self._symbols)
                async with websockets.connect(
                    url, ping_interval=20, ping_timeout=20, close_timeout=5,
                    max_queue=2000,
                ) as ws:
                    for frame in adapter.ws_subscribe_messages(self._interval, self._symbols):
                        await ws.send(frame)
                    hb = adapter.ws_heartbeat_message()
                    if hb:
                        hb_task = asyncio.create_task(
                            self._heartbeat(ws, hb, adapter.ws_heartbeat_interval())
                        )
                    self.health.connected = True
                    self.health.subscriptions = [f"{s}@{self._interval}" for s in self._symbols]
                    backoff = 1.0
                    log.info("websocket connected", extra={"streams": len(self._symbols),
                                                          "venue": self.cfg.exchange.name})
                    async for raw in ws:
                        if not self._running:
                            break
                        parsed = adapter.parse_kline_message(raw)
                        if not parsed:
                            continue
                        sym = parsed["symbol"]
                        self.store.upsert(
                            sym, self._interval,
                            {"ts": parsed["ts"], "open": parsed["open"], "high": parsed["high"],
                             "low": parsed["low"], "close": parsed["close"],
                             "volume": parsed["volume"]},
                            closed=parsed["closed"],
                        )
                        self.last_price[sym] = parsed["close"]
                        self.health.last_message_ts = time.time()
                        if parsed["closed"]:
                            self._notify(sym)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.health.connected = False
                self.health.reconnects += 1
                self.health.errors += 1
                self.health.last_error = f"ws: {exc}"
                log.warning(
                    "websocket dropped, reconnecting",
                    extra={"error": str(exc), "backoff_s": round(backoff, 1),
                           "reconnects": self.health.reconnects},
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2.0, 60.0)
            finally:
                if hb_task is not None:
                    hb_task.cancel()
        self.health.connected = False

    # -- staleness ---------------------------------------------------------
    def feed_age_s(self) -> Optional[float]:
        if not self.health.last_message_ts:
            return None
        return time.time() - self.health.last_message_ts

    def is_stale(self) -> bool:
        age = self.feed_age_s()
        return age is None or age > self.cfg.health.stale_feed_halt_s

    def data_ok(self) -> bool:
        age = self.feed_age_s()
        return age is not None and age <= self.cfg.risk.max_data_age_s


_INTERVAL_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
    "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000,
}


def _interval_ms(interval: str) -> int:
    return _INTERVAL_MS.get(interval, 3_600_000)


async def screen_universe(cfg, client: BinanceFutures) -> List[str]:
    """Auto-select the most liquid perpetuals that pass the configurable floors."""
    specs = await client.exchange_info()
    tickers = await client.tickers_24h()
    if cfg.universe.symbols:
        return [s for s in cfg.universe.symbols if s in specs][: cfg.universe.max_symbols]

    exclusions = {b.upper() for b in cfg.universe.exclude_bases}
    quote = cfg.universe.quote
    ranked = []
    for sym, t in tickers.items():
        spec = specs.get(sym)
        if spec is None:
            continue
        base = sym[: -len(quote)] if sym.endswith(quote) else sym
        if base.upper() in exclusions:
            continue
        if t.quote_volume_24h < cfg.universe.min_24h_quote_volume:
            continue
        if t.last <= 0:
            continue
        ranked.append((t.quote_volume_24h, sym))
    ranked.sort(reverse=True)
    chosen = [s for _, s in ranked[: cfg.universe.max_symbols]]
    log.info("universe screened", extra={"count": len(chosen), "symbols": chosen})
    return chosen
