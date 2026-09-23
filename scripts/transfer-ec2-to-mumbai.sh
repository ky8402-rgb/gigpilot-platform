#!/usr/bin/env bash
# ==============================================================================
# AWS EC2 Cross-Region Transfer Engine: us-east-1 -> ap-south-1 (Mumbai)
#
# This script guides and automates transferring your running EC2 instance
# from US East (N. Virginia, us-east-1) to Asia Pacific (Mumbai, ap-south-1).
# ==============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
NC='\033[0m'

CURRENT_IP="3.222.149.9"
SOURCE_REGION="us-east-1"
TARGET_REGION="ap-south-1"
TARGET_REGION_NAME="Asia Pacific (Mumbai)"

echo -e "\n${BOLD}${CYAN}====================================================================${NC}"
echo -e "${BOLD}${CYAN}  🇮🇳 EC2 INSTANCE TRANSFER: US-EAST-1 ➔ ASIA PACIFIC (MUMBAI)${NC}"
echo -e "${BOLD}${CYAN}====================================================================${NC}"
echo -e "  • Source Region:     ${YELLOW}us-east-1 (N. Virginia)${NC}"
echo -e "  • Source Instance:   ${YELLOW}IP: ${CURRENT_IP}${NC}"
echo -e "  • Target Region:     ${GREEN}${TARGET_REGION} (${TARGET_REGION_NAME})${NC}"
echo -e "  • Target Zones:      ${GREEN}ap-south-1a, ap-south-1b, ap-south-1c${NC}"
echo -e "--------------------------------------------------------------------\n"

echo -e "${BOLD}${MAGENTA}AWS ARCHITECTURAL OVERVIEW:${NC}"
echo -e "In AWS, EC2 instances, EBS volumes, and IP addresses are region-bound."
echo -e "To transfer a live instance to Mumbai (${TARGET_REGION}), you have TWO options:\n"

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}OPTION 1: AMI Clone Transfer (Recommended - Preserves all files & DB)${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "1. Create an AMI of your current instance in us-east-1:"
echo -e "   • AWS Console -> EC2 -> Instances -> Select instance (${CURRENT_IP})"
echo -e "   • Click: ${CYAN}Actions -> Image and templates -> Create image${NC}"
echo -e "   • Image name: ${BOLD}gigpilot-trading-backup${NC} -> Click ${BOLD}Create image${NC}"
echo -e ""
echo -e "2. Copy the AMI to Mumbai (ap-south-1):"
echo -e "   • Go to: ${CYAN}EC2 -> AMIs${NC} (in us-east-1)"
echo -e "   • Select the created AMI -> Click: ${CYAN}Actions -> Copy AMI${NC}"
echo -e "   • Destination region: Select ${BOLD}Asia Pacific (Mumbai) / ap-south-1${NC}"
echo -e "   • Click: ${BOLD}Copy AMI${NC}"
echo -e ""
echo -e "3. Launch the new EC2 instance in Mumbai:"
echo -e "   • Switch the region dropdown in AWS Console (top-right) to ${BOLD}Asia Pacific (Mumbai)${NC}"
echo -e "   • Go to: ${CYAN}EC2 -> AMIs${NC} -> Select copied AMI -> Click: ${BOLD}Launch instance from AMI${NC}"
echo -e "   • Instance type: ${BOLD}t2.micro${NC} or ${BOLD}t3.micro${NC} (Free Tier Eligible) or ${BOLD}t3.small${NC}"
echo -e "   • Key Pair: Select or create an SSH key for Mumbai"
echo -e "   • Security Group: Open ports ${BOLD}22 (SSH), 80 (HTTP), 443 (HTTPS), 3000 (Custom TCP)${NC}"
echo -e "   • Click: ${BOLD}Launch instance${NC}"
echo -e ""
echo -e "4. Configure SSL & Domain on the new Mumbai EC2:"
echo -e "   • Note the new Mumbai Public IPv4 (e.g. 13.233.xx.xx)"
echo -e "   • SSH into the new instance: ${CYAN}ssh -i key.pem ubuntu@<NEW_MUMBAI_IP>${NC}"
echo -e "   • Run the 1-click update command:"
echo -e "     ${BOLD}sudo bash /home/ubuntu/gigpilot/scripts/update-mumbai-instance.sh${NC}"
echo -e ""
echo -e "5. Update Repository / Frontend Endpoints:"
echo -e "   • Run locally or in this workspace:"
echo -e "     ${BOLD}./scripts/switch-to-mumbai-ip.sh <NEW_MUMBAI_IP>${NC}"
echo -e "   • Commit and push to update AWS Amplify:\n"

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}OPTION 2: Fresh 1-Click Launch in Mumbai (Fastest - Under 3 minutes)${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "1. Open AWS Console in ${BOLD}Asia Pacific (Mumbai) / ap-south-1${NC}"
echo -e "2. Go to: ${CYAN}EC2 -> Launch an instance${NC}"
echo -e "   • Name: ${BOLD}gigpilot-trading-mumbai${NC}"
echo -e "   • OS: ${BOLD}Ubuntu 24.04 LTS${NC} or ${BOLD}Ubuntu 22.04 LTS${NC}"
echo -e "   • Instance Type: ${BOLD}t2.micro${NC} or ${BOLD}t3.micro${NC} (Free Tier eligible)"
echo -e "   • Security Group: Allow ${BOLD}Ports 22, 80, 443, 3000${NC}"
echo -e "3. SSH into the new Mumbai instance and run the 1-click bootstrap script:"
echo -e "   ${BOLD}curl -fsSL https://raw.githubusercontent.com/ky8402-rgb/gigpilot-platform/main/setup-ec2.sh | sudo bash${NC}"
echo -e "4. Switch repository endpoints to the new Mumbai IP:"
echo -e "   ${BOLD}./scripts/switch-to-mumbai-ip.sh <NEW_MUMBAI_IP>${NC}"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"

# Check if AWS CLI is configured
if command -v aws &>/dev/null; then
  echo -e "${GREEN}✔ AWS CLI detected.${NC}"
  echo -e "To automate Option 1 via AWS CLI, you can run:"
  echo -e "  1. INSTANCE_ID=\$(aws ec2 describe-instances --region us-east-1 --filters \"Name=ip-address,Values=${CURRENT_IP}\" --query \"Reservations[0].Instances[0].InstanceId\" --output text)"
  echo -e "  2. IMAGE_ID=\$(aws ec2 create-image --region us-east-1 --instance-id \$INSTANCE_ID --name \"gigpilot-mumbai-transfer-\$(date +%s)\" --output text)"
  echo -e "  3. aws ec2 wait image-available --region us-east-1 --image-ids \$IMAGE_ID"
  echo -e "  4. MUMBAI_IMAGE_ID=\$(aws ec2 copy-image --source-region us-east-1 --source-image-id \$IMAGE_ID --region ap-south-1 --name \"gigpilot-mumbai-\$(date +%s)\" --output text)"
  echo -e "  5. aws ec2 wait image-available --region ap-south-1 --image-ids \$MUMBAI_IMAGE_ID"
  echo -e "  6. aws ec2 run-instances --region ap-south-1 --image-id \$MUMBAI_IMAGE_ID --instance-type t3.micro --key-name <YOUR_MUMBAI_KEY>"
fi

echo -e "${BOLD}${GREEN}Ready! Choose Option 1 (AMI Transfer) or Option 2 (Fresh 1-Click Launch) to transfer to Mumbai.${NC}\n"
