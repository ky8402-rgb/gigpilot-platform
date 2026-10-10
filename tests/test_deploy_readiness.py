#!/usr/bin/env python3
"""DEPLOY READINESS — daemon health must not be hostage to live arming.

Regression origin
-----------------
`/api/health` folded the private (authenticated) WebSocket into `healthy`. In runtime-secret mode
there is no credential at cold boot, so that socket cannot connect, so the process reported itself
unhealthy, so the endpoint answered 503 and every deploy gate's `curl --fail` refused the release.
Worse, the only route that accepts the secret is `POST /api/arm` on that same server — and
`GigPilot.start()` raised `SystemExit(2)` before uvicorn could serve it at all. The deployment could
not be released and the secret could not be supplied: a genuine deadlock, and one that looked like a
credential problem from the outside.

These tests pin both halves of the fix: the boot no longer refuses when the secret is simply absent,
and the health contract separates "the daemon is alive" from "capital is authorised".

Run: python3 tests/test_deploy_readiness.py
"""
from __future__ import annotations

import inspect
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.core.engine_state import (
    ARMED,
    AWAITING_SECRET,
    DEPLOY_ACCEPTABLE_STATES,
    DISARMED,
    ENGINE_STATES,
    assess_engine_state,
    is_deploy_acceptable,
    ready_for_arming,
)

# There is exactly ONE host gate script. It used to be duplicated (a root copy and a scripts/ copy)
# and the two drifted apart — an assertion fixed in one silently stayed broken in the other. The
# duplication was removed along with the Amplify/Node deployment surface.
VERIFY_SCRIPTS = [ROOT / "scripts" / "verify-production.sh"]


# =============================================================================================
# THE STATE MACHINE
# =============================================================================================
def test_state_machine_truth_table():
    base = {"require_runtime_secret": False, "secret_loaded": True,
                "execution_mode": "live", "armed": False}
    assert assess_engine_state(**base) == DISARMED
    assert assess_engine_state(**{**base, "armed": True}) == ARMED
    # LIVE-ONLY: a non-live mode is a CONFIGURATION ERROR (`Config.from_env` refuses it and exits),
    # not a state. If one somehow reaches the assessor it reports DISARMED — never a simulation
    # state — so an unexpected mode reads as "idle and doing nothing" rather than "running safely".
    for mode in ("paper", "sim", "testnet", ""):
        assert assess_engine_state(**{**base, "execution_mode": mode}) == DISARMED, mode
        assert assess_engine_state(**{**base, "execution_mode": mode,
                                      "armed": True}) == DISARMED, mode


def test_awaiting_secret_dominates_every_other_input():
    """With no secret in runtime-secret mode, nothing can be signed — that fact outranks the rest.
    Reporting DISARMED would suggest an operator only needs to press ARM, when ARM cannot succeed."""
    for mode in ("live", "paper"):
        for armed in (True, False):
            state = assess_engine_state(require_runtime_secret=True, secret_loaded=False,
                                        execution_mode=mode, armed=armed)
            assert state == AWAITING_SECRET, (mode, armed, state)


def test_no_input_combination_reports_armed_without_live_mode_and_arming():
    """Totality check: ARMED is unreachable unless live execution is configured AND armed.

    Modes are compared after the same normalisation the state machine applies, so "LIVE" and
    " live " are correctly treated as live rather than as a loophole.
    """
    for require in (True, False):
        for secret in (True, False):
            for mode in ("live", "paper", "LIVE", " paper ", ""):
                for armed in (True, False):
                    state = assess_engine_state(require_runtime_secret=require, secret_loaded=secret,
                                                execution_mode=mode, armed=armed)
                    assert state in ENGINE_STATES
                    if state == ARMED:
                        assert str(mode).strip().lower() == "live" and armed


def test_a_loaded_secret_only_ever_adds_capability_never_removes_it():
    """Fail-closed direction: `secret_loaded` can clear AWAITING_SECRET, never create ARMED."""
    without = assess_engine_state(require_runtime_secret=False, secret_loaded=False,
                                  execution_mode="live", armed=False)
    with_secret = assess_engine_state(require_runtime_secret=False, secret_loaded=True,
                                      execution_mode="live", armed=False)
    assert without == with_secret == DISARMED


