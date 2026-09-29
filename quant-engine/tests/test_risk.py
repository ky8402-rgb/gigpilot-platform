"""Risk limits and sizing. These are the last line of defence, so they get the
most adversarial tests in the suite."""
import time

import pytest

from app.config import load_config
from app.risk import HaltReason, RiskManager, round_step, size_position
from app.strategy import Setup


class Spec:
    step_size = 0.001
    min_qty = 0.001
    min_notional = 5.0


class Tk:
    def __init__(self, mid=50_000.0):
        self.mid = mid
        self.last = mid
        self.bid = mid * 0.9999
        self.ask = mid * 1.0001


@pytest.fixture
def cfg():
    return load_config()


def setup(price=50_000.0, risk_unit=1_000.0):
    return Setup(symbol="BTCUSDT", direction="LONG", price=price,
                 risk_per_unit=risk_unit, stop=price - risk_unit, target=price + risk_unit)


def test_risk_amount_is_exact(cfg):
    """Sizing to the stop must risk exactly risk_per_trade_pct of equity."""
    eq = 10_000.0
    r = size_position(setup(price=50_000, risk_unit=1_000), eq, Tk(), Spec(), cfg)
    expected_risk = eq * cfg.risk.risk_per_trade_pct / 100.0  # 0.5% -> $50
    assert r["qty"] * 1_000.0 == pytest.approx(expected_risk, rel=0.02)


def test_notional_cap_binds_for_tight_stops(cfg):
    """A tiny stop would demand huge size; the notional cap must bind first."""
    eq = 10_000.0
    r = size_position(setup(price=50_000, risk_unit=1.0), eq, Tk(), Spec(), cfg)
    assert r["binding"] in ("notional_cap", "max_leverage")
    assert r["notional"] <= eq * cfg.risk.max_position_notional_pct / 100.0 + 1e-6


def test_leverage_never_exceeds_cap(cfg):
    eq = 10_000.0
    for risk_unit in (1.0, 10.0, 100.0, 1_000.0):
        r = size_position(setup(price=50_000, risk_unit=risk_unit), eq, Tk(), Spec(), cfg)
        if r["qty"] > 0:
            assert (r["qty"] * 50_000) / eq <= cfg.risk.max_leverage + 1e-9


def test_step_rounding_and_min_notional_rejection(cfg):
    eq = 10.0  # tiny account
    r = size_position(setup(price=50_000, risk_unit=1_000), eq, Tk(), Spec(), cfg)
    assert r["qty"] == 0.0
    assert "min" in r["reason"] or "step" in r["reason"]


def test_zero_or_negative_inputs_reject(cfg):
    assert size_position(setup(price=0), 10_000, Tk(), Spec(), cfg)["qty"] == 0.0
    assert size_position(setup(risk_unit=0), 10_000, Tk(), Spec(), cfg)["qty"] == 0.0
    assert size_position(setup(), 0, Tk(), Spec(), cfg)["qty"] == 0.0


def test_round_step():
    assert round_step(1.2349, 0.001) == pytest.approx(1.234)
    assert round_step(0.0009, 0.001) == 0.0


def test_drawdown_triggers_kill_switch(cfg):
    rm = RiskManager(cfg)
    rm.on_equity(10_000)
    rm.on_equity(10_000 * (1 - cfg.risk.max_drawdown_pct / 100.0) - 1)
    allowed, reasons = rm.evaluate()
    assert allowed is False
    assert HaltReason.MAX_DRAWDOWN.value in reasons


def test_daily_loss_limit_triggers_halt(cfg):
    rm = RiskManager(cfg)
    rm.on_equity(10_000)
    rm.on_equity(10_000 * (1 - cfg.risk.daily_loss_limit_pct / 100.0) - 1)
    allowed, reasons = rm.evaluate()
    assert allowed is False
    assert HaltReason.DAILY_LOSS_LIMIT.value in reasons


def test_consecutive_losses_halt(cfg):
    rm = RiskManager(cfg)
    rm.on_equity(10_000)
    for _ in range(cfg.risk.max_consecutive_losses):
        rm.on_trade_closed(-10.0)
    allowed, reasons = rm.evaluate()
    assert allowed is False
    assert HaltReason.CONSECUTIVE_LOSSES.value in reasons
    rm.on_trade_closed(5.0)
    assert rm.state.consecutive_losses == 0


def test_stale_data_fails_closed(cfg):
    rm = RiskManager(cfg)
    rm.on_equity(10_000)
    allowed, reasons = rm.evaluate(data_ok=False)
    assert allowed is False
    assert HaltReason.STALE_DATA.value in reasons


def test_feed_down_fails_closed(cfg):
    rm = RiskManager(cfg)
    rm.on_equity(10_000)
    allowed, reasons = rm.evaluate(feed_connected=False)
    assert allowed is False
    assert HaltReason.FEED_DOWN.value in reasons


def test_manual_halt_and_clear(cfg):
    rm = RiskManager(cfg)
    rm.on_equity(10_000)
    rm.manual_halt()
    # Health flags are passed explicitly: they now default to the unsafe values,
    # so an omitted argument halts rather than silently permitting.
    assert rm.evaluate(data_ok=True, feed_connected=True)[0] is False
    rm.clear_halt()
    assert rm.evaluate(data_ok=True, feed_connected=True)[0] is True


def test_exposure_limits(cfg):
    rm = RiskManager(cfg)
    rm.on_equity(10_000)

    ok, why = rm.check_exposure(1_000, 0, 0, cfg.risk.max_concurrent_positions)
    assert ok is False and "concurrent" in why

    ok, why = rm.check_exposure(10_000, 0, 0, 0)
    assert ok is False and "notional" in why

    ok, why = rm.check_exposure(100, 10_000, 0, 0)
    assert ok is False and "gross" in why

    ok, why = rm.check_exposure(100, 0, 500, 0)
    assert ok is False and "already has exposure" in why

    ok, _ = rm.check_exposure(100, 0, 0, 0)
    assert ok is True
