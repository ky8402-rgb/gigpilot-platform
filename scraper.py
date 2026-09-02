import time
import logging
import requests
from database import save_lead
from bid_engine import match_project_to_package

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "FreelanceLeadFetcher/1.0 (+https://kundanvision369.onrender.com)"
}

def fetch_remoteok_leads() -> list:
    """Fetch recent engineering leads from RemoteOK public API."""
    logger.info("Fetching public leads from RemoteOK...")
    leads = []
    try:
        resp = requests.get("https://remoteok.com/api", headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            # First item in RemoteOK is disclaimer/metadata
            items = data[1:] if isinstance(data, list) and len(data) > 1 else []
            for item in items[:25]:
                title = item.get("position", "")
                company = item.get("company", "Remote Client")
                url = item.get("url", "")
                desc = item.get("description", "")
                
                if not title or not url:
                    continue
                    
                pkg, confidence = match_project_to_package(title, desc)
                lead_data = {
                    "job_title": title,
                    "company": company,
                    "source": "remoteok",
                    "url": url,
                    "matched_package": pkg["name"],
                    "similarity_score": round(confidence / 100.0, 2)
                }
                leads.append(lead_data)
                save_lead(lead_data)
        logger.info(f"RemoteOK ingested {len(leads)} potential leads.")
    except Exception as e:
        logger.error(f"RemoteOK lead fetch error: {e}")
    return leads

def fetch_weworkremotely_leads() -> list:
    """Fetch public developer leads from WeWorkRemotely public API."""
    logger.info("Fetching public leads from WeWorkRemotely...")
    leads = []
    try:
        resp = requests.get("https://we-work-remotely.com/api/jobs", headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            jobs_dict = data.get("jobs", {})
            for category, job_list in jobs_dict.items():
                for item in job_list[:10]:
                    title = item.get("title", "")
                    company = item.get("company_name", "WWR Client")
                    url = f"https://we-work-remotely.com{item.get('url', '')}"
                    desc = f"{item.get('description', '')} {item.get('summary', '')}"
                    
                    if not title or not url:
                        continue
                        
                    pkg, confidence = match_project_to_package(title, desc)
                    lead_data = {
                        "job_title": title,
                        "company": company,
                        "source": "weworkremotely",
                        "url": url,
                        "matched_package": pkg["name"],
                        "similarity_score": round(confidence / 100.0, 2)
                    }
                    leads.append(lead_data)
                    save_lead(lead_data)
        logger.info(f"WeWorkRemotely ingested {len(leads)} potential leads.")
    except Exception as e:
        logger.error(f"WeWorkRemotely lead fetch error: {e}")
    return leads

def scrape_external_leads() -> list:
    """Combines all public non-bidding lead sources."""
    all_leads = []
    all_leads.extend(fetch_remoteok_leads())
    time.sleep(1)
    all_leads.extend(fetch_weworkremotely_leads())
    return all_leads
