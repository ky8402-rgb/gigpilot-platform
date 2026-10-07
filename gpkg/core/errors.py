"""Exchange error taxonomy for Bybit, Binance, and KuCoin.

Extracted so every layer (exchange, execution, accounting, risk) can raise and
catch unified and exchange-specific error types without importing the engine.
"""
from __future__ import annotations


class ExchangeError(Exception):
    """Base exception for all exchange API errors."""

    def __init__(self, code: int, msg: str):
        super().__init__(f"[{code}] {msg}")
        self.code = code
        self.msg = msg


class BybitError(ExchangeError):
    """A business error returned BY BYBIT (HTTP 200 with retCode != 0)."""

    def __init__(self, code: int, msg: str):
        super().__init__(code, msg)
        self.code = code
        self.msg = msg

    def __str__(self) -> str:
        return f"Bybit {self.code}: {self.msg}"


class BinanceError(ExchangeError):
    """A business error returned by Binance USDT-M Futures API."""

    def __init__(self, code: int, msg: str):
        super().__init__(code, msg)
        self.code = code
        self.msg = msg

    def __str__(self) -> str:
        return f"Binance {self.code}: {self.msg}"


class KuCoinError(ExchangeError):
    """A business error returned by KuCoin Futures API."""

    def __init__(self, code: int, msg: str):
        super().__init__(code, msg)
        self.code = code
        self.msg = msg

    def __str__(self) -> str:
        return f"KuCoin {self.code}: {self.msg}"


# Duplicate client order ID codes per exchange
DUPLICATE_ORDER_LINK_CODE = 110072
BINANCE_DUPLICATE_ORDER_CODE = -2011
KUCOIN_DUPLICATE_ORDER_CODE = 300000
