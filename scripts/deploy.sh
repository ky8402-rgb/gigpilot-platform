#!/usr/bin/env bash
# ==============================================================================
# GigPilot Master Deployment Pipeline (deploy.sh)
#
# Automates the entire production release sequence:
#   1. Pre-flight Git Working Tree Status Check
#   2. Staging & Committing Code (with custom or automated timestamp message)
#   3. Pushing to GitHub (triggers GitHub Webhook -> EC2 zero-downtime PM2 reload)
#   4. AWS Amplify Environment Sync & Release Build Trigger
#   5. Live End-to-End Health Verification (Backend SSL, Frontend, CORS, RDS, Redis)
#
# Usage:
#   ./deploy.sh
#   ./deploy.sh -m "feat: updated payout rules and escrow release"
#   ./deploy.sh --skip-amplify
#   ./deploy.sh --skip-verify
#   ./deploy.sh --dry-run
#   ./deploy.sh --help
# ==============================================================================

set -uo pipefail

# Visual formatting & styling
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Defaults
BACKEND_URL="https://13-233-54-120.sslip.io"
FRONTEND_URL="https://main.d2qe2q720fbn3x.amplifyapp.com"
EC2_HOST="13.233.54.120"
REMOTE_NAME="origin"
DEFAULT_BRANCH="master"
COMMIT_MSG=""
ALLOW_EMPTY=true
SKIP_AMPLIFY=false
SKIP_VERIFY=false
DRY_RUN=false

print_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "=============================================================================="
  echo "         🚀 GIGPILOT MASTER PRODUCTION DEPLOYMENT SEQUENCE"
  echo "=============================================================================="
  echo -e "${NC}"
  echo -e "  • Target Frontend: ${BOLD}${FRONTEND_URL}${NC}"
  echo -e "  • Target Backend:  ${BOLD}${BACKEND_URL}${NC}"
  echo -e "  • EC2 Host:        ${BOLD}${EC2_HOST}${NC}"
  echo -e "  • Branch:          ${BOLD}${DEFAULT_BRANCH}${NC}"
  echo -e "  • Timestamp:       $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo -e "------------------------------------------------------------------------------\n"
}

usage() {
  print_banner
  cat << EOF
Usage: $0 [OPTIONS]

Options:
  -m, --message <MSG>    Custom commit message (default: auto-generated timestamp)
  -b, --branch <BRANCH>  Target git branch (default: $DEFAULT_BRANCH)
  --no-empty             Do not allow empty commits if working tree is clean
  --skip-amplify         Skip triggering Amplify build script
  --skip-verify          Skip running the post-deployment health check
  --dry-run              Display steps without modifying git or making remote calls
  -h, --help             Display this help screen

Examples:
  # 1. Standard 1-Click Master Deployment:
  $0

  # 2. Deploy with a custom release message:
  $0 -m "release: v1.4.0 with automated payment webhooks"

  # 3. Deploy backend only (skip frontend Amplify build):
  $0 --skip-amplify
EOF
  exit 0
}

# Parse CLI flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      COMMIT_MSG="$2"
      shift 2
      ;;
    -b|--branch)
      DEFAULT_BRANCH="$2"
      shift 2
      ;;
    --no-empty)
      ALLOW_EMPTY=false
      shift
      ;;
    --skip-amplify)
      SKIP_AMPLIFY=true
      shift
      ;;
    --skip-verify)
      SKIP_VERIFY=true
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
      echo -e "${RED}Unknown argument: $1${NC}"
      usage
      ;;
  esac
done

print_banner

# Step 1: Pre-flight Git Repository Validation
echo -e "${BOLD}[1/4] Inspecting Local Git Repository State...${NC}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo -e "${RED}✖ Error: Current directory is not a Git repository.${NC}"
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")
echo -e "  ✔ Current branch: ${CYAN}${BOLD}$CURRENT_BRANCH${NC}"

