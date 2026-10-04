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

sudo systemctl daemon-reload

echo "Stopping legacy Node production processes before Python activation..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete gigpilot-engine 2>/dev/null || true
  pm2 delete gigpilot 2>/dev/null || true
  pm2 delete worker 2>/dev/null || true
  pm2 save 2>/dev/null || true
  pm2 kill 2>/dev/null || true
fi

sudo systemctl enable gigpilot.service
sudo systemctl restart gigpilot.service

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

sudo systemctl is-active --quiet gigpilot.service
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
