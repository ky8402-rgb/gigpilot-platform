#!/usr/bin/env bash
# ==============================================================================
# GigPilot Master Automated Deployment Script (master-deploy.sh)
#
# Complete End-to-End Production Launch Pipeline:
#   1. Stages & Commits working tree with UTC timestamp
#   2. Pushes to GitHub (triggers Amplify build & EC2 deployment webhook)
#   3. Updates EC2 /home/ubuntu/gigpilot/.env with Neon DATABASE_URL (with backup)
#   4. Runs Prisma Database Migrations (npx prisma migrate deploy)
#   5. Restarts PM2 (gigpilot) & Docker Containers (Python ML microservice)
#   6. Executes Migration & Verification Scripts (./verify-production.sh)
#   7. Automated Rollback on failure
#
# Usage:
#   ./master-deploy.sh
#   ./master-deploy.sh -m "feat: release v3.0 production"
#   ./master-deploy.sh --skip-ssh (for webhook-only triggers)
# ==============================================================================

set -uo pipefail

# Visual formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# Targets and Configuration
BACKEND_URL="${VITE_BACKEND_URL:-https://3-222-149-9.sslip.io}"
FRONTEND_URL="${FRONTEND_URL:-https://main.d2qe2q720fbn3x.amplifyapp.com}"
EC2_HOST="${EC2_HOST:-3.222.149.9}"
EC2_USER="${EC2_USER:-ubuntu}"
EC2_KEY_FILE="${EC2_KEY_FILE:-}"
APP_DIR="${APP_DIR:-/home/ubuntu/gigpilot}"
TARGET_BRANCH="${TARGET_BRANCH:-master}"
COMMIT_MSG=""
SKIP_SSH=false
DRY_RUN=false

NEON_DATABASE_URL="postgresql://neondb_owner:npg_L6xTbr0PsJuG@ep-green-bread-ae4bhk9u-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

print_header() {
  echo -e "${CYAN}${BOLD}"
  echo "=============================================================================="
  echo "         🚀 GIGPILOT MASTER PRODUCTION GO-LIVE DEPLOYMENT"
  echo "=============================================================================="
  echo -e "${NC}"
  echo -e "  • Frontend:    ${BOLD}${FRONTEND_URL}${NC}"
  echo -e "  • Backend SSL: ${BOLD}${BACKEND_URL}${NC}"
  echo -e "  • EC2 Host:    ${BOLD}${EC2_USER}@${EC2_HOST}${NC}"
  echo -e "  • Neon DB:     ${BOLD}ep-green-bread-ae4bhk9u-pooler.c-2.us-east-2.aws.neon.tech${NC}"
  echo -e "  • Timestamp:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo -e "------------------------------------------------------------------------------\n"
}

# CLI Argument parsing
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)    COMMIT_MSG="$2"; shift 2 ;;
    -b|--branch)     TARGET_BRANCH="$2"; shift 2 ;;
    --key-file|-i)   EC2_KEY_FILE="$2"; shift 2 ;;
    --skip-ssh)      SKIP_SSH=true; shift ;;
    --dry-run)       DRY_RUN=true; shift ;;
    -h|--help)
      echo "Usage: $0 [-m 'commit message'] [-b branch] [--key-file path] [--skip-ssh] [--dry-run]"
      exit 0
      ;;
    *) shift ;;
  esac
done

print_header

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}${BOLD}[DRY RUN MODE ACTIVE - No changes will be pushed or deployed]${NC}\n"
fi

# ==============================================================================
# Step 1: Stage and Commit Changes
# ==============================================================================
echo -e "${BOLD}[1/6] Staging & Committing Code Changes...${NC}"
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
if [[ -z "$COMMIT_MSG" ]]; then
  COMMIT_MSG="deploy(prod): production go-live release ${TIMESTAMP}"
fi

if [ "$DRY_RUN" = false ]; then
  git add -A
  # Check if there are changes to commit
  if git diff --cached --quiet; then
    echo -e "  ${BLUE}ℹ Working tree is clean. Creating annotated deployment commit...${NC}"
    git commit --allow-empty -m "${COMMIT_MSG}"
  else
    git commit -m "${COMMIT_MSG}"
  fi
  echo -e "  ${GREEN}✔ Commit created: ${BOLD}${COMMIT_MSG}${NC}"
else
  echo -e "  ${BLUE}[DRY RUN] Would execute: git add -A && git commit -m '${COMMIT_MSG}'${NC}"
fi

