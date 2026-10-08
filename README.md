# 🚀 GigPilot - Autonomous Crypto Grid Trading Platform

Production-grade Autonomous Crypto Grid Trading Platform featuring live exchange execution (Bybit), adaptive grid placement, quantitative risk guardrails, real-time telemetry, and automated wallet profit sweeping.

**The stack is 100% Python.** There is no Node runtime, no `package.json`, no bundler, and no
JavaScript or TypeScript file in this repository. The operator console is rendered server-side by the
same FastAPI process that serves the API.

---

## 🌟 Core Architecture & Features

- **Autonomous Grid Engine**: Geometric and arithmetic grid placement with live order execution and dynamic spread management.
- **Risk Guardrails & Circuit Breakers**: Max drawdown protection, position size throttling, volatility scaling, and emergency kill switches.
- **Multi-Level Autonomy**: Configurable from full manual assist (Level 0) to autonomous parameter adaptation (Level 4).
- **Automated Profit Sweeper**: Real-time monitoring and threshold-based profit extraction to self-custody wallet addresses.
- **Python Operator Console**: Server-rendered dashboard (Jinja2 templates under `gpkg/web/templates/`) with a session-scoped, in-memory API key/secret modal, the L2 ingestion progress bar, and live capital telemetry. No build step.
- **Production DevOps**: CI/CD deploying the FastAPI service to AWS EC2 under systemd, with the exact deployed revision verified by SHA.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Operator console (Python-rendered) |
| `GET` | `/login` | Owner sign-in |
| `GET` | `/api/health` | Comprehensive system, database, and trading engine health telemetry |
| `GET` | `/api/state` | Live state: portfolio, capital telemetry, L2 ingestion depth, markets, events |
| `POST` | `/api/arm` | Arm live trading for this session, optionally supplying the API key/secret pair |
| `POST` | `/api/disarm` | Disarm and scrub the session secret |
| `GET` | `/events` | Server-sent event stream driving the live console |
| `POST` | `/api/trading/kill-switch` | Global emergency trading halt and open order cancellation |
| `POST` | `/api/trading/profit-sweep/trigger` | Manually or autonomously extract realized profits to destination wallet |

---

## 🚀 Deployment (AWS EC2)

- **Application service**: `https://35-154-110-156.sslip.io`

Deployment is handled by `.github/workflows/python-deploy.yml`, which runs the full Python gate
suite and then invokes `scripts/deploy-ec2.sh` over SSH. The host pulls the revision itself with
`git reset --hard origin/main`; nothing is bundled or uploaded from CI.

---

## 🛠️ Local Development

```bash
# 1. Create a virtual environment and install dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt

# 2. Run the validation suite
.venv/bin/python -m pytest tests/ -q --no-header
.venv/bin/python -m ruff check .
.venv/bin/python -m flake8 .
.venv/bin/python -m mypy .

# 3. Start the engine and console
.venv/bin/python gigpilot.py
#    Console: http://127.0.0.1:8001/
```
