"""
Model Manager for Predictive ML Self-Healing Microservice.
Handles training, cross-validation, model versioning, MLflow logging,
shadow-deployment comparison, rollback, and Prometheus metrics tracking.
"""

import os
import json
import time
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.metrics import accuracy_score, f1_score

from data_pipeline import (
    FEATURE_COLUMNS,
    ISSUE_CLASSES,
    REMEDIATION_MAP,
    load_training_data_from_db,
    extract_features_from_dict,
)

logger = logging.getLogger("ml_model_manager")
MODELS_DIR = os.getenv("MODELS_DIR", os.path.join(os.path.dirname(__file__), "models"))
REGISTRY_FILE = os.path.join(MODELS_DIR, "registry.json")
MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI", "./mlruns")

os.makedirs(MODELS_DIR, exist_ok=True)


class ModelManager:
    def __init__(self):
        self.active_model = None
        self.active_version = None
        self.shadow_model = None
        self.shadow_version = None
        self.registry: List[Dict[str, Any]] = []

        # Prometheus-compatible internal telemetry counters
        self.metrics_history = {
            "prediction_count": 0,
            "total_latency_ms": 0.0,
            "total_confidence": 0.0,
            "active_accuracy": 0.942,
            "active_f1": 0.928,
            "last_prediction_ts": None,
        }

        self.load_registry()
        self.load_active_model()

    def load_registry(self):
        """Load model registry from JSON file if present."""
        if os.path.exists(REGISTRY_FILE):
            try:
                with open(REGISTRY_FILE, "r") as f:
                    self.registry = json.load(f)
                logger.info(f"Loaded {len(self.registry)} model records from registry.")
            except Exception as e:
                logger.error(f"Error reading model registry: {e}")
                self.registry = []
        else:
            self.registry = []

    def save_registry(self):
        """Save model registry to JSON."""
        try:
            with open(REGISTRY_FILE, "w") as f:
                json.dump(self.registry, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving registry file: {e}")

    def load_active_model(self):
        """Find active model in registry and deserialize."""
        active_entry = next((m for m in self.registry if m.get("active")), None)
        if active_entry:
            model_path = active_entry.get("path")
            if model_path and os.path.exists(model_path):
                try:
                    self.active_model = joblib.load(model_path)
                    self.active_version = active_entry.get("version")
                    self.metrics_history["active_accuracy"] = active_entry.get("accuracy", 0.942)
                    self.metrics_history["active_f1"] = active_entry.get("f1_score", 0.928)
                    logger.info(f"Active model loaded: {self.active_version} from {model_path}")
                    return
                except Exception as e:
                    logger.error(f"Failed to load active model from {model_path}: {e}")

        # If no trained model found on disk, bootstrap initial model v1.0.0
        logger.info("No active model found. Training initial baseline model v1.0.0...")
        self.train_and_evaluate(version_tag="v1.0.0", force_deploy=True)

    def train_and_evaluate(
        self, version_tag: Optional[str] = None, force_deploy: bool = False
    ) -> Dict[str, Any]:
        """
        Train Random Forest model using data pipeline, evaluate with 5-fold cross-validation.
        Deploy only if new accuracy >= current accuracy + 0.02 (or force_deploy=True).
        """
        start_time = time.time()
        X, y = load_training_data_from_db()

        new_version = version_tag or f"v1.{len(self.registry)}.{int(time.time()) % 1000}"
        logger.info(f"Initiating model training for {new_version} on {len(X)} samples...")

        # Random Forest Classifier with balanced class weights
        clf = RandomForestClassifier(
            n_estimators=120,
            max_depth=12,
            min_samples_split=4,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1,
        )

        # 5-Fold Stratified Cross-Validation
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        cv_scores = cross_validate(clf, X, y, cv=cv, scoring=["accuracy", "f1_macro"])

        cv_accuracy = float(np.mean(cv_scores["test_accuracy"]))
        cv_f1 = float(np.mean(cv_scores["test_f1_macro"]))

        # Fit model on the full dataset
        clf.fit(X, y)

        training_duration = round(time.time() - start_time, 3)

        # Evaluate against active production model
        current_acc = self.metrics_history.get("active_accuracy", 0.90)
        improvement = cv_accuracy - current_acc
        should_deploy = force_deploy or (improvement >= 0.02) or (self.active_model is None)

        model_filename = f"rf_model_{new_version}.joblib"
        model_path = os.path.join(MODELS_DIR, model_filename)
        joblib.dump(clf, model_path)

        # Log with MLflow
        self._log_mlflow(new_version, cv_accuracy, cv_f1, training_duration, len(X), should_deploy)

        entry = {
            "version": new_version,
            "path": model_path,
            "accuracy": round(cv_accuracy, 4),
            "f1_score": round(cv_f1, 4),
            "deployed_at": datetime.utcnow().isoformat(),
            "active": should_deploy,
            "sample_count": len(X),
            "training_duration_s": training_duration,
            "metadata": {
                "n_estimators": 120,
                "improvement_over_previous": round(improvement, 4),
                "features": FEATURE_COLUMNS,
            },
        }

        if should_deploy:
            for item in self.registry:
                item["active"] = False
            self.active_model = clf
            self.active_version = new_version
            self.metrics_history["active_accuracy"] = cv_accuracy
            self.metrics_history["active_f1"] = cv_f1
            logger.info(
                f"✅ Model {new_version} promoted to ACTIVE (Accuracy: {cv_accuracy:.4f}, F1: {cv_f1:.4f})"
            )
        else:
            # Set as candidate shadow model for comparison
            self.shadow_model = clf
            self.shadow_version = new_version
            logger.info(
                f"ℹ️ Model {new_version} kept in shadow mode (Accuracy {cv_accuracy:.4f} did not beat current {current_acc:.4f} by +2%)"
            )

        self.registry.insert(0, entry)
        self.save_registry()

        return {
            "success": True,
            "version": new_version,
            "accuracy": round(cv_accuracy, 4),
            "f1_score": round(cv_f1, 4),
            "deployed": should_deploy,
            "previous_accuracy": round(current_acc, 4),
            "improvement": round(improvement, 4),
            "training_duration_seconds": training_duration,
            "samples_used": len(X),
            "active_version": self.active_version,
        }

    def rollback(self) -> Dict[str, Any]:
        """Rollback active model to the previous working version."""
        if len(self.registry) < 2:
            return {
                "success": False,
                "error": "No previous model version available for rollback.",
                "active_version": self.active_version,
            }

        prev_version = None
        for item in self.registry:
            if not item.get("active") and os.path.exists(item.get("path", "")):
                prev_version = item
                break

        if not prev_version:
            return {
                "success": False,
                "error": "No valid inactive model artifact found.",
                "active_version": self.active_version,
            }

        rolled_back_from = self.active_version
        try:
            model = joblib.load(prev_version["path"])
            for item in self.registry:
                item["active"] = False
            prev_version["active"] = True

            self.active_model = model
            self.active_version = prev_version["version"]
            self.metrics_history["active_accuracy"] = prev_version.get("accuracy", 0.90)
            self.metrics_history["active_f1"] = prev_version.get("f1_score", 0.88)
            self.save_registry()

            logger.info(f"🔄 Rollback successful. Active model is now {self.active_version}")
            return {
                "success": True,
                "active_version": self.active_version,
                "rolled_back_from": rolled_back_from,
                "accuracy": prev_version.get("accuracy"),
                "f1_score": prev_version.get("f1_score"),
            }
        except Exception as e:
            logger.error(f"Rollback failed: {e}")
            return {"success": False, "error": str(e), "active_version": self.active_version}

    def predict(self, raw_features: Dict[str, Any]) -> Dict[str, Any]:
        """
        Run inference using active model. Returns issue_type, confidence,
        recommended_remediation, probabilities, and model_version.
        """
        start = time.time()
        feats = extract_features_from_dict(raw_features)
        x_vec = pd.DataFrame([feats])[FEATURE_COLUMNS]

        if self.active_model is None:
            self.load_active_model()

        probs = self.active_model.predict_proba(x_vec)[0]
        classes = self.active_model.classes_

        top_idx = int(np.argmax(probs))
        predicted_issue = classes[top_idx]
        confidence = float(probs[top_idx])

        duration_ms = (time.time() - start) * 1000.0

        # Update telemetry metrics
        self.metrics_history["prediction_count"] += 1
        self.metrics_history["total_latency_ms"] += duration_ms
        self.metrics_history["total_confidence"] += confidence
        self.metrics_history["last_prediction_ts"] = datetime.utcnow().isoformat()

        class_prob_dict = {cls: round(float(probs[i]), 4) for i, cls in enumerate(classes)}

        remediation = REMEDIATION_MAP.get(
            predicted_issue, "Perform standard self-healing diagnostics and retry failed operations."
        )

        return {
            "issue_type": predicted_issue,
            "confidence": round(confidence, 4),
            "model_version": self.active_version or "v1.0.0",
            "recommended_remediation": remediation,
            "latency_ms": round(duration_ms, 2),
            "probabilities": class_prob_dict,
        }

    def shadow_evaluate(self, test_samples: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Compare predictions of current active model vs candidate shadow model."""
        if not self.shadow_model:
            return {"shadow_available": False, "message": "No shadow model currently active."}

        agreements = 0
        results = []
        for sample in test_samples:
            feats = extract_features_from_dict(sample)
            x_vec = pd.DataFrame([feats])[FEATURE_COLUMNS]
            act_pred = self.active_model.predict(x_vec)[0]
            shd_pred = self.shadow_model.predict(x_vec)[0]
            agree = act_pred == shd_pred
            if agree:
                agreements += 1
            results.append({"active": act_pred, "shadow": shd_pred, "agree": agree})

        agreement_rate = agreements / max(1, len(test_samples))
        return {
            "shadow_available": True,
            "active_version": self.active_version,
            "shadow_version": self.shadow_version,
            "sample_count": len(test_samples),
            "agreement_rate": round(agreement_rate, 4),
        }

    def _log_mlflow(self, version, accuracy, f1, duration, n_samples, deployed):
        """Optional MLflow experiment tracking."""
        try:
            import mlflow

            mlflow.set_tracking_uri(MLFLOW_URI)
            mlflow.set_experiment("self_healing_aiops")
            with mlflow.start_run(run_name=f"run_{version}"):
                mlflow.log_param("version", version)
                mlflow.log_param("n_samples", n_samples)
                mlflow.log_metric("cv_accuracy", accuracy)
                mlflow.log_metric("cv_f1", f1)
                mlflow.log_metric("duration_seconds", duration)
                mlflow.log_metric("deployed", 1 if deployed else 0)
        except Exception as e:
            logger.debug(f"MLflow logging skipped: {e}")

    def get_prometheus_metrics(self) -> str:
        """Render Prometheus metrics string."""
        count = max(1, self.metrics_history["prediction_count"])
        avg_latency = self.metrics_history["total_latency_ms"] / count
        avg_confidence = self.metrics_history["total_confidence"] / count
        acc = self.metrics_history["active_accuracy"]
        f1 = self.metrics_history["active_f1"]

        return (
            "# HELP ml_accuracy Current active model cross-validation accuracy\n"
            "# TYPE ml_accuracy gauge\n"
            f"ml_accuracy {acc:.4f}\n\n"
            "# HELP ml_f1_score Current active model macro F1 score\n"
            "# TYPE ml_f1_score gauge\n"
            f"ml_f1_score {f1:.4f}\n\n"
            "# HELP ml_confidence_avg Average prediction confidence score\n"
            "# TYPE ml_confidence_avg gauge\n"
            f"ml_confidence_avg {avg_confidence:.4f}\n\n"
            "# HELP ml_latency_ms Average model inference latency in milliseconds\n"
            "# TYPE ml_latency_ms gauge\n"
            f"ml_latency_ms {avg_latency:.2f}\n\n"
            "# HELP ml_predictions_total Total predictions performed\n"
            "# TYPE ml_predictions_total counter\n"
            f"ml_predictions_total {self.metrics_history['prediction_count']}\n"
        )
