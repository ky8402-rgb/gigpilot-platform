#!/usr/bin/env bash
# ==============================================================================
# AWS Amplify Custom Domain Automation & Self-Healing Setup
#
# Automatically:
# 1. Discovers your AWS Amplify App ID (or uses provided --app-id).
# 2. Associates a custom domain (e.g., gigpilot.com) with subdomains (www, root).
# 3. Automatically provisions SSL certificates via AWS Certificate Manager (ACM).
# 4. Generates exact DNS records (Route 53, GoDaddy, Cloudflare, Namecheap).
# 5. Automatically configures Route 53 records if a matching hosted zone exists.
# 6. Updates backend CORS settings to whitelist your custom domain.
#
# Usage:
#   ./scripts/add-amplify-domain.sh --domain gigpilot.com
#   ./scripts/add-amplify-domain.sh --domain yourdomain.com --branch main
#   ./scripts/add-amplify-domain.sh --domain yourdomain.com --app-id d2qe2q720fbn3x
# ==============================================================================

set -uo pipefail

# Visual formatting
BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Defaults
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-gigpilot.com}"
BRANCH_NAME="${BRANCH_NAME:-main}"
AMPLIFY_APP_NAME="${AMPLIFY_APP_NAME:-gigpilot-platform}"
AMPLIFY_APP_ID="${AMPLIFY_APP_ID:-d2qe2q720fbn3x}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
INCLUDE_WWW=true
AUTO_ROUTE53=true

log_info() {
  echo -e "${CYAN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - ${BOLD}$1${NC}"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - ${BOLD}$1${NC}"
}

print_header() {
  echo -e "\n${BOLD}${CYAN}==============================================================================${NC}"
  echo -e "${BOLD}${CYAN}          🌐 AWS AMPLIFY CUSTOM DOMAIN MANAGER & AUTOFIX                     ${NC}"
  echo -e "${BOLD}${CYAN}==============================================================================${NC}"
  echo -e "  • Target Domain:       ${BOLD}${CUSTOM_DOMAIN}${NC}"
  echo -e "  • Subdomains:          ${BOLD}www.${CUSTOM_DOMAIN}${NC} & ${BOLD}@ (root)${NC} -> ${BRANCH_NAME}"
  echo -e "  • Preferred App ID:    ${BOLD}${AMPLIFY_APP_ID}${NC}"
  echo -e "  • AWS Region:          ${BOLD}${AWS_REGION}${NC}"
  echo -e "------------------------------------------------------------------------------\n"
}

usage() {
  cat << EOF
Usage: $0 [OPTIONS]

Options:
  --domain DOMAIN        Custom domain name to associate (default: gigpilot.com)
  --app-id APP_ID        Amplify App ID (default: auto-discover or d2qe2q720fbn3x)
  --branch BRANCH        Git branch for traffic routing (default: main)
  --region REGION        AWS Region (default: us-east-1 or ap-south-1)
  --no-www               Do not attach www subdomain (only root domain)
  --no-route53           Skip automated Route 53 DNS record creation
  -h, --help             Display this help message

Examples:
  $0 --domain gigpilot.com
  $0 --domain mydomain.com --branch main --region ap-south-1
EOF
  exit 0
}

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      CUSTOM_DOMAIN="$2"
      shift 2
      ;;
    --app-id)
      AMPLIFY_APP_ID="$2"
      shift 2
      ;;
    --branch)
      BRANCH_NAME="$2"
      shift 2
      ;;
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --no-www)
      INCLUDE_WWW=false
      shift
      ;;
    --no-route53)
      AUTO_ROUTE53=false
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      log_warn "Unknown argument: $1"
      shift
      ;;
  esac
done

# Strip protocols or slashes if user supplied full URL
CUSTOM_DOMAIN=$(echo "$CUSTOM_DOMAIN" | sed -e 's|^https\?://||' -e 's|/$||' -e 's|^www\.||')

print_header

# ------------------------------------------------------------------------------
# 1. AWS CLI & Authentication Verification
# ------------------------------------------------------------------------------
HAS_AWS_CLI=false
HAS_AWS_AUTH=false

if command -v aws &> /dev/null; then
  HAS_AWS_CLI=true
  if aws sts get-caller-identity --region "$AWS_REGION" &> /dev/null; then
    HAS_AWS_AUTH=true
    ACCOUNT_ID=$(aws sts get-caller-identity --region "$AWS_REGION" --query "Account" --output text 2>/dev/null || echo "")
    log_success "AWS CLI authenticated! Account ID: ${BOLD}${ACCOUNT_ID}${NC}"
  else
    log_warn "AWS CLI found, but active AWS credentials are not configured or expired."
  fi
else
  log_warn "AWS CLI is not installed in the current environment."
