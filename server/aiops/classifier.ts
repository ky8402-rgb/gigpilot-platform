import { TelemetrySnapshot, IssueClassifierOutput } from './types.js';

export class IssueClassifier {
  public classify(telemetry: TelemetrySnapshot): IssueClassifierOutput {
    // 1. Scraper / Freelancer API issue check
    if (telemetry.scraper_response_code >= 400 || telemetry.scraper_latency_ms > 600 || telemetry.auth_status === 'EXPIRED') {
      const conf = telemetry.scraper_response_code >= 500 ? 0.96 : 0.94;
      return {
        issue: 'freelancer_api_failure',
        issue_type: 'freelancer_api_failure',
        confidence: conf,
        details: `Freelancer API endpoint responding with status ${telemetry.scraper_response_code} (${telemetry.scraper_latency_ms}ms latency). Authentication: ${telemetry.auth_status}.`,
      };
    }

    // 2. Database issue check
    if (!telemetry.db_connected || telemetry.db_latency_ms > 150) {
      return {
        issue: 'database_degradation',
        issue_type: 'database_degradation',
        confidence: telemetry.db_connected ? 0.88 : 0.98,
        details: `PostgreSQL connection latency is elevated at ${telemetry.db_latency_ms}ms (Connected: ${telemetry.db_connected}).`,
      };
    }

    // 3. Queue bottleneck check
    if (telemetry.failed_jobs > 0 || telemetry.queue_depth > 15) {
      return {
        issue: 'queue_bottleneck',
        issue_type: 'queue_bottleneck',
        confidence: 0.91,
        details: `Asynchronous job queue has ${telemetry.queue_depth} jobs waiting with ${telemetry.failed_jobs} failed workers.`,
      };
    }

    // 4. Nominal state
    return {
      issue: 'none',
      issue_type: 'none',
      confidence: 0.95,
      details: 'All core system metrics are within nominal operational tolerances.',
    };
  }
}

export const issueClassifier = new IssueClassifier();
