#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "🛡️ GigPilot EC2 Automated Production Deployment"
echo "=========================================================="

APP_DIR="/home/ubuntu/gigpilot"

# Check for GitHub token for authenticated git access
REPO_URL="https://github.com/ky8402-rgb/gigpilot-platform.git"
if [ -n "$GITHUB_TOKEN" ]; then
  REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/ky8402-rgb/gigpilot-platform.git"
elif [ -n "$GH_TOKEN" ]; then
  REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/ky8402-rgb/gigpilot-platform.git"
fi

if [ -f "/home/ubuntu/.env" ]; then
  cp -f /home/ubuntu/.env /tmp/gigpilot.env.bak 2>/dev/null || true
elif [ -f "$APP_DIR/.env" ]; then
  cp -f "$APP_DIR/.env" /tmp/gigpilot.env.bak 2>/dev/null || true
fi

if [ ! -d "$APP_DIR" ] || [ ! -f "$APP_DIR/package.json" ]; then
  echo "Clean repository checkout required at $APP_DIR..."
  rm -rf /tmp/gigpilot-fresh 2>/dev/null || true
  git clone "$REPO_URL" /tmp/gigpilot-fresh
  mkdir -p "$APP_DIR"
  cp -rf /tmp/gigpilot-fresh/. "$APP_DIR/"
  rm -rf /tmp/gigpilot-fresh
fi

cd "$APP_DIR"
echo "Working directory: $(pwd)"

# Ensure origin is configured
git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL" 2>/dev/null || true

# Clean and update
git fetch origin main --prune 2>/dev/null || true
git checkout -B main origin/main 2>/dev/null || git checkout -f main 2>/dev/null || true
git reset --hard origin/main 2>/dev/null || true

# The exact source revision this run is deploying. It is NOT written to the attestation file
# here: /api/health re-reads that file on every request, so recording it before the build and
# reload would make the currently-running OLD process report the NEW sha as deployed — a false
# release claim that could even satisfy the deployment verification gate. The write happens at
# the end of this script, after a verified restart (see ATTESTATION below).
DEPLOYED_COMMIT="$(git rev-parse HEAD)"
mkdir -p "$APP_DIR/.gigpilot-data"
echo "Target revision for this deployment: $DEPLOYED_COMMIT"

# Restore .env
if [ -f "/tmp/gigpilot.env.bak" ]; then
  cp -f /tmp/gigpilot.env.bak "$APP_DIR/.env" 2>/dev/null || true
fi

# Write a dotenv value without sed interpolation. This keeps secret characters
# such as |, &, \\, $, and / from corrupting the deployment command.
set_env_value() {
  local key="$1"
  local value="$2"
  local tmp_env
  tmp_env="$(mktemp)"
  grep -v "^\${key}=" "$APP_DIR/.env" > "$tmp_env" || true
  printf '%s=%s\\n' "$key" "$value" >> "$tmp_env"
  chmod 600 "$tmp_env"
  mv "$tmp_env" "$APP_DIR/.env"
}

# Configure BYBIT_API_KEY & BYBIT_API_SECRET if supplied
if [ -n "${BYBIT_API_KEY:-}" ]; then
  umask 077
  touch "$APP_DIR/.env"
  set_env_value "BYBIT_API_KEY" "$BYBIT_API_KEY"
  echo "✔ BYBIT_API_KEY updated in $APP_DIR/.env"
fi

if [ -n "${BYBIT_API_SECRET:-}" ]; then
  umask 077
  touch "$APP_DIR/.env"
  set_env_value "BYBIT_API_SECRET" "$BYBIT_API_SECRET"
  echo "✔ BYBIT_API_SECRET updated in $APP_DIR/.env"
fi

# Configure GEMINI_API_KEY if supplied
if [ -n "${GEMINI_API_KEY:-}" ]; then
  umask 077
  touch "$APP_DIR/.env"
  set_env_value "GEMINI_API_KEY" "$GEMINI_API_KEY"
  echo "✔ GEMINI_API_KEY updated in $APP_DIR/.env"
fi

# Require a production database connection for live persistence. The value is supplied
# by the deployment workflow from GitHub Secrets and is never committed to source.
if [ -n "${DATABASE_URL:-}" ]; then
  case "$DATABASE_URL" in
    postgres://*|postgresql://*) ;;
    *) echo "ERROR: DATABASE_URL is not a PostgreSQL URL."; exit 1 ;;
  esac
  umask 077
  touch "$APP_DIR/.env"
  set_env_value "DATABASE_URL" "$DATABASE_URL"
