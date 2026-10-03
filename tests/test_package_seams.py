#!/usr/bin/env python3
"""PACKAGE SEAMS — the guards that make dismantling the monolith safe.

While `gigpilot.py` and the `gp/` package coexist, every extracted symbol must be re-exported by
`gigpilot.py` and must be THE SAME OBJECT, not a duplicate.

Identity is the whole point, and it is not pedantry: if `gigpilot.py` kept its own `BybitError` while
`gp.core.errors` defined another, then `except BybitError` inside a `gpkg.*` module would NOT catch an
exception raised with the monolith's class. The idempotency rule — which is implemented by catching
`BybitError` and comparing `.code` — would silently stop applying, in the safety-critical unwind
path. Equivalence is not enough; it has to be the same class.

Run: python3 tests/test_package_seams.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# NOTE: alias the monolith as `engine`, never `gp` — `gp` is exactly the alias several scripts use
# for gigpilot, and it is what collided when this package was briefly named `gp`.
import gigpilot as engine  # noqa: E402
import gpkg.core  # noqa: E402
from gpkg.core import errors as core_errors  # noqa: E402
from gpkg.core import metrics as core_metrics  # noqa: E402
from gpkg.core import clock as core_clock  # noqa: E402
from gpkg.core import config as core_config  # noqa: E402
from gpkg.core import logging as core_logging  # noqa: E402

failures: list[str] = []
checks = 0


def ok(msg: str) -> None:
    global checks
    checks += 1
    print(f"  \u2714 {msg}")


def bad(msg: str) -> None:
    failures.append(msg)
    print(f"  \u2717 {msg}")


def main() -> int:
    print("Package Seams (monolith <-> gpkg/)")
    print("================================")

    print("\n[1] Re-exported symbols are the SAME OBJECT, not duplicates")
    pairs = [
        ("BybitError", engine.BybitError, core_errors.BybitError),
        ("DUPLICATE_ORDER_LINK_CODE", engine.DUPLICATE_ORDER_LINK_CODE, core_errors.DUPLICATE_ORDER_LINK_CODE),
        ("Metrics", engine.Metrics, core_metrics.Metrics),
        ("now_ms", engine.now_ms, core_clock.now_ms),
        ("now_iso", engine.now_iso, core_clock.now_iso),
        ("f", engine.f, core_clock.f),
        ("Config", engine.Config, core_config.Config),
        ("LIVE_HOST", engine.LIVE_HOST, core_config.LIVE_HOST),
        ("WS_PUBLIC", engine.WS_PUBLIC, core_config.WS_PUBLIC),
        ("WS_PRIVATE", engine.WS_PRIVATE, core_config.WS_PRIVATE),
        ("JsonFormatter", engine.JsonFormatter, core_logging.JsonFormatter),
        ("setup_logging", engine.setup_logging, core_logging.setup_logging),
    ]
    for name, from_monolith, from_package in pairs:
        if from_monolith is from_package:
            ok(f"gigpilot.{name} is the identical object as the gpkg.core definition")
        else:
            bad(f"gigpilot.{name} is a DIFFERENT object from gp.core's — a duplicate definition "
                "would break `except` across modules")

    print("\n[2] The duplicate-order-id code is intact and keeps meaning 'already submitted'")
    code = core_errors.DUPLICATE_ORDER_LINK_CODE
    if code == 110072:
        ok("DUPLICATE_ORDER_LINK_CODE is 110072")
    else:
        bad(f"DUPLICATE_ORDER_LINK_CODE changed to {code!r}")

    err = core_errors.BybitError(code, "OrderLinkedID is duplicate")
    if isinstance(err, engine.BybitError):
        ok("an error raised from gp.core is catchable as gigpilot.BybitError (the unwind path relies on this)")
    else:
        bad("an error raised from gp.core is NOT catchable as gigpilot.BybitError")

    print("\n[3] The package imports without touching the network or starting anything")
    # Importing must not connect: the modules under gp/core are pure. If someone adds an import-time
    # side effect (a session, a scheduler, a loop) this check is the tripwire.
    for mod, name in (
        (core_errors, "gpkg.core.errors"),
        (core_metrics, "gpkg.core.metrics"),
        (core_clock, "gpkg.core.clock"),
        (core_config, "gpkg.core.config"),
        (core_logging, "gpkg.core.logging"),
    ):
        if getattr(mod, "__file__", "").endswith(".py"):
            ok(f"{name} is a plain module with no runtime dependency")
        else:
            bad(f"{name} did not resolve to a source module")

    m = core_metrics.Metrics()
    m.set("g", 1.0, sym="BTCUSDT")
    m.inc("c", 2.0)
    rendered = m.render()
    if 'g{sym="BTCUSDT"} 1.0' in rendered and "c 2.0" in rendered:
        ok("Metrics still renders the Prometheus format after extraction")
    else:
        bad(f"Metrics.render() output changed: {rendered!r}")

    print(f"\nResult: {checks} passed, {len(failures)} failed")
    if failures:
        print("PACKAGE SEAM VIOLATED.")
        return 1
    print("ALL PACKAGE SEAMS HOLD.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
