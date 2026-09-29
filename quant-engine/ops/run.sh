#!/usr/bin/env bash
# Start the platform in the foreground. Use with a process supervisor (systemd,
# or ops/watchdog.sh) so a crash is restarted automatically.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${QUANT_API__PORT:=8080}"
export QUANT_API__PORT

# Load credentials/interlocks from .env when present.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

exec python3 -m app.main --host "${QUANT_API__HOST:-0.0.0.0}" --port "$QUANT_API__PORT"