def test_ready_for_arming_is_true_only_while_awaiting_the_secret():
    assert ready_for_arming(AWAITING_SECRET) is True
    for other in (ARMED, DISARMED, "nonsense"):
        assert ready_for_arming(other) is False, other


def test_deploy_accepts_every_state_that_does_not_require_live_credentials():
    assert AWAITING_SECRET in DEPLOY_ACCEPTABLE_STATES
    assert ARMED in DEPLOY_ACCEPTABLE_STATES
    # DISARMED is now acceptable BY DESIGN. The mode is unconditionally live and the deploy pins
    # GIGPILOT_LIVE_ARMED=0, so "live mode, boundary closed, idle" is the NORMAL resting state after
    # a rollout rather than a fault — requiring ARMED would make every deploy self-sealing.
    assert DISARMED in DEPLOY_ACCEPTABLE_STATES
    assert is_deploy_acceptable(AWAITING_SECRET) is True
    assert "PAPER" not in ENGINE_STATES, "live-only: there is no simulation state"


# =============================================================================================
# THE BOOT NO LONGER DEADLOCKS
# =============================================================================================
def test_boot_source_does_not_unconditionally_refuse_on_missing_credentials():
    """Structural, and it is the crux of the deadlock.

    `raise SystemExit(2)` must sit INSIDE the `if self._has_signing_secret()` guard. If it ever moves
    back out, a secret-less cold boot kills the process before uvicorn can serve `/api/health` or
    `POST /api/arm` — and there is no other way to deliver the secret.
    """
    src = inspect.getsource(__import__("gigpilot").GigPilot.start)
    guard = src.index("if self._has_signing_secret():")
    refusal = src.index("raise SystemExit(2)")
    assert guard < refusal, "the credential refusal no longer follows the has-secret guard"
    # The refusal must be indented under the guard, not a sibling of it.
    guard_line = src[:guard].count("\n")
    refusal_line = src[:refusal].count("\n")
    guard_indent = len(src.splitlines()[guard_line]) - len(src.splitlines()[guard_line].lstrip())
    refusal_indent = len(src.splitlines()[refusal_line]) - len(src.splitlines()[refusal_line].lstrip())
    assert refusal_indent > guard_indent, "SystemExit(2) escaped the credential guard"


def test_boot_reports_position_mode_unknown_rather_than_assuming_one_way():
    """Claiming 'one-way' without reading it would let a hedge account present as safe."""
    src = inspect.getsource(__import__("gigpilot").GigPilot.start)
    assert 'self.position_mode = "unknown"' in src, (
        "a credential-less boot must report position_mode 'unknown', never an assumed 'one-way'"
    )


@pytest.mark.asyncio
async def test_engine_boots_without_a_secret_and_reports_awaiting_secret(make_engine, monkeypatch):
    """The end-to-end boot decision: no secret, no refusal, no assumed safety."""
    import gigpilot as gp
    from gpkg.core.runtime_secrets import RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    engine, _ = make_engine(require_runtime_secret=True, api_secret="")

    # Neutralise the long-running loops: this test is about the boot DECISION, not about running the
    # engine. `start()` binds `self.ws.start` and the loop methods into `_task_factories` at its end,
    # so patching the methods keeps the boot path intact while making the tasks no-ops.
    async def _noop(*_a, **_k):
        return None

    for name in ("_strategy_loop", "_reconcile_loop", "_portfolio_loop", "_daily_reset_loop",
                 "_accounting_loop", "_watchdog_loop"):
        monkeypatch.setattr(gp.GigPilot, name, _noop)
    monkeypatch.setattr(gp.BybitWS, "start", _noop)

    assert engine._has_signing_secret() is False
    await engine.start()  # must NOT raise SystemExit

    assert engine.position_mode == "unknown", "an unread position mode was reported as read"
    assert engine.engine_state == AWAITING_SECRET
    assert engine.live_armed is False
    assert engine.ready_for_arming is True


