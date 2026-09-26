# 🚀 GigPilot - Autonomous Crypto Grid Trading Platform

Production-grade Autonomous Crypto Grid Trading Platform featuring live exchange execution (Bybit), adaptive grid placement, quantitative risk guardrails, real-time telemetry, and automated wallet profit sweeping.

---

## 🌟 Core Architecture & Features

- **Autonomous Grid Engine**: Geometric and arithmetic grid placement with live order execution and dynamic spread management.
- **Risk Guardrails & Circuit Breakers**: Max drawdown protection, position size throttling, volatility scaling, and emergency kill switches.
- **Multi-Level Autonomy**: Configurable from full manual assist (Level 0) to autonomous parameter adaptation (Level 4).
- **Automated Profit Sweeper**: Real-time monitoring and threshold-based profit extraction to self-custody wallet addresses.
- **AI Market Analyst**: Server-side Google Gemini 2.5 integration for quantitative market structure analysis and volatility forecasting.
- **Production DevOps**: Automated dual-target CI/CD deploying Frontend to AWS Amplify and Backend to AWS EC2 with systemd and PM2.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Comprehensive system, database, and trading engine health telemetry |
| `GET` | `/api/trading/state` | Live trading state, portfolio metrics, active grid, and recent executions |
| `POST` | `/api/trading/grid/configure` | Deploy or update grid bounds, spacing, and capital allocation |
| `POST` | `/api/trading/kill-switch` | Global emergency trading halt and open order cancellation |
| `POST` | `/api/trading/profit-sweep/trigger` | Manually or autonomously extract realized profits to destination wallet |
| `POST` | `/api/deploy` | GitOps push-to-deploy trigger for AWS EC2 and Amplify synchronization |

---

## 🚀 Deployment (AWS EC2 & Amplify)

- **Backend API Service (AWS EC2)**: `https://35-154-110-156.sslip.io`
- **Frontend / Client Service**: AWS Amplify production distribution

---

## 🛠️ Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start development server (Port 3000)
npm run dev

# 3. Build for production
npm run build

# 4. Start production server
npm start
```