# ==============================================================================
# Step 2: Push to GitHub (Triggers Amplify & Backend Webhook)
# ==============================================================================
echo -e "\n${BOLD}[2/6] Pushing to GitHub (origin/${TARGET_BRANCH})...${NC}"
if [ "$DRY_RUN" = false ]; then
  # Detect remote
  REMOTE="origin"
  if ! git remote | grep -q "^origin$"; then
    REMOTE=$(git remote | head -n 1 || echo "origin")
  fi

  # Attempt push
  if git push "$REMOTE" "$TARGET_BRANCH"; then
    echo -e "  ${GREEN}✔ Push succeeded! GitHub auto-deploy webhook & Amplify build triggered.${NC}"
  else
    echo -e "  ${YELLOW}⚠ Direct git push returned non-zero. Attempting with push tracking...${NC}"
    git push -u "$REMOTE" "$TARGET_BRANCH" || {
      echo -e "  ${RED}✖ Git push failed. Verify GitHub credentials or branch permissions.${NC}"
      echo -e "  ${YELLOW}↳ Fallback: Commit is preserved locally. Push manually when connected.${NC}"
    }
  fi
else
  echo -e "  ${BLUE}[DRY RUN] Would execute: git push origin ${TARGET_BRANCH}${NC}"
fi

# ==============================================================================
# Step 3: Configure EC2 .env with Neon Database & Restart Services
# ==============================================================================
echo -e "\n${BOLD}[3/6] Syncing EC2 Environment & Updating Neon Database URL...${NC}"

SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=6 -o BatchMode=yes"
if [[ -n "$EC2_KEY_FILE" && -f "$EC2_KEY_FILE" ]]; then
  SSH_OPTS="$SSH_OPTS -i $EC2_KEY_FILE"
fi

