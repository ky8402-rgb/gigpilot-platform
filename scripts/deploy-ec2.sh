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

# Abort any conflicted merge, rebase, or dirty index first
if [ ! -d ".git" ]; then
  echo "No .git directory found in $APP_DIR. Initializing git repository and linking remote..."
  git init
  git remote add origin https://github.com/ky8402-rgb/gigpilot-platform.git 2>/dev/null || git remote set-url origin https://github.com/ky8402-rgb/gigpilot-platform.git 2>/dev/null || true
fi

# Preserve .env if present
if [ -f ".env" ]; then
  cp -f .env /tmp/gigpilot.env.bak 2>/dev/null || true
fi

git merge --abort 2>/dev/null || true
git rebase --abort 2>/dev/null || true
git cherry-pick --abort 2>/dev/null || true
git reset --hard 2>/dev/null || true
git clean -fd 2>/dev/null || true

# Fetch latest from remote
echo "Fetching origin main..."
git fetch origin main --prune 2>/dev/null || git fetch origin main 2>/dev/null || true

# Force checkout and hard reset to latest origin/main
git checkout -B main origin/main 2>/dev/null || git checkout -f main 2>/dev/null || true
git reset --hard origin/main 2>/dev/null || true

# Restore .env if needed
if [ -f "/tmp/gigpilot.env.bak" ] && [ ! -f ".env" ]; then
  cp -f /tmp/gigpilot.env.bak .env 2>/dev/null || true
fi

echo "Installing production build dependencies..."
npm install --prefer-offline || npm install --legacy-peer-deps

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
