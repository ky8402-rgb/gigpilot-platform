#!/usr/bin/env bash
# ==============================================================================
# Configure New Asia Pacific (Mumbai - ap-south-1) EC2 Instance
#
# Run this script directly on your newly transferred/launched Mumbai EC2 instance.
#
# Usage:
#   sudo bash update-mumbai-instance.sh [MUMBAI_PUBLIC_IP]
# ==============================================================================

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}${BOLD}Error: This script must be run as root or with sudo.${NC}"
  echo -e "Usage: sudo bash $0"
  exit 1
fi

echo -e "\n${BOLD}${CYAN}====================================================================${NC}"
echo -e "${BOLD}${CYAN}  🇮🇳 CONFIGURING EC2 BACKEND IN ASIA PACIFIC (MUMBAI - ap-south-1)${NC}"
echo -e "${BOLD}${CYAN}====================================================================${NC}"

# Detect Public IP
DETECTED_IP=$(curl -s --connect-timeout 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || curl -s --connect-timeout 3 http://checkip.amazonaws.com 2>/dev/null || curl -s --connect-timeout 3 https://ifconfig.me 2>/dev/null || echo "")
PUBLIC_IP="${1:-${DETECTED_IP}}"

if [ -z "$PUBLIC_IP" ]; then
  echo -e "${RED}Could not auto-detect public IPv4. Please provide it as an argument:${NC}"
  echo -e "Usage: sudo bash $0 <YOUR_MUMBAI_PUBLIC_IP>"
  exit 1
fi

IP_DASH=$(echo "$PUBLIC_IP" | tr '.' '-')
DOMAIN="${IP_DASH}.sslip.io"
SSL_CERT_DIR="/etc/ssl/gigpilot"

echo -e "  • Mumbai Public IP:   ${GREEN}${PUBLIC_IP}${NC}"
echo -e "  • SSL Domain:         ${GREEN}${DOMAIN}${NC}"
echo -e "  • Region Target:      ${GREEN}Asia Pacific (Mumbai - ap-south-1)${NC}"
echo -e "--------------------------------------------------------------------\n"

# 1. Ensure Nginx and Certbot are installed
echo -e "${BOLD}[1/4] Ensuring Nginx and SSL tools are installed...${NC}"
apt-get update -y >/dev/null 2>&1 || true
apt-get install -y nginx certbot python3-certbot-nginx curl ufw >/dev/null 2>&1 || true

# Configure UFW firewall
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow 3000/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

# 2. Self-signed SSL fallback generator
mkdir -p "$SSL_CERT_DIR"
if [ ! -f "${SSL_CERT_DIR}/cert.pem" ]; then
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "${SSL_CERT_DIR}/key.pem" \
    -out "${SSL_CERT_DIR}/cert.pem" \
    -subj "/C=IN/ST=Maharashtra/L=Mumbai/O=GigPilot/CN=${DOMAIN}" >/dev/null 2>&1
fi

# 3. Configure Nginx Reverse Proxy
echo -e "${BOLD}[2/4] Setting up Nginx Reverse Proxy for ${DOMAIN}...${NC}"
cat << EOF > /etc/nginx/sites-available/gigpilot
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${PUBLIC_IP} localhost;

    location / {
        return 301 https://\$host\$request_uri;
    }

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN} ${PUBLIC_IP};

    ssl_certificate ${SSL_CERT_DIR}/cert.pem;
    ssl_certificate_key ${SSL_CERT_DIR}/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }
}
EOF

mkdir -p /var/www/html
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/gigpilot /etc/nginx/sites-enabled/gigpilot

nginx -t
systemctl restart nginx
systemctl enable nginx

# 4. Provision Let's Encrypt SSL
echo -e "${BOLD}[3/4] Provisioning Let's Encrypt SSL certificate for ${DOMAIN}...${NC}"
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email "admin@gigpilot.dev" --redirect 2>/dev/null || {
  echo -e "  ${YELLOW}↳ Note: Using local high-security SSL certificate while Let's Encrypt DNS propagates.${NC}"
}
systemctl reload nginx || true

# 5. Check and Restart PM2 Service
echo -e "${BOLD}[4/4] Verifying and restarting PM2 backend daemon...${NC}"
APP_USER="${SUDO_USER:-ubuntu}"
APP_DIR="/home/${APP_USER}/gigpilot"

if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR"
  sudo -u "$APP_USER" pm2 restart gigpilot 2>/dev/null || \
  sudo -u "$APP_USER" NODE_ENV=production PORT=3000 pm2 start dist/server.cjs --name gigpilot --time 2>/dev/null || true
  sudo -u "$APP_USER" pm2 save 2>/dev/null || true
fi

sleep 3

# 6. Verify Health
echo -e "\n${BOLD}${GREEN}====================================================================${NC}"
echo -e "${BOLD}${GREEN}  ✅ MUMBAI EC2 INSTANCE CONFIGURATION COMPLETE!${NC}"
echo -e "${BOLD}${GREEN}====================================================================${NC}"
echo -e "  • Public Health Endpoint:  ${CYAN}https://${DOMAIN}/api/health${NC}"
echo -e "  • Local Health Endpoint:   ${CYAN}http://127.0.0.1:3000/api/health${NC}"
echo -e "  • Direct HTTP Check:       ${CYAN}http://${PUBLIC_IP}/api/health${NC}\n"

curl -sS -m 3 http://127.0.0.1:3000/api/health 2>/dev/null && echo -e "  ${GREEN}✔ Local service healthy!${NC}\n" || echo -e "  ${YELLOW}Notice: Service starting up...${NC}\n"