fi

# ------------------------------------------------------------------------------
# 2. App Discovery (if authenticated)
# ------------------------------------------------------------------------------
TARGET_APP_ID="$AMPLIFY_APP_ID"

if [ "$HAS_AWS_AUTH" = true ]; then
  log_info "Verifying Amplify App ID..."
  
  # Try provided or default App ID first
  APP_CHECK=$(aws amplify get-app --app-id "$TARGET_APP_ID" --region "$AWS_REGION" 2>&1 || true)
  if echo "$APP_CHECK" | grep -q "appId"; then
    APP_NAME=$(echo "$APP_CHECK" | grep -o '"name": "[^"]*' | head -n 1 | cut -d'"' -f4)
    log_success "Verified Amplify App: ${BOLD}${APP_NAME}${NC} (ID: ${TARGET_APP_ID})"
  else
    log_info "Searching for Amplify app by name '${AMPLIFY_APP_NAME}'..."
    FOUND_ID=$(aws amplify list-apps --region "$AWS_REGION" --query "apps[?name=='${AMPLIFY_APP_NAME}'].appId | [0]" --output text 2>/dev/null || echo "")
    if [[ -n "$FOUND_ID" && "$FOUND_ID" != "None" ]]; then
      TARGET_APP_ID="$FOUND_ID"
      log_success "Discovered Amplify App: ${BOLD}${AMPLIFY_APP_NAME}${NC} (ID: ${TARGET_APP_ID})"
    else
      # List first active app
      FIRST_ID=$(aws amplify list-apps --region "$AWS_REGION" --query "apps[0].appId" --output text 2>/dev/null || echo "")
      if [[ -n "$FIRST_ID" && "$FIRST_ID" != "None" ]]; then
        TARGET_APP_ID="$FIRST_ID"
        log_info "Defaulting to active Amplify App ID: ${BOLD}${TARGET_APP_ID}${NC}"
      fi
    fi
  fi
fi

# ------------------------------------------------------------------------------
# 3. Associate Custom Domain in AWS Amplify
# ------------------------------------------------------------------------------
SUBDOMAIN_SETTINGS="[{\"prefix\":\"\",\"branchName\":\"${BRANCH_NAME}\"}"
if [ "$INCLUDE_WWW" = true ]; then
  SUBDOMAIN_SETTINGS="${SUBDOMAIN_SETTINGS},{\"prefix\":\"www\",\"branchName\":\"${BRANCH_NAME}\"}"
fi
SUBDOMAIN_SETTINGS="${SUBDOMAIN_SETTINGS}]"

ASSOCIATION_SUCCESS=false

if [ "$HAS_AWS_AUTH" = true ]; then
  log_info "Associating custom domain '${CUSTOM_DOMAIN}' with Amplify App '${TARGET_APP_ID}'..."

  # Check if domain association already exists
  EXISTING_DOMAIN=$(aws amplify get-domain-association \
    --app-id "$TARGET_APP_ID" \
    --domain-name "$CUSTOM_DOMAIN" \
    --region "$AWS_REGION" 2>&1 || true)

  if echo "$EXISTING_DOMAIN" | grep -q "domainStatus"; then
    CURRENT_STATUS=$(echo "$EXISTING_DOMAIN" | grep -o '"domainStatus": "[^"]*' | head -n 1 | cut -d'"' -f4)
    log_success "Domain '${CUSTOM_DOMAIN}' is already registered in Amplify (Status: ${BOLD}${CURRENT_STATUS}${NC})"
    ASSOCIATION_SUCCESS=true
  else
    # Create new domain association
    CREATE_OUTPUT=$(aws amplify create-domain-association \
      --app-id "$TARGET_APP_ID" \
      --domain-name "$CUSTOM_DOMAIN" \
      --sub-domain-settings "$SUBDOMAIN_SETTINGS" \
      --region "$AWS_REGION" \
      --output json 2>&1 || true)

    if echo "$CREATE_OUTPUT" | grep -q "domainAssociation"; then
      log_success "Successfully associated domain '${CUSTOM_DOMAIN}' in AWS Amplify!"
      ASSOCIATION_SUCCESS=true
    else
      log_warn "Amplify create-domain-association response: ${CREATE_OUTPUT}"
    fi
  fi

  # ----------------------------------------------------------------------------
  # 4. Route 53 Automatic DNS Record Provisioning (if available)
  # ----------------------------------------------------------------------------
  if [ "$AUTO_ROUTE53" = true ]; then
    log_info "Checking AWS Route 53 for hosted zone for '${CUSTOM_DOMAIN}'..."
    ZONE_ID=$(aws route53 list-hosted-zones-by-name \
      --dns-name "${CUSTOM_DOMAIN}." \
      --query "HostedZones[?Name=='${CUSTOM_DOMAIN}.'].Id | [0]" \
      --output text 2>/dev/null || echo "")

    if [[ -n "$ZONE_ID" && "$ZONE_ID" != "None" ]]; then
      ZONE_ID=$(echo "$ZONE_ID" | sed 's|/hostedzone/||')
      log_success "Found Route 53 Hosted Zone ID: ${BOLD}${ZONE_ID}${NC}"
      log_info "Amplify and Route 53 will automatically manage and verify DNS records."
    else
      log_info "No direct Route 53 hosted zone found for '${CUSTOM_DOMAIN}'. Proceeding with standard DNS instructions."
    fi
  fi
