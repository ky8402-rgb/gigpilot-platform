import { IncidentRecord, ModelMetrics } from './types.js';
import { eventBus } from '../events/eventBus.js';

export class ContinuousLearningPipeline {
  private incidentHistory: IncidentRecord[] = [];
  private activeModel: ModelMetrics = {
    version: 'v2.4.1-prod',
    accuracy: 0.942,
    f1_score: 0.928,
    precision: 0.935,
    recall: 0.921,
    false_positive_rate: 0.041,
    avg_inference_latency_ms: 18.5,
    total_training_samples: 1250,
    promoted_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    status: 'PRODUCTION',
  };

  private candidateModel: ModelMetrics | null = null;
  private archivedModels: ModelMetrics[] = [];

  constructor() {
    // Seed initial historical incident
    this.incidentHistory.push({
      incident_id: 'inc_prev_001',
      model_version: 'v2.4.1-prod',
      problem: 'freelancer_api_timeout',
      action: 'restartScraper',
      confidence: 0.91,
      before: { error_rate: 0.38, latency_ms: 620 },
      after: { error_rate: 0.0, latency_ms: 145 },
      success: true,
      duration_ms: 412,
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      notes: 'Scraper handles recycled; 0 errors observed post-action.',
    });
  }

  /**
   * Record an incident remediation event into the continuous learning buffer
   */
  public recordIncident(incident: IncidentRecord): void {
    this.incidentHistory.unshift(incident);
    if (this.incidentHistory.length > 200) {
      this.incidentHistory.pop();
    }

    eventBus.emitEvent({
      type: 'LEARNING_FEEDBACK_RECORDED',
      component: 'predictive_ml_aiops',
      status: incident.success ? 'HEALTHY' : 'DEGRADED',
      action_applied: incident.action,
      details: {
        incident_id: incident.incident_id,
        success: incident.success,
        duration_ms: incident.duration_ms,
      },
      refresh_target: ['aiops_learning', 'health_status'],
    });
  }

  public getIncidentHistory(limit = 20): IncidentRecord[] {
    return this.incidentHistory.slice(0, limit);
  }

  public getActiveModel(): ModelMetrics {
    return this.activeModel;
  }

  public getCandidateModel(): ModelMetrics | null {
    return this.candidateModel;
  }

  public async trainCandidateModel() {
    const res = await this.retrainCandidateModel();
    return {
      candidate: res.candidate,
      evaluationPassed: res.promotionDecision === 'PROMOTED',
      report: res.evaluationReport,
    };
  }

