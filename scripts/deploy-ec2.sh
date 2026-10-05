#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/ubuntu/gigpilot"
REPO_URL="https://github.com/ky8402-rgb/gigpilot-platform.git"

echo "=== GigPilot Python-only production deployment ==="

if [ -f "/home/ubuntu/.env" ]; then
  cp -f /home/ubuntu/.env /tmp/gigpilot.env.bak 2>/dev/null || true
elif [ -f "$APP_DIR/.env" ]; then
  cp -f "$APP_DIR/.env" /tmp/gigpilot.env.bak 2>/dev/null || true
fi

if [ ! -d "$APP_DIR/.git" ]; then
  rm -rf /tmp/gigpilot-fresh
  git clone "$REPO_URL" /tmp/gigpilot-fresh
  mkdir -p "$APP_DIR"
  cp -rf /tmp/gigpilot-fresh/. "$APP_DIR/"
  rm -rf /tmp/gigpilot-fresh
fi

cd "$APP_DIR"
git remote set-url origin "$REPO_URL" 2>/dev/null || true
git fetch origin main --prune
git checkout -B main origin/main
git reset --hard origin/main

# Remove only known legacy Node production artifacts left by pre-migration deployments.
# Never use a blanket git clean: .env and .gigpilot-data are persistent production state.
echo "Purging legacy Node runtime artifacts from the EC2 host..."
rm -rf "$APP_DIR/server" "$APP_DIR/node_modules" "$APP_DIR/.npm" \
       "$APP_DIR/ecosystem.config.cjs" "$APP_DIR/dist/server.cjs" "$APP_DIR/dist/worker.cjs"
rm -f "$APP_DIR/server.ts" "$APP_DIR/worker.ts"

DEPLOYED_COMMIT="$(git rev-parse HEAD)"
echo "Target revision: $DEPLOYED_COMMIT"

if [ -f /tmp/gigpilot.env.bak ]; then cp -f /tmp/gigpilot.env.bak "$APP_DIR/.env"; fi
umask 077
touch "$APP_DIR/.env"

set_env_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^$key=" "$APP_DIR/.env" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$APP_DIR/.env"
}

[ -n "${DATABASE_URL:-}" ] && set_env_value "DATABASE_URL" "$DATABASE_URL"
[ -n "${GEMINI_API_KEY:-}" ] && set_env_value "GEMINI_API_KEY" "$GEMINI_API_KEY"
[ -n "${BYBIT_API_KEY:-}" ] && set_env_value "BYBIT_API_KEY" "$BYBIT_API_KEY"
[ -n "${BYBIT_API_SECRET:-}" ] && set_env_value "BYBIT_API_SECRET" "$BYBIT_API_SECRET"

if ! grep -qE '^DATABASE_URL=(postgres://|postgresql://)' "$APP_DIR/.env"; then
  echo "ERROR: production DATABASE_URL missing; refusing deployment."
  exit 1
fi

if [ -n "${OWNER_SESSION_SECRET:-}" ]; then
  set_env_value "OWNER_SESSION_SECRET" "$OWNER_SESSION_SECRET"
elif ! grep -qE '^OWNER_SESSION_SECRET=.{32,}' "$APP_DIR/.env"; then
  OWNER_SESSION_SECRET="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  set_env_value "OWNER_SESSION_SECRET" "$OWNER_SESSION_SECRET"
fi

echo "Verifying prebuilt React artifact..."
test -s "$APP_DIR/dist/index.html"

echo "Installing Python dependencies..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 missing."
  exit 1
fi
if [ ! -x "$APP_DIR/.venv/bin/python3" ]; then
  python3 -m venv "$APP_DIR/.venv"
fi
# The deployment script runs the same full pytest regression gate as CI. Install test-only
# dependencies explicitly so a fresh host cannot pass CI but fail deployment because pytest/httpx
# were only present accidentally from a previous image.
"$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --no-input -r "$APP_DIR/requirements-dev.txt"
"$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --no-input -r "$APP_DIR/requirements.txt"
"$APP_DIR/.venv/bin/python3" -c "import fastapi, uvicorn, aiohttp; print('Python runtime verified')"

