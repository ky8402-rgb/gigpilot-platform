"""Indicator correctness and — most importantly — causality.

Look-ahead bias is the defect that makes a backtest lie. The causality tests below
truncate the series at an index and assert the indicator value at that index is
identical, which can only hold if no future data leaks in.
"""
import numpy as np
import pandas as pd
import pytest

from app import indicators as ta


def test_sma_matches_manual():
    s = pd.Series([1.0, 2, 3, 4, 5])
    out = ta.sma(s, 3)
    assert np.isnan(out.iloc[0]) and np.isnan(out.iloc[1])
    assert out.iloc[2] == pytest.approx(2.0)
    assert out.iloc[4] == pytest.approx(4.0)


def test_atr_positive_and_causal(synthetic_ohlcv):
    df = synthetic_ohlcv
    a = ta.atr(df["high"], df["low"], df["close"], 14)
    assert (a.dropna() > 0).all()
    for cut in (200, 400, 700):
        a_cut = ta.atr(df["high"].iloc[:cut], df["low"].iloc[:cut], df["close"].iloc[:cut], 14)
        assert a.iloc[cut - 1] == pytest.approx(a_cut.iloc[-1])


def test_rsi_bounds(synthetic_ohlcv):
    r = ta.rsi(synthetic_ohlcv["close"], 14).dropna()
    assert (r >= 0).all() and (r <= 100).all()


def test_adx_bounds(synthetic_ohlcv):
    df = synthetic_ohlcv
    a = ta.adx(df["high"], df["low"], df["close"], 14).dropna()
    assert (a >= 0).all() and (a <= 100).all()


def test_donchian_excludes_current_bar():
    """The channel must be built from PRIOR bars, otherwise a breakout test against
    it is self-referential and trivially true."""
    high = pd.Series([1.0, 2, 3, 10, 4])
    low = pd.Series([0.5, 1, 2, 3, 2])
    up, lo = ta.donchian(high, low, 3)
    # At index 3, the prior 3 highs are 1,2,3 -> upper == 3 (the 10 is excluded).
    assert up.iloc[3] == pytest.approx(3.0)
    assert lo.iloc[3] == pytest.approx(0.5)


def test_enrich_is_causal(synthetic_ohlcv):
    """Every enriched column at index i must match a computation on data[:i+1]."""
    df = synthetic_ohlcv

    class C:
        ema_fast, ema_slow, ema_trend = 21, 55, 200
        adx_period, atr_period, rsi_period = 14, 14, 14
        donchian_period, roc_period, bb_period, bb_k = 20, 10, 20, 2.0

    full = ta.enrich(df, C)
    cut = 600
    part = ta.enrich(df.iloc[:cut], C)
    for col in ("ema_fast", "ema_slow", "ema_trend", "atr", "adx", "rsi",
                "macd", "macd_hist", "dc_up", "dc_lo", "roc", "z", "slope"):
        a, b = full[col].iloc[cut - 1], part[col].iloc[-1]
        if np.isnan(a) and np.isnan(b):
            continue
        assert a == pytest.approx(b, rel=1e-9, abs=1e-9), f"{col} leaks future data"


def test_macd_relationship(synthetic_ohlcv):
    macd_line, sig, hist = ta.macd(synthetic_ohlcv["close"])
    assert np.allclose(hist.dropna(), (macd_line - sig).dropna())
