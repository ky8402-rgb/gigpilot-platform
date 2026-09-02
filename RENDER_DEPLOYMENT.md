# Deploying GigPilot to Render

This project is configured and ready for 1-click automated Git deployment on [Render](https://render.com) with native **Auto-Deploy** on every push to GitHub.

---

## Configuring Render 'Auto-Deploy' for Instant Updates

Render provides a native **Auto-Deploy** feature that automatically builds and deploys your application whenever a new commit is pushed to your connected GitHub branch (`main`).

### Step-by-Step Auto-Deploy Setup Guide:

1. **Connect GitHub to Render**:
   - Go to [dashboard.render.com](https://dashboard.render.com).
   - If connecting for the first time, click your profile avatar &rarr; **Account Settings** &rarr; **Connected Accounts** &rarr; Connect your **GitHub** account with read/write repo permissions.

2. **Enable Native Auto-Deploy on your Service**:
   - Select your Web Service in the Render Dashboard (e.g. `gigpilot-web` or `freelancer-autobid-engine`).
   - Click **Settings** in the left sidebar menu.
   - Scroll down to the **Auto-Deploy** section.
   - Set **Auto-Deploy** to **`Yes`** (Enabled).
   - Verify the **Branch** is set to `main`.
   - Click **Save Changes**.

3. **How It Works**:
   - Every time code is committed or merged to the `main` branch on GitHub:
     1. GitHub dispatches a webhook to Render.
     2. Render pulls the latest commits instantly.
     3. Render runs `npm run check:env && npm run build` (or Python setup).
     4. Render transitions traffic with **zero-downtime health check verification**.
     5. If a build fails, the previous working version remains online safely.

4. **Configuring Deploy Hooks (Alternative / Advanced CI/CD Trigger)**:
   - In Render Dashboard &rarr; Your Web Service &rarr; **Settings** &rarr; **Deploy Hook**.
   - Copy the unique **Deploy Hook URL** (e.g. `https://api.render.com/deploy/srv-xxxx?key=yyyy`).
   - In your GitHub repository:
     - Go to **Settings** &rarr; **Secrets and variables** &rarr; **Actions**.
     - Add a new repository secret named `RENDER_DEPLOY_HOOK_URL` and paste the URL.
   - The included `.github/workflows/deploy.yml` workflow will automatically trigger this hook after running tests and deploying the frontend to GitHub Pages!

---

## Method 1: Deploy via GitHub (Standard Web Service)

1. **Push your code to GitHub**:
   - In Google AI Studio, click the **Settings / Export** menu and export to GitHub (or download ZIP and push to a new GitHub repo).

2. **Log into Render**:
   - Go to [dashboard.render.com](https://dashboard.render.com).
   - Click **New +** → **Web Service**.

3. **Connect Repository**:
   - Select your GitHub repository.

4. **Configure Web Service**:
   - **Name**: `gigpilot-web`
   - **Language / Runtime**: `Node`
   - **Branch**: `main`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Auto-Deploy**: `Yes`
   - **Instance Type**: Free

5. **Set Environment Variables** (under *Environment Variables* section):
   | Variable | Value / Description |
   |---|---|
   | `NODE_VERSION` | `20` |
   | `NODE_ENV` | `production` |
   | `PAYPAL_RECEIVER_EMAIL` | `kundank4@icloud.com` |
   | `PAYPAL_ME_USERNAME` | `ky8402` |
   | `PAYPAL_MODE` | `live` |
   | `PAYPAL_WEBHOOK_ID` | `2BL477687P123401A` |
   | `PAYPAL_CLIENT_ID` | `ActZcBABekzSaq6kvVL_s3ITIvcc0RsjabBGCmNCJZE0LanSUtxLwOBQjWz8y2_dNhsISLSXOYaz4Ls3` |
   | `PAYPAL_CLIENT_SECRET` | `EOKsiNxR314HMHXiwyEoT771jbHrRpInGi6Ybh1zIc2DVv7cXApb9NoggUdoVH46RFGekUZWrIC6XIQn` |
   | `FREELANCER_ACCESS_TOKEN` | `3PKsiB3m736mE0wnirnHeLTUzLP1xc` |
   | `GEMINI_API_KEY` | *(Your Google Gemini API Key from AI Studio)* |

6. **Click "Create Web Service"**:
   - Render will build the Vite frontend bundle and start the Node Express server.
   - You will receive a live production URL: `https://your-app-name.onrender.com`.

---

## Method 2: Blueprint Deployment (`render.yaml`)

Because this repository contains a `render.yaml` blueprint:
1. In Render Dashboard, click **New +** → **Blueprint**.
2. Select your repository.
3. Render will read `render.yaml` and configure the Node web service, Python scraper engine, and Cron jobs automatically.
4. Set required secret keys and click **Apply**.

---

## Method 3: Automated GitHub Actions CI/CD Workflow (`.github/workflows/deploy.yml`)

The repository includes a GitHub Actions workflow that:
1. Runs automated TypeScript compilation and linting tests.
2. Checks environment credentials with `npm run check:env`.
3. Builds and deploys the static frontend to **GitHub Pages**.
4. Automatically triggers the Render backend deployment via Render REST API or Deploy Hook.


