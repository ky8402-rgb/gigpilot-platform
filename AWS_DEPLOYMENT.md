# Deploying GigPilot to Amazon Web Services (AWS)

This guide provides step-by-step instructions to deploy **GigPilot Platform** (`ky8402-rgb/gigpilot-platform`) on AWS.

Depending on your preference, choose one of the three primary deployment methods:

| Method | Best For | Difficulty | Cost |
|---|---|---|---|
| **Option 1: AWS Amplify Hosting** | Instant Git deployment for frontend, global CloudFront CDN, automatic SSL | 🟢 Easiest | Free Tier eligible |
| **Option 2: AWS App Runner (Full-Stack)** | Fully managed, serverless containers (Express + ML daemons), auto-deploy | 🟢 Easiest (Full-Stack) | Free tier / Pay-per-vCPU-sec |
| **Option 3: AWS EC2 (Virtual Server)** | Full root control, fixed monthly budget, custom background daemons | 🟡 Moderate | Free Tier eligible (t3.micro / t4g.small) |
| **Option 4: AWS Elastic Beanstalk** | Traditional PaaS with managed load balancers and environment rollbacks | 🟡 Moderate | Free Tier eligible |

---

## Deploying on AWS Amplify Hosting (`*.amplifyapp.com`)

If your deployment on AWS Amplify was showing **404 Not Found** on CloudFront, this occurs because:
1. **Missing `amplify.yml`**: AWS Amplify looks for `build/` (Create-React-App convention), whereas Vite builds artifacts into `dist/`. Without `amplify.yml`, Amplify deployed 0 files, causing CloudFront to return 404.
2. **SPA URL Rewrites**: In single-page apps (React/Vite), routing requires a 200 rewrite to `/index.html`.
3. **Healthcheck 404**: AWS Amplify requests `/status.html` for domain verification and health checks.

### How to Fix in AWS Amplify:

#### Step 1: Repository Configuration (Already Configured)
The repository now includes:
- `amplify.yml` with `baseDirectory: dist`
- `public/status.html` (returns HTTP 200 OK for AWS health checks)
- `public/robots.txt`
- Dynamic API routing in `src/services/api.ts` directing frontend calls to your backend

#### Step 2: Configure Rewrites and Redirects in AWS Amplify Console
1. In the **AWS Amplify Console**, select your app (`d2qe2q720fbn3x`).
2. In the left navigation menu, go to **App settings** &rarr; **Rewrites and redirects**.
3. Click **Edit** and ensure the SPA rewrite rule is present:
   - **Source address**: `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|html)$)([^.]+$)/>`
   - **Target address**: `/index.html`
   - **Type**: `200 (Rewrite)`
4. (Optional) If you want `/api/*` requests routed directly to your Render backend from Amplify:
   - Add rule:
     - **Source address**: `/api/<*>`
     - **Target address**: `https://gigpilot-platform.onrender.com/api/<*>`
     - **Type**: `200 (Rewrite)`
5. Click **Save**.

#### Step 3: Trigger a Re-deploy
In AWS Amplify, click **Run build** (or push any commit to `main`). AWS Amplify will execute `npm run build`, pick up `dist/`, and serve your app at `https://d2qe2q720fbn3x.amplifyapp.com`.

---

## Required Environment Variables for AWS

Regardless of the method chosen, prepare these environment variables:

| Variable | Description | Example / Default |
|---|---|---|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Web server listening port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` (AWS RDS or Render/Neon) |
| `GEMINI_API_KEY` | Google Gemini API Key | *(Your API Key)* |
| `PAYPAL_CLIENT_ID` | PayPal Live REST Client ID | `BAAv8rRenc5jlfD6eH_8pvgcU250jXTZCnyPKdBby13EAYRKhCempoPQ3Hj41GEfe2qBMu1P8ZslnbdkIc` |
| `PAYPAL_CLIENT_SECRET` | PayPal Live REST Client Secret | `EH8CcxBIVPvFhoAKbL-HN8l_jSdOYzlGA2oahgGs1wPV7bogYK_TE4hIOjPtzOVj-mOUUXVy8uMIt6-N` |
| `PAYPAL_RECEIVER_EMAIL` | PayPal notification / payout email | `kundank4@icloud.com` |
| `PAYPAL_ME_USERNAME` | Direct PayPal.Me handle | `ky8402` |
| `PAYPAL_MODE` | Payment mode | `live` |
| `FREELANCER_ACCESS_TOKEN` | Freelancer.com API Bearer Token | *(Your Freelancer Token)* |
| `JWT_SECRET` | Secret token for session signing | *(Any random 32+ char string)* |
| `AUTO_HEAL_ENABLED` | Autonomous AIOps self-healing loop | `true` |
| `ML_ENABLED` | Predictive failure forecasting | `true` |

---

## Option 1: AWS App Runner (Recommended & Fastest)

AWS App Runner connects directly to your GitHub repository or Docker container, manages traffic, scales automatically, and provisions free SSL certificates.

### Step 1: Open AWS App Runner Console
1. Navigate to **[AWS App Runner Console](https://console.aws.amazon.com/apprunner)**.
2. Click **Create service**.

### Step 2: Source Code Provider
1. Under **Repository type**, select **Source code repository**.
2. Click **Add new** to connect your GitHub account.
3. Select repository: **`ky8402-rgb/gigpilot-platform`**.
4. Set branch: **`main`**.
5. Under **Deployment trigger**, select **Automatic** (deploy on every `git push`).

### Step 3: Configure Build
- **Runtime**: `Node.js 20` (or select `Dockerfile` if using container build)
- **Build command**: `npm run build`
- **Start command**: `npm start`
- **Port**: `3000`

*(Or choose **Using a Dockerfile** — the included `Dockerfile` will automatically handle build and runtime).*

### Step 4: Configure Service & Environment Variables
1. **Service name**: `gigpilot-platform`
2. **Virtual CPU & Memory**: `1 vCPU, 2 GB` (sufficient for ML ops & express server)
3. Under **Environment variables**, add all keys listed in the table above.
4. Under **Health check**:
   - **Protocol**: `HTTP`
   - **Path**: `/api/health/ping`
   - **Interval**: `10 seconds`
   - **Timeout**: `5 seconds`
   - **Healthy threshold**: `1`
   - **Unhealthy threshold**: `3`

### Step 5: Review & Deploy
Click **Create & deploy**. Within 3–4 minutes, AWS App Runner will provide your application's public HTTPS URL (e.g., `https://xyz.us-east-1.awsapprunner.com`).

