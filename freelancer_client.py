import os
import requests
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("freelancer_client")

FREELANCER_BASE_URL = "https://api.freelancer.com/api"

class FreelancerClient:
    def __init__(self, access_token: Optional[str] = None):
        self.access_token = (
            access_token
            or os.getenv("FREELANCER_ACCESS_TOKEN")
            or os.getenv("FREELANCER_AUTH_TOKEN")
            or os.getenv("FREELANCER_SESSION")
            or "3PKsiB3m736mE0wnirnHeLTUzLP1xc"
        ).strip()
        self.headers = {
            "Content-Type": "application/json",
            "User-Agent": "FreelanceAutoBidder/1.0 (+https://kundanvision369.onrender.com)"
        }
        if self.access_token:
            self.headers["freelancer-oauth-v1"] = self.access_token
            self.headers["Authorization"] = f"Bearer {self.access_token}"
            self.headers["Cookie"] = f"freelancer_session={self.access_token}; auth_token={self.access_token}"

    def is_configured(self) -> bool:
        return bool(self.access_token and len(self.access_token) > 10)

    def search_projects(self, query: str = "fullstack python react", limit: int = 15) -> List[Dict[str, Any]]:
        """
        Searches Freelancer.com active projects matching keywords.
        """
        if not self.is_configured():
            logger.info("Freelancer access token not configured, returning empty search results.")
            return []

        url = f"{FREELANCER_BASE_URL}/projects/0.1/projects/active"
        params = {
            "query": query,
            "limit": limit,
            "compact": "true",
            "sort_field": "time_updated",
            "reverse_sort": "true"
        }
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                projects = data.get("result", {}).get("projects", [])
                return projects
            else:
                logger.warning(f"Freelancer search returned status {resp.status_code}: {resp.text}")
                return []
        except Exception as e:
            logger.error(f"Error calling Freelancer search API: {e}")
            return []

    def place_bid(self, project_id: int, amount: float, description: str, period_days: int = 4) -> Dict[str, Any]:
        """
        Places a proposal/bid on a Freelancer.com project.
        """
        if not self.is_configured():
            return {
                "success": False,
                "error": "FREELANCER_ACCESS_TOKEN is missing or unconfigured"
            }

        url = f"{FREELANCER_BASE_URL}/projects/0.1/bids/"
        payload = {
            "project_id": int(project_id),
            "bidder_id": None, # Inferred from OAuth token
            "amount": float(amount),
            "period": int(period_days),
            "description": description,
            "milestone_percentage": 100
        }

        try:
            resp = requests.post(url, headers=self.headers, json=payload, timeout=15)
            if resp.status_code in (200, 201):
                data = resp.json()
                bid_info = data.get("result", {})
                return {
                    "success": True,
                    "bid_id": str(bid_info.get("id") or f"fl_{project_id}"),
                    "data": bid_info
                }
            else:
                return {
                    "success": False,
                    "error": f"Freelancer API error ({resp.status_code}): {resp.text}"
                }
        except Exception as e:
            return {
                "success": False,
                "error": f"Request exception: {str(e)}"
            }

    def get_bid_status(self, bid_id: str) -> Optional[str]:
        """
        Retrieves status of a bid.
        """
        if not self.is_configured() or not bid_id or bid_id.startswith("bid_"):
            return None

        url = f"{FREELANCER_BASE_URL}/projects/0.1/bids/{bid_id}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                bid = data.get("result", {})
                # Status mapping
                raw_status = str(bid.get("status", "")).lower()
                award_status = str(bid.get("award_status", "")).lower()
                if "award" in award_status or "accepted" in award_status or raw_status == "awarded":
                    return "won"
                elif raw_status in ("active", "pending"):
                    return "pending"
                elif raw_status in ("closed", "lost", "rejected"):
                    return "lost"
                return raw_status or "pending"
        except Exception as e:
            logger.error(f"Error checking bid status: {e}")
        return None