elif ! grep -qE '^DATABASE_URL=(postgres://|postgresql://)' "$APP_DIR/.env" 2>/dev/null; then
  echo "ERROR: No production DATABASE_URL is configured. Refusing live deployment."; exit 1
fi

echo "Installing GigPilot Python engine dependencies..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required for the autonomous futures engine."; exit 1
fi
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --no-input -r "$APP_DIR/requirements.txt"

echo "Installing production build dependencies..."
npm install --prefer-offline || npm install --legacy-peer-deps

echo "Building application bundles (Vite + esbuild)..."
npm run build

# Pre-deploy runtime gate. Runs on the host that is about to execute this code, BEFORE pm2 is
# touched, so an ownership, fail-closed or webhook-security regression stops the deploy instead
# of reaching production. `set -e` above makes a failure here abort the rollout.
echo "Running pre-deploy runtime invariant gate..."
npm run test:runtime

# Python gates, run with the venv interpreter created above (system python3 on this host does not
# have aiohttp/fastapi). Parity guards the migration surface; the idempotency test locks the order
# paths to a single submission helper. `set -e` aborts the rollout if either fails.
echo "Running pre-deploy Python gates (parity + execution idempotency)..."
"$APP_DIR/.venv/bin/python3" "$APP_DIR/tests/test_parity.py"
"$APP_DIR/.venv/bin/python3" "$APP_DIR/tests/test_execution_idempotency.py"

echo "Configuring and restarting PM2 backend daemon..."
# All ecosystem apps must be recreated, not just the API. `pm2 start ecosystem.config.cjs` does
# NOT update an already-running app's loaded code or env, so a surviving "worker" would keep
# executing a stale dist/worker.cjs and stale env forever — changes to it would silently never
# deploy, and the single-owner env flag below would never take effect.
pm2 delete gigpilot-engine 2>/dev/null || true
pm2 delete gigpilot 2>/dev/null || true
pm2 delete worker 2>/dev/null || true

if [ -f "ecosystem.config.cjs" ]; then
  echo "Starting PM2 via ecosystem.config.cjs..."
  pm2 start ecosystem.config.cjs --env production
else
  echo "Starting PM2 via dist/server.cjs..."
  NODE_ENV=production PORT=3000 pm2 start dist/server.cjs --name gigpilot --time --max-memory-restart 500M
fi

pm2 save

echo "Waiting for Node and GigPilot engine processes to initialize..."
sleep 3
if curl -fsS -m 5 http://127.0.0.1:8001/health >/tmp/gigpilot-engine-health.json 2>/dev/null; then
  echo "✔ GigPilot autonomous engine health check passed on 127.0.0.1:8001."
else
  echo "ERROR: GigPilot autonomous engine failed to become healthy on port 8001."
  pm2 logs gigpilot-engine --lines 80 --nostream || true
  exit 1
fi

echo "Waiting for process to initialize on port 3000..."
sleep 3

# Local health verification
HEALTH_OK=0
if curl -sS -m 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "✔ Local health check passed (http://127.0.0.1:3000/api/health: OK)"
  HEALTH_OK=1
else
  echo "Notice: Service starting up or warming cache."
fi

# ATTESTATION — record the deployed commit ONLY now. By this point the source is checked out, the
# runtime invariant gate passed, the build completed, PM2 relaunched every app, and the engine
# passed its own health gate. Recording it any earlier would let a stale process report a release
# that is not running.
if [ "$HEALTH_OK" = "1" ]; then
  printf '%s\n' "$DEPLOYED_COMMIT" > "$APP_DIR/.gigpilot-data/deployed-commit.txt"
  chmod 600 "$APP_DIR/.gigpilot-data/deployed-commit.txt"
  echo "✔ Deployed commit attested after verified restart: $DEPLOYED_COMMIT"
else
  echo "WARNING: local /api/health did not respond, so the deployed-commit attestation was NOT updated."
  echo "         /api/health will keep reporting the previous revision, which is the truthful value."
fi

echo "Reloading Nginx reverse proxy..."
sudo systemctl reload nginx 2>/dev/null || sudo systemctl restart nginx 2>/dev/null || true

echo "=========================================================="
echo "✔ EC2 backend successfully deployed and running."
echo "=========================================================="
