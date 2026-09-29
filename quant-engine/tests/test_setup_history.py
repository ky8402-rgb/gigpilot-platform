"""Setup-frequency calibration, the analysis cache, and the dashboard row contract.

Two regressions are pinned here.

1. **"No trades" was ambiguous.** The only outward signal that a strategy is idle was a
   position count of zero, which looks identical whether the market is quiet, the feed is
   dead, or the entry rules can no longer fire at all. `setup_history` compares the current
   gap with the symbol's OWN measured gap distribution — and refuses to call the situation
   "normal" when there is no distribution to compare against.

2. **The dashboard's scanner table never rendered.** `paintSymbols()` builds the table from
   `LAST.symbol_rows`, but `snapshot()` did not include that key and the frontend never
   fetched `/api/symbols`, so the table sat on "Loading universe…" permanently while the
   API already held every field it needed.
"""
from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from app.engine import EngineStatus, TradingEngine
from app.strategy import setup_history


def signals_frame(length: int, long_at=(), short_at=()) -> pd.DataFrame:
    """Minimal deterministic frame with the signal columns `setup_history` consumes."""
    idx = pd.date_range("2024-01-01", periods=length, freq="1h", tz="UTC")
    longs = set(long_at)
    shorts = set(short_at)
    return pd.DataFrame(
        {
            "long_signal": [i in longs for i in range(length)],
            "short_signal": [i in shorts for i in range(length)],
        },
        index=idx,
    )


# ---------------------------------------------------------------------------
# setup_history — silence must be classified, never assumed benign
# ---------------------------------------------------------------------------
def test_no_frame_is_never_reported_as_normal(cfg):
    h = setup_history(None, cfg)
    assert h.state == "no_historical_setups"
    assert h.total_setups == 0


def test_missing_signal_columns_is_not_reported_as_normal(cfg):
    h = setup_history(pd.DataFrame({"close": [1.0, 2.0]}), cfg)
    assert h.state == "no_historical_setups"
    assert h.bars_since_last is None


def test_empty_frame_is_not_reported_as_normal(cfg):
    h = setup_history(pd.DataFrame({"long_signal": [], "short_signal": []}), cfg)
    assert h.state == "no_historical_setups"


def test_rules_that_never_fire_are_unknown_not_normal(cfg):
    """No fire at all => no distribution => we have no evidence to call it normal."""
    h = setup_history(signals_frame(200), cfg)
    assert h.state == "no_historical_setups"
    assert h.total_setups == 0
    assert h.bars == 200
    assert h.median_gap_bars is None


def test_counts_are_split_by_direction(cfg):
    h = setup_history(signals_frame(100, long_at=[10, 40], short_at=[20, 60, 70]), cfg)
    assert (h.long_setups, h.short_setups, h.total_setups) == (2, 3, 5)


def test_a_setup_on_the_latest_bar_is_reported_as_such(cfg):
    h = setup_history(signals_frame(100, long_at=[10, 99]), cfg)
    assert h.state == "in_setup"
    assert h.bars_since_last == 0


def test_gap_inside_normal_spacing_is_normal_idle(cfg):
    # Regular 10-bar spacing, 19 bars since the last setup -> well inside 3x the median.
    h = setup_history(signals_frame(100, long_at=[0, 10, 20, 30, 40, 50, 60, 70, 80]), cfg)
    assert h.median_gap_bars == 10.0
    assert h.bars_since_last == 19
    assert h.state == "normal_idle"
    assert "within" in h.detail


def test_gap_beyond_normal_spacing_is_flagged_not_hidden(cfg):
    h = setup_history(signals_frame(200, long_at=[10, 20, 30]), cfg)
    assert h.median_gap_bars == 10.0
    assert h.bars_since_last == 169
    assert h.state == "elongated_idle"
    assert "outside" in h.detail


def test_single_setup_has_no_distribution_to_compare_against(cfg):
    h = setup_history(signals_frame(100, long_at=[5]), cfg)
    assert h.state == "no_historical_setups"
    assert "one setup" in h.detail


def test_idle_multiplier_controls_the_threshold(cfg):
    f = signals_frame(60, long_at=[0, 10, 20, 30, 40])
    assert setup_history(f, cfg).bars_since_last == 19
    assert setup_history(f, cfg).state == "normal_idle"
    # Tighter tolerance must reclassify the same evidence as elongated.
    assert setup_history(f, cfg, idle_multiplier=1.0).state == "elongated_idle"


