#!/usr/bin/env python3
"""ORDER SIZING PRECISION — quantities must survive the lot-step rounding exactly.

Regression origin
-----------------
`_round_qty` was `math.floor(qty / step) * step` on binary floats. Floats cannot represent most
decimal lot steps, so the division landed just below the intended integer and the floor dropped a
WHOLE EXTRA STEP. Measured before the fix:

    step 0.1:    0.3   -> 0.2     <-- 33% under, and 0.3 IS an exact multiple of 0.1
    step 0.1:    8.2   -> 8.1
    step 0.001:  1.005 -> 1.004

Those are not conservative rounding — they corrupt quantities that were already on the grid. The
position then differs from the size the risk gate just approved for it, so realized risk-per-trade
is not the modelled risk-per-trade; and on the exit path a close of 0.3 that sends 0.2 leaves a
residual position open.

Note on `2.675 @ step 0.1 -> 2.6`: that one is CORRECT. 2.675 is not a multiple of 0.1, so flooring
is the right answer. It is included below as a control, so that a future "fix" which rounds
everything to the nearest step instead of down will fail this suite.

The property test is the important one: it sweeps many step/precision combinations and asserts
`round(k * step) == k * step` for every k, which is exactly the invariant the float version broke.

Run: python3 -m pytest tests/test_sizing_precision.py -q
"""
from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.core.config import Config  # noqa: E402
from gpkg.execution.executor import Executor  # noqa: E402


class _Rest:
    """The rounder never touches the exchange, but Executor requires a client."""


def make_executor(**steps) -> Executor:
    cfg = Config(api_key="k", api_secret="s", symbols=list(steps), db_path=":memory:")
    return Executor(cfg, _Rest(), steps)


def make_executor_min(steps: dict, mins: dict) -> Executor:
    cfg = Config(api_key="k", api_secret="s", symbols=list(steps), db_path=":memory:")
    return Executor(cfg, _Rest(), steps, min_sizes=mins)


# =============================================================================================
# The exact cases that were wrong
# =============================================================================================
def test_exact_multiples_are_preserved_at_step_0_1():
    """THE regression. 0.3 and 8.2 are already valid lot sizes."""
    ex = make_executor(BTCUSDT=0.1)
    assert ex._round_qty("BTCUSDT", "0.3") == "0.3", "0.3 is a multiple of 0.1 and must survive"
    assert ex._round_qty("BTCUSDT", "8.2") == "8.2"
    assert ex._round_qty("BTCUSDT", 0.3) == "0.3", "float input must round-trip through str()"


def test_exact_multiples_are_preserved_at_step_0_001():
    ex = make_executor(BTCUSDT=0.001)
    assert ex._round_qty("BTCUSDT", "1.005") == "1.005"
    assert ex._round_qty("BTCUSDT", "0.001") == "0.001"
    assert ex._round_qty("BTCUSDT", "12.34") == "12.34"


def test_control_genuine_floor_still_floors_down():
    """Not a bug: 2.675 has no exact representation on a 0.1 grid, so it must floor to 2.6.
    A regression to round-to-nearest would break this."""
    ex = make_executor(BTCUSDT=0.1)
    assert ex._round_qty("BTCUSDT", "2.675") == "2.6"
    assert ex._round_qty("BTCUSDT", "0.25") == "0.2"
    assert ex._round_qty("BTCUSDT", "1.9999") == "1.9"


def test_plain_flooring_cases():
    ex = make_executor(BTCUSDT=0.001, ETHUSDT=1, SOLUSDT=0.01)
    assert ex._round_qty("BTCUSDT", "1.2349") == "1.234"
    assert ex._round_qty("ETHUSDT", "3.9") == "3"
    assert ex._round_qty("ETHUSDT", "3") == "3"
    assert ex._round_qty("SOLUSDT", "5.67") == "5.67"


def test_never_rounds_up():
    """Rounding up can exceed the risk budget and is rejected by the venue."""
    ex = make_executor(BTCUSDT=0.1)
    for q in ["0.31", "0.39", "0.999", "1.09", "9.99"]:
        out = Decimal(ex._round_qty("BTCUSDT", q))
        assert out <= Decimal(q), f"{q} rounded UP to {out}"


