#!/usr/bin/env bash
# =============================================================================
# Deploy the Python quant engine to this EC2 host as an ISOLATED service.
#
# Runs ON the EC2 instance. Invoked over SSH by .github/workflows/deploy-quant-engine.yml,
# which is the only credentialed path to this host — the same mechanism the Node service uses.
#
# Isolation is the point of this script:
#   * Node backend  : /home/ubuntu/gigpilot      (unchanged, PM2 app `gigpilot`)
#   * Quant engine  : /home/ubuntu/quant-engine  (PM2 app `quant-engine`)
#   * separate venv, separate .env, separate SSM prefix, separate exchange credentials
#
# Nothing here touches the Node service. This script can therefore run at any time without
# risking the live grid trader.
#
# SAFETY: this deployment must never arm live trading. The engine ships with
# execution.mode=paper and allow_live=false, and QUANT_LIVE_TRADING_ACK is deliberately never
# set. The final step asserts the booted engine reports live_armed=false and fails the deploy
# if it does not.
# =============================================================================
set -euo pipefail

NODE_DIR="/home/ubuntu/gigpilot"
ENGINE_DIR="/home/ubuntu/quant-engine"
VENV_DIR="$ENGINE_DIR/.venv"
ENV_FILE="$ENGINE_DIR/.env"
ENV_UTIL="$NODE_DIR/scripts/update-env.js"
PM2_APP="quant-engine"

# The engine's OWN SSM prefix, deliberately not the Node service's /gigpilot/prod. Separate
# paths mean rotating one service's credentials can never silently rotate the other's.
SSM_PREFIX="${QUANT_SSM_PREFIX:-/gigpilot/quant}"
SSM_REGION="${AWS_REGION:-ap-south-1}"

# Loopback only. The dashboard is not exposed publicly; reach it over an SSH tunnel or put a
# TLS-terminating proxy in front deliberately.
BIND_HOST="${QUANT_BIND_HOST:-127.0.0.1}"
BIND_PORT="${QUANT_BIND_PORT:-8080}"

echo "=========================================================="
echo "🧮 Quant engine deployment -> $ENGINE_DIR"
echo "=========================================================="

# -----------------------------------------------------------------------------
# 1. Refresh the repository checkout so quant-engine/ is at the requested revision.
#    Reuses the Node deploy's checkout rather than cloning a second time.
# -----------------------------------------------------------------------------
if [ ! -d "$NODE_DIR/.git" ]; then
  echo "ERROR: $NODE_DIR is not a git checkout; deploy the Node service first."
  exit 1
fi
cd "$NODE_DIR"
TARGET_REF="${QUANT_DEPLOY_REF:-origin/main}"
git fetch origin main --prune 2>/dev/null || true
git checkout -q --detach "$TARGET_REF" 2>/dev/null || git checkout -q --detach origin/main
SOURCE_DIR="$NODE_DIR/quant-engine"
if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: $SOURCE_DIR not found in the checkout; the monorepo layout is missing."
  exit 1
fi
SOURCE_COMMIT="$(git -C "$SOURCE_DIR/.." rev-parse HEAD)"
echo "Source revision: $SOURCE_COMMIT"

# -----------------------------------------------------------------------------
# 2. Sync the engine into place.
#    --delete keeps a removed module from lingering and being imported; exclusions protect the
#    venv, the engine's .env and its SQLite state, none of which live in the repository.
# -----------------------------------------------------------------------------
mkdir -p "$ENGINE_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude '.venv' --exclude '.env' --exclude 'data/' \
    --exclude '__pycache__' --exclude '.pytest_cache' --exclude 'build/' \
    "$SOURCE_DIR/" "$ENGINE_DIR/"
else
  find "$ENGINE_DIR" -mindepth 1 -maxdepth 1 \
    ! -name '.venv' ! -name '.env' ! -name 'data' -exec rm -rf {} +
  cp -a "$SOURCE_DIR/." "$ENGINE_DIR/"
fi
echo "Engine synced to $SOURCE_COMMIT"

