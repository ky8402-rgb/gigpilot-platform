"""Leakage-safe Bybit historical market-data ingestion.

Klines are fetched retrospectively from Bybit's public market API. Order-book liquidity is different:
Bybit's REST API exposes the current book, not a complete 90-day historical L2 tape. Therefore this
worker stores time-stamped snapshots as they are collected and the trainer refuses to qualify a model
unless the requested historical window has sufficient point-in-time liquidity coverage. It never
manufactures historical depth.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

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


# Bybit signals throttling TWO different ways, and both must be handled or a long collection dies
# mid-run:
#   * HTTP 429 (occasionally 403) with an optional `Retry-After` header
#   * HTTP 200 carrying a non-zero `retCode` of 10006 ("Too many visits")
# This matters more here than in most clients: L2 depth is FORWARD-ONLY. Bybit publishes no historical
# order book, so depth that is not captured as it happens cannot be re-fetched later at any price. A
# throttle that ends a collection run therefore destroys the data permanently rather than delaying it.
# How many L2 snapshots per symbol the training gate demands. ONE definition: the gate, the CLI's
# ETA projection and the tests all read this, so they cannot drift apart.
L2_REQUIRED = 10_000

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
RETRYABLE_RET_CODES = frozenset({10006})


class RateLimitedError(RuntimeError):
    """Retries were exhausted against a throttled/unavailable venue.

    Distinct from a malformed request, which will never succeed and is raised immediately: the two
    need different operator responses, and a slow failure would hide the real error.
    """


class InsufficientDataError(RuntimeError):
    """Raised when the historical depth a run REQUIRES is not present.

    Its own type, not a bare RuntimeError, for one reason: "there is no data" and "the model failed"
    are different operational states with different remedies, and a generic exception made them
    indistinguishable in the log. A tournament that ran over an empty database printed a confident
    `evaluated=35 admitted=0` — which reads as a rigorous negative result and was actually a verdict
    over nothing. Callers can now surface INSUFFICIENT_DATA explicitly.
    """


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

    @staticmethod
    def _backoff_s(retry_after: str | None, attempt: int, *, cap_s: float = 30.0) -> float:
        """Exponential backoff, honouring `Retry-After` when the venue supplies it.

        The venue's own instruction WINS: it knows when the budget resets, and a guessed backoff that
        is too short just spends another 429. Capped so one throttled call cannot stall a collection
        run indefinitely.
        """
        if retry_after:
            try:
                return min(max(0.0, float(str(retry_after).strip())), cap_s)
            except (TypeError, ValueError):
                pass  # HTTP-date form or junk: fall back to exponential
        return min(0.5 * (2 ** (attempt - 1)), cap_s)

    async def _get(self, session: aiohttp.ClientSession, path: str, params: dict,
                   *, max_attempts: int = 5) -> dict:
        """GET with BOUNDED retries against throttling and transient transport failure.

        Tested directly despite being private: this method is the durability of forward-only market
        data, and a retry policy is exactly the kind of code that looks correct and fails at 3am.
        """
        last = "no attempt made"
        for attempt in range(1, max_attempts + 1):
            delay = self._backoff_s(None, attempt)
            try:
                async with session.get(f"{BYBIT_MARKET}/{path}", params=params) as resp:
                    if resp.status in RETRYABLE_STATUS:
                        last = f"HTTP {resp.status}"
                        delay = self._backoff_s(resp.headers.get("Retry-After"), attempt)
                    elif resp.status >= 400:
                        # Any other 4xx is a request this code built wrong. Retrying cannot fix it.
                        raise RuntimeError(f"Bybit market HTTP {resp.status} for {path}")
                    else:
                        body = await resp.json()
                        ret_code = body.get("retCode")
                        if ret_code == 0:
                            return body
                        if ret_code not in RETRYABLE_RET_CODES:
                            raise RuntimeError(
                                f"Bybit market API error: {body.get('retMsg', 'unknown')}")
                        last = f"retCode {ret_code}: {body.get('retMsg')}"
            except aiohttp.ClientResponseError as exc:
                last = f"HTTP {exc.status}"  # aiohttp raised before we could inspect the body
                if exc.status not in RETRYABLE_STATUS:
                    raise RuntimeError(f"Bybit market HTTP {exc.status} for {path}") from exc
            except aiohttp.ClientError as exc:
                last = f"{type(exc).__name__}: {exc}"  # transient transport failure
            if attempt == max_attempts:
                break
            await asyncio.sleep(delay)
        raise RateLimitedError(f"{path}: giving up after {max_attempts} attempts (last: {last})")

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

    async def ingest_funding_history(self, symbol: str, *, end_ms: int | None = None) -> int:
        """Persist Bybit's historical 8-hour funding observations."""
        end_ms = int(end_ms or now_ms()); start_ms = end_ms - self.days * 86_400_000
        cursor = end_ms; count = 0
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            while cursor >= start_ms:
                body = await self._get(session, "funding/history", {"category":"linear","symbol":symbol,"endTime":cursor,"limit":200})
                rows = body.get("result", {}).get("list", []) or []
                if not rows: break
                oldest = cursor; batch = []
                for row in rows:
                    ts = int(row.get("fundingRateTimestamp") or row.get("fundingTime") or 0)
                    if start_ms <= ts <= end_ms and ts > 0:
                        oldest = min(oldest, ts)
                        rate = float(row.get("fundingRate", 0.0))
                        batch.append((symbol,"funding_8h",ts,{"funding_rate":rate,"funding_bps":rate*1e4}))
                self.store.ml_market_bulk_upsert(batch); count += len(batch)
                if oldest >= cursor: break
                cursor = oldest - 1
                if self.request_pause_s: await asyncio.sleep(self.request_pause_s)
        return count

    async def ingest_basis_history(self, symbol: str, *, end_ms: int | None = None) -> int:
        """Persist one-minute perp-vs-index basis with the index observation at the same timestamp."""
        end_ms = int(end_ms or now_ms()); start_ms = end_ms - self.days * 86_400_000
        cursor = end_ms; count = 0
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            while cursor > start_ms:
                perp_body = await self._get(session, "kline", {"category":"linear","symbol":symbol,"interval":"1","end":cursor,"limit":1000})
                index_body = await self._get(session, "index-price-kline", {"category":"linear","symbol":symbol,"interval":"1","end":cursor,"limit":1000})
                perp = {int(r[0]):float(r[4]) for r in perp_body.get("result",{}).get("list",[]) or [] if len(r)>=5}
                index = {int(r[0]):float(r[4]) for r in index_body.get("result",{}).get("list",[]) or [] if len(r)>=5}
                timestamps = sorted(set(perp).intersection(index))
                if not timestamps: break
                oldest = min(timestamps); batch=[]
                for ts in timestamps:
                    if start_ms <= ts <= end_ms and index[ts] > 0:
                        batch.append((symbol,"basis_1m",ts,{"perp_close":perp[ts],"index_close":index[ts],"basis_bps":(perp[ts]/index[ts]-1.0)*1e4}))
                self.store.ml_market_bulk_upsert(batch); count += len(batch)
                if oldest >= cursor: break
                cursor = oldest - 1
                if self.request_pause_s: await asyncio.sleep(self.request_pause_s)
        return count

    async def ingest_funding_and_basis(self, symbol: str, *, end_ms: int | None = None) -> tuple[int,int]:
        return await self.ingest_funding_history(symbol,end_ms=end_ms), await self.ingest_basis_history(symbol,end_ms=end_ms)

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
        funding = self.store.ml_market_range(symbol, "funding_8h", start_ms, end_ms)
        basis = self.store.ml_market_range(symbol, "basis_1m", start_ms, end_ms)
        l2 = self.store.ml_market_buffer_stats_for_symbol(symbol, "orderbook_l2")
        return {
            "symbol": symbol, "start_ms": start_ms, "end_ms": end_ms,
            "expected_1m_bars": expected, "kline_count": counts.get("kline_1m", 0),
            "liquidity_snapshot_count": counts.get("orderbook_l2", 0),
            "kline_coverage": counts.get("kline_1m", 0) / max(expected, 1),
            "funding_count": len(funding), "basis_count": len(basis),
            "l2_span_ms": int(l2.get("span_ms", 0)),
            "l2_48h_ready": int(l2.get("span_ms", 0)) >= 48 * 3_600_000,
        }

    def require_training_coverage(self, symbol: str, *, min_kline_coverage: float = 0.98,
                                   min_liquidity_snapshots: int = L2_REQUIRED) -> dict:
        report = self.coverage(symbol)
        if report["kline_coverage"] < min_kline_coverage:
            raise InsufficientDataError(
                f"{symbol}: insufficient 1m history {report['kline_coverage']:.3%}; "
                f"requires {min_kline_coverage:.3%} over {self.days} days"
            )
        if report["liquidity_snapshot_count"] < min_liquidity_snapshots:
            raise InsufficientDataError(
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
