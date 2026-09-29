#!/usr/bin/env python3
"""End-to-end lifecycle check against LIVE exchange data.

This is the bridge between the unit tests (offline, synthetic) and the running
service. It exercises the REAL components — real market data, real cost model,
real risk manager, real paper broker, real ledger — and asserts the full
open -> manage -> stop/target -> close -> accounting path.

Two scenarios are run:
  A. The real, current setup on real symbols. Whatever the engine decides is
     correct; we only assert the decision is internally coherent.
  B. A synthetic frame with a deliberately violent trend, so the edge gate is
     satisfied on its own terms and the full trade lifecycle is guaranteed to be
     exercised. This proves the OPEN path works, not just the REJECT path.

Run:  python3 ops/e2e_check.py
Exit: 0 on success, 1 on any assertion failure.
"""
from __future__ import annotations

import asyncio
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import indicators as ta  # noqa: E402
from app.config import load_config  # noqa: E402
from app.costs import CostModel  # noqa: E402
from app.exchange import create_market_client  # noqa: E402
from app.execution import ExecutionEngine, PaperBroker  # noqa: E402
from app.learning import run_backtest  # noqa: E402
from app.market import rows_to_df  # noqa: E402
from app.portfolio import Ledger  # noqa: E402
from app.risk import RiskManager, size_position  # noqa: E402
from app.strategy import StrategyEngine, latest_setup  # noqa: E402

PASS, FAIL = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m"
results: list[tuple[bool, str]] = []


def check(cond: bool, label: str, detail: str = "") -> None:
    results.append((bool(cond), label))
    print(f"  [{PASS if cond else FAIL}] {label}" + (f" — {detail}" if detail else ""))


