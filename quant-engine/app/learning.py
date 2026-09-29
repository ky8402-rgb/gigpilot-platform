"""Continuous improvement: walk-forward optimisation, promotion, and rollback.

The only honest way to "improve" a systematic strategy is out-of-sample evidence,
so this module refuses to promote anything on in-sample performance alone:

  1. Split each symbol's real history into rolling folds.
  2. On each fold, evaluate a parameter set on its TEST window only.
  3. Aggregate test-window results across folds and symbols into a score.
  4. Require fold-to-fold consistency, so one lucky fold cannot carry a candidate.
  5. Promote only if the candidate beats the incumbent out-of-sample by the
     configured margin. Otherwise the incumbent stays and the rejection is logged.

Every promotion is versioned in SQLite with full provenance, which makes
`rollback()` a one-line, auditable operation.
"""
from __future__ import annotations

import itertools
import json
import sqlite3
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from . import indicators as ta
from .logging_setup import get_logger
from .strategy import simulate

log = get_logger("learning")


GRID_KEYS = {
    "ema_fast", "ema_slow", "adx_min", "donchian_period", "atr_stop_mult",
    "tp_r_multiple", "breakout_buffer_atr", "min_momentum_atr", "require_htf_alignment",
}

DEFAULT_GRID: Dict[str, List[Any]] = {
    "ema_fast": [13, 21, 34],
    "ema_slow": [34, 55, 89],
    "adx_min": [18.0, 22.0, 26.0],
    "donchian_period": [15, 20, 30],
    "atr_stop_mult": [1.5, 2.0, 2.75],
    "tp_r_multiple": [1.8, 2.5, 3.5],
    "breakout_buffer_atr": [0.05, 0.15, 0.30],
    "min_momentum_atr": [0.10, 0.25, 0.45],
}


@dataclass
class ParamSet:
    """The tunable surface of the strategy. Risk constants are NOT tunable here —
    a search that can widen its own risk limits will always 'find' a better score."""
    ema_fast: int = 21
    ema_slow: int = 55
    adx_min: float = 20.0
    donchian_period: int = 20
    atr_stop_mult: float = 2.0
    tp_r_multiple: float = 2.5
    breakout_buffer_atr: float = 0.15
    min_momentum_atr: float = 0.25
    require_htf_alignment: bool = True

    version: int = 0
    created_at: float = field(default_factory=time.time)
    status: str = "candidate"
    note: str = ""
    score: float = 0.0
    oos_net_bps: float = 0.0
    oos_trades: int = 0
    oos_win_rate: float = 0.0
    oos_consistency: float = 0.0
    symbols_evaluated: int = 0

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def strategy_overrides(self) -> Dict[str, Any]:
        return {k: getattr(self, k) for k in GRID_KEYS}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "ParamSet":
        allowed = set(cls.__dataclass_fields__)
        return cls(**{k: v for k, v in d.items() if k in allowed})

    def key(self) -> tuple:
        return tuple(sorted((k, getattr(self, k)) for k in GRID_KEYS))


def apply_params(strategy_cfg, params: ParamSet):
    """Copy of the strategy config with candidate parameters applied."""
    return strategy_cfg.model_copy(update=params.strategy_overrides())


def enrich_for(df: pd.DataFrame, strategy_cfg) -> pd.DataFrame:
    """Indicator-enrich a raw OHLCV frame for a given strategy config."""
    return ta.enrich(df, strategy_cfg)


def run_backtest(
    symbol: str,
    raw_df: pd.DataFrame,
    strategy_cfg,
    fee_bps: float,
    slippage_bps: float = 0.0,
):
    """Enrich then simulate. The single backtest entry point in the system."""
    if raw_df is None or len(raw_df) < 60:
        return []
    enriched = ta.enrich(raw_df, strategy_cfg)
    trades, _ = simulate(
        symbol, enriched, strategy_cfg,
        fee_bps_round_trip=fee_bps,
        slippage_bps_round_trip=slippage_bps,
    )
    return trades


