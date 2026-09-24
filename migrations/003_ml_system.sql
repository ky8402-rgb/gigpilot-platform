-- Migration 003: Predictive Machine Learning System
-- Creates tables for ML training datasets, prediction feedback loops, and model version registry

CREATE TABLE IF NOT EXISTS ml_training_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    features JSONB NOT NULL,
    label TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    source TEXT DEFAULT 'health_check'
);

CREATE INDEX IF NOT EXISTS idx_ml_training_ts ON ml_training_data (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ml_training_label ON ml_training_data (label);

CREATE TABLE IF NOT EXISTS ml_feedback (
    prediction_id UUID PRIMARY KEY,
    predicted_label TEXT NOT NULL,
    confidence DECIMAL(5, 4) NOT NULL,
    actual_label TEXT,
    remediation_success BOOLEAN DEFAULT FALSE,
    features JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_feedback_ts ON ml_feedback (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ml_feedback_pred_label ON ml_feedback (predicted_label);

CREATE TABLE IF NOT EXISTS ml_models (
    version TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    accuracy DECIMAL(5, 4) NOT NULL,
    f1_score DECIMAL(5, 4) NOT NULL,
    deployed_at TIMESTAMP DEFAULT NOW(),
    active BOOLEAN DEFAULT FALSE,
    metadata JSONB
);

-- Seed initial production baseline model record
INSERT INTO ml_models (version, path, accuracy, f1_score, deployed_at, active, metadata)
VALUES (
    'v1.0.0',
    'models/rf_model_v1.0.0.joblib',
    0.9420,
    0.9280,
    NOW(),
    TRUE,
    '{"algorithm": "RandomForestClassifier", "features_count": 18, "description": "Initial baseline model trained on historical diagnostics"}'::jsonb
)
ON CONFLICT (version) DO NOTHING;
