import { ToolMetadata, ToolExecutionResult } from './toolDefinitions.js';
import { learningPipeline } from '../aiops/training.js';
import { captureCurrentTelemetry } from '../aiops/telemetry.js';
import { issueClassifier } from '../aiops/classifier.js';
import { failurePredictor } from '../aiops/predictor.js';
import { remediationSelector } from '../aiops/remediationSelector.js';
import { anomalyDetector } from '../aiops/anomalyDetector.js';
import { eventBus } from '../events/eventBus.js';

export const retrainModelTool: ToolMetadata = {
  name: 'retrain_model',
  description: 'Triggers continuous ML retraining against aggregated telemetry and recent incident records',
  version: '1.2.0',
  category: 'mlops',
  riskLevel: 2,
  riskName: 'Important writes',
  permission: 'MEDIUM',
  requiresConfirmation: false,
  timeout: 30000,
  retryPolicy: { maxRetries: 1, backoffMs: 1000 },
  idempotency: true,
  productionAvailability: true,
  parameters: {
    targetComponent: {
      type: 'string',
      description: 'Component domain to retrain (e.g., predictive_aiops, telemetry)',
      required: false,
      default: 'predictive_aiops',
    },
  },
  execute: async (args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    log('🤖 Initializing ML Retraining Pipeline...');
    log('📊 Ingesting incident history buffer & streaming telemetry vectors...');

    const result = await learningPipeline.retrainCandidateModel();

    log(`📈 Candidate Model Generated: ${result.candidate.version}`);
    log(`📊 Accuracy Delta: ${result.evaluationReport.accuracyDelta > 0 ? '+' : ''}${(result.evaluationReport.accuracyDelta * 100).toFixed(1)}%`);
    log(`🎯 F1 Score Delta: ${result.evaluationReport.f1Delta > 0 ? '+' : ''}${(result.evaluationReport.f1Delta * 100).toFixed(1)}%`);

    for (const r of result.evaluationReport.reasons) {
      log(`  • Gate evaluation: ${r}`);
    }

    log(`🏁 Promotion Decision: [${result.promotionDecision}]`);

    return {
      success: true,
      toolName: 'retrain_model',
      summary: `ML Model retraining completed with decision: ${result.promotionDecision} (Version: ${result.candidate.version})`,
      logs,
      data: result,
      stateMutated: result.promotionDecision === 'PROMOTED',
      affectedComponent: 'predictive_ml_aiops',
      refreshTargets: ['aiops_learning', 'health_status'],
    };
  },
};

export const evaluateModelTool: ToolMetadata = {
  name: 'evaluate_model',
  description: 'Evaluates candidate and active ML models against strict quality guardrails',
  version: '1.0.0',
  category: 'mlops',
  riskLevel: 0,
  riskName: 'Read',
  permission: 'READ_ONLY',
  requiresConfirmation: false,
  timeout: 10000,
  retryPolicy: { maxRetries: 2, backoffMs: 500 },
  idempotency: true,
  productionAvailability: true,
  parameters: {},
  execute: async (_args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    log('🔬 Inspecting active and candidate ML models...');
    const active = learningPipeline.getActiveModel();
    const candidate = learningPipeline.getCandidateModel();

    log(`✓ Active model: ${active.version} (Accuracy: ${(active.accuracy * 100).toFixed(1)}%, F1: ${(active.f1_score * 100).toFixed(1)}%)`);
    if (candidate) {
      log(`✓ Candidate model: ${candidate.version} (Status: ${candidate.status})`);
    } else {
      log('ℹ No candidate model currently queued for evaluation.');
    }

    return {
      success: true,
      toolName: 'evaluate_model',
      summary: `Active model: ${active.version} | Candidate: ${candidate ? candidate.version : 'none'}`,
      logs,
      data: { active, candidate },
    };
  },
};

