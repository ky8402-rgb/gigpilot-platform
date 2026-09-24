export interface TelemetrySnapshot {
  cpu_usage_pct: number;
  memory_usage_pct: number;
  api_latency_ms: number;
  db_latency_ms: number;
  db_connected: boolean;
  queue_depth: number;
  failed_jobs: number;
  scraper_response_code: number;
  scraper_latency_ms: number;
  auth_status: 'VALID' | 'DEGRADED' | 'EXPIRED';
  timestamp: string;
  // Aliases and system metric properties
  cpu_percent?: number;
  memory_used_mb?: number;
  memory_total_mb?: number;
  error_rate: number;
}

export interface IssueClassifierOutput {
  issue: 'freelancer_api_failure' | 'database_degradation' | 'queue_bottleneck' | 'paypal_gateway_error' | 'overdue_work_orders' | 'none';
  issue_type: string;
  confidence: number;
  details: string;
}

export interface FailurePredictionOutput {
  component: 'freelancer_api' | 'postgresql_neon' | 'bull_redis_queues' | 'automated_self_healing';
  failure_probability: number;
  time_horizon: '5m' | '15m' | '1h' | '24h';
  risk_factors: string[];
}

export interface RemediationSelectorOutput {
  recommended_action: string;
  confidence: number;
  expected_success: number;
  alternative_actions: string[];
}

export interface AnomalyDetectionOutput {
  is_anomaly: boolean;
  anomaly_score: number;
  drifted_metrics: Array<{ metric: string; value: number; baseline: number; z_score: number }>;
}

export interface IncidentRecord {
  incident_id: string;
  model_version: string;
  problem: string;
  action: string;
  confidence: number;
  before: {
    error_rate: number;
    latency_ms: number;
  };
  after: {
    error_rate: number;
    latency_ms: number;
  };
  success: boolean;
  duration_ms: number;
  timestamp: string;
  notes?: string;
}

export interface ModelMetrics {
  version: string;
  accuracy: number;
  f1_score: number;
  precision: number;
  recall: number;
  false_positive_rate: number;
  avg_inference_latency_ms: number;
  total_training_samples: number;
  promoted_at: string;
  status: 'PRODUCTION' | 'CANDIDATE' | 'REJECTED' | 'ARCHIVED';
}
