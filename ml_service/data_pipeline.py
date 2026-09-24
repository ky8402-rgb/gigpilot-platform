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


def generate_synthetic_bootstrap_dataset(n_samples: int = 1200) -> Tuple[pd.DataFrame, pd.Series]:
    """
    Synthesize realistic diagnostic training dataset grounded in actual failure modes:
    - PayPal payout failures: paypal_error_flag=1, transactions_failed_count > 0, paypal_latency > 500
    - DB timeout: db_latency > 350ms, db_connected=0 or 1 with high latency, queue_waiting > 5
    - Queue stuck: queue_waiting > 10, queue_failed > 3, cpu elevated
    - Freelancer sync fail: freelancer_error_flag=1, freelancer_latency > 800
    - Stuck work orders: work_orders_stuck_count > 0, work_orders_failed_payments > 0
    - Healthy: low latencies, 0 error flags, 0 queue fails
    """
    np.random.seed(42)
    records = []
    labels = []

    samples_per_class = n_samples // len(ISSUE_CLASSES)

    for issue in ISSUE_CLASSES:
        for _ in range(samples_per_class):
            hour = np.random.uniform(0, 24)
            h_sin = np.sin(2 * np.pi * hour / 24.0)
            h_cos = np.cos(2 * np.pi * hour / 24.0)

            if issue == "healthy":
                feat = {
                    "cpu_usage_pct": np.random.uniform(5, 45),
                    "memory_usage_pct": np.random.uniform(20, 60),
                    "db_latency_ms": np.random.uniform(2, 45),
                    "db_connected": 1.0,
                    "cron_seconds_since_last_run": np.random.uniform(1, 40),
                    "paypal_latency_ms": np.random.uniform(80, 250),
                    "paypal_error_flag": 0.0,
                    "freelancer_latency_ms": np.random.uniform(90, 300),
                    "freelancer_error_flag": 0.0,
                    "queue_waiting_jobs": np.random.randint(0, 3),
                    "queue_failed_jobs": 0.0,
                    "work_orders_stuck_count": 0.0,
                    "work_orders_failed_payments": 0.0,
                    "transactions_failed_count": 0.0,
                    "transactions_pending_old": 0.0,
                    "recent_autoheal_consecutive_failures": 0.0,
                    "hour_sin": h_sin,
                    "hour_cos": h_cos,
                }
            elif issue == "paypal_failure":
                feat = {
                    "cpu_usage_pct": np.random.uniform(15, 60),
                    "memory_usage_pct": np.random.uniform(30, 70),
                    "db_latency_ms": np.random.uniform(5, 50),
                    "db_connected": 1.0,
                    "cron_seconds_since_last_run": np.random.uniform(5, 60),
                    "paypal_latency_ms": np.random.uniform(600, 3000),
                    "paypal_error_flag": 1.0 if np.random.rand() > 0.1 else 0.0,
                    "freelancer_latency_ms": np.random.uniform(100, 350),
                    "freelancer_error_flag": 0.0,
                    "queue_waiting_jobs": np.random.randint(1, 6),
                    "queue_failed_jobs": np.random.randint(0, 4),
                    "work_orders_stuck_count": 0.0,
                    "work_orders_failed_payments": np.random.randint(1, 8),
                    "transactions_failed_count": np.random.randint(1, 10),
                    "transactions_pending_old": np.random.randint(0, 4),
                    "recent_autoheal_consecutive_failures": np.random.randint(0, 2),
                    "hour_sin": h_sin,
                    "hour_cos": h_cos,
                }
            elif issue == "db_timeout":
                feat = {
                    "cpu_usage_pct": np.random.uniform(40, 95),
                    "memory_usage_pct": np.random.uniform(50, 90),
                    "db_latency_ms": np.random.uniform(400, 4500),
                    "db_connected": 0.0 if np.random.rand() > 0.7 else 1.0,
                    "cron_seconds_since_last_run": np.random.uniform(20, 180),
                    "paypal_latency_ms": np.random.uniform(100, 400),
                    "paypal_error_flag": 0.0,
                    "freelancer_latency_ms": np.random.uniform(100, 400),
                    "freelancer_error_flag": 0.0,
                    "queue_waiting_jobs": np.random.randint(4, 25),
                    "queue_failed_jobs": np.random.randint(1, 8),
                    "work_orders_stuck_count": np.random.randint(0, 3),
                    "work_orders_failed_payments": 0.0,
                    "transactions_failed_count": np.random.randint(0, 4),
                    "transactions_pending_old": np.random.randint(1, 6),
                    "recent_autoheal_consecutive_failures": np.random.randint(1, 3),
                    "hour_sin": h_sin,
                    "hour_cos": h_cos,
                }
            elif issue == "queue_stuck":
                feat = {
                    "cpu_usage_pct": np.random.uniform(55, 95),
                    "memory_usage_pct": np.random.uniform(60, 95),
                    "db_latency_ms": np.random.uniform(10, 80),
                    "db_connected": 1.0,
                    "cron_seconds_since_last_run": np.random.uniform(10, 120),
                    "paypal_latency_ms": np.random.uniform(100, 300),
                    "paypal_error_flag": 0.0,
                    "freelancer_latency_ms": np.random.uniform(100, 300),
                    "freelancer_error_flag": 0.0,
                    "queue_waiting_jobs": np.random.randint(15, 60),
                    "queue_failed_jobs": np.random.randint(5, 25),
                    "work_orders_stuck_count": np.random.randint(0, 4),
                    "work_orders_failed_payments": 0.0,
                    "transactions_failed_count": 0.0,
                    "transactions_pending_old": np.random.randint(0, 3),
                    "recent_autoheal_consecutive_failures": np.random.randint(1, 3),
                    "hour_sin": h_sin,
                    "hour_cos": h_cos,
                }
            elif issue == "freelancer_sync_fail":
                feat = {
                    "cpu_usage_pct": np.random.uniform(15, 55),
                    "memory_usage_pct": np.random.uniform(25, 65),
                    "db_latency_ms": np.random.uniform(5, 45),
                    "db_connected": 1.0,
                    "cron_seconds_since_last_run": np.random.uniform(5, 50),
                    "paypal_latency_ms": np.random.uniform(80, 250),
                    "paypal_error_flag": 0.0,
                    "freelancer_latency_ms": np.random.uniform(850, 4000),
                    "freelancer_error_flag": 1.0,
                    "queue_waiting_jobs": np.random.randint(0, 5),
                    "queue_failed_jobs": np.random.randint(1, 6),
                    "work_orders_stuck_count": 0.0,
                    "work_orders_failed_payments": 0.0,
                    "transactions_failed_count": 0.0,
                    "transactions_pending_old": 0.0,
                    "recent_autoheal_consecutive_failures": np.random.randint(0, 2),
                    "hour_sin": h_sin,
                    "hour_cos": h_cos,
                }
            elif issue == "stuck_work_orders":
                feat = {
                    "cpu_usage_pct": np.random.uniform(20, 60),
                    "memory_usage_pct": np.random.uniform(30, 70),
                    "db_latency_ms": np.random.uniform(5, 55),
                    "db_connected": 1.0,
                    "cron_seconds_since_last_run": np.random.uniform(35, 120),
                    "paypal_latency_ms": np.random.uniform(100, 300),
                    "paypal_error_flag": 0.0,
                    "freelancer_latency_ms": np.random.uniform(100, 300),
                    "freelancer_error_flag": 0.0,
                    "queue_waiting_jobs": np.random.randint(1, 8),
                    "queue_failed_jobs": np.random.randint(0, 2),
                    "work_orders_stuck_count": np.random.randint(2, 12),
                    "work_orders_failed_payments": np.random.randint(1, 5),
                    "transactions_failed_count": np.random.randint(0, 2),
                    "transactions_pending_old": np.random.randint(1, 5),
                    "recent_autoheal_consecutive_failures": np.random.randint(0, 2),
                    "hour_sin": h_sin,
                    "hour_cos": h_cos,
                }

            records.append(feat)
            labels.append(issue)

    df_x = pd.DataFrame(records)[FEATURE_COLUMNS]
    df_y = pd.Series(labels)
    return df_x, df_y


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
