#!/usr/bin/env bash
# ==============================================================================
# GigPilot Platform - 1-Click AWS Free Tier EC2 Setup Script
# Works on: Ubuntu 22.04 / 24.04 LTS (t2.micro / t3.micro - 100% Free Tier)
# Supported Regions: ap-south-1 (Mumbai), us-east-1 (N. Virginia), and all regions
# ==============================================================================

set -e

echo "🚀 Starting 1-Click AWS Free Tier EC2 Setup for GigPilot Backend..."

# 1. Update and install prerequisites
sudo apt-get update -y
sudo apt-get install -y curl git nginx build-essential ufw

# 2. Configure Firewall (UFW)
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw --force enable || true

# 3. Install Node.js 20 LTS
if ! command -v node &> /dev/null; then
  echo "📦 Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# 4. Install PM2 process manager
sudo npm install -g pm2

# 5. Setup application directory
APP_DIR="/var/www/gigpilot"
sudo mkdir -p "$APP_DIR"
sudo chown -R $USER:$USER "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "📥 Cloning repository..."
  git clone https://github.com/ky8402-rgb/gigpilot-platform.git "$APP_DIR"
else
  echo "🔄 Updating existing repository..."
  cd "$APP_DIR" && git pull origin main
fi

cd "$APP_DIR"

# 6. Install dependencies and build production artifacts
echo "🔨 Installing npm dependencies and building..."
npm ci || npm install
npm run build

# 7. Write production environment file
echo "⚙️ Configuring production environment variables..."
cat << 'EOF' > "$APP_DIR/.env"
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://kundanvision_postgres_user:V0n9FJhuJNh8DrbnHkUzLqQpnMRpaA5L@dpg-da8q9tm7bikc73d0ckbg-a.ohio-postgres.render.com/kundanvision_postgres
PAYPAL_CLIENT_ID=BAAv8rRenc5jlfD6eH_8pvgcU250jXTZCnyPKdBby13EAYRKhCempoPQ3Hj41GEfe2qBMu1P8ZslnbdkIc
PAYPAL_CLIENT_SECRET=EH8CcxBIVPvFhoAKbL-HN8l_jSdOYzlGA2oahgGs1wPV7bogYK_TE4hIOjPtzOVj-mOUUXVy8uMIt6-N
PAYPAL_MODE=live
PAYPAL_RECEIVER_EMAIL=kundank4@icloud.com
PAYPAL_ME_USERNAME=ky8402
AUTO_HEAL_ENABLED=true
ML_ENABLED=true
EOF

# 8. Start application with PM2
echo "🚀 Starting backend server with PM2..."
pm2 delete gigpilot 2>/dev/null || true
pm2 start dist/server.cjs --name "gigpilot"
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME || true

# 9. Configure Nginx Reverse Proxy (Port 80 -> Port 3000)
echo "🌐 Configuring Nginx reverse proxy on port 80..."
sudo tee /etc/nginx/sites-available/gigpilot > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # API and dynamic backend routes
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/gigpilot /etc/nginx/sites-enabled/gigpilot
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

echo "===================================================================="
echo "✅ GigPilot Backend is LIVE and running on AWS Free Tier!"
echo "🌐 Access your backend at: http://$(curl -s http://checkip.amazonaws.com || curl -s ifconfig.me)"
echo "🩺 Health Check: http://$(curl -s http://checkip.amazonaws.com || curl -s ifconfig.me)/api/health/ping"
echo "===================================================================="