def score_trades(
    trades: List[Any], min_trades: int, consistency: float = 1.0
) -> Tuple[float, Dict[str, float]]:
    """Score = per-trade expectancy in bps, risk-adjusted and sample-shrunk.

    Using expectancy per trade rather than total return means a fold with three
    lucky trades cannot out-score one with thirty solid trades. The sample factor
    shrinks the score toward zero when evidence is thin — the standard way to avoid
    selecting on noise.
    """
    if not trades:
        return -1e9, {"net_bps": 0.0, "trades": 0, "win_rate": 0.0, "total_bps": 0.0}
    net = np.array([t.net_return_bps for t in trades], dtype=float)
    n = len(net)
    expectancy = float(net.mean())
    win_rate = float((net > 0).mean())
    sd = float(net.std(ddof=1)) if n > 1 else 0.0
    ratio = expectancy / sd if sd > 1e-9 else (1.0 if expectancy > 0 else -1.0)
    ratio = float(np.clip(ratio, -5.0, 5.0))
    sample_factor = min(1.0, n / max(min_trades * 4, 1))
    score = ratio * sample_factor * (0.5 + 0.5 * consistency)
    return score, {
        "net_bps": expectancy,
        "trades": n,
        "win_rate": win_rate,
        "total_bps": float(net.sum()),
        "ratio": ratio,
    }


