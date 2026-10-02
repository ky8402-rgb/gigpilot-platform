"""Prometheus-style metrics registry.

Dependency-free, so it can be imported by any layer. Extracted from the monolith.
"""
from __future__ import annotations


class Metrics:
    def __init__(self):
        self.g: dict[str, float] = {}
        self.c: dict[str, float] = {}

    def set(self, n: str, v: float, **l: str):
        k = n + ("{" + ",".join(f'{a}="{b}"' for a, b in sorted(l.items())) + "}" if l else "")
        self.g[k] = v

    def inc(self, n: str, v: float = 1.0, **l: str):
        k = n + ("{" + ",".join(f'{a}="{b}"' for a, b in sorted(l.items())) + "}" if l else "")
        self.c[k] = self.c.get(k, 0.0) + v

    def render(self) -> str:
        return "\n".join([f"{k} {v}" for k, v in sorted(self.g.items())] +
                         [f"{k} {v}" for k, v in sorted(self.c.items())]) + "\n"
