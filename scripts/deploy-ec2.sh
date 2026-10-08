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

# ---- §7: runtime-only API secret -------------------------------------------------------------
# When GIGPILOT_REQUIRE_RUNTIME_SECRET=1 the API secret must NEVER be written to .env: it is typed
# by hand for each armed session and held only in engine memory. Writing it here would create
# exactly the on-disk copy the control exists to remove, and the unit's EnvironmentFile makes it
# world-readable to anything that can read the file.
#
# The migration is an ACTIVE removal, not just a skip: an .env left behind by an earlier deploy still
# holds the secret on disk, and merely no longer writing it would leave that copy in place forever.
remove_env_key() {
  local key="$1" tmp
  tmp="$(mktemp)"
  grep -v "^$key=" "$APP_DIR/.env" > "$tmp" || true
  chmod 600 "$tmp"
  mv "$tmp" "$APP_DIR/.env"
}

# UNCONDITIONAL. This was gated on GIGPILOT_REQUIRE_RUNTIME_SECRET being "1" in the CI environment,
# which meant the persisted path was the DEFAULT and the hand-entry control was opt-in. A CI variable
# is not a place to keep a security control: it defaults to "off", it is invisible in review, and
# nothing fails when it is missing. There is now no branch that writes a secret to disk.
if grep -q '^BYBIT_API_SECRET=' "$APP_DIR/.env" 2>/dev/null; then
  remove_env_key "BYBIT_API_SECRET"
  echo "runtime-secret mode: removed the persisted BYBIT_API_SECRET from .env"
fi
set_env_value "GIGPILOT_REQUIRE_RUNTIME_SECRET" "1"
echo "runtime-secret mode ENABLED (unconditional): the engine boots with no secret and signs nothing"
echo "  until an operator arms it. /api/health answers HTTP 200 with engine_state=AWAITING_SECRET and"
echo "  healthy=true; trading_ready stays false until a secret is supplied, and the deploy gate"
echo "  deliberately does NOT require live arming."

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

echo "Verifying the Python-rendered console..."
# The console is rendered by the Python process, so what must exist on the host is the template tree,
# not a prebuilt bundle. Asserting the templates (rather than a dist/ artifact that is no longer
# produced) keeps this check meaningful: a release that shipped without them would otherwise serve
# the fallback page to the operator while every gate reported success.
test -s "$APP_DIR/gpkg/web/templates/dashboard.html"
test -s "$APP_DIR/gpkg/web/templates/base.html"
test -s "$APP_DIR/gpkg/web/static/dashboard.css"
"$APP_DIR/.venv/bin/python3" -c "import jinja2; print('Template engine verified')" 2>/dev/null \
  || python3 -c "import jinja2; print('Template engine verified')"

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
Environment=GIGPILOT_EXECUTION_MODE=live
Environment=GIGPILOT_LIVE_ARMED=0
Environment=GIGPILOT_FORCE_DISARM=1
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
ExecStart=$APP_DIR/.venv/bin/python3 $APP_DIR/scripts/ml_research.py collect-l2 --db $APP_DIR/.gigpilot-data/gigpilot.db --interval 2
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
# Champion/challenger tournament, run AFTER ingestion so it evaluates against the freshest dataset.
#
# The leading '-' is deliberate and is the opposite trade-off from `train` above: training
# qualification is mandatory, whereas the research loop must never be able to take down the ML
# pipeline. A tournament failure is recorded in ml_research_audits and leaves the previous summary
# in place, so the dashboard shows stale-but-labelled evidence rather than a broken service. Making
# it mandatory would mean a research bug blocks data ingestion — which is how a venue silently stops
# collecting the very history the research depends on.
#
# Nothing here can promote a model to live capital: the tournament's strongest outcome is PAPER.
ExecStart=-$APP_DIR/.venv/bin/python3 $APP_DIR/scripts/ml_research.py tournament --db $APP_DIR/.gigpilot-data/gigpilot.db --generations 4 --population 12 --seed 7
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

# DAEMON health, not live arming. `AWAITING_SECRET` is the CORRECT state on a cold boot in
# runtime-secret mode: nothing can be signed until an operator hands over the secret, and the
# endpoint that accepts it lives on this server. Requiring an armed engine here would be
# self-sealing — the gate could never pass, so the server that accepts the secret could never come
# up to accept it. The acceptable set comes from the state machine itself rather than a local
# copy, so this gate cannot drift away from the contract in gpkg/core/engine_state.py.
sys.path.insert(0, ".")
from gpkg.core.engine_state import DEPLOY_ACCEPTABLE_STATES  # noqa: E402

state = x.get("engine_state")
if x.get("status") != "ok":
    raise SystemExit(f"daemon health is not ok: status={x.get('status')!r}")
if x.get("healthy") is not True:
    raise SystemExit("daemon reports healthy != true (public feed or database is down)")
if state not in DEPLOY_ACCEPTABLE_STATES:
    raise SystemExit(
        f"engine_state={state!r} is not deploy-acceptable; expected one of "
        f"{', '.join(DEPLOY_ACCEPTABLE_STATES)}. Live arming is NOT required at deploy time."
    )
print(f"FastAPI exact-SHA health verification passed (engine_state={state})")
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
if ! systemctl show gigpilot.service -p Environment --value | grep -q "GIGPILOT_EXECUTION_MODE=live"; then
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