echo "Running Python migration and safety gates..."
"$APP_DIR/.venv/bin/python3" tests/test_python_only_runtime.py
"$APP_DIR/.venv/bin/python3" tests/test_parity.py
"$APP_DIR/.venv/bin/python3" tests/test_execution_idempotency.py
"$APP_DIR/.venv/bin/python3" tests/test_package_seams.py
"$APP_DIR/.venv/bin/python3" tests/test_dashboard_delivery.py
"$APP_DIR/.venv/bin/python3" -m pytest tests/ -q --no-header

echo "Installing Python systemd service..."
sudo tee /etc/systemd/system/gigpilot.service >/dev/null <<UNIT
[Unit]
Description=GigPilot Python Autonomous Futures Platform
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=GIGPILOT_BIND=127.0.0.1
Environment=GIGPILOT_PORT=3000
Environment=GIGPILOT_ARM=0
# Production remains fail-closed until an operator explicitly validates a live-capital release.
Environment=GIGPILOT_EXECUTION_MODE=paper
Environment=GIGPILOT_LIVE_ARMED=0
Environment=GIGPILOT_FORCE_DISARM=1
Environment=GIGPILOT_PAPER_EQUITY=10000
Environment=PYTHONUNBUFFERED=1
ExecStart=$APP_DIR/.venv/bin/python3 $APP_DIR/gigpilot.py
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP_DIR/.gigpilot-data
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/gigpilot-ml-l2.service >/dev/null <<UNIT
[Unit]
Description=GigPilot historical liquidity snapshot collector
After=network-online.target gigpilot.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/python3 $APP_DIR/scripts/ml_research.py collect-l2 --db $APP_DIR/.gigpilot-data/gigpilot.db
Restart=always
RestartSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP_DIR/.gigpilot-data
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/gigpilot-ml-train.service >/dev/null <<UNIT
[Unit]
Description=GigPilot historical ML ingestion and qualification
After=network-online.target gigpilot.service
Wants=network-online.target

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=$APP_DIR
# A transient public-market refresh failure must not suppress qualification against the already
# persisted 90-day dataset. The leading '-' tells systemd to record/log a failed refresh but continue
# to the fail-closed trainer; training itself remains mandatory for this oneshot to succeed.
ExecStart=-$APP_DIR/.venv/bin/python3 $APP_DIR/scripts/ml_research.py ingest --db $APP_DIR/.gigpilot-data/gigpilot.db
ExecStart=$APP_DIR/.venv/bin/python3 $APP_DIR/scripts/ml_research.py train --db $APP_DIR/.gigpilot-data/gigpilot.db
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP_DIR/.gigpilot-data
UNIT

sudo tee /etc/systemd/system/gigpilot-ml-train.timer >/dev/null <<UNIT
[Unit]
Description=Periodic GigPilot ML retraining

