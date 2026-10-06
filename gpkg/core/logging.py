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
        from gpkg.core.runtime_secrets import scrub_text

        p = {"ts": now_iso(), "level": r.levelname, "msg": r.getMessage(), "logger": r.name}
        if r.exc_info:
            # Tracebacks are a real leak path: HTTP client errors routinely embed the request body,
            # and a signed Bybit request carries the signature derived from the secret. The formatted
            # exception is scrubbed even though the redaction filter already saw the record, because
            # `formatException` builds new text AFTER the filter runs.
            p["exc"] = scrub_text(self.formatException(r.exc_info))
        for k, v in getattr(r, "extra", {}).items():
            p[k] = v
        # Final pass over the assembled payload: the message and `extra` are already filtered, but
        # re-serialising means a value that was injected outside a record (a context var, a nested
        # dict) still gets caught before it reaches stdout.
        return scrub_text(json.dumps(p, separators=(",", ":")))


def setup_logging(level: str = "INFO") -> logging.Logger:
    """Configures root and gigpilot loggers to emit JSON to stdout, with secret redaction.

    The redaction filter is installed HERE, at the single point where every handler is created,
    rather than at individual call sites. A filter attached per-logger leaks the moment another
    module or a third-party library adds a logger and logs a request body — and those are exactly
    the paths that carry a live API secret.
    """
    from gpkg.core.runtime_secrets import install_redaction

    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [h]
    root.setLevel(level.upper())
    install_redaction()
    return logging.getLogger("gigpilot")
