#!/usr/bin/env bash
set -e

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
  cd "$APP_DIR"
  git clone https://github.com/ky8402-rgb/gigpilot-platform.git . || true
else
  cd "$APP_DIR"
fi

echo "Working directory: $(pwd)"
# Load only the host's existing runtime environment; no credentials are committed.
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
fi
git fetch --all --prune
# Stash and reset any runtime logs so merge/pull succeeds cleanly
git checkout -- RUN_LOG.md sentient-freelancer/RUN_LOG.md 2>/dev/null || true
git stash --include-untracked 2>/dev/null || true
git checkout main || git checkout master
git reset --hard origin/main || git pull origin main || git pull origin master

echo "Installing production build dependencies..."
npm install --prefer-offline || npm install --legacy-peer-deps

echo "Applying production PostgreSQL migrations..."
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required for production deployment."
  exit 1
fi

# Existing production databases may predate Prisma migration history. In that case,
# baseline the known initial migration without changing application data, then apply
# all newer migrations normally. Never use db push or reset in production.
MIGRATE_LOG="$(mktemp)"
trap 'rm -f "$MIGRATE_LOG"' EXIT
if npx prisma migrate deploy 2>&1 | tee "$MIGRATE_LOG"; then
  :
elif grep -q "Error: P3005" "$MIGRATE_LOG"; then
  echo "Detected an existing non-empty database without Prisma migration history; baselining the initial migration."
  npx prisma migrate resolve --applied 20260831000000_add_bid_performance_indexes
  npx prisma migrate deploy
else
  echo "ERROR: Prisma production migration failed for a reason other than an uninitialized migration history."
  cat "$MIGRATE_LOG"
  exit 1
fi
npx prisma generate

echo "Building application bundles (Vite + esbuild)..."
npm run build

echo "Configuring and restarting PM2 backend daemon..."
pm2 delete gigpilot 2>/dev/null || true

if [ -f "ecosystem.config.cjs" ]; then
  echo "Starting PM2 via ecosystem.config.cjs..."
  pm2 start ecosystem.config.cjs --env production
else
  echo "Starting PM2 via dist/server.cjs..."
  NODE_ENV=production PORT=3000 pm2 start dist/server.cjs --name gigpilot --time --max-memory-restart 500M
fi

pm2 save

echo "Waiting for process to initialize on port 3000..."
sleep 3

# Local health verification
if curl -sS -m 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "✔ Local health check passed (http://127.0.0.1:3000/api/health: OK)"
else
  echo "Notice: Service starting up or warming cache."
fi

echo "Reloading Nginx reverse proxy..."
sudo systemctl reload nginx 2>/dev/null || sudo systemctl restart nginx 2>/dev/null || true

echo "=========================================================="
echo "✔ EC2 backend successfully deployed and running."
echo "=========================================================="
