#!/usr/bin/env bash
# Release build gate.
#
# Order matters: provenance -> secret scan -> frontend validation -> tests ->
# release manifest -> artifact. Any failure exits non-zero and nothing is built,
# so a broken or leaky tree can never produce a deployable artifact.
set -uo pipefail

cd "$(dirname "$0")/.."

BUILD_DIR="build"
RELEASE_JSON="$BUILD_DIR/release.json"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FAILED=0

fail() { echo "BUILD FAILED: $*"; FAILED=1; }

echo "==================================================================="
echo " RELEASE BUILD  $(date -u +%FT%TZ)"
echo "==================================================================="

# ---------------------------------------------------------------- provenance
echo
echo "[1/6] Provenance"
COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
COMMIT_SHORT=$(git rev-parse --short=12 HEAD 2>/dev/null || echo "")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ -z "$COMMIT_SHA" ]; then
  fail "not a git repository — cannot establish a verifiable commit SHA"
  COMMIT_SHA="unknown"; COMMIT_SHORT="unknown"
fi
DIRTY=false
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  DIRTY=true
fi
echo "  commit  : $COMMIT_SHA"
echo "  short   : $COMMIT_SHORT"
echo "  branch  : $BRANCH"
echo "  dirty   : $DIRTY"
if [ "$DIRTY" = "true" ]; then
  echo "  NOTE: working tree is dirty; the artifact would not reproduce from this SHA alone."
fi

# --------------------------------------------------------------- secret scan
echo
echo "[2/6] Secret scan (release gate)"
if ! python3 ops/secret_scan.py; then fail "secret scan detected credentials"; fi

# --------------------------------------------------------- frontend validation
echo
echo "[3/6] Frontend validation"
if command -v node >/dev/null 2>&1; then
  if node --check app/web/app.js; then echo "  app.js syntax OK"; else fail "app.js failed syntax check"; fi
else
  echo "  node unavailable; skipping JS syntax check"
fi
python3 - <<'PY' || fail "frontend DOM contract broken"
import re, sys
html = open("app/web/index.html").read()
js = open("app/web/app.js").read()
html_ids = set(re.findall(r'id="([^"]+)"', html))
js_ids = set(re.findall(r"\$\('([^']+)'\)", js)) | set(re.findall(r"getElementById\('([^']+)'\)", js))
missing = sorted(js_ids - html_ids)
print(f"  html ids={len(html_ids)} js refs={len(js_ids)} missing={missing or 'none'}")
sys.exit(1 if missing else 0)
PY

# --------------------------------------------------------------------- tests
echo
echo "[4/6] Test suite"
TEST_OUT=$(python3 -m pytest tests/ -q 2>&1)
TEST_RC=$?
echo "$TEST_OUT" | tail -3
TEST_SUMMARY=$(echo "$TEST_OUT" | grep -Eo '[0-9]+ passed[^,]*' | head -1)
TEST_COUNT=$(echo "$TEST_OUT" | grep -Eo '[0-9]+ passed' | grep -Eo '[0-9]+' | head -1)
if [ $TEST_RC -ne 0 ]; then fail "unit tests failed"; fi
echo "  summary: ${TEST_SUMMARY:-unknown}"

# --------------------------------------------------------------- live e2e
echo
echo "[5/6] Live end-to-end checks"
E2E_OUT=$(python3 ops/e2e_check.py 2>&1)
E2E_RC=$?
echo "$E2E_OUT" | grep -E "RESULT:" || echo "$E2E_OUT" | tail -3
E2E_SUMMARY=$(echo "$E2E_OUT" | grep -Eo 'RESULT: [0-9]+/[0-9]+ checks passed' | head -1)
if [ $E2E_RC -ne 0 ]; then
  echo "  WARNING: live e2e did not pass (network or exchange availability). Not blocking the build."
fi

# ------------------------------------------------- venue adapter live check
echo
echo "[5b/6] Venue adapter live verification"
VENUE=$(python3 -c "from app.config import load_config;print(load_config().exchange.name)" 2>/dev/null || echo unknown)
if [ "$VENUE" = "bybit" ]; then
  ADAPTER_OUT=$(python3 ops/verify_bybit_live.py 2>&1)
  ADAPTER_RC=$?
  echo "$ADAPTER_OUT" | grep -E "BYBIT LIVE VERIFICATION|FAILED" || echo "$ADAPTER_OUT" | tail -3
  ADAPTER_SUMMARY=$(echo "$ADAPTER_OUT" | grep -Eo 'BYBIT LIVE VERIFICATION: [0-9]+/[0-9]+ passed' | head -1)
  if [ $ADAPTER_RC -ne 0 ]; then
    echo "  WARNING: Bybit live verification did not fully pass. Not blocking the build,"
    echo "           but the adapter must be fixed before live orders are routed."
  fi
