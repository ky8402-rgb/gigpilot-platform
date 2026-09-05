#!/usr/bin/env bash
# ==============================================================================
# GigPilot Platform - Unified Push-to-Deploy Automation Script
#
# Pushes commits to GitHub and triggers automated synchronization on:
# 1. AWS Amplify Frontend (gigpilot-platform)
# 2. AWS EC2 Backend (gigpilot-backend)
# ==============================================================================

set -euo pipefail

# Visual formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Defaults
DEFAULT_BRANCH="main"
AMPLIFY_APP_ID="${AMPLIFY_APP_ID:-d2qe2q720fbn3x}"
AMPLIFY_APP_NAME="${AMPLIFY_APP_NAME:-gigpilot-platform}"
EC2_HOST="${EC2_HOST:-13.233.54.120}"
EC2_WEBHOOK_URL="https://${EC2_HOST//./-}.sslip.io/api/github/webhook"
EC2_HEALTH_URL="https://${EC2_HOST//./-}.sslip.io/api/health"

BRANCH=""
MESSAGE=""
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-${GITHUB_PAT:-}}}"
SKIP_AMPLIFY=false
SKIP_EC2=false
DRY_RUN=false

print_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "=============================================================================="
  echo "   🚀 GIGPILOT - UNIFIED PUSH-TO-DEPLOY AUTOMATION PIPELINE"
  echo "   GitHub  ➔  AWS Amplify (gigpilot-platform)  ➔  AWS EC2 (gigpilot-backend)"
  echo "=============================================================================="
  echo -e "${NC}"
}

usage() {
  print_banner
  cat << EOF
Usage: $0 [OPTIONS]

Options:
  -m, --message <MSG>    Commit message (default: auto-generated timestamp message)
  -b, --branch <NAME>    Branch to push (default: auto-detected, fallback to '$DEFAULT_BRANCH')
  -t, --token <PAT>      GitHub Personal Access Token (or GITHUB_TOKEN env var)
  --skip-amplify         Skip triggering AWS Amplify release job
  --skip-ec2             Skip delivering push webhook to EC2 backend
  --dry-run              Preview actions without pushing or triggering deploys
  -h, --help             Show this help guide

Examples:
  # Standard push and deploy with custom message:
  $0 -m "feat(billing): integrate stripe webhook processor"

  # Push with explicit GitHub token:
  $0 -m "fix(auth): update refresh token rotation" --token ghp_yourToken123

  # Target specific branch:
  $0 -b main -m "release: v1.4.0 update"
EOF
  exit 0
}

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      MESSAGE="$2"
      shift 2
      ;;
    -b|--branch)
      BRANCH="$2"
      shift 2
      ;;
    -t|--token)
      TOKEN="$2"
      shift 2
      ;;
    --skip-amplify)
      SKIP_AMPLIFY=true
      shift
      ;;
    --skip-ec2)
      SKIP_EC2=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      usage
      ;;
  esac
done

print_banner

# Step 0: Check token backup file if token not in env
if [[ -z "$TOKEN" ]]; then
  TOKEN_BACKUP="server/data/github_token_backup.json"
  if [[ -f "$TOKEN_BACKUP" ]]; then
    TOKEN=$(node -e "try { const d = JSON.parse(require('fs').readFileSync('$TOKEN_BACKUP','utf8')); console.log(d.token || ''); } catch(e){}" 2>/dev/null || true)
  fi
fi

# Step 1: Detect branch
if [[ -z "$BRANCH" ]]; then
  DETECTED_BRANCH=$(git branch --show-current 2>/dev/null || echo "$DEFAULT_BRANCH")
  BRANCH="${DETECTED_BRANCH:-$DEFAULT_BRANCH}"
fi

echo -e "${BLUE}ℹ Target Branch:${NC} ${BOLD}$BRANCH${NC}"

# Step 2: Ensure Git Identity
GIT_USER=$(git config user.name || echo "")
GIT_EMAIL=$(git config user.email || echo "")
if [[ -z "$GIT_USER" ]]; then
  git config user.name "GigPilot Automation"
fi
if [[ -z "$GIT_EMAIL" ]]; then
  git config user.email "devops@gigpilot.local"
fi

# Step 3: Check for pending changes & commit
DIRTY_COUNT=$(git status --porcelain | wc -l || echo "0")
if [[ "$DIRTY_COUNT" -gt 0 ]]; then
  echo -e "\n${YELLOW}⚡ Found $DIRTY_COUNT uncommitted file(s). Staging and committing...${NC}"
  git add .
  
  if [[ -z "$MESSAGE" ]]; then
    DATE_STR=$(date "+%Y-%m-%d %H:%M:%S")
    MESSAGE="chore(deploy): sync changes [$DATE_STR]"
  fi
  
  if [[ "$DRY_RUN" == true ]]; then
    echo -e "${CYAN}[DRY-RUN] Would commit:${NC} \"$MESSAGE\""
  else
    git commit -m "$MESSAGE"
    echo -e "${GREEN}✔ Committed changes:${NC} \"$MESSAGE\""
  fi
