"""Concrete exchange adapters.

Each module implements `gpkg.exchange.base.ExchangeAdapter` for exactly one venue. All
venue-specific parsing, signing and symbol conventions live here — nowhere else in the system.

Import cost is deliberately low: adapters are registered lazily by `gpkg.exchange.registry` so a
missing optional dependency for one venue cannot prevent the others from loading.
"""
from __future__ import annotations

from gpkg.exchange.adapters.binance import BinanceAdapter
from gpkg.exchange.adapters.bybit import BybitAdapter
from gpkg.exchange.adapters.kucoin import KucoinAdapter

__all__ = ["BinanceAdapter", "BybitAdapter", "KucoinAdapter"]
