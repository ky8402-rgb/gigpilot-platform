"""Pre-trade risk gate enforcing hard bounds on live futures accounts.

Enforces:
  - System must be armed.
  - Equity must be positive (> 0).
  - Maximum leverage cap (e.g. 3.0x).
  - Daily loss limit percentage based on day-start equity.
  - Maximum maintenance margin ratio (< 0.60).
  - Maximum concurrent position count.
  - Per-symbol concentration limit (% of equity).
  - Gross portfolio exposure limit (% of equity).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from gpkg.core.config import Config


@dataclass
class Portfolio:
    equity: float = 0.0
    daily_pnl: float = 0.0
    gross_notional: float = 0.0
    symbol_notional: dict[str, float] = field(default_factory=dict)
    open_positions: int = 0
    margin_ratio: float = 0.0


class RiskGate:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def check(
        self,
        p: Portfolio,
        symbol: str,
        notional: float,
        leverage: float,
        armed: bool,
        day_start_equity: float,
    ) -> tuple[bool, str]:
        if not armed:
            return False, "not_armed"
        if p.equity <= 0:
            return False, "no_equity"
        if leverage > self.cfg.max_leverage:
            return False, f"leverage_{leverage:.2f}_gt_{self.cfg.max_leverage}"
        if day_start_equity > 0:
            loss_pct = -p.daily_pnl / day_start_equity * 100.0
            if loss_pct >= self.cfg.max_daily_loss_pct:
                return False, f"daily_loss_{loss_pct:.2f}pct"
        if p.margin_ratio > 0.6:
            return False, f"margin_ratio_{p.margin_ratio:.2f}"
        if p.open_positions >= self.cfg.max_concurrent_positions:
            return False, "max_concurrent"
        if p.symbol_notional.get(symbol, 0.0) + notional > p.equity * self.cfg.max_symbol_notional_pct / 100.0:
            return False, "symbol_concentration"
        if p.gross_notional + notional > p.equity * self.cfg.max_gross_notional_pct / 100.0:
            return False, "gross_exposure"
        return True, "ok"
