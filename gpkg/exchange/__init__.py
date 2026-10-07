"""Exchange integration layer for Bybit, Binance, KuCoin, OKX Linear Perpetual Futures.
"""
from __future__ import annotations

from typing import Any

from gpkg.exchange.base import ExchangeAdapter
from gpkg.exchange.binance_rest import BinanceAdapter
from gpkg.exchange.bybit_rest import BybitREST
from gpkg.exchange.bybit_ws import BybitWS
from gpkg.exchange.kucoin_rest import KuCoinAdapter
from gpkg.exchange.okx_rest import OKXAdapter


def get_adapter(exchange_name: str, cfg: Any, **kwargs: Any) -> ExchangeAdapter:
    name = (exchange_name or "bybit").lower().strip()
    if name == "bybit":
        return BybitREST(cfg, **kwargs)
    elif name == "binance":
        return BinanceAdapter(cfg, **kwargs)
    elif name == "kucoin":
        return KuCoinAdapter(cfg, **kwargs)
    elif name == "okx":
        return OKXAdapter(cfg, **kwargs)
    else:
        raise ValueError(f"Unsupported exchange adapter: {exchange_name}")


__all__ = [
    "BinanceAdapter",
    "BybitREST",
    "BybitWS",
    "ExchangeAdapter",
    "KuCoinAdapter",
    "OKXAdapter",
    "get_adapter",
]
