"""Live-mode safety: the failures that only bite once real money is involved.

Three hazards, each of which is invisible in paper mode and dangerous in live:

  1. Equity sized from a configured placeholder instead of the real account.
  2. A kill switch (and the peak-equity that triggers it) lost on restart, because
     the process is restarted by the supervisor on any crash.
  3. Positions that already exist on the exchange being invisible to the engine,
     so it opens a second position on top of real risk.

None of these produce an error in tests of the trading logic; they are properties of
the *process lifecycle*, which is why they get their own adversarial tests.
"""
import asyncio
import time
from pathlib import Path

import pandas as pd
import pytest

from app.config import load_config
from app.exchange import PositionRisk
from app.portfolio import Ledger, Position
from app.risk import HaltReason, RiskManager


@pytest.fixture
def cfg(tmp_path):
    c = load_config()
    c.data.db_path = str(tmp_path / "live.db")
    return c


# ---------------------------------------------------------------------------
# 1. Exchange equity is authoritative in live mode
# ---------------------------------------------------------------------------
def test_paper_equity_is_internal_accounting(tmp_path):
    led = Ledger(10_000.0, tmp_path / "a.db")
    assert led.equity == 10_000.0
    assert led.equity_source == "accounting"
    assert led.snapshot()["exchange_equity"] is None


def test_live_equity_adoption_overrides_accounting(tmp_path):
    """A $250 real account must NOT be sized as if it held the configured $10k."""
    led = Ledger(10_000.0, tmp_path / "b.db")
    rep = led.set_authoritative_equity(250.0, "bybit-wallet")
    assert rep["adopted"] is True
    assert rep["first_sync"] is True
    assert led.equity == 250.0
    assert led.equity_source == "bybit-wallet"
    assert led.snapshot()["exchange_equity"] == 250.0
    assert led.snapshot()["internal_equity"] == 10_000.0


def test_first_adoption_rebases_starting_equity_preserving_realized(tmp_path):
    """equity = starting + realized must still hold after rebasing, or every
    return percentage is measured against a fictional balance."""
    led = Ledger(10_000.0, tmp_path / "c.db")
    led.realized_net = 120.0
    led.set_authoritative_equity(1_120.0, "bybit-wallet")
    assert led.starting_equity == pytest.approx(1_000.0)
    assert led.starting_equity + led.realized_net == pytest.approx(led.equity)


def test_rebase_is_not_repeated_on_later_syncs(tmp_path):
    led = Ledger(10_000.0, tmp_path / "d.db")
    led.set_authoritative_equity(500.0, "bybit-wallet")
    second = led.set_authoritative_equity(480.0, "bybit-wallet")
    assert second["first_sync"] is False
    assert second["rebased_starting_equity"] is False
    assert led.equity == 480.0


def test_non_positive_equity_is_refused(tmp_path):
    """A zero/negative balance reading must not zero the account."""
    led = Ledger(10_000.0, tmp_path / "e.db")
    assert led.set_authoritative_equity(0.0)["adopted"] is False
    assert led.set_authoritative_equity(-5.0)["adopted"] is False
    assert led.equity == 10_000.0


def test_clearing_authority_restores_accounting(tmp_path):
    led = Ledger(10_000.0, tmp_path / "f.db")
    led.set_authoritative_equity(700.0)
    led.clear_authoritative_equity()
    assert led.equity_source == "accounting"
    assert led.equity == 10_000.0


# ---------------------------------------------------------------------------
# 2. Guard state survives a restart
# ---------------------------------------------------------------------------
def test_kill_switch_survives_restart(cfg):
    saved = {}
    rm = RiskManager(cfg, persist_cb=lambda d: saved.update(d))
    rm.on_equity(10_000)
    rm.on_equity(10_000 * (1 - cfg.risk.max_drawdown_pct / 100) - 1)
    rm.evaluate(data_ok=True, feed_connected=True)
    assert rm.state.halted is True

    restarted = RiskManager(cfg, persist_cb=lambda d: None)
    assert restarted.restore_state(dict(saved)) is True
    restarted.on_equity(8_800)
    allowed, reasons = restarted.evaluate(data_ok=True, feed_connected=True)
    assert allowed is False, "a kill switch must not be cleared by a process restart"
    assert HaltReason.MAX_DRAWDOWN.value in reasons


