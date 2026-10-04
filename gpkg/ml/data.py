"""Leakage-safe Bybit historical market-data ingestion.

Klines are fetched retrospectively from Bybit's public market API. Order-book liquidity is different:
Bybit's REST API exposes the current book, not a complete 90-day historical L2 tape. Therefore this
worker stores time-stamped snapshots as they are collected and the trainer refuses to qualify a model
unless the requested historical window has sufficient point-in-time liquidity coverage. It never
manufactures historical depth.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

import aiohttp

from gpkg.core.clock import now_ms
from gpkg.persistence.store import Store


BYBIT_MARKET = "https://api.bybit.com/v5/market"


@dataclass(frozen=True)
class Kline:
    ts_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    turnover: float


@dataclass(frozen=True)
class LiquiditySnapshot:
    ts_ms: int
    symbol: str
    bid: float
    ask: float
    bid_depth: float
    ask_depth: float
    bid_levels: tuple[tuple[float, float], ...]
    ask_levels: tuple[tuple[float, float], ...]
    volume_1m: float


class HistoricalDataWorker:
    def __init__(
        self,
        store: Store,
        *,
        symbols: tuple[str, ...] = ("BTCUSDT", "ETHUSDT"),
        days: int = 90,
        request_pause_s: float = 0.08,
    ):
        if days < 90:
            raise ValueError("minimum historical window is 90 days")
        self.store = store
        self.symbols = symbols
        self.days = days
        self.request_pause_s = max(0.0, request_pause_s)

    @staticmethod
    def _kline_rows(payload: dict) -> list[Kline]:
        result = payload.get("result", {}).get("list", []) or []
        out = []
        for row in result:
            if len(row) < 7:
                continue
            out.append(Kline(
                ts_ms=int(row[0]), open=float(row[1]), high=float(row[2]), low=float(row[3]),
                close=float(row[4]), volume=float(row[5]), turnover=float(row[6]),
            ))
        return out

    async def _get(self, session: aiohttp.ClientSession, path: str, params: dict) -> dict:
        async with session.get(f"{BYBIT_MARKET}/{path}", params=params) as resp:
            resp.raise_for_status()
            body = await resp.json()
            if body.get("retCode") != 0:
                raise RuntimeError(f"Bybit market API error: {body.get('retMsg', 'unknown')}")
            return body

    async def ingest_klines(self, symbol: str, *, end_ms: int | None = None) -> int:
        end_ms = int(end_ms or now_ms())
        start_ms = end_ms - self.days * 86_400_000
        cursor = end_ms
        count = 0
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            while cursor > start_ms:
                body = await self._get(session, "kline", {
                    "category": "linear", "symbol": symbol, "interval": "1",
                    "end": cursor, "limit": 1000,
                })
                rows = self._kline_rows(body)
                if not rows:
                    break
                oldest = min(r.ts_ms for r in rows)
                batch = []
                for row in rows:
                    if start_ms <= row.ts_ms <= end_ms:
                        batch.append((symbol, "kline_1m", row.ts_ms, {
                            "open": row.open, "high": row.high, "low": row.low,
                            "close": row.close, "volume": row.volume, "turnover": row.turnover,
                        }))
                self.store.ml_market_bulk_upsert(batch)
                count += len(batch)
                if oldest >= cursor:
                    break
                cursor = oldest - 1
                if self.request_pause_s:
                    await asyncio.sleep(self.request_pause_s)
        return count

    def ingest_liquidity_snapshot(self, snapshot: LiquiditySnapshot) -> None:
        """Persist one live/current L2 snapshot; timestamp is the only permitted ordering key."""
        self.store.ml_market_upsert(snapshot.symbol, "orderbook_l2", snapshot.ts_ms, {
            "bid": snapshot.bid, "ask": snapshot.ask,
            "bid_depth": snapshot.bid_depth, "ask_depth": snapshot.ask_depth,
            "bid_levels": list(snapshot.bid_levels), "ask_levels": list(snapshot.ask_levels),
            "volume_1m": snapshot.volume_1m,
        })

    async def collect_current_snapshot(self, symbol: str, *, limit: int = 50) -> LiquiditySnapshot:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
            body = await self._get(session, "orderbook", {
                "category": "linear", "symbol": symbol, "limit": limit,
            })
        data = body.get("result", {}) or {}
        bids = tuple((float(x[0]), float(x[1])) for x in data.get("b", []) if len(x) >= 2)
        asks = tuple((float(x[0]), float(x[1])) for x in data.get("a", []) if len(x) >= 2)
        if not bids or not asks:
            raise RuntimeError(f"empty order book for {symbol}")
        snap = LiquiditySnapshot(
            ts_ms=now_ms(), symbol=symbol, bid=bids[0][0], ask=asks[0][0],
            bid_depth=sum(p*q for p, q in bids), ask_depth=sum(p*q for p, q in asks),
            bid_levels=bids, ask_levels=asks, volume_1m=0.0,
        )
        self.ingest_liquidity_snapshot(snap)
        return snap

    async def collect_forever(
        self,
        interval_s: float = 60.0,
        stop: asyncio.Event | None = None,
        on_error: Callable[[str, Exception], Awaitable[None] | None] | None = None,
    ) -> None:
        stop = stop or asyncio.Event()
        while not stop.is_set():
            for symbol in self.symbols:
                try:
                    await self.collect_current_snapshot(symbol)
                except Exception as exc:
                    if on_error:
                        result = on_error(symbol, exc)
                        if asyncio.iscoroutine(result):
                            await result
            try:
                await asyncio.wait_for(stop.wait(), timeout=max(1.0, interval_s))
            except asyncio.TimeoutError:
                pass

    def coverage(self, symbol: str, *, end_ms: int | None = None) -> dict:
        end_ms = int(end_ms or now_ms())
        start_ms = end_ms - self.days * 86_400_000
        counts = self.store.ml_market_counts(symbol, start_ms, end_ms)
        expected = self.days * 1440
        return {
            "symbol": symbol,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "expected_1m_bars": expected,
            "kline_count": counts.get("kline_1m", 0),
            "liquidity_snapshot_count": counts.get("orderbook_l2", 0),
            "kline_coverage": counts.get("kline_1m", 0) / max(expected, 1),
        }

    def require_training_coverage(self, symbol: str, *, min_kline_coverage: float = 0.98,
                                   min_liquidity_snapshots: int = 10000) -> dict:
        report = self.coverage(symbol)
        if report["kline_coverage"] < min_kline_coverage:
            raise RuntimeError(
                f"{symbol}: insufficient 1m history {report['kline_coverage']:.3%}; "
                f"requires {min_kline_coverage:.3%} over {self.days} days"
            )
        if report["liquidity_snapshot_count"] < min_liquidity_snapshots:
            raise RuntimeError(
                f"{symbol}: insufficient historical L2 snapshots "
                f"{report['liquidity_snapshot_count']} < {min_liquidity_snapshots}; "
                "historical depth is not fabricated"
            )
        return report


def align_point_in_time(klines: list[dict], snapshots: list[dict]) -> list[dict]:
    """As-of join: snapshot timestamp must be <= the bar timestamp; future depth is rejected."""
    bars = sorted(klines, key=lambda x: int(x["ts_ms"]))
    books = sorted(snapshots, key=lambda x: int(x["ts_ms"]))
    out = []
    j = 0
    current = None
    for bar in bars:
        ts = int(bar["ts_ms"])
        while j < len(books) and int(books[j]["ts_ms"]) <= ts:
            current = books[j]
            j += 1
        if current is None:
            continue
        if int(current["ts_ms"]) > ts:
            raise ValueError("point-in-time alignment would use future liquidity")
        out.append({**bar, "book": current})
    return out
