"""Dynamic capital-velocity sizing (Hamiltonian / fractional Kelly).

Sizing is computed against the venue's *usable* balance (`/v5/account/wallet-balance`), never against
equity that already backs an open position. The quantity is produced as a DECIMAL STRING aligned to
the instrument's contract step, exactly as `Executor._round_qty` emits, so a computed size survives a
round-trip to the wire without a float.

The Kelly fraction is deliberately conservative (default quarter-Kelly) and is floored at zero: Kelly
with a negative or undefined edge must allocate nothing, not short the strategy. When the sized lot
falls below the venue minimum, the fallback snaps to that minimum rather than emitting a quantity the
exchange would reject — and the caller is told WHY via `Sizing.reason`, so a minimum-lot trade is a
visible event, not a silent surprise.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal


@dataclass(frozen=True)
class Sizing:
    qty: str          # step-aligned decimal string, ready for the wire
    notional: float   # qty * price, informational
    kelly_f: float    # the fractional-Kelly allocation that produced this size
    reason: str       # 'ok' | 'snapped_to_min' | 'no_trade'


def fractional_kelly(win_rate: float, payoff_ratio: float, fraction: float = 0.25) -> float:
    """fraction * max(0, (win_rate*(payoff+1) - 1) / payoff).

    `payoff_ratio` is avg_win / avg_loss (both positive). Invalid or non-positive-edge inputs return
    0.0 — allocating to a strategy with no measured edge is the error this function exists to prevent.
    """
    if fraction < 0.0:
        raise ValueError("kelly fraction must be non-negative")
    if not (0.0 < win_rate < 1.0) or payoff_ratio <= 0.0:
        return 0.0
    k = (win_rate * (payoff_ratio + 1.0) - 1.0) / payoff_ratio
    return fraction * max(0.0, k)


def _fmt_dec(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def size_order_qty(
    equity: float,
    kelly_f: float,
    price: float,
    step_size: float,
    min_qty: float,
) -> Sizing:
    """Size an order to `equity * kelly_f` notional, floored to the contract step.

    Returns `qty` as a decimal string so it never round-trips through a float (which would corrupt
    quantities that are already exact multiples of the step — see `Executor._round_qty`).
    """
    if equity <= 0.0 or price <= 0.0 or kelly_f <= 0.0 or step_size <= 0.0:
        return Sizing(qty="0", notional=0.0, kelly_f=kelly_f, reason="no_trade")

    notional = equity * kelly_f
    qty = Decimal(str(notional)) / Decimal(str(price))
    step = Decimal(str(step_size))
    qty_step = (qty / step).to_integral_value(rounding=ROUND_FLOOR) * step

    min_dec = Decimal(str(min_qty))
    reason = "ok"
    if qty_step < min_dec:
        # The venue minimum is the hard floor: submitting less is a guaranteed reject, and a
        # "skip" here would leave capital unallocated when the account is too small to size a
        # fractional-Kelly lot. Snap up to the minimum and surface it.
        qty_step = min_dec
        reason = "snapped_to_min"

    return Sizing(
        qty=_fmt_dec(qty_step),
        notional=float(qty_step) * price,
        kelly_f=kelly_f,
        reason=reason,
    )
