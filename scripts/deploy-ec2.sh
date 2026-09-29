#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "🛡️ GigPilot EC2 Automated Production Deployment"
echo "=========================================================="

APP_DIR="/home/ubuntu/gigpilot"
ENV_FILE="$APP_DIR/.env"
WRITER="$APP_DIR/scripts/write-env-secret.cjs"

# Where credentials come from. `ssm` is the authoritative source: the values are read on THIS
# host with its own IAM instance role, so no secret is ever carried across an SSH command
# string, a shell argument list, or the GitHub Actions log.
#
#   SECRETS_SOURCE=ssm  (default) read from AWS SSM Parameter Store
#   SECRETS_SOURCE=env            use values already present in the environment (legacy, and a
#                                 deliberate opt-in rather than a silent fallback)
SECRETS_SOURCE="${SECRETS_SOURCE:-ssm}"
SSM_PREFIX="${SSM_PREFIX:-/gigpilot/prod}"
SSM_REGION="${AWS_REGION:-ap-south-1}"

# Bybit keys are IP-restricted. Verify the address the exchange will actually see, so a key
# bound to the wrong address is caught here rather than at the first order.
EXPECTED_OUTBOUND_IP="${EXPECTED_OUTBOUND_IP:-35.154.110.156}"

# Check for GitHub token for authenticated git access
REPO_URL="https://github.com/ky8402-rgb/gigpilot-platform.git"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/ky8402-rgb/gigpilot-platform.git"
elif [ -n "${GH_TOKEN:-}" ]; then
  REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/ky8402-rgb/gigpilot-platform.git"
fi

if [ -f "/home/ubuntu/.env" ]; then
  cp -f /home/ubuntu/.env /tmp/gigpilot.env.bak 2>/dev/null || true
elif [ -f "$ENV_FILE" ]; then
  cp -f "$ENV_FILE" /tmp/gigpilot.env.bak 2>/dev/null || true
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
  cp -f /tmp/gigpilot.env.bak "$ENV_FILE" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Credentials
#
# Every write goes through scripts/write-env-secret.cjs. The previous implementation used
#   sed -i "s|^BYBIT_API_SECRET=.*|...|" .env
# which is a shell-injection bug keyed on the secret's own contents: `|` broke the expression
# ("unterminated `s' command" — the production failure that prompted this), `&` silently
# expanded to the whole matched line and wrote the OLD secret back into the new value, and a
# backslash or quote mangled the result. None of that can happen now: the value is opaque,
# never parsed by a shell or the regex engine.
#
# A failure here aborts before `npm install`/`build` and before PM2 is touched, so the host
# keeps serving the previous release instead of being left half-updated.
# ---------------------------------------------------------------------------
umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true

if [ ! -f "$WRITER" ]; then
  echo "ERROR: $WRITER is missing — cannot write credentials safely. Refusing to deploy."
  exit 1
fi

set_secret() {
  # $1 = parameter/env name, $2 = value
  printf '%s' "$2" | node "$WRITER" "$1" --file "$ENV_FILE"
}

fetch_ssm_secret() {
  # Echoes the parameter value, or nothing when unavailable. Never fails the shell.
  local name="$1" value=""
  if command -v aws >/dev/null 2>&1; then
    value="$(aws ssm get-parameter \
      --name "${SSM_PREFIX}/${name}" \
      --with-decryption \
      --region "$SSM_REGION" \
      --query 'Parameter.Value' \
      --output text 2>/dev/null || true)"
    if [ "$value" = "None" ]; then value=""; fi
  fi
  printf '%s' "$value"
}

resolve_secret() {
  # $1 = name. Echoes the resolved value, preferring the authoritative source.
  local name="$1"
  if [ "$SECRETS_SOURCE" = "env" ]; then
    printf '%s' "$(printenv "$name" 2>/dev/null || true)"
  else
    fetch_ssm_secret "$name"
  fi
}

echo "Resolving credentials (source: $SECRETS_SOURCE${SECRETS_SOURCE:+", prefix: $SSM_PREFIX" })..."

# DATABASE_URL is mandatory: live persistence without it is not a supported state.
DATABASE_URL_RESOLVED="$(resolve_secret DATABASE_URL)"
if [ -z "$DATABASE_URL_RESOLVED" ] && [ -n "${DATABASE_URL:-}" ] && [ "$SECRETS_SOURCE" = "ssm" ]; then
  echo "  Notice: SSM had no DATABASE_URL; using the value supplied by the pipeline."
  DATABASE_URL_RESOLVED="$DATABASE_URL"