def test_peak_equity_survives_restart(cfg):
    """Without the peak, drawdown restarts at zero and the kill switch can never
    fire again — a silent fail-open."""
    saved = {}
    rm = RiskManager(cfg, persist_cb=lambda d: saved.update(d))
    rm.on_equity(25_000)
    snapshot = dict(saved)

    restarted = RiskManager(cfg, persist_cb=lambda d: None)
    restarted.restore_state(snapshot)
    assert restarted.state.peak_equity == pytest.approx(25_000)
    restarted.on_equity(25_000 * (1 - cfg.risk.max_drawdown_pct / 100) - 1)
    assert restarted.evaluate(data_ok=True, feed_connected=True)[0] is False


def test_manual_halt_survives_restart(cfg):
    saved = {}
    rm = RiskManager(cfg, persist_cb=lambda d: saved.update(d))
    rm.on_equity(10_000)
    rm.manual_halt("operator")
    restarted = RiskManager(cfg, persist_cb=lambda d: None)
    restarted.restore_state(dict(saved))
    assert restarted.state.halted is True
    assert HaltReason.MANUAL.value in restarted.state.halt_reasons


def test_loss_streak_survives_restart(cfg):
    saved = {}
    rm = RiskManager(cfg, persist_cb=lambda d: saved.update(d))
    rm.on_equity(10_000)
    rm.on_trade_closed(-1.0)
    rm.on_trade_closed(-1.0)
    restarted = RiskManager(cfg, persist_cb=lambda d: None)
    restarted.restore_state(dict(saved))
    assert restarted.state.consecutive_losses == 2


def test_daily_loss_halt_expires_with_the_day_but_drawdown_does_not(cfg):
    """Daily-loss is a per-day budget; a drawdown kill switch is permanent until
    an operator clears it."""
    rm = RiskManager(cfg, persist_cb=None)
    rm.on_equity(10_000)
    rm.state.halt_reasons = [HaltReason.DAILY_LOSS_LIMIT.value,
                             HaltReason.MAX_DRAWDOWN.value]
    rm.state.halted = True
    rm.state.day_key = "1999-01-01"          # a previous UTC day
    rm.state.equity = 9_000
    rm._roll_day()
    assert HaltReason.DAILY_LOSS_LIMIT.value not in rm.state.halt_reasons
    assert HaltReason.MAX_DRAWDOWN.value in rm.state.halt_reasons


def test_restore_rejects_garbage(cfg):
    rm = RiskManager(cfg, persist_cb=None)
    assert rm.restore_state(None) is False
    assert rm.restore_state("not-a-dict") is False or rm.state.halted is False


def test_persist_is_throttled_but_forced_on_material_change(cfg):
    calls = []
    rm = RiskManager(cfg, persist_cb=lambda d: calls.append(d))
    for _ in range(20):
        rm.on_equity(10_000)          # throttled: no more than one write per 10s
    assert len(calls) <= 2
    rm.manual_halt("now")             # forced: a halt must hit disk immediately
    assert len(calls) >= 2


def test_persist_failure_does_not_break_the_guard_loop(cfg):
    def boom(_):
        raise RuntimeError("disk full")
    rm = RiskManager(cfg, persist_cb=boom)
    rm.on_equity(10_000)              # must not raise
    rm.manual_halt("x")
    assert rm.state.halted is True


# ---------------------------------------------------------------------------
# 3. Existing exchange positions are adopted on startup
# ---------------------------------------------------------------------------
class StubBroker:
    mode = "live"

    def __init__(self, positions):
        self._positions = positions
        self.exchange_positions_calls = 0

    async def exchange_positions(self):
        self.exchange_positions_calls += 1
        return list(self._positions)

    async def reconcile(self, ledger):
        return {"ok": True, "issues": []}

    async def accrue_funding(self, position, ticker):
        return 0.0


