#!/usr/bin/env python3
"""HEALTH ENDPOINT — two-tier response, and the same-origin policy it must not break.

Why this file exists
--------------------
`/api/health` is reachable without authentication BY DESIGN: the deployment gate and uptime
monitoring depend on it, so it cannot simply be gated with `require_owner` — locking it down would
freeze every release, including the releases that fix things.

But it was returning the full operational picture to any anonymous caller: the exchange host, the
current arming state, verbatim credential-failure text, and the reasons the engine was not
trade-ready. That is free reconnaissance, and the verbatim error text is the worst of it — it told
an unauthenticated caller exactly why a key was rejected.

The contract these tests pin:
  * the deployment gate's fields are ALWAYS present (a red gate would block all deploys);
  * anonymous callers get no host, no arming state, no failure reasons;
  * owner callers get the full picture;
  * and there is still no wildcard CORS, which is a deliberate choice, not an oversight.

Run: python3 -m pytest tests/test_health_disclosure.py -q
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("BYBIT_API_KEY", "test-key")
os.environ.setdefault("BYBIT_API_SECRET", "test-secret")

from fastapi.testclient import TestClient  # noqa: E402

import gigpilot  # noqa: E402
from gpkg.api.auth import OwnerAuth, OwnerConfig, hash_password  # noqa: E402

SENSITIVE = [
    "host",
    "armed",
    "position_mode",
    "credentials_ok",
    "credentials_error",
    "trade_permissions_ok",
    "trade_permissions_error",
    "trade_permissions_checked_ms_ago",
    "credentials_checked_ms_ago",
    "trading_blockers",
]
GATE_REQUIRED = ["deployedCommit", "autonomousEngine", "healthy", "status"]


class _WS:
    _public_ok = True
    _private_ok = True


class _Reconciler:
    healthy = True
    trade_permissions_ok = False
    last_error = "SECRET-INTERNAL-FAILURE-TEXT: API key rejected at /v5/account/fee-rate"
    trade_permissions_error = "SECRET-REASON: API key lacks the ContractTrade permission"
    last_run_ms = 1
    trade_permissions_ms = 2


class _Cfg:
    staleness_ms = 5000
    host = "https://api-demo-secret-host.example.com"
    execution_mode = "paper"
    require_runtime_secret = False


class _Markets:
    """Empty so the staleness comprehension short-circuits to True."""


class _Store:
    """Minimal stand-in for the SQLite store. The health endpoint's database probe only needs the
    call to answer without raising; a store that raises is what produces `database: error`."""

    def kv_get(self, _key):
        return None


class _FakeGP:
    def __init__(self):
        self.markets = {}
        self.ws = _WS()
        self.reconciler = _Reconciler()
        self.cfg = _Cfg()
        self.store = _Store()
        self.vpin_calibration = {}
        self.position_mode = "hedge"
        self.armed = True

    # The state/readiness properties delegate to the REAL implementations rather than returning
    # hardcoded strings. A double that hardcoded "PAPER" would keep passing after the production
    # state machine changed, which is the drift these endpoint tests exist to catch.
    @property
    def engine_state(self):
        from gpkg.core.engine_state import assess_engine_state
        return assess_engine_state(
            require_runtime_secret=self.cfg.require_runtime_secret,
            secret_loaded=False,
            execution_mode=self.cfg.execution_mode,
            armed=self.armed,
        )

    @property
    def live_armed(self):
        return bool(self.cfg.execution_mode == "live" and self.armed)

    @property
    def ready_for_arming(self):
        from gpkg.core.engine_state import ready_for_arming
        return ready_for_arming(self.engine_state)


SECRET_MARKERS = [
    "api-demo-secret-host.example.com",
    "SECRET-INTERNAL-FAILURE-TEXT",
    "SECRET-REASON",
]


@pytest.fixture
def client(monkeypatch):
    """The real app, with the engine replaced so no exchange connection is attempted."""
    gp = _FakeGP()
    monkeypatch.setattr(gigpilot, "get_gp", lambda: gp)
    return TestClient(gigpilot.app)


@pytest.fixture
def owner_token(monkeypatch):
    salt = "deadbeefdeadbeef"
    cfg = OwnerConfig(
        owner_email="owner@example.com",
        jwt_secret="test-secret-long-enough-for-hs256-signing",
        emergency_pin="a1b2c3d4",
        password_salt=salt,
        password_hash=hash_password("pw", salt),
        totp_secret="JBSWY3DPEHPK3PXP",
        totp_enabled=True,
    )
    auth = OwnerAuth(cfg)
    # Patch the AUTH MODULE, not gigpilot's namespace. `owner_authenticated` and `require_owner` both
    # resolve `get_owner_auth()` inside gpkg.api.auth, so patching `gigpilot.get_owner_auth` would
    # silently have no effect and the owner tier would never be reachable in the test.
    import gpkg.api.auth as auth_mod
    monkeypatch.setattr(auth_mod, "get_owner_auth", lambda: auth)
    return auth.mint()


# =============================================================================================
# The deployment gate must keep working
# =============================================================================================
@pytest.mark.parametrize("path", ["/health", "/api/health", "/api/trading/gigpilot/health"])
def test_gate_fields_are_present_without_auth(client, path):
    """If these disappear, every deploy fails its attestation step."""
    r = client.get(path)
    assert r.status_code in (200, 503), r.status_code
    body = r.json()
    for field in GATE_REQUIRED:
        assert field in body, f"{field} missing from the anonymous payload on {path}"
    assert body["autonomousEngine"].get("reachable") is True, (
        "the gate asserts on autonomousEngine.reachable"
    )


def test_health_still_answers_for_anonymous_monitoring(client):
    assert client.get("/api/health").status_code in (200, 503)


# =============================================================================================
# The disclosure fix
# =============================================================================================
def test_anonymous_caller_gets_no_sensitive_fields(client):
    body = client.get("/api/health").json()
    leaked = [f for f in SENSITIVE if f in body]
    assert not leaked, f"anonymous response still exposes: {leaked}"


def test_anonymous_caller_cannot_read_the_arming_state(client):
    """`armed` discloses whether live trading is happening right now."""
    body = client.get("/api/health").json()
    assert "armed" not in body
    assert "armed" not in body.get("autonomousEngine", {})


def test_anonymous_caller_cannot_read_the_exchange_host(client):
    body = client.get("/api/health").json()
    assert "api-demo-secret-host" not in str(body), "the venue host leaked to anonymous callers"


def test_anonymous_caller_cannot_read_credential_failure_text(client):
    """The verbatim reason a key was rejected is the most sensitive part of the old payload."""
    raw = client.get("/api/health").text
    for marker in SECRET_MARKERS:
        assert marker not in raw, f"internal failure text leaked: {marker}"


def test_owner_caller_gets_the_full_picture(client, owner_token):
    r = client.get("/api/health", headers={"Authorization": f"Bearer {owner_token}"})
    body = r.json()
    assert body["authenticated"] is True
    for field in SENSITIVE:
        assert field in body, f"owner payload is missing {field}"
    assert body["host"] == _Cfg.host
    assert body["armed"] is True
    assert body["trading_blockers"] is not None
    assert body["autonomousEngine"]["armed"] is True


def test_invalid_token_is_treated_as_anonymous(client):
    """A bad token must degrade to the public tier, never 500 and never grant the owner tier."""
    r = client.get("/api/health", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code in (200, 503)
    body = r.json()
    assert body["authenticated"] is False
    assert "host" not in body
    assert not any(f in body for f in SENSITIVE)


def test_token_via_query_param_works_for_sse_style_clients(client, owner_token):
    r = client.get(f"/api/health?token={owner_token}")
    assert r.json()["authenticated"] is True


def test_owner_tier_is_opt_in_and_public_tier_is_the_default(client):
    """Guards against a future refactor inverting the default."""
    anon = client.get("/api/health").json()
    assert anon["authenticated"] is False
    assert "host" not in anon


# =============================================================================================
# Cross-origin owner portal policy
# =============================================================================================
def test_owner_portal_cors_is_exactly_allowlisted(client):
    """The production SPA is on a known Amplify origin, so the API must allow that exact origin.
    Arbitrary origins remain blocked; in particular, there is never a wildcard CORS response.
    """
    production_origin = "https://main.d2qe2q720fbn3x.amplifyapp.com"
    allowed = client.options(
        "/api/auth/login",
        headers={
            "Origin": production_origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert allowed.status_code in (200, 204), allowed.text
    assert allowed.headers.get("access-control-allow-origin") == production_origin
    assert allowed.headers.get("access-control-allow-credentials") == "true"

    blocked = client.options(
        "/api/auth/login",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert blocked.headers.get("access-control-allow-origin") != "*"
    assert blocked.headers.get("access-control-allow-origin") != "https://evil.example.com"


# =============================================================================================
# Runtime dependency hygiene
# =============================================================================================
def test_test_framework_is_not_a_runtime_dependency():
    """`pytest` in requirements.txt ships a test framework to the host holding live exchange keys."""
    runtime = (ROOT / "requirements.txt").read_text()
    body = "\n".join(l for l in runtime.splitlines() if l.strip() and not l.strip().startswith("#"))
    for banned in ("pytest", "pytest-asyncio"):
        assert banned not in body, f"{banned} is declared in runtime requirements.txt"
    dev = (ROOT / "requirements-dev.txt").read_text()
    assert "pytest" in dev, "pytest must live in requirements-dev.txt or the gates cannot run"


def test_testclient_users_have_httpx_declared():
    """Anything importing `fastapi.testclient` needs httpx, which must be DECLARED.

    This is not hypothetical — it broke CI on the commit that removed the unused `google-genai`
    package. httpx had only ever been present as a transitive dependency of google-genai, so the
    gates imported fine by accident until that package went away. An undeclared dependency that
    happens to be satisfied is a build that works for reasons nobody knows.
    """
    import re

    users = []
    for f in (ROOT / "tests").rglob("*.py"):
        if "__pycache__" in str(f):
            continue
        if "fastapi.testclient" in f.read_text(errors="ignore"):
            users.append(f.name)
    assert users, "expected at least one TestClient-based gate; the detection logic may be stale"

    dev = (ROOT / "requirements-dev.txt").read_text()
    assert re.search(r"^\s*httpx", dev, re.M), (
        f"{len(users)} gate(s) use fastapi.testclient but httpx is not declared in "
        f"requirements-dev.txt: {sorted(users)}"
    )


def test_every_workflow_that_runs_the_gates_installs_dev_requirements():
    """EVERY workflow that runs the TestClient gates must install requirements-dev.txt.

    Checked across all workflows rather than just ci.yml, because scoping the first version of this
    test to ci.yml is exactly how the deploy workflow kept failing: both workflows had identical
    install steps, only one was fixed, and the fix looked complete until the deploy job ran.
    """
    import re

    offline = []
    for wf in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
        text = wf.read_text(errors="ignore")
        # Only workflows that actually run a TestClient-based gate need the test-only packages.
        if "test_dashboard_delivery" not in text and "pytest tests/" not in text:
            continue
        if not re.search(r"pip install[^\n]*requirements\.txt", text):
            continue
        if "requirements-dev.txt" not in text:
            offline.append(wf.name)
    assert not offline, (
        f"workflow(s) run TestClient/pytest gates but install only runtime requirements, so the "
        f"gates will fail to import httpx: {offline}"
    )


def test_no_declared_runtime_dependency_is_unused():
    """Every runtime dependency must be imported somewhere. An unused one is pure install-time and
    CVE surface in the credential-holding process."""
    import re

    runtime = (ROOT / "requirements.txt").read_text()
    deps = []
    for line in runtime.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name = re.split(r"[<>=!\[]", line)[0].strip()
        if name:
            deps.append(name)
    assert deps, "no dependencies parsed"

    search_roots = ["gpkg", "gigpilot.py", "tests", "scripts"]
    sources = []
    for root in search_roots:
        p = ROOT / root
        if p.is_file():
            sources.append(p.read_text(errors="ignore"))
        elif p.is_dir():
            for f in p.rglob("*.py"):
                if "__pycache__" in str(f):
                    continue
                sources.append(f.read_text(errors="ignore"))
    blob = "\n".join(sources)

    import_map = {"uvicorn": "uvicorn", "python-dotenv": "dotenv", "cryptography": "cryptography"}
    unused = []
    for dep in deps:
        mod = import_map.get(dep, dep.replace("-", "_"))
        if not re.search(rf"^\s*(import|from)\s+{re.escape(mod)}\b", blob, re.M):
            unused.append(dep)
    assert not unused, f"declared but never imported: {unused}"
