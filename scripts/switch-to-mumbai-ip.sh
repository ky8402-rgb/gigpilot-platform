#!/usr/bin/env bash
# ==============================================================================
# Switch Project Backend & Frontend Endpoints to New Mumbai (ap-south-1) EC2 IP
#
# Usage:
#   ./scripts/switch-to-mumbai-ip.sh <NEW_MUMBAI_IP>
#
# Example:
#   ./scripts/switch-to-mumbai-ip.sh 13.233.100.50
# ==============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ $# -lt 1 ]; then
  echo -e "${RED}${BOLD}Error: Missing new Mumbai EC2 Public IP address.${NC}"
  echo -e "Usage: $0 <NEW_MUMBAI_IP>"
  echo -e "Example: $0 13.233.100.50"
  exit 1
fi

NEW_IP="$1"

# Validate IPv4 format
if ! [[ "$NEW_IP" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
  echo -e "${RED}${BOLD}Error: Invalid IPv4 address format: '$NEW_IP'${NC}"
  exit 1
fi

NEW_IP_DASH=$(echo "$NEW_IP" | tr '.' '-')
NEW_DOMAIN="${NEW_IP_DASH}.sslip.io"
NEW_URL="https://${NEW_DOMAIN}"

OLD_IP="35.154.110.156"
OLD_IP_DASH="35-154-110-156"
OLD_DOMAIN="35-154-110-156.sslip.io"

echo -e "\n${BOLD}${CYAN}====================================================================${NC}"
echo -e "${BOLD}${CYAN}  🔄 SWITCHING TO AWS ASIA PACIFIC (MUMBAI) EC2 ENDPOINTS${NC}"
echo -e "${BOLD}${CYAN}====================================================================${NC}"
echo -e "  • Old US-East-1 IP:      ${YELLOW}${OLD_IP}${NC}"
echo -e "  • New Mumbai IP:         ${GREEN}${NEW_IP}${NC}"
echo -e "  • New Mumbai Domain:     ${GREEN}${NEW_DOMAIN}${NC}"
echo -e "  • New Backend URL:       ${GREEN}${NEW_URL}${NC}"
echo -e "--------------------------------------------------------------------\n"

# Files to update
TARGET_FILES=(
  "src/lib/api.ts"
  "src/services/tradingService.ts"
  ".env.production"
  ".env.example"
  "amplify.yml"
  "verify-production.sh"
  "scripts/verify-production.sh"
  "verify-deployed.sh"
  "public/dashboard.html"
  "public/approvals.html"
  "public/sentient.html"
)

UPDATED_COUNT=0

for FILE in "${TARGET_FILES[@]}"; do
  if [ -f "$FILE" ]; then
    echo -e "  Updating: ${CYAN}${FILE}${NC}"
    sed -i "s/${OLD_DOMAIN}/${NEW_DOMAIN}/g" "$FILE"
    sed -i "s/${OLD_IP}/${NEW_IP}/g" "$FILE"
    sed -i "s/${OLD_IP_DASH}/${NEW_IP_DASH}/g" "$FILE"
    UPDATED_COUNT=$((UPDATED_COUNT + 1))
  fi
done

echo -e "\n${GREEN}✔ Updated ${UPDATED_COUNT} project configuration files to point to Mumbai EC2!${NC}"

echo -e "\n${BOLD}Testing connectivity to new Mumbai instance...${NC}"
if curl -k -s -m 5 "${NEW_URL}/api/health" >/dev/null 2>&1; then
  echo -e "  ${GREEN}✔ Connected successfully to ${NEW_URL}/api/health!${NC}"
elif curl -s -m 5 "http://${NEW_IP}:3000/api/health" >/dev/null 2>&1; then
  echo -e "  ${YELLOW}✔ Direct Port 3000 responded on http://${NEW_IP}:3000/api/health (SSL/Nginx setup may be in progress).${NC}"
else
  echo -e "  ${YELLOW}↳ Note: Could not reach ${NEW_URL} yet. Ensure security group allows ports 80 & 443, and the service is started on Mumbai EC2.${NC}"
fi

echo -e "\n${BOLD}${CYAN}Next Steps:${NC}"
echo -e "  1. If running on AWS Amplify, commit and push your changes:"
echo -e "     ${BOLD}git commit -am \"feat(infra): migrate EC2 backend to Asia Pacific Mumbai (${NEW_IP})\" && git push origin main${NC}"
echo -e "  2. Or trigger verification:"
echo -e "     ${BOLD}./scripts/verify-production.sh --backend-url \"${NEW_URL}\"${NC}\n"