# =============================================================================================
# THE HEALTH CONTRACT
# =============================================================================================
def _client_for(monkeypatch, engine):
    from fastapi.testclient import TestClient

    import gigpilot as gp

    monkeypatch.setattr(gp, "get_gp", lambda: engine)
    return TestClient(gp.app, raise_server_exceptions=False)


def test_health_is_200_and_ok_while_awaiting_the_secret(make_engine, monkeypatch):
    """A correct cold boot must PASS a deploy gate. This is the assertion that was impossible."""
    from gpkg.core.runtime_secrets import RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    engine, _ = make_engine(require_runtime_secret=True, api_secret="")
    client = _client_for(monkeypatch, engine)

    r = client.get("/api/health")
    assert r.status_code == 200, f"cold boot must be deployable, got {r.status_code}: {r.text}"
    body = r.json()
    assert body["status"] == "ok"
    assert body["healthy"] is True
    assert body["engine_state"] == AWAITING_SECRET
    assert body["ready_for_arming"] is True
    assert body["live_armed"] is False
    # Live trading is still correctly NOT considered possible.
    assert body["trading_ready"] is False


def test_snapshot_exposes_lifecycle_state_for_the_banner(make_engine):
    """The console banner distinguishes policy-disarm / awaiting-secret / armed, so the snapshot must
    carry the lifecycle fields the banner reads (not just a single `armable` boolean)."""
    from gpkg.core.runtime_secrets import RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    engine, _ = make_engine(require_runtime_secret=True, api_secret="")

    snap = engine.snapshot()
    assert snap["engine_state"] == AWAITING_SECRET
    assert snap["ready_for_arming"] is True
    assert snap["force_disarm"] is False

    template = (ROOT / "gpkg" / "web" / "templates" / "dashboard.html").read_text(encoding="utf-8")
    assert "Awaiting Arming" in template
    assert 's.engine_state === "AWAITING_SECRET" || s.ready_for_arming === true' in template
    assert "GIGPILOT_FORCE_DISARM" in template


def test_health_reports_the_daemon_honestly_when_the_public_feed_is_down(make_engine, monkeypatch):
    """The loosening must not have removed the ability to FAIL. A daemon whose market data is gone is
    unhealthy and must 503 — the change is about the private socket being credential-gated, not
    about ignoring infrastructure."""
    from gpkg.core.runtime_secrets import RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    engine, _ = make_engine(require_runtime_secret=True, api_secret="")
    engine.ws._public_ok = False
    client = _client_for(monkeypatch, engine)

    r = client.get("/api/health")
    assert r.status_code == 503
    body = r.json()
    assert body["healthy"] is False
    assert body["status"] == "degraded"


def test_health_reports_the_database_as_a_first_class_dependency(make_engine, monkeypatch):
    from gpkg.core.runtime_secrets import RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    engine, _ = make_engine(require_runtime_secret=True, api_secret="")

    def _explode(_key):
        raise RuntimeError("database is gone")

    engine.store.kv_get = _explode
    client = _client_for(monkeypatch, engine)
    r = client.get("/api/health")
    assert r.status_code == 503, "an unreadable database was reported as healthy"
    body = r.json()
    assert body["database"]["status"] == "error"
    assert body["healthy"] is False


def test_private_websocket_is_expected_only_once_a_secret_exists(make_engine, monkeypatch):
    """In AWAITING_SECRET the private socket CANNOT be up; its absence is by design and must not be
    what marks the daemon unhealthy. Once a secret exists it must be required again."""
    from gpkg.core.runtime_secrets import BYBIT_SECRET, RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    engine, _ = make_engine(require_runtime_secret=True, api_secret="")
    engine.ws._private_ok = False
    client = _client_for(monkeypatch, engine)

    body = client.get("/api/health").json()
    assert body["engine_state"] == AWAITING_SECRET
    assert body["websockets"]["private_expected"] is False
    assert body["healthy"] is True, "the credential-gated socket was treated as a daemon fault"

    # With a secret loaded and live execution armed, a dead private socket IS a real problem.
    RuntimeSecretStore.instance().set(BYBIT_SECRET, "a-runtime-secret-value")
    engine.armed = True
    body2 = client.get("/api/health").json()
    assert body2["engine_state"] == ARMED
    assert body2["websockets"]["private_expected"] is True
    assert body2["healthy"] is False, "an armed engine must require its authenticated socket"


