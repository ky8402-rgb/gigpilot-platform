import time
import logging
from typing import Dict, Any, List
from freelancer_client import FreelancerClient
import bid_engine
import database
from scraper import scrape_external_leads

logger = logging.getLogger("cron")

def sync_scraping_leads(limit: int = 10) -> List[Dict[str, Any]]:
    """
    Syncs verified scraping freelance leads from Upwork (OAuth) and Contra.
    RemoteOK, FlexJobs, and WeWorkRemotely are strictly excluded.
    """
    leads = scrape_external_leads()
    return leads[:limit]

def find_and_bid() -> Dict[str, Any]:
    """
    Searches Freelancer.com active scraping projects and auto-dispatches proposals.
    Strictly restricted to scraping whitelist and tiered pricing.
    """
    logger.info("Executing find_and_bid cron job for data-scraping jobs only...")
    fl_client = FreelancerClient()
    
    # Strictly scraping/extraction niches
    scraping_niches = [
        "web scraping",
        "data extraction",
        "lead generation",
        "google maps scraper",
        "product catalog scraper csv"
    ]
    placed_bids = []

    for query in scraping_niches:
        projects = fl_client.search_projects(query, limit=3)
        for proj in projects:
            record = bid_engine.process_and_place_bid(proj, fl_client)
            if record:
                placed_bids.append(record)
        time.sleep(1)

    # Sync fresh verified scraping leads from Upwork & Contra
    saved_leads = sync_scraping_leads(limit=5)

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
