# Deploying GigPilot to Amazon Web Services (AWS)

This guide provides step-by-step instructions to deploy **GigPilot Platform** (`ky8402-rgb/gigpilot-platform`) on AWS.

> ⚠️ **IMPORTANT: AWS Free Tier Notice & App Runner Limitations**
> - **Why App Runner fails on Free Tier accounts**:
>   1. **Region Availability**: AWS App Runner is **NOT available in `ap-south-1` (Mumbai)** and many regional zones. It is only available in select regions (`us-east-1`, `us-east-2`, `us-west-2`, `eu-west-1`, `ap-northeast-1`).
>   2. **No Perpetual Free Tier**: App Runner charges ~$0.007/GB-hour for provisioned memory even while idle. New free tier accounts often lack service quotas or receive permission errors.
> - **The 100% Free Solution on AWS**: Use **AWS EC2 (`t2.micro` or `t3.micro`)**. AWS includes **750 hours per month 100% FREE for 12 months** (which covers 24/7 non-stop execution every month without any charge).

| Method | Best For | Difficulty | Cost | Supported in `ap-south-1` |
|---|---|---|---|---|
| **Option 1: AWS S3 + CloudFront** | Production Frontend (Vite/React), global CDN, custom domain, Vercel-like CI/CD | 🟢 Recommended | Free Tier (5GB S3, 1TB CloudFront/mo) | ✅ Yes |
| **Option 2: AWS Amplify Hosting** | Frontend (React/Vite), global CloudFront CDN, automatic SSL | 🟢 Easiest | Free Tier (1000 build min/mo) | ✅ Yes |
| **Option 3: AWS EC2 (t2.micro/t3.micro)** | 100% Free Tier backend (Node 20, Nginx, PostgreSQL, PM2) | 🟢 1-Click Script | **100% Free Tier (750 hrs/mo)** | ✅ Yes (Mumbai & worldwide) |
| **Option 4: AWS App Runner** | Managed containers (Requires paid/authorized account in US/EU) | 🟡 Moderate | Pay-per-vCPU / Not Free | ❌ Not in `ap-south-1` |

---

## Deploying the Frontend with AWS S3 + CloudFront (Vercel-like Automated Pipeline)

This architecture provides the exact same high-performance developer experience as Vercel or Cloudflare Pages, backed by AWS's global edge network (450+ points of presence), Origin Access Control (OAC), and instant cache invalidations on every `git push`.

```
┌──────────────────┐       git push        ┌──────────────────────────────────┐
│ Developer / Git  │ ────────────────────> │ GitHub Actions CI/CD             │
│ (main branch)    │                       │ (npm ci && npm run build)        │
└──────────────────┘                       └────────────────┬─────────────────┘
                                                            │
                     ┌──────────────────────────────────────┴──────────────────────────────────────┐
                     ▼                                                                             ▼
           Immutable Hashed Chunks                                                      Entry Files & HTML
           (assets/*.js, assets/*.css)                                                  (index.html, sw.js)
           Cache: max-age=31536000, immutable                                           Cache: max-age=0, must-revalidate
                     │                                                                             │
                     └──────────────────────────────┬──────────────────────────────────────────────┘
                                                    ▼
                                       ┌─────────────────────────┐
                                       │ Amazon S3 Bucket        │
                                       │ (Private, OAC-enforced) │
                                       └────────────┬────────────┘
                                                    │ S3 Origin Access Control (OAC)
                                                    ▼
                                       ┌─────────────────────────┐
                                       │ Amazon CloudFront CDN   │ <--- Cache Invalidation (/*)
                                       │ (Global Edge Caching,   │
                                       │  SPA 200 Rewrite Rules) │
                                       └────────────┬────────────┘
                                                    │
                             ┌──────────────────────┴──────────────────────┐
                             ▼                                             ▼
                   Static Content (/*)                           API Calls (/api/*)
                   Served from S3                                Forwarded to EC2 / App Runner
                             │                                             │
                             └──────────────────────┬──────────────────────┘
                                                    ▼
                                       ┌─────────────────────────┐
                                       │ Client Web Browser      │
                                       └─────────────────────────┘
```

---

### Step 1: Create a Private Amazon S3 Bucket

