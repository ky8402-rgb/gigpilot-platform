#!/usr/bin/env python3
"""Extract the COMPLETE Node/TypeScript surface into a machine-readable manifest.

Purpose: migrating a live trading platform from Node to Python is only safe if the surface is
ENUMERATED rather than remembered. This turns "we think we covered everything" into a list that
`tests/test_parity.py` can enforce — every entry must either have a Python replacement or an
explicit, justified waiver. Deletion is gated on that file being complete.

Emits migration/node_surface.json. Read-only: it never modifies the tree.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "migration" / "node_surface.json"

# ------------------------------------------------------------------ HTTP surface


def _routes(text: str, pattern: str) -> list[str]:
    found = []
    for m in re.finditer(pattern, text, re.MULTILINE):
        path = m.group(2)
        # `.all([...])` registers a list of paths.
        paths = re.findall(r"['\"]([^'\"]+)['\"]", path) if path.startswith("[") else [path]
        for p in paths:
            found.append(f"{m.group(1).upper()} {p}")
    return found


def http_surface() -> dict:
    endpoints: list[dict] = []

    routes = (ROOT / "server" / "trading" / "routes.ts").read_text(encoding="utf8")
    for e in _routes(routes, r"^tradingRouter\.(get|post|put|delete)\(\s*['\"]([^'\"]+)['\"]"):
        endpoints.append({"method": e.split()[0], "path": e.split()[1], "mount": "/api/trading", "source": "server/trading/routes.ts"})
    for m in re.finditer(r"tradingRouter\.all\(\s*\[([^\]]+)\]", routes, re.MULTILINE):
        for p in re.findall(r"['\"]([^'\"]+)['\"]", m.group(1)):
            endpoints.append({"method": "ANY", "path": p, "mount": "/api/trading", "source": "server/trading/routes.ts (.all)"})

    server = (ROOT / "server.ts").read_text(encoding="utf8")
    for e in _routes(server, r"^app\.(get|post|put|delete)\(\s*[\"']([^\"']+)[\"']"):
        endpoints.append({"method": e.split()[0], "path": e.split()[1], "mount": "", "source": "server.ts"})

    gh = (ROOT / "server" / "githubRoutes.ts").read_text(encoding="utf8")
    for e in _routes(gh, r"githubRoutes\.(get|post|put|delete)\(\s*['\"]([^'\"]+)['\"]"):
        endpoints.append({"method": e.split()[0], "path": e.split()[1], "mount": "/api/github", "source": "server/githubRoutes.ts"})
    for m in re.finditer(r"githubRoutes\.all\(\s*\[([^\]]+)\]", gh, re.MULTILINE):
        for p in re.findall(r"['\"]([^'\"]+)['\"]", m.group(1)):
            endpoints.append({"method": "ANY", "path": p, "mount": "/api/github", "source": "server/githubRoutes.ts (.all)"})

    seen, unique = set(), []
    for e in endpoints:
        key = (e["method"], e["mount"] + e["path"])
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return {"count": len(unique), "endpoints": sorted(unique, key=lambda e: (e["mount"], e["path"], e["method"]))}


# ------------------------------------------------------------------ modules / processes


def trading_modules() -> dict:
    mods = []
    for f in sorted((ROOT / "server" / "trading").glob("*.ts")):
        text = f.read_text(encoding="utf8")
        mods.append({
            "name": f.stem,
            "path": str(f.relative_to(ROOT)),
            "lines": text.count("\n") + 1,
            "exports": sorted(set(re.findall(r"export (?:async )?(?:function|class|const|interface|type)\s+(\w+)", text)))[:12],
        })
    other = []
    for rel in ("server.ts", "server/worker.ts", "server/githubRoutes.ts", "server/githubService.ts", "server/activityLogger.ts", "server/corsConfig.ts"):
        p = ROOT / rel
        if p.exists():
            other.append({"name": p.stem, "path": rel, "lines": p.read_text(encoding="utf8").count("\n") + 1})
    return {"trading_modules": mods, "other_modules": other}


def pm2_apps() -> dict:
    eco = (ROOT / "ecosystem.config.cjs").read_text(encoding="utf8")
    apps = []
    for m in re.finditer(r"name:\s*'([^']+)',\s*\n\s*script:\s*'([^']+)'", eco):
        apps.append({"name": m.group(1), "script": m.group(2), "runtime": "python" if m.group(2).endswith(".py") else "node"})
    return {"apps": apps}


def node_deps() -> dict:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf8"))
    deps = pkg.get("dependencies", {})
    unresolvable = []          # declared but imported nowhere
    imported_counts = {}
    sources = [p for p in ROOT.rglob("*") if p.suffix in {".ts", ".tsx", ".mjs", ".cjs"} and "node_modules" not in p.parts]
    for name in deps:
        hits = 0
        for s in sources:
            try:
                if name in s.read_text(encoding="utf8"):
                    hits += 1
            except (UnicodeDecodeError, OSError):
                continue
        imported_counts[name] = hits
        if hits == 0:
            unresolvable.append(name)
    return {
        "prod_count": len(deps),
        "declared_but_unimported": sorted(unresolvable),
        "imported_counts": imported_counts,
    }


def frontend() -> dict:
    comps = sorted(p.name for p in (ROOT / "src").rglob("*.tsx"))
    lines = sum(p.read_text(encoding="utf8").count("\n") + 1 for p in (ROOT / "src").rglob("*.ts*"))
    return {"component_count": len(comps), "total_lines": lines, "components": comps}


def scripts_surface() -> dict:
    out = []
    for p in sorted((ROOT / "scripts").iterdir()):
        if p.is_file():
            out.append({"name": p.name, "lines": p.read_text(encoding="utf8", errors="ignore").count("\n") + 1})
    return {"count": len(out), "scripts": out}


def write_parity_map(manifest: dict) -> dict:
    """Seed/refresh migration/parity_map.json, PRESERVING decisions already recorded.

    New Node entries appear as `planned`, which makes tests/test_parity.py fail until they are
    consciously decided. That is the point: a newly added Node endpoint must not be able to slip
    past the migration unnoticed, and nothing may be marked `removed` without proof.
    """
    map_path = ROOT / "migration" / "parity_map.json"
    existing: dict = {}
    if map_path.exists():
        existing = json.loads(map_path.read_text(encoding="utf8"))

    def entry_key(e: dict) -> str:
        return f"{e['method']} {e['mount']}{e['path']}"

    def ensure(bucket: str, keys: list[str]) -> dict:
        current = existing.setdefault(bucket, {})
        for k in keys:
            current.setdefault(k, {"status": "planned", "python": None, "reason": None})
        # Flag entries that disappeared from the Node surface (informational only).
        for k in list(current):
            if k not in keys:
                current[k]["status"] = current[k].get("status", "planned")
                current[k]["_no_longer_present_in_source"] = True
        return current

    ensure("http_endpoints", [entry_key(e) for e in manifest["http"]["endpoints"]])
    # Keyed by PATH, matching the manifest's `path` field and the parity gate's lookup. Keying
    # modules by bare stem here made the gate report all 37 as undecided — the gate was right and
    # this extractor was wrong, which is precisely the class of mismatch it exists to catch.
    ensure("trading_modules", [m["path"] for m in manifest["modules"]["trading_modules"]])
    ensure("other_modules", [m["path"] for m in manifest["modules"]["other_modules"]])
    ensure("processes", [a["name"] for a in manifest["processes"]["apps"]])
    ensure("dependencies", list(manifest["node_dependencies"]["imported_counts"]))
    existing["frontend"] = existing.get("frontend", {
        "status": "planned", "python": None,
        "reason": "React SPA (30 components). Decision required: serve a prebuilt bundle from Python "
                  "(keeps a Node BUILD step) or rebuild the UI with Python-rendered templates.",
    })
    existing["_status_legend"] = {
        "planned": "not yet implemented in Python",
        "in_progress": "Python implementation started, not verified",
        "migrated": "Python replacement exists and is verified present by tests/test_parity.py",
        "waived": "deliberately NOT migrated; reason REQUIRED",
        "removed": "deleted from the tree; requires replacement_proven=true",
    }
    map_path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n", encoding="utf8")
    return existing


def main() -> int:
    manifest = {
        "generated_by": "migration/extract_node_surface.py",
        "note": "Read-only enumeration of the Node surface. tests/test_parity.py enforces that every entry is mapped or waived before any deletion.",
        "http": http_surface(),
        "modules": trading_modules(),
        "processes": pm2_apps(),
        "node_dependencies": node_deps(),
        "frontend": frontend(),
        "scripts": scripts_surface(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")

    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  HTTP endpoints        : {manifest['http']['count']}")
    print(f"  trading modules       : {len(manifest['modules']['trading_modules'])}")
    print(f"  other server modules  : {len(manifest['modules']['other_modules'])}")
    print(f"  pm2 apps              : {len(manifest['processes']['apps'])} "
          f"({sum(1 for a in manifest['processes']['apps'] if a['runtime'] == 'node')} node)")
    print(f"  node prod deps        : {manifest['node_dependencies']['prod_count']} "
          f"({len(manifest['node_dependencies']['declared_but_unimported'])} imported nowhere)")
    print(f"  react components      : {manifest['frontend']['component_count']}")
    print(f"  scripts               : {manifest['scripts']['count']}")

    pmap = write_parity_map(manifest)
    counts: dict[str, int] = {}
    for bucket, entries in pmap.items():
        if bucket.startswith("_") or bucket == "frontend" or not isinstance(entries, dict):
            continue
        for v in entries.values():
            status = v.get("status", "planned") if isinstance(v, dict) else "planned"
            counts[status] = counts.get(status, 0) + 1
    print(f"wrote migration/parity_map.json  {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