# =============================================================================================
# AWAITING_SECRET -> ARMED
# =============================================================================================
def test_posting_the_runtime_secret_transitions_awaiting_secret_to_armed(make_engine, monkeypatch):
    """The transition the deadlock made impossible, asserted end to end through the real endpoint.

    Nothing is stubbed but the exchange: the same `assess_engine_state`, the same `_arm_gate_check`,
    the same `/api/arm` handler.
    """
    from gpkg.api import auth as auth_mod
    from gpkg.core.runtime_secrets import RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    monkeypatch.setenv("OWNER_AUTH_PIN", "test-pin-123456")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    auth_mod._OWNER_AUTH = None

    engine, fake = make_engine(require_runtime_secret=True, api_secret="")
    client = _client_for(monkeypatch, engine)
    token = auth_mod.get_owner_auth().mint()

    # 1. The resting state: deployable, not trading, and explicitly awaiting input.
    before = client.get("/api/health").json()
    assert before["engine_state"] == AWAITING_SECRET
    assert before["ready_for_arming"] is True
    assert before["live_armed"] is False

    # 2. Arming without a secret is refused with an actionable code, not a crash.
    refused = client.post("/api/arm", json={}, headers={"Authorization": f"Bearer {token}"})
    assert refused.status_code == 428, refused.text
    assert refused.json()["error"] == "API_SECRET_REQUIRED"
    assert engine.engine_state == AWAITING_SECRET

    # 3. Supplying the secret arms the engine.
    armed = client.post("/api/arm", json={"apiSecret": "a-runtime-secret-value"},
                        headers={"Authorization": f"Bearer {token}"})
    assert armed.status_code == 200, armed.text
    assert armed.json()["armed"] is True
    assert engine.armed is True
    assert engine.engine_state == ARMED
    assert engine.live_armed is True
    # Arming must never place an order; the gate is strictly non-mutating.
    assert fake.placed_orders == []

    # 4. And the contract reports the new state, with arming no longer the outstanding action.
    after = client.get("/api/health").json()
    assert after["engine_state"] == ARMED
    assert after["live_armed"] is True
    assert after["ready_for_arming"] is False


def test_the_secret_never_appears_in_the_health_payload(make_engine, monkeypatch):
    """The new public fields must not have opened a path to the secret itself."""
    from gpkg.core.runtime_secrets import BYBIT_SECRET, RuntimeSecretStore

    RuntimeSecretStore.reset_for_tests()
    engine, _ = make_engine(require_runtime_secret=True, api_secret="")
    secret = "super-secret-runtime-value-xyz"
    RuntimeSecretStore.instance().set(BYBIT_SECRET, secret)
    client = _client_for(monkeypatch, engine)

    raw = client.get("/api/health").text
    assert secret not in raw
    assert secret[:8] not in raw


# =============================================================================================
# THE GATE SCRIPTS
# =============================================================================================
@pytest.mark.parametrize("script", VERIFY_SCRIPTS, ids=lambda p: str(p.relative_to(ROOT)))
def test_gate_script_asserts_the_lifecycle_contract(script):
    text = script.read_text(encoding="utf-8")
    assert "engine_state" in text, f"{script.name} does not assert engine_state"
    # Equivalent spellings of the same assertion are all acceptable. What matters is that the gate
    # checks the daemon reports ok, rather than only that it answered.
    compact = text.replace(" ", "")
    assert ('"status":"ok"' in compact or 'status="ok"' in compact
            or 'status": "ok"' in text or "status=ok" in text), (
        f"{script.name} does not assert the daemon status is ok"
    )
    for state in ("AWAITING_SECRET", "ARMED", "DISARMED"):
        assert state in text, f"{script.name} does not accept {state}"
    assert "healthy" in text