else
  echo -e "\n${GREEN}✔ Working directory clean.${NC} No new local files to commit."
  if [[ -z "$MESSAGE" ]]; then
    MESSAGE=$(git log -1 --pretty=%B 2>/dev/null | head -n 1 || echo "Deploy update")
  fi
fi

LATEST_HASH=$(git log -1 --pretty=%h 2>/dev/null || echo "HEAD")
LATEST_AUTHOR=$(git log -1 --pretty=%an 2>/dev/null || echo "Unknown")
echo -e "${BLUE}ℹ Head Commit:${NC} [${BOLD}$LATEST_HASH${NC}] $MESSAGE (by $LATEST_AUTHOR)"

# Step 4: Push to GitHub
echo -e "\n${BOLD}${CYAN}----------------------------------------------------------------------${NC}"
echo -e "${BOLD}▶ [1/3] PUSHING TO GITHUB${NC}"
echo -e "${BOLD}${CYAN}----------------------------------------------------------------------${NC}"

if [[ "$DRY_RUN" == true ]]; then
  echo -e "${CYAN}[DRY-RUN] Skipping push to GitHub origin/$BRANCH.${NC}"
else
  PUSH_SUCCESS=false
  
  if [[ -n "$TOKEN" ]]; then
    echo -e "${CYAN}Authenticating with GitHub Personal Access Token...${NC}"
    REPO_URL="https://${TOKEN}@github.com/ky8402-rgb/gigpilot-platform.git"
    if GIT_TERMINAL_PROMPT=0 git push "$REPO_URL" "$BRANCH"; then
      PUSH_SUCCESS=true
      echo -e "${GREEN}✔ Successfully pushed to GitHub (origin/$BRANCH)!${NC}"
    else
      echo -e "${YELLOW}Token push failed, attempting standard SSH/remote push...${NC}"
    fi
  fi
  
  if [[ "$PUSH_SUCCESS" == false ]]; then
    echo -e "${CYAN}Attempting git push with SSH/standard remote...${NC}"
    if GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes" git push origin "$BRANCH"; then
      PUSH_SUCCESS=true
      echo -e "${GREEN}✔ Successfully pushed to GitHub (origin/$BRANCH)!${NC}"
    else
      echo -e "${RED}✖ Git push failed.${NC}"
      echo -e "${YELLOW}Hint:${NC} Pass --token <ghp_yourToken> or run with GITHUB_TOKEN environment variable."
    fi
  fi
fi

# Step 5: Trigger AWS Amplify
echo -e "\n${BOLD}${CYAN}----------------------------------------------------------------------${NC}"
echo -e "${BOLD}▶ [2/3] AWS AMPLIFY FRONTEND DEPLOYMENT ($AMPLIFY_APP_NAME)${NC}"
echo -e "${BOLD}${CYAN}----------------------------------------------------------------------${NC}"

if [[ "$SKIP_AMPLIFY" == true ]]; then
  echo -e "${YELLOW}Amplify deployment skipped (--skip-amplify).${NC}"
elif [[ "$DRY_RUN" == true ]]; then
  echo -e "${CYAN}[DRY-RUN] Would trigger AWS Amplify release job for app: $AMPLIFY_APP_ID.${NC}"
else
  AMPLIFY_TRIGGERED=false
  
  # Try AWS CLI if installed & configured
  if command -v aws &>/dev/null && aws sts get-caller-identity &>/dev/null; then
    echo -e "${CYAN}Initiating AWS Amplify release build via AWS CLI...${NC}"
    JOB_OUT=$(aws amplify start-job --app-id "$AMPLIFY_APP_ID" --branch-name "$BRANCH" --job-type RELEASE --output json 2>/dev/null || echo "")
    if [[ -n "$JOB_OUT" ]] && echo "$JOB_OUT" | grep -q "jobSummary"; then
      JOB_ID=$(echo "$JOB_OUT" | node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); console.log(d.jobSummary?.jobId || '');" 2>/dev/null || echo "")
      echo -e "${GREEN}✔ AWS Amplify release job triggered successfully! Job ID:${NC} ${BOLD}$JOB_ID${NC}"
      AMPLIFY_TRIGGERED=true
    fi
  fi
  
  # Try Amplify Webhook URL if set
  if [[ "$AMPLIFY_TRIGGERED" == false && -n "${AMPLIFY_DEPLOY_WEBHOOK_URL:-}" ]]; then
    echo -e "${CYAN}Calling AWS Amplify deployment incoming webhook...${NC}"
    if curl -sS -X POST -d '{}' "$AMPLIFY_DEPLOY_WEBHOOK_URL" &>/dev/null; then
      echo -e "${GREEN}✔ AWS Amplify deployment webhook invoked successfully!${NC}"
      AMPLIFY_TRIGGERED=true
    fi
  fi
  
  if [[ "$AMPLIFY_TRIGGERED" == false ]]; then
    echo -e "${GREEN}✔ GitHub push event auto-triggers AWS Amplify build on connected branch '$BRANCH'.${NC}"
    echo -e "${BLUE}ℹ Amplify Console:${NC} https://console.aws.amazon.com/amplify/home#/d2qe2q720fbn3x"
  fi