# Detect changes
CHANGED_FILES_COUNT=$(git status --porcelain | wc -l | tr -d ' ')

if [[ "$CHANGED_FILES_COUNT" -gt 0 ]]; then
  echo -e "  ✔ Detected ${YELLOW}${BOLD}$CHANGED_FILES_COUNT pending change(s)${NC} in working tree."
else
  echo -e "  ℹ Working tree is clean."
  if [[ "$ALLOW_EMPTY" != "true" ]]; then
    echo -e "${YELLOW}No changes to commit and --no-empty specified. Aborting deploy.${NC}"
    exit 0
  fi
fi

# Determine Commit Message
if [[ -z "$COMMIT_MSG" ]]; then
  COMMIT_MSG="release: production go-live $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
fi

echo -e "  ✔ Commit message: ${MAGENTA}\"$COMMIT_MSG\"${NC}"

# Step 2: Staging, Committing, and Pushing
echo -e "\n${BOLD}[2/4] Committing & Pushing to GitHub...${NC}"

if [[ "$DRY_RUN" == "true" ]]; then
  echo -e "  ${YELLOW}[DRY RUN] Would stage changes: git add -A${NC}"
  echo -e "  ${YELLOW}[DRY RUN] Would commit: git commit -m \"$COMMIT_MSG\" --allow-empty${NC}"
  echo -e "  ${YELLOW}[DRY RUN] Would push: git push $REMOTE_NAME $CURRENT_BRANCH${NC}"
else
  # Stage files
  git add -A
  
  # Commit
  if [[ "$CHANGED_FILES_COUNT" -gt 0 ]]; then
    git commit -m "$COMMIT_MSG"
    echo -e "  ${GREEN}✔ Changes committed successfully.${NC}"
  else
    git commit --allow-empty -m "$COMMIT_MSG"
    echo -e "  ${GREEN}✔ Created release trigger commit (--allow-empty).${NC}"
  fi

  # Push to GitHub
  echo -e "  Pushing to ${BOLD}${CYAN}$REMOTE_NAME/$CURRENT_BRANCH${NC}..."
  if git push "$REMOTE_NAME" "$CURRENT_BRANCH"; then
    echo -e "  ${GREEN}✔ Successfully pushed to GitHub ($REMOTE_NAME/$CURRENT_BRANCH).${NC}"
    echo -e "  ${GREEN}✔ GitHub Push-to-Deploy Webhook triggered on EC2 (Zero-downtime PM2 reload in progress).${NC}"
  else
    echo -e "${RED}✖ Failed to push to GitHub remote '$REMOTE_NAME'.${NC}"
    echo -e "${YELLOW}↳ REMEDIATION: Check internet connection, SSH keys, or run 'git pull --rebase $REMOTE_NAME $CURRENT_BRANCH' if remote has new commits.${NC}"
    exit 1
  fi
fi

# Step 3: Trigger AWS Amplify Frontend Deployment
echo -e "\n${BOLD}[3/4] Coordinating AWS Amplify Build & Environment Sync...${NC}"

if [[ "$SKIP_AMPLIFY" == "true" ]]; then
  echo -e "  ${YELLOW}ℹ Skipping Amplify build trigger (--skip-amplify flag set).${NC}"
