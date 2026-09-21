import os
import secrets
import logging
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Depends, HTTPException, status, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

import database
import cron

# Logging Configuration
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("fastapi_main")

# Initialize database schema and initial data
database.init_db()

app = FastAPI(
    title="GigPilot Autonomous Freelance Backend",
    description="FastAPI Backend for auto-bidding, proposal analytics, and leads pipeline",
    version="1.0.0"
)

# CORS Middleware (Allows frontend, local development, and external clients)
_allowed_origins = [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if not _allowed_origins:
    _allowed_origins = ["http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Jinja2 Templates setup
templates = Jinja2Templates(directory="templates")
security = HTTPBasic()

def authenticate_admin(credentials: HTTPBasicCredentials = Depends(security)):
    expected_user = os.getenv("DASHBOARD_USERNAME", "").strip()
    expected_pass = os.getenv("DASHBOARD_PASSWORD", "")
    if not expected_user or not expected_pass:
        raise HTTPException(status_code=503, detail="Dashboard credentials are not configured.")
    
    is_correct_username = secrets.compare_digest(credentials.username.encode("utf8"), expected_user.encode("utf8"))
    is_correct_password = secrets.compare_digest(credentials.password.encode("utf8"), expected_pass.encode("utf8"))
    
    if not (is_correct_username and is_correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

# =========================================================================
# REQUIRED PRODUCTION API ENDPOINTS
# =========================================================================

# 1. GET /health
@app.get("/health")
def health_check():
    return {"status": "healthy"}

# Also expose /api/health for standard health probes
@app.get("/api/health")
def api_health_check():
    return {"status": "healthy"}

# 2. GET /api/bids/stats
@app.get("/api/bids/stats")
def get_bids_stats(username: str = Depends(authenticate_admin)):
    """
    Returns aggregated stats: { total, active, won, earned, win_rate, package_counts }
    """
    try:
        stats = database.get_stats()
        return stats
    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 3. GET /api/bids?limit=50
@app.get("/api/bids")
def get_bids_list(limit: int = Query(default=50, ge=1, le=100), username: str = Depends(authenticate_admin)):
    """
    Returns list of bids: [ { id, job_title, company, package, bid_amount, status, submitted_at }, ... ]
    """
    try:
        bids = database.get_bids(limit=limit)
        return bids
    except Exception as e:
        logger.error(f"Error fetching bids: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 4. GET /api/leads?limit=20
@app.get("/api/leads")
def get_leads_list(limit: int = Query(default=20, ge=1, le=100), username: str = Depends(authenticate_admin)):
    """
    Returns list of leads: [ { job_title, company, source, matched_package, created_at }, ... ]
    """
    try:
        leads = database.get_recent_leads(limit=limit)
        return leads
    except Exception as e:
        logger.error(f"Error fetching leads: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# =========================================================================
# CRON JOB AUTOMATION ENDPOINTS
# =========================================================================

# 5. GET /api/cron/find-and-bid
@app.get("/api/cron/find-and-bid")
def trigger_find_and_bid(username: str = Depends(authenticate_admin)):
    """
    Searches Freelancer projects matching keywords, generates AI cover letters,
    places bids, and scrapes fresh remote leads.
    """
    try:
        result = cron.find_and_bid()
        return result
    except Exception as e:
        logger.error(f"Error in find-and-bid cron: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 6. GET /api/cron/sync-bids
@app.get("/api/cron/sync-bids")
def trigger_sync_bids(username: str = Depends(authenticate_admin)):
    """
    Synchronizes status of all pending/active bids with Freelancer.com API.
    """
    try:
        result = cron.sync_bids()
        return result
    except Exception as e:
        logger.error(f"Error in sync-bids cron: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# =========================================================================
# ADMIN DASHBOARD TEMPLATE (PASSWORD PROTECTED)
# =========================================================================

# 7. GET /dashboard
@app.get("/dashboard", response_class=HTMLResponse)
def get_admin_dashboard(request: Request, username: str = Depends(authenticate_admin)):
    stats = database.get_stats()
    bids = database.get_bids(limit=25)
    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "username": username,
        "stats": stats,
        "bids": bids
    })

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main.py:app", host="0.0.0.0", port=port, reload=False)
