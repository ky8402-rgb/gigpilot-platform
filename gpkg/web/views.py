"""Presentation layer for the Python-rendered operator dashboard.

WHY THIS IS A SEPARATE MODULE FROM `dashboard.py`
-------------------------------------------------
`dashboard.py` owns the HTTP surface (routes, status codes, content types). This module owns the
*shaping* of engine state into what the template renders. Keeping them apart means the shape can be
unit-tested without a FastAPI client, and the routing can be tested without asserting on markup.

FAIL-VISIBLE, NOT FAIL-PRETTY
-----------------------------
Every accessor here is defensive on purpose: engine state is assembled from live venue data, so a
missing key is expected during boot and after a venue hiccup. A missing value renders as an em dash
rather than `None`, and the L2 progress is computed from the PER-SYMBOL MINIMUM rather than the total
(see `tests/test_l2_ingestion_indicator.py` for why the total answers the wrong question).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

#: The required count comes from the ONE engine constant, never a local copy. Two definitions of a
#: gate is one definition too many, and the copy is the one that goes stale.
from gpkg.core.constants import L2_REQUIRED

WEB_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = WEB_DIR / "templates"
STATIC_DIR = WEB_DIR / "static"

DASHBOARD_TEMPLATE = "dashboard.html"
LOGIN_TEMPLATE = "login.html"


# =====================================================================================
# Value formatting — shared by the template filters
# =====================================================================================
def fmt_num(value: Any, digits: int = 2) -> str:
    """A number for display, or an em dash when there is no number to show."""
    if value is None or value == "":
        return "\u2013"
    try:
        return f"{float(value):,.{digits}f}"
    except Exception:
        return "\u2013"


def fmt_pnl(value: Any) -> str:
    """Signed, and the sign is always explicit: `1.00` hides whether it is a gain."""
    if value is None or value == "":
        return "\u2013"
    try:
        return f"{float(value):+,.2f}"
    except Exception:
        return "\u2013"


def fmt_pct(value: Any) -> str:
    """A RATIO rendered as a percentage. `margin_ratio` is 0..1, so 0.25 renders as `25.00%`."""
    if value is None or value == "":
        return "\u2013"
    try:
        return f"{float(value) * 100:,.2f}%"
    except Exception:
        return "\u2013"


def fmt_bps(value: Any) -> str:
    if value is None or value == "":
        return "\u2013"
    try:
        return f"{float(value):,.2f}"
    except Exception:
        return "\u2013"


def jinja_env(templates_dir: Path | None = None) -> Environment:
    """The template environment.

    Autoescaping is NOT optional here. The dashboard interpolates venue-supplied strings (symbols,
    host, event text) and operator-supplied error text; without escaping, either could become markup
    in an operator's browser.
    """
    env = Environment(
        loader=FileSystemLoader(str(templates_dir or TEMPLATES_DIR)),
        autoescape=select_autoescape(enabled_extensions=("html", "xml"), default=True),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["num"] = fmt_num
    env.filters["pnl"] = fmt_pnl
    env.filters["pct"] = fmt_pct
    env.filters["bps"] = fmt_bps
    return env


# =====================================================================================
# State shaping
# =====================================================================================
def empty_state() -> dict[str, Any]:
    """The shape the template can always render, for when no engine state is available."""
    return {
        "ts": "",
        "armed": False,
        "host": "",
        "position_mode": "",
        "hurdle_bps": None,
        "equity": None,
        "margin_ratio": None,
        "gross_notional": None,
        "daily_pnl": None,
        "realized_today": None,
        "positions": [],
        "signals": [],
        "markets": [],
        "events": [],
        "capital": {},
        "ops": {},
        "armable": False,
    }


def normalize_state(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Fill in every key the template reads, so rendering never raises on partial state."""
    state = dict(empty_state())
    if isinstance(raw, dict):
        state.update(raw)
    for key in ("positions", "markets", "events", "signals"):
        if not isinstance(state.get(key), list):
            state[key] = []
    if not isinstance(state.get("capital"), dict):
        state["capital"] = {}
    if not isinstance(state.get("ops"), dict):
        state["ops"] = {}
    return state


def l2_view(state: dict[str, Any]) -> dict[str, Any]:
    """Per-symbol L2 ingestion progress toward the ML gate.

    The headline number is `min_symbol`, NOT the row total. The gate is applied per symbol, so a
    total spread across several symbols can look close to complete while the binding symbol is
    nowhere near it — the indicator would then be reassuring and wrong at the same time.
    """
    ops = state.get("ops") or {}
    depth = ops.get("l2_depth") or {}
    buffer = ops.get("l2_buffer") or {}

    raw_symbols = depth.get("symbols")
    symbols: dict[str, int] = {}
    if isinstance(raw_symbols, dict):
        for sym, rows in sorted(raw_symbols.items()):
            try:
                symbols[str(sym)] = int(rows)
            except (TypeError, ValueError):
                symbols[str(sym)] = 0

    required = int(depth.get("required") or L2_REQUIRED)
    try:
        binding = int(depth.get("min_symbol") or 0)
    except (TypeError, ValueError):
        binding = 0

    total = buffer.get("rows")
    if total is None:
        total = sum(symbols.values())

    pct = round(min(100.0, 100.0 * binding / required), 2) if required > 0 else 0.0

    return {
        "required": required,
        "symbols": symbols,
        "min_symbol": binding,
        "total": total,
        "ready": bool(depth.get("ready")) and bool(symbols),
        "pct": pct,
    }


def signal_index(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Signals keyed by symbol, so the markets table can join without O(n^2) template work."""
    index: dict[str, dict[str, Any]] = {}
    for entry in state.get("signals") or []:
        if isinstance(entry, dict) and entry.get("symbol"):
            index[str(entry["symbol"])] = entry
    return index


def events_view(state: dict[str, Any], limit: int = 30) -> list[dict[str, Any]]:
    events = [e for e in (state.get("events") or []) if isinstance(e, dict)]
    return list(reversed(events[-limit:]))


def boot_warning(state: dict[str, Any]) -> str:
    """The engine's startup warning, surfaced rather than left in a log."""
    value = state.get("boot_warning")
    return str(value) if value else ""


# =====================================================================================
# Rendering
# =====================================================================================
def render_dashboard(state: dict[str, Any] | None, *, rendered_at: str = "",
                     templates_dir: Path | None = None) -> str:
    normalized = normalize_state(state)
    template = jinja_env(templates_dir).get_template(DASHBOARD_TEMPLATE)
    return template.render(
        state=normalized,
        capital=normalized.get("capital") or {},
        l2=l2_view(normalized),
        signals=signal_index(normalized),
        events=events_view(normalized),
        boot_warning=boot_warning(normalized),
        rendered_at=rendered_at,
        # The same normalized state the server rendered, so client-side updates start from the exact
        # values the operator can already see rather than from a second, divergent read.
        bootstrap={"state": normalized},
    )


def render_login(*, next_path: str = "/", templates_dir: Path | None = None) -> str:
    template = jinja_env(templates_dir).get_template(LOGIN_TEMPLATE)
    return template.render(next_path=next_path)