# =============================================================================================
# The invariant that actually matters — a property sweep
# =============================================================================================
@pytest.mark.parametrize("step", ["0.001", "0.01", "0.1", "1", "10", "0.5", "0.25", "100"])
def test_every_grid_point_is_a_fixed_point(step):
    """round(k * step) == k * step, for many k.

    This is the invariant the float implementation violated, and it is what a per-case test would
    only sample. It is the reason step 0.1 (common on altcoin perpetuals) silently mis-sized orders.
    """
    ex = make_executor(BTCUSDT=step)
    dstep = Decimal(step)
    offenders = []
    for k in range(1, 300):
        want = (dstep * k).normalize()
        want_s = format(want, "f")
        got = ex._round_qty("BTCUSDT", want_s)
        if Decimal(got) != want:
            offenders.append((want_s, got))
    assert not offenders, f"grid points not preserved at step {step}: {offenders[:5]}"


@pytest.mark.parametrize("step", ["0.001", "0.1", "1"])
def test_float_inputs_land_on_the_grid_too(step):
    """The engine passes floats, so the float->Decimal conversion must not reintroduce the error."""
    ex = make_executor(BTCUSDT=step)
    for k in range(1, 120):
        f = float(Decimal(step) * k)
        got = Decimal(ex._round_qty("BTCUSDT", f))
        # Must never exceed the intended size, and must not lose a whole step.
        want = Decimal(step) * k
        assert got <= want, f"oversize: {f} -> {got}"
        assert want - got < Decimal(step), f"lost a full step: {f} -> {got}"


# =============================================================================================
# Refusals
# =============================================================================================
def test_unknown_step_is_refused():
    ex = make_executor(BTCUSDT=0.001)
    with pytest.raises(RuntimeError, match="step size unknown"):
        ex._round_qty("NOSUCH", "1")


def test_zero_step_is_refused():
    ex = make_executor(BTCUSDT=0.0)
    with pytest.raises(RuntimeError, match="step size unknown"):
        ex._round_qty("BTCUSDT", "1")


def test_rounding_to_zero_is_refused():
    ex = make_executor(BTCUSDT=0.1)
    with pytest.raises(RuntimeError, match="rounds to 0"):
        ex._round_qty("BTCUSDT", "0.05")


def test_non_positive_and_non_finite_input_is_refused():
    ex = make_executor(BTCUSDT=0.001)
    for bad in ["0", "-1", "NaN", "Infinity", "-Infinity"]:
        with pytest.raises(RuntimeError):
            ex._round_qty("BTCUSDT", bad)


def test_garbage_input_is_refused():
    ex = make_executor(BTCUSDT=0.001)
    with pytest.raises(RuntimeError):
        ex._round_qty("BTCUSDT", "not-a-number")


# =============================================================================================
# Output format — what goes on the wire
# =============================================================================================
def test_output_has_no_trailing_zeros_and_no_exponent():
    ex = make_executor(BTCUSDT=0.001, ETHUSDT=1)
    assert ex._round_qty("ETHUSDT", "100") == "100"
    assert "E" not in ex._round_qty("ETHUSDT", "1000")
    assert "+" not in ex._round_qty("ETHUSDT", "1000")
    assert ex._round_qty("BTCUSDT", "0.100") == "0.1"
    assert ex._round_qty("BTCUSDT", "0.00100000") == "0.001"
    assert ex._round_qty("BTCUSDT", "1.2300000") == "1.23"


# =============================================================================================
# Entry minimum
# =============================================================================================
def test_entry_minimum_is_enforced_with_decimal_comparison():
    ex = make_executor_min({"BTCUSDT": 0.001}, {"BTCUSDT": 0.002})
    ok, reason = ex.check_entry_size("BTCUSDT", "0.001")
    assert ok is False and "below_min" in reason
    ok2, _ = ex.check_entry_size("BTCUSDT", "0.002")
    assert ok2 is True


def test_entry_minimum_boundary_is_not_float_confused():
    """`float(qty_s) < mn` would be true for 0.3 vs 0.3 in binary; Decimal is not."""
    ex = make_executor_min({"BTCUSDT": 0.1}, {"BTCUSDT": 0.3})
    ok, reason = ex.check_entry_size("BTCUSDT", "0.3")
    assert ok is True, f"0.3 rejected against a 0.3 minimum: {reason}"


# =============================================================================================
# Structural guard: the duplicated rule must not come back
# =============================================================================================
def test_engine_does_not_reimplement_rounding_with_float_math():
    """The rounding rule lived in BOTH gigpilot.py and the executor. Two copies mean only one can be
    right, and the engine's copy was the buggy one. This pins that the engine delegates instead."""
    src = (ROOT / "gigpilot.py").read_text()
    assert "math.floor((notional" not in src, (
        "gigpilot.py reintroduced float lot-rounding; it must delegate to Executor._round_qty"
    )
    assert "_round_qty(symbol, notional / entry_px)" in src, (
        "gigpilot.py no longer delegates sizing to the executor's Decimal rounder"
    )
