#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "🛡️ GigPilot EC2 Automated Production Deployment"
echo "=========================================================="

APP_DIR=""
for dir in /home/ubuntu/gigpilot ~/gigpilot /opt/gigpilot /var/www/gigpilot; do
  if [ -d "$dir" ] && [ -f "$dir/package.json" ]; then
    APP_DIR="$dir"
    break
  fi
done

if [ -z "$APP_DIR" ]; then
  echo "Creating application directory at /home/ubuntu/gigpilot..."
  mkdir -p /home/ubuntu/gigpilot
  APP_DIR="/home/ubuntu/gigpilot"
fi

cd "$APP_DIR"
echo "Working directory: $(pwd)"

# CI uploads the already-validated source tree directly to EC2.
if [ -n "${DEPLOY_SOURCE_DIR:-}" ] && [ -d "$DEPLOY_SOURCE_DIR" ]; then
  echo "Installing source tree from CI upload: $DEPLOY_SOURCE_DIR"
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name ".env" \
    ! -name ".env.production" \
    ! -name ".env.local" \
    ! -name ".owner-auth-config.json" \
    ! -name ".binance-credentials.enc.json" \
    ! -name "node_modules" \
    -exec rm -rf {} +
  cp -a "$DEPLOY_SOURCE_DIR"/. "$APP_DIR"/
  rm -rf "$DEPLOY_SOURCE_DIR"
else
  echo "ERROR: DEPLOY_SOURCE_DIR was not provided. Refusing an unauthenticated GitHub pull."
  exit 1
fi

echo "Installing production build dependencies..."
npm ci --prefer-offline || npm ci --legacy-peer-deps

echo "Building application bundles (Vite + esbuild)..."
npm run build

echo "Configuring and restarting PM2 backend daemon..."
pm2 delete gigpilot 2>/dev/null || true

if [ -f "ecosystem.config.cjs" ]; then
  echo "Starting PM2 via ecosystem.config.cjs..."
  NODE_ENV=production PORT=3000 HOST=0.0.0.0 pm2 start ecosystem.config.cjs --env production --update-env
else
  echo "Starting PM2 via dist/server.cjs..."
  NODE_ENV=production PORT=3000 pm2 start dist/server.cjs --name gigpilot --time --max-memory-restart 500M
fi

pm2 save

echo "Waiting for backend health endpoint on http://127.0.0.1:3000/api/health..."
HEALTH_OK=0
for i in $(seq 1 20); do
  RESPONSE=$(curl -sS -m 5 -w '\nHTTP_STATUS:%{http_code}' \
    http://127.0.0.1:3000/api/health 2>&1 || true)
  STATUS=$(printf '%s\n' "$RESPONSE" | sed -n 's/^HTTP_STATUS://p' | tail -n 1)

  if [ "$STATUS" = "200" ]; then
    HEALTH_OK=1
    echo "✔ Local health check passed (attempt $i/20)"
    printf '%s\n' "$RESPONSE" | sed '/^HTTP_STATUS:/d' | head -c 1000 || true
    echo
    break
  fi

  echo "Health attempt $i/20 returned HTTP ${STATUS:-000}"
  [ "$i" -lt 20 ] && sleep 3
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "ERROR: Backend health check failed after deployment." >&2
  echo "---- Listener diagnostics ----" >&2
  ss -ltnp 2>/dev/null | grep ':3000' >&2 || true
  echo "---- PM2 status ----" >&2
  pm2 status >&2 || true
  echo "---- Recent gigpilot logs ----" >&2
  pm2 logs gigpilot --lines 100 --nostream >&2 || true
  echo "---- Recent worker logs ----" >&2
  pm2 logs worker --lines 50 --nostream >&2 || true
  echo "---- Direct health probe ----" >&2
  curl -v -m 5 http://127.0.0.1:3000/api/health >&2 || true
  exit 1
fi

echo "Reloading Nginx reverse proxy..."
if ! sudo systemctl reload nginx 2>/dev/null; then
  echo "ERROR: Nginx reload failed." >&2
  sudo nginx -t
  exit 1
fi

echo "=========================================================="
echo "✔ EC2 backend successfully deployed and running."
echo "=========================================================="
