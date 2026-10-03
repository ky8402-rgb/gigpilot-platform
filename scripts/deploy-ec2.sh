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
  printf '%s=%s\n' "$key" "$value" >> "$tmp_env"
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

# --- Owner-session secret: ONE value, in BOTH stores -------------------------------------------
# The Node backend and the Python engine must sign owner sessions with the same secret, or the engine
# refuses every forwarded session (401) and the Node proxy reports a healthy engine as
# "503 ENGINE UNREACHABLE" on the dashboard.
#
# They do NOT read the secret from the same place, and that asymmetry is the actual bug:
#   * Node reads `owner-auth-config.json`. `server.ts` calls `dotenv.config()` in its module body,
#     but under ES module semantics every `import` is evaluated BEFORE that body runs, so
#     `server/trading/ownerAuth.js` constructs its singleton — capturing OWNER_SESSION_SECRET — while
#     the variable is still unset. It therefore falls back to the persisted jwtSecret. The .env value
#     is unreachable to it no matter what .env says.
#   * The engine reads `.env` first, then the same persisted config.
#
# Writing the SAME value to both stores is what makes them converge, and it is deliberately robust to
# the load-order problem above rather than depending on it being fixed.
OWNER_SECRET_FILE="$APP_DIR/.gigpilot-data/owner-auth-config.json"

sync_owner_secret_to_config() {
  local secret="$1"
  node -e '
    const fs = require("fs"), path = require("path");
    const dir = process.env.GIGPILOT_DATA_DIR || path.join(process.cwd(), ".gigpilot-data");
    const file = path.join(dir, "owner-auth-config.json");
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { cfg = {}; }
    if (cfg.jwtSecret === process.argv[1]) { console.log("jwtSecret already in sync"); process.exit(0); }
    cfg.jwtSecret = process.argv[1];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    console.log("jwtSecret synced into " + file);
  ' "$secret"
}