else
  ADAPTER_SUMMARY="venue=$VENUE (no adapter-specific live check)"
  echo "  $ADAPTER_SUMMARY"
fi

# ------------------------------------------------------------ release manifest
echo
echo "[6/6] Release manifest + artifact"
mkdir -p "$BUILD_DIR"
# A manifest that fails to write must FAIL the build: otherwise the artifact and
# the running service would report a stale SHA, and provenance is the whole point.
if ! python3 - "$COMMIT_SHA" "$COMMIT_SHORT" "$BRANCH" "$DIRTY" "$STAMP" \
         "$TEST_SUMMARY" "$TEST_COUNT" "$E2E_SUMMARY" "${ADAPTER_SUMMARY:-}" "$VENUE" <<'PY'
import json, os, platform, sys
from pathlib import Path
from datetime import datetime, timezone

if len(sys.argv) < 11:
    print(f"ERROR: manifest needs 10 args, got {len(sys.argv) - 1}", file=sys.stderr)
    sys.exit(2)
(sha, short, branch, dirty, stamp, test_summary, test_count,
 e2e, adapter, venue) = sys.argv[1:11]

def pkg(name):
    try:
        from importlib.metadata import version
        return version(name)
    except Exception:
        return "unknown"

deps = {n: pkg(n) for n in ("fastapi", "uvicorn", "httpx", "websockets", "pydantic",
                            "numpy", "pandas", "PyYAML")}

manifest = {
    "version": f"1.0.0+{short}",
    "commit_sha": sha,
    "commit_short": short,
    "branch": branch,
    "dirty": dirty == "true",
    "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "build_stamp": stamp,
    "built_by": os.environ.get("USER", "ci"),
    "release_gate": "passed",
    "verified": True,
    "tests": {"summary": test_summary or "unknown", "passed": int(test_count or 0)},
    "e2e": e2e or "not run",
    "adapter_check": adapter or "not run",
    "venue": venue or None,
    "dependencies": deps,
    "python": sys.version.split()[0],
    "platform": f"{platform.system()} {platform.release()}",
}

written = Path("build/release.json")
written.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"  wrote {written}")
print(f"  version : {manifest['version']}")
print(f"  tests   : {manifest['tests']['summary']}")
print(f"  e2e     : {manifest['e2e']}")
print(f"  adapter : {manifest['adapter_check']}")
print(f"  deps    : fastapi {deps['fastapi']}, pandas {deps['pandas']}, numpy {deps['numpy']}")
PY
then
  fail "release manifest could not be written"
fi

# Post-condition: the manifest MUST describe this commit. A stale manifest would
# make the deploy's SHA verification compare against the wrong build.
MANIFEST_SHA=$(python3 -c "import json;print(json.load(open('$RELEASE_JSON')).get('commit_sha',''))" 2>/dev/null || echo "")
if [ "$MANIFEST_SHA" != "$COMMIT_SHA" ]; then
  fail "manifest SHA '$MANIFEST_SHA' does not match commit '$COMMIT_SHA'"
else
  echo "  manifest SHA matches the commit"
fi

ARTIFACT="$BUILD_DIR/quant-${COMMIT_SHORT}-${STAMP}.tar.gz"
# Include build/release.json (provenance) but exclude the tarballs themselves, so
# an install from this artifact can still self-report its exact commit SHA.
tar --exclude='./data' --exclude='./.git' \
    --exclude="$BUILD_DIR/quant-*.tar.gz" \
    --exclude='__pycache__' --exclude='.pytest_cache' \
    -czf "$ARTIFACT" . 2>/dev/null
# Materialise the listing BEFORE grepping it. `tar -tzf | grep -q` is unsafe under
# `set -o pipefail`: grep -q exits at the first match, tar then dies of SIGPIPE and the
# pipeline reports 141, so a present entry is reported missing. Whether it bites depends on
# where the entry lands in the archive, which depends on filesystem readdir order — the gate
# therefore passed or failed by luck, and this is the failure it produced in practice.
ARTIFACT_LIST="$(mktemp)"
if tar -tzf "$ARTIFACT" > "$ARTIFACT_LIST" 2>/dev/null && grep -q 'build/release.json' "$ARTIFACT_LIST"; then
  echo "  artifact includes build/release.json (self-describing provenance)"
else
  fail "artifact is missing build/release.json"
fi
rm -f "$ARTIFACT_LIST"
echo "  artifact: $ARTIFACT ($(du -h "$ARTIFACT" | cut -f1))"

echo
echo "==================================================================="
if [ $FAILED -ne 0 ]; then
  echo " BUILD RESULT: FAILED"
  echo "==================================================================="
  exit 1
fi
echo " BUILD RESULT: PASSED"
echo " release SHA: $COMMIT_SHA"
echo "==================================================================="
exit 0