[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Persistent=true
Unit=gigpilot-ml-train.service

[Install]
WantedBy=timers.target
UNIT

sudo install -m 0755 "$APP_DIR/bin/gigpilot" /usr/local/bin/gigpilot
sudo systemctl daemon-reload

echo "Stopping legacy Node production processes before Python activation..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete gigpilot-engine 2>/dev/null || true
  pm2 delete gigpilot 2>/dev/null || true
  pm2 delete worker 2>/dev/null || true
  pm2 kill 2>/dev/null || true
fi

sudo systemctl enable gigpilot.service gigpilot-ml-l2.service gigpilot-ml-train.timer
sudo systemctl restart gigpilot.service
sudo systemctl start gigpilot-ml-train.timer
sudo systemctl stop gigpilot-ml-l2.service 2>/dev/null || true
echo "Starting ML qualification asynchronously; production activation does not wait on research duration."
if ! sudo systemctl start --no-block gigpilot-ml-train.service; then
  echo "WARNING: ML bootstrap could not be queued; live engine remains fail-closed and the timer will retry qualification."
  sudo systemctl status gigpilot-ml-train.service --no-pager || true
fi
sudo systemctl restart gigpilot-ml-l2.service

echo "Waiting for FastAPI..."
HEALTHY=0
for attempt in $(seq 1 30); do
  if curl -fsS -m 5 http://127.0.0.1:3000/api/health >/tmp/gigpilot-health.json 2>/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 2
done
if [ "$HEALTHY" -ne 1 ]; then
  echo "ERROR: FastAPI did not become reachable."
  sudo journalctl -u gigpilot.service -n 120 --no-pager || true
  exit 1
fi

python3 - <<'PY'
import json, pathlib
p=pathlib.Path("/tmp/gigpilot-health.json")
x=json.loads(p.read_text())
if x.get("deployedCommit") != pathlib.Path(".gigpilot-data/deployed-commit.txt").read_text().strip() if pathlib.Path(".gigpilot-data/deployed-commit.txt").exists() else False:
    pass
PY

echo "$DEPLOYED_COMMIT" > "$APP_DIR/.gigpilot-data/deployed-commit.txt"
chmod 600 "$APP_DIR/.gigpilot-data/deployed-commit.txt"

HEALTH_JSON="$(curl -fsS -m 10 http://127.0.0.1:3000/api/health)"
python3 - "$HEALTH_JSON" "$DEPLOYED_COMMIT" <<'PY'
import json,sys
x=json.loads(sys.argv[1]); expected=sys.argv[2]
if x.get("deployedCommit") != expected:
    raise SystemExit(f"deployment attestation mismatch: {x.get('deployedCommit')} != {expected}")
if not x.get("autonomousEngine",{}).get("reachable"):
    raise SystemExit("FastAPI reports autonomous engine unreachable")
print("FastAPI exact-SHA health verification passed")
PY

check_unit() {
  local unit="$1"
  if ! sudo systemctl is-active --quiet "$unit"; then
    echo "ERROR: required unit is not active: $unit"
    sudo systemctl status "$unit" --no-pager || true
    sudo journalctl -u "$unit" -n 80 --no-pager || true
    return 1
  fi
  echo "HEALTHY: $unit active"
}
check_unit gigpilot.service
check_unit gigpilot-ml-l2.service
check_unit gigpilot-ml-train.timer
if ! sudo systemctl is-enabled --quiet gigpilot-ml-train.timer; then
  echo "ERROR: gigpilot-ml-train.timer is not enabled"
  exit 3
fi
if ! systemctl show gigpilot.service -p Environment --value | grep -q "GIGPILOT_EXECUTION_MODE=paper"; then
  echo "ERROR: production execution mode is not explicitly fail-closed (paper)"
  systemctl show gigpilot.service -p Environment --value || true
  exit 3
fi
if ! systemctl show gigpilot.service -p Environment --value | grep -q "GIGPILOT_LIVE_ARMED=0"; then
  echo "ERROR: GIGPILOT_LIVE_ARMED=0 is not present on gigpilot.service"
  systemctl show gigpilot.service -p Environment --value || true
  exit 3
fi
if ! systemctl show gigpilot.service -p Environment --value | grep -q "GIGPILOT_FORCE_DISARM=1"; then
  echo "ERROR: legacy disarm compatibility guard is missing during the safety migration"
  systemctl show gigpilot.service -p Environment --value || true
  exit 3
fi
test -x /usr/local/bin/gigpilot
if ! /usr/local/bin/gigpilot ml audit-summary --db "$APP_DIR/.gigpilot-data/gigpilot.db" >/tmp/gigpilot-ml-audit.json; then
  echo "ERROR: ML audit-summary CLI failed"
  cat /tmp/gigpilot-ml-audit.json 2>/dev/null || true
  exit 3
fi
if command -v pm2 >/dev/null 2>&1 && pm2 jlist >/tmp/pm2.json 2>/dev/null; then
  if grep -q '"name":"gigpilot"' /tmp/pm2.json || grep -q '"name":"worker"' /tmp/pm2.json; then
    echo "ERROR: legacy Node PM2 runtime still active."
    cat /tmp/pm2.json
    exit 1
  fi
fi

sudo systemctl reload nginx 2>/dev/null || true
if [ -f "$APP_DIR/ecosystem.config.cjs" ]; then
  echo "ERROR: legacy Node PM2 ecosystem configuration still exists."
  exit 1
fi
if pgrep -x node >/dev/null 2>&1 || pgrep -x npm >/dev/null 2>&1; then
  echo "ERROR: a Node/npm production process is still running."
  ps -eo pid,comm,args | grep -E '(^|[[:space:]])(node|npm)([[:space:]]|$)' || true
  exit 1
fi
sudo systemctl is-active --quiet gigpilot.service || {
  echo "ERROR: Python FastAPI systemd service is not active."
  exit 1
}

echo "=== Python production deployment verified: $DEPLOYED_COMMIT ==="