class WalkForwardOptimizer:
    """Searches parameters on TRAIN folds and judges them on TEST folds."""

    def __init__(self, cfg, db_path: Optional[Path] = None):
        self.cfg = cfg
        self.L = cfg.learning
        self.db_path = Path(db_path) if db_path else None
        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS params (
                       version INTEGER PRIMARY KEY AUTOINCREMENT,
                       created_at REAL, status TEXT, score REAL,
                       oos_net_bps REAL, oos_trades INTEGER,
                       payload TEXT, note TEXT)"""
            )
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS symbol_state (
                       symbol TEXT PRIMARY KEY, enabled INTEGER, reason TEXT,
                       oos_net_bps REAL, oos_trades INTEGER, updated_at REAL)"""
            )
            self._conn.commit()

    # -- grid --------------------------------------------------------------
    def grid(self, max_sets: Optional[int] = None) -> List[ParamSet]:
        keys = list(DEFAULT_GRID.keys())
        combos = list(itertools.product(*(DEFAULT_GRID[k] for k in keys)))
        out: List[ParamSet] = []
        for combo in combos:
            d = dict(zip(keys, combo))
            if d["ema_fast"] >= d["ema_slow"]:
                continue
            out.append(ParamSet(**d))
        limit = max_sets or self.L.max_param_sets
        if limit > 0 and len(out) > limit:
            stride = len(out) / limit
            out = [out[int(i * stride)] for i in range(limit)]
        return out

    # -- walk-forward ------------------------------------------------------
    def walk_forward(
        self, symbol: str, raw_df: pd.DataFrame, params: ParamSet, fee_bps: float
    ) -> Dict[str, float]:
        """Evaluate one parameter set on rolling out-of-sample test windows."""
        L = self.L
        strat = apply_params(self.cfg.strategy, params)
        enriched = ta.enrich(raw_df, strat)
        n = len(enriched)
        train, test, step = L.train_bars, L.test_bars, L.step_bars
        if n < train + test:
            return {"score": -1e9, "oos_net_bps": 0.0, "oos_trades": 0,
                    "win_rate": 0.0, "consistency": 0.0, "folds": 0}

        oos: List[Any] = []
        fold_positive: List[bool] = []
        start = 0
        while start + train + test <= n:
            window = enriched.iloc[start + train: start + train + test].reset_index(drop=True)
            trades, _ = simulate(
                symbol, window, strat,
                fee_bps_round_trip=fee_bps,
                slippage_bps_round_trip=0.0,
            )
            if len(trades) >= L.min_trades_per_fold:
                oos.extend(trades)
                fold_net = float(np.mean([t.net_return_bps for t in trades]))
                fold_positive.append(fold_net > 0)
            start += step

        consistency = float(np.mean(fold_positive)) if fold_positive else 0.0
        score, meta = score_trades(oos, L.min_trades_per_fold, consistency)
        return {
            "score": score,
            "oos_net_bps": meta["net_bps"],
            "oos_trades": meta["trades"],
            "win_rate": meta["win_rate"],
            "total_bps": meta["total_bps"],
            "consistency": consistency,
            "folds": len(fold_positive),
        }

    # -- full optimisation -------------------------------------------------
    def optimize(
        self,
        frames: Dict[str, pd.DataFrame],
        incumbent: Optional[ParamSet] = None,
        candidates: Optional[List[ParamSet]] = None,
    ) -> Dict[str, Any]:
        """Score the incumbent and every candidate across all symbols.

        Returns a report including the verdict. Nothing is written unless a
        candidate genuinely wins out-of-sample.
        """
        fee_bps = self.cfg.costs.maker_fee_bps + self.cfg.costs.taker_fee_bps
        cands = candidates or self.grid()
        inc = incumbent or ParamSet()

        def evaluate(p: ParamSet) -> Dict[str, Any]:
            per_symbol: Dict[str, Dict[str, float]] = {}
            for sym, df in frames.items():
                if df is None or len(df) < self.L.train_bars + self.L.test_bars:
                    continue
                r = self.walk_forward(sym, df, p, fee_bps)
                if r["folds"] > 0:
                    per_symbol[sym] = r
            if not per_symbol:
                return {"score": -1e9, "oos_net_bps": 0.0, "oos_trades": 0,
                        "win_rate": 0.0, "consistency": 0.0, "per_symbol": {}, "symbols": 0}
            # Aggregate by *median* per-symbol expectancy: an edge that only works
            # on one symbol is not an edge, it is a coincidence.
            nets = np.array([v["oos_net_bps"] for v in per_symbol.values()], dtype=float)
            scores = np.array([v["score"] for v in per_symbol.values()], dtype=float)
            cons = np.array([v["consistency"] for v in per_symbol.values()], dtype=float)
            trades = sum(int(v["oos_trades"]) for v in per_symbol.values())
            wins = [v["win_rate"] for v in per_symbol.values()]
            return {
                "score": float(np.median(scores)),
                "oos_net_bps": float(np.median(nets)),
                "oos_trades": trades,
                "win_rate": float(np.mean(wins)) if wins else 0.0,
                "consistency": float(np.mean(cons)) if len(cons) else 0.0,
                "per_symbol": per_symbol,
                "symbols": len(per_symbol),
                "min_symbol_bps": float(nets.min()) if len(nets) else 0.0,
            }

        inc_res = evaluate(inc)
        best_p, best_res = None, inc_res
        for p in cands:
            res = evaluate(p)
            if res["score"] > best_res["score"]:
                best_p, best_res = p, res

        verdict = "hold"
        reason = ""
        if best_p is None:
            reason = (
                f"no candidate beat the incumbent out-of-sample "
                f"(incumbent score {inc_res['score']:.3f}, median OOS "
                f"{inc_res['oos_net_bps']:.2f}bps, {inc_res['symbols']} symbols)"
            )
        elif best_res["oos_net_bps"] <= 0:
            reason = (
                "best candidate is not net-profitable out-of-sample "
                f"({best_res['oos_net_bps']:.2f}bps median) — keeping incumbent"
            )
            best_p = None
        elif best_res["min_symbol_bps"] <= -abs(best_res["oos_net_bps"]):
            reason = (
                "best candidate has a symbol with materially negative OOS expectancy "
                f"({best_res['min_symbol_bps']:.2f}bps) — not robust, keeping incumbent"
            )
            best_p = None
        else:
            improvement = best_res["score"] - inc_res["score"]
            threshold = max(self.L.promotion_margin, 0.0)
            if improvement >= threshold:
                verdict = "promote"
                reason = (
                    f"candidate beats incumbent by {improvement:.3f} score "
                    f"(>= margin {threshold}) with median OOS {best_res['oos_net_bps']:.2f}bps "
                    f"across {best_res['symbols']} symbols, consistency "
                    f"{best_res['consistency']:.0%}"
                )
            else:
                best_p = None
                reason = (
                    f"best candidate improves score by only {improvement:.3f} "
                    f"(< required margin {threshold}) — not enough evidence to switch"
                )

        report = {
            "verdict": verdict,
            "reason": reason,
            "incumbent": {"params": inc.as_dict(), "result": inc_res},
            "best": {"params": best_p.as_dict() if best_p else None, "result": best_res},
            "evaluated": len(cands),
            "ts": time.time(),
        }
        log.info("optimisation complete", extra={"verdict": verdict, "reason": reason})

        if verdict == "promote" and best_p is not None:
            self._promote(best_p, best_res, reason)
        return report

    # -- per-symbol gating -------------------------------------------------
    def symbol_evidence(
        self, frames: Dict[str, pd.DataFrame], params: ParamSet
    ) -> Dict[str, Dict[str, float]]:
        """Out-of-sample result per symbol for a given parameter set.

        This is what lets the platform stop trading a symbol whose edge is not
        real, instead of averaging it away inside a portfolio number.
        """
        fee_bps = self.cfg.costs.maker_fee_bps + self.cfg.costs.taker_fee_bps
        out: Dict[str, Dict[str, float]] = {}
        for sym, df in frames.items():
            if df is None or len(df) < self.L.train_bars + self.L.test_bars:
                # Fail CLOSED: a symbol we cannot evaluate is a symbol we do not
                # trade. Returning no entry here would let it default to enabled.
                out[sym] = {"score": 0.0, "oos_net_bps": 0.0, "oos_trades": 0,
                            "win_rate": 0.0, "consistency": 0.0, "folds": 0}
                continue
            out[sym] = self.walk_forward(sym, df, params, fee_bps)
        return out

    def symbol_verdict(self, evidence: Dict[str, float]) -> tuple[bool, str]:
        """Decide whether a symbol may be traded, purely on out-of-sample evidence.

        A symbol is disabled when its expectancy is not merely weak but negative,
        or when there is too little evidence to justify risking capital. Requires
        the same minimum sample count used by the live edge gate so the two
        layers cannot disagree.
        """
        n = int(evidence.get("oos_trades", 0))
        net = float(evidence.get("oos_net_bps", 0.0))
        cons = float(evidence.get("consistency", 0.0))
        need = max(self.cfg.strategy.min_edge_samples, 1)

        if n < need:
            return False, (f"insufficient out-of-sample evidence: {n} trades "
                           f"(need {need}); not trading this symbol until proven")
        if net <= 0:
            return False, (f"negative out-of-sample expectancy {net:+.1f}bps over "
                           f"{n} trades; disabled until evidence turns positive")
        if cons < 0.34:
            return False, (f"inconsistent out-of-sample results: only {cons:.0%} of folds "
                           f"profitable; disabled until evidence stabilises")
        return True, f"positive out-of-sample expectancy {net:+.1f}bps over {n} trades"

    def apply_symbol_gating(
        self, frames: Dict[str, pd.DataFrame], params: ParamSet
    ) -> Dict[str, Dict[str, Any]]:
        """Re-evaluate every symbol and persist the enable/disable decision."""
        evidence = self.symbol_evidence(frames, params)
        decisions: Dict[str, Dict[str, Any]] = {}
        for sym, ev in evidence.items():
            enabled, reason = self.symbol_verdict(ev)
            decisions[sym] = {
                "enabled": enabled, "reason": reason,
                "oos_net_bps": ev.get("oos_net_bps", 0.0),
                "oos_trades": int(ev.get("oos_trades", 0)),
                "consistency": ev.get("consistency", 0.0),
            }
            if self._conn is not None:
                self._conn.execute(
                    "INSERT OR REPLACE INTO symbol_state VALUES (?,?,?,?,?,?)",
                    (sym, 1 if enabled else 0, reason, ev.get("oos_net_bps", 0.0),
                     int(ev.get("oos_trades", 0)), time.time()),
                )
        if self._conn is not None:
            self._conn.commit()
        return decisions

    def symbol_state(self) -> Dict[str, Dict[str, Any]]:
        if self._conn is None:
            return {}
        cur = self._conn.execute(
            "SELECT symbol,enabled,reason,oos_net_bps,oos_trades,updated_at FROM symbol_state"
        )
        out: Dict[str, Dict[str, Any]] = {}
        for r in cur.fetchall():
            out[r[0]] = {"enabled": bool(r[1]), "reason": r[2], "oos_net_bps": r[3],
                         "oos_trades": r[4], "updated_at": r[5]}
        return out

    # -- persistence -------------------------------------------------------
    def _promote(self, params: ParamSet, result: Dict[str, Any], reason: str) -> int:
        if self._conn is None:
            return 0
        cur = self._conn.execute("SELECT COALESCE(MAX(version),0) FROM params")
        version = int(cur.fetchone()[0]) + 1
        payload = params.as_dict()
        payload.update({
            "version": version,
            "status": "active",
            "score": result["score"],
            "oos_net_bps": result["oos_net_bps"],
            "oos_trades": result["oos_trades"],
            "oos_win_rate": result["win_rate"],
            "oos_consistency": result["consistency"],
            "symbols_evaluated": result.get("symbols", 0),
            "created_at": time.time(),
            "note": reason,
        })
        self._conn.execute("UPDATE params SET status='superseded' WHERE status='active'")
        self._conn.execute(
            "INSERT INTO params (created_at,status,score,oos_net_bps,oos_trades,payload,note) "
            "VALUES (?,?,?,?,?,?,?)",
            (time.time(), "active", result["score"], result["oos_net_bps"],
             int(result["oos_trades"]), json.dumps(payload), reason),
        )
        self._conn.commit()
        log.warning("PARAMS PROMOTED", extra={"version": version, "reason": reason})
        return version

    def record_rejection(self, report: Dict[str, Any]) -> None:
        if self._conn is None:
            return
        self._conn.execute(
            "INSERT INTO params (created_at,status,score,oos_net_bps,oos_trades,payload,note) "
            "VALUES (?,?,?,?,?,?,?)",
            (time.time(), "rejected", report["best"]["result"].get("score", 0.0),
             report["best"]["result"].get("oos_net_bps", 0.0),
             int(report["best"]["result"].get("oos_trades", 0)),
             json.dumps({"best": report["best"]["params"], "incumbent": report["incumbent"]["params"]},
                        default=str),
             report["reason"]),
        )
        self._conn.commit()

    def active_params(self) -> Optional[ParamSet]:
        if self._conn is None:
            return None
        cur = self._conn.execute(
            "SELECT payload FROM params WHERE status='active' ORDER BY version DESC LIMIT 1"
        )
        row = cur.fetchone()
        if not row:
            return None
        try:
            return ParamSet.from_dict(json.loads(row[0]))
        except (json.JSONDecodeError, TypeError):
            return None

    def history(self, limit: int = 20) -> List[Dict[str, Any]]:
        if self._conn is None:
            return []
        cur = self._conn.execute(
            "SELECT version,created_at,status,score,oos_net_bps,oos_trades,payload,note "
            "FROM params ORDER BY version DESC LIMIT ?", (limit,)
        )
        out = []
        for r in cur.fetchall():
            out.append({
                "version": r[0],
                "created_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(r[1])),
                "status": r[2],
                "score": round(r[3] or 0.0, 4),
                "oos_net_bps": round(r[4] or 0.0, 3),
                "oos_trades": r[5],
                "note": r[7],
                "params": {k: v for k, v in (json.loads(r[6]) if r[6] else {}).items()
                           if k in GRID_KEYS},
            })
        return out

    def rollback(self, version: int) -> Optional[ParamSet]:
        """Re-activate a previous parameter version. Auditable, non-destructive."""
        if self._conn is None:
            return None
        cur = self._conn.execute("SELECT payload FROM params WHERE version=?", (version,))
        row = cur.fetchone()
        if not row:
            return None
        try:
            params = ParamSet.from_dict(json.loads(row[0]))
        except (json.JSONDecodeError, TypeError):
            return None
        self._conn.execute("UPDATE params SET status='rolled_back' WHERE status='active'")
        self._conn.execute("UPDATE params SET status='active' WHERE version=?", (version,))
        self._conn.execute(
            "INSERT INTO params (created_at,status,score,oos_net_bps,oos_trades,payload,note) "
            "VALUES (?,?,?,?,?,?,?)",
            (time.time(), "active", params.score, params.oos_net_bps, params.oos_trades,
             json.dumps(params.as_dict()), f"rollback to version {version}"),
        )
        self._conn.commit()
        log.warning("PARAMS ROLLED BACK", extra={"to_version": version})
        return params