@pytest.mark.parametrize("script", VERIFY_SCRIPTS, ids=lambda p: str(p.relative_to(ROOT)))
def test_gate_script_does_not_require_live_arming(script):
    """The gate must not demand an armed engine: it is reached BEFORE the secret can be supplied."""
    text = script.read_text(encoding="utf-8")
    for forbidden in ("live_armed", "require_armed", "trading_ready"):
        assert forbidden not in text, (
            f"{script.name} gates on {forbidden!r}; the deploy gate runs before live arming and "
            "must not require it"
        )


def test_the_host_gate_script_is_not_duplicated():
    """The old arrangement shipped two near-identical copies that drifted apart, so a fix applied to
    one left the other broken. The duplication is gone; assert it stays gone rather than asserting
    that two copies still agree.
    """
    candidates = sorted(
        str(p.relative_to(ROOT))
        for p in list(ROOT.glob("verify-production.sh"))
        + list(ROOT.glob("scripts/*verify-production*.sh"))
    )
    assert candidates == ["scripts/verify-production.sh"], (
        f"expected exactly one host gate script, found {candidates}"
    )


def test_the_host_gate_script_carries_its_lifecycle_block_once():
    """One gate, one lifecycle assertion, collected in one place and then actually asserted."""
    text = VERIFY_SCRIPTS[0].read_text(encoding="utf-8")
    assert "LIFECYCLE_PROBLEMS=" in text, "the gate collects no lifecycle problems"
    assert 'check_fail "Health lifecycle' in text, (
        "the lifecycle block is collected but never asserted"
    )


def test_deploy_script_takes_the_acceptable_states_from_the_state_machine():
    """No local copy of the state list, or the gate silently drifts from the contract."""
    text = (ROOT / "scripts" / "deploy-ec2.sh").read_text(encoding="utf-8")
    assert "from gpkg.core.engine_state import DEPLOY_ACCEPTABLE_STATES" in text
    assert "engine_state" in text
    # A hardcoded A-wave tuple would be a second source of truth.
    assert not re.search(r"\(\s*[\"']AWAITING_SECRET[\"']", text), (
        "deploy-ec2.sh hardcodes the acceptable state list instead of importing it"
    )


def test_deploy_workflow_asserts_the_lifecycle_contract():
    text = (ROOT / ".github" / "workflows" / "python-deploy.yml").read_text(encoding="utf-8")
    assert "engine_state" in text, "the deploy workflow does not assert engine_state"
    assert "AWAITING_SECRET" in text


def test_deploy_script_no_longer_promises_a_503_on_cold_boot():
    """The old message told operators to expect an unhealthy endpoint for a healthy boot."""
    text = (ROOT / "scripts" / "deploy-ec2.sh").read_text(encoding="utf-8")
    assert "Expect trading_ready=false and HTTP 503" not in text


def test_deploy_workflow_propagates_gemini_api_key():
    """Deploy step passes GEMINI_API_KEY from secrets to the host script export."""
    text = (ROOT / ".github" / "workflows" / "python-deploy.yml").read_text(encoding="utf-8")
    assert "GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY" in text
    assert "export GEMINI_API_KEY=" in text


def test_chatgpt_codex_connector_workflow_configuration():
    """ChatGPT Codex Connector workflow exists and specifies GitHub App write permissions."""
    path = ROOT / ".github" / "workflows" / "chatgpt-codex-connector.yml"
    assert path.is_file(), "chatgpt-codex-connector.yml must exist"
    text = path.read_text(encoding="utf-8")
    assert "name: ChatGPT Codex Connector" in text
    assert "contents: write" in text
    assert "actions: write" in text
    assert "deployments: write" in text
    assert "pull-requests: write" in text
    assert "issues: write" in text
    assert "GEMINI_API_KEY" in text
    assert "OPENAI_API_KEY" in text

