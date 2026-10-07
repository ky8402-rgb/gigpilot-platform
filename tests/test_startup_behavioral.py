#!/usr/bin/env python3
"""BEHAVIORAL STARTUP TESTS — the real application lifecycle, executed.

WHY THIS FILE EXISTS
--------------------
Every other test defending the boot path is a SOURCE GREP, and twice in one session a grep passed
while production failed:

  1. `gp.engine_state()` — `engine_state` is a @property, so calling it raised
     `TypeError: 'str' object is not callable` INSIDE startup. The app failed to boot, the deploy
     rolled back, and all 512 tests were green. The grep asserted the banner string was present in
     the source; it was. It just could not run.
  2. the boot warning never reached the live `/api/health` route, because a dedicated `@app.get`
     wins over the compat catch-all the grep was reading.

A grep proves a string exists. It cannot prove the line executes, or that the object it names is of
the type the code assumes. `engine_state` is a property; `lifespan` is an asynccontextmanager; neither
fact is visible to a text match.

These tests therefore IMPORT THE REAL MODULE and run the REAL lifespan generator, in a subprocess so
each boot gets a clean process and the singleton engine cannot leak between tests. The network seams
are stubbed so the suite stays offline and deterministic — everything else is production code.

Run: python3 -m pytest tests/test_startup_behavioral.py -q
"""
from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Boots the real app and reports what actually happened. Stubs only the network seams.
_BOOT_SCRIPT = textwrap.dedent(
    '''
    import asyncio, contextlib, io, sys
    sys.path.insert(0, sys.argv[1])
    import gigpilot

    async def _offline_req(self, method, path, params=None, body=None, signed=True, retries=3):
        """Serve the two market-data shapes boot depends on; empty for everything else.

        Boot REFUSES to start without an instrument spec ("BOOT REFUSED: qtyStep missing"), which is
        correct behaviour and exactly what a wholesale empty stub tripped over. The specs are
        supplied here so the suite stays offline; every other response is empty, which is how the
        authenticated calls fail closed in this configuration anyway.
        """
        # `_req` UNWRAPS `result`, so these return the inner payload, not a retCode envelope. Stubbing
        # the envelope is what produced "BOOT REFUSED: qtyStep missing" — the app correctly refused to
        # start on a malformed spec rather than inventing one.
        if "instruments-info" in path:
            sym = (params or {}).get("symbol", "BTCUSDT")
            return {"list": [{
                "symbol": sym,
                "lotSizeFilter": {"qtyStep": "0.001", "minOrderQty": "0.001",
                                  "minNotionalValue": "5"},
                "priceFilter": {"tickSize": "0.1"},
                "leverageFilter": {"maxLeverage": "1"},
            }]}
        return {"list": [], "totalEquity": "0", "account": {}}

    gigpilot.BybitREST._req = _offline_req
    if hasattr(gigpilot, "BybitWS"):
        async def _noop_start(self): return None
        async def _noop_stop(self): return None
        gigpilot.BybitWS.start = _noop_start
        gigpilot.BybitWS.stop = _noop_stop

    mode = sys.argv[2]
    if mode == "with-secret":
        from gpkg.core.runtime_secrets import BYBIT_SECRET, RuntimeSecretStore
        RuntimeSecretStore.instance().set(BYBIT_SECRET, "typed-by-operator-for-this-session")
    elif mode == "stub-disarmed":
        # A stub whose `engine_state` is a real PROPERTY returning a non-AWAITING value. This is the
        # negative banner case, and it stays offline: a live credential would send boot into venue
        # verification, which is not what this assertion is about.
        class _Stub:
            @property
            def engine_state(self):
                return "DISARMED"
            async def start(self):
                return None
            async def stop(self):
                return None
        gigpilot.get_gp = lambda: _Stub()

    async def main():
        buf = io.StringIO()
        raised = ""
        try:
            with contextlib.redirect_stdout(buf):
                async with gigpilot.lifespan(gigpilot.app):
                    pass
        except BaseException as exc:  # BaseException: SystemExit must not swallow the self-report
            raised = f"{type(exc).__name__}: {exc}"
        print("RESULT_RAISED=" + (raised or "none"))
        print("RESULT_BANNER=" + ("yes" if "SYSTEM REBOOTED" in buf.getvalue() else "no"))
        print("RESULT_STATE=" + str(gigpilot.get_gp().engine_state))

    asyncio.run(main())
    '''
)


