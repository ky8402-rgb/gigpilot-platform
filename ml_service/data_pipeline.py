"""
Data Pipeline Module for Predictive ML Self-Healing Microservice.
Extracts features from PostgreSQL (joining self_healing_logs, ml_training_data, ml_feedback)
or synthesizes realistic bootstrap distributions when database is initially unpopulated.
"""

import os
import json
import logging
import numpy as np
import pandas as pd
from typing import Tuple, List, Dict, Any, Optional

logger = logging.getLogger("ml_data_pipeline")

FEATURE_COLUMNS = [
    "cpu_usage_pct",
    "memory_usage_pct",
    "db_latency_ms",
    "db_connected",
    "cron_seconds_since_last_run",
    "paypal_latency_ms",
    "paypal_error_flag",
    "freelancer_latency_ms",
    "freelancer_error_flag",
    "queue_waiting_jobs",
    "queue_failed_jobs",
    "work_orders_stuck_count",
    "work_orders_failed_payments",
    "transactions_failed_count",
    "transactions_pending_old",
    "recent_autoheal_consecutive_failures",
    "hour_sin",
    "hour_cos",
]

ISSUE_CLASSES = [
    "healthy",
    "paypal_failure",
    "db_timeout",
    "queue_stuck",
    "freelancer_sync_fail",
    "stuck_work_orders",
]

REMEDIATION_MAP = {
    "healthy": "System operating normally. No remediation needed.",
    "paypal_failure": "Retry failed PayPal payouts with exponential backoff and verify API credentials.",
    "db_timeout": "Reconcile database connections, flush connection pool, and verify Neon latency.",
    "queue_stuck": "Process and unblock stuck Bull/Redis queues and retry stalled jobs.",
    "freelancer_sync_fail": "Resynchronize missing Freelancer.com projects and refresh API token.",
    "stuck_work_orders": "Auto-approve overdue completed work orders and clear stalled locks.",
}


def get_db_connection():
    """Establish psycopg2 connection to PostgreSQL if DATABASE_URL or POSTGRES_URL is configured."""
    db_url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")
    if not db_url:
        return None
    try:
        import psycopg2
        conn = psycopg2.connect(db_url, connect_timeout=3)
        return conn
    except Exception as e:
        logger.warning(f"Could not connect to PostgreSQL ({e}), falling back to memory/bootstrap data.")
        return None


def extract_features_from_dict(raw: Dict[str, Any]) -> Dict[str, float]:
    """Ensure all 18 features exist and are cast to float with sane defaults."""
    hour = raw.get("hour", 12.0)
    hour_sin = raw.get("hour_sin", np.sin(2 * np.pi * hour / 24.0))
    hour_cos = raw.get("hour_cos", np.cos(2 * np.pi * hour / 24.0))

    return {
        "cpu_usage_pct": float(raw.get("cpu_usage_pct", 15.0)),
        "memory_usage_pct": float(raw.get("memory_usage_pct", 35.0)),
        "db_latency_ms": float(raw.get("db_latency_ms", 12.0)),
        "db_connected": float(raw.get("db_connected", 1.0)),
        "cron_seconds_since_last_run": float(raw.get("cron_seconds_since_last_run", 10.0)),
        "paypal_latency_ms": float(raw.get("paypal_latency_ms", 120.0)),
        "paypal_error_flag": float(raw.get("paypal_error_flag", 0.0)),
        "freelancer_latency_ms": float(raw.get("freelancer_latency_ms", 150.0)),
        "freelancer_error_flag": float(raw.get("freelancer_error_flag", 0.0)),
        "queue_waiting_jobs": float(raw.get("queue_waiting_jobs", 0.0)),
        "queue_failed_jobs": float(raw.get("queue_failed_jobs", 0.0)),
        "work_orders_stuck_count": float(raw.get("work_orders_stuck_count", 0.0)),
        "work_orders_failed_payments": float(raw.get("work_orders_failed_payments", 0.0)),
        "transactions_failed_count": float(raw.get("transactions_failed_count", 0.0)),
        "transactions_pending_old": float(raw.get("transactions_pending_old", 0.0)),
        "recent_autoheal_consecutive_failures": float(raw.get("recent_autoheal_consecutive_failures", 0.0)),
        "hour_sin": float(hour_sin),
        "hour_cos": float(hour_cos),
    }


