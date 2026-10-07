#!/usr/bin/env python3
"""MUTATION VERIFICATION — proof that the test suite is NON-VACUOUS.

A green test suite proves nothing on its own. A suite that cannot fail is indistinguishable from a
suite that passes, and the difference is exactly what matters on a system that places live orders.
This harness therefore SEEDS KNOWN REGRESSIONS into a throwaway copy of the tree and asserts that the
matching test actually goes red. A seeded regression that is NOT caught is reported as VACUOUS.

Why this file exists as a committed artifact: the first version of this check was an ad-hoc script
run in a single session, so the resulting claim ("11 seeded regressions, 11 detected") was written
into RUN_LOG.md without any reproducible harness behind it. An independent verifier correctly
refused to accept it. A number nobody else can reproduce is not evidence.

Usage:
    python3 scripts/mutation-verify.py            # run every mutation
    python3 scripts/mutation-verify.py --list     # list mutation ids only

Exit code 0 = every mutation detected; 1 = at least one vacuous or unapplied.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Directories copied into the sandbox. node_modules/.venv are excluded: the mutations under test are
# all in Python or in the source text scanned by the structural checks.
COPY = ["gigpilot.py", "pytest.ini", "requirements.txt", "package.json", "package-lock.json"]
COPY_DIRS = ["gpkg", "tests", "migration", "server", "src"]


def _interpreter() -> str:
    for cand in (ROOT / ".venv" / "bin" / "python", ROOT / ".venv" / "bin" / "python3"):
        if cand.exists():
            return str(cand)
    return sys.executable


class Mutation:
    def __init__(self, ident: str, description: str, target: str, old: str, new: str, tests: list[str]):
        self.ident = ident
        self.description = description
        self.target = target
        self.old = old
        self.new = new
        self.tests = tests


MUTATIONS: list[Mutation] = [
    Mutation(
        "arm-gate-owner",
        "arm gate defined back on BybitWS, where its state does not exist",
        "gigpilot.py",
        "class BybitWS:",
        "class BybitWS:\n    async def arm(self): return True, []\n"
        "    async def arm_preflight(self): return True, []\n"
        "    async def _arm_gate_check(self): return True, []",
        ["tests/test_arm_gate.py::test_gate_methods_live_on_the_engine"],
    ),
    Mutation(
        "authz-port",
        "owner auth removed from POST /api/kill",
        "gigpilot.py",
        '@app.post("/api/kill", dependencies=[Depends(require_owner)])',
        '@app.post("/api/kill")',
        ["tests/test_control_plane_auth.py"],
    ),
    Mutation(
        "authz-state",
        "owner auth removed from GET /api/state",
        "gigpilot.py",
        '@app.get("/api/state", dependencies=[Depends(require_owner)])',
        '@app.get("/api/state")',
        ["tests/test_control_plane_auth.py"],
    ),
    Mutation(
        "authz-metrics",
        "owner auth removed from GET /metrics",
        "gigpilot.py",
        '@app.get("/metrics", dependencies=[Depends(require_owner)])',
        '@app.get("/metrics")',
        ["tests/test_control_plane_auth.py"],
    ),
    Mutation(
        "authz-events",
        "owner auth removed from GET /events",
        "gigpilot.py",
        '@app.get("/events", dependencies=[Depends(require_owner)])',
        '@app.get("/events")',
        ["tests/test_control_plane_auth.py"],
    ),
    Mutation(
        "kill-persist",
        "kill switch no longer persisted (restart can silently re-arm)",
        "gigpilot.py",
        "    def kill(self) -> None:\n        self.armed = False\n        self._persist_arm_state(self.ARM_KILLED)",
        "    def kill(self) -> None:\n        self.armed = False",
        ["tests/test_kill_switch_persistence.py"],
    ),
    Mutation(
        "disarm-persist",
        "disarm no longer persisted",
        "gigpilot.py",
        "    def disarm(self, reason: str) -> None:\n        self.armed = False\n        self._persist_arm_state(self.ARM_DISARMED)",
        "    def disarm(self, reason: str) -> None:\n        self.armed = False",
        ["tests/test_kill_switch_persistence.py"],
    ),
    Mutation(
        "boot-honours-kill",
        "boot ignores a persisted kill state",
        "gigpilot.py",
        '        if state == self.ARM_KILLED:\n            return False, "persisted_kill_switch"\n',
        "",
        ["tests/test_kill_switch_persistence.py"],
    ),
    Mutation(
        "auto-disarm-persist",
        "daily-loss auto-disarm no longer persisted",
        "gigpilot.py",
        "                self.armed = False\n                self._persist_arm_state(self.ARM_DISARMED)\n                self.store.journal(\"AUTO_DISARM\"",
        "                self.armed = False\n                self.store.journal(\"AUTO_DISARM\"",
        ["tests/test_kill_switch_persistence.py"],
    ),
    Mutation(
        "trade-authz",
        "arm gate stops checking trade AUTHORIZATION",
        "gigpilot.py",
        "        if self.reconciler.healthy and not self.reconciler.trade_permissions_ok:",
        "        if False:",
        ["tests/test_arm_gate.py"],
    ),
    Mutation(
        "min-order-qty",
        "minOrderQty entry check removed",
        "gpkg/execution/executor.py",
        '        if mn > 0 and float(qty_s) < mn:\n            return False, f"qty_{qty_s}_below_min_{mn}"\n',
        "",
        ["tests/test_entry_sizing.py"],
    ),
    Mutation(
        "jwt-alg",
        "JWT algorithm check removed (algorithm confusion)",
        "gpkg/api/auth.py",
        '    if header.get("alg") != JWT_ALG:\n        raise TokenError(f"unsupported alg: {header.get(\'alg\')!r}")\n',
        "",
        ["tests/test_owner_auth.py"],
    ),
    Mutation(
        "jwt-signature",
        "JWT signature comparison removed (any token accepted)",
        "gpkg/api/auth.py",
        '    if not hmac.compare_digest(expected_sig, provided_sig):\n        raise TokenError("bad signature")\n',
        "",
        ["tests/test_owner_auth.py"],
    ),
    Mutation(
        "jwt-role",
        "JWT owner-role check removed",
        "gpkg/api/auth.py",
        '    if payload.get("role") != "owner":\n        raise TokenError("token is not an owner token")\n',
        "",
        ["tests/test_owner_auth.py"],
    ),
    Mutation(
        "jwt-expiry",
        "JWT expiry check removed",
        "gpkg/api/auth.py",
        '    if not isinstance(exp, (int, float)) or int(exp) < now:\n        raise TokenError("token expired")\n',
        "",
        ["tests/test_owner_auth.py"],
    ),
    Mutation(
        "cross-stack-precedence",
        "env secret stops overriding the file (Node and engine diverge)",
        "gpkg/api/auth.py",
        "            if env_secret:\n                cfg.jwt_secret = env_secret\n            elif not cfg.jwt_secret:",
        "            if not cfg.jwt_secret:\n                cfg.jwt_secret = env_secret or secrets.token_hex(32)\n            elif False:",
        ["tests/test_cross_stack_auth.py"],
    ),
    Mutation(
        "proxy-forwarding",
        "Node proxy stops forwarding the owner session to the engine",
        "server/trading/routes.ts",
        "...engineAuthHeaders(req)",
        "...{}",
        ["tests/test_cross_stack_auth.py::test_node_proxy_forwards_the_session_to_the_engine"],
    ),
    Mutation(
        "proxy-state-authz",
        "/gigpilot/state loses requireOwnerAuth",
        "server/trading/routes.ts",
        "tradingRouter.get('/gigpilot/state', requireOwnerAuth,",
        "tradingRouter.get('/gigpilot/state',",
        ["tests/test_cross_stack_auth.py::test_node_proxy_forwards_the_session_to_the_engine"],
    ),
    Mutation(
        "owner-token-key",
        "frontend API client stops reading the canonical owner-token key",
        "src/lib/api.ts",
        "    localStorage.getItem('gigpilot_owner_token') ||\n",
        "",
        ["tests/test_owner_auth.py"],  # placeholder, replaced by the node check below
    ),
]

# The frontend token-key invariant is asserted by a Node script, not pytest.
NODE_CHECKS: dict[str, tuple[str, list[str]]] = {
    "owner-token-key": ("node", ["scripts/test-owner-token-consistency.mjs"]),
}


def _sandbox() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="gp-mutation-"))
    for f in COPY:
        src = ROOT / f
        if src.is_file():
            shutil.copy(src, tmp / f)
    for d in COPY_DIRS:
        src = ROOT / d
        if src.is_dir():
            shutil.copytree(src, tmp / d,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return tmp


def run_one(mut: Mutation) -> tuple[bool, bool]:
    """Returns (mutation_applied, regression_detected)."""
    tmp = _sandbox()
    try:
        target = tmp / mut.target
        original = target.read_text(encoding="utf-8")
        if mut.old not in original:
            return False, False
        mutated = original.replace(mut.old, mut.new, 1)
        target.write_text(mutated, encoding="utf-8")

        if mut.ident in NODE_CHECKS:
            _, args = NODE_CHECKS[mut.ident]
            proc = subprocess.run(["node", *args], cwd=tmp, capture_output=True, text=True,
                                  check=False)  # a failing mutant is the expected outcome
        else:
            proc = subprocess.run(
                [_interpreter(), "-m", "pytest", *mut.tests, "-q", "--no-header"],
                check=False,  # a failing mutant is the expected outcome
                cwd=tmp, capture_output=True, text=True,
            )
        return True, proc.returncode != 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list mutation ids and exit")
    args = ap.parse_args()

    if args.list:
        for m in MUTATIONS:
            print(f"{m.ident:<26} {m.description}")
        return 0

    print("=" * 100)
    print("MUTATION VERIFICATION — does the suite actually detect each seeded regression?")
    print("=" * 100)
    print(f"{'id':<26} {'applied':<9} {'detected':<10} verdict")
    print("-" * 100)

    # Run in parallel: each mutation is an isolated sandbox + subprocess, so this is embarrassingly
    # parallel and serial execution exceeds the practical time budget for a pre-deploy check.
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(6, (os.cpu_count() or 2))) as pool:
        outcomes = list(pool.map(run_one, MUTATIONS))

    vacuous: list[str] = []
    unapplied: list[str] = []
    for mut, (applied, detected) in zip(MUTATIONS, outcomes):
        if not applied:
            verdict = "NOT APPLIED (source drifted — fix this harness)"
            unapplied.append(mut.ident)
        elif detected:
            verdict = "GOOD"
        else:
            verdict = "VACUOUS (regression NOT caught)"
            vacuous.append(mut.ident)
        print(f"{mut.ident:<26} {applied!s:<9} {detected!s:<10} {verdict}")

    print("-" * 100)
    caught = len(MUTATIONS) - len(vacuous) - len(unapplied)
    print(f"seeded: {len(MUTATIONS)}  caught: {caught}  vacuous: {len(vacuous)}  unapplied: {len(unapplied)}")
    if vacuous or unapplied:
        if vacuous:
            print("VACUOUS MUTATIONS: " + ", ".join(vacuous))
        if unapplied:
            print("HARNESS DRIFT: " + ", ".join(unapplied))
        return 1
    print("RESULT: non-vacuous — every seeded regression is caught by the committed suite.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