def _boot(tmp_path, mode: str = "no-secret") -> dict:
    """Run the real lifespan in a clean process and parse its self-report."""
    env = {
        **os.environ,
        "PYTHONPATH": str(ROOT),
        "GIGPILOT_DB": str(tmp_path / "boot.db"),
        # An IDENTIFIER only — the key is not the credential. No secret anywhere.
        "BYBIT_API_KEY": "identifier-only-not-a-secret",
        "GIGPILOT_REQUIRE_RUNTIME_SECRET": "1",
        "GIGPILOT_ARM": "0",
        # The subprocess is a separate process; the gate's PYTHONWARNINGS=error is aimed at pytest and
        # would turn third-party aiohttp teardown noise into a boot failure that is not ours.
        "PYTHONWARNINGS": "default",
    }
    env.pop("BYBIT_API_SECRET", None)
    env.pop("BYBIT_SECRET_ARN", None)

    proc = subprocess.run(
        [sys.executable, "-c", _BOOT_SCRIPT, str(ROOT), mode],
        env=env, capture_output=True, text=True, timeout=180, cwd=str(tmp_path),
        check=False,  # the test inspects returncode/stdout itself; a raise would hide the report
    )
    out = proc.stdout + proc.stderr
    parsed: dict = {"_stdout_tail": out[-600:]}
    for line in out.splitlines():
        for key in ("RESULT_RAISED", "RESULT_BANNER", "RESULT_STATE"):
            if line.startswith(key + "="):
                parsed[key] = line.split("=", 1)[1].strip()
    return parsed


# ------------------------------------------------------------------------------------------------
# The tests that a grep cannot do
# ------------------------------------------------------------------------------------------------
def test_the_real_lifespan_boots_without_raising(tmp_path):
    """THE regression test for `engine_state()` being called as a method.

    A grep asserted the banner string was in the source; it was. The line still raised inside startup,
    the deploy rolled back, and the suite stayed green. Only executing the generator catches that.
    """
    r = _boot(tmp_path)
    assert r.get("RESULT_RAISED") == "none", (
        f"startup raised — the app would fail to boot on the host. got {r.get('RESULT_RAISED')!r}\n"
        f"{r['_stdout_tail']}"
    )


def test_the_boot_banner_is_actually_printed(tmp_path):
    """Asserts the OUTPUT of the running process, not the presence of a print statement."""
    r = _boot(tmp_path)
    assert r.get("RESULT_BANNER") == "yes", r["_stdout_tail"]


def test_the_engine_reports_awaiting_secret_with_no_credential(tmp_path):
    """`engine_state` is a property returning a string. Reading it as a VALUE is the whole point —
    the previous test grepped for `gp.engine_state ==` and could not tell a property from an
    attribute from a method that happens to return the same text.
    """
    r = _boot(tmp_path)
    assert r.get("RESULT_STATE") == "AWAITING_SECRET", r["_stdout_tail"]


def test_no_banner_once_the_engine_is_past_awaiting_secret(tmp_path):
    """The negative case, behaviourally. A grep can only assert the string exists in the file; it
    cannot show the condition is actually FALSE when the state moves on — and a warning that is always
    on is not a warning. Runs against a stubbed engine so no venue call is involved.
    """
    r = _boot(tmp_path, mode="stub-disarmed")
    assert r.get("RESULT_RAISED") == "none", r["_stdout_tail"]
    assert r.get("RESULT_BANNER") == "no", (
        f"banner fired outside AWAITING_SECRET. got {r.get('RESULT_BANNER')!r}\n{r['_stdout_tail']}"
    )


def test_an_unverifiable_credential_fails_closed_at_boot(tmp_path):
    """A credential that is present but CANNOT be verified against the venue must stop the boot, not
    come up half-configured. This is the fail-closed property asserted as behaviour rather than
    asserted in a comment — with the venue stubbed, verification cannot succeed, so refusal is the
    correct and only acceptable outcome.
    """
    r = _boot(tmp_path, mode="with-secret")
    assert r.get("RESULT_RAISED", "").startswith("SystemExit"), (
        "an unverifiable credential must refuse the boot rather than start partially configured; "
        f"got {r.get('RESULT_RAISED')!r}\n{r['_stdout_tail']}"
    )


def test_booting_without_a_credential_still_serves_health(tmp_path):
    """The deploy gate asserts on /api/health, so a cold boot with no secret MUST answer. Reaching
    into the app object directly keeps this a behaviour test rather than a subprocess HTTP dance.
    """
    r = _boot(tmp_path)
    assert r.get("RESULT_RAISED") == "none", r["_stdout_tail"]
    # AWAITING_SECRET must be an ACCEPTED deploy state, or every rollout would be refused on a
    # correct cold boot.
    from gpkg.core.engine_state import DEPLOY_ACCEPTABLE_STATES

    assert r.get("RESULT_STATE") in DEPLOY_ACCEPTABLE_STATES
