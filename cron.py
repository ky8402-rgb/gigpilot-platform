import time
import logging
import requests
from typing import Dict, Any, List
from freelancer_client import FreelancerClient
import bid_engine
import database

logger = logging.getLogger("cron")

def scrape_remoteok_leads(limit: int = 10) -> List[Dict[str, Any]]:
    """
    Scrapes high-quality remote leads from RemoteOK API.
    """
    url = "https://remoteok.com/api"
    headers = {
        "User-Agent": "GigPilot-Autonomous-Bot/1.0 (Mozilla/5.0)"
    }
    leads_saved = []
    try:
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code == 200:
            data = resp.json()
            # RemoteOK returns metadata in first element
            jobs = [j for j in data if isinstance(j, dict) and j.get("id")]
            for job in jobs[:limit]:
                title = job.get("position") or "Remote Developer"
                company = job.get("company") or "Remote Team"
                source_url = job.get("url") or f"https://remoteok.com/l/{job.get('id')}"
                tags = " ".join(job.get("tags", []))
                pkg_key = bid_engine.match_package(title, tags)
                lead_id = f"lead_rok_{job.get('id')}"

                lead_record = {
                    "id": lead_id,
                    "job_title": title,
                    "company": company,
                    "source": "RemoteOK",
                    "url": source_url,
                    "matched_package": pkg_key,
                    "similarity_score": 0.92
                }
                database.save_lead(lead_record)
                leads_saved.append(lead_record)
    except Exception as e:
        logger.error(f"Error scraping RemoteOK leads: {e}")

    return leads_saved

def find_and_bid() -> Dict[str, Any]:
    """
    Searches Freelancer.com active projects and auto-dispatches proposals.
    Also syncs scored leads.
    """
    logger.info("Executing find_and_bid cron job...")
    fl_client = FreelancerClient()
    
    # 1. Search projects across target niches
    niches = ["fullstack python react", "fastapi backend", "ai agent bot", "stripe payment integration"]
    placed_bids = []

    for query in niches:
        projects = fl_client.search_projects(query, limit=3)
        for proj in projects:
            record = bid_engine.process_and_place_bid(proj, fl_client)
            if record:
                placed_bids.append(record)
        time.sleep(1)

    # 2. Sync fresh leads for pipeline
    saved_leads = scrape_remoteok_leads(limit=5)

    return {
        "success": True,
        "bids_placed": len(placed_bids),
        "bids": placed_bids,
        "leads_synced": len(saved_leads)
    }

def sync_bids() -> Dict[str, Any]:
    """
    Checks status of all active/pending bids and updates database.
    """
    logger.info("Executing sync_bids cron job...")
    fl_client = FreelancerClient()
    active_bids = [b for b in database.get_bids(limit=100) if b.get("status") in ("pending", "viewed", "interviewing")]
    updated_count = 0

    for bid in active_bids:
        bid_id = bid.get("id")
        new_status = fl_client.get_bid_status(bid_id)
        if new_status and new_status != bid.get("status"):
            database.update_bid_status(bid_id, new_status)
            updated_count += 1

    return {
        "success": True,
        "checked": len(active_bids),
        "updated": updated_count
    }
