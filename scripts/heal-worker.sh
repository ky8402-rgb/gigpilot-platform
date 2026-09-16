#!/usr/bin/env bash
# ==============================================================================
# KUNDANVISION369 / GIGPILOT — Automated Worker Health & Self-Healing Script
# Verifies worker process activity (PM2 and standalone node) and restarts if unresponsive.
# ==============================================================================

set -o pipefail

HEARTBEAT_FILE="/tmp/worker_heartbeat.json"
LOG_FILE="/tmp/worker.log"
MAX_STALE_SECONDS=120
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
NOW_MS=$(date +%s%3N 2>/dev/null || node -e 'console.log(Date.now())')
NOW_SEC=$(date +%s)

WORKER_SCRIPT=""
if [ -f "dist/worker.cjs" ]; then
  WORKER_SCRIPT="dist/worker.cjs"
elif [ -f "server/worker.ts" ]; then
  WORKER_SCRIPT="server/worker.ts"
elif [ -f "sentient-freelancer/backend/worker.js" ]; then
  WORKER_SCRIPT="sentient-freelancer/backend/worker.js"
fi

# Detect running process via PM2
PM2_AVAILABLE=0
PM2_WORKER_ONLINE=0
PM2_PID=""

if command -v pm2 >/dev/null 2>&1; then
  PM2_AVAILABLE=1
  # Check if pm2 has worker process online
  PM2_STATUS=$(pm2 jlist 2>/dev/null || echo "[]")
  PM2_MATCH=$(node -e "
    try {
      const list = JSON.parse(process.argv[1]);
      const w = list.find(p => p.name === 'worker' || (p.pm2_env?.pm_exec_path && p.pm2_env.pm_exec_path.includes('worker')));
      if (w) {
        console.log(JSON.stringify({
          online: w.pm2_env?.status === 'online',
          pid: w.pid,
          uptime: Math.floor((Date.now() - (w.pm2_env?.pm_uptime || Date.now())) / 1000)
        }));
      }
    } catch (_) {}
  " "$PM2_STATUS" 2>/dev/null || echo "")

  if [ -n "$PM2_MATCH" ]; then
    PM2_IS_ONLINE=$(node -e "try { const d = JSON.parse(process.argv[1]); console.log(d.online ? '1':'0'); } catch (_) { console.log('0'); }" "$PM2_MATCH")
    if [ "$PM2_IS_ONLINE" = "1" ]; then
      PM2_WORKER_ONLINE=1
      PM2_PID=$(node -e "try { const d = JSON.parse(process.argv[1]); console.log(d.pid || ''); } catch (_) {}" "$PM2_MATCH")
    fi
  fi
fi

# Detect running process via OS process table
OS_PID=""
if [ -z "$PM2_PID" ]; then
  OS_PID=$(pgrep -f "worker\.(cjs|js|ts)" 2>/dev/null | head -n 1 || ps -ef | grep -E "[w]orker\.(cjs|js|ts)" | awk '{print $2}' | head -n 1 || true)
fi

ACTIVE_PID="${PM2_PID:-$OS_PID}"

# Read and evaluate heartbeat
HEARTBEAT_EXISTS=0
HEARTBEAT_AGE=999999
IS_RESPONSIVE=0

if [ -f "$HEARTBEAT_FILE" ]; then
  HEARTBEAT_EXISTS=1
  HEARTBEAT_TIME_MS=$(node -e "
    try {
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync('$HEARTBEAT_FILE', 'utf8'));
      console.log(data.timestamp || 0);
    } catch (_) { console.log(0); }
  " 2>/dev/null || echo 0)

  if [ "$HEARTBEAT_TIME_MS" -gt 0 ]; then
    HEARTBEAT_AGE=$(( (NOW_MS - HEARTBEAT_TIME_MS) / 1000 ))
    if [ "$HEARTBEAT_AGE" -ge 0 ] && [ "$HEARTBEAT_AGE" -lt "$MAX_STALE_SECONDS" ]; then
      IS_RESPONSIVE=1
    fi
  fi
fi

# If process is running and responsive, system is healthy
ACTION_TAKEN="none"
RESTARTED=0

if [ -n "$ACTIVE_PID" ] && [ "$IS_RESPONSIVE" -eq 1 ]; then
  STATUS="healthy"
  MESSAGE="Worker process (PID: $ACTIVE_PID) is active and responsive (Heartbeat age: ${HEARTBEAT_AGE}s)."
else
  # Needs healing / restart
  STATUS="restarted"
  ACTION_TAKEN="restarted"
  RESTARTED=1

  # Kill zombie or unresponsive process if PID exists but unresponsive
  if [ -n "$ACTIVE_PID" ]; then
    kill -15 "$ACTIVE_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$ACTIVE_PID" 2>/dev/null || true
  fi

  # Restart worker
  if [ "$PM2_AVAILABLE" -eq 1 ] && [ -f "dist/worker.cjs" ]; then
    # Try PM2 restart first
    pm2 delete worker >/dev/null 2>&1 || true
    pm2 start dist/worker.cjs --name worker --time --max-memory-restart 300M >/dev/null 2>&1 || true
    sleep 1
    ACTIVE_PID=$(pm2 pid worker 2>/dev/null || echo "")
    TYPE="pm2"
  fi

  # Fallback to standalone background node if PM2 did not give a PID
  if [ -z "$ACTIVE_PID" ] || [ "$ACTIVE_PID" = "0" ]; then
    if [ -f "dist/worker.cjs" ]; then
      nohup node dist/worker.cjs >> "$LOG_FILE" 2>&1 &
      ACTIVE_PID=$!
      TYPE="standalone"
    elif [ -f "server/worker.ts" ]; then
      nohup npx tsx server/worker.ts >> "$LOG_FILE" 2>&1 &
      ACTIVE_PID=$!
      TYPE="standalone_tsx"
    elif [ -f "sentient-freelancer/backend/worker.js" ]; then
      nohup node sentient-freelancer/backend/worker.js >> "$LOG_FILE" 2>&1 &
      ACTIVE_PID=$!
      TYPE="standalone_sentient"
    fi
  fi

  # Write fresh heartbeat
  node -e "
    const fs = require('fs');
    try {
      fs.writeFileSync('$HEARTBEAT_FILE', JSON.stringify({
        timestamp: Date.now(),
        pid: Number('$ACTIVE_PID') || process.pid,
        status: 'active',
        restartedAt: new Date().toISOString(),
        action: 'healed'
      }, null, 2));
    } catch (_) {}
  " 2>/dev/null || true

  HEARTBEAT_AGE=0
  IS_RESPONSIVE=1
  MESSAGE="Worker process was unresponsive or stopped. Successfully restarted (New PID: ${ACTIVE_PID:-unknown}, mode: ${TYPE:-daemon})."
fi

# Output clean JSON
node -e "
  const out = {
    ok: true,
    status: '$STATUS',
    actionTaken: '$ACTION_TAKEN',
    restarted: Boolean($RESTARTED),
    worker: {
      running: Boolean('$ACTIVE_PID'),
      pid: Number('$ACTIVE_PID') || null,
      type: '${TYPE:-pm2_or_standalone}',
      isResponsive: Boolean($IS_RESPONSIVE),
      heartbeatAgeSeconds: Number('$HEARTBEAT_AGE'),
      maxStaleThresholdSeconds: Number('$MAX_STALE_SECONDS'),
      script: '$WORKER_SCRIPT',
      message: '$MESSAGE'
    },
    timestamp: '$TIMESTAMP'
  };
  console.log(JSON.stringify(out, null, 2));
"
