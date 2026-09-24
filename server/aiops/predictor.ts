import { TelemetrySnapshot, FailurePredictionOutput } from './types.js';

export class FailurePredictor {
  public predict(telemetry: TelemetrySnapshot): FailurePredictionOutput {
    const riskFactors: string[] = [];
    let failureProb = 0.05;
    let horizon: '5m' | '15m' | '1h' | '24h' = '24h';
    let targetComponent: FailurePredictionOutput['component'] = 'freelancer_api';

    if (telemetry.scraper_latency_ms > 350 || telemetry.scraper_response_code >= 400) {
      targetComponent = 'freelancer_api';
      failureProb = 0.87;
      horizon = '15m';
      riskFactors.push('Scraper endpoint latency approaching HTTP gateway timeout limit');
      if (telemetry.auth_status === 'DEGRADED') riskFactors.push('OAuth bearer token nearing renewal window');
    } else if (!telemetry.db_connected || telemetry.db_latency_ms > 100) {
      targetComponent = 'postgresql_neon';
      failureProb = 0.82;
      horizon = '5m';
      riskFactors.push('Database connection latency spike and pool saturation');
    } else if (telemetry.failed_jobs > 0 || telemetry.queue_depth > 10) {
      targetComponent = 'bull_redis_queues';
      failureProb = 0.74;
      horizon = '15m';
      riskFactors.push('Worker concurrency queue depth exceeding intake rate');
    } else {
      riskFactors.push('Normal operational telemetry profile with steady throughput');
    }

    return {
      component: targetComponent,
      failure_probability: Number(failureProb.toFixed(2)),
      time_horizon: horizon,
      risk_factors: riskFactors,
    };
  }
}

export const failurePredictor = new FailurePredictor();