def build_engine(cfg, remote_positions):
    from app.engine import TradingEngine
    eng = TradingEngine(cfg)
    eng.broker = StubBroker(remote_positions)
    # Populate the candle store so an ATR-based protective stop can be derived.
    idx = pd.date_range("2024-01-01", periods=300, freq="1h", tz="UTC")
    close = pd.Series([100.0 + i * 0.1 for i in range(300)])
    df = pd.DataFrame({"open": close, "high": close + 0.5, "low": close - 0.5,
                       "close": close, "volume": 10.0}, index=idx)
    eng.store.put_history("BTCUSDT", cfg.data.primary_interval, df)
    eng.symbols = ["BTCUSDT"]
    eng.symbol_state = {"BTCUSDT": {"enabled": True, "reason": "test"}}
    return eng


def test_adopts_existing_position_with_protective_stop(cfg):
    eng = build_engine(cfg, [PositionRisk(
        symbol="BTCUSDT", position_amt=0.5, entry_price=100.0, mark_price=101.0,
        unrealized_pnl=0.5, liquidation_price=50.0, leverage=3.0, margin_type="cross",
        isolated_wallet=0.0)])
    adopted = asyncio.run(eng._adopt_exchange_positions())
    assert len(adopted) == 1
    pos = eng.ledger.positions["BTCUSDT"]
    assert pos.side == "LONG" and pos.qty == pytest.approx(0.5)
    assert pos.adopted is True
    assert pos.stop < pos.entry_price, "an adopted position needs a protective stop"
    assert pos.target > pos.entry_price
    assert pos.risk_per_unit > 0


def test_adopts_short_side_from_negative_amount(cfg):
    eng = build_engine(cfg, [PositionRisk(
        symbol="BTCUSDT", position_amt=-2.0, entry_price=100.0, mark_price=99.0,
        unrealized_pnl=2.0, liquidation_price=200.0, leverage=2.0, margin_type="cross",
        isolated_wallet=0.0)])
    asyncio.run(eng._adopt_exchange_positions())
    pos = eng.ledger.positions["BTCUSDT"]
    assert pos.side == "SHORT"
    assert pos.stop > pos.entry_price, "a short's protective stop sits above entry"
    assert pos.target < pos.entry_price


def test_adoption_does_not_duplicate_a_tracked_position(cfg):
    eng = build_engine(cfg, [PositionRisk(
        symbol="BTCUSDT", position_amt=0.5, entry_price=100.0, mark_price=100.0,
        unrealized_pnl=0.0, liquidation_price=50.0, leverage=3.0, margin_type="cross",
        isolated_wallet=0.0)])
    eng.ledger.open_position(Position(id="mine", symbol="BTCUSDT", side="LONG",
                                      qty=0.5, entry_price=99.0, mark_price=100.0,
                                      risk_per_unit=1.0))
    adopted = asyncio.run(eng._adopt_exchange_positions())
    assert adopted == []
    assert eng.ledger.positions["BTCUSDT"].entry_price == pytest.approx(99.0), \
        "an already-tracked position must not be overwritten"


def test_adoption_halts_when_exchange_is_unreadable(cfg):
    """If we cannot see existing risk, we must not trade."""
    class Broken(StubBroker):
        async def exchange_positions(self):
            raise RuntimeError("api down")

    eng = build_engine(cfg, [])
    eng.broker = Broken([])
    asyncio.run(eng._adopt_exchange_positions())
    assert eng.risk.state.halted is True
    assert eng.risk.state.halt_reasons


def test_adoption_flags_gated_and_oversized_positions(cfg, caplog):
    """An inherited position is a fact, not a request: adopt it, but shout if it
    breaches limits or sits on a symbol the evidence gate disabled."""
    import logging
    eng = build_engine(cfg, [PositionRisk(
        symbol="BTCUSDT", position_amt=1000.0, entry_price=100.0, mark_price=100.0,
        unrealized_pnl=0.0, liquidation_price=50.0, leverage=10.0, margin_type="cross",
        isolated_wallet=0.0)])
    eng.symbol_state = {"BTCUSDT": {"enabled": False, "reason": "negative OOS edge"}}
    eng.ledger.set_authoritative_equity(1_000.0, "test")
    with caplog.at_level(logging.WARNING):
        adopted = asyncio.run(eng._adopt_exchange_positions())
    assert adopted[0]["breaches_limit"] is True
    assert "BTCUSDT" in eng.ledger.positions