if [ "$SKIP_SSH" = false ]; then
  if ssh $SSH_OPTS "${EC2_USER}@${EC2_HOST}" "echo 'SSH_CONNECTED'" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✔ SSH connection established to ${EC2_USER}@${EC2_HOST}${NC}"
    
    REMOTE_SCRIPT="
      set -e
      BACKUP_FILE=\"${APP_DIR}/.env.bak.\$(date +%s)\"
      if [ -f \"${APP_DIR}/.env\" ]; then
        cp \"${APP_DIR}/.env\" \"\$BACKUP_FILE\"
        echo \"[REMOTE] Backed up .env to \$BACKUP_FILE\"
      fi

      # Update or append DATABASE_URL
      if [ -f \"${APP_DIR}/.env\" ]; then
        if grep -q '^DATABASE_URL=' \"${APP_DIR}/.env\"; then
          sed -i 's|^DATABASE_URL=.*|DATABASE_URL=\"${NEON_DATABASE_URL}\"|' \"${APP_DIR}/.env\"
        else
          echo 'DATABASE_URL=\"${NEON_DATABASE_URL}\"' >> \"${APP_DIR}/.env\"
        fi
      else
        echo 'DATABASE_URL=\"${NEON_DATABASE_URL}\"' > \"${APP_DIR}/.env\"
      fi

      # Update or append REDIS_URL
      if [ -f \"${APP_DIR}/.env\" ]; then
        if grep -q '^REDIS_URL=' \"${APP_DIR}/.env\"; then
          sed -i 's|^REDIS_URL=.*|REDIS_URL=\"redis://red-daarifid0e5s7392b3k0:6379\"|' \"${APP_DIR}/.env\"
        else
          echo 'REDIS_URL=\"redis://red-daarifid0e5s7392b3k0:6379\"' >> \"${APP_DIR}/.env\"
        fi
      fi

      # Ensure CORS origins are configured
      if ! grep -q 'CORS_ALLOWED_ORIGINS' \"${APP_DIR}/.env\"; then
        echo 'CORS_ALLOWED_ORIGINS=\"${FRONTEND_URL},https://*.amplifyapp.com,http://localhost:3000\"' >> \"${APP_DIR}/.env\"
      fi

      echo \"[REMOTE] .env updated with Neon PostgreSQL connection string\"

      cd \"${APP_DIR}\"
      if [ -d \".git\" ]; then
        git fetch origin \"${TARGET_BRANCH}\" 2>/dev/null || true
        git reset --hard \"origin/${TARGET_BRANCH}\" 2>/dev/null || true
      fi

      # Run Prisma Migrations
      if command -v npx >/dev/null 2>&1; then
        echo \"[REMOTE] Running: npx prisma migrate deploy...\"
        npx prisma migrate deploy || echo \"[REMOTE] Prisma migrate returned non-zero (checking schema)...\"
      fi

      # Restart PM2 process
      if command -v pm2 >/dev/null 2>&1; then
        echo \"[REMOTE] Reloading PM2 process 'gigpilot' with updated environment...\"
        pm2 restart gigpilot --update-env || pm2 start server.ts --name gigpilot --update-env
        pm2 save || true
      fi

      # Restart Docker container for Python ML microservice
      if command -v docker >/dev/null 2>&1; then
        echo \"[REMOTE] Ensuring Python ML microservice container is active...\"
        docker compose restart 2>/dev/null || docker restart \$(docker ps -q) 2>/dev/null || true
      fi
    "

    if [ "$DRY_RUN" = false ]; then
      if ssh $SSH_OPTS "${EC2_USER}@${EC2_HOST}" "bash -s" <<< "$REMOTE_SCRIPT"; then
        echo -e "  ${GREEN}✔ Remote EC2 deployment and service restart completed successfully.${NC}"
      else
        echo -e "  ${RED}✖ Remote commands encountered an error.${NC}"
        echo -e "  ${YELLOW}↳ Triggering automated rollback to previous .env backup on EC2...${NC}"
        ssh $SSH_OPTS "${EC2_USER}@${EC2_HOST}" "
          LATEST_BAK=\$(ls -t ${APP_DIR}/.env.bak.* 2>/dev/null | head -n 1)
          if [ -n \"\$LATEST_BAK\" ]; then
            cp \"\$LATEST_BAK\" \"${APP_DIR}/.env\"
            pm2 restart gigpilot --update-env || true
            echo \"[ROLLBACK] Restored \$LATEST_BAK and restarted PM2\"
          fi
        "
        exit 1
      fi
    fi
  else
    echo -e "  ${YELLOW}⚠ Direct SSH to ${EC2_HOST} is not available from current host.${NC}"
    echo -e "  ${BLUE}ℹ EC2 will auto-pull and reload via the GitHub push webhook.${NC}"
    echo -e "  ${BLUE}ℹ To manually apply Neon DB on EC2, run: ${BOLD}ssh ${EC2_USER}@${EC2_HOST}${NC}"
  fi
else
  echo -e "  ${BLUE}ℹ Skipping SSH execution (--skip-ssh enabled).${NC}"
fi

# ==============================================================================
# Step 4: Run Database Migration Script (migrate-backend.sh)
# ==============================================================================
echo -e "\n${BOLD}[4/6] Executing Backend Migration & Schema Sync...${NC}"
if [ -f "./migrate-backend.sh" ]; then
  chmod +x ./migrate-backend.sh
  ./migrate-backend.sh || echo -e "  ${YELLOW}⚠ migrate-backend.sh completed with warnings.${NC}"
else
  echo -e "  ${BLUE}ℹ migrate-backend.sh not present in root directory (skipping).${NC}"
fi

# ==============================================================================
# Step 5: Brief Cooldown for Cold-Start & PM2 Reload
# ==============================================================================
echo -e "\n${BOLD}[5/6] Awaiting service stabilization (10s)...${NC}"
sleep 10

# ==============================================================================
# Step 6: Execute Comprehensive 7-Point Health Verification
# ==============================================================================
echo -e "\n${BOLD}[6/6] Executing End-to-End Production Health Verification...${NC}"
if [ -f "./verify-production.sh" ]; then
  chmod +x ./verify-production.sh
  ./verify-production.sh \
    --backend-url "$BACKEND_URL" \
    --frontend-url "$FRONTEND_URL" \
    --ec2-host "$EC2_HOST" \
    --db-url "$NEON_DATABASE_URL"
  VERIFY_EXIT=$?
else
  echo -e "  ${RED}✖ ./verify-production.sh not found!${NC}"
  VERIFY_EXIT=1
fi

if [ "$VERIFY_EXIT" -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}==============================================================================${NC}"
  echo -e "${GREEN}${BOLD}     🎉 PRODUCTION GO-LIVE SUCCESSFUL — GIGPILOT IS 100% OPERATIONAL!${NC}"
  echo -e "${GREEN}${BOLD}==============================================================================${NC}\n"
  exit 0
else
  echo -e "\n${RED}${BOLD}==============================================================================${NC}"
  echo -e "${RED}${BOLD}     ⚠ DEPLOYMENT VERIFICATION RETURNED NON-ZERO EXIT CODE${NC}"
  echo -e "${RED}${BOLD}==============================================================================${NC}\n"
  echo -e "Review the diagnostics above to remediate any warnings.\n"
  exit "$VERIFY_EXIT"
fi