def load_training_data_from_db() -> Tuple[pd.DataFrame, pd.Series]:
    """Load only verified production observations from PostgreSQL.

    Synthetic/bootstrap records are deliberately unsupported. Training fails closed when
    there is insufficient real labeled data rather than fabricating observations.
    """
    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Verified production ML data source is unavailable; training is fail-closed.")

    db_records: List[Dict[str, float]] = []
    db_labels: List[str] = []
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT features, label FROM ml_training_data ORDER BY timestamp DESC LIMIT 5000;")
            for f_json, lbl in cur.fetchall():
                if f_json and lbl in ISSUE_CLASSES:
                    parsed_feat = f_json if isinstance(f_json, dict) else json.loads(f_json)
                    db_records.append(extract_features_from_dict(parsed_feat))
                    db_labels.append(lbl)
            cur.execute("SELECT features, actual_label FROM ml_feedback WHERE actual_label IS NOT NULL ORDER BY timestamp DESC LIMIT 5000;")
            for f_json, lbl in cur.fetchall():
                if f_json and lbl in ISSUE_CLASSES:
                    parsed_feat = f_json if isinstance(f_json, dict) else json.loads(f_json)
                    db_records.append(extract_features_from_dict(parsed_feat))
                    db_labels.append(lbl)
    finally:
        conn.close()

    if len(db_records) < 50 or len(set(db_labels)) < 2:
        raise RuntimeError("Insufficient verified production observations for ML training; no synthetic bootstrap is permitted.")

    return pd.DataFrame(db_records)[FEATURE_COLUMNS], pd.Series(db_labels)
def load_training_data_from_db() -> Tuple[pd.DataFrame, pd.Series]:
    """
    Fetch labeled records from PostgreSQL:
    1. Records in ml_training_data
    2. Feedback records in ml_feedback where actual_label is populated
    3. Joined with synthetic baseline to guarantee class diversity and stable training
    """
    conn = get_db_connection()
    db_records: List[Dict[str, float]] = []
    db_labels: List[str] = []

    if conn:
        try:
            with conn.cursor() as cur:
                # 1. Fetch from ml_training_data
                cur.execute("SELECT features, label FROM ml_training_data ORDER BY timestamp DESC LIMIT 2000;")
                rows = cur.fetchall()
                for f_json, lbl in rows:
                    if f_json and lbl in ISSUE_CLASSES:
                        parsed_feat = f_json if isinstance(f_json, dict) else json.loads(f_json)
                        db_records.append(extract_features_from_dict(parsed_feat))
                        db_labels.append(lbl)

                # 2. Fetch verified outcomes from ml_feedback
                cur.execute(
                    "SELECT features, actual_label FROM ml_feedback WHERE actual_label IS NOT NULL ORDER BY timestamp DESC LIMIT 1000;"
                )
                fb_rows = cur.fetchall()
                for f_json, lbl in fb_rows:
                    if f_json and lbl in ISSUE_CLASSES:
                        parsed_feat = f_json if isinstance(f_json, dict) else json.loads(f_json)
                        db_records.append(extract_features_from_dict(parsed_feat))
                        db_labels.append(lbl)
            conn.close()
        except Exception as e:
            logger.warning(f"Failed querying PostgreSQL for ML training data: {e}")

    # Combine with synthetic bootstrap samples to prevent cold-start starvation
    base_x, base_y = generate_synthetic_bootstrap_dataset(n_samples=1000)

    if db_records:
        logger.info(f"Loaded {len(db_records)} real training records from database.")
        real_x = pd.DataFrame(db_records)[FEATURE_COLUMNS]
        real_y = pd.Series(db_labels)
        combined_x = pd.concat([base_x, real_x], ignore_index=True)
        combined_y = pd.concat([base_y, real_y], ignore_index=True)
        return combined_x, combined_y

    return base_x, base_y