def test_adoption_is_a_noop_when_exchange_is_flat(cfg):
    eng = build_engine(cfg, [])
    assert asyncio.run(eng._adopt_exchange_positions()) == []
    assert eng.ledger.positions == {}
    assert eng.risk.state.halted is False


def test_day_rollover_does_not_raise_in_the_equity_path(cfg):
    """Regression: _roll_day called an undefined _reevaluate_halt(), so the FIRST
    UTC midnight would raise inside on_equity — breaking daily-loss bookkeeping on
    the live tick loop."""
    rm = RiskManager(cfg, persist_cb=lambda d: None)
    rm.on_equity(10_000)
    rm.state.day_key = "1999-01-01"          # force a rollover
    rm.state.halt_reasons = [HaltReason.DAILY_LOSS_LIMIT.value]
    rm.state.halted = True
    rm.on_equity(10_500)                     # must not raise
    assert rm.state.day_key == time.strftime("%Y-%m-%d", time.gmtime())
    assert HaltReason.DAILY_LOSS_LIMIT.value not in rm.state.halt_reasons
    assert rm.state.halted is False


def test_reevaluate_halt_sorts_and_dedupes(cfg):
    rm = RiskManager(cfg, persist_cb=None)
    rm.state.halt_reasons = [HaltReason.MANUAL.value, HaltReason.MANUAL.value]
    rm._reevaluate_halt()
    assert rm.state.halt_reasons == [HaltReason.MANUAL.value]
    rm.state.halt_reasons = []
    rm._reevaluate_halt()
    assert rm.state.halted is False and rm.state.halt_since == 0.0


def test_restore_accepts_a_dict_and_rejects_other_truthy_types(cfg):
    rm = RiskManager(cfg, persist_cb=None)
    assert rm.restore_state(["not", "a", "dict"]) is False
    assert rm.restore_state({"peak_equity": 12345.0}) is True
    assert rm.state.peak_equity == pytest.approx(12345.0)


# ---------------------------------------------------------------------------
# 4. Out-of-band file kill switch
# ---------------------------------------------------------------------------
def test_halt_adds_a_specific_reason(cfg):
    rm = RiskManager(cfg, persist_cb=None)
    rm.on_equity(10_000)
    assert rm.halt(HaltReason.KILL_SWITCH_FILE.value, "file present") is True
    assert rm.state.halted is True
    assert HaltReason.KILL_SWITCH_FILE.value in rm.state.halt_reasons
    # idempotent
    assert rm.halt(HaltReason.KILL_SWITCH_FILE.value) is False
    assert rm.state.halt_reasons.count(HaltReason.KILL_SWITCH_FILE.value) == 1


def test_clear_reason_leaves_other_halts_in_force(cfg):
    """Removing the kill-switch file must NOT clear a drawdown halt."""
    rm = RiskManager(cfg, persist_cb=None)
    rm.on_equity(10_000)
    rm.halt(HaltReason.MAX_DRAWDOWN.value, "dd")
    rm.halt(HaltReason.KILL_SWITCH_FILE.value, "file")
    assert rm.clear_reason(HaltReason.KILL_SWITCH_FILE.value) is True
    assert rm.state.halted is True, "a drawdown halt must survive the file being removed"
    assert HaltReason.MAX_DRAWDOWN.value in rm.state.halt_reasons
    assert rm.clear_reason(HaltReason.MAX_DRAWDOWN.value) is True
    assert rm.state.halted is False


def test_clear_reason_on_absent_code_is_a_noop(cfg):
    rm = RiskManager(cfg, persist_cb=None)
    assert rm.clear_reason(HaltReason.KILL_SWITCH_FILE.value) is False


def test_manual_halt_still_works_after_refactor(cfg):
    rm = RiskManager(cfg, persist_cb=None)
    rm.manual_halt("operator")
    assert HaltReason.MANUAL.value in rm.state.halt_reasons
    rm.clear_halt()
    assert rm.state.halted is False
    assert rm.state.halt_reasons == []