---

## Option 2: AWS EC2 (Ubuntu 24.04 LTS / Amazon Linux 2023)

For maximum control or hosting on the AWS Free Tier (using `t3.micro` or `t4g.small`).

### Step 1: Launch EC2 Instance
1. In the AWS Management Console, open **EC2** &rarr; **Launch Instance**.
2. Choose **Ubuntu Server 24.04 LTS** (or Amazon Linux 2023).
3. Instance Type: `t3.micro` (Free Tier) or `t4g.small` (ARM Graviton).
4. Select or create an **SSH Key Pair**.
5. Under **Security Group**, allow:
   - **SSH (22)** from your IP
   - **HTTP (80)** from Anywhere (0.0.0.0/0)
   - **HTTPS (443)** from Anywhere (0.0.0.0/0)
   - **Custom TCP (3000)** (optional, if accessing directly without Nginx)

### Step 2: Connect and Install Node.js 20 & PM2
Connect via SSH:
```bash
ssh -i your-key.pem ubuntu@<YOUR-EC2-PUBLIC-IP>
```

Update system and install Node.js 20:
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx
sudo npm install -g pm2
```

### Step 3: Clone Repository and Build
```bash
git clone https://github.com/ky8402-rgb/gigpilot-platform.git
cd gigpilot-platform
npm ci
```

Create your production `.env` file:
```bash
cat << 'EOF' > .env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://kundanvision_postgres_user:V0n9FJhuJNh8DrbnHkUzLqQpnMRpaA5L@dpg-da8q9tm7bikc73d0ckbg-a.ohio-postgres.render.com/kundanvision_postgres
GEMINI_API_KEY=your_gemini_key_here
PAYPAL_CLIENT_ID=BAAv8rRenc5jlfD6eH_8pvgcU250jXTZCnyPKdBby13EAYRKhCempoPQ3Hj41GEfe2qBMu1P8ZslnbdkIc
PAYPAL_CLIENT_SECRET=EH8CcxBIVPvFhoAKbL-HN8l_jSdOYzlGA2oahgGs1wPV7bogYK_TE4hIOjPtzOVj-mOUUXVy8uMIt6-N
PAYPAL_RECEIVER_EMAIL=kundank4@icloud.com
PAYPAL_ME_USERNAME=ky8402
PAYPAL_MODE=live
AUTO_HEAL_ENABLED=true
ML_ENABLED=true
EOF
```

Run build:
```bash
npm run build
```

### Step 4: Start with PM2 Process Manager
```bash
pm2 start dist/server.cjs --name "gigpilot"
pm2 save
pm2 startup
```

### Step 5: Configure Nginx Reverse Proxy (Port 80/443 &rarr; Port 3000)
Create Nginx configuration:
```bash
sudo tee /etc/nginx/sites-available/gigpilot << 'EOF'
server {
    listen 80;
    server_name yourdomain.com; # or your EC2 Public IP

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/gigpilot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

*(Optional: Run `sudo apt install certbot python3-certbot-nginx -y && sudo certbot --nginx` to enable free HTTPS with Let's Encrypt).*

---

## Option 3: AWS Elastic Beanstalk

1. Open **[AWS Elastic Beanstalk](https://console.aws.amazon.com/elasticbeanstalk)**.
2. Click **Create Application**.
3. Application name: `gigpilot-platform`.
4. Platform: **Node.js** (Platform branch: **Node.js 20 running on 64bit Amazon Linux 2023**).
5. Under **Application code**, select **Upload your code** or deploy using the AWS EB CLI (`eb init` & `eb deploy`).
6. Under **Configuration** &rarr; **Software** &rarr; **Environment properties**, set the required environment variables (`DATABASE_URL`, `PAYPAL_CLIENT_ID`, etc.).
7. Click **Create App**.

---

## Verifying AWS Deployment

Once your AWS service is live, check the health endpoints:
```bash
# Lightweight ping (returns HTTP 200)
curl https://<YOUR-AWS-URL>/api/health/ping

# Full system diagnostic (PostgreSQL, PayPal OAuth2 REST, ML Ops, Self-Healer)
curl https://<YOUR-AWS-URL>/api/health
```