1. Open the **[Amazon S3 Console](https://console.aws.amazon.com/s3)**.
2. Click **Create bucket**.
3. Configure the bucket:
   - **Bucket name**: e.g., `gigpilot-frontend-prod-app` (must be globally unique).
   - **AWS Region**: Select **Asia Pacific (Mumbai) `ap-south-1`** (or your primary region).
   - **Object Ownership**: Leave as **ACLs disabled (recommended)**.
   - **Block Public Access settings for this bucket**: Keep **Block *all* public access** checked ✅ (CloudFront accesses the bucket securely via OAC; the bucket does **not** need to be public).
   - **Bucket Versioning**: Enabled (recommended for rollbacks) or Disabled.
   - **Default encryption**: Leave as Amazon S3-managed keys (SSE-S3).
4. Click **Create bucket**.

---

### Step 2: Create an Amazon CloudFront Distribution

1. Open the **[CloudFront Console](https://console.aws.amazon.com/cloudfront)**.
2. Click **Create a CloudFront distribution**.
3. Configure **Origin Settings**:
   - **Origin domain**: Click the dropdown and select your S3 bucket (e.g. `gigpilot-frontend-prod-app.s3.ap-south-1.amazonaws.com`).
   - **Origin access**: Select **Origin access control settings (recommended)**.
   - Click **Create control setting**:
     - Name: `gigpilot-s3-oac`
     - Signing behavior: **Sign requests (recommended)**
     - Origin type: **S3**
     - Click **Create**.
4. Configure **Default Cache Behavior**:
   - **Viewer protocol policy**: Select **Redirect HTTP to HTTPS**.
   - **Allowed HTTP methods**: Select `GET, HEAD, OPTIONS`.
   - **Cache key and origin requests**: Select **Cache policy and origin request policy (recommended)**.
   - **Cache policy**: Select **`CachingOptimized`** (Managed policy).
5. Configure **Web Application Firewall (WAF)**:
   - Select **Do not enable security protections** (to remain within Free Tier limits) or choose existing web ACL.
6. Configure **Settings**:
   - **Price class**: Select **Use North America, Europe, Asia, Middle East, and Africa** (or *Use all edge locations*).
   - **Default root object**: Enter **`index.html`** *(critical)*.
7. Click **Create distribution**.

---

### Step 3: Apply the S3 Bucket Policy for CloudFront OAC

Once created, CloudFront displays a yellow banner stating: *"The S3 bucket policy needs to be updated"*.
1. Click **Copy policy**.
2. Go back to your S3 bucket in the S3 console &rarr; click the **Permissions** tab.
3. Scroll down to **Bucket policy** &rarr; click **Edit**.
4. Paste the policy (it grants `s3:GetObject` permission strictly to your CloudFront distribution ARN):

```json
{
  "Version": "2012-10-17",
  "Statement": {
    "Sid": "AllowCloudFrontServicePrincipalReadOnly",
    "Effect": "Allow",
    "Principal": {
      "Service": "cloudfront.amazonaws.com"
    },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::<YOUR-S3-BUCKET-NAME>/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "arn:aws:cloudfront::<YOUR-AWS-ACCOUNT-ID>:distribution/<YOUR-DISTRIBUTION-ID>"
      }
    }
  }
}
```
5. Click **Save changes**.

---

### Step 4: Configure SPA Custom Error Responses (Vercel-like Routing)

Because React and Vite use client-side routing (e.g., `/settings`, `/proposals`), requesting any non-root path directly causes S3 to return a `403 Forbidden` or `404 Not Found`. CloudFront must rewrite these to `/index.html` with an HTTP 200 status.

1. In the **CloudFront Console**, click on your distribution.
2. Click the **Error pages** tab &rarr; click **Create custom error response**.
3. Create Rule 1:
   - **HTTP error code**: `403: Forbidden`
   - **Customize error response**: Yes
   - **Response page path**: `/index.html`
   - **HTTP response code**: `200: OK`
   - Click **Create custom error response**.
4. Create Rule 2:
   - Click **Create custom error response** again.
   - **HTTP error code**: `404: Not Found`
   - **Customize error response**: Yes
   - **Response page path**: `/index.html`
   - **HTTP response code**: `200: OK`
   - Click **Create custom error response**.

---

### Step 5: (Optional) Dual-Origin API Reverse Proxy in CloudFront

To avoid all CORS issues and avoid mixing HTTP/HTTPS between CloudFront and your EC2 backend, route `/api/*` requests through the same CloudFront distribution:

1. In CloudFront &rarr; click the **Origins** tab &rarr; click **Create origin**.
   - **Origin domain**: Enter your EC2 Public DNS or IP (e.g., `ec2-13-233-xx-xx.ap-south-1.compute.amazonaws.com`).
   - **Protocol**: **HTTP only** (Port 80) or HTTPS (Port 443 if SSL is installed).
   - **Name**: `EC2-Backend-API`.
   - Click **Create origin**.
2. Click the **Behaviors** tab &rarr; click **Create behavior**.
   - **Path pattern**: `/api/*`
   - **Origin**: Select `EC2-Backend-API`.
   - **Viewer protocol policy**: **Redirect HTTP to HTTPS**.
   - **Allowed HTTP methods**: `GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE`.
   - **Cache policy**: Select **`CachingDisabled`** (ensures API calls are never cached).
   - **Origin request policy**: Select **`AllViewerExceptHostHeader`**.
   - Click **Create behavior**.

---

### Step 6: Automated Vercel-like CI/CD Pipeline (GitHub Actions)

The repository already includes the production workflow in **`.github/workflows/deploy-s3-cloudfront.yml`**. On every commit to `main`, GitHub Actions:
1. Installs Node.js 20 and runs tests/linter.
2. Compiles the Vite application into `dist/`.
3. Synchronizes hashed static assets (`/assets/*`) with **1-year immutable caching** (`max-age=31536000, immutable`).
4. Synchronizes HTML and service worker files with **`max-age=0, must-revalidate`** (so users instantly receive updates).
5. Automatically invalidates the CloudFront cache (`/*`), propagating changes to 450+ edge locations in seconds.

#### Add Secrets in GitHub:
Navigate to your GitHub repository: **Settings &rarr; Secrets and variables &rarr; Actions &rarr; New repository secret**:

| Secret Name | Description | Example |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | IAM User Access Key | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | IAM User Secret Key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `AWS_S3_BUCKET` | The name of your S3 bucket | `gigpilot-frontend-prod-app` |
| `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront Distribution ID | `E123EXAMPLE456` |
| `AWS_REGION` | AWS Region of your S3 bucket | `ap-south-1` |
| `VITE_BACKEND_URL` | Live backend URL (if not using CloudFront proxy) | `http://<YOUR-EC2-PUBLIC-IP>` |

#### Minimum IAM Policy for GitHub Actions:
Attach this policy to the IAM user whose credentials you store in GitHub Secrets:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3SyncPermissions",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::<YOUR-S3-BUCKET-NAME>",
        "arn:aws:s3:::<YOUR-S3-BUCKET-NAME>/*"
      ]
    },
    {
      "Sid": "CloudFrontInvalidationPermissions",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation"
      ],
      "Resource": "arn:aws:cloudfront::<YOUR-ACCOUNT-ID>:distribution/<YOUR-DISTRIBUTION-ID>"
    }
  ]
}
```

---

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

#### Step 2: Automated Rewrites in `amplify.yml` (No Manual Console Setup Required)
The repository now defines `customRules` directly in `amplify.yml` using relative paths, completely avoiding the AWS console `BadRequestException: HTTP URLs cannot be used in custom rules`:

```yaml
customRules:
  - source: '/api/<*>'
    target: '/api/<*>'
    status: '200'
  - source: '</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|html)$)([^.]+$)/>'
    target: '/index.html'
    status: '200'
