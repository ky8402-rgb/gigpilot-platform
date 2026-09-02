"""
FastAPI Predictive ML Microservice for Self-Healing Architecture.
Exposes endpoints for issue prediction, autonomous model retraining,
version rollback, shadow deployment evaluation, and Prometheus telemetry.
"""

import os
import logging
from typing import Dict, Any, Optional, List
from fastapi import FastAPI, HTTPException, BackgroundTasks, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from model_manager import ModelManager
from data_pipeline import FEATURE_COLUMNS, ISSUE_CLASSES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("ml_fastapi_service")

app = FastAPI(
    title="Self-Healing Predictive ML Microservice",
    description="Predicts system failures, suggests optimal remediation, and autonomously updates models.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Model Manager
manager = ModelManager()


class FeaturesPayload(BaseModel):
    cpu_usage_pct: Optional[float] = Field(None, description="System CPU utilization (0-100%)")
    memory_usage_pct: Optional[float] = Field(None, description="System RAM utilization (0-100%)")
    db_latency_ms: Optional[float] = Field(None, description="PostgreSQL round-trip latency in ms")
    db_connected: Optional[float] = Field(1.0, description="Database connection status: 1 or 0")
    cron_seconds_since_last_run: Optional[float] = Field(10.0, description="Seconds since last cron heartbeat")
    paypal_latency_ms: Optional[float] = Field(120.0, description="PayPal API ping in ms")
    paypal_error_flag: Optional[float] = Field(0.0, description="1 if PayPal API error reported, else 0")
    freelancer_latency_ms: Optional[float] = Field(150.0, description="Freelancer.com API ping in ms")
    freelancer_error_flag: Optional[float] = Field(0.0, description="1 if Freelancer API error reported, else 0")
    queue_waiting_jobs: Optional[float] = Field(0.0, description="Count of waiting jobs in Bull queue")
    queue_failed_jobs: Optional[float] = Field(0.0, description="Count of failed jobs in Bull queue")
    work_orders_stuck_count: Optional[float] = Field(0.0, description="Count of overdue stuck work orders")
    work_orders_failed_payments: Optional[float] = Field(0.0, description="Failed payment work orders")
    transactions_failed_count: Optional[float] = Field(0.0, description="Count of failed transactions")
    transactions_pending_old: Optional[float] = Field(0.0, description="Transactions pending > 1hr")
    recent_autoheal_consecutive_failures: Optional[float] = Field(0.0, description="Auto-healer retry failures")
    hour_sin: Optional[float] = Field(None, description="Cyclic time-of-day sin encoding")
    hour_cos: Optional[float] = Field(None, description="Cyclic time-of-day cos encoding")


class TrainPayload(BaseModel):
    force_deploy: Optional[bool] = Field(False, description="Deploy even if +2% improvement threshold is not met")
    version_tag: Optional[str] = Field(None, description="Optional custom version string e.g. v1.1.0")


class ShadowEvaluatePayload(BaseModel):
    samples: List[Dict[str, Any]]


@app.get("/")
@app.get("/health")
def health_check():
    """Health check for ML service."""
    return {
        "status": "healthy",
        "service": "predictive-ml-microservice",
        "active_model_version": manager.active_version,
        "active_accuracy": manager.metrics_history.get("active_accuracy"),
        "active_f1": manager.metrics_history.get("active_f1"),
        "registered_models_count": len(manager.registry),
        "supported_classes": ISSUE_CLASSES,
        "feature_count": len(FEATURE_COLUMNS),
    }


@app.post("/predict")
def predict_issue(payload: FeaturesPayload):
    """
    Accepts 15-20 numeric system features and returns predicted issue_type,
    confidence score, recommended remediation, and class probabilities.
    """
    try:
        raw_dict = payload.model_dump(exclude_none=True)
        result = manager.predict(raw_dict)
        return {
            "success": True,
            **result,
        }
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/train")
def trigger_training(payload: Optional[TrainPayload] = None):
    """
    Triggers model retraining:
    1. Loads dataset from PostgreSQL (or synthetic bootstrap).
    2. Trains Random Forest classifier with 5-Fold Stratified Cross-Validation.
    3. If new accuracy >= current accuracy + 0.02 (or force_deploy=True), deploys new model.
    4. Logs experiment metadata to MLflow and updates model registry.
    """
    try:
        force = payload.force_deploy if payload else False
        v_tag = payload.version_tag if payload else None
        train_result = manager.train_and_evaluate(version_tag=v_tag, force_deploy=force)
        return train_result
    except Exception as e:
        logger.error(f"Training error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/rollback")
def rollback_model():
    """Reverts active model pointer to the previous model version."""
    res = manager.rollback()
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Rollback failed"))
    return res


@app.get("/models")
def get_models():
    """Returns list of all model versions in the registry with accuracy & deployment state."""
    return {
        "active_version": manager.active_version,
        "models": manager.registry,
    }


@app.post("/shadow_evaluate")
def shadow_evaluate(payload: ShadowEvaluatePayload):
    """Evaluates candidate shadow model against current production model."""
    res = manager.shadow_evaluate(payload.samples)
    return res


@app.get("/metrics")
def prometheus_metrics():
    """Export Prometheus metrics (ml_accuracy, ml_f1_score, ml_confidence_avg, ml_latency_ms)."""
    content = manager.get_prometheus_metrics()
    return Response(content=content, media_type="text/plain")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