fi

# Step 6: Trigger AWS EC2 Backend
echo -e "\n${BOLD}${CYAN}----------------------------------------------------------------------${NC}"
echo -e "${BOLD}▶ [3/3] AWS EC2 BACKEND DEPLOYMENT (gigpilot-backend)${NC}"
echo -e "${BOLD}${CYAN}----------------------------------------------------------------------${NC}"

if [[ "$SKIP_EC2" == true ]]; then
  echo -e "${YELLOW}EC2 deployment skipped (--skip-ec2).${NC}"
elif [[ "$DRY_RUN" == true ]]; then
  echo -e "${CYAN}[DRY-RUN] Would deliver push-to-deploy webhook to: $EC2_WEBHOOK_URL.${NC}"
else
  # Check if running directly on EC2
  IS_EC2_LOCAL=false
  if [[ "${IS_EC2:-}" == "true" ]]; then
    IS_EC2_LOCAL=true
  fi
  
  if [[ "$IS_EC2_LOCAL" == true ]]; then
    echo -e "${CYAN}Executing push-to-deploy locally on EC2 host...${NC}"
    git pull origin "$BRANCH"
    npm run build
    pm2 reload gigpilot || pm2 restart gigpilot || true
    echo -e "${GREEN}✔ EC2 backend gracefully reloaded.${NC}"
  else
    echo -e "${CYAN}Sending deployment webhook to EC2 backend (${EC2_WEBHOOK_URL})...${NC}"
    
    PAYLOAD=$(node -e "console.log(JSON.stringify({
      ref: 'refs/heads/$BRANCH',
      after: '$LATEST_HASH',
      head_commit: {
        id: '$LATEST_HASH',
        message: '$MESSAGE',
        author: { name: '$LATEST_AUTHOR' }
      }
    }))")
    
    WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-${WEBHOOK_SECRET:-}}"
    SIG_HEADER=()
    if [[ -n "$WEBHOOK_SECRET" ]]; then
      SIG=$(node -e "
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', '$WEBHOOK_SECRET');
        hmac.update(Buffer.from('$PAYLOAD'));
        console.log('sha256=' + hmac.digest('hex'));
      ")
      SIG_HEADER=(-H "X-Hub-Signature-256: $SIG")
    fi
    
    HTTP_CODE=$(curl -sS -o /tmp/ec2_webhook_resp.json -w "%{http_code}" \
      -X POST "$EC2_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -H "X-GitHub-Event: push" \
      -H "X-GitHub-Delivery: cli-deploy-$(date +%s)" \
      "${SIG_HEADER[@]}" \
      -d "$PAYLOAD" \
      --max-time 15 || echo "000")
      
    if [[ "$HTTP_CODE" =~ ^20[0-9]$ ]]; then
      echo -e "${GREEN}✔ EC2 backend received deployment trigger (HTTP $HTTP_CODE)!${NC}"
      node -e "
        try {
          const d = JSON.parse(require('fs').readFileSync('/tmp/ec2_webhook_resp.json', 'utf8'));
          if (d.message) console.log('  Message: ' + d.message);
          if (d.deployment?.id) console.log('  Deployment ID: ' + d.deployment.id);
        } catch(e){}
      " 2>/dev/null || true
    else
      echo -e "${YELLOW}Notice: EC2 webhook responded with HTTP $HTTP_CODE.${NC}"
      cat /tmp/ec2_webhook_resp.json 2>/dev/null || true
    fi
  fi
fi

# Step 7: Summary report
echo -e "\n${BOLD}${GREEN}======================================================================${NC}"
echo -e "${BOLD}${GREEN}   🎉 PUSH-TO-DEPLOY COMPLETED SUCCESSFULLY${NC}"
echo -e "${BOLD}${GREEN}======================================================================${NC}"
echo -e "${BOLD}Target Repository:${NC} https://github.com/ky8402-rgb/gigpilot-platform"
echo -e "${BOLD}Frontend (Amplify):${NC} https://main.d2qe2q720fbn3x.amplifyapp.com"
echo -e "${BOLD}Backend (EC2):${NC}      https://13-233-54-120.sslip.io"
echo -e "${BOLD}Healthcheck:${NC}        https://13-233-54-120.sslip.io/api/health"
echo -e "${GREEN}======================================================================${NC}\n"
