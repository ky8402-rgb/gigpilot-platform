# Predictive ML Self-Healing Microservice (FastAPI + scikit-learn + MLflow)

This microservice provides proactive failure prediction, automated retraining, and remediation suggestion for the Node.js self-healing architecture.

## Architecture & Features

1. **Failure Prediction (`POST /predict`)**:
   - Accepts 18 numeric normalized telemetry features (CPU, memory, DB latency, queue lengths, error flags, cyclic time-of-day encoding).
   - Outputs predicted `issue_type` (`paypal_failure`, `db_timeout`, `queue_stuck`, `freelancer_sync_fail`, `stuck_work_orders`, `healthy`), confidence score (0.0 to 1.0), and recommended remediation action.

2. **Self-Updating Continuous Training (`POST /train`)**:
   - Extracts historical labeled training data from PostgreSQL (`ml_training_data`, `ml_feedback`, and `self_healing_logs`).
   - Trains a Random Forest classifier with 5-Fold Stratified Cross-Validation.
   - Compares performance against the active production model: deploys **only if** new accuracy outperforms current active model by **+2%** (`new_acc >= current_acc + 0.02`), preventing regression.
   - Logs experiment runs, hyperparameters, and artifacts to MLflow (`./mlruns`).

3. **Instant Model Rollback (`POST /rollback`)**:
   - Safely reverts the active model pointer to the previous working model artifact.

4. **Shadow Deployment Evaluation (`POST /shadow_evaluate`)**:
   - Runs candidate models in shadow mode alongside the production model to compare empirical predictions before full deployment.

5. **Prometheus Telemetry (`GET /metrics`)**:
   - Exposes metrics: `ml_accuracy`, `ml_f1_score`, `ml_confidence_avg`, `ml_latency_ms`, and `ml_predictions_total`.

## Quickstart

### Run with Docker Compose
```bash
docker-compose up -d --build
```

### Run Locally with Python Virtualenv
```bash
cd ml_service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

The service will run on `http://localhost:8000`.

### Health Check
```bash
curl http://localhost:8000/health
```

### Predict
```bash
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "cpu_usage_pct": 28.5,
    "memory_usage_pct": 42.0,
    "db_latency_ms": 15.0,
    "paypal_latency_ms": 1250.0,
    "paypal_error_flag": 1.0,
    "transactions_failed_count": 2.0
  }'
```

Response:
```json
{
  "success": true,
  "issue_type": "paypal_failure",
  "confidence": 0.932,
  "model_version": "v1.0.0",
  "recommended_remediation": "Retry failed PayPal payouts with exponential backoff and verify API credentials.",
  "latency_ms": 3.4
}
```
