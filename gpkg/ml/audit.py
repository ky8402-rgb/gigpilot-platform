"""Shared normalization for ML research audit telemetry.

One canonical shape is used by the CLI and REST API so statistical evidence is never
silently reinterpreted by a presentation layer.
"""
from __future__ import annotations

from typing import Any


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_audit(audit: dict[str, Any]) -> dict[str, Any]:
    payload = audit.get("payload") or {}
    evidence = payload.get("evidence") if isinstance(payload.get("evidence"), dict) else payload
    costs = payload.get("cost_deductions") or payload.get("costs") or {}
    thresholds = payload.get("gate_thresholds") or {
        "net_edge_bps": 8.0,
        "t_stat": 3.0,
        "oos_sharpe": 1.5,
    }
    net = _num(payload.get("net_edge_bps", payload.get("mean_net_bps", evidence.get("mean_net_bps", 0.0))))
    gross = _num(payload.get("gross_edge_bps", evidence.get("gross_edge_bps", 0.0)))
    fees = _num(costs.get("fees_bps"))
    spread = _num(costs.get("two_x_peak_spread_bps", costs.get("spread_bps")))
    impact = _num(costs.get("modeled_impact_bps", costs.get("slippage_bps")))
    adverse = _num(costs.get("adverse_selection_bps"))
    funding = _num(costs.get("funding_bps"))
    total = _num(costs.get("total_friction_bps"), fees + spread + impact + adverse + funding)
    gate = bool(payload.get("gate_outcome", evidence.get("verified", audit.get("outcome") == "VERIFIED")))
    reason = str(audit.get("reason") or "")
    failures = payload.get("gate_failures")
    if not isinstance(failures, list):
        failures = [reason] if not gate and reason else []
    return {
        "ts_ms": int(audit.get("ts_ms", 0)),
        "model_id": str(audit.get("model_id", "")),
        "outcome": str(audit.get("outcome", "")),
        "reason": reason,
        "model_family": str(payload.get("model_family") or payload.get("family") or audit.get("model_id", "")),
        "gross_edge_bps": gross,
        "cost_deductions": {
            "fees_bps": fees,
            "two_x_peak_spread_bps": spread,
            "modeled_impact_bps": impact,
            "adverse_selection_bps": adverse,
            "funding_bps": funding,
            "total_friction_bps": total,
        },
        "net_edge_bps": net,
        "t_stat": _num(payload.get("t_stat", evidence.get("t_stat", 0.0))),
        "oos_sharpe": _num(payload.get("oos_sharpe", evidence.get("oos_sharpe", 0.0))),
        "gate_outcome": gate,
        "gate_thresholds": {
            "net_edge_bps": _num(thresholds.get("net_edge_bps"), 8.0),
            "t_stat": _num(thresholds.get("t_stat"), 3.0),
            "oos_sharpe": _num(thresholds.get("oos_sharpe"), 1.5),
        },
        "gate_failures": failures,
    }