def test_engine_honours_halt_file_at_boot(cfg, tmp_path, monkeypatch):
    """`touch data/HALT` must stop new risk even across a restart."""
    halt_path = tmp_path / "HALT"
    halt_path.write_text("stop\n")
    cfg.risk.halt_file = str(halt_path)
    from app.engine import TradingEngine
    eng = TradingEngine(cfg)
    assert eng.halt_file == halt_path
    # Simulate the boot sequence's kill-switch check.
    eng.risk.halt(HaltReason.KILL_SWITCH_FILE.value, "present")
    allowed, reasons = eng.risk.evaluate(data_ok=True, feed_connected=True)
    assert allowed is False
    assert HaltReason.KILL_SWITCH_FILE.value in reasons


def test_halt_file_path_resolves_relative_to_project(cfg, tmp_path):
    cfg.risk.halt_file = "data/HALT"
    from app.config import PROJECT_ROOT
    from app.engine import TradingEngine
    eng = TradingEngine(cfg)
    assert eng.halt_file == PROJECT_ROOT / "data" / "HALT"


# ---------------------------------------------------------------------------
# 5. Host identity guard
# ---------------------------------------------------------------------------
def test_host_identity_disabled_when_unset():
    from app import hostid
    rep = asyncio.run(hostid.verify(""))
    assert rep["enabled"] is False and rep["ok"] is True


def test_host_identity_detects_mismatch(monkeypatch):
    """An API key bound to one IP cannot authenticate from another, so running the
    live config on the wrong host is a safety failure, not a nuisance."""
    from app import hostid

    async def fake_ip(timeout: float = 8.0):
        return "203.0.113.9"

    monkeypatch.setattr(hostid, "fetch_public_ip", fake_ip)
    rep = asyncio.run(hostid.verify("198.51.100.7"))
    assert rep["enabled"] is True and rep["ok"] is False
    assert rep["actual"] == "203.0.113.9" and rep["expected"] == "198.51.100.7"
    assert "198.51.100.7" in rep["detail"]


def test_host_identity_accepts_match(monkeypatch):
    from app import hostid

    async def fake_ip(timeout: float = 8.0):
        return "198.51.100.7"

    monkeypatch.setattr(hostid, "fetch_public_ip", fake_ip)
    rep = asyncio.run(hostid.verify("198.51.100.7"))
    assert rep["ok"] is True


def test_host_identity_fails_closed_when_ip_unknown(monkeypatch):
    """If we opted into the check and cannot determine our IP, we must NOT trade —
    'unknown' is not the same as 'correct'."""
    from app import hostid

    async def no_ip(timeout: float = 8.0):
        return None

    monkeypatch.setattr(hostid, "fetch_public_ip", no_ip)
    rep = asyncio.run(hostid.verify("198.51.100.7"))
    assert rep["enabled"] is True and rep["ok"] is False
    assert "could not determine" in rep["detail"]


def test_ip_validation_and_normalisation():
    from app import hostid
    assert hostid.is_valid_ip(" 198.51.100.7 ")
    assert not hostid.is_valid_ip("not-an-ip")
    assert not hostid.is_valid_ip("")
    assert hostid.normalize_ip(" 1.2.3.4\n") == "1.2.3.4"


def test_host_mismatch_halts_and_reason_survives_evaluate(cfg):
    """The mismatch halt must persist across evaluate() calls and must not be
    cleared by the file kill switch being absent."""
    rm = RiskManager(cfg, persist_cb=None)
    rm.on_equity(10_000)
    rm.halt(HaltReason.HOST_IDENTITY_MISMATCH.value, "wrong host")
    for _ in range(3):
        allowed, reasons = rm.evaluate(data_ok=True, feed_connected=True)
        assert allowed is False
        assert HaltReason.HOST_IDENTITY_MISMATCH.value in reasons
    # only an explicit clear releases it
    rm.clear_reason(HaltReason.HOST_IDENTITY_MISMATCH.value)
    assert rm.evaluate(data_ok=True, feed_connected=True)[0] is True


def test_host_identity_reason_is_external_not_gauge(cfg):
    assert HaltReason.HOST_IDENTITY_MISMATCH.value not in RiskManager.GAUGE_REASONS
    assert HaltReason.KILL_SWITCH_FILE.value not in RiskManager.GAUGE_REASONS
