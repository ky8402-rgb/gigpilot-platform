import os
import sqlite3
from datetime import datetime
from typing import Dict, Any, List, Optional

DB_PATH = os.getenv("SQLITE_DB_PATH", "bids.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # Create bids table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bids (
        id TEXT PRIMARY KEY,
        job_title TEXT NOT NULL,
        company TEXT,
        platform TEXT DEFAULT 'Freelancer.com',
        package TEXT NOT NULL,
        bid_amount REAL NOT NULL,
        cover_letter TEXT,
        status TEXT DEFAULT 'pending',
        client_name TEXT,
        job_url TEXT,
        project_id TEXT,
        submitted_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """)

    # Create leads table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        job_title TEXT NOT NULL,
        company TEXT,
        source TEXT DEFAULT 'RemoteOK',
        url TEXT,
        matched_package TEXT NOT NULL,
        similarity_score REAL DEFAULT 0.85,
        created_at TEXT NOT NULL
    )
    """)

    conn.commit()

    # Seed with initial realistic telemetry if empty so frontend renders immediately
    cursor.execute("SELECT COUNT(*) as count FROM bids")
    if cursor.fetchone()["count"] == 0:
        seed_sample_data(conn)

    conn.close()

def seed_sample_data(conn):
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()

    sample_bids = [
        ("bid_101", "Full Stack AI SaaS with FastAPI & Next.js", "NovaCloud Labs", "Freelancer.com", "fullstack", 650.0, "Experienced full-stack engineer ready to implement your API architecture.", "won", "Sarah Jenkins", "https://freelancer.com/projects/ai-saas-101", "prj_101", now, now),
        ("bid_102", "Custom Autonomous Gemini Lead Scraper & Bot", "Vanguard AI", "Freelancer.com", "ai_agent", 480.0, "Built multiple multi-agent pipelines with Gemini 2.5 and LangChain.", "interviewing", "Alex Mercer", "https://freelancer.com/projects/lead-bot-102", "prj_102", now, now),
        ("bid_103", "Stripe & PayPal Multi-Currency Payment Gateway", "FinEdge Corp", "Freelancer.com", "payment_gateway", 350.0, "Integrating webhooks, idempotency, and recurring subscriptions seamlessly.", "won", "David Ross", "https://freelancer.com/projects/stripe-gateway-103", "prj_103", now, now),
        ("bid_104", "Security Audit & Performance Optimization", "QuantumScale", "Freelancer.com", "code_audit", 290.0, "Comprehensive vulnerability scanner and response latency benchmark.", "viewed", "Elena Rostova", "https://freelancer.com/projects/audit-104", "prj_104", now, now),
        ("bid_105", "Enterprise React Dashboard with Chart.js Telemetry", "Apex Systems", "Freelancer.com", "fullstack", 520.0, "Real-time state streaming, WebSocket polling, and Tailwind UI.", "pending", "Michael Chang", "https://freelancer.com/projects/dashboard-105", "prj_105", now, now),
        ("bid_106", "Telegram Automation Bot with Webhook Triggers", "SignalWave", "Freelancer.com", "ai_agent", 220.0, "Asynchronous event handling with rate-limit protections.", "lost", "Robert Kim", "https://freelancer.com/projects/telegram-106", "prj_106", now, now),
    ]

    cursor.executemany("""
    INSERT INTO bids (id, job_title, company, platform, package, bid_amount, cover_letter, status, client_name, job_url, project_id, submitted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, sample_bids)

    sample_leads = [
        ("lead_201", "Senior Full-Stack Architect (FastAPI / React)", "TechVentures global", "RemoteOK", "https://remoteok.com/l/201", "fullstack", 0.94, now),
        ("lead_202", "AI Agent & Voice Interface Developer", "SynthAI Inc", "RemoteOK", "https://remoteok.com/l/202", "ai_agent", 0.91, now),
        ("lead_203", "Payment Infrastructure Engineer (Stripe / Razorpay)", "FinGlobal LLC", "RemoteOK", "https://remoteok.com/l/203", "payment_gateway", 0.88, now),
        ("lead_204", "Full-Stack Security & Code Quality Auditor", "SafeGuard Code", "RemoteOK", "https://remoteok.com/l/204", "code_audit", 0.86, now),
        ("lead_205", "React & Chart.js Frontend Consultant", "DataMetrics Studio", "RemoteOK", "https://remoteok.com/l/205", "fullstack", 0.89, now),
    ]

    cursor.executemany("""
    INSERT INTO leads (id, job_title, company, source, url, matched_package, similarity_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, sample_leads)

    conn.commit()

def save_bid(bid_dict: Dict[str, Any]) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO bids (
            id, job_title, company, platform, package, bid_amount,
            cover_letter, status, client_name, job_url, project_id,
            submitted_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            bid_dict.get("id"),
            bid_dict.get("job_title"),
            bid_dict.get("company", "Verified Client"),
            bid_dict.get("platform", "Freelancer.com"),
            bid_dict.get("package", "fullstack"),
            float(bid_dict.get("bid_amount", 0.0)),
            bid_dict.get("cover_letter", ""),
            bid_dict.get("status", "pending"),
            bid_dict.get("client_name", "Client"),
            bid_dict.get("job_url", ""),
            str(bid_dict.get("project_id", "")),
            bid_dict.get("submitted_at", now),
            now
        ))
        conn.commit()
        return True
    except Exception as e:
        print(f"[DB Error] save_bid: {e}")
        return False
    finally:
        conn.close()

