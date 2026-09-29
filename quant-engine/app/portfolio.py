"""Portfolio ledger: positions, orders, fills, and honest cost accounting.

Every number the dashboard shows is derived here, and every derivation is
documented. Specifically:

  gross_pnl        = price move x qty                  (before any cost)
  fees_paid        = sum of exchange commissions
  funding_paid     = sum of funding settlements (signed; negative = we received)
  slippage_cost    = (actual fill price - decision price) x qty, adverse positive
  net_pnl          = gross_pnl - fees - funding - slippage
  equity           = starting_equity + realized_net + unrealized_net

Nothing is smoothed, annualised, or otherwise dressed up. If the strategy is
losing money after costs, the ledger says so immediately.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from .logging_setup import get_logger

log = get_logger("portfolio")


@dataclass
class Position:
    id: str
    symbol: str
    side: str                       # LONG | SHORT
    qty: float
    entry_price: float
    mark_price: float = 0.0
    stop: float = 0.0
    target: float = 0.0
    initial_stop: float = 0.0
    leverage: float = 1.0
    risk_per_unit: float = 0.0
    opened_at: float = field(default_factory=time.time)
    fees_paid: float = 0.0
    funding_paid: float = 0.0
    slippage_cost: float = 0.0
    breakeven_moved: bool = False
    trailing_active: bool = False
    mode: str = "paper"
    entry_decision_price: float = 0.0
    strategy_reason: str = ""
    expected_edge_bps: float = 0.0
    cost_bps_at_entry: float = 0.0
    # True when this position was discovered on the exchange at startup rather
    # than opened by this process. Surfaced in the UI so an inherited position is
    # never mistaken for one the strategy chose.
    adopted: bool = False

    @property
    def notional(self) -> float:
        return abs(self.qty) * self.mark_price

    @property
    def unrealized_gross(self) -> float:
        if self.side == "LONG":
            return (self.mark_price - self.entry_price) * self.qty
        return (self.entry_price - self.mark_price) * self.qty

    @property
    def unrealized_net(self) -> float:
        return self.unrealized_gross - self.fees_paid - self.funding_paid

    @property
    def r_now(self) -> float:
        if self.risk_per_unit <= 0:
            return 0.0
        move = (
            (self.mark_price - self.entry_price)
            if self.side == "LONG"
            else (self.entry_price - self.mark_price)
        )
        return move / self.risk_per_unit

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "side": self.side,
            "qty": self.qty,
            "entry_price": self.entry_price,
            "mark_price": self.mark_price,
            "stop": self.stop,
            "target": self.target,
            "initial_stop": self.initial_stop,
            "leverage": self.leverage,
            "notional": round(self.notional, 2),
            "unrealized_gross": round(self.unrealized_gross, 4),
            "unrealized_net": round(self.unrealized_net, 4),
            "fees_paid": round(self.fees_paid, 4),
            "funding_paid": round(self.funding_paid, 4),
            "slippage_cost": round(self.slippage_cost, 4),
            "r_now": round(self.r_now, 3),
            "opened_at": self.opened_at,
            "opened_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.opened_at)),
            "breakeven_moved": self.breakeven_moved,
            "trailing_active": self.trailing_active,
            "mode": self.mode,
            "strategy_reason": self.strategy_reason,
            "expected_edge_bps": round(self.expected_edge_bps, 2),
            "cost_bps_at_entry": round(self.cost_bps_at_entry, 2),
            "adopted": self.adopted,
        }


@dataclass
class Trade:
    id: str
    symbol: str
    side: str
    qty: float
    entry_price: float
    exit_price: float
    gross_pnl: float
    fees: float
    funding: float
    slippage: float
    net_pnl: float
    r_multiple: float
    opened_at: float
    closed_at: float
    exit_reason: str
    bars_held: int = 0
    mode: str = "paper"
    strategy_reason: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "symbol": self.symbol, "side": self.side, "qty": self.qty,
            "entry_price": self.entry_price, "exit_price": self.exit_price,
            "gross_pnl": round(self.gross_pnl, 4), "fees": round(self.fees, 4),
            "funding": round(self.funding, 4), "slippage": round(self.slippage, 4),
            "net_pnl": round(self.net_pnl, 4), "r_multiple": round(self.r_multiple, 3),
            "opened_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.opened_at)),
            "closed_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.closed_at)),
            "exit_reason": self.exit_reason, "bars_held": self.bars_held,
            "mode": self.mode, "strategy_reason": self.strategy_reason,
        }


@dataclass
class OrderRecord:
    id: str
    symbol: str
    side: str
    qty: float
    order_type: str
    status: str
    price: float = 0.0
    avg_fill_price: float = 0.0
    filled_qty: float = 0.0
    fee: float = 0.0
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    reduce_only: bool = False
    error: str = ""
    mode: str = "paper"
    intent: str = "entry"
    exchange_order_id: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id, "symbol": self.symbol, "side": self.side,
            "qty": self.qty, "order_type": self.order_type, "status": self.status,
            "price": self.price, "avg_fill_price": self.avg_fill_price,
            "filled_qty": self.filled_qty, "fee": round(self.fee, 6),
            "created_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.created_at)),
            "updated_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.updated_at)),
            "reduce_only": self.reduce_only, "error": self.error, "mode": self.mode,
            "intent": self.intent, "exchange_order_id": self.exchange_order_id,
        }


class Ledger:
    """Mutable account state with optional SQLite durability."""

    def __init__(self, starting_equity: float, db_path: Optional[Path] = None, persist: bool = True):
        self.starting_equity = starting_equity
        self.cash_equity = starting_equity
        # LIVE MODE: the exchange is the authority on account equity. Internal
        # accounting can drift (missed fills, fees, funding, manual trades), and a
        # drift in the equity basis is a drift in every position size. When set,
        # this value overrides internal accounting for all risk decisions.
        self._authoritative_equity: Optional[float] = None
        self.equity_source: str = "accounting"
        self.realized_gross = 0.0
        self.realized_net = 0.0
        self.total_fees = 0.0
        self.total_funding = 0.0
        self.total_slippage = 0.0
        self.positions: Dict[str, Position] = {}
        self.trades: List[Trade] = []
        self.orders: List[OrderRecord] = []
        self.equity_curve: List[Dict[str, float]] = []
        self._persist = persist
        self.db_path = Path(db_path) if db_path else None
        self._conn: Optional[sqlite3.Connection] = None
        if self._persist and self.db_path:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._init_schema()

    def _init_schema(self) -> None:
        assert self._conn is not None
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY, symbol TEXT, side TEXT, qty REAL,
                entry_price REAL, exit_price REAL, gross_pnl REAL, fees REAL,
                funding REAL, slippage REAL, net_pnl REAL, r_multiple REAL,
                opened_at REAL, closed_at REAL, exit_reason TEXT, bars_held INTEGER,
                mode TEXT, payload TEXT
            );
            CREATE TABLE IF NOT EXISTS equity (
                ts REAL PRIMARY KEY, equity REAL, realized_net REAL, unrealized REAL,
                gross_exposure REAL, open_positions INTEGER
            );
            CREATE TABLE IF NOT EXISTS events (
                ts REAL, kind TEXT, payload TEXT
            );
            """
        )
        self._conn.commit()

    # -- positions ---------------------------------------------------------
    def open_position(self, pos: Position) -> None:
        self.positions[pos.symbol] = pos

    def get(self, symbol: str) -> Optional[Position]:
        return self.positions.get(symbol)

    def mark(self, prices: Dict[str, float]) -> None:
        for sym, pos in self.positions.items():
            px = prices.get(sym)
            if px and px > 0:
                pos.mark_price = px
            elif pos.mark_price <= 0:
                pos.mark_price = pos.entry_price

    def close_position(self, symbol: str, exit_price: float, reason: str,
                       fees: float = 0.0, funding: float = 0.0,
                       bars_held: int = 0) -> Optional[Trade]:
        pos = self.positions.pop(symbol, None)
        if pos is None:
            return None
        pos.fees_paid += fees
        pos.funding_paid += funding
        gross = (
            (exit_price - pos.entry_price) * pos.qty
            if pos.side == "LONG"
            else (pos.entry_price - exit_price) * pos.qty
        )
        net = gross - pos.fees_paid - pos.funding_paid
        r_mult = (net / (pos.risk_per_unit * abs(pos.qty))) if pos.risk_per_unit > 0 else 0.0
        trade = Trade(
            id=pos.id, symbol=symbol, side=pos.side, qty=pos.qty,
            entry_price=pos.entry_price, exit_price=exit_price,
            gross_pnl=gross, fees=pos.fees_paid, funding=pos.funding_paid,
            slippage=pos.slippage_cost, net_pnl=net, r_multiple=r_mult,
            opened_at=pos.opened_at, closed_at=time.time(), exit_reason=reason,
            bars_held=bars_held, mode=pos.mode, strategy_reason=pos.strategy_reason,
        )
        self.trades.append(trade)
        self.realized_gross += gross
        self.realized_net += net
        self.total_fees += pos.fees_paid
        self.total_funding += pos.funding_paid
        self.total_slippage += pos.slippage_cost
        self.cash_equity += net
        if self._conn is not None:
            try:
                self._conn.execute(
                    "INSERT OR REPLACE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (trade.id, trade.symbol, trade.side, trade.qty, trade.entry_price,
                     trade.exit_price, trade.gross_pnl, trade.fees, trade.funding,
                     trade.slippage, trade.net_pnl, trade.r_multiple, trade.opened_at,
                     trade.closed_at, trade.exit_reason, trade.bars_held, trade.mode,
                     json.dumps(trade.as_dict())),
                )
                self._conn.commit()
            except sqlite3.Error as exc:
                log.warning("trade persist failed", extra={"error": str(exc)})
        return trade

    # -- valuation ---------------------------------------------------------
    @property
    def unrealized_net(self) -> float:
        return sum(p.unrealized_net for p in self.positions.values())

    @property
    def gross_exposure(self) -> float:
        return sum(p.notional for p in self.positions.values())

    @property
    def equity(self) -> float:
        if self._authoritative_equity is not None:
            return self._authoritative_equity
        return self.cash_equity + self.unrealized_net

    def set_authoritative_equity(self, equity: float, source: str = "exchange") -> Dict[str, Any]:
        """Adopt the exchange's reported equity as the sizing basis.

        Returns a report so the caller can log a material rebase. The FIRST rebase
        also re-bases `starting_equity`, otherwise every return/drawdown percentage
        would be computed against a configured placeholder balance.
        """
        if equity is None or equity <= 0:
            return {"adopted": False, "reason": "non-positive equity"}
        first = self._authoritative_equity is None
        previous = self.equity
        self._authoritative_equity = float(equity)
        self.equity_source = source
        rebased = False
        if first:
            # Preserve accumulated realized PnL: equity = starting + realized, so
            # starting = equity - realized keeps the accounting identity intact.
            self.starting_equity = max(float(equity) - self.realized_net, 0.01)
            rebased = True
        return {
            "adopted": True,
            "first_sync": first,
            "rebased_starting_equity": rebased,
            "previous_equity": round(previous, 4),
            "adopted_equity": round(float(equity), 4),
            "delta": round(float(equity) - previous, 4),
            "source": source,
        }

    def clear_authoritative_equity(self) -> None:
        self._authoritative_equity = None
        self.equity_source = "accounting"

    def record_equity(self) -> None:
        point = {
            "ts": time.time(),
            "equity": round(self.equity, 4),
            "realized_net": round(self.realized_net, 4),
            "unrealized": round(self.unrealized_net, 4),
            "gross_exposure": round(self.gross_exposure, 2),
            "open_positions": len(self.positions),
        }
        self.equity_curve.append(point)
        if len(self.equity_curve) > 20_000:
            self.equity_curve = self.equity_curve[-20_000:]
        if self._conn is not None:
            try:
                self._conn.execute(
                    "INSERT OR REPLACE INTO equity VALUES (?,?,?,?,?,?)",
                    (point["ts"], point["equity"], point["realized_net"],
                     point["unrealized"], point["gross_exposure"], point["open_positions"]),
                )
                self._conn.commit()
            except sqlite3.Error:
                pass

    # -- risk state persistence -------------------------------------------
    def _ensure_state_table(self) -> None:
        assert self._conn is not None
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS risk_state (id INTEGER PRIMARY KEY CHECK (id=1), payload TEXT)"
        )

    def save_risk_state(self, payload: Dict[str, Any]) -> None:
        """Persist guard state so a kill switch cannot be lost to a restart.

        In-memory-only halt state is a fail-OPEN bug: `watchdog`/systemd restarting
        the process would silently clear a max-drawdown halt and `peak_equity`,
        which is the very trigger for that halt.
        """
        if self._conn is None:
            return
        try:
            self._ensure_state_table()
            self._conn.execute(
                "INSERT OR REPLACE INTO risk_state (id, payload) VALUES (1, ?)",
                (json.dumps(payload, default=str),),
            )
            self._conn.commit()
        except sqlite3.Error as exc:
            log.warning("risk state persist failed", extra={"error": str(exc)})

    def load_risk_state(self) -> Optional[Dict[str, Any]]:
        if self._conn is None:
            return None
        try:
            self._ensure_state_table()
            row = self._conn.execute("SELECT payload FROM risk_state WHERE id=1").fetchone()
            return json.loads(row[0]) if row else None
        except (sqlite3.Error, json.JSONDecodeError):
            return None

    def log_event(self, kind: str, payload: Dict[str, Any]) -> None:
        if self._conn is not None:
            try:
                self._conn.execute(
                    "INSERT INTO events VALUES (?,?,?)",
                    (time.time(), kind, json.dumps(payload, default=str)),
                )
                self._conn.commit()
            except sqlite3.Error:
                pass

    # -- analytics ---------------------------------------------------------
    def stats(self) -> Dict[str, Any]:
        trades = self.trades
        n = len(trades)
        wins = [t for t in trades if t.net_pnl > 0]
        losses = [t for t in trades if t.net_pnl <= 0]
        win_rate = len(wins) / n if n else 0.0
        gross_profit = sum(t.net_pnl for t in wins)
        gross_loss = abs(sum(t.net_pnl for t in losses))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (float("inf") if gross_profit > 0 else 0.0)
        avg_win = gross_profit / len(wins) if wins else 0.0
        avg_loss = -gross_loss / len(losses) if losses else 0.0
        expectancy = (sum(t.net_pnl for t in trades) / n) if n else 0.0

        # Max drawdown from the recorded equity curve.
        max_dd = 0.0
        peak = self.starting_equity
        for p in self.equity_curve:
            peak = max(peak, p["equity"])
            if peak > 0:
                max_dd = max(max_dd, (peak - p["equity"]) / peak * 100.0)

        cost_drag = self.total_fees + self.total_funding
        return {
            "trades": n,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(win_rate * 100, 2),
            "profit_factor": round(profit_factor, 3) if profit_factor != float("inf") else None,
            "avg_win": round(avg_win, 4),
            "avg_loss": round(avg_loss, 4),
            "expectancy_per_trade": round(expectancy, 4),
            "realized_gross": round(self.realized_gross, 4),
            "realized_net": round(self.realized_net, 4),
            "total_fees": round(self.total_fees, 4),
            "total_funding": round(self.total_funding, 4),
            "total_slippage": round(self.total_slippage, 4),
            "cost_drag": round(cost_drag, 4),
            "cost_as_pct_of_gross": round(
                (cost_drag / abs(self.realized_gross) * 100.0) if self.realized_gross else 0.0, 2
            ),
            "max_drawdown_pct": round(max_dd, 3),
            "equity": round(self.equity, 4),
            "starting_equity": round(self.starting_equity, 2),
            "total_return_pct": round(
                (self.equity / self.starting_equity - 1.0) * 100.0 if self.starting_equity else 0.0, 3
            ),
        }

    def snapshot(self) -> Dict[str, Any]:
        return {
            "equity": round(self.equity, 4),
            "equity_source": self.equity_source,
            "exchange_equity": (round(self._authoritative_equity, 4)
                                if self._authoritative_equity is not None else None),
            "internal_equity": round(self.cash_equity + self.unrealized_net, 4),
            "cash_equity": round(self.cash_equity, 4),
            "starting_equity": round(self.starting_equity, 2),
            "unrealized_net": round(self.unrealized_net, 4),
            "realized_net": round(self.realized_net, 4),
            "realized_gross": round(self.realized_gross, 4),
            "gross_exposure": round(self.gross_exposure, 2),
            "total_fees": round(self.total_fees, 4),
            "total_funding": round(self.total_funding, 4),
            "total_slippage": round(self.total_slippage, 4),
            "positions": [p.as_dict() for p in self.positions.values()],
            "open_positions": len(self.positions),
            "stats": self.stats(),
        }

    def recent_trades(self, limit: int = 50) -> List[Dict[str, Any]]:
        return [t.as_dict() for t in self.trades[-limit:]][::-1]

    def recent_orders(self, limit: int = 50) -> List[Dict[str, Any]]:
        return [o.as_dict() for o in self.orders[-limit:]][::-1]

    def add_order(self, order: OrderRecord) -> None:
        self.orders.append(order)
        if len(self.orders) > 5000:
            self.orders = self.orders[-5000:]


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def load_equity_curve(db_path: Path, limit: int = 5000) -> List[Dict[str, float]]:
    if not db_path.exists():
        return []
    try:
        conn = sqlite3.connect(str(db_path))
        cur = conn.execute(
            "SELECT ts,equity,realized_net,unrealized,gross_exposure,open_positions "
            "FROM equity ORDER BY ts DESC LIMIT ?",
            (limit,),
        )
        rows = cur.fetchall()
        conn.close()
        return [
            {"ts": r[0], "equity": r[1], "realized_net": r[2], "unrealized": r[3],
             "gross_exposure": r[4], "open_positions": r[5]}
            for r in reversed(rows)
        ]
    except sqlite3.Error:
        return []


def load_trades(db_path: Path, limit: int = 500) -> List[Dict[str, Any]]:
    if not db_path.exists():
        return []
    try:
        conn = sqlite3.connect(str(db_path))
        cur = conn.execute(
            "SELECT payload FROM trades ORDER BY closed_at DESC LIMIT ?", (limit,)
        )
        rows = cur.fetchall()
        conn.close()
        return [json.loads(r[0]) for r in rows]
    except (sqlite3.Error, json.JSONDecodeError):
        return []
