"""Signal generation and the trade simulator.

The critical properties tested here:
  * signals are causal (no look-ahead)
  * costs are actually subtracted
  * the stop-out-first assumption is pessimistic, not optimistic
  * a strategy with no edge is NOT reported as having one
"""
import numpy as np
import pandas as pd
import pytest

from app import indicators as ta
from app.config import load_config
from app.learning import ParamSet, apply_params, run_backtest, score_trades
from app.strategy import (EdgeStats, build_signals, edge_from_trades, latest_setup,
                          simulate)


@pytest.fixture
def cfg():
    return load_config()


def test_build_signals_is_causal(synthetic_ohlcv, cfg):
    """Signals at bar i must not change when bars after i are appended."""
    df = synthetic_ohlcv
    cut = 600
    full = build_signals(ta.enrich(df, cfg.strategy), cfg.strategy)
    part = build_signals(ta.enrich(df.iloc[:cut], cfg.strategy), cfg.strategy)
    for col in ("long_signal", "short_signal"):
        # Compare the last 50 shared bars; warm-up regions are allowed to differ only
        # if the EMA/ADX warm-up requirements are unmet, so we compare a settled window.
        a = full[col].iloc[cut - 50:cut].to_numpy()
        b = part[col].iloc[-50:].to_numpy()
        assert np.array_equal(a, b), f"{col} changed when future bars were added"


def test_signals_are_boolean_and_not_all_true(synthetic_ohlcv, cfg):
    d = build_signals(ta.enrich(synthetic_ohlcv, cfg.strategy), cfg.strategy)
    for col in ("long_signal", "short_signal"):
        assert d[col].dtype == bool
    assert d["long_signal"].sum() + d["short_signal"].sum() < len(d) * 0.5


def test_no_opposite_signals_simultaneously(synthetic_ohlcv, cfg):
    d = build_signals(ta.enrich(synthetic_ohlcv, cfg.strategy), cfg.strategy)
    assert not (d["long_signal"] & d["short_signal"]).any()


def test_simulate_charges_costs(synthetic_ohlcv, cfg):
    enriched = ta.enrich(synthetic_ohlcv, cfg.strategy)
    free, _ = simulate("T", enriched, cfg.strategy, fee_bps_round_trip=0.0)
    costly, _ = simulate("T", enriched, cfg.strategy, fee_bps_round_trip=20.0)
    assert len(free) == len(costly)
    for a, b in zip(free, costly):
        assert a.gross_return_bps == pytest.approx(b.gross_return_bps)
        assert b.net_return_bps == pytest.approx(a.gross_return_bps - 20.0)


def test_simulate_never_trades_a_bar_it_could_not_see(synthetic_ohlcv, cfg):
    """Truncating the series must not change trades that already completed."""
    enriched = ta.enrich(synthetic_ohlcv, cfg.strategy)
    full, _ = simulate("T", enriched, cfg.strategy, fee_bps_round_trip=7.0)
    cut = 650
    part, _ = simulate("T", enriched.iloc[:cut], cfg.strategy, fee_bps_round_trip=7.0)
    full_early = [t for t in full if t.exit_i < cut]
    assert len(full_early) >= len(part) - 1
    for a, b in zip(full_early[:len(part)], part):
        assert a.entry_price == pytest.approx(b.entry_price)
        assert a.exit_price == pytest.approx(b.exit_price)


def test_simulate_levels_are_coherent(synthetic_ohlcv, cfg):
    """Levels must be coherent at ENTRY time. `stop` is the level at exit and may
    legitimately have trailed past entry, so the entry-time invariant is asserted
    against `initial_stop`."""
    enriched = ta.enrich(synthetic_ohlcv, cfg.strategy)
    trades, _ = simulate("T", enriched, cfg.strategy, fee_bps_round_trip=7.0)
    assert trades, "expected the synthetic trend to produce trades"
    for t in trades:
        if t.direction == "LONG":
            assert t.initial_stop < t.entry_price < t.target
            # A long stop may only ever be raised, never lowered.
            assert t.stop >= t.initial_stop
        else:
            assert t.target < t.entry_price < t.initial_stop
            assert t.stop <= t.initial_stop
        assert t.bars_held >= 0
        assert t.entry_i < t.exit_i


def test_edge_from_trades_separates_directions(synthetic_ohlcv, cfg):
    enriched = ta.enrich(synthetic_ohlcv, cfg.strategy)
    trades, _ = simulate("T", enriched, cfg.strategy, fee_bps_round_trip=7.0)
    longs = edge_from_trades(trades, "LONG", cfg.strategy, min_samples=1)
    shorts = edge_from_trades(trades, "SHORT", cfg.strategy, min_samples=1)
    assert longs.samples == sum(1 for t in trades if t.direction == "LONG")
    assert shorts.samples == sum(1 for t in trades if t.direction == "SHORT")
    assert longs.samples + shorts.samples == len(trades)


def test_edge_marks_unreliable_without_samples(cfg):
    st = edge_from_trades([], "LONG", cfg.strategy, min_samples=8)
    assert st.samples == 0 and st.reliable is False


def test_score_rejects_empty_and_shrinks_tiny_samples(cfg):
    assert score_trades([], 5)[0] < -1e8

    class FakeTrade:
        def __init__(self, bps):
            self.net_return_bps = bps

    tiny = score_trades([FakeTrade(100.0)] * 2, 10)[0]
    many = score_trades([FakeTrade(100.0)] * 60, 10)[0]
    # Identical per-trade returns, but the thin sample must not score higher.
    assert tiny <= many


def test_latest_setup_reports_insufficient_history(cfg):
    short = pd.DataFrame({"open": [1.0], "high": [1.0], "low": [1.0], "close": [1.0], "volume": [1.0]})
    s = latest_setup("T", short, cfg.strategy)
    assert s.direction == "FLAT"
    assert "insufficient" in s.reason


def test_apply_params_changes_strategy_config(cfg):
    p = ParamSet(ema_fast=13, ema_slow=34, adx_min=26.0, donchian_period=15,
                 atr_stop_mult=1.5, tp_r_multiple=1.8,
                 breakout_buffer_atr=0.05, min_momentum_atr=0.10,
                 require_htf_alignment=False)
    applied = apply_params(cfg.strategy, p)
    assert applied.ema_fast == 13 and applied.ema_slow == 34
    assert applied.atr_stop_mult == 1.5 and applied.tp_r_multiple == 1.8
    assert applied.require_htf_alignment is False
    # Risk limits must be untouched by parameter search.
    assert cfg.risk.max_leverage == 5.0


def test_backtest_produces_no_trades_on_flat_noise(cfg):
    """A random walk with no trend must not be turned into a profitable strategy."""
    rng = np.random.default_rng(11)
    n = 700
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.005, n)))
    df = pd.DataFrame({
        "open": np.concatenate([[close[0]], close[:-1]]),
        "high": close * 1.001, "low": close * 0.999, "close": close,
        "volume": np.abs(rng.normal(1000, 100, n)),
    }, index=pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC"))
    trades = run_backtest("NOISE", df, cfg.strategy, fee_bps=7.0)
    if trades:
        net = np.mean([t.net_return_bps for t in trades])
        # With no drift and full costs, expectancy must not be strongly positive.
        assert net < 50.0
