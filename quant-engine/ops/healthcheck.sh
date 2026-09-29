#!/usr/bin/env bash
# Liveness + readiness probe for external monitors and container orchestrators.
# Exit 0 = healthy. Exit 1 = not serving. Exit 2 = serving but degraded
# (e.g. the market data feed is stale, which blocks trading by design).
set -uo pipefail

PORT="${QUANT_API__PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"

health=$(curl -fsS -m 10 "${BASE}/api/health" 2>/dev/null) || {
  echo "UNHEALTHY: /api/health unreachable"
  exit 1
}

ready=$(curl -fsS -m 10 "${BASE}/api/ready" 2>/dev/null) || {
  echo "UNHEALTHY: /api/ready not 200 -> ${health}"
  exit 1
}

echo "$health"
echo "$ready"

if grep -q '"status":"degraded"' <<<"$health"; then
  echo "DEGRADED: market data feed stale — trading is blocked until it recovers"
  exit 2
fi

echo "OK"
exit 0
