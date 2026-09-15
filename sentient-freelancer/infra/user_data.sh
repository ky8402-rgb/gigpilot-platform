#!/bin/bash
set -ex

# 1. Update system packages
apt-get update -y
apt-get upgrade -y
apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release awscli jq

# 2. Configure 2GB Swap space to protect from OOM during Puppeteer runs
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 3. Install Docker Engine & Docker Compose
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl start docker
systemctl enable docker
usermod -aG docker ubuntu

# 4. Prepare directories
mkdir -p /opt/sentient /var/lib/sentient/chrome-profile /var/log/sentient
chmod -R 777 /var/lib/sentient

# 5. Fetch SSM Parameters & write production .env
REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region || echo "us-east-1")
TOKEN=$(aws ssm get-parameter --name "/sentient/token" --with-decryption --region $REGION --query "Parameter.Value" --output text || echo "sentient_secure_$(openssl rand -hex 12)")
S3_BUCKET=$(aws ssm get-parameter --name "/sentient/s3-bucket" --region $REGION --query "Parameter.Value" --output text || echo "sentient-artifacts")
REDIS_URL=$(aws ssm get-parameter --name "/sentient/redis-url" --region $REGION --query "Parameter.Value" --output text || echo "redis://127.0.0.1:6379")

cat <<EOF > /opt/sentient/.env
NODE_ENV=production
PORT=8080
SENTIENT_TOKEN=$TOKEN
S3_BUCKET_NAME=$S3_BUCKET
REDIS_URL=$REDIS_URL
ALLOWED_ORIGIN=*
HEADLESS=true
AWS_REGION=$REGION
EOF

# 6. Create docker-compose.yml on host
cat <<EOF > /opt/sentient/docker-compose.yml
version: '3.8'

services:
  sentient-backend:
    image: node:20-slim
    container_name: sentient-backend
    restart: always
    working_dir: /app
    volumes:
      - /opt/sentient/app:/app
      - /var/lib/sentient/chrome-profile:/var/lib/sentient/chrome-profile
    env_file:
      - /opt/sentient/.env
    ports:
      - "8080:8080"
    command: ["sh", "-c", "npm install --omit=dev && node server.js"]

  sentient-redis-local:
    image: redis:7-alpine
    container_name: sentient-redis-local
    restart: always
    ports:
      - "6379:6379"
    volumes:
      - /opt/sentient/redis-data:/data
EOF

# 7. Create Systemd Service for Sentient Worker & Container Supervisor
cat <<EOF > /etc/systemd/system/sentient-worker.service
[Unit]
Description=Sentient Freelancer Automation Runner & Worker
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/sentient
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sentient-worker.service

echo "Sentient user-data initialization completed successfully."
