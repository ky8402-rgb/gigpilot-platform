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
from datetime import UTC, datetime

from gpkg.core.clock import f, now_ms


class Store:
    def __init__(self, path: str):
        self.path = path
        self._conn = sqlite3.connect(path, check_same_thread=False, timeout=30)
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
        CREATE TABLE IF NOT EXISTS ml_model_evidence (
            model_id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            verified INTEGER NOT NULL CHECK(verified IN (0,1)),
            evidence_json TEXT NOT NULL,
            updated_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS ml_model_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL,
            model_id TEXT NOT NULL,
            from_state TEXT,
            to_state TEXT NOT NULL,
            reason TEXT NOT NULL,
            evidence_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS ix_ml_model_events_model
            ON ml_model_events(model_id, ts_ms);
        CREATE TABLE IF NOT EXISTS ml_market_data (
            ts_ms INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY(ts_ms, symbol, kind)
        );
        CREATE INDEX IF NOT EXISTS ix_ml_market_data_symbol_kind_ts
            ON ml_market_data(symbol, kind, ts_ms);
        CREATE TABLE IF NOT EXISTS ml_research_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL,
            model_id TEXT NOT NULL,
            outcome TEXT NOT NULL,
            reason TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_ml_research_audits_model
            ON ml_research_audits(model_id, ts_ms);
        """)
        self._conn.commit()

    def journal(self, kind: str, symbol: str | None, payload: dict) -> None:
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
        if cur.lastrowid is None:
            raise RuntimeError("SQLite did not return a trade id")
        return int(cur.lastrowid)

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

    def match_closed_trade(self, symbol: str, closing_side: str, created_ms: int) -> dict | None:
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

    def kv_get(self, k: str) -> str | None:
        r = self._conn.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return r[0] if r else None

    def ml_upsert_evidence(
        self,
        model_id: str,
        state: str,
        verified: bool,
        evidence: dict,
        *,
        reason: str,
        expected_from_state: str | None = None,
    ) -> None:
        """Atomically persist current ML evidence and append its transition audit record.

        expected_from_state is an optimistic-concurrency guard. A stale promoter/rollback worker
        cannot overwrite a newer lifecycle decision.
        """
        if not model_id or not state or not reason:
            raise ValueError("model_id, state and reason are required")
        payload = json.dumps(evidence, sort_keys=True, separators=(",", ":"), default=str)
        ts = now_ms()
        with self._conn:
            row = self._conn.execute(
                "SELECT state FROM ml_model_evidence WHERE model_id=?", (model_id,)
            ).fetchone()
            current = row[0] if row else None
            if expected_from_state is not None and current != expected_from_state:
                raise RuntimeError(
                    f"stale ML transition for {model_id}: expected {expected_from_state}, found {current}"
                )
            self._conn.execute(
                """INSERT INTO ml_model_evidence(model_id,state,verified,evidence_json,updated_ms)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(model_id) DO UPDATE SET
                       state=excluded.state,
                       verified=excluded.verified,
                       evidence_json=excluded.evidence_json,
                       updated_ms=excluded.updated_ms""",
                (model_id, state, 1 if verified else 0, payload, ts),
            )
            self._conn.execute(
                """INSERT INTO ml_model_events(
                       ts_ms,model_id,from_state,to_state,reason,evidence_json)
                   VALUES(?,?,?,?,?,?)""",
                (ts, model_id, current, state, reason, payload),
            )

    def ml_market_upsert(self, symbol: str, kind: str, ts_ms: int, payload: dict) -> None:
        if not symbol or not kind or ts_ms <= 0:
            raise ValueError("symbol, kind and positive timestamp are required")
        self._conn.execute(
            "INSERT OR REPLACE INTO ml_market_data(ts_ms,symbol,kind,payload_json) VALUES(?,?,?,?)",
            (int(ts_ms), symbol, kind, json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)),
        )
        self._conn.commit()

    def ml_market_bulk_upsert(self, rows: list[tuple[str, str, int, dict]]) -> None:
        if not rows:
            return
        payloads = [
            (int(ts), symbol, kind, json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str))
            for symbol, kind, ts, payload in rows
            if symbol and kind and int(ts) > 0
        ]
        with self._conn:
            self._conn.executemany(
                "INSERT OR REPLACE INTO ml_market_data(ts_ms,symbol,kind,payload_json) VALUES(?,?,?,?)",
                payloads,
            )

    def ml_market_range(self, symbol: str, kind: str, start_ms: int, end_ms: int) -> list[dict]:
        rows = self._conn.execute(
            "SELECT ts_ms,payload_json FROM ml_market_data WHERE symbol=? AND kind=? AND ts_ms>=? AND ts_ms<=? ORDER BY ts_ms",
            (symbol, kind, int(start_ms), int(end_ms)),
        ).fetchall()
        return [{"ts_ms": int(ts), **json.loads(payload)} for ts, payload in rows]

    def ml_market_latest(self, symbol: str, kind: str, limit: int = 1000) -> list[dict]:
        limit = max(1, min(int(limit), 10000))
        rows = self._conn.execute(
            "SELECT ts_ms,payload_json FROM ml_market_data WHERE symbol=? AND kind=? ORDER BY ts_ms DESC LIMIT ?",
            (symbol, kind, limit),
        ).fetchall()
        return [{"ts_ms": int(ts), **json.loads(payload)} for ts, payload in reversed(rows)]

    def ml_market_counts(self, symbol: str, start_ms: int, end_ms: int) -> dict[str, int]:
        rows = self._conn.execute(
            "SELECT kind,COUNT(*) FROM ml_market_data WHERE symbol=? AND ts_ms>=? AND ts_ms<=? GROUP BY kind",
            (symbol, int(start_ms), int(end_ms)),
        ).fetchall()
        return {str(k): int(v) for k, v in rows}

    def ml_market_buffer_stats_for_symbol(self, symbol: str, kind: str) -> dict:
        row = self._conn.execute(
            "SELECT COUNT(*),MIN(ts_ms),MAX(ts_ms) FROM ml_market_data WHERE symbol=? AND kind=?",
            (symbol, kind),
        ).fetchone()
        count = int(row[0] or 0) if row else 0
        first = int(row[1]) if row and row[1] is not None else None
        last = int(row[2]) if row and row[2] is not None else None
        return {"rows": count, "first_ts_ms": first, "last_ts_ms": last,
                "span_ms": (last-first) if first is not None and last is not None else 0}

    def ml_market_buffer_stats(self, kind: str) -> dict:
        row=self._conn.execute(
            "SELECT COUNT(*),MIN(ts_ms),MAX(ts_ms) FROM ml_market_data WHERE kind=?",(kind,)).fetchone()
        count=int(row[0] or 0) if row else 0; first=int(row[1]) if row and row[1] is not None else None; last=int(
            row[2]) if row and row[2] is not None else None
        return {"rows":count,"first_ts_ms":first,"last_ts_ms":last,"span_ms":(last-first) if first is not None and last is not None else 0}

    def ml_market_symbols(self, kind: str) -> list[str]:
        """Symbols with at least one row of `kind`. Used by the operator-facing ingestion indicator."""
        rows = self._conn.execute(
            "SELECT DISTINCT symbol FROM ml_market_data WHERE kind=? ORDER BY symbol", (kind,),
        ).fetchall()
        return [str(r[0]) for r in rows]

    def ml_research_audit(self, model_id: str, outcome: str, reason: str, payload: dict) -> None:
        self._conn.execute(
            "INSERT INTO ml_research_audits(ts_ms,model_id,outcome,reason,payload_json) VALUES(?,?,?,?,?)",
            (now_ms(), model_id, outcome, reason, json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)),
        )
        self._conn.commit()
        self.journal("ML_RESEARCH_AUDIT", None, {"model_id": model_id, "outcome": outcome, "reason": reason})

    def ml_research_audits(self, limit: int = 50) -> list[dict]:
        limit = max(1, min(int(limit), 1000))
        rows = self._conn.execute(
            "SELECT ts_ms,model_id,outcome,reason,payload_json FROM ml_research_audits ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [{"ts_ms": int(ts), "model_id": mid, "outcome": out, "reason": reason, "payload": json.loads(payload)}
                for ts, mid, out, reason, payload in rows]

    def ml_get_evidence(self, model_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT state,verified,evidence_json,updated_ms FROM ml_model_evidence WHERE model_id=?",
            (model_id,),
        ).fetchone()
        if row is None:
            return None
        evidence = json.loads(row[2])
        return {
            "model_id": model_id,
            "state": row[0],
            "verified": bool(row[1]),
            "evidence": evidence,
            "updated_ms": int(row[3]),
        }

    def ml_list_evidence(self) -> list[dict]:
        rows = self._conn.execute(
            """SELECT model_id,state,verified,evidence_json,updated_ms
               FROM ml_model_evidence ORDER BY updated_ms DESC, model_id"""
        ).fetchall()
        return [{
            "model_id": row[0],
            "state": row[1],
            "verified": bool(row[2]),
            "evidence": json.loads(row[3]),
            "updated_ms": int(row[4]),
        } for row in rows]

    def ml_events(self, model_id: str | None = None, limit: int = 100) -> list[dict]:
        limit = max(1, min(int(limit), 1000))
        if model_id:
            rows = self._conn.execute(
                """SELECT ts_ms,model_id,from_state,to_state,reason,evidence_json
                   FROM ml_model_events WHERE model_id=?
                   ORDER BY id DESC LIMIT ?""",
                (model_id, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """SELECT ts_ms,model_id,from_state,to_state,reason,evidence_json
                   FROM ml_model_events ORDER BY id DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        return [{
            "ts_ms": int(row[0]),
            "model_id": row[1],
            "from_state": row[2],
            "to_state": row[3],
            "reason": row[4],
            "evidence": json.loads(row[5]),
        } for row in rows]

    def realized_today(self) -> float:
        """Return exchange-authoritative net closed PnL since UTC midnight.

        Bybit closedPnl already includes opening/closing trading fees and funding. The separate
        fees column is retained for attribution only and must not be deducted a second time.
        """
        midnight = int(datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        r = self._conn.execute(
            "SELECT COALESCE(SUM(realized_pnl),0) FROM trades WHERE status='closed' AND exit_ts_ms>=?",
            (midnight,),
        ).fetchone()
        return f(r[0] if r else 0)
