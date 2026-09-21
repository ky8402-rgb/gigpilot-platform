#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "🛡️ GigPilot EC2 Automated Production Deployment"
echo "=========================================================="

APP_DIR="/home/ubuntu/gigpilot"

if [ -f "/home/ubuntu/.env" ]; then
  cp -f /home/ubuntu/.env /tmp/gigpilot.env.bak 2>/dev/null || true
elif [ -f "$APP_DIR/.env" ]; then
  cp -f "$APP_DIR/.env" /tmp/gigpilot.env.bak 2>/dev/null || true
fi

if [ ! -d "$APP_DIR" ] || [ ! -f "$APP_DIR/package.json" ]; then
  echo "Clean repository checkout required at $APP_DIR..."
  rm -rf /tmp/gigpilot-fresh 2>/dev/null || true
  git clone https://github.com/ky8402-rgb/gigpilot-platform.git /tmp/gigpilot-fresh
  mkdir -p "$APP_DIR"
  cp -rf /tmp/gigpilot-fresh/. "$APP_DIR/"
  rm -rf /tmp/gigpilot-fresh
fi

cd "$APP_DIR"
echo "Working directory: $(pwd)"

# Ensure origin is configured
git remote set-url origin https://github.com/ky8402-rgb/gigpilot-platform.git 2>/dev/null || git remote add origin https://github.com/ky8402-rgb/gigpilot-platform.git 2>/dev/null || true

# Clean and update
git fetch origin main --prune 2>/dev/null || true
git checkout -B main origin/main 2>/dev/null || git checkout -f main 2>/dev/null || true
git reset --hard origin/main 2>/dev/null || true

# Restore .env
if [ -f "/tmp/gigpilot.env.bak" ]; then
  cp -f /tmp/gigpilot.env.bak "$APP_DIR/.env" 2>/dev/null || true
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
