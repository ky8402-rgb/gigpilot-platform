"""Vectorised technical indicators.

All functions are strictly causal: the value at index i uses only data up to and
including index i. This is what makes backtests honest and prevents look-ahead
bias — the single most common way a "profitable" backtest becomes a losing live
account.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's ATR (RMA smoothing), matching exchange/TradingView conventions."""
    tr = true_range(high, low, close)
    return tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - (100.0 / (1.0 + rs))
    return out.fillna(100.0).where(avg_loss != 0, 100.0)


def macd(
    close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return macd_line, signal_line, macd_line - signal_line


def adx(
    high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14
) -> pd.Series:
    """Wilder's ADX — trend-strength filter (direction-agnostic)."""
    up = high.diff()
    down = -low.diff()
    plus_dm = pd.Series(
        np.where((up > down) & (up > 0), up, 0.0), index=high.index
    )
    minus_dm = pd.Series(
        np.where((down > up) & (down > 0), down, 0.0), index=high.index
    )
    tr = true_range(high, low, close)
    alpha = 1.0 / period
    atr_s = tr.ewm(alpha=alpha, adjust=False, min_periods=period).mean()
    plus_di = 100.0 * plus_dm.ewm(alpha=alpha, adjust=False, min_periods=period).mean() / atr_s
    minus_di = 100.0 * minus_dm.ewm(alpha=alpha, adjust=False, min_periods=period).mean() / atr_s
    denom = (plus_di + minus_di).replace(0.0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / denom
    return dx.ewm(alpha=alpha, adjust=False, min_periods=period).mean()


def donchian(
    high: pd.Series, low: pd.Series, period: int = 20
) -> tuple[pd.Series, pd.Series]:
    """Channel of the *prior* `period` bars — excludes the current bar so a
    breakout comparison against it is not self-referential."""
    upper = high.rolling(period, min_periods=period).max().shift(1)
    lower = low.rolling(period, min_periods=period).min().shift(1)
    return upper, lower


def roc(close: pd.Series, period: int = 10) -> pd.Series:
    return close.pct_change(period)


def bollinger(
    close: pd.Series, period: int = 20, k: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    mid = sma(close, period)
    sd = close.rolling(period, min_periods=period).std(ddof=0)
    return mid - k * sd, mid, mid + k * sd


def zscore(close: pd.Series, period: int = 20) -> pd.Series:
    mean = sma(close, period)
    sd = close.rolling(period, min_periods=period).std(ddof=0)
    return (close - mean) / sd.replace(0.0, np.nan)


def realized_vol(close: pd.Series, period: int = 24, bars_per_year: float = 24 * 365) -> pd.Series:
    """Annualised realised volatility from log returns."""
    lr = np.log(close / close.shift(1))
    return lr.rolling(period, min_periods=period).std(ddof=0) * np.sqrt(bars_per_year)


def slope(series: pd.Series, period: int = 20) -> pd.Series:
    """Normalised linear-regression slope over `period` bars."""
    idx = np.arange(period, dtype=float)
    idx -= idx.mean()
    denom = float((idx ** 2).sum())

    def _fit(win: np.ndarray) -> float:
        y = win - win.mean()
        return float((idx * y).sum() / denom)

    return series.rolling(period, min_periods=period).apply(_fit, raw=True)


def enrich(df: pd.DataFrame, cfg) -> pd.DataFrame:
    """Attach the full indicator set used by the strategy to an OHLCV frame.

    Expects columns: open, high, low, close, volume and a DatetimeIndex.
    """
    out = df.copy()
    out["ema_fast"] = ema(out["close"], cfg.ema_fast)
    out["ema_slow"] = ema(out["close"], cfg.ema_slow)
    out["ema_trend"] = ema(out["close"], cfg.ema_trend)
    out["atr"] = atr(out["high"], out["low"], out["close"], cfg.atr_period)
    out["adx"] = adx(out["high"], out["low"], out["close"], cfg.adx_period)
    out["rsi"] = rsi(out["close"], cfg.rsi_period)
    out["macd"], out["macd_sig"], out["macd_hist"] = macd(out["close"])
    out["dc_up"], out["dc_lo"] = donchian(out["high"], out["low"], cfg.donchian_period)
    out["roc"] = roc(out["close"], cfg.roc_period)
    out["bb_lo"], out["bb_mid"], out["bb_up"] = bollinger(out["close"], cfg.bb_period, cfg.bb_k)
    out["z"] = zscore(out["close"], cfg.bb_period)
    out["rv"] = realized_vol(out["close"], 24)
    out["slope"] = slope(out["close"], min(cfg.bb_period, 20))
    return out
