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
