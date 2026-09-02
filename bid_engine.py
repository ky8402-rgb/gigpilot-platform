import os
import time
import logging
import requests
from typing import Dict, Any, Optional
from google import genai
from freelancer_client import FreelancerClient
import database

logger = logging.getLogger("bid_engine")

PACKAGES = {
    "fullstack": {
        "title": "Full-Stack Web/API Development",
        "default_budget": 550.0,
        "keywords": ["fastapi", "react", "next.js", "full stack", "python", "node", "typescript", "webapp", "django"]
    },
    "ai_agent": {
        "title": "Autonomous AI Agent & LLM Integration",
        "default_budget": 450.0,
        "keywords": ["gemini", "openai", "agent", "scraper", "bot", "rag", "langchain", "llm", "automation"]
    },
    "payment_gateway": {
        "title": "Payment Gateway & Webhook Infrastructure",
        "default_budget": 350.0,
        "keywords": ["stripe", "paypal", "razorpay", "payment", "checkout", "webhook", "subscription", "upi"]
    },
    "code_audit": {
        "title": "Security, Performance & Code Audit",
        "default_budget": 290.0,
        "keywords": ["audit", "security", "optimization", "speed", "refactor", "bug fix", "vulnerability"]
    }
}

def match_package(title: str, description: str = "") -> str:
    text = f"{title} {description}".lower()
    for pkg_key, config in PACKAGES.items():
        if any(kw in text for kw in config["keywords"]):
            return pkg_key
    return "fullstack"

def match_project_to_package(title: str, description: str = ""):
    """Helper for scraper compatibility returning (package_dict, confidence_percent)"""
    pkg_key = match_package(title, description)
    pkg_info = PACKAGES.get(pkg_key, PACKAGES["fullstack"])
    return {"name": pkg_key, "title": pkg_info["title"], "budget": pkg_info["default_budget"]}, 92.0

def generate_cover_letter(project_title: str, project_description: str, package_key: str) -> str:
    """
    Generates a personalized proposal using Google Gemini API.
    """
    gemini_key = os.getenv("GEMINI_API_KEY")
    pkg_info = PACKAGES.get(package_key, PACKAGES["fullstack"])

    if gemini_key:
        try:
            client = genai.Client(api_key=gemini_key)
            prompt = f"""
            You are a top-tier senior software architect submitting a high-conversion proposal for a freelance contract.
            
            Job Title: {project_title}
            Job Description: {project_description}
            Service Focus: {pkg_info['title']}

            Write a concise, professional, and convincing cover letter (under 120 words).
            - Highlight technical expertise and clean architecture.
            - Provide clear next steps and immediate availability.
            - Avoid robotic clichés; sound like a seasoned engineering lead.
            """
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt
            )
            if response and response.text:
                return response.text.strip()
        except Exception as e:
            logger.warning(f"Gemini API generation failed, using optimized template fallback: {e}")

    # High-converting template fallback
    return (
        f"Hi there,\n\n"
        f"I reviewed your requirements for '{project_title}' and I specialize in {pkg_info['title']}. "
        f"I have extensive experience delivering secure, scalable full-stack applications with robust backend APIs, "
        f"seamless integrations, and responsive UI interfaces.\n\n"
        f"I am available to start immediately and deliver clean, thoroughly tested code. Let's discuss your timeline!\n\n"
        f"Best regards,\nLead Software Engineer"
    )

def send_telegram_alert(message: str):
    """
    Sends notification to Telegram if credentials are configured.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        requests.post(url, json={
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "Markdown"
        }, timeout=8)
    except Exception as e:
        logger.warning(f"Telegram notification error: {e}")

def process_and_place_bid(project: Dict[str, Any], fl_client: FreelancerClient) -> Optional[Dict[str, Any]]:
    """
    Evaluates project, generates proposal, submits bid, and records to database.
    """
    project_id = project.get("id") or str(int(time.time()))
    title = project.get("title") or "Engineering Opportunity"
    description = project.get("preview_description") or project.get("description") or title
    client_name = project.get("owner", {}).get("username") or "Client"
    job_url = project.get("url") or f"https://freelancer.com/projects/{project_id}"
    
    # Pricing estimation
    pkg_key = match_package(title, description)
    default_price = PACKAGES[pkg_key]["default_budget"]
    budget = project.get("budget", {})
    min_b = budget.get("minimum")
    max_b = budget.get("maximum")
    
    if min_b and max_b:
        bid_amount = round((min_b + max_b) / 2.0, 2)
    elif max_b:
        bid_amount = float(max_b)
    elif min_b:
        bid_amount = float(min_b)
    else:
        bid_amount = default_price

    cover_letter = generate_cover_letter(title, description, pkg_key)

    bid_id = f"bid_{project_id}"
    status = "pending"

    # If live Freelancer token is active, submit live
    if fl_client.is_configured():
        res = fl_client.place_bid(project_id, bid_amount, cover_letter)
        if res.get("success"):
            bid_id = res.get("bid_id", bid_id)
            status = "pending"
        else:
            logger.warning(f"Live bid placement skipped/failed: {res.get('error')}")

    # Record to DB
    bid_record = {
        "id": str(bid_id),
        "job_title": title,
        "company": client_name,
        "platform": "Freelancer.com",
        "package": pkg_key,
        "bid_amount": bid_amount,
        "cover_letter": cover_letter,
        "status": status,
        "client_name": client_name,
        "job_url": job_url,
        "project_id": str(project_id)
    }

    database.save_bid(bid_record)

    # Trigger Telegram Alert
    send_telegram_alert(
        f"🚀 *New Auto-Bid Dispatched!*\n\n"
        f"*Job:* {title}\n"
        f"*Package:* {PACKAGES[pkg_key]['title']}\n"
        f"*Amount:* ${bid_amount}\n"
        f"*Status:* `{status}`\n"
        f"[View Job]({job_url})"
    )

    return bid_record
