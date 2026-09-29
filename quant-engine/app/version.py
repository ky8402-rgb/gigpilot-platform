"""Build/release provenance.

Answers the only question that matters after a deploy: *which code is actually
running right now?* The answer must be machine-checkable, not a human assertion.

`ops/build.sh` writes `build/release.json` containing the exact commit SHA, the
build time, dependency versions and the test summary. This module reads it back.
If the file is absent (developer checkout) we report "development" rather than
inventing a SHA — an unverifiable version string is worse than an honest one.
"""
from __future__ import annotations

import json
import os
import platform
import sys
from pathlib import Path
from typing import Any, Dict, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RELEASE_JSON = PROJECT_ROOT / "build" / "release.json"

_cache: Optional[Dict[str, Any]] = None


def release_path() -> Path:
    override = os.environ.get("QUANT_RELEASE_JSON", "").strip()
    return Path(override) if override else DEFAULT_RELEASE_JSON


def load_release(force: bool = False) -> Dict[str, Any]:
    global _cache
    if _cache is not None and not force:
        return _cache

    path = release_path()
    info: Dict[str, Any] = {
        "version": "0.0.0-dev",
        "commit_sha": None,
        "commit_short": None,
        "branch": None,
        "dirty": None,
        "built_at": None,
        "built_by": None,
        "verified": False,
        "tests": {},
        "source": "development",
        "python": sys.version.split()[0],
        "platform": f"{platform.system()} {platform.release()}",
    }
    try:
        if path.exists():
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                info.update(loaded)
                info["source"] = str(path)
    except (OSError, json.JSONDecodeError):
        info["release_json_error"] = f"could not read {path}"
    _cache = info
    return info


def commit_sha() -> Optional[str]:
    return load_release().get("commit_sha")


def as_dict() -> Dict[str, Any]:
    d = dict(load_release())
    # Never surface anything credential-shaped from build metadata.
    d.pop("env", None)
    return d
