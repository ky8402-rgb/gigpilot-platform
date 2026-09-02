# Deploying GigPilot to Render

Your codebase is in your GitHub repository:
**[https://github.com/ky8402-rgb/gigpilot-platform](https://github.com/ky8402-rgb/gigpilot-platform)**

Render is fully supported with **zero-downtime healthcheck pings**, automated bundling (`Vite` + `esbuild` CommonJS Node server), and auto-deployment on every push to `main`.

---

## Quick Deploy Option 1: 1-Click Render Blueprint (Recommended)

1. Go to **[dashboard.render.com/blueprints](https://dashboard.render.com/blueprints)** (or click **New +** &rarr; **Blueprint**).
2. Connect your GitHub account and select **`ky8402-rgb/gigpilot-platform`**.
3. Render automatically reads `render.yaml` from the repository root:
   - **Service Name**: `gigpilot-platform`
   - **Environment**: `Node`
   - **Plan**: `Free` (or Starter)
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health/ping`
4. Fill in the required environment variables:
   - `DATABASE_URL`: `postgresql://kundanvision_postgres_user:V0n9FJhuJNh8DrbnHkUzLqQpnMRpaA5L@dpg-da8q9tm7bikc73d0ckbg-a.ohio-postgres.render.com/kundanvision_postgres` (or select your existing Render PostgreSQL instance).
   - `GEMINI_API_KEY`: *(Your Google Gemini API Key)*
   - `FREELANCER_ACCESS_TOKEN`: *(Your Freelancer.com API Token)*
   - `PAYPAL_CLIENT_ID` & `PAYPAL_CLIENT_SECRET`: *(Your PayPal REST API credentials)*
5. Click **Apply**. Render will build and deploy the application with a public HTTPS URL (e.g. `https://gigpilot-platform.onrender.com`).

---

## Option 2: Standard Render Web Service

If you prefer to create a Web Service manually:

1. In Render Dashboard, click **New +** &rarr; **Web Service**.
2. Select your repository: **`ky8402-rgb/gigpilot-platform`**.
3. Fill in the settings:
   - **Name**: `gigpilot-platform`
   - **Region**: `Ohio (US East)` (matches your PostgreSQL database)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
4. Under **Advanced** &rarr; **Health Check Path**, enter:
   ```text
   /api/health/ping
   ```
5. Under **Environment Variables**, add:
   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` |
   | `DATABASE_URL` | `postgresql://kundanvision_postgres_user:V0n9FJhuJNh8DrbnHkUzLqQpnMRpaA5L@dpg-da8q9tm7bikc73d0ckbg-a.ohio-postgres.render.com/kundanvision_postgres` |
   | `GEMINI_API_KEY` | *(Your Gemini API key)* |
   | `PAYPAL_RECEIVER_EMAIL` | `kundank4@icloud.com` |
   | `PAYPAL_ME_USERNAME` | `ky8402` |
   | `PAYPAL_MODE` | `live` |
   | `PAYPAL_CLIENT_ID` | *(Your PayPal Client ID)* |
   | `PAYPAL_CLIENT_SECRET` | *(Your PayPal Client Secret)* |
   | `FREELANCER_ACCESS_TOKEN` | *(Your Freelancer Token)* |
   | `AUTO_HEAL_ENABLED` | `true` |
   | `ML_ENABLED` | `true` |
6. Click **Create Web Service**.

---

## Native Auto-Deploy on Git Push

Whenever code is updated or pushed to GitHub:
1. Render receives a webhook notification from GitHub.
2. Render triggers a zero-downtime build.
3. Tests and environment checks run automatically.
4. Render deploys the updated version and routes traffic seamlessly once `/api/health/ping` reports healthy.