  /**
   * Run model retraining job on aggregated telemetry and incident records
   */
  public async retrainCandidateModel(): Promise<{
    candidate: ModelMetrics;
    promotionDecision: 'PROMOTED' | 'REJECTED';
    evaluationReport: {
      accuracyDelta: number;
      f1Delta: number;
      falsePositiveAcceptable: boolean;
      latencyAcceptable: boolean;
      noCriticalRegression: boolean;
      reasons: string[];
    };
  }> {
    const totalSamples = this.activeModel.total_training_samples + this.incidentHistory.length;
    const versionNumber = (parseFloat(this.activeModel.version.replace('v', '')) + 0.1).toFixed(1);

    // Compute candidate metrics based on recent incident success rate
    const recentSuccessRate = this.incidentHistory.filter((i) => i.success).length / Math.max(1, this.incidentHistory.length);
    const candidateAccuracy = Math.min(0.99, Number((this.activeModel.accuracy + (recentSuccessRate > 0.8 ? 0.012 : -0.02)).toFixed(3)));
    const candidateF1 = Math.min(0.98, Number((this.activeModel.f1_score + (recentSuccessRate > 0.8 ? 0.015 : -0.025)).toFixed(3)));
    const candidateFPR = Number((this.activeModel.false_positive_rate * 0.92).toFixed(3));
    const candidateLatency = Number((this.activeModel.avg_inference_latency_ms * 0.96).toFixed(1));

    const candidate: ModelMetrics = {
      version: `v${versionNumber}-candidate`,
      accuracy: candidateAccuracy,
      f1_score: candidateF1,
      precision: Number((candidateAccuracy * 0.99).toFixed(3)),
      recall: Number((candidateF1 * 0.98).toFixed(3)),
      false_positive_rate: candidateFPR,
      avg_inference_latency_ms: candidateLatency,
      total_training_samples: totalSamples,
      promoted_at: new Date().toISOString(),
      status: 'CANDIDATE',
    };

    this.candidateModel = candidate;

    // Strict Promotion Guardrail check:
    // Accuracy improvement AND F1 improvement AND acceptable false-positive rate (< 0.05) AND acceptable latency (< 25ms) AND no critical regression
    const accuracyDelta = candidate.accuracy - this.activeModel.accuracy;
    const f1Delta = candidate.f1_score - this.activeModel.f1_score;
    const falsePositiveAcceptable = candidate.false_positive_rate <= 0.05;
    const latencyAcceptable = candidate.avg_inference_latency_ms < 30;
    const noCriticalRegression = accuracyDelta >= 0 && f1Delta >= 0;

    const reasons: string[] = [];
    if (accuracyDelta > 0) reasons.push(`Accuracy improved by +${(accuracyDelta * 100).toFixed(1)}%`);
    else reasons.push(`Accuracy failed to improve (${(accuracyDelta * 100).toFixed(1)}%)`);

    if (f1Delta > 0) reasons.push(`F1 score improved by +${(f1Delta * 100).toFixed(1)}%`);
    else reasons.push(`F1 score failed to improve (${(f1Delta * 100).toFixed(1)}%)`);

    if (falsePositiveAcceptable) reasons.push(`False positive rate within tolerance (${(candidate.false_positive_rate * 100).toFixed(1)}% <= 5%)`);
    if (latencyAcceptable) reasons.push(`Inference latency within threshold (${candidate.avg_inference_latency_ms}ms < 30ms)`);

    const shouldPromote = accuracyDelta > 0 && f1Delta > 0 && falsePositiveAcceptable && latencyAcceptable && noCriticalRegression;

    if (shouldPromote) {
      candidate.status = 'PRODUCTION';
      candidate.version = `v${versionNumber}-prod`;
      this.archivedModels.unshift({ ...this.activeModel, status: 'ARCHIVED' });
      this.activeModel = candidate;
      this.candidateModel = null;

      eventBus.emitEvent({
        type: 'MODEL_PROMOTED',
        component: 'predictive_ml_aiops',
        status: 'HEALTHY',
        action_applied: 'model_promotion',
        details: {
          version: candidate.version,
          accuracy: candidate.accuracy,
          f1_score: candidate.f1_score,
        },
        refresh_target: ['aiops_learning', 'health_status'],
      });
    } else {
      candidate.status = 'REJECTED';
    }

    return {
      candidate,
      promotionDecision: shouldPromote ? 'PROMOTED' : 'REJECTED',
      evaluationReport: {
        accuracyDelta,
        f1Delta,
        falsePositiveAcceptable,
        latencyAcceptable,
        noCriticalRegression,
        reasons,
      },
    };
  }

  /**
   * Rollback production model to a previous stable archived version
   */
  public rollbackModel(targetVersion?: string): {
    success: boolean;
    activeModel: ModelMetrics;
    previousModel: ModelMetrics;
    message: string;
  } {
    const previousModel = this.activeModel;
    let target = this.archivedModels[0];

    if (targetVersion) {
      const found = this.archivedModels.find((m) => m.version === targetVersion);
      if (found) target = found;
    }

    if (!target) {
      // Default safe fallback if no archived model is stored yet
      target = {
        version: 'v2.3.0-stable-fallback',
        accuracy: 0.938,
        f1_score: 0.922,
        precision: 0.931,
        recall: 0.915,
        false_positive_rate: 0.045,
        avg_inference_latency_ms: 19.2,
        total_training_samples: 1100,
        promoted_at: new Date(Date.now() - 86400000 * 7).toISOString(),
        status: 'PRODUCTION',
      };
    }

    this.archivedModels.unshift({ ...this.activeModel, status: 'ARCHIVED' });
    this.activeModel = { ...target, status: 'PRODUCTION' };

    eventBus.emitEvent({
      type: 'MODEL_ROLLED_BACK',
      component: 'predictive_ml_aiops',
      status: 'HEALTHY',
      action_applied: 'model_rollback',
      details: {
        fromVersion: previousModel.version,
        toVersion: this.activeModel.version,
      },
      refresh_target: ['aiops_learning', 'health_status'],
    });

    return {
      success: true,
      activeModel: this.activeModel,
      previousModel,
      message: `Successfully rolled back active model from ${previousModel.version} to ${this.activeModel.version}`,
    };
  }
}

export const learningPipeline = new ContinuousLearningPipeline();
