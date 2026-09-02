import os
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import requests
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "https://kundanvision369.onrender.com"

def send_telegram_alert(job_title, company, package, url, score):
    """Send a Telegram message for a single job match."""
    bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
    chat_id = os.getenv('TELEGRAM_CHAT_ID')
    
    if not bot_token or not chat_id:
        logger.warning("Telegram credentials missing. Skipping alert.")
        return
    
    # Pre-fill the checkout link with the package (map properly)
    package_map = {
        "Full-Stack Engineering ($499)": "fullstack",
        "AI Agent & Webhook ($299)": "ai_agent",
        "Payment Gateway Integration ($199)": "payment_gateway",
        "Code Audit & Fixes ($99)": "code_audit"
    }
    pkg_key = package_map.get(package, "fullstack")
    checkout_link = f"{BASE_URL}?package={pkg_key}"
    
    message = (
        f"🔔 *New Job Match!*\n\n"
        f"📌 *{job_title}*\n"
        f"🏢 {company}\n"
        f"📦 *Matched Package:* {package}\n"
        f"📊 *Confidence Score:* {score:.2f}\n\n"
        f"🔗 [View Job]({url})\n"
        f"💳 [Buy This Package]({checkout_link})"
    )
    
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": message, "parse_mode": "Markdown", "disable_web_page_preview": True},
            timeout=10
        )
        if resp.status_code == 200:
            logger.info(f"Telegram alert sent for: {job_title}")
        else:
            logger.error(f"Telegram failed: {resp.text}")
    except Exception as e:
        logger.error(f"Telegram error: {e}")

def send_email_digest():
    """Send a daily digest of all matches in the last 24 hours."""
    from database import get_matches_since
    
    rows = get_matches_since(24)
    if not rows:
        logger.info("No matches in last 24h. Skipping digest.")
        return
    
    sender = os.getenv('SMTP_EMAIL')
    password = os.getenv('SMTP_PASSWORD')
    recipient = os.getenv('SMTP_RECIPIENT')
    
    if not sender or not password or not recipient:
        logger.warning("SMTP credentials missing. Skipping digest.")
        return
    
    subject = f"🚀 Daily Freelance Matches - {datetime.now().strftime('%Y-%m-%d')}"
    
    html = f"""
    <h2>🔥 Your Daily Freelance Matches ({len(rows)} new)</h2>
    <table border="1" cellpadding="5" style="border-collapse:collapse;">
        <tr><th>Title</th><th>Company</th><th>Matched Package</th><th>Link</th></tr>
    """
    for row in rows:
        html += f"<tr><td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td><td><a href='{row[3]}'>Apply</a></td></tr>"
    html += "</table><br><p>Visit your dashboard: https://kundanvision369.onrender.com</p>"
    
    msg = MIMEMultipart()
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = recipient
    msg.attach(MIMEText(html, 'html'))
    
    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(sender, password)
            server.sendmail(sender, recipient, msg.as_string())
        logger.info("Daily digest email sent successfully.")
    except Exception as e:
        logger.error(f"Email failed: {e}")
