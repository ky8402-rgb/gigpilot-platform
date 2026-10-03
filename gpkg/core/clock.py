"""System clock, timestamp, and floating-point conversion utilities.

Zero side-effects, zero network imports.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any


def now_ms() -> int:
    """Returns the current Unix timestamp in milliseconds."""
    return int(time.time() * 1000)


def now_iso() -> str:
    """Returns the current UTC ISO-8601 timestamp with millisecond precision."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def f(x: Any, default: float = 0.0) -> float:
    """Safely converts a value to float, returning default on None or ValueError."""
    try:
        return float(x)
    except (TypeError, ValueError):
        return default