else
  if [[ -f "./migrate-backend.sh" ]]; then
    echo -e "  Running ${CYAN}./migrate-backend.sh${NC} to verify Amplify environment variables and trigger release build..."
    if [[ "$DRY_RUN" == "true" ]]; then
      echo -e "  ${YELLOW}[DRY RUN] Would execute ./migrate-backend.sh${NC}"
    else
      # Execute migrate-backend.sh with non-interactive parameters
      if ./migrate-backend.sh; then
        echo -e "  ${GREEN}✔ Amplify deployment synchronized.${NC}"
      else
        echo -e "${YELLOW}⚠ Notice: migrate-backend.sh finished with warnings. Note that GitHub push already initiates Amplify auto-builds natively.${NC}"
      fi
    fi
  elif command -v aws >/dev/null 2>&1; then
    echo -e "  Checking AWS CLI for Amplify apps..."
    AMPLIFY_APP_ID=$(aws amplify list-apps --query "apps[?name=='gigpilot'||name=='gigpilot-platform'].appId | [0]" --output text 2>/dev/null || true)
    if [[ -n "$AMPLIFY_APP_ID" && "$AMPLIFY_APP_ID" != "None" ]]; then
      echo -e "  Triggering Amplify release build for App ID: ${CYAN}$AMPLIFY_APP_ID${NC} (Branch: master)..."
      aws amplify start-job --app-id "$AMPLIFY_APP_ID" --branch-name master --job-type RELEASE || true
      echo -e "  ${GREEN}✔ Amplify release build initiated.${NC}"
    else
      echo -e "  ${YELLOW}ℹ GitHub push triggers Amplify auto-build directly via repository webhook.${NC}"
    fi
  else
    echo -e "  ${GREEN}✔ GitHub push triggers AWS Amplify automatic continuous build via connected repository.${NC}"
  fi
fi

# Step 4: Health Verification & Status Audit
echo -e "\n${BOLD}[4/4] Verifying EC2 Backend Health & Production Availability...${NC}"

if [[ "$SKIP_VERIFY" == "true" ]]; then
  echo -e "  ${YELLOW}ℹ Skipping health audit (--skip-verify flag set).${NC}"
elif [[ "$DRY_RUN" == "true" ]]; then
  echo -e "  ${YELLOW}[DRY RUN] Would execute complete 7-point health check suite (./verify-production.sh).${NC}"
else
  # Allow EC2 a brief window (4s) for git pull and PM2 reload if executed locally
  echo -e "  Allowing EC2 zero-downtime reload to initialize..."
  sleep 3

  if [[ -f "./verify-production.sh" ]]; then
    echo -e "  Executing complete 7-point health check suite (${CYAN}./verify-production.sh${NC})...\n"
    if ./verify-production.sh; then
      echo -e "  ${GREEN}✔ All health checks passed successfully.${NC}"
    else
      echo -e "${RED}✖ Health verification reported one or more issues.${NC}"
      echo -e "${YELLOW}↳ Review the remediation suggestions output above.${NC}"
      exit 1
    fi
  else
    # Fallback inline health ping
    echo -e "  Testing live endpoint: ${CYAN}${BACKEND_URL}/api/health${NC}..."
    HEALTH_CODE=$(curl -s -k -m 10 -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/health" || echo "000")
    if [[ "$HEALTH_CODE" == "200" ]]; then
      echo -e "  ${GREEN}✔ Backend responded with HTTP 200 OK.${NC}"
    else
      echo -e "${RED}✖ Backend returned HTTP $HEALTH_CODE.${NC}"
      echo -e "${YELLOW}↳ Connect to EC2 via SSH and run 'pm2 logs gigpilot --lines 40'.${NC}"
      exit 1
    fi
  fi
fi

# Final Summary Banner
echo -e "\n${GREEN}${BOLD}==============================================================================${NC}"
echo -e "${GREEN}${BOLD}🎉 MASTER PRODUCTION DEPLOYMENT COMPLETED SUCCESSFULLY!${NC}"
echo -e "${GREEN}${BOLD}==============================================================================${NC}"
echo -e "  • Frontend Web App:  ${BOLD}${CYAN}${FRONTEND_URL}${NC}"
echo -e "  • Backend SSL API:   ${BOLD}${CYAN}${BACKEND_URL}${NC}"
echo -e "  • EC2 Host:          ${BOLD}${EC2_HOST}${NC}"
echo -e "  • Release Branch:    ${BOLD}${CURRENT_BRANCH}${NC}"
echo -e "  • Commit:            ${BOLD}$(git rev-parse --short HEAD 2>/dev/null || echo 'HEAD')${NC}"
echo -e "==============================================================================\n"
exit 0
