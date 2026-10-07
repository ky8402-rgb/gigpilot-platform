#!/usr/bin/env python3
"""NODE -> PYTHON PARITY GATE.

Migrating a live trading platform is only safe if the surface is ENUMERATED and every claim of
"already migrated" is VERIFIED rather than trusted. This test is the gate that makes removal safe:

  1. STRUCTURAL COMPLETENESS — every entry in the extracted Node surface has an explicit decision.
     A newly added Node endpoint therefore cannot slip past the migration unnoticed.
  2. HONESTY — an entry marked `migrated` must point at a Python target that ACTUALLY EXISTS in
     the Python sources. The claim is checked against the code, not taken on faith.
  3. DELETION SAFETY — an entry may only be marked `removed` when its replacement is proven
     (`replacement_proven: true`) AND that replacement verifies under rule 2. Together these
     implement the instruction "do not delete anything until its replacement is proven".
  4. WAIVERS — anything deliberately not migrated must carry a reason, so a gap is a decision
     rather than an oversight.

Run: python3 tests/test_parity.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "migration" / "node_surface.json"
PARITY = ROOT / "migration" / "parity_map.json"

VALID_STATUSES = {"planned", "in_progress", "migrated", "waived", "removed"}
DELETE_REQUIRES_PROOF = True

failures: list[str] = []
checks = 0


def ok(msg: str) -> None:
    global checks
    checks += 1
    print(f"  \u2714 {msg}")


def bad(msg: str) -> None:
    failures.append(msg)
    print(f"  \u2717 {msg}")


# ---------------------------------------------------------------- Python surface facts


def python_routes() -> set[tuple[str, str]]:
    """Every FastAPI route registered in the Python sources."""
    found: set[tuple[str, str]] = set()
    for path in ROOT.rglob("*.py"):
        if any(part in {"node_modules", ".runtime-test", "migration", "tests"} for part in path.parts):
            continue
        text = path.read_text(encoding="utf8", errors="ignore")
        for m in re.finditer(r"@(?:\w+)\.(get|post|put|delete|patch)\(\s*[\"']([^\"']+)[\"']", text):
            found.add((m.group(1).upper(), m.group(2)))
    return found


def python_files() -> set[str]:
    return {
        str(p.relative_to(ROOT))
        for p in ROOT.rglob("*.py")
        if not any(part in {"node_modules", ".runtime-test"} for part in p.parts)
    }


def python_modules() -> set[str]:
    return {p.stem for p in ROOT.rglob("*.py")}


def python_requirements() -> set[str]:
    req = ROOT / "requirements.txt"
    if not req.exists():
        return set()
    out = set()
    for line in req.read_text(encoding="utf8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.add(re.split(r"[<>=!\[;]", line)[0].strip().lower())
    return out


ROUTES = python_routes()
FILES = python_files()
MODULES = python_modules()
REQS = python_requirements()


def verify_target(kind: str, target: str | None) -> tuple[bool, str]:
    """Rule 2: does the claimed Python replacement actually exist?"""
    if not target:
        return False, "no python target declared"
    if kind == "endpoint":
        try:
            method, path = target.split(" ", 1)
        except ValueError:
            return False, f"python target '{target}' is not 'METHOD /path'"
        if (method.upper(), path) not in ROUTES:
            return False, f"route {method.upper()} {path} is NOT registered in any Python source"
        return True, f"route {method.upper()} {path} verified present"
    if kind in {"module", "process"}:
        if target in FILES or Path(target).stem in MODULES:
            return True, f"{target} exists"
        return False, f"{target} does not exist"
    if kind == "dependency":
        if target.lower() in REQS:
            return True, f"{target} declared in requirements.txt"
        return False, f"{target} is not in requirements.txt"
    return False, f"unknown kind {kind}"


def main() -> int:
    print("Node -> Python Parity Gate")
    print("==========================")

    if not MANIFEST.exists() or not PARITY.exists():
        print("FAIL: run `python3 migration/extract_node_surface.py` first")
        return 1

    manifest = json.loads(MANIFEST.read_text(encoding="utf8"))
    parity = json.loads(PARITY.read_text(encoding="utf8"))

    # ------------------------------------------------ rule 1: structural completeness
    print("\n[1] Every Node surface entry has an explicit decision")

    buckets: list[tuple[str, str, list[str]]] = []

    buckets.append(("http_endpoints", "endpoint",
                    [f"{e['method']} {e['mount']}{e['path']}" for e in manifest["http"]["endpoints"]]))
    buckets.append(("trading_modules", "module",
                    [m["path"] for m in manifest["modules"]["trading_modules"]]))
    buckets.append(("other_modules", "module",
                    [m["path"] for m in manifest["modules"]["other_modules"]]))
    buckets.append(("processes", "process",
                    [a["name"] for a in manifest["processes"]["apps"]]))
    buckets.append(("dependencies", "dependency",
                    list(manifest["node_dependencies"]["imported_counts"])))

    total = 0
    decided: dict[str, int] = {}
    for bucket, kind, keys in buckets:
        entries = parity.get(bucket, {})
        missing = [k for k in keys if k not in entries]
        total += len(keys)
        if missing:
            bad(f"{bucket}: {len(missing)} entries have NO decision, e.g. {missing[:3]}")
        else:
            ok(f"{bucket}: all {len(keys)} entries have a decision")
        for k in keys:
            v = entries.get(k)
            if isinstance(v, dict):
                decided[v.get("status", "planned")] = decided.get(v.get("status", "planned"), 0) + 1

    # ------------------------------------------------ rules 2-4: honesty + deletion safety
    print("\n[2] 'migrated' claims are verified against the Python sources")
    migrated_verified = 0
    for bucket, kind, keys in buckets:
        for k in keys:
            v = parity.get(bucket, {}).get(k)
            if not isinstance(v, dict):
                continue
            status = v.get("status", "planned")
            if status not in VALID_STATUSES:
                bad(f"{k}: unknown status '{status}'")
                continue

            if status in {"migrated", "removed"}:
                good, why = verify_target(kind, v.get("python"))
                if good:
                    migrated_verified += 1
                else:
                    bad(f"{k}: marked '{status}' but {why}")

            if status == "waived" and not v.get("reason"):
                bad(f"{k}: waived without a reason")

            if status == "removed" and DELETE_REQUIRES_PROOF and not v.get("replacement_proven"):
                bad(f"{k}: marked 'removed' but replacement_proven is not true — deletion is not permitted")

    if migrated_verified:
        ok(f"{migrated_verified} entry/entries verified as genuinely migrated")
    else:
        print("  \u2139 nothing is marked migrated yet (expected before the rebuild starts)")

    # ------------------------------------------------ rule 5: frontend is a deliberate decision
    print("\n[3] Frontend is an explicit decision, not an accident")
    fe = parity.get("frontend", {})
    if isinstance(fe, dict) and fe.get("status") in VALID_STATUSES:
        ok(f"frontend status: {fe.get('status')} (reason recorded)")
    else:
        bad("frontend has no valid status — the dashboard decision must be explicit")

    # ------------------------------------------------ summary
    print("\nMigration progress (of the Node surface)")
    order = ["migrated", "in_progress", "planned", "waived", "removed"]
    for s in order:
        if s in decided:
            print(f"  {s:<12} {decided[s]}")
    print(f"  {'TOTAL':<12} {total}")

    print(f"\nResult: {checks} passed, {len(failures)} failed")
    if failures:
        print("PARITY GATE FAILED — the Node surface is not yet safely replaceable.")
        return 1
    print("PARITY GATE PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
