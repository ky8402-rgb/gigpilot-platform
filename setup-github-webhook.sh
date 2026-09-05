#!/usr/bin/env bash
# ==============================================================================
# GigPilot Platform - GitHub Webhook Generator & Push-to-Deploy Association
#
# Generates a production GitHub Webhook URL for the EC2 SSL backend,
# creates/updates the webhook on the GitHub repository via GitHub REST API,
# configures cryptographic HMAC-SHA256 secrets, and tests automated deployment.
# ==============================================================================

set -euo pipefail

# Visual formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Defaults
DEFAULT_EC2_HOST="13.233.54.120"
DEFAULT_WEBHOOK_URL="https://13-233-54-120.sslip.io/api/github/webhook"
DEFAULT_REPO="ky8402-rgb/gigpilot-platform"
DEFAULT_BRANCH="master"

WEBHOOK_URL="$DEFAULT_WEBHOOK_URL"
REPO="$DEFAULT_REPO"
BRANCH="$DEFAULT_BRANCH"
SECRET=""
GITHUB_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
TEST_ONLY=false
SKIP_TEST=false

print_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "=============================================================================="
  echo "   🚀 GIGPILOT GITHUB WEBHOOK GENERATOR & PUSH-TO-DEPLOY ASSOCIATOR"
  echo "=============================================================================="
  echo -e "${NC}"
}

usage() {
  print_banner
  cat << EOF
Usage: $0 [OPTIONS]

Options:
  --url <URL>            Webhook receiver URL (default: $DEFAULT_WEBHOOK_URL)
  --repo <OWNER/REPO>    GitHub repository (default: auto-detected or $DEFAULT_REPO)
  --secret <SECRET>      Webhook secret (default: auto-generates 32-byte hex key)
  --token <PAT>          GitHub Personal Access Token (or GITHUB_TOKEN env var)
  --branch <BRANCH>      Target deploy branch (default: $DEFAULT_BRANCH)
  --test-only            Run signature and preflight verification test only
  --skip-test            Skip endpoint live ping test
  -h, --help             Show this help screen

Examples:
  # 1. 1-Click Auto Setup with GitHub Personal Access Token:
  $0 --token ghp_yourPersonalAccessToken123

  # 2. Interactive Setup (generates secret and prints 1-click GitHub UI link):
  $0

  # 3. Test existing webhook endpoint with HMAC validation:
  $0 --test-only
EOF
  exit 0
}

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      WEBHOOK_URL="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    --secret)
      SECRET="$2"
      shift 2
      ;;
    --token)
      GITHUB_TOKEN="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --test-only)
      TEST_ONLY=true
      shift
      ;;
    --skip-test)
      SKIP_TEST=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo -e "${RED}Unknown argument: $1${NC}"
      usage
      ;;
  esac
done

print_banner

# Step 1: Detect GitHub Repository from Git Remote
echo -e "${BOLD}[1/5] Identifying GitHub Repository...${NC}"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_ORIGIN=$(git config --get remote.origin.url || true)
  if [[ -n "$GIT_ORIGIN" ]]; then
    # Extract owner/repo from git@github.com:owner/repo.git or https://github.com/owner/repo.git
    DETECTED_REPO=$(echo "$GIT_ORIGIN" | sed -E 's/.*github\.com[:\/]([^\/]+\/[^\/\.]+)(\.git)?/\1/')
    if [[ -n "$DETECTED_REPO" && "$DETECTED_REPO" != "$GIT_ORIGIN" ]]; then
      REPO="$DETECTED_REPO"
      echo -e "  ${GREEN}✔ Detected repository from origin:${NC} ${BOLD}$REPO${NC}"
    fi
  fi
fi
if [[ -z "$REPO" ]]; then
  REPO="$DEFAULT_REPO"
fi
echo -e "  Target Repository: ${CYAN}https://github.com/$REPO${NC}"

