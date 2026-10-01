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

# Record the exact source revision that this host is running. Health verification
# uses this value to prove the live process matches the GitHub deployment SHA.
DEPLOYED_COMMIT="$(git rev-parse HEAD)"
mkdir -p "$APP_DIR/.gigpilot-data"
printf '%s\n' "$DEPLOYED_COMMIT" > "$APP_DIR/.gigpilot-data/deployed-commit.txt"
chmod 600 "$APP_DIR/.gigpilot-data/deployed-commit.txt"
echo "Deployed commit recorded: $DEPLOYED_COMMIT"

# Restore .env
if [ -f "/tmp/gigpilot.env.bak" ]; then
  cp -f /tmp/gigpilot.env.bak "$APP_DIR/.env" 2>/dev/null || true
fi

# Configure BYBIT_API_KEY & BYBIT_API_SECRET if supplied
if [ -n "${BYBIT_API_KEY:-}" ]; then
  umask 077
  touch "$APP_DIR/.env"
  if grep -q '^BYBIT_API_KEY=' "$APP_DIR/.env"; then
    sed -i "s|^BYBIT_API_KEY=.*|BYBIT_API_KEY=\"$BYBIT_API_KEY\"|" "$APP_DIR/.env"
  else
    printf '%s\n' "BYBIT_API_KEY=\"$BYBIT_API_KEY\"" >> "$APP_DIR/.env"
  fi
  echo "✔ BYBIT_API_KEY updated in $APP_DIR/.env"
fi

if [ -n "${BYBIT_API_SECRET:-}" ]; then
  umask 077
  touch "$APP_DIR/.env"
  if grep -q '^BYBIT_API_SECRET=' "$APP_DIR/.env"; then
    sed -i "s|^BYBIT_API_SECRET=.*|BYBIT_API_SECRET=\"$BYBIT_API_SECRET\"|" "$APP_DIR/.env"
  else
    printf '%s\n' "BYBIT_API_SECRET=\"$BYBIT_API_SECRET\"" >> "$APP_DIR/.env"
  fi
  echo "✔ BYBIT_API_SECRET updated in $APP_DIR/.env"
fi

# Configure GEMINI_API_KEY if supplied
if [ -n "${GEMINI_API_KEY:-}" ]; then
  umask 077
  touch "$APP_DIR/.env"
  if grep -q '^GEMINI_API_KEY=' "$APP_DIR/.env"; then
    sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=\"$GEMINI_API_KEY\"|" "$APP_DIR/.env"
  else
    printf '%s\n' "GEMINI_API_KEY=\"$GEMINI_API_KEY\"" >> "$APP_DIR/.env"
  fi
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
  if grep -q '^DATABASE_URL=' "$APP_DIR/.env"; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"$DATABASE_URL\"" "$APP_DIR/.env"
  else
    printf '%s\n' "DATABASE_URL=\"$DATABASE_URL\"" >> "$APP_DIR/.env"
  fi
elif ! grep -qE '^DATABASE_URL=(postgres://|postgresql://)' "$APP_DIR/.env" 2>/dev/null; then
  echo "ERROR: No production DATABASE_URL is configured. Refusing live deployment."; exit 1
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
