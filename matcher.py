import logging
import os
from typing import Tuple, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Our 4 service descriptions for keyword and semantic matching
PACKAGES = {
    "fullstack": "Build full stack web applications using React, TypeScript, Node.js, and deploy to cloud platforms like AWS or Render.",
    "ai_agent": "Develop AI agents and automation workflows using Gemini LLM, webhooks, HMAC security, and integration with third-party APIs.",
    "payment_gateway": "Integrate payment systems including PayPal, Stripe, and Indian UPI QR codes for e-commerce and fintech platforms.",
    "code_audit": "Perform rapid code auditing, bug fixing, performance optimization, and security hardening for existing codebases."
}

# Keyword scoring weights
KEYWORD_SCORES = {
    "fullstack": ["react", "node", "typescript", "full stack", "frontend", "backend", "cloud", "deploy", "fastapi", "next.js", "django"],
    "ai_agent": ["ai", "llm", "gemini", "automation", "webhook", "api", "agent", "workflow", "bot", "scraper", "langchain"],
    "payment_gateway": ["paypal", "stripe", "upi", "payment", "gateway", "fintech", "transaction", "wallet", "checkout"],
    "code_audit": ["bug", "fix", "error", "performance", "audit", "security", "optimize", "debug", "vulnerability"]
}

def keyword_fallback(description: str) -> Tuple[str, float]:
    """Scoring matching based on token intersections."""
    scores = {pkg: 0 for pkg in PACKAGES.keys()}
    desc_lower = (description or "").lower()
    for pkg, keywords in KEYWORD_SCORES.items():
        for kw in keywords:
            if kw in desc_lower:
                scores[pkg] += 15
    best_pkg = max(scores, key=scores.get)
    best_score = scores[best_pkg]
    return best_pkg, min(float(best_score) / 100.0, 0.98)

def match_job(job_data: dict) -> Tuple[Optional[str], float]:
    """
    Match a single job to one of our 4 packages.
    Returns: (matched_package_display, similarity_score)
    """
    description = job_data.get('description', '')
    title = job_data.get('title', '')
    full_text = f"{title} {description}".strip()
    
    pkg_key, score = keyword_fallback(full_text)
    
    pkg_display = {
        "fullstack": "Full-Stack Engineering ($499)",
        "ai_agent": "AI Agent & Webhook ($299)",
        "payment_gateway": "Payment Gateway Integration ($199)",
        "code_audit": "Code Audit & Fixes ($99)"
    }
    
    threshold = float(os.getenv('SIMILARITY_THRESHOLD', 0.15))
    if score >= threshold:
        return pkg_display.get(pkg_key, "Full-Stack Engineering ($499)"), max(score, 0.85)
    
    return None, score