generate_owner_secret() {
  openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# Rotation first: a marker file makes it run exactly once and be reviewable in git.
if [ -f "$APP_DIR/scripts/.rotate-owner-secret" ]; then
  umask 077
  touch "$APP_DIR/.env"
  OWNER_SECRET="$(generate_owner_secret)"
  set_env_value "OWNER_SESSION_SECRET" "$OWNER_SECRET"
  sync_owner_secret_to_config "$OWNER_SECRET"
  echo "🔑 OWNER_SESSION_SECRET ROTATED in BOTH stores — the previous value is retired."
  echo "   Every previously-issued owner session is invalid; the owner must sign in again."
elif ! grep -qE '^OWNER_SESSION_SECRET=.+' "$APP_DIR/.env" 2>/dev/null; then
  umask 077
  touch "$APP_DIR/.env"
  OWNER_SECRET="$(generate_owner_secret)"
  set_env_value "OWNER_SESSION_SECRET" "$OWNER_SECRET"
  sync_owner_secret_to_config "$OWNER_SECRET"
  echo "✔ OWNER_SESSION_SECRET generated in both .env and owner-auth-config.json"
else
  # Already present: force the persisted store to match .env so a previous divergence self-heals.
  OWNER_SECRET="$(grep -E '^OWNER_SESSION_SECRET=' "$APP_DIR/.env" | tail -1 | cut -d= -f2-)"
  sync_owner_secret_to_config "$OWNER_SECRET"
  echo "✔ OWNER_SESSION_SECRET already configured; persisted store reconciled to match"
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
if ! python3 -c "import venv, ensurepip" 2>/dev/null; then
  echo "Installing python3-venv and python3-pip system packages..."
  sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv python3-pip 2>/dev/null || true
fi
if [ ! -x "$APP_DIR/.venv/bin/python3" ]; then
  echo "Creating Python virtual environment at $APP_DIR/.venv..."
  python3 -m venv "$APP_DIR/.venv"
fi
"$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --no-input -r "$APP_DIR/requirements.txt"
if [ -f "$APP_DIR/requirements-dev.txt" ]; then
  "$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --no-input -r "$APP_DIR/requirements-dev.txt"
fi
if ! "$APP_DIR/.venv/bin/python3" -c "import aiohttp, fastapi, uvicorn; print('Python venv verified OK')" 2>/dev/null; then
  echo "ERROR: Python dependencies failed verification in $APP_DIR/.venv"
  exit 1
fi

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
#
# The control-plane gates below are the ones that protect live capital, so they run on the deploy
# host immediately before pm2 is touched:
#   test_owner_auth             - the session credential cannot be forged (alg confusion, tamper,
#                                 expiry, wrong role)
#   test_control_plane_auth     - no operational endpoint is reachable anonymously
#   test_kill_switch_persistence- a kill/disarm survives a restart instead of silently re-arming
#   test_arm_gate               - the preflight refuses to arm on staleness, no edge, revoked trade
#                                 permission or insufficient capital
#   test_entry_sizing           - lot-step rounding and minOrderQty, with exits never blocked
#   test_paper_lifecycle        - end-to-end dry run: entry -> native TP/SL -> verified accounting
echo "Running pre-deploy Python gates (parity, idempotency, seams)..."
"$APP_DIR/.venv/bin/python3" "$APP_DIR/tests/test_parity.py"
"$APP_DIR/.venv/bin/python3" "$APP_DIR/tests/test_execution_idempotency.py"
"$APP_DIR/.venv/bin/python3" "$APP_DIR/tests/test_package_seams.py"

echo "Running pre-deploy control-plane and trading-safety gates..."
"$APP_DIR/.venv/bin/python3" -m pytest "$APP_DIR/tests/" -q --no-header

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

echo "Waiting for GigPilot engine process to initialize on port 8001..."
ENGINE_HEALTHY=0
for attempt in $(seq 1 15); do
  if curl -fsS -m 5 http://127.0.0.1:8001/health >/tmp/gigpilot-engine-health.json 2>/dev/null; then
    echo "✔ GigPilot autonomous engine health check passed on 127.0.0.1:8001 (attempt $attempt)."
    ENGINE_HEALTHY=1
    break
  fi
  sleep 2
done
if [ "$ENGINE_HEALTHY" -ne 1 ]; then
  echo "ERROR: GigPilot autonomous engine failed to become healthy on port 8001."
  pm2 logs gigpilot-engine --lines 80 --nostream || true
  exit 1
fi

echo "Verifying gigpilot-engine restart recovery (real restart test)..."
pm2 restart gigpilot-engine
sleep 3
ENGINE_RESTART_HEALTHY=0
for attempt in $(seq 1 10); do
  if curl -fsS -m 5 http://127.0.0.1:8001/health >/dev/null 2>&1; then
    echo "✔ GigPilot autonomous engine verified healthy after real restart."
    ENGINE_RESTART_HEALTHY=1
    break
  fi
  sleep 2
done
if [ "$ENGINE_RESTART_HEALTHY" -ne 1 ]; then
  echo "ERROR: GigPilot autonomous engine failed to recover after pm2 restart!"
  pm2 logs gigpilot-engine --lines 80 --nostream || true
  exit 1
fi

echo "Waiting for backend process to initialize on port 3000..."
HEALTH_OK=0
for attempt in $(seq 1 15); do
  if curl -sS -m 5 http://127.0.0.1:3000/api/health >/tmp/node-health.json 2>&1; then
    if grep -q '"status":"ok"' /tmp/node-health.json; then
      echo "✔ Local health check passed (http://127.0.0.1:3000/api/health: OK)"
      HEALTH_OK=1
      break
    fi
  fi
  sleep 2
done

# --- Node <-> engine owner-session CONVERGENCE gate -------------------------------------------
# Everything above this line checks the engine's PUBLIC /health, which by construction cannot fail
# for an authentication reason. That blind spot is exactly how a signing-secret mismatch reached
# production: Node authenticated the owner, forwarded the session to the engine, the engine rejected
# it with 401, and the proxy reported a healthy engine as "ENGINE UNREACHABLE" on the dashboard.
#
# This probe mints a token with the resolved owner secret and proves end-to-end that (a) Node accepts
# it, (b) the ENGINE accepts the same token, and (c) the engine still refuses anonymous and
# wrong-secret callers. `set -e` aborts the rollout if it fails.
echo "Verifying Node <-> engine owner-session convergence..."
if ! node "$APP_DIR/scripts/verify-engine-auth-convergence.mjs"; then
  echo "ERROR: Node and the autonomous engine do NOT share an owner session secret."
  echo "       Every authenticated engine proxy would degrade to 503 ENGINE UNREACHABLE."
  echo "       Check OWNER_SESSION_SECRET in $APP_DIR/.env and confirm BOTH processes restarted."
  exit 1
fi

# ATTESTATION — record the deployed commit ONLY now. By this point the source is checked out, the
# runtime invariant gate passed, the build completed, PM2 relaunched every app, the engine
# passed its health and restart recovery gates, and /api/health is verified live.
if [ "$HEALTH_OK" = "1" ]; then
  printf '%s\n' "$DEPLOYED_COMMIT" > "$APP_DIR/.gigpilot-data/deployed-commit.txt"
  chmod 600 "$APP_DIR/.gigpilot-data/deployed-commit.txt"
  echo "✔ Deployed commit attested after verified restart: $DEPLOYED_COMMIT"
else
  echo "ERROR: local /api/health did not respond with 200 OK after deployment!"
  pm2 status
  pm2 logs --lines 80 --nostream || true
  exit 1
fi

echo "Reloading Nginx reverse proxy..."
sudo systemctl reload nginx 2>/dev/null || sudo systemctl restart nginx 2>/dev/null || true

echo "=========================================================="
echo "✔ EC2 backend successfully deployed and running."
echo "=========================================================="
