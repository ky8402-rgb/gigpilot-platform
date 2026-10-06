"""Real-time micro-structure and L2 orderbook state for a linear perpetual market.

Tracks:
  - L2 orderbook bids/asks with incremental delta updates and snapshots.
  - Microstructure depth notional and orderbook imbalance.
  - Short-term trade momentum from execution feed.
  - Rolling 1-minute close prices and ATR (basis points).
  - Ticker prices (last, mark, index) and funding rates.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Deque

from gpkg.core.clock import f, now_ms


@dataclass
class MarketState:
    symbol: str
    bids: list = field(default_factory=list)
    asks: list = field(default_factory=list)
    last: float = 0.0
    mark: float = 0.0
    index: float = 0.0
    funding_rate: float = 0.0
    next_funding_ms: int = 0
    trades: Deque = field(default_factory=lambda: deque(maxlen=512))
    closes_1m: Deque = field(default_factory=lambda: deque(maxlen=200))
    #: Real 1-minute OHLC bars, upserted from the venue's `kline.1` stream.
    #:
    #: The terminal's chart reads `markets[].candles`, which the snapshot never emitted, so it showed
    #: "Live candles unavailable" permanently while the venue was streaming bars the whole time.
    #: Only OHLC is kept — never a level the venue did not send. `closes_1m` alone could not fill a
    #: candle: deriving open/high/low from successive closes would be inventing price history.
    candles_1m: Deque = field(default_factory=lambda: deque(maxlen=200))
    ts_book_ms: int = 0
    ts_tick_ms: int = 0

    @property
    def mid(self) -> float:
        if not self.bids or not self.asks:
            return 0.0
        return (self.bids[0][0] + self.asks[0][0]) / 2.0

    @property
    def spread_bps(self) -> float:
        if not self.bids or not self.asks:
            return float("inf")
        m = self.mid
        return float("inf") if m <= 0 else (self.asks[0][0] - self.bids[0][0]) / m * 1e4

    @property
    def best_bid(self) -> float:
        return self.bids[0][0] if self.bids else 0.0

    @property
    def best_ask(self) -> float:
        return self.asks[0][0] if self.asks else 0.0

    def apply_kline(self, row: dict) -> None:
        """Upsert one 1-minute bar from the venue's kline feed.

        UPSERT, keyed on the bar's start time, and that is the whole point. Bybit re-sends the bar that
        is still forming on every update, so appending would fill this ring with hundreds of copies of
        a single minute and the chart would show one bar repeated. Re-keying on `start` lets the live
        bar refresh in place and a new one append exactly once.

        Returns without touching state if the bar is unusable (no start, no close), because a partial
        bar is worse than a missing one: it would be plotted as real price history.
        """
        try:
            t_ms = int(f(row.get("start")) or 0)
        except (TypeError, ValueError):
            return
        o, h, l, c = (f(row.get("open")), f(row.get("high")), f(row.get("low")), f(row.get("close")))
        if t_ms <= 0 or c <= 0 or o <= 0 or h <= 0 or l <= 0:
            return
        bar = {"t": t_ms, "o": o, "h": h, "l": l, "c": c}
        if self.candles_1m and self.candles_1m[-1].get("t") == t_ms:
            self.candles_1m[-1] = bar
        elif not self.candles_1m or t_ms > self.candles_1m[-1].get("t", 0):
            self.candles_1m.append(bar)
        else:
            # An out-of-order bar (a replayed snapshot) replaces its own slot rather than being
            # appended, so the series stays sorted and non-duplicated.
            for i in range(len(self.candles_1m) - 1, -1, -1):
                if self.candles_1m[i].get("t") == t_ms:
                    self.candles_1m[i] = bar
                    return
            return

    def apply_book_snapshot(self, b: list, a: list) -> None:
        self.bids = sorted(((f(p), f(s)) for p, s in b if f(s) > 0), key=lambda x: -x[0])
        self.asks = sorted(((f(p), f(s)) for p, s in a if f(s) > 0), key=lambda x: x[0])
        self.ts_book_ms = now_ms()

    def apply_book_delta(self, b: list, a: list) -> None:
        for price, size in b:
            p, s = f(price), f(size)
            self.bids = [(bp, bs) for bp, bs in self.bids if bp != p]
            if s > 0:
                self.bids.append((p, s))
                self.bids.sort(key=lambda x: -x[0])
        for price, size in a:
            p, s = f(price), f(size)
            self.asks = [(ap, aa) for ap, aa in self.asks if ap != p]
            if s > 0:
                self.asks.append((p, s))
                self.asks.sort(key=lambda x: x[0])
        self.ts_book_ms = now_ms()

    def depth_notional(self, side: str, levels: int) -> float:
        """Notional available on the side a `side` order would actually CONSUME.

        A Buy takes from the ASK book and a Sell takes from the BID book — that is the same
        convention the edge model uses when it prices entry (`asks[0]` for a Buy). This previously
        read `bids if side == "Buy"`, i.e. it measured the book on the OPPOSITE side of the trade.

        That inverted the liquidity gate: a Buy was admitted only when the BID book was deep, even
        though the price it pays and the size it can absorb are set by the ASK book. A thin ask book
        behind a deep bid book — the normal shape in a selloff — would pass the gate and then sweep
        through levels the cost model never priced.

        Deepening or thinning the book on the opposite side must not change whether a trade is
        admissible; see the regression tests in tests/test_cost_model.py.
        """
        book = self.asks if side == "Buy" else self.bids
        return sum(p * s for p, s in book[:levels])

    def imbalance(self, levels: int) -> float:
        bv = sum(s for _, s in self.bids[:levels])
        av = sum(s for _, s in self.asks[:levels])
        tot = bv + av
        return 0.0 if tot <= 0 else (bv - av) / tot

    def momentum(self, window_s: int) -> float:
        if not self.trades:
            return 0.0
        cutoff = now_ms() - window_s * 1000
        rec = [t for t in self.trades if t[0] >= cutoff]
        if len(rec) < 5:
            return 0.0
        p0, p1 = rec[0][1], rec[-1][1]
        return 0.0 if p0 <= 0 else math.log(p1 / p0)

    def atr_bps(self, period: int, fallback: float = 20.0) -> float:
        if len(self.closes_1m) < period + 1:
            return fallback
        closes = list(self.closes_1m)[-(period + 1):]
        trs = [abs(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]
        return fallback if not trs else (sum(trs) / len(trs)) * 1e4
