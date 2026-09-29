"""Structured logging with credential redaction and an in-memory ring buffer
that the dashboard reads for the live log stream."""
from __future__ import annotations

import json
import logging
import re
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

_SECRET_PATTERNS = [
    re.compile(r"(signature=)[A-Za-z0-9]+"),
    re.compile(r"(api[_-]?key[\"'\s:=]+)[A-Za-z0-9]{6,}", re.I),
    re.compile(r"(X-MBX-APIKEY:\s*)\S+", re.I),
]

_RING: Deque[Dict[str, Any]] = deque(maxlen=800)
_RING_LOCK = threading.Lock()

_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "taskName", "message", "asctime",
}


def scrub(text: str) -> str:
    out = text
    for pat in _SECRET_PATTERNS:
        out = pat.sub(lambda m: m.group(1) + "«redacted»", out)
    return out


class RingBufferHandler(logging.Handler):
    """Captures recent records so the web UI can stream logs without a log file."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = {
                "ts": record.created,
                "iso": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + "Z",
                "level": record.levelname,
                "logger": record.name,
                "msg": scrub(record.getMessage()),
            }
            for k, v in record.__dict__.items():
                if k not in _RESERVED and not k.startswith("_"):
                    try:
                        json.dumps(v)
                        entry[k] = v
                    except Exception:
                        entry[k] = str(v)
            if record.exc_info:
                entry["exc"] = scrub(logging.Formatter().formatException(record.exc_info))
            with _RING_LOCK:
                _RING.append(entry)
        except Exception:  # pragma: no cover - logging must never raise
            pass


def recent_logs(limit: int = 200, min_level: str = "INFO") -> List[Dict[str, Any]]:
    lvl = logging.getLevelName(min_level.upper())
    if not isinstance(lvl, int):
        lvl = logging.INFO
    with _RING_LOCK:
        items = list(_RING)
    return [e for e in items if logging.getLevelName(e["level"]) >= lvl][-limit:]


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": scrub(record.getMessage()),
        }
        for k, v in record.__dict__.items():
            if k not in _RESERVED and not k.startswith("_"):
                try:
                    json.dumps(v)
                    payload[k] = v
                except Exception:
                    payload[k] = str(v)
        if record.exc_info:
            payload["exc"] = scrub(self.formatException(record.exc_info))
        return json.dumps(payload, separators=(",", ":"))


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = f"{time.strftime('%H:%M:%S', time.localtime(record.created))} {record.levelname:<7} {record.name:<24} {scrub(record.getMessage())}"
        for k, v in record.__dict__.items():
            if k not in _RESERVED and not k.startswith("_"):
                base += f" {k}={v}"
        if record.exc_info:
            base += "\n" + scrub(self.formatException(record.exc_info))
        return base


def setup_logging(level: str = "INFO", json_mode: bool = True, log_dir: Optional[Path] = None) -> None:
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(JsonFormatter() if json_mode else TextFormatter())
    root.addHandler(stream)

    ring = RingBufferHandler()
    ring.setLevel(logging.INFO)
    root.addHandler(ring)

    if log_dir is not None:
        log_dir = Path(log_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        from logging.handlers import RotatingFileHandler

        fh = RotatingFileHandler(log_dir / "quant.log", maxBytes=20_000_000, backupCount=7)
        fh.setFormatter(JsonFormatter())
        root.addHandler(fh)

    # Third-party noise control.
    for noisy in ("httpx", "httpcore", "websockets.client", "uvicorn.access", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
