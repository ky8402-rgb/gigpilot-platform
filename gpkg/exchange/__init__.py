"""Exchange integration layer for Bybit linear perpetual futures (live-only).
"""
from __future__ import annotations

from typing import Any

from gpkg.exchange.adapters.binance import BinanceAdapter
from gpkg.exchange.adapters.bybit import BybitAdapter
from gpkg.exchange.adapters.kucoin import KucoinAdapter
from gpkg.exchange.base import ExchangeAdapter
from gpkg.exchange.bybit_rest import BybitREST
from gpkg.exchange.bybit_ws import BybitWS


def get_adapter(exchange_name: str, cfg: Any, **kwargs: Any) -> ExchangeAdapter:
    name = (exchange_name or "bybit").lower().strip()
    if name == "bybit":
        return BybitAdapter(cfg, **kwargs)
    elif name == "binance":
        return BinanceAdapter(**kwargs)
    elif name == "kucoin":
        return KucoinAdapter(cfg, **kwargs)
    else:
        raise ValueError(f"Unsupported exchange adapter: {exchange_name}")


__all__ = [
    "BinanceAdapter",
    "BybitREST",
    "BybitWS",
    "ExchangeAdapter",
    "KuCoinAdapter",
    "get_adapter",
]
