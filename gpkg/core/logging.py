"""Structured JSON logging for GigPilot.

Outputs single-line compact JSON to stdout with UTC timestamps, logger name,
level, message, and optional extra structured fields.
"""
from __future__ import annotations

import json
import logging
import sys

from gpkg.core.clock import now_iso


class JsonFormatter(logging.Formatter):
    """Formats log records as structured, compact JSON."""

    def format(self, r: logging.LogRecord) -> str:
        p = {"ts": now_iso(), "level": r.levelname, "msg": r.getMessage(), "logger": r.name}
        if r.exc_info:
            p["exc"] = self.formatException(r.exc_info)
        for k, v in getattr(r, "extra", {}).items():
            p[k] = v
        return json.dumps(p, separators=(",", ":"))


def setup_logging(level: str = "INFO") -> logging.Logger:
    """Configures root and gigpilot loggers to emit JSON to stdout."""
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [h]
    root.setLevel(level.upper())
    return logging.getLogger("gigpilot")