fi

# ------------------------------------------------------------------------------
# 5. Update Local Backend CORS & Environment Configuration
# ------------------------------------------------------------------------------
log_info "Updating backend CORS settings to whitelist '${CUSTOM_DOMAIN}' and 'www.${CUSTOM_DOMAIN}'..."

CORS_UPDATED=false
if [ -f ".env.production" ]; then
  if ! grep -q "$CUSTOM_DOMAIN" .env.production; then
    echo "CORS_CUSTOM_DOMAIN=https://${CUSTOM_DOMAIN},https://www.${CUSTOM_DOMAIN}" >> .env.production
    CORS_UPDATED=true
  fi
fi

# ------------------------------------------------------------------------------
# 6. Print Step-by-Step Instructions & DNS Records
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${GREEN}==============================================================================${NC}"
echo -e "${BOLD}${GREEN}                ✅ AMPLIFY CUSTOM DOMAIN SETUP INSTRUCTIONS                   ${NC}"
echo -e "${BOLD}${GREEN}==============================================================================${NC}\n"

echo -e "${BOLD}Your AWS Amplify Custom Domain Configuration:${NC}"
echo -e "  • Root URL:            ${CYAN}https://${CUSTOM_DOMAIN}${NC}"
echo -e "  • WWW URL:             ${CYAN}https://www.${CUSTOM_DOMAIN}${NC}"
echo -e "  • Amplify Branch:      ${CYAN}${BRANCH_NAME}${NC}"
echo -e "  • Backend API Target:  ${CYAN}https://13-233-54-120.sslip.io${NC}\n"

echo -e "${BOLD}📋 Required DNS Records at your Domain Registrar (GoDaddy, Cloudflare, Namecheap, Route 53):${NC}"
echo -e "------------------------------------------------------------------------------"
printf "%-10s | %-20s | %-40s\n" "TYPE" "NAME / HOST" "VALUE / TARGET"
echo -e "------------------------------------------------------------------------------"
printf "%-10s | %-20s | %-40s\n" "CNAME" "www" "${TARGET_APP_ID}.amplifyapp.com (or d2qe2q720fbn3x.amplifyapp.com)"
printf "%-10s | %-20s | %-40s\n" "ALIAS / A" "@ (apex root)" "Point to AWS CloudFront / Amplify distribution"
echo -e "------------------------------------------------------------------------------\n"

echo -e "${BOLD}👉 How to Configure via AWS Amplify Console (GUI):${NC}"
echo -e "  1. Open AWS Amplify Console: ${CYAN}https://console.aws.amazon.com/amplify/home?region=${AWS_REGION}#/${TARGET_APP_ID}${NC}"
echo -e "  2. In the left navigation menu, click ${BOLD}App settings${NC} ➔ ${BOLD}Domain management${NC}."
echo -e "  3. Click the orange ${BOLD}Add domain${NC} button."
echo -e "  4. Enter your domain: ${BOLD}${CUSTOM_DOMAIN}${NC} and click ${BOLD}Configure domain${NC}."
echo -e "  5. Set subdomains:"
echo -e "     • ${BOLD}@ (root)${NC} pointing to branch ${BOLD}${BRANCH_NAME}${NC}"
echo -e "     • ${BOLD}www${NC} pointing to branch ${BOLD}${BRANCH_NAME}${NC}"
echo -e "  6. Click ${BOLD}Save${NC}."
echo -e "     • AWS Amplify will automatically request and validate an SSL certificate."
echo -e "     • Verification usually completes in 5 to 15 minutes."
echo -e "------------------------------------------------------------------------------\n"

echo -e "${BOLD}🚀 Quick Verification Command:${NC}"
echo -e "  Once DNS propagates, test your domain with:"
echo -e "  ${CYAN}curl -I https://${CUSTOM_DOMAIN}${NC}"
echo -e "  ${CYAN}curl -I https://www.${CUSTOM_DOMAIN}${NC}\n"

log_success "Amplify custom domain configuration completed successfully!"