```

If you ever need to view or edit these in the **AWS Amplify Console**:
1. Open your app (`d2qe2q720fbn3x`).
2. Go to **App settings** &rarr; **Rewrites and redirects**.
3. Notice that relative paths (`/api/<*> -> /api/<*>`) are natively accepted without HTTP validation errors.


#### Step 3: Trigger a Re-deploy
In AWS Amplify, click **Run build** (or push any commit to `main`). AWS Amplify will execute `npm run build`, pick up `dist/`, and serve your app at `https://d2qe2q720fbn3x.amplifyapp.com`.

#### Step 4: Add Custom Domain in AWS Amplify (CLI & 1-Click Script)

You can attach your custom domain (e.g. `gigpilot.com`, `www.gigpilot.com`, or any domain) using our automated script or the AWS Console:

##### Automated Setup (1-Command):
```bash
./scripts/add-amplify-domain.sh --domain gigpilot.com
```

##### Or via AWS Amplify Console:
1. Open the [AWS Amplify Console](https://console.aws.amazon.com/amplify/home) &rarr; Select your app (`d2qe2q720fbn3x`).
2. In the left navigation menu, click **App settings** &rarr; **Domain management**.
3. Click the orange **Add domain** button.
4. Type your domain (e.g. `gigpilot.com`) and click **Configure domain**.
5. Map subdomains:
   - Root (`@`) &rarr; branch `main`
   - `www` &rarr; branch `main`
6. Click **Save**. AWS Amplify automatically provisions a free SSL certificate via AWS Certificate Manager (ACM).
7. At your domain registrar (GoDaddy, Cloudflare, Namecheap, Route 53), add the CNAME / ALIAS records displayed by Amplify:
   - `CNAME`: `www` &rarr; `d2qe2q720fbn3x.amplifyapp.com`
   - `ALIAS` / `A`: `@` &rarr; AWS CloudFront / Amplify distribution
8. Backend CORS is already pre-configured to automatically allow `gigpilot.com`, `*.gigpilot.com`, and any custom origin.

---

## Required Environment Variables for AWS

Regardless of the method chosen, prepare these environment variables:

| Variable | Description | Example / Default |
|---|---|---|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Web server listening port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` (Neon or AWS RDS) |
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

## Automated Backend Deployment on AWS App Runner (with `apprunner.yaml`)

AWS App Runner provides 100% automated backend deployment on every `git push`. The repository now includes the native `apprunner.yaml` configuration file.

### Step 1: Create the Backend Service
1. Navigate to the **[AWS App Runner Console](https://console.aws.amazon.com/apprunner)**.
2. Click **Create an App Runner service**.

### Step 2: Connect Repository & Enable Auto-Deploy
1. Under **Repository type**, select **Source code repository**.
2. Connect your GitHub account and select repository: **`ky8402-rgb/gigpilot-platform`**.
3. Branch: **`main`**.
4. Under **Deployment trigger**, select **Automatic** (this automatically triggers a new deployment on every Git push).

### Step 3: Configure using `apprunner.yaml`
1. Under **Configuration file**, select **Use a configuration file**.
   - App Runner will automatically read `apprunner.yaml` from your repository root!
   - It automatically runs:
     ```bash
     npm ci || npm install
     npm run build
     node dist/server.cjs
     ```
   - Port: `3000`

### Step 4: Add Environment Variables
Add your production variables in the App Runner console:
- `NODE_ENV`: `production`
- `DATABASE_URL`: `postgresql://neondb_owner:npg_L6xTbr0PsJuG@ep-green-bread-ae4bhk9u-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
- `PAYPAL_CLIENT_ID`: `BAAv8rRenc5jlfD6eH_8pvgcU250jXTZCnyPKdBby13EAYRKhCempoPQ3Hj41GEfe2qBMu1P8ZslnbdkIc`
- `PAYPAL_CLIENT_SECRET`: `EH8CcxBIVPvFhoAKbL-HN8l_jSdOYzlGA2oahgGs1wPV7bogYK_TE4hIOjPtzOVj-mOUUXVy8uMIt6-N`
- `PAYPAL_MODE`: `live`
- `GEMINI_API_KEY`: *(Your Google Gemini API Key)*
- `AUTO_HEAL_ENABLED`: `true`
- `ML_ENABLED`: `true`

### Step 5: Configure Health Check
- Protocol: `HTTP`
- Path: `/api/health/ping`
- Interval: `10s`, Timeout: `5s`, Healthy threshold: `1`

Click **Create & deploy**. Every future `git push origin main` will build and deploy the backend automatically!

---

## Option 2: AWS EC2 (100% Free Tier - t2.micro / t3.micro)

AWS gives you **750 hours of free EC2 compute every single month for 12 months** plus **30 GB of free EBS SSD storage**. This allows your GigPilot backend to run 24 hours a day, 7 days a week, at zero cost.

### Method A: 1-Click Automated Launch via "User Data" (Fastest - No SSH required!)

1. Open **[AWS EC2 Launch Instance Console](https://console.aws.amazon.com/ec2/home#LaunchInstances:)** (ensure region is **ap-south-1 Mumbai** or your preferred region).
2. **Name**: `gigpilot-backend`
3. **OS Image**: Select **Ubuntu** (Ubuntu Server 24.04 LTS or 22.04 LTS 64-bit x86).
4. **Instance Type**: Select **`t2.micro`** or **`t3.micro`** (labeled *"Free tier eligible"*).
5. **Key pair (login)**: Select an existing key or choose *"Proceed without a key pair"* if using User Data.
6. **Network settings (Firewall)**:
   - Check ✅ **Allow SSH traffic**
   - Check ✅ **Allow HTTP traffic from the internet** (port 80)
   - Check ✅ **Allow HTTPS traffic from the internet** (port 443)
7. Scroll down to **Advanced details** &rarr; expand **User data** (the bottom text box).
8. Copy and paste this script directly into **User data**:

```bash
#!/usr/bin/env bash
curl -fsSL https://raw.githubusercontent.com/ky8402-rgb/gigpilot-platform/main/scripts/ec2-free-tier-setup.sh | bash
```

9. Click **Launch instance**.
10. In ~2 minutes, your backend is live! In the EC2 console, copy the **Public IPv4 address** (e.g., `13.233.xx.xx`).
11. Test in your browser: `http://<YOUR-EC2-PUBLIC-IP>/api/health/ping` (returns `{"status":"healthy"}`).

---

### Method B: Manual Setup via SSH (If you prefer connecting via terminal)

#### Step 1: Connect to EC2
```bash
ssh -i your-key.pem ubuntu@<YOUR-EC2-PUBLIC-IP>
```

#### Step 2: Run the automated setup script
```bash
curl -fsSL https://raw.githubusercontent.com/ky8402-rgb/gigpilot-platform/main/scripts/ec2-free-tier-setup.sh | bash
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
DATABASE_URL=postgresql://neondb_owner:npg_L6xTbr0PsJuG@ep-green-bread-ae4bhk9u-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
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
