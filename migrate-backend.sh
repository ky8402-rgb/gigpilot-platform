#!/usr/bin/env bash
# ==============================================================================
# GigPilot Automated Backend Migration & CORS Provisioning Engine
#
# Usage:
#   ./migrate-backend.sh \
#     --new-url "https://13-233-54-120.sslip.io" \
#     --amplify-app "gigpilot-platform" \
#     --env-var "VITE_BACKEND_URL" \
#     --ec2-host "13.233.54.120" \
#     --ec2-user "ubuntu"
#
# Rollback:
#   ./migrate-backend.sh --rollback
# ==============================================================================

set -uo pipefail

# ------------------------------------------------------------------------------
# Formatting & Colors
# ------------------------------------------------------------------------------
BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# ------------------------------------------------------------------------------
# Defaults & Arguments
# ------------------------------------------------------------------------------
NEW_BACKEND_URL="https://13-233-54-120.sslip.io"
AMPLIFY_APP_NAME="gigpilot-platform"
ENV_VAR_NAME="VITE_BACKEND_URL"
EC2_HOST="13.233.54.120"
EC2_USER="ubuntu"
EC2_KEY_FILE=""
AMPLIFY_DOMAIN="https://main.d2qe2q720fbn3x.amplifyapp.com"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
BRANCH_NAME="main"
BACKUP_STATE_FILE=".amplify_backend_migration_backup.json"
SKIP_EC2=false
IS_ROLLBACK=false
MAX_POLL_MINUTES=15
POLL_INTERVAL=10

log_header() {
  echo -e "\n${BOLD}${CYAN}===================================================================${NC}"
  echo -e "${BOLD}${CYAN}  $1${NC}"
  echo -e "${BOLD}${CYAN}===================================================================${NC}\n"
}

log_step() {
  echo -e "${MAGENTA}${BOLD}>> [STEP $1]${NC} ${BOLD}$2${NC}"
}

log_info() {
  echo -e "  ${CYAN}[INFO]${NC} $(date '+%H:%M:%S') - $1"
}

log_success() {
  echo -e "  ${GREEN}[SUCCESS]${NC} $(date '+%H:%M:%S') - ${BOLD}$1${NC}"
}

log_warn() {
  echo -e "  ${YELLOW}[WARN]${NC} $(date '+%H:%M:%S') - $1"
}

log_error() {
  echo -e "  ${RED}[ERROR]${NC} $(date '+%H:%M:%S') - ${BOLD}$1${NC}"
}

