#!/usr/bin/env bash
# GigPilot EC2 rollback. Pins the host back to a known-good commit and restarts the backend.
#
# Invoked over SSH by .github/workflows/deploy.yml (rollback-on-failure job) after a deploy passed
# delivery but failed live verification, and usable manually:
#   TARGET_SHA=<40-char-sha> bash scripts/rollback-ec2.sh
#
# The host is left in a detached HEAD at TARGET_SHA. That is deliberate: the next deployment runs
# `git checkout -B main origin/main`, which re-attaches main, so a rollback cannot wedge future
# deploys.
set -e

echo "=========================================================="
echo "🚑 GigPilot EC2 Automated Rollback"
echo "=========================================================="

APP_DIR="/home/ubuntu/gigpilot"
TARGET_SHA="${TARGET_SHA:-}"

if [ -z "$TARGET_SHA" ]; then
  echo "ERROR: TARGET_SHA is required (the last known-good commit)."
  exit 1
fi

case "$TARGET_SHA" in
  *[!0-9a-fA-F]*|"") echo "ERROR: TARGET_SHA must be a hexadecimal git object name."; exit 1 ;;
esac

REPO_URL="https://github.com/ky8402-rgb/gigpilot-platform.git"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/ky8402-rgb/gigpilot-platform.git"
elif [ -n "${GH_TOKEN:-}" ]; then
  REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/ky8402-rgb/gigpilot-platform.git"
fi

cd "$APP_DIR"
echo "Working directory: $(pwd)"

git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL" 2>/dev/null || true
git fetch origin --prune

# Verify the target actually exists locally before touching the working tree.
git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null || {
  echo "ERROR: Commit $TARGET_SHA is not present on this host after fetch. Aborting rollback."
  exit 1
}

git checkout -f "$TARGET_SHA"
git reset --hard "$TARGET_SHA"

# Health verification reads this file to prove the live process matches the rolled-back revision.
DEPLOYED_COMMIT="$(git rev-parse HEAD)"
mkdir -p "$APP_DIR/.gigpilot-data"
printf '%s\n' "$DEPLOYED_COMMIT" > "$APP_DIR/.gigpilot-data/deployed-commit.txt"
chmod 600 "$APP_DIR/.gigpilot-data/deployed-commit.txt"
echo "Rollback target recorded: $DEPLOYED_COMMIT"

echo "Installing production build dependencies..."
npm install --prefer-offline || npm install --legacy-peer-deps

echo "Building application bundles (Vite + esbuild)..."
npm run build

echo "Restarting PM2 backend daemon..."
pm2 delete gigpilot 2>/dev/null || true
if [ -f "ecosystem.config.cjs" ]; then
  pm2 start ecosystem.config.cjs --env production
else
  NODE_ENV=production PORT=3000 pm2 start dist/server.cjs --name gigpilot --time --max-memory-restart 500M
fi
pm2 save

echo "Waiting for the rolled-back process to initialize on port 3000..."
sleep 3

if curl -sS -m 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
  echo "✔ Local health check passed after rollback."
else
  echo "WARNING: local health check did not answer after rollback."
fi

sudo systemctl reload nginx 2>/dev/null || sudo systemctl restart nginx 2>/dev/null || true

echo "=========================================================="
echo "✔ Rollback complete. Host is running $DEPLOYED_COMMIT"
echo "=========================================================="