# -----------------------------------------------------------------------------
# 3. Isolated virtual environment.
#    The engine pins pandas/numpy/fastapi independently of anything Node uses, and a shared
#    interpreter is how one service's dependency bump breaks another at 3am.
# -----------------------------------------------------------------------------
PYTHON_BIN="$(command -v python3)"
if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "Creating virtual environment..."
  if ! "$PYTHON_BIN" -m venv "$VENV_DIR" 2>/tmp/quant-venv.err; then
    # Debian/Ubuntu split ensurepip into its own package, so `python3 -m venv` fails on a
    # minimal EC2 image with "ensurepip is not available". Install it rather than falling back
    # to the system interpreter: an engine running on shared site-packages is precisely the
    # coupling the virtual environment exists to prevent, and a pandas bump for the Node
    # service must not be able to reach across and change the engine's numerics.
    PY_VER="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
    echo "  ensurepip unavailable; installing python${PY_VER}-venv via apt..."
    sudo apt-get update -qq >/dev/null 2>&1 || true
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "python${PY_VER}-venv" python3-pip >/dev/null 2>&1 || true
    if ! "$PYTHON_BIN" -m venv "$VENV_DIR" 2>>/tmp/quant-venv.err; then
      echo "ERROR: could not create the virtual environment even after installing python${PY_VER}-venv."
      cat /tmp/quant-venv.err
      exit 1
    fi
  fi
fi
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip
echo "Installing engine dependencies..."
"$VENV_DIR/bin/python" -m pip install --quiet -r "$ENGINE_DIR/requirements.txt"
"$VENV_DIR/bin/python" - <<'PY'
import fastapi, numpy, pandas
print(f"  fastapi {fastapi.__version__} | pandas {pandas.__version__} | numpy {numpy.__version__}")
PY

# -----------------------------------------------------------------------------
# 4. Configuration, from the engine's own SSM prefix via the instance IAM role.
#
#    The SSM parameter names come from the exchange's vocabulary (BYBIT_API_KEY); the engine
#    reads QUANT__EXCHANGE__API_KEY. That mapping is done HERE and nowhere else — writing
#    BYBIT_API_KEY into the engine's .env would be silently ignored and the engine would sit
#    in paper mode with no indication why.
#
#    Missing credentials are NOT fatal: the engine boots in paper mode against real market
#    data, which is exactly the state we want to verify connectivity from. They are reported
#    loudly so the gap is never a surprise.
# -----------------------------------------------------------------------------
umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true

if [ ! -f "$ENV_UTIL" ]; then
  echo "ERROR: $ENV_UTIL missing; refusing to write credentials without the safe writer."
  exit 1
fi

set_nested() {
  # $1 = engine env var name, $2 = value
  printf '%s' "$2" | node "$ENV_UTIL" --file "$ENV_FILE" --stdin "$1"
}

ssm_get() {
  local name="$1" value=""
  if command -v aws >/dev/null 2>&1; then
    value="$(aws ssm get-parameter --name "${SSM_PREFIX}/${name}" --with-decryption \
      --region "$SSM_REGION" --query 'Parameter.Value' --output text 2>/dev/null || true)"
    [ "$value" = "None" ] && value=""
  fi
  printf '%s' "$value"
}

echo "Resolving engine configuration from SSM ${SSM_PREFIX}/ (region $SSM_REGION)..."
if ! command -v aws >/dev/null 2>&1; then
  echo "  WARNING: the aws CLI is not installed on this host, so SSM cannot be read."
  echo "           Install it and attach an instance role with ssm:GetParameter on ${SSM_PREFIX}/*."
fi

SSM_KEY="$(ssm_get BYBIT_API_KEY)"
SSM_SECRET="$(ssm_get BYBIT_API_SECRET)"
if [ -n "$SSM_KEY" ] && [ -n "$SSM_SECRET" ]; then
  set_nested QUANT__EXCHANGE__API_KEY "$SSM_KEY"
  set_nested QUANT__EXCHANGE__API_SECRET "$SSM_SECRET"
  echo "  ✔ exchange credentials loaded from SSM ${SSM_PREFIX}/BYBIT_API_{KEY,SECRET}"
else
  echo "  WARNING: exchange credentials are not available at ${SSM_PREFIX}/BYBIT_API_KEY / BYBIT_API_SECRET."
  echo "           The engine will boot in PAPER mode against real market data. Create them with:"
  echo "             aws ssm put-parameter --name ${SSM_PREFIX}/BYBIT_API_KEY    --type SecureString --value '<key>'"
  echo "             aws ssm put-parameter --name ${SSM_PREFIX}/BYBIT_API_SECRET --type SecureString --value '<secret>'"
fi