def update_bid_status(bid_id: str, status: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    try:
        cursor.execute("UPDATE bids SET status = ?, updated_at = ? WHERE id = ?", (status, now, bid_id))
        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        print(f"[DB Error] update_bid_status: {e}")
        return False
    finally:
        conn.close()

def get_bids(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, job_title, company, package, bid_amount, status, submitted_at,
           platform, cover_letter, client_name, job_url, project_id
    FROM bids
    ORDER BY submitted_at DESC
    LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_stats() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) as total FROM bids")
    total = cursor.fetchone()["total"]

    cursor.execute("SELECT COUNT(*) as active FROM bids WHERE status IN ('pending', 'viewed', 'interviewing', 'active')")
    active = cursor.fetchone()["active"]

    cursor.execute("SELECT COUNT(*) as won FROM bids WHERE status IN ('won', 'awarded', 'accepted')")
    won = cursor.fetchone()["won"]

    cursor.execute("SELECT SUM(bid_amount) as earned FROM bids WHERE status IN ('won', 'awarded', 'accepted')")
    row_earned = cursor.fetchone()["earned"]
    earned = float(row_earned) if row_earned is not None else 0.0

    win_rate = round((won / total * 100), 1) if total > 0 else 0.0

    # Package counts
    cursor.execute("SELECT package, COUNT(*) as count FROM bids GROUP BY package")
    package_rows = cursor.fetchall()
    package_counts = {
        "fullstack": 0,
        "ai_agent": 0,
        "payment_gateway": 0,
        "code_audit": 0
    }
    for row in package_rows:
        pkg = row["package"]
        if pkg:
            package_counts[pkg] = row["count"]

    conn.close()

    return {
        "total": total,
        "active": active,
        "won": won,
        "earned": earned,
        "win_rate": win_rate,
        "package_counts": package_counts
    }

def save_lead(lead_dict: Dict[str, Any]) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO leads (
            id, job_title, company, source, url, matched_package, similarity_score, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            lead_dict.get("id"),
            lead_dict.get("job_title"),
            lead_dict.get("company", "Verified Employer"),
            lead_dict.get("source", "RemoteOK"),
            lead_dict.get("url", ""),
            lead_dict.get("matched_package", "fullstack"),
            float(lead_dict.get("similarity_score", 0.85)),
            lead_dict.get("created_at", now)
        ))
        conn.commit()
        return True
    except Exception as e:
        print(f"[DB Error] save_lead: {e}")
        return False
    finally:
        conn.close()

def get_recent_leads(limit: int = 20) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, job_title, company, source, url, matched_package, similarity_score, created_at
    FROM leads
    ORDER BY created_at DESC
    LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_matches_since(hours: int = 24) -> List[tuple]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT job_title, company, matched_package, url
    FROM leads
    ORDER BY created_at DESC
    LIMIT 25
    """)
    rows = cursor.fetchall()
    conn.close()
    return [(r["job_title"], r["company"], r["matched_package"], r["url"]) for r in rows]