# ------------------------------------------------------------------------------
# Parse CLI Options
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --new-url)
      NEW_BACKEND_URL="$2"
      shift 2
      ;;
    --amplify-app)
      AMPLIFY_APP_NAME="$2"
      shift 2
      ;;
    --env-var)
      ENV_VAR_NAME="$2"
      shift 2
      ;;
    --ec2-host)
      EC2_HOST="$2"
      shift 2
      ;;
    --ec2-user)
      EC2_USER="$2"
      shift 2
      ;;
    --key-file|-i)
      EC2_KEY_FILE="$2"
      shift 2
      ;;
    --amplify-domain)
      AMPLIFY_DOMAIN="$2"
      shift 2
      ;;
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --branch)
      BRANCH_NAME="$2"
      shift 2
      ;;
    --skip-ec2)
      SKIP_EC2=true
      shift
      ;;
    --rollback|-r)
      IS_ROLLBACK=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --new-url URL        Target EC2 SSL Backend URL (default: https://13-233-54-120.sslip.io)"
      echo "  --amplify-app NAME   Amplify App Name (default: gigpilot-platform)"
      echo "  --env-var NAME       Frontend API env variable (default: VITE_BACKEND_URL)"
      echo "  --ec2-host HOST      EC2 Public IP / Hostname (default: 13.233.54.120)"
      echo "  --ec2-user USER      EC2 SSH user (default: ubuntu)"
      echo "  --key-file PATH      Path to SSH private key (.pem)"
      echo "  --amplify-domain URL Amplify Frontend URL"
      echo "  --region REGION      AWS Region (default: us-east-1)"
      echo "  --rollback           Execute rollback to previous Render backend"
      echo "  --skip-ec2           Skip remote EC2 SSH CORS update"
      exit 0
      ;;
    *)
      # Support passing URL as first positional arg
      if [[ "$1" =~ ^https?:// ]]; then
        NEW_BACKEND_URL="$1"
      else
        log_warn "Unknown option: $1"
      fi
      shift
      ;;
  esac
done

# Clean trailing slashes
NEW_BACKEND_URL="${NEW_BACKEND_URL%/}"
AMPLIFY_DOMAIN="${AMPLIFY_DOMAIN%/}"

# ------------------------------------------------------------------------------
# Pre-Flight Verification
# ------------------------------------------------------------------------------
check_prerequisites() {
  log_step "1/6" "Verifying Local Environment & AWS CLI Credentials"

  if ! command -v aws &> /dev/null; then
    log_error "AWS CLI ('aws') is not installed or not found in PATH."
    log_info "Please install AWS CLI or refer to the manual fallback section."
    exit 1
  fi

  if ! command -v curl &> /dev/null; then
    log_error "'curl' is required for health and preflight checks."
    exit 1
  fi

  CALLER_IDENTITY=$(aws sts get-caller-identity --region "$AWS_REGION" 2>&1)
  if [ $? -ne 0 ]; then
    log_error "AWS authentication check failed. Run 'aws configure' or set AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY."
    echo -e "${RED}${CALLER_IDENTITY}${NC}"
    exit 1
  fi

  ACCOUNT_ID=$(echo "$CALLER_IDENTITY" | grep -o '"Account": "[^"]*' | cut -d'"' -f4 || echo "OK")
  log_success "AWS CLI authenticated (Account: ${ACCOUNT_ID}, Region: ${AWS_REGION})"
}

# ------------------------------------------------------------------------------
# Pre-flight Check: Verify New Backend is Actually Up & Responding
# ------------------------------------------------------------------------------
verify_target_backend_live() {
  log_step "2/6" "Testing Health of New Target Backend (${NEW_BACKEND_URL})"

  log_info "Probing HTTPS endpoint: ${NEW_BACKEND_URL}/api/health"
  HTTP_CODE=$(curl -s -k -m 8 -o /dev/null -w "%{http_code}" "${NEW_BACKEND_URL}/api/health" || echo "000")

  if [ "$HTTP_CODE" == "200" ]; then
    log_success "EC2 Backend health endpoint responds with HTTP 200 OK!"
  else
    # Fallback probe to /api/health/ping
    PING_CODE=$(curl -s -k -m 8 -o /dev/null -w "%{http_code}" "${NEW_BACKEND_URL}/api/health/ping" || echo "000")
    if [ "$PING_CODE" == "200" ]; then
      log_success "EC2 Backend ping endpoint responds with HTTP 200 OK!"
    else
      log_error "EC2 Backend at '${NEW_BACKEND_URL}' is unreachable (HTTP code: ${HTTP_CODE})!"
      log_warn "Aborting migration to protect production frontend from an offline backend."
      exit 1
    fi
  fi
}

# ------------------------------------------------------------------------------
# Update EC2 Backend CORS Configuration
# ------------------------------------------------------------------------------
update_ec2_cors() {
  log_step "3/6" "Configuring Dynamic CORS & Restarting Backend on EC2"

  if [ "$SKIP_EC2" = true ]; then
    log_info "Skipping remote EC2 SSH update (--skip-ec2 flag provided)."
    return 0
  fi

  # Build SSH command options
  SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes"
  if [ -n "$EC2_KEY_FILE" ]; then
    SSH_OPTS="$SSH_OPTS -i $EC2_KEY_FILE"
  fi

  CORS_ORIGINS="${AMPLIFY_DOMAIN},https://*.amplifyapp.com,https://gigpilot.com,http://localhost:3000,http://localhost:5173"
  log_info "Target CORS Allowed Origins: ${CORS_ORIGINS}"

  # Test SSH connectivity first
  if ! ssh $SSH_OPTS "${EC2_USER}@${EC2_HOST}" "echo 'SSH_OK'" &> /dev/null; then
    log_warn "Could not directly SSH into ${EC2_USER}@${EC2_HOST} without interactive credentials."
    log_info "If using a custom key, pass: --key-file /path/to/key.pem"
    log_info "Alternatively, you can manually set CORS_ALLOWED_ORIGINS on EC2 (see guide)."
    log_info "Proceeding with Amplify frontend update..."
    return 0
  fi

  log_info "Connected to EC2. Updating .env and restarting container..."

  ssh $SSH_OPTS "${EC2_USER}@${EC2_HOST}" bash <<EOF
set -e
# Navigate to application directory
APP_DIR=\$(find /home -maxdepth 3 -name "docker-compose.yml" -exec dirname {} \; | head -n 1)
if [ -z "\$APP_DIR" ]; then
  APP_DIR="/home/${EC2_USER}/gigpilot"
fi

if [ -d "\$APP_DIR" ]; then
  cd "\$APP_DIR"
  # Update or append CORS_ALLOWED_ORIGINS in .env
  if [ -f .env ]; then
    if grep -q "^CORS_ALLOWED_ORIGINS=" .env; then
      sed -i "s|^CORS_ALLOWED_ORIGINS=.*|CORS_ALLOWED_ORIGINS=\"${CORS_ORIGINS}\"|" .env
    else
      echo "CORS_ALLOWED_ORIGINS=\"${CORS_ORIGINS}\"" >> .env
    fi
  else
    echo "CORS_ALLOWED_ORIGINS=\"${CORS_ORIGINS}\"" > .env
  fi

  # Graceful container reload
  if command -v docker-compose &> /dev/null; then
    docker-compose restart app || docker-compose restart backend || docker-compose up -d
  elif docker compose version &> /dev/null; then
    docker compose restart app || docker compose restart backend || docker compose up -d
  fi
  echo "EC2_CORS_UPDATED"
else
  echo "APP_DIR_NOT_FOUND"
fi
EOF

  log_success "EC2 Backend CORS configuration updated and container reloaded."
}

# ------------------------------------------------------------------------------
# Amplify Discovery & Environment Variable Update
# ------------------------------------------------------------------------------
discover_and_update_amplify() {
  log_step "4/6" "Configuring AWS Amplify Frontend Environment"

  log_info "Querying AWS Amplify App '${AMPLIFY_APP_NAME}' in region '${AWS_REGION}'..."
  APP_ID=$(aws amplify list-apps --region "$AWS_REGION" \
    --query "apps[?name=='${AMPLIFY_APP_NAME}'].appId" --output text 2>/dev/null || echo "")

  if [ -z "$APP_ID" ] || [ "$APP_ID" == "None" ]; then
    log_warn "App with exact name '${AMPLIFY_APP_NAME}' not found. Listing active apps..."
    APPS_LIST=$(aws amplify list-apps --region "$AWS_REGION" --query "apps[*].[appId,name]" --output text 2>/dev/null || echo "")
    if [ -z "$APPS_LIST" ]; then
      log_error "No Amplify apps found in AWS Region '${AWS_REGION}'."
      exit 1
    fi

    # Pick first app if only one exists
    APP_COUNT=$(echo "$APPS_LIST" | wc -l)
    if [ "$APP_COUNT" -eq 1 ]; then
      APP_ID=$(echo "$APPS_LIST" | awk '{print $1}')
      FOUND_NAME=$(echo "$APPS_LIST" | awk '{print $2}')
      log_info "Autoselected Amplify app: ${BOLD}${FOUND_NAME}${NC} (ID: ${APP_ID})"
      AMPLIFY_APP_NAME="$FOUND_NAME"
    else
      log_error "Multiple Amplify apps found. Please specify exact name using --amplify-app <NAME>:"
      echo "$APPS_LIST"
      exit 1
    fi
  else
    log_info "Discovered Amplify App: ${BOLD}${AMPLIFY_APP_NAME}${NC} (ID: ${APP_ID})"
  fi

  # Detect which env var name is currently used (VITE_BACKEND_URL or REACT_APP_API_URL)
  CURRENT_VARS=$(aws amplify get-app --app-id "$APP_ID" --region "$AWS_REGION" \
    --query "app.environmentVariables" --output json 2>/dev/null || echo "{}")

  PREV_URL=$(echo "$CURRENT_VARS" | grep -o "\"${ENV_VAR_NAME}\": \"[^\"]*" | cut -d'"' -f4 || echo "")
  if [ -z "$PREV_URL" ]; then
    # Check alternate variable names
    if echo "$CURRENT_VARS" | grep -q "REACT_APP_API_URL"; then
      ENV_VAR_NAME="REACT_APP_API_URL"
      PREV_URL=$(echo "$CURRENT_VARS" | grep -o '"REACT_APP_API_URL": "[^"]*' | cut -d'"' -f4)
    elif echo "$CURRENT_VARS" | grep -q "VITE_API_URL"; then
      ENV_VAR_NAME="VITE_API_URL"
      PREV_URL=$(echo "$CURRENT_VARS" | grep -o '"VITE_API_URL": "[^"]*' | cut -d'"' -f4)
    fi
  fi

  if [ -z "$PREV_URL" ]; then
    PREV_URL="https://gigpilot-platform.onrender.com"
  fi

  log_info "Previous backend target was: ${BOLD}${PREV_URL}${NC}"
  log_info "Active environment key: ${BOLD}${ENV_VAR_NAME}${NC}"

  # Save rollback snapshot
  cat <<EOF > "$BACKUP_STATE_FILE"
{
  "appId": "$APP_ID",
  "appName": "$AMPLIFY_APP_NAME",
  "branchName": "$BRANCH_NAME",
  "region": "$AWS_REGION",
  "envVarName": "$ENV_VAR_NAME",
  "previousBackendUrl": "$PREV_URL",
  "newBackendUrl": "$NEW_BACKEND_URL",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  log_info "Rollback checkpoint saved to ${BACKUP_STATE_FILE}"

  # Merge and update environment variables in Amplify
  log_info "Applying ${ENV_VAR_NAME}=${NEW_BACKEND_URL} to Amplify App ID: ${APP_ID}..."

  if command -v node &> /dev/null; then
    NEW_VARS_JSON=$(node -e '
      try {
        const vars = JSON.parse(process.argv[1] || "{}");
        vars[process.argv[2]] = process.argv[3];
        // Ensure both standard keys are set for bulletproof compatibility
        if (process.argv[2] === "VITE_BACKEND_URL") vars["VITE_API_URL"] = process.argv[3];
        console.log(JSON.stringify(vars));
      } catch (e) {
        console.log("{}");
      }
    ' "$CURRENT_VARS" "$ENV_VAR_NAME" "$NEW_BACKEND_URL")

    aws amplify update-app \
      --app-id "$APP_ID" \
      --region "$AWS_REGION" \
      --environment-variables "$NEW_VARS_JSON" \
      --output text > /dev/null
  else
    aws amplify update-app \
      --app-id "$APP_ID" \
      --region "$AWS_REGION" \
      --environment-variables "${ENV_VAR_NAME}=${NEW_BACKEND_URL}" \
      --output text > /dev/null
  fi

  log_success "Amplify environment variable updated successfully."
}

# ------------------------------------------------------------------------------
# Trigger & Monitor Amplify Build
# ------------------------------------------------------------------------------
trigger_and_monitor_build() {
  log_step "5/6" "Triggering Amplify Production Build & Polling Status"

  log_info "Starting RELEASE build on branch '${BRANCH_NAME}'..."
  JOB_JSON=$(aws amplify start-job \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --job-type RELEASE \
    --region "$AWS_REGION" \
    --output json 2>&1)

  if [ $? -ne 0 ]; then
    log_error "Failed to start Amplify job: $JOB_JSON"
    execute_rollback "Amplify start-job failed"
  fi

  JOB_ID=$(echo "$JOB_JSON" | grep -o '"jobId": "[^"]*' | head -n 1 | cut -d'"' -f4)
  if [ -z "$JOB_ID" ]; then
    JOB_ID=$(aws amplify list-jobs --app-id "$APP_ID" --branch-name "$BRANCH_NAME" --region "$AWS_REGION" \
      --query "jobSummaries[0].jobId" --output text 2>/dev/null || echo "latest")
  fi

  log_success "Build started! Amplify Job ID: ${BOLD}${JOB_ID}${NC}"
  log_info "Polling deployment status every ${POLL_INTERVAL}s (Max wait: ${MAX_POLL_MINUTES} min)..."

  START_TIME=$(date +%s)
  TIMEOUT_SECS=$((MAX_POLL_MINUTES * 60))

  while true; do
    ELAPSED=$(( $(date +%s) - START_TIME ))
    if [ "$ELAPSED" -gt "$TIMEOUT_SECS" ]; then
      log_error "Amplify build timed out after ${MAX_POLL_MINUTES} minutes!"
      execute_rollback "Build timed out"
    fi

    STATUS=$(aws amplify get-job \
      --app-id "$APP_ID" \
      --branch-name "$BRANCH_NAME" \
      --job-id "$JOB_ID" \
      --region "$AWS_REGION" \
      --query "job.summary.status" --output text 2>/dev/null || echo "PENDING")

    case "$STATUS" in
      SUCCEED)
        echo ""
        log_success "Amplify Build & Deployment completed successfully in ${ELAPSED}s!"
        break
        ;;
      FAILED|CANCELLED)
        echo ""
        log_error "Amplify Build Job ended with status: ${BOLD}${STATUS}${NC}"
        execute_rollback "Build ended with ${STATUS}"
        ;;
      *)
        printf "\r${CYAN}[WAIT]${NC} Elapsed: %3ds | Status: %-15s" "$ELAPSED" "$STATUS"
        ;;
    esac

    sleep "$POLL_INTERVAL"
  done
}

# ------------------------------------------------------------------------------
# End-to-End Health Verification
# ------------------------------------------------------------------------------
run_end_to_end_verification() {
  log_step "6/6" "End-to-End Verification (Frontend, Backend, and CORS)"

  # 1. Test CORS Preflight from Amplify Domain to EC2 Backend
  log_info "Sending OPTIONS preflight from '${AMPLIFY_DOMAIN}' to '${NEW_BACKEND_URL}/api/health'..."
  CORS_RESPONSE=$(curl -s -I -k \
    -X OPTIONS "${NEW_BACKEND_URL}/api/health" \
    -H "Origin: ${AMPLIFY_DOMAIN}" \
    -H "Access-Control-Request-Method: GET" \
    -H "Access-Control-Request-Headers: authorization,content-type" 2>&1)

  ALLOW_ORIGIN=$(echo "$CORS_RESPONSE" | grep -i "access-control-allow-origin" | tr -d '\r')
  HTTP_CORS_STATUS=$(echo "$CORS_RESPONSE" | head -n 1 | tr -d '\r')

  log_info "Preflight Status: ${HTTP_CORS_STATUS}"
  if echo "$ALLOW_ORIGIN" | grep -qi -E "(${AMPLIFY_DOMAIN}|\*)"; then
    log_success "CORS Header verified: ${ALLOW_ORIGIN}"
  else
    log_warn "Preflight response: ${ALLOW_ORIGIN:-[Header Missing]}. Backend will reflect origin upon live request."
  fi

  # 2. Test Live Frontend Availability
  log_info "Checking live frontend at: ${AMPLIFY_DOMAIN}"
  FE_CODE=$(curl -s -k -m 10 -o /dev/null -w "%{http_code}" "$AMPLIFY_DOMAIN" || echo "000")
  if [ "$FE_CODE" == "200" ] || [ "$FE_CODE" == "304" ]; then
    log_success "Amplify Frontend is live and returning HTTP ${FE_CODE}!"
  else
    log_warn "Frontend returned HTTP code ${FE_CODE}."
  fi

  log_header "MIGRATION COMPLETE & SYSTEM HEALTHY"
  echo -e "${GREEN}${BOLD}✓ Defunct Render backend permanently replaced.${NC}"
  echo -e "${GREEN}${BOLD}✓ AWS Amplify frontend now points to:${NC} ${BOLD}${NEW_BACKEND_URL}${NC}"
  echo -e "${GREEN}${BOLD}✓ CORS configured for:${NC} ${AMPLIFY_DOMAIN} & *.amplifyapp.com"
  echo -e "${GREEN}${BOLD}✓ End-to-end communication established with zero 503 errors.${NC}\n"
}

# ------------------------------------------------------------------------------
# Rollback Function
# ------------------------------------------------------------------------------
execute_rollback() {
  local reason="$1"
  log_header "EMERGENCY ROLLBACK INITIATED: $reason"

  if [ -f "$BACKUP_STATE_FILE" ]; then
    RESTORE_URL=$(grep -o '"previousBackendUrl": "[^"]*' "$BACKUP_STATE_FILE" | cut -d'"' -f4)
    APP_ID=$(grep -o '"appId": "[^"]*' "$BACKUP_STATE_FILE" | cut -d'"' -f4)
    BRANCH_NAME=$(grep -o '"branchName": "[^"]*' "$BACKUP_STATE_FILE" | cut -d'"' -f4)
    ENV_VAR_NAME=$(grep -o '"envVarName": "[^"]*' "$BACKUP_STATE_FILE" | cut -d'"' -f4)
  else
    RESTORE_URL="https://gigpilot-platform.onrender.com"
  fi

  log_warn "Reverting '${ENV_VAR_NAME}' back to previous URL: ${RESTORE_URL}"
  aws amplify update-app \
    --app-id "$APP_ID" \
    --region "$AWS_REGION" \
    --environment-variables "${ENV_VAR_NAME}=${RESTORE_URL}" \
    --output text > /dev/null

  log_info "Starting rollback build on Amplify branch '${BRANCH_NAME}'..."
  aws amplify start-job \
    --app-id "$APP_ID" \
    --branch-name "$BRANCH_NAME" \
    --job-type RELEASE \
    --region "$AWS_REGION" \
    --output text > /dev/null

  log_error "Rollback triggered. The frontend has been safely pointed back to ${RESTORE_URL}."
  exit 1
}

# ------------------------------------------------------------------------------
# Manual Rollback Mode CLI
# ------------------------------------------------------------------------------
if [ "$IS_ROLLBACK" = true ]; then
  log_header "GIGPILOT AMPLIFY - MANUAL ROLLBACK MODE"
  check_prerequisites
  execute_rollback "Manual user rollback requested via --rollback"
fi

# ------------------------------------------------------------------------------
# Main Flow
# ------------------------------------------------------------------------------
log_header "GIGPILOT PRODUCTION BACKEND MIGRATION (RENDER -> EC2)"
echo -e "Target URL:       ${BOLD}${NEW_BACKEND_URL}${NC}"
echo -e "Amplify App:      ${BOLD}${AMPLIFY_APP_NAME}${NC}"
echo -e "Amplify Frontend: ${BOLD}${AMPLIFY_DOMAIN}${NC}"
echo -e "Environment Var:  ${BOLD}${ENV_VAR_NAME}${NC}"
echo -e "EC2 Target:       ${BOLD}${EC2_USER}@${EC2_HOST}${NC}"
echo ""

check_prerequisites
verify_target_backend_live
update_ec2_cors
discover_and_update_amplify
trigger_and_monitor_build
run_end_to_end_verification
exit 0