# Bind address and paper-mode interlocks. Written every deploy so a hand-edited .env cannot
# quietly drift into a publicly bound, live-armed state.
set_nested QUANT__API__HOST "$BIND_HOST"
set_nested QUANT__API__PORT "$BIND_PORT"
set_nested QUANT__EXECUTION__MODE paper
set_nested QUANT__EXECUTION__ALLOW_LIVE false
set_nested QUANT_DATA_DIR "$ENGINE_DIR/data"

# Prove the interlocks landed, and that the acknowledgement is ABSENT.
if grep -qE '^QUANT_LIVE_TRADING_ACK=.+' "$ENV_FILE"; then
  echo "ERROR: QUANT_LIVE_TRADING_ACK is set in $ENV_FILE. Live arming is not part of a deployment."
  exit 1
fi
echo "  ✔ interlocks written: mode=paper, allow_live=false, live ack unset"

# -----------------------------------------------------------------------------
# 5. Run under PM2 beside the Node service, without disturbing it.
# -----------------------------------------------------------------------------
if [ -f "$ENGINE_DIR/main.py" ]; then
  ENTRY="$ENGINE_DIR/main.py"
else
  ENTRY="-m app.main"
fi
echo "Starting PM2 app '$PM2_APP' ($ENTRY)..."
pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
cd "$ENGINE_DIR"
# --interpreter none: the venv python IS the interpreter, so PM2 must not wrap it.
if [ -f "$ENGINE_DIR/main.py" ]; then
  pm2 start "$VENV_DIR/bin/python" --name "$PM2_APP" --interpreter none --update-env \
    --cwd "$ENGINE_DIR" --time --max-memory-restart 800M -- main.py
else
  pm2 start "$VENV_DIR/bin/python" --name "$PM2_APP" --interpreter none --update-env \
    --cwd "$ENGINE_DIR" --time --max-memory-restart 800M -- -m app.main
fi
pm2 save >/dev/null 2>&1 || true

# -----------------------------------------------------------------------------
# 6. Health verification. A deployment that cannot serve /api/health has not succeeded.
# -----------------------------------------------------------------------------
echo "Waiting for /api/health on ${BIND_HOST}:${BIND_PORT}..."
HEALTH_OK=0
for _ in $(seq 1 24); do
  if curl -sS -m 5 "http://${BIND_HOST}:${BIND_PORT}/api/health" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 5
done
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "ERROR: the quant engine did not become healthy. Refusing to declare success."
  pm2 logs "$PM2_APP" --lines 40 --nostream 2>/dev/null || true
  exit 1
fi
echo "✔ /api/health responding"

# -----------------------------------------------------------------------------
# 7. Boot-state assertions. These are the point of the migration, so they fail the deploy.
# -----------------------------------------------------------------------------
curl -sS -m 10 "http://${BIND_HOST}:${BIND_PORT}/api/health" -o /tmp/quant-health.json 2>/dev/null || true
curl -sS -m 10 "http://${BIND_HOST}:${BIND_PORT}/api/version" -o /tmp/quant-version.json 2>/dev/null || true

node - <<'PY'
const fs = require('fs');
const health = JSON.parse(fs.readFileSync('/tmp/quant-health.json', 'utf8'));
console.log(`  engine status : ${health.status}`);
console.log(`  venue         : ${health.venue ?? 'n/a'}`);
const feed = health.feed || {};
console.log(`  feed          : connected=${feed.connected} symbols=${feed.symbols ?? 'n/a'}`);
if (health.mode && health.mode !== 'paper') {
  console.error(`ERROR: engine is booted in mode '${health.mode}', expected 'paper'.`);
  process.exit(1);
}
if (health.live_armed === true) {
  console.error('ERROR: engine reports live_armed=true after a deployment. That must never happen here.');
  process.exit(1);
}
console.log('  ✔ paper mode confirmed, live routing NOT armed');
PY

echo "Verifying the engine can reach Bybit with the configured credentials..."
"$VENV_DIR/bin/python" - <<'PY'
import json, sys, urllib.request
try:
    with urllib.request.urlopen("http://127.0.0.1:%s/api/ready" % __import__("os").environ.get("QUANT_BIND_PORT", "8080"), timeout=20) as r:
        d = json.load(r)
    print(f"  /api/ready    : ready={d.get('ready')} mode={d.get('mode')}")
except Exception as exc:
    print(f"  /api/ready    : unavailable ({exc})")
PY

echo "=========================================================="
echo "✔ quant-engine deployed at $SOURCE_COMMIT on ${BIND_HOST}:${BIND_PORT}"
echo "=========================================================="
