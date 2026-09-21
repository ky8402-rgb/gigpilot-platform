#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "🛡️ GigPilot EC2 Automated Production Deployment"
echo "=========================================================="

APP_DIR=""
for dir in /home/ubuntu/gigpilot ~/gigpilot /opt/gigpilot /var/www/gigpilot; do
  if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then APP_DIR="$dir"; break; fi
done

if [ -z "$APP_DIR" ]; then
  mkdir -p /home/ubuntu/gigpilot
  APP_DIR="/home/ubuntu/gigpilot"
fi

cd "$APP_DIR"
echo "Working directory: $(pwd)"

if [ -n "${DEPLOY_SOURCE_DIR:-}" ] && [ -d "$DEPLOY_SOURCE_DIR" ]; then
  echo "Installing source tree from CI upload: $DEPLOY_SOURCE_DIR"
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name ".env" ! -name ".env.production" ! -name ".env.local" \
    ! -name ".owner-auth-config.json" ! -name ".binance-credentials.enc.json" \
    ! -name ".gigpilot-session-secret" ! -name "node_modules" -exec rm -rf {} +
  cp -a "$DEPLOY_SOURCE_DIR"/. "$APP_DIR"/
  rm -rf "$DEPLOY_SOURCE_DIR"
else
  echo "ERROR: DEPLOY_SOURCE_DIR was not provided. Refusing an unauthenticated GitHub pull." >&2
  exit 1
fi

# Bootstrap one persistent, machine-local runtime secret if no externally managed secret is present.
# It is preserved across source deployments and inherited by PM2, but never committed to Git.
SESSION_SECRET_FILE="$APP_DIR/.gigpilot-session-secret"
if [ ! -s "$SESSION_SECRET_FILE" ]; then
  umask 077
  openssl rand -base64 48 > "$SESSION_SECRET_FILE"
  chmod 600 "$SESSION_SECRET_FILE"
fi
SESSION_SECRET="$(tr -d '\\r\\n' < "$SESSION_SECRET_FILE")"
if [ "${#SESSION_SECRET}" -lt 32 ]; then
  echo "ERROR: Persistent GigPilot runtime secret is missing or invalid." >&2
  exit 1
fi
export OWNER_SESSION_SECRET="$SESSION_SECRET"
unset SESSION_SECRET

npm ci --prefer-offline || npm ci --legacy-peer-deps
npm run build

echo "Stopping stale PM2 processes..."
pm2 delete gigpilot 2>/dev/null || true
pm2 delete worker 2>/dev/null || true
pm2 flush >/dev/null 2>&1 || true

if [ -f ecosystem.config.cjs ]; then
  NODE_ENV=production PORT=3000 HOST=0.0.0.0 pm2 start ecosystem.config.cjs --env production --update-env
else
  NODE_ENV=production PORT=3000 HOST=0.0.0.0 pm2 start dist/server.cjs --name gigpilot --exec-mode fork --time --max-memory-restart 500M
fi

pm2 save

echo "Waiting for backend health endpoint on http://127.0.0.1:3000/api/health..."
HEALTH_OK=0
for i in $(seq 1 30); do
  STATUS=$(curl -sS -m 5 -o /tmp/gigpilot-health-response \
    -w '%{http_code}' http://127.0.0.1:3000/api/health 2>/tmp/gigpilot-health-error || true)
  if [ "$STATUS" = "200" ]; then
    HEALTH_OK=1
    echo "✔ Local health check passed (attempt $i/30)"
    head -c 1000 /tmp/gigpilot-health-response || true
    echo
    break
  fi
  echo "Health attempt $i/30 returned HTTP ${STATUS:-000}"
  [ "$i" -lt 30 ] && sleep 3
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "ERROR: Backend health check failed after deployment." >&2
  echo "---- curl error ----" >&2
  cat /tmp/gigpilot-health-error 2>/dev/null || true
  echo "---- listener diagnostics ----" >&2
  ss -ltnp 2>/dev/null | grep ':3000' >&2 || true
  echo "---- PM2 status ----" >&2
  pm2 status >&2 || true
  echo "---- PM2 details ----" >&2
  pm2 describe gigpilot >&2 || true
  echo "---- recent gigpilot logs ----" >&2
  pm2 logs gigpilot --lines 150 --nostream >&2 || true
  echo "---- recent worker logs ----" >&2
  pm2 logs worker --lines 80 --nostream >&2 || true
  exit 1
fi

if ! sudo systemctl reload nginx 2>/dev/null; then
  echo "ERROR: Nginx reload failed." >&2
  sudo nginx -t
  exit 1
fi

echo "=========================================================="
echo "✔ EC2 backend successfully deployed and running."
echo "=========================================================="