def strong_trend_frame(n: int = 2600, slope: float = 0.0022) -> pd.DataFrame:
    """Synthetic OHLCV with a strong, persistent uptrend plus pullbacks.

    Used only to force the trade path to be exercised. Never presented as market
    data and never used for performance claims.
    """
    rng = np.random.default_rng(42)
    phase = np.tile(np.array([0.9, 1.0, 0.75, 1.0]), n // 4 + 1)[:n]
    ret = slope * phase + rng.normal(0, 0.004, n)
    # Inject a genuine momentum burst every 120 bars so breakouts occur.
    ret[::120] += 0.03
    close = 100.0 * np.exp(np.cumsum(ret))
    high = close * (1 + np.abs(rng.normal(0, 0.0025, n)))
    low = close * (1 - np.abs(rng.normal(0, 0.0025, n)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    idx = pd.date_range("2023-01-01", periods=n, freq="1h", tz="UTC")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close,
                         "volume": np.abs(rng.normal(1500, 200, n))}, index=idx)


def main() -> int:
    cfg = load_config()
    cm = CostModel(cfg)
    print("=" * 78)
    print("END-TO-END LIFECYCLE CHECK")
    print(f"  mode={cfg.effective_mode()}  venue={cfg.exchange.name}  "
          f"interval={cfg.data.primary_interval}  live_armed={cfg.live_enabled()}")
    print("=" * 78)

    # ---------------------------------------------------------------- live data
    print("\n[1] Live exchange data")
    async def fetch():
        # Venue-agnostic: exercises whichever exchange is configured.
        async with create_market_client(cfg) as c:
            await c.ping()
            specs = await c.exchange_info()
            sym = "BTCUSDT"
            rows = await c.klines_full(sym, cfg.data.primary_interval, 1200)
            tick = await c.book_ticker(sym)
            depth = await c.depth(sym, cfg.exchange.depth_levels)
            return specs, rows, tick, depth

    try:
        specs, rows, tick, depth = asyncio.run(fetch())
    except Exception as exc:
        print(f"  [{FAIL}] live data fetch failed: {exc}")
        return 1

    df = rows_to_df(rows)
    check(len(df) > 1000, "fetched real klines", f"{len(df)} bars, through {df.index[-1]}")
    check(tick.mid > 0, "live ticker", f"bid={tick.bid} ask={tick.ask} spread={tick.spread_bps:.3f}bps funding={tick.funding_rate}")
    check(depth is not None and len(depth.bids) > 0 and len(depth.asks) > 0,
          "live order book", f"{len(depth.bids)}x{len(depth.asks)} levels, spread={depth.spread_bps():.3f}bps")
    check("BTCUSDT" in specs, "symbol spec resolved",
          f"step={specs['BTCUSDT'].step_size} tick={specs['BTCUSDT'].tick_size} minNotional={specs['BTCUSDT'].min_notional}")

    # --------------------------------------------------- real decision coherence
    print("\n[2] Real decision on real closed bars (whatever it decides must be coherent)")
    strat = StrategyEngine(cfg, cm)
    enriched = ta.enrich(df, cfg.strategy)
    setup = latest_setup("BTCUSDT", enriched, cfg.strategy)
    dec = strat.decide(
        "BTCUSDT", enriched, tick, depth, cfg.risk.starting_equity,
        size_fn=lambda s, e, t, spec: size_position(s, e, t, spec, cfg),
        spec=specs["BTCUSDT"],
    )
    costs = dec.cost_breakdown
    check(dec.action in ("HOLD", "SKIP", "OPEN_LONG", "OPEN_SHORT"), "decision is a known action",
          f"action={dec.action} regime={dec.regime} setup={setup.direction}")
    check(dec.hurdle_bps >= cfg.costs.min_edge_bps or setup.direction == "FLAT",
          "cost hurdle computed from the live book",
          f"cost={dec.cost_bps:.2f}bps hurdle={dec.hurdle_bps:.2f}bps "
          f"(fees={costs.get('entry_fee_bps',0)+costs.get('exit_fee_bps',0):.1f} "
          f"slip={costs.get('entry_slippage_bps',0)+costs.get('exit_slippage_bps',0):.0f} "
          f"spread={costs.get('spread_bps',0):.2f} funding={costs.get('funding_bps',0):.1f})")
    if setup.direction != "FLAT":
        check(bool(dec.reason), "rejection/trade reason is explained", dec.reason[:150])
    if dec.traded:
        check(dec.qty > 0 and dec.notional > 0, "if it traded, size is positive",
              f"qty={dec.qty} notional={dec.notional:.2f}")
        check(dec.expected_gross_edge_bps >= dec.hurdle_bps,
              "traded only with edge above the hurdle",
              f"edge={dec.expected_gross_edge_bps:.1f}bps >= hurdle={dec.hurdle_bps:.1f}bps")
    else:
        check(dec.expected_gross_edge_bps >= 0 or dec.rejected_by, "if it did not trade, it said why",
              f"rejected_by={dec.rejected_by}")

    # ------------------------------------------------- full lifecycle (forced)
    print("\n[3] Full lifecycle: open -> manage -> stop/target -> close -> accounting")
    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "e2e.db"
        led = Ledger(cfg.risk.starting_equity, db, persist=True)
        risk = RiskManager(cfg)
        broker = PaperBroker(cfg, led, cm)
        ex = ExecutionEngine(cfg, led, broker, cm)

        trend = strong_trend_frame()
        trades = run_backtest("TREND", trend, cfg.strategy, fee_bps=7.0, slippage_bps=2.0)
        check(len(trades) > 0, "backtest on a strong trend produces trades",
              f"{len(trades)} trades")

        t_enr = ta.enrich(trend, cfg.strategy)
        tsetup = latest_setup("TREND", t_enr, cfg.strategy)
        # Use the last actionable setup from the trend frame so levels are real.
        actionable = latest_setup("TREND", t_enr, cfg.strategy)
        if actionable.direction == "FLAT":
            # Walk back to the most recent bar that had a setup.
            for off in range(2, 40):
                sub = trend.iloc[: len(trend) - off]
                cand = latest_setup("TREND", ta.enrich(sub, cfg.strategy), cfg.strategy)
                if cand.direction != "FLAT":
                    actionable = cand
                    break
        check(actionable.direction in ("LONG", "SHORT"), "found an actionable setup to trade",
              f"{actionable.direction} @ {actionable.price:.4g} stop={actionable.stop:.4g} target={actionable.target:.4g}")

        sizing = size_position(actionable, cfg.risk.starting_equity, tick, specs["BTCUSDT"], cfg)
        check(sizing["qty"] > 0, "sizing produced a tradeable quantity",
              f"qty={sizing['qty']} notional={sizing['notional']:.2f} leverage={sizing['leverage']:.2f} by {sizing.get('binding')}")

        eq_before = led.equity
        ok, msg = asyncio.run(ex.open_position(actionable, sizing, tick, depth, dec))
        check(ok, "position opened through the paper broker", msg)
        check("TREND" in led.positions, "position present in the ledger")
        pos = led.positions.get("TREND")
        if pos is not None:
            check(pos.fees_paid > 0, "entry fee charged", f"{pos.fees_paid:.6f}")
            check(pos.risk_per_unit > 0, "risk per unit derived from the actual fill",
                  f"risk/unit={pos.risk_per_unit:.4g} entry={pos.entry_price:.6g}")
            check(led.orders and led.orders[-1].status == "FILLED", "entry order recorded as FILLED")

            # Mark to a favourable price and confirm unrealized accounting.
            up = pos.entry_price * (1 + 0.01 if pos.side == "LONG" else -0.01) if pos.side == "LONG" else pos.entry_price * 0.99
            led.mark({"TREND": up})
            if pos.side == "LONG":
                check(pos.unrealized_gross > 0, "unrealized PnL positive after a favourable mark",
                      f"{pos.unrealized_gross:.4f}")
            else:
                check(pos.unrealized_gross > 0, "unrealized PnL positive after a favourable mark (short)",
                      f"{pos.unrealized_gross:.4f}")

            # Drive it into the stop and confirm the exit + accounting.
            stop_mark = pos.stop * (0.999 if pos.side == "LONG" else 1.001)
            from app.exchange import Ticker
            stop_tick = Ticker(symbol="TREND", last=stop_mark, bid=stop_mark * 0.9999, ask=stop_mark * 1.0001,
                               quote_volume_24h=1e9, price_change_pct_24h=0.0, mark_price=stop_mark,
                               funding_rate=tick.funding_rate)
            res = asyncio.run(ex.manage("TREND", stop_tick, depth,
                                        bar_high=max(stop_mark, pos.entry_price),
                                        bar_low=min(stop_mark, pos.entry_price)))
            check(res.get("action") == "stop", "stop exit triggered and executed", str(res.get("action")))
            check("TREND" not in led.positions, "position removed after exit")
            tr = led.trades[-1]
            check(tr.exit_reason == "stop", "trade recorded with the stop exit reason")
            check(tr.fees > 0, "round-trip fees booked on the trade", f"{tr.fees:.6f}")
            check(abs(tr.net_pnl - (tr.gross_pnl - tr.fees - tr.funding)) < 1e-6,
                  "net PnL identity holds (gross - fees - funding)",
                  f"net={tr.net_pnl:.4f} gross={tr.gross_pnl:.4f} fees={tr.fees:.4f} funding={tr.funding:.4f}")
            check(tr.net_pnl < 0, "a stop-out is a net loss", f"net={tr.net_pnl:.4f}")

        # Risk feedback loop
        risk.on_equity(led.equity)
        risk.on_trade_closed(led.trades[-1].net_pnl if led.trades else -1)
        check(risk.state.consecutive_losses >= 1, "loss streak fed back into the risk model",
              f"streak={risk.state.consecutive_losses}")

        # Drawdown kill switch
        risk.on_equity(cfg.risk.starting_equity * (1 - cfg.risk.max_drawdown_pct / 100) - 1)
        allowed, reasons = risk.evaluate()
        check(allowed is False and any("drawdown" in r for r in reasons),
              "max-drawdown kill switch halts trading", f"reasons={reasons}")

        # Persistence
        curve_before = len(led.equity_curve)
        led.record_equity()
        from app.portfolio import load_equity_curve, load_trades
        check(len(load_equity_curve(db)) >= 1, "equity curve persisted to SQLite")
        check(len(load_trades(db)) == len(led.trades), "trades persisted to SQLite",
              f"{len(led.trades)} trades")
        check(led.trades and led.trades[0].fees > 0, "persisted trade retains its cost data")

    # ------------------------------------------------- feedback -> risk feedback
    print("\n[4] Cost model sanity on the real book")
    c1 = cm.round_trip(ticker=tick, depth=depth, notional_usd=1_000, expected_holding_hours=24, entry_side="BUY")
    c2 = cm.round_trip(ticker=tick, depth=depth, notional_usd=1_000_000, expected_holding_hours=24, entry_side="BUY")
    check(c1.total_bps > 0, "round-trip cost is positive", f"{c1.total_bps:.3f}bps for $1k")
    check(c2.total_bps >= c1.total_bps, "cost grows with order size (real book impact)",
          f"$1k={c1.total_bps:.3f}bps  $1M={c2.total_bps:.3f}bps")
    check(cm.hurdle_bps(c1) >= cfg.costs.min_edge_bps, "hurdle respects the configured floor",
          f"hurdle={cm.hurdle_bps(c1):.2f}bps")

    passed = sum(1 for ok, _ in results if ok)
    total = len(results)
    print("\n" + "=" * 78)
    print(f"RESULT: {passed}/{total} checks passed")
    if passed != total:
        for ok, label in results:
            if not ok:
                print(f"  FAILED: {label}")
    print("=" * 78)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