fi
case "$DATABASE_URL_RESOLVED" in
  postgres://*|postgresql://*) ;;
  *) echo "ERROR: DATABASE_URL is not a PostgreSQL URL (source: $SECRETS_SOURCE)."
     echo "       Create it with: aws ssm put-parameter --name ${SSM_PREFIX}/DATABASE_URL --type SecureString --value 'postgres://...'"
     exit 1 ;;
esac
set_secret DATABASE_URL "$DATABASE_URL_RESOLVED"

# Exchange and research keys are best-effort: the service boots without them and reports the
# gap itself, so a missing one is a loud warning rather than a failed deploy.
for NAME in BYBIT_API_KEY BYBIT_API_SECRET GEMINI_API_KEY; do
  VALUE="$(resolve_secret "$NAME")"
  if [ -z "$VALUE" ]; then
    if [ "$SECRETS_SOURCE" = "ssm" ] && [ -n "$(printenv "$NAME" 2>/dev/null || true)" ]; then
      VALUE="$(printenv "$NAME")"
      echo "  Notice: SSM had no $NAME; using the value supplied by the pipeline."
    fi
  fi
  if [ -z "$VALUE" ]; then
    echo "  WARNING: $NAME is not available. Expected it at SSM ${SSM_PREFIX}/${NAME}."
    echo "           Create it with: aws ssm put-parameter --name ${SSM_PREFIX}/${NAME} --type SecureString --value '<value>'"
  else
    set_secret "$NAME" "$VALUE"
  fi
  unset VALUE
done
unset DATABASE_URL_RESOLVED

# Refuse to run with a credential that is known to be revoked or compromised. The list holds
# SHA-256 fingerprints, never the secrets themselves, so it is safe to keep in the repository.
if [ -f "$APP_DIR/security/revoked-credential-fingerprints.txt" ]; then
  echo "Checking credentials against the revoked-fingerprint list..."
  node "$APP_DIR/scripts/check-revoked-credentials.cjs" --env "$ENV_FILE" --list "$APP_DIR/security/revoked-credential-fingerprints.txt"
fi

# IP binding: warn (do not fail) if the address Bybit sees is not the allowlisted one. Failing
# hard here could block a legitimate deploy for a NAT/egress change that the operator has
# already allowlisted, but silence would hide a key that cannot authenticate at all.
OBSERVED_IP="$(curl -sS -m 8 https://api.ipify.org 2>/dev/null || true)"
if [ -n "$OBSERVED_IP" ]; then
  if [ "$OBSERVED_IP" = "$EXPECTED_OUTBOUND_IP" ]; then
    echo "✔ Outbound IP matches the Bybit allowlist address ($OBSERVED_IP)."
  else
    echo "  WARNING: outbound IP $OBSERVED_IP differs from the expected bound address $EXPECTED_OUTBOUND_IP."
    echo "           Authenticated Bybit calls will be rejected unless $OBSERVED_IP is allowlisted."
  fi
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

echo "Waiting for the backend to become healthy on port 3000..."
HEALTH_OK=0
for _ in $(seq 1 12); do
  if curl -sS -m 5 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 5
done

# This used to print "Notice: Service starting up or warming cache." and then reload nginx and
# declare success — so a release that never came up reported a green deployment. A failed
# health check must fail the deployment.
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "ERROR: backend did not become healthy after deployment. Refusing to declare success."
  pm2 logs gigpilot --lines 40 --nostream 2>/dev/null || true
  exit 1
fi
echo "✔ Local health check passed (http://127.0.0.1:3000/api/health)"

# Prove the process that answers is the revision we just checked out, not a stale one.
LIVE_COMMIT="$(curl -sS -m 5 http://127.0.0.1:3000/api/health 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).deployedCommit||""))}catch{process.stdout.write("")}})' \
  || true)"
if [ -z "$LIVE_COMMIT" ]; then
  echo "  WARNING: the health payload did not report a deployedCommit, so the running revision could not be confirmed."
elif [ "$LIVE_COMMIT" != "$DEPLOYED_COMMIT" ]; then
  echo "ERROR: live process reports $LIVE_COMMIT but $DEPLOYED_COMMIT was checked out. Refusing to declare success."
  exit 1
else
  echo "✔ Live process reports the deployed revision ($LIVE_COMMIT)."
fi

echo "Reloading Nginx reverse proxy..."
sudo systemctl reload nginx 2>/dev/null || sudo systemctl restart nginx 2>/dev/null || true

echo "=========================================================="
echo "✔ EC2 backend successfully deployed and running."
echo "=========================================================="
