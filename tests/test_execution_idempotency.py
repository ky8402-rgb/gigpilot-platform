#!/usr/bin/env python3
"""EXECUTION IDEMPOTENCY — the Python engine (the migration target).

Why this exists: `_req` retries network errors and reuses the same body, hence the SAME
orderLinkId. Bybit dedupes on that key, so a retry following a LOST RESPONSE is answered with
DUPLICATE_ORDER_LINK_CODE even though the first attempt created the order. Reading that as a failure
would report an order — or an emergency flatten — as not having happened while it did.

Before this test, the rule was applied in exactly one of three order paths: `open_protected` had it,
`close_market` had nothing, and `_unwind` logged a CRITICAL "UNWIND FAILED" alarm for a flatten that
had actually succeeded. The rule now lives in one helper that all three use.

Exercises the REAL Executor methods with a stubbed REST client: no network, no credentials, no
exchange state. Run: python3 tests/test_execution_idempotency.py
"""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import gigpilot as gp

failures: list[str] = []
checks = 0


def ok(msg: str) -> None:
    global checks
    checks += 1
    print(f"  \u2714 {msg}")


def bad(msg: str) -> None:
    failures.append(msg)
    print(f"  \u2717 {msg}")


class FakeREST:
    """Stands in for BybitREST: records submissions and raises a scripted outcome."""

    def __init__(self, outcome=None):
        self.outcome = outcome
        self.calls: list[dict] = []

    async def place_order(self, **kw):
        self.calls.append(kw)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome if self.outcome is not None else {"orderId": "OK-1"}


def make_executor(rest: FakeREST) -> gp.Executor:
    """A real Executor without __init__ (which needs a Config/Store). Only `rest` is exercised."""
    ex = gp.Executor.__new__(gp.Executor)
    ex.rest = rest
    return ex


class Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


async def main() -> int:
    print("Execution Idempotency (Python engine)")
    print("=====================================")

    print("\n[1] A duplicate client order id means ALREADY SUBMITTED, not failed")
    ex = make_executor(FakeREST({"orderId": "NEW-1"}))
    res = await ex._place_idempotent("gp-test-fresh", category="linear", symbol="BTCUSDT", side="Buy")
    if res == {"orderId": "NEW-1"}:
        ok("a fresh submit returns the exchange result")
    else:
        bad(f"a fresh submit returned {res!r}")

    dup_rest = FakeREST(gp.BybitError(gp.DUPLICATE_ORDER_LINK_CODE, "OrderLinkedID is duplicate"))
    ex = make_executor(dup_rest)
    try:
        res = await ex._place_idempotent("gp-test-dup", category="linear", symbol="BTCUSDT",
                                        side="Buy", orderType="Market")
        if res is None:
            ok("a duplicate orderLinkId is reported as already-submitted (None), not as an error")
        else:
            bad(f"a duplicate returned {res!r}, expected None")
    except Exception as e:
        bad(f"a duplicate orderLinkId RAISED {type(e).__name__}: {e} — it must be treated as success")
    if len(dup_rest.calls) == 1 and dup_rest.calls[0].get("orderLinkId") == "gp-test-dup":
        ok("the submission still carried its orderLinkId (the key is what makes dedup possible)")
    else:
        bad(f"the duplicate submission did not carry the expected key: {dup_rest.calls}")

    print("\n[2] Genuine failures are still failures (the rule must not swallow them)")
    for label, exc in [
        ("a Bybit business error (invalid order)", gp.BybitError(110001, "order value invalid")),
        ("an exhausted-retry network failure", RuntimeError("REST POST /v5/order/create failed")),
    ]:
        ex = make_executor(FakeREST(exc))
        try:
            await ex._place_idempotent("gp-test-err", category="linear", symbol="BTCUSDT", side="Buy")
            bad(f"{label} was silently treated as success")
        except Exception as e:
            if type(e) is type(exc):
                ok(f"{label} still raises ({type(e).__name__})")
            else:
                bad(f"{label} raised {type(e).__name__}, expected {type(exc).__name__}")

    print("\n[3] The emergency unwind no longer cries wolf — and still cries when it should")
    capture = Capture()
    gp.log.addHandler(capture)
    try:
        ex = make_executor(FakeREST(gp.BybitError(gp.DUPLICATE_ORDER_LINK_CODE, "duplicate")))
        capture.records.clear()
        await ex._unwind("BTCUSDT", "Buy", "0.001", 0)
        crit = [r for r in capture.records if r.levelno >= logging.CRITICAL]
        if not crit:
            ok("a duplicate during UNWIND does NOT raise a CRITICAL alarm (the flatten already happened)")
        else:
            bad(f"a duplicate during UNWIND logged CRITICAL: {crit[0].getMessage()} — a false alarm "
                "in the most safety-critical path")

        ex = make_executor(FakeREST(gp.BybitError(110001, "insufficient balance")))
        capture.records.clear()
        await ex._unwind("BTCUSDT", "Buy", "0.001", 0)
        crit = [r for r in capture.records if r.levelno >= logging.CRITICAL]
        if crit:
            ok("a REAL unwind failure still raises CRITICAL (the alarm was not silenced)")
        else:
            bad("a genuine unwind failure no longer raises CRITICAL — the alarm was silenced")
    finally:
        gp.log.removeHandler(capture)

    print("\n[4] Every order path submits through the one helper")
    executor_file = ROOT / "gpkg" / "execution" / "executor.py"
    if executor_file.is_file():
        src = executor_file.read_text(encoding="utf8")
    else:
        src = (ROOT / "gigpilot.py").read_text(encoding="utf8")
    start = src.index("class Executor:")
    end = src.index("\nclass ", start + 1) if "\nclass " in src[start + 1:] else len(src)
    body = src[start:end]

    # EXCLUDE the helper's own body: `_place_idempotent` legitimately makes the real submission.
    # Counting it as a violation was this assertion being over-broad, not the code being wrong —
    # a direct call is only a problem OUTSIDE the helper.
    helper_start = body.index("async def _place_idempotent")
    helper_end = body.index("async def _unwind", helper_start)
    outside_helper = body[:helper_start] + body[helper_end:]

    direct = outside_helper.count("self.rest.place_order")
    if direct == 0:
        ok("no order path submits OUTSIDE _place_idempotent (the rule cannot be bypassed)")
    else:
        bad(f"{direct} direct self.rest.place_order call(s) remain outside the helper — the rule can "
            "be bypassed by a future edit")
    if body.count("_place_idempotent(") >= 4:  # definition + three call sites
        ok("all three order paths (open / unwind / close) route through the helper")
    else:
        bad("fewer than three call sites use the helper — a path was left outside the rule")

    print(f"\nResult: {checks} passed, {len(failures)} failed")
    if failures:
        print("EXECUTION IDEMPOTENCY VIOLATED.")
        return 1
    print("ALL EXECUTION IDEMPOTENCY INVARIANTS HOLD.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