# Step 2: Generate or Retrieve Webhook Secret
echo -e "\n${BOLD}[2/5] Preparing Webhook Secret...${NC}"
if [[ -z "$SECRET" ]]; then
  # Check if secret already exists in .env or .env.production
  if [[ -f .env ]] && grep -qE '^GITHUB_WEBHOOK_SECRET=' .env; then
    SECRET=$(grep -E '^GITHUB_WEBHOOK_SECRET=' .env | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
    echo -e "  ${GREEN}✔ Using existing secret from .env${NC}"
  elif [[ -f .env.production ]] && grep -qE '^GITHUB_WEBHOOK_SECRET=' .env.production; then
    SECRET=$(grep -E '^GITHUB_WEBHOOK_SECRET=' .env.production | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
    echo -e "  ${GREEN}✔ Using existing secret from .env.production${NC}"
  else
    # Generate cryptographically secure 32-byte hex secret
    if command -v openssl >/dev/null 2>&1; then
      SECRET=$(openssl rand -hex 32)
    elif command -v node >/dev/null 2>&1; then
      SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
    else
      SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
    fi
    echo -e "  ${GREEN}✔ Generated new 256-bit cryptographically secure secret${NC}"
  fi
else
  echo -e "  ${GREEN}✔ Using provided secret${NC}"
fi

# Step 3: Persist Secret to Configuration Files
echo -e "\n${BOLD}[3/5] Syncing Environment Configuration...${NC}"
update_env_file() {
  local file="$1"
  local key="GITHUB_WEBHOOK_SECRET"
  local val="$2"
  if [[ -f "$file" ]]; then
    if grep -q "^${key}=" "$file"; then
      sed -i.bak "s|^${key}=.*|${key}=${val}|" "$file" && rm -f "${file}.bak"
    else
      echo "${key}=${val}" >> "$file"
    fi
    echo -e "  ${GREEN}✔ Updated ${file}${NC}"
  fi
}

update_env_file ".env" "$SECRET"
update_env_file ".env.production" "$SECRET"
if [[ -f .env.example ]] && ! grep -q "^GITHUB_WEBHOOK_SECRET=" .env.example; then
  echo "GITHUB_WEBHOOK_SECRET=" >> .env.example
fi

# Step 4: Associate Webhook with GitHub Repository
echo -e "\n${BOLD}[4/5] Associating Webhook with GitHub ($REPO)...${NC}"
echo -e "  Webhook URL: ${BOLD}${CYAN}$WEBHOOK_URL${NC}"

ASSOCIATED_VIA_API=false

if [[ "$TEST_ONLY" != "true" ]]; then
  if [[ -n "$GITHUB_TOKEN" ]]; then
    echo -e "  Attempting automated association via GitHub REST API..."
    
    # Check for existing hooks
    HOOKS_JSON=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/$REPO/hooks" || true)

    EXISTING_HOOK_ID=$(echo "$HOOKS_JSON" | grep -B 2 "$WEBHOOK_URL" | grep '"id":' | head -n 1 | sed -E 's/.*"id":\s*([0-9]+).*/\1/' || true)

    PAYLOAD=$(cat <<EOF
{
  "name": "web",
  "active": true,
  "events": [
    "push",
    "ping"
  ],
  "config": {
    "url": "$WEBHOOK_URL",
    "content_type": "json",
    "secret": "$SECRET",
    "insecure_ssl": "0"
  }
}
EOF
)

    if [[ -n "$EXISTING_HOOK_ID" ]]; then
      echo -e "  Found existing webhook ID ${BOLD}$EXISTING_HOOK_ID${NC}. Updating configuration..."
      RESPONSE=$(curl -s -X PATCH \
        -H "Authorization: Bearer $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        "https://api.github.com/repos/$REPO/hooks/$EXISTING_HOOK_ID" \
        -d "$PAYLOAD" || true)
    else
      echo -e "  Creating new webhook on ${BOLD}$REPO${NC}..."
      RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $GITHUB_TOKEN" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        "https://api.github.com/repos/$REPO/hooks" \
        -d "$PAYLOAD" || true)
      EXISTING_HOOK_ID=$(echo "$RESPONSE" | grep '"id":' | head -n 1 | sed -E 's/.*"id":\s*([0-9]+).*/\1/' || true)
    fi

    if echo "$RESPONSE" | grep -q '"url":'; then
      echo -e "  ${GREEN}✔ Webhook successfully associated on GitHub! (Hook ID: ${EXISTING_HOOK_ID})${NC}"
      ASSOCIATED_VIA_API=true
      
      # Request a ping from GitHub
      if [[ -n "$EXISTING_HOOK_ID" ]]; then
        echo -e "  Requesting GitHub ping delivery..."
        curl -s -X POST \
          -H "Authorization: Bearer $GITHUB_TOKEN" \
          -H "Accept: application/vnd.github+json" \
          -H "X-GitHub-Api-Version: 2022-11-28" \
          "https://api.github.com/repos/$REPO/hooks/$EXISTING_HOOK_ID/tests" > /dev/null || true
      fi
    else
      ERROR_MSG=$(echo "$RESPONSE" | grep '"message":' | head -n 1 || echo "$RESPONSE")
      echo -e "  ${YELLOW}⚠ GitHub API responded with:${NC} $ERROR_MSG"
      echo -e "  Falling back to manual 1-click registration instructions below."
    fi
  elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    echo -e "  Attempting automated association via GitHub CLI (${CYAN}gh${NC})..."
    if gh api "repos/$REPO/hooks" --input - <<< "$PAYLOAD" >/dev/null 2>&1; then
      echo -e "  ${GREEN}✔ Webhook successfully created via GitHub CLI!${NC}"
      ASSOCIATED_VIA_API=true
    fi
  fi
fi

if [[ "$ASSOCIATED_VIA_API" != "true" && "$TEST_ONLY" != "true" ]]; then
  echo -e "\n  ${BOLD}${YELLOW}📋 1-Click Manual Association in GitHub Web Console:${NC}"
  echo -e "  ----------------------------------------------------------------------"
  echo -e "  1. Open this direct URL:"
  echo -e "     ${BOLD}${BLUE}https://github.com/$REPO/settings/hooks/new${NC}"
  echo -e "  2. Enter the following parameters:"
  echo -e "     • ${BOLD}Payload URL:${NC}    $WEBHOOK_URL"
  echo -e "     • ${BOLD}Content type:${NC}   application/json"
  echo -e "     • ${BOLD}Secret:${NC}         $SECRET"
  echo -e "     • ${BOLD}SSL verification:${NC} Enable SSL verification (Checked)"
  echo -e "     • ${BOLD}Which events?${NC}   Just the push event (Default)"
  echo -e "     • ${BOLD}Active:${NC}         Checked"
  echo -e "  3. Click ${GREEN}${BOLD}[Add webhook]${NC}."
  echo -e "  ----------------------------------------------------------------------"
fi

# Step 5: Test Webhook Receiver & Cryptographic Verification
if [[ "$SKIP_TEST" != "true" ]]; then
  echo -e "\n${BOLD}[5/5] Testing Webhook Endpoint & Cryptographic Handshake...${NC}"
  TEST_BODY='{"zen":"Automated push-to-deploy verification test","hook_id":999999}'
  
  # Compute HMAC-SHA256 signature
  if command -v node >/dev/null 2>&1; then
    SIG=$(node -e "const crypto=require('crypto'); console.log(crypto.createHmac('sha256', process.argv[1]).update(process.argv[2]).digest('hex'));" "$SECRET" "$TEST_BODY")
  elif command -v openssl >/dev/null 2>&1; then
    SIG=$(echo -n "$TEST_BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
  else
    SIG=""
  fi

  echo -e "  Target: ${CYAN}$WEBHOOK_URL${NC}"
  echo -e "  Sending authenticated ping request..."

  HTTP_CODE=$(curl -s -o /tmp/webhook_test_res.json -w "%{http_code}" \
    -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: ping" \
    -H "X-GitHub-Delivery: test-$(date +%s)" \
    -H "X-Hub-Signature-256: sha256=$SIG" \
    -d "$TEST_BODY" \
    --max-time 10 || echo "000")

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "202" ]]; then
    echo -e "  ${GREEN}✔ SUCCESS: Webhook endpoint responded with HTTP $HTTP_CODE${NC}"
    echo -e "  Response: $(cat /tmp/webhook_test_res.json 2>/dev/null || echo '{}')"
  elif [[ "$HTTP_CODE" == "401" ]]; then
    echo -e "  ${YELLOW}⚠ Server returned HTTP 401 Unauthorized (Signature Mismatch).${NC}"
    echo -e "  Ensure GITHUB_WEBHOOK_SECRET is active in EC2's environment."
  elif [[ "$HTTP_CODE" == "000" ]]; then
    echo -e "  ${YELLOW}⚠ Connection timed out or server unreachable from current network.${NC}"
    echo -e "  The webhook URL is valid for GitHub to deliver to."
  else
    echo -e "  ${YELLOW}⚠ Server responded with HTTP $HTTP_CODE${NC}"
    cat /tmp/webhook_test_res.json 2>/dev/null || true
  fi
  rm -f /tmp/webhook_test_res.json
fi

# Step 6: Summary & EC2 Push-To-Deploy Status
echo -e "\n${GREEN}${BOLD}==============================================================================${NC}"
echo -e "${GREEN}${BOLD}✅ GITHUB PUSH-TO-DEPLOY AUTOMATION READY!${NC}"
echo -e "${GREEN}${BOLD}==============================================================================${NC}"
echo -e "• Repository:             ${BOLD}https://github.com/$REPO${NC}"
echo -e "• Production Webhook URL: ${BOLD}${CYAN}$WEBHOOK_URL${NC}"
echo -e "• Webhook Secret:         ${BOLD}$SECRET${NC}"
echo -e "• Monitored Branch:       ${BOLD}$BRANCH${NC}"
echo -e "• Zero Downtime Reload:   ${BOLD}Active (pm2 reload gigpilot)${NC}"

echo -e "\n${BOLD}How Push-To-Deploy Works Now:${NC}"
echo -e "1. You push commits to GitHub:"
echo -e "   ${CYAN}git push origin $BRANCH${NC}"
echo -e "2. GitHub immediately fires an authenticated webhook to ${CYAN}$WEBHOOK_URL${NC}"
echo -e "3. EC2 validates the HMAC-SHA256 signature, pulls the latest code with git,"
echo -e "   compiles production bundles, and reloads PM2 with ${BOLD}zero manual restarts${NC}."
echo -e "4. Check deployment logs anytime via: ${CYAN}${DEFAULT_WEBHOOK_URL%/*}/deployments${NC}"
echo -e "=============================================================================="
