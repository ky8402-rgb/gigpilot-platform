#!/usr/bin/env python3
"""Final production-runtime contract for the Python-only migration.

The React source/build toolchain may remain JavaScript/TypeScript, but the production
server, workers, trading engine, risk, execution, persistence, reconciliation,
monitoring and automation must not depend on a Node runtime or Node backend source.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ALLOWED_FRONTEND_NODE_FILES = {
    "vite.config.ts",
    "public/sw.js",
}

BACKEND_MARKERS = (
    "server",
    "worker",
    "backend",
    "api",
    "trading",
    "routes",
    "execution",
    "risk",
)

def fail(msg: str) -> None:
    raise AssertionError(msg)

def main() -> None:
    node_sources = {
        str(p.relative_to(ROOT))
        for p in ROOT.rglob("*")
        if p.is_file()
        and p.suffix.lower() in {".js", ".mjs", ".cjs", ".ts", ".tsx"}
        and "node_modules" not in p.parts
        and ".runtime-test" not in p.parts
        and ".venv" not in p.parts
        and "tests" not in p.parts
        and "migration" not in p.parts
        and "src" not in p.parts
        and "dist" not in p.parts
        and str(p.relative_to(ROOT)) not in ALLOWED_FRONTEND_NODE_FILES
    }

    backend_node = sorted(node_sources)
    if backend_node:
        fail(f"production/backend Node sources remain: {backend_node}")

    ecosystem = ROOT / "ecosystem.config.cjs"
    if ecosystem.exists():
        fail("legacy PM2 ecosystem configuration still exists")

    if (ROOT / "server.ts").exists() or (ROOT / "server").exists():
        fail("legacy Node server surface still exists")

    package = ROOT / "package.json"
    if package.exists():
        data = json.loads(package.read_text())
        scripts = data.get("scripts", {})
        if "start" not in scripts or "python" not in scripts["start"]:
            fail("package start command is not explicitly Python")

    deploy = (ROOT / "scripts" / "deploy-ec2.sh").read_text(encoding="utf8")
    required = [
        "gigpilot.service",
        "python3 $APP_DIR/gigpilot.py",
        "pm2 delete gigpilot",
        "pm2 delete worker",
        "pgrep -x node",
        "FastAPI exact-SHA health verification passed",
    ]
    for marker in required:
        if marker not in deploy:
            fail(f"deployment contract missing required guard: {marker}")

    print("Python-only production runtime contract: PASS")
    print("  React JS/TS is retained only as the existing frontend/build surface.")
    print("  No Node backend/runtime surface is present in the repository.")
    print("  Deployment requires FastAPI exact-SHA health and Node-process absence.")

if __name__ == "__main__":
    main()
