#!/usr/bin/env python3
"""Final production-runtime contract for the Python-only migration.

The migration is COMPLETE: the dashboard is rendered by Python, so there is no Node/TypeScript
surface left anywhere in the repository — not in the backend, and not in the frontend build
toolchain either. This gate asserts the finished state rather than the in-flight one, which is why
there is no longer an allow-list of permitted frontend JavaScript.

It also asserts the POSITIVE half, which matters more than the negative one: the console is only
"Python-only" in a useful sense if Python actually renders it. A repository with no JavaScript and no
dashboard would satisfy a purely negative check.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Directories that are not repository source: dependency caches, virtualenvs, build outputs and the
#: recorded migration manifests.
EXCLUDED_DIRS = {"node_modules", ".runtime-test", ".venv", "dist", "build", "migration", ".git"}

NODE_SUFFIXES = {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"}

#: Build/deploy manifests that only exist to drive a Node toolchain.
FORBIDDEN_MANIFESTS = (
    "package.json",
    "package-lock.json",
    "bun.lock",
    "yarn.lock",
    "tsconfig.json",
    "vite.config.ts",
    "ecosystem.config.cjs",
    "server.ts",
    "server",
    "amplify.yml",
    "apprunner.yaml",
    "prisma",
)

#: Guards the deploy path must keep. These are NODE-ABSENCE assertions in the deploy itself: they
#: stop a release from reporting success while a Node process is still serving the old surface.
REQUIRED_DEPLOY_GUARDS = (
    "gigpilot.service",
    "python3 $APP_DIR/gigpilot.py",
    "pm2 delete gigpilot",
    "pm2 delete worker",
    "pgrep -x node",
    "FastAPI exact-SHA health verification passed",
)


def fail(msg: str) -> None:
    raise AssertionError(msg)


def node_sources() -> list[str]:
    found = []
    for p in ROOT.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in NODE_SUFFIXES:
            continue
        if any(part in EXCLUDED_DIRS for part in p.parts):
            continue
        found.append(str(p.relative_to(ROOT)))
    return sorted(found)


def main() -> None:
    # ---- negative: no Node/TypeScript source anywhere -------------------------------
    remaining = node_sources()
    if remaining:
        fail(f"Node/TypeScript sources remain in the repository: {remaining}")

    present_manifests = [name for name in FORBIDDEN_MANIFESTS if (ROOT / name).exists()]
    if present_manifests:
        fail(f"Node toolchain manifests still present: {present_manifests}")

    # ---- positive: Python actually renders the console ------------------------------
    required_python_console = (
        "gpkg/web/dashboard.py",
        "gpkg/web/views.py",
        "gpkg/web/templates/base.html",
        "gpkg/web/templates/dashboard.html",
        "gpkg/web/templates/login.html",
        "gpkg/web/static/dashboard.css",
    )
    missing = [name for name in required_python_console if not (ROOT / name).is_file()]
    if missing:
        fail(f"the Python console is incomplete; missing: {missing}")

    dashboard = (ROOT / "gpkg/web/templates/dashboard.html").read_text(encoding="utf8")
    for feature, marker in (("credential modal", "apiSecret"), ("L2 ingestion progress bar", "l2-bar"),
                            ("live capital telemetry", "capital telemetry")):
        if marker not in dashboard:
            fail(f"the Python console is missing the {feature} (no {marker!r} in dashboard.html)")

    requirements = (ROOT / "requirements.txt").read_text(encoding="utf8")
    if "jinja2" not in requirements.lower():
        fail("jinja2 is not declared, so the Python console cannot render in production")

    # ---- deploy must still prove Node is absent at runtime --------------------------
    deploy_path = ROOT / "scripts" / "deploy-ec2.sh"
    if not deploy_path.is_file():
        fail("scripts/deploy-ec2.sh is missing")
    deploy = deploy_path.read_text(encoding="utf8")
    for marker in REQUIRED_DEPLOY_GUARDS:
        if marker not in deploy:
            fail(f"deployment contract missing required guard: {marker}")

    print("Python-only production runtime contract: PASS")
    print("  No Node or TypeScript source remains in the repository.")
    print("  The console is rendered by gpkg/web (Jinja2 templates, no build step).")
    print("  Deployment requires FastAPI exact-SHA health and Node-process absence.")


if __name__ == "__main__":
    main()
