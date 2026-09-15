#!/usr/bin/env bash
# ==============================================================================
# SENTIENT FREELANCER — Complete 1-Command AWS Bootstrap
# Provisions VPC, EC2, Redis, S3, CloudWatch, SSM Parameters, Docker container,
# and prints setup URLs for AWS Amplify and live endpoints.
# ==============================================================================

set -e

COLOR_CYAN='\033[0;36m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[1;33m'
COLOR_RED='\033[0;31m'
COLOR_NC='\033[0m'

echo -e "${COLOR_CYAN}================================================================${COLOR_NC}"
echo -e "${COLOR_CYAN}   SENTIENT FREELANCER — Automated AWS Provisioning System      ${COLOR_NC}"
echo -e "${COLOR_CYAN}================================================================${COLOR_NC}"

# 1. Dependency Validation
command -v aws >/dev/null 2>&1 || { echo -e "${COLOR_RED}[Error] AWS CLI is required but not installed.${COLOR_NC}" >&2; exit 1; }
command -v terraform >/dev/null 2>&1 || { echo -e "${COLOR_RED}[Error] Terraform is required but not installed.${COLOR_NC}" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${COLOR_RED}[Error] Docker is required but not installed.${COLOR_NC}" >&2; exit 1; }

echo -e "${COLOR_GREEN}✓ Prerequisites verified: aws, terraform, docker installed.${COLOR_NC}"

# 2. Check AWS Identity
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text 2>/dev/null || echo "")
if [ -z "$ACCOUNT_ID" ]; then
    echo -e "${COLOR_RED}[Error] Unable to authenticate with AWS. Run 'aws configure' first.${COLOR_NC}"
    exit 1
fi
REGION=$(aws configure get region || echo "us-east-1")
echo -e "${COLOR_GREEN}✓ Authenticated AWS Account: ${ACCOUNT_ID} (Region: ${REGION})${COLOR_NC}"

# 3. Terraform Infrastructure Provisioning
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="${SCRIPT_DIR}/infra"

echo -e "\n${COLOR_YELLOW}==> [1/4] Initializing and applying Terraform stack...${COLOR_NC}"
terraform -chdir="${INFRA_DIR}" init -upgrade
terraform -chdir="${INFRA_DIR}" apply -auto-approve

# Extract outputs
EC2_IP=$(terraform -chdir="${INFRA_DIR}" output -raw ec2_public_ip)
INSTANCE_ID=$(terraform -chdir="${INFRA_DIR}" output -raw ec2_instance_id)
S3_BUCKET=$(terraform -chdir="${INFRA_DIR}" output -raw s3_bucket_name)
REDIS_URL=$(terraform -chdir="${INFRA_DIR}" output -raw redis_endpoint)
API_URL=$(terraform -chdir="${INFRA_DIR}" output -raw api_url)

echo -e "${COLOR_GREEN}✓ Infrastructure deployed successfully:${COLOR_NC}"
echo "  - EC2 Public Elastic IP: ${EC2_IP}"
echo "  - EC2 Instance ID:       ${INSTANCE_ID}"
echo "  - S3 Artifacts Bucket:   ${S3_BUCKET}"
echo "  - ElastiCache Redis:     ${REDIS_URL}"
echo "  - Backend API:           ${API_URL}"

# 4. Create Amazon ECR Repository if missing
echo -e "\n${COLOR_YELLOW}==> [2/4] Setting up Amazon ECR Repository...${COLOR_NC}"
ECR_REPO="sentient-backend"
aws ecr describe-repositories --repository-names "${ECR_REPO}" --region "${REGION}" >/dev/null 2>&1 || \
    aws ecr create-repository --repository-name "${ECR_REPO}" --region "${REGION}" >/dev/null

REGISTRY_URL="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${REGISTRY_URL}"

# 5. Build and Push Initial Backend Docker Image
echo -e "\n${COLOR_YELLOW}==> [3/4] Building & pushing initial backend image to ECR...${COLOR_NC}"
docker build -t "${REGISTRY_URL}/${ECR_REPO}:latest" -f "${SCRIPT_DIR}/backend/Dockerfile" "${SCRIPT_DIR}/backend/"
docker push "${REGISTRY_URL}/${ECR_REPO}:latest"
echo -e "${COLOR_GREEN}✓ Docker image pushed to ECR: ${REGISTRY_URL}/${ECR_REPO}:latest${COLOR_NC}"

# 6. Save Local Reference Configuration (.env.local)
cat <<EOF > "${SCRIPT_DIR}/.env.local"
AWS_REGION=${REGION}
EC2_INSTANCE_ID=${INSTANCE_ID}
EC2_PUBLIC_IP=${EC2_IP}
S3_BUCKET_NAME=${S3_BUCKET}
REDIS_ENDPOINT=${REDIS_URL}
API_URL=${API_URL}
EOF

# 7. Print Deployment Summary
echo -e "\n${COLOR_CYAN}================================================================${COLOR_NC}"
echo -e "${COLOR_GREEN}✓ SENTIENT FREELANCER BOOTSTRAP COMPLETE!${COLOR_NC}"
echo -e "${COLOR_CYAN}================================================================${COLOR_NC}"
echo -e "Dashboard (Amplify / Static): Deploy frontend/public/ to AWS Amplify"
echo -e "API Base Endpoint:            ${API_URL}"
echo -e "Approvals Queue URL:          ${API_URL}/approvals or open frontend/public/approvals.html"
echo -e "Health Check:                 ${API_URL}/api/health"
echo -e "S3 Audit Artifacts:           s3://${S3_BUCKET}/"
echo -e "\nAmplify Setup Instruction:"
echo -e "  1. Open AWS Amplify Console -> Host Web App"
echo -e "  2. Connect your Git repository"
echo -e "  3. Select frontend/amplify.yml"
echo -e "  4. Set environment variable: VITE_API_URL=${API_URL}"
echo -e "${COLOR_CYAN}================================================================${COLOR_NC}"
