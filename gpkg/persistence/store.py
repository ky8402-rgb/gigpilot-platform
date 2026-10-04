"""SQLite WAL persistence for trade logs, audit journaling, and realized PnL.

Safety guarantees:
  - WAL journal mode for crash resilience and concurrency.
  - Audit journaling of every trading event.
  - Matched trade PnL reconciliation with exchange-confirmed fees and prices.
  - Strict UTC-midnight boundary for daily realized loss calculation.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Optional

from gpkg.core.clock import f, now_ms


class Store:
    def __init__(self, path: str):
        self.path = path
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._init()

    def _init(self) -> None:
        self._conn.executescript("""
        CREATE TABLE IF NOT EXISTS journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL, kind TEXT NOT NULL, symbol TEXT, payload TEXT);
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
            qty REAL NOT NULL, entry REAL NOT NULL, tp REAL, sl REAL,
            order_link_id TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            exit_ts_ms INTEGER, exit_px REAL,
            realized_pnl REAL DEFAULT 0, fees REAL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS ix_trades_open ON trades(status, symbol);
        CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        """)
        self._conn.commit()

    def journal(self, kind: str, symbol: Optional[str], payload: dict) -> None:
        self._conn.execute(
            "INSERT INTO journal(ts_ms,kind,symbol,payload) VALUES(?,?,?,?)",
            (now_ms(), kind, symbol, json.dumps(payload, default=str)),
        )
        self._conn.commit()

    def open_trade(
        self,
        symbol: str,
        side: str,
        qty: float,
        entry: float,
        tp: float,
        sl: float,
        link: str,
    ) -> int:
        cur = self._conn.execute(
            """INSERT INTO trades(ts_ms,symbol,side,qty,entry,tp,sl,order_link_id)
               VALUES(?,?,?,?,?,?,?,?)""",
            (now_ms(), symbol, side, qty, entry, tp, sl, link),
        )
        self._conn.commit()
        return cur.lastrowid

    def mark_closed_pending(self, trade_id: int, reason: str) -> None:
        """Local close registered; awaiting exchange-verified PnL."""
        self._conn.execute(
            "UPDATE trades SET status='pending_verify', exit_ts_ms=? WHERE id=?",
            (now_ms(), trade_id),
        )
        self._conn.commit()
        self.journal("CLOSE_PENDING", None, {"trade_id": trade_id, "reason": reason})

    def apply_exchange_pnl(self, trade_id: int, exit_px: float, realized_pnl: float, fees: float) -> None:
        self._conn.execute(
            """UPDATE trades SET status='closed', exit_ts_ms=?, exit_px=?,
               realized_pnl=?, fees=? WHERE id=?""",
            (now_ms(), exit_px, realized_pnl, fees, trade_id),
        )
        self._conn.commit()

    def open_trades(self) -> list[dict]:
        cur = self._conn.execute(
            "SELECT id,ts_ms,symbol,side,qty,entry,tp,sl,order_link_id FROM trades WHERE status='open'"
        )
        cols = ["id", "ts_ms", "symbol", "side", "qty", "entry", "tp", "sl", "order_link_id"]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def match_closed_trade(self, symbol: str, closing_side: str, created_ms: int) -> Optional[dict]:
        entry_side = "Sell" if closing_side == "Buy" else "Buy"
        row = self._conn.execute(
            """
            SELECT id, ts_ms, symbol, side, qty, entry FROM trades
            WHERE symbol=? AND side=? AND status IN ('open','pending_verify')
            ORDER BY ABS(ts_ms - ?) ASC LIMIT 1
        """,
            (symbol, entry_side, created_ms),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "ts_ms": row[1],
            "symbol": row[2],
            "side": row[3],
            "qty": row[4],
            "entry": row[5],
        }

    def kv_set(self, k: str, v: str) -> None:
        self._conn.execute("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)", (k, v))
        self._conn.commit()

    def kv_get(self, k: str) -> Optional[str]:
        r = self._conn.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return r[0] if r else None

    def realized_today(self) -> float:
        """Return exchange-authoritative net closed PnL since UTC midnight.

        Bybit closedPnl already includes opening/closing trading fees and funding. The separate
        fees column is retained for attribution only and must not be deducted a second time.
        """
        midnight = int(datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        r = self._conn.execute(
            "SELECT COALESCE(SUM(realized_pnl),0) FROM trades WHERE status='closed' AND exit_ts_ms>=?",
            (midnight,),
        ).fetchone()
        return f(r[0] if r else 0)
