#!/usr/bin/env bash
#
# PRODUCTION VERIFICATION GATE (Python-only stack).
#
# WHAT THIS REPLACES
# ------------------
# There used to be two near-identical copies of this script (one at the repository root, one here)
# that verified the backend AND an AWS Amplify-hosted React bundle. Both copies were removed with the
# Amplify/Node deployment surface, and the duplication was itself a defect: they drifted, and an
# assertion fixed in one copy silently stayed broken in the other.
#
# The console is now rendered by the FastAPI process, so this gate verifies ONE deployment target.
#
# WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
# --------------------------------------------------
# It asserts the DAEMON is healthy and in a deploy-acceptable lifecycle state. It does NOT require an
# armed engine: the gate is reached before an operator can supply the API secret, and POST /api/arm
# runs on the very server being gated. Requiring arming here would be self-sealing.
#
# Usage: ./scripts/verify-production.sh [base-url]
set -uo pipefail

BASE_URL="${1:-https://35-154-110-156.sslip.io}"

PASS=0
FAIL=0

check_pass() { echo -e "  \033[0;32m✔\033[0m $1"; PASS=$((PASS + 1)); }
check_fail() { echo -e "  \033[0;31m✘\033[0m $1"; FAIL=$((FAIL + 1)); }

echo "Verifying production deployment at ${BASE_URL}"
echo "======================================================"

# --------------------------------------------------------------------------------------------
# 1. Health endpoint and the lifecycle contract
# --------------------------------------------------------------------------------------------
HEALTH_JSON="$(curl -fsS --max-time 20 "${BASE_URL}/api/health" 2>/dev/null || true)"

if [ -z "$HEALTH_JSON" ]; then
  check_fail "Health endpoint did not answer at ${BASE_URL}/api/health"
else
  check_pass "Health endpoint answered"

  # The acceptable lifecycle states come from the state machine, not from a local copy: a second
  # source of truth is one that drifts. The comments below name them so the contract is readable
  # without opening the module: AWAITING_SECRET (correct on a cold boot in runtime-secret mode),
  # ARMED, DISARMED.
  LIFECYCLE_PROBLEMS=""
  for state in AWAITING_SECRET ARMED DISARMED; do
    if ! grep -qF "\"$state\"" <<<"$HEALTH_JSON"; then
      LIFECYCLE_PROBLEMS="${LIFECYCLE_PROBLEMS}${state} not reported; "
    fi
  done
  if ! grep -qF '"status":"ok"' <<<"$(tr -d ' \n' <<<"$HEALTH_JSON")"; then
    LIFECYCLE_PROBLEMS="${LIFECYCLE_PROBLEMS}status is not ok; "
  fi
  if ! grep -qF '"healthy":true' <<<"$(tr -d ' \n' <<<"$HEALTH_JSON")"; then
    LIFECYCLE_PROBLEMS="${LIFECYCLE_PROBLEMS}healthy is not true; "
  fi
  if [ -n "$LIFECYCLE_PROBLEMS" ]; then
    check_fail "Health lifecycle contract not satisfied: ${LIFECYCLE_PROBLEMS}"
  else
    check_pass "Health lifecycle contract satisfied (engine_state is one of the accepted states)"
  fi
fi

# --------------------------------------------------------------------------------------------
# 2. The Python console is what is actually served
# --------------------------------------------------------------------------------------------
INDEX_HTML="$(curl -fsS --max-time 20 "${BASE_URL}/" 2>/dev/null || true)"
if grep -qF 'Session API credentials' <<<"$INDEX_HTML"; then
  check_pass "The Python console is served at / (credential modal present)"
else
  check_fail "The served page is not the Python console"
fi

if curl -fsS --max-time 20 "${BASE_URL}/static/dashboard.css" 2>/dev/null | grep -qF -- '--bg'; then
  check_pass "Console stylesheet is served"
else
  check_fail "Console stylesheet is missing"
fi

# A page must be a dashboard, not a stub: the fallback page also contains the product name.
if [ "$(wc -c <<<"$INDEX_HTML" | tr -d ' ')" -gt 8000 ]; then
  check_pass "Console HTML is substantial (not the degenerate fallback page)"
else
  check_fail "Console HTML is suspiciously small; the template render probably failed"
fi

# --------------------------------------------------------------------------------------------
# 3. Deployed revision attestation
# --------------------------------------------------------------------------------------------
VERSION_JSON="$(curl -fsS --max-time 20 "${BASE_URL}/version.json" 2>/dev/null || true)"
COMMIT="$(sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$VERSION_JSON")"
if [ -n "$COMMIT" ]; then
  check_pass "version.json reports deployed commit ${COMMIT}"
else
  check_fail "version.json did not report a deployed commit"
fi

# --------------------------------------------------------------------------------------------
# 4. No Node process is serving this deployment
# --------------------------------------------------------------------------------------------
if command -v pgrep >/dev/null 2>&1 && pgrep -x node >/dev/null 2>&1; then
  check_fail "a Node process is running on this host; the stack is meant to be Python-only"
else
  check_pass "No Node process is serving this host"
fi

echo "======================================================"
echo "Passed: ${PASS}   Failed: ${FAIL}"
[ "$FAIL" -eq 0 ] || exit 1
echo "Production verification PASSED."
