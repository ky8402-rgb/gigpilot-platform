import { TelemetrySnapshot, AnomalyDetectionOutput } from './types.js';

interface MetricBaseline {
  mean: number;
  std: number;
}

const BASELINES: Record<string, MetricBaseline> = {
  api_latency_ms: { mean: 120, std: 45 },
  db_latency_ms: { mean: 25, std: 15 },
  queue_depth: { mean: 2, std: 3 },
  failed_jobs: { mean: 0, std: 0.8 },
  cpu_usage_pct: { mean: 28, std: 12 },
  memory_usage_pct: { mean: 42, std: 10 },
  scraper_latency_ms: { mean: 180, std: 60 },
};

export class AnomalyDetector {
  public detect(telemetry: TelemetrySnapshot): AnomalyDetectionOutput {
    const drifted: Array<{ metric: string; value: number; baseline: number; z_score: number }> = [];
    let maxZ = 0;

    for (const [metric, baseline] of Object.entries(BASELINES)) {
      const val = (telemetry as any)[metric];
      if (typeof val === 'number') {
        const z = (val - baseline.mean) / Math.max(1, baseline.std);
        if (z > 2.0) {
          drifted.push({
            metric,
            value: Number(val.toFixed(1)),
            baseline: baseline.mean,
            z_score: Number(z.toFixed(2)),
          });
        }
        if (z > maxZ) maxZ = z;
      }
    }

    const isAnomaly = drifted.length > 0 || !telemetry.db_connected || telemetry.auth_status === 'EXPIRED';
    const anomalyScore = Math.min(1.0, Math.max(0, isAnomaly ? (maxZ / 5) * 0.9 : 0.08));

    return {
      is_anomaly: isAnomaly,
      anomaly_score: Number(anomalyScore.toFixed(3)),
      drifted_metrics: drifted,
    };
  }
}

export const anomalyDetector = new AnomalyDetector();