export const rollbackModelTool: ToolMetadata = {
  name: 'rollback_model',
  description: 'Rolls back production model to previous stable archived version if anomaly detected',
  version: '1.0.0',
  category: 'mlops',
  riskLevel: 2,
  riskName: 'Important writes',
  permission: 'MEDIUM',
  requiresConfirmation: true,
  timeout: 15000,
  retryPolicy: { maxRetries: 1, backoffMs: 1000 },
  idempotency: true,
  productionAvailability: true,
  parameters: {
    targetVersion: {
      type: 'string',
      description: 'Specific archived model version to revert to',
      required: false,
    },
  },
  execute: async (args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    log('⏪ Executing model rollback protocol...');
    const rollbackResult = learningPipeline.rollbackModel(args.targetVersion);

    log(`✓ ${rollbackResult.message}`);
    log(`✓ Active version restored: ${rollbackResult.activeModel.version}`);

    return {
      success: rollbackResult.success,
      toolName: 'rollback_model',
      summary: rollbackResult.message,
      logs,
      data: rollbackResult,
      stateMutated: true,
      affectedComponent: 'predictive_ml_aiops',
      refreshTargets: ['aiops_learning', 'health_status'],
    };
  },
};

export const runHealthCheckTool: ToolMetadata = {
  name: 'run_health_check',
  description: 'Executes end-to-end telemetry probe and predictive issue diagnosis',
  version: '1.1.0',
  category: 'system',
  riskLevel: 0,
  riskName: 'Read',
  permission: 'READ_ONLY',
  requiresConfirmation: false,
  timeout: 10000,
  retryPolicy: { maxRetries: 2, backoffMs: 500 },
  idempotency: true,
  productionAvailability: true,
  parameters: {},
  execute: async (_args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    log('🩺 Capturing real-time system telemetry and subsystem states...');
    const telemetry = await captureCurrentTelemetry();
    const issue = issueClassifier.classify(telemetry);
    const failure = failurePredictor.predict(telemetry);
    const anomaly = anomalyDetector.detect(telemetry);

    log(`✓ CPU: ${telemetry.cpu_percent}% | Memory: ${telemetry.memory_used_mb}MB / ${telemetry.memory_total_mb}MB`);
    log(`✓ Error rate: ${(telemetry.error_rate * 100).toFixed(1)}% | DB Latency: ${telemetry.db_latency_ms}ms`);
    log(`✓ Classified issue: ${issue.issue_type} (Confidence: ${(issue.confidence * 100).toFixed(0)}%)`);

    return {
      success: true,
      toolName: 'run_health_check',
      summary: `System Health: ${anomaly.is_anomaly ? 'ANOMALY DETECTED' : 'NOMINAL'} | Primary Issue: ${issue.issue_type}`,
      logs,
      data: { telemetry, issue, failure, anomaly },
    };
  },
};

export const createIncidentTool: ToolMetadata = {
  name: 'create_incident',
  description: 'Records an incident into the AIOps continuous learning pipeline',
  version: '1.0.0',
  category: 'mlops',
  riskLevel: 1,
  riskName: 'Safe remediation',
  permission: 'LOW',
  requiresConfirmation: false,
  timeout: 10000,
  retryPolicy: { maxRetries: 1, backoffMs: 500 },
  idempotency: true,
  productionAvailability: true,
  parameters: {
    problem: { type: 'string', description: 'Problem description or error type', required: true },
    action: { type: 'string', description: 'Remediation action applied', required: true },
    success: { type: 'boolean', description: 'Whether remediation succeeded', required: true },
  },
  execute: async (args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    const incidentId = `inc_${Date.now()}`;
    log(`📝 Recording incident [${incidentId}]...`);

    const telemetry = await captureCurrentTelemetry();
    learningPipeline.recordIncident({
      incident_id: incidentId,
      model_version: learningPipeline.getActiveModel().version,
      problem: args.problem || 'system_incident',
      action: args.action || 'diagnostics',
      confidence: 0.9,
      before: { error_rate: telemetry.error_rate, latency_ms: telemetry.api_latency_ms },
      after: { error_rate: args.success ? 0.0 : telemetry.error_rate, latency_ms: telemetry.api_latency_ms },
      success: Boolean(args.success),
      duration_ms: 250,
      timestamp: new Date().toISOString(),
      notes: args.notes || 'Recorded via AIOps control plane',
    });

    log(`✓ Incident [${incidentId}] persisted into training buffer.`);

    return {
      success: true,
      toolName: 'create_incident',
      summary: `Incident ${incidentId} logged successfully`,
      logs,
      data: { incidentId },
    };
  },
};
