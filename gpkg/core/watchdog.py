"""Fail-closed supervision for long-lived trading tasks.

A task crash is never treated as a harmless background error: the watchdog disarms first,
records the incident, then allows a bounded restart. Repeated crashes open a persistent
circuit breaker so a flapping process cannot repeatedly regain a path to capital.
"""
from __future__ import annotations

import time
from collections.abc import Callable


class TaskWatchdog:
    def __init__(
        self,
        *,
        disarm: Callable[[str], None],
        # `Store.journal` accepts `symbol: str | None`, and system-level events (watchdog
        # trips, ARM, circuit opens) genuinely have no symbol. The narrow annotation was the defect —
        # the call site was right.
        journal: Callable[[str, str | None, dict], None],
        metric_inc: Callable[..., None],
        max_failures: int = 3,
        window_s: float = 60.0,
        restart_delay_s: float = 5.0,
    ) -> None:
        if max_failures < 1 or window_s <= 0 or restart_delay_s < 0:
            raise ValueError("invalid watchdog configuration")
        self.disarm = disarm
        self.journal = journal
        self.metric_inc = metric_inc
        self.max_failures = max_failures
        self.window_s = window_s
        self.restart_delay_s = restart_delay_s
        self._failures: list[float] = []
        self.circuit_open = False

    def failure(self, task_name: str, exc: BaseException | None = None) -> bool:
        """Record a crash. Returns True only when a restart is permitted."""
        now = time.monotonic()
        self._failures = [t for t in self._failures if now - t <= self.window_s]
        self._failures.append(now)
        reason = f"watchdog: task {task_name} stopped unexpectedly"
        if exc is not None:
            reason += f": {type(exc).__name__}"
        self.disarm(reason)
        self.metric_inc("gigpilot_watchdog_failures_total", task=task_name)
        self.journal("WATCHDOG_FAILURE", None, {"task": task_name, "error": str(exc or "")[:200]})
        if len(self._failures) >= self.max_failures:
            self.circuit_open = True
            self.metric_inc("gigpilot_watchdog_circuit_open_total")
            self.journal(
                "WATCHDOG_CIRCUIT_OPEN",
                None,
                {"task": task_name, "failures": len(self._failures), "window_s": self.window_s},
            )
            return False
        return True

    def snapshot(self) -> dict:
        now = time.monotonic()
        self._failures = [t for t in self._failures if now - t <= self.window_s]
        return {
            "circuit_open": self.circuit_open,
            "failures_in_window": len(self._failures),
            "max_failures": self.max_failures,
            "window_s": self.window_s,
            "restart_delay_s": self.restart_delay_s,
        }
