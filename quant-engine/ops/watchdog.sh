#!/usr/bin/env bash
# Minimal process supervisor for environments without systemd.
#
# Restarts the platform on crash with capped exponential backoff. The engine is
# crash-safe: state lives in SQLite, and on restart it reloads the equity curve
# and re-screens the universe, so a restart is not amnesia.
set -uo pipefail

cd "$(dirname "$0")/.."

LOG_DIR="data/logs"
mkdir -p "$LOG_DIR"

BACKOFF=2
MAX_BACKOFF=120

while true; do
  echo "[watchdog $(date -u +%FT%TZ)] starting platform"
  bash ops/run.sh >>"$LOG_DIR/supervisor.log" 2>&1
  code=$?

  if [[ $code -eq 0 ]]; then
    echo "[watchdog $(date -u +%FT%TZ)] clean exit"
    exit 0
  fi

  echo "[watchdog $(date -u +%FT%TZ)] exited code=$code; restarting in ${BACKOFF}s"
  sleep "$BACKOFF"
  BACKOFF=$(( BACKOFF * 2 > MAX_BACKOFF ? MAX_BACKOFF : BACKOFF * 2 ))
done