def test_as_dict_exposes_every_field_the_ui_reads(cfg):
    d = setup_history(signals_frame(100, long_at=[0, 10]), cfg).as_dict()
    for key in (
        "setup_state",
        "setup_total",
        "setup_long",
        "setup_short",
        "bars_since_last_setup",
        "setup_gap_median_bars",
        "setup_gap_p90_bars",
    ):
        assert key in d, f"{key} missing from the row payload"


# ---------------------------------------------------------------------------
# Analysis cache — indicators must not be rebuilt for unchanged closed bars
# ---------------------------------------------------------------------------
class _StubStore:
    def __init__(self, df, ts_ms):
        self.df = df
        self.ts_ms = ts_ms

    def frame(self, symbol, interval, closed_only=True):
        return self.df

    def last_ts_ms(self, symbol, interval):
        return self.ts_ms


class _Ledger:
    positions: dict = {}

    def snapshot(self):
        return {"equity": 10_000.0}


class _Risk:
    def snapshot(self):
        return {"halted": False}


class _Empty:
    def snapshot(self):
        return {}

    def as_dict(self):
        return {}


class _Params:
    def as_dict(self):
        return {}


class _Optimizer:
    def history(self, n):
        return []

    def symbol_state(self):
        return {}


def make_engine_stub(synthetic_ohlcv, cfg):
    engine_cfg = SimpleNamespace(
        data=SimpleNamespace(primary_interval="1h"),
        exchange=SimpleNamespace(name="bybit", market_type="linear"),
        learning=SimpleNamespace(enabled=False),
    )
    engine_cfg.live_enabled = lambda: False

    eng = SimpleNamespace(
        cfg=engine_cfg,
        store=_StubStore(synthetic_ohlcv, 1_700_000_000_000),
        feed=None,
        execution=None,
        ledger=_Ledger(),
        risk=_Risk(),
        cost_model=_Empty(),
        params=_Params(),
        optimizer=_Optimizer(),
        status=EngineStatus(),
        symbols=["BTCUSDT"],
        symbol_state={},
        _decisions={},
        _selfcheck={},
        _host_identity={},
        _analysis_cache={},
        _strategy_cfg_generation=0,
        mode="paper",
        strategy_cfg=cfg.strategy,
    )
    eng._analysis = lambda s: TradingEngine._analysis(eng, s)
    eng.symbol_rows = lambda: TradingEngine.symbol_rows(eng)
    return eng


def test_analysis_is_cached_until_something_that_matters_changes(synthetic_ohlcv, cfg):
    eng = make_engine_stub(synthetic_ohlcv, cfg)

    d1, s1 = TradingEngine._analysis(eng, "BTCUSDT")
    d2, s2 = TradingEngine._analysis(eng, "BTCUSDT")
    assert d2 is d1 and s2 is s1, "an unchanged closed-bar series must not be re-analysed"

    # A newly closed bar is a real change.
    eng.store.ts_ms += 3_600_000
    d3, _ = TradingEngine._analysis(eng, "BTCUSDT")
    assert d3 is not d1

    # A backfill can add history while leaving the last timestamp alone, so the bar count
    # is part of the key too.
    eng.store.df = pd.concat([synthetic_ohlcv.iloc[:1], synthetic_ohlcv])
    d4, _ = TradingEngine._analysis(eng, "BTCUSDT")
    assert d4 is not d3

    # Promoted parameters change every threshold the frames were computed with.
    eng._strategy_cfg_generation += 1
    d5, _ = TradingEngine._analysis(eng, "BTCUSDT")
    assert d5 is not d4


def test_rows_carry_the_calibration_and_fail_closed_on_edge(synthetic_ohlcv, cfg):
    eng = make_engine_stub(synthetic_ohlcv, cfg)
    rows = TradingEngine.symbol_rows(eng)
    assert len(rows) == 1
    row = rows[0]
    assert row["symbol"] == "BTCUSDT"
    assert row["setup_state"] in ("in_setup", "normal_idle", "elongated_idle",
                                  "no_historical_setups")
    assert "bars_since_last_setup" in row
    # No decision has been made for this symbol yet, so no edge was measured: the row must
    # not claim a verified edge.
    assert row["edge_reliable"] is False
    assert row["edge_samples"] == 0


def test_snapshot_carries_symbol_rows_so_the_scanner_can_render(synthetic_ohlcv, cfg):
    """The exact regression: without this key the scanner table never populated."""
    eng = make_engine_stub(synthetic_ohlcv, cfg)
    snap = TradingEngine.snapshot(eng)
    assert "symbol_rows" in snap
    assert snap["symbol_rows"][0]["symbol"] == "BTCUSDT"
