import { z } from 'zod';

/**
 * Tool Permission & Risk Levels
 * READ_ONLY: Inspect, read-only diagnostics (Level 0)
 * LOW: Safe worker restarts, cache flushes, telemetry probes (Level 1)
 * MEDIUM: Safe state updates, data sync, queue requeue (Level 2)
 * HIGH: Major configuration changes, operational balance reconciliation (Level 3)
 * CRITICAL: Destructive operations, credential updates, balance wipes (Level 4 / Banned)
 */
export const ToolPermissionSchema = z.enum([
  'READ_ONLY',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;

export function permissionToRiskLevel(p: ToolPermission): number {
  switch (p) {
    case 'READ_ONLY': return 0;
    case 'LOW': return 1;
    case 'MEDIUM': return 2;
    case 'HIGH': return 3;
    case 'CRITICAL': return 4;
    default: return 1;
  }
}

export function riskLevelToPermission(level: number): ToolPermission {
  if (level <= 0) return 'READ_ONLY';
  if (level === 1) return 'LOW';
  if (level === 2) return 'MEDIUM';
  if (level === 3) return 'HIGH';
  return 'CRITICAL';
}

/**
 * 1. AI Intent Schema
 * Represents WHAT the user wants, not HOW to accomplish it.
 */
export const IntentTypeSchema = z.enum([
  'DIAGNOSE',
  'REPAIR',
  'SYNC',
  'RETRY',
  'VERIFY',
  'UPDATE',
  'CREATE',
  'DELETE',
  'QUERY',
  'CONFIGURE',
  'RETRAIN_MODEL',
  'ROLLBACK',
  'MONITOR',
]);
export type IntentType = z.infer<typeof IntentTypeSchema>;

export const AIIntentSchema = z.object({
  id: z.string(),
  type: IntentTypeSchema,
  target: z.string(),
  originalUserRequest: z.string(),
  normalizedObjective: z.string(),
  extractedEntities: z.record(z.string(), z.any()).default({}),
  confidence: z.number().min(0).max(1),
  risk: ToolPermissionSchema,
  requiresApproval: z.boolean(),
  conversationId: z.string(),
  createdAt: z.string(),
});
export type AIIntent = z.infer<typeof AIIntentSchema>;

/**
 * 2. System State Schema
 * Verified, real application state snapshot.
 */
export const SystemStateSchema = z.object({
  timestamp: z.string(),
  status: z.enum(['HEALTHY', 'DEGRADED', 'CRITICAL']),
  database: z.object({
    connected: z.boolean(),
    type: z.string(),
    latencyMs: z.number(),
    provider: z.string(),
    activeConnections: z.number().default(1),
    tables: z.record(z.string(), z.number()).default({}),
    message: z.string().optional(),
  }),
  queues: z.object({
    status: z.string(),
    waitingJobs: z.number(),
    activeJobs: z.number(),
    failedJobs: z.number(),
    delayedJobs: z.number().default(0),
    message: z.string().optional(),
  }),
  freelancer: z.object({
    status: z.enum(['HEALTHY', 'DEGRADED', 'OFFLINE']),
    reachable: z.boolean(),
    latencyMs: z.number(),
    scraperRunning: z.boolean(),
    lastSyncTimestamp: z.string().optional(),
    jobsCount: z.number().default(0),
    message: z.string().optional(),
  }),
  paypal: z.object({
    status: z.enum(['HEALTHY', 'DEGRADED', 'OFFLINE']),
    connected: z.boolean(),
    mode: z.string(),
    latencyMs: z.number(),
    message: z.string().optional(),
  }),
  cron: z.object({
    status: z.string(),
    lastRun: z.string().optional(),
    intervalSeconds: z.number().default(30),
  }),
  workOrders: z.object({
    status: z.string(),
    totalActive: z.number(),
    overdueCount: z.number(),
    failedPayments: z.number(),
    totalCompleted: z.number(),
  }),
  transactions: z.object({
    totalCount: z.number(),
    pendingCount: z.number(),
    failedCount: z.number(),
  }),
  activeModel: z.object({
    name: z.string().default('predictive_aiops'),
    version: z.string(),
    status: z.string(),
    accuracy: z.number(),
    f1_score: z.number(),
    avg_inference_latency_ms: z.number(),
  }),
  telemetry: z.object({
    cpu_percent: z.number(),
    memory_used_mb: z.number(),
    memory_total_mb: z.number(),
    error_rate: z.number(),
    api_latency_ms: z.number(),
  }),
});
export type SystemState = z.infer<typeof SystemStateSchema>;

/**
 * 3. AI Tool Schema
 * Certified tool definition within the Tool Registry.
 */
export const AIToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().default('1.0.0'),
  inputSchema: z.record(z.string(), z.any()).default({}),
  outputSchema: z.record(z.string(), z.any()).default({}),
  permission: ToolPermissionSchema,
  risk: ToolPermissionSchema,
  timeout: z.number().default(15000),
  retryPolicy: z.object({
    maxRetries: z.number().default(2),
    backoffMs: z.number().default(500),
    exponential: z.boolean().default(true),
  }),
  idempotency: z.boolean().default(true),
  productionAvailability: z.boolean().default(true),
  category: z.enum(['database', 'freelancer', 'queues', 'work_orders', 'paypal', 'system', 'mlops']),
});
export type AITool = z.infer<typeof AIToolSchema>;

/**
 * 4. Execution Step Schema
 * Atomic step in an AIPlan with explicit dependencies.
 */
export const StepStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCESS',
  'FAILURE',
  'TIMEOUT',
  'CANCELLED',
  'ROLLED_BACK',
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const ExecutionStepSchema = z.object({
  id: z.string(),
  planId: z.string(),
  sequence: z.number(),
  toolName: z.string(),
  validatedArguments: z.record(z.string(), z.any()).default({}),
  dependencies: z.array(z.string()).default([]), // IDs of previous steps that must succeed first
  status: StepStatusSchema.default('QUEUED'),
  risk: ToolPermissionSchema,
  approvalState: z.enum(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED']).default('NOT_REQUIRED'),
  idempotencyKey: z.string(),
  timeout: z.number().default(15000),
  retryPolicy: z.object({
    maxRetries: z.number().default(2),
    backoffMs: z.number().default(500),
  }),
  output: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    severity: z.string(),
  }).optional(),
  timestamps: z.object({
    queuedAt: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
  }),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

/**
 * 5. AI Plan Schema
 * Full execution plan with rollback configurations.
 */
export const PlanStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const AIPlanSchema = z.object({
  id: z.string(),
  intentId: z.string(),
  conversationId: z.string(),
  status: PlanStatusSchema.default('DRAFT'),
  summary: z.string(),
  risk: ToolPermissionSchema,
  requiresApproval: z.boolean(),
  approvalInformation: z.object({
    approvedBy: z.string().optional(),
    approvedAt: z.string().optional(),
    reason: z.string().optional(),
  }).optional(),
  orderedExecutionSteps: z.array(ExecutionStepSchema),
  timeout: z.number().default(60000),
  rollbackConfiguration: z.object({
    enabled: z.boolean().default(true),
    rollbackSteps: z.array(z.string()).default([]),
  }),
  timestamps: z.object({
    createdAt: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
  }),
});
export type AIPlan = z.infer<typeof AIPlanSchema>;

/**
 * 6. Verification Result Schema
 * Rigorous post-execution verification testing empirical evidence.
 */
export const VerificationStatusSchema = z.enum([
  'PASSED',
  'FAILED',
  'PARTIAL',
  'INCONCLUSIVE',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const VerificationCheckSchema = z.object({
  title: z.string(),
  passed: z.boolean(),
  evidence: z.string(),
  checkedAt: z.string(),
});
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

export const VerificationResultSchema = z.object({
  status: VerificationStatusSchema,
  overallHealthy: z.boolean(),
  checks: z.array(VerificationCheckSchema),
  telemetryBefore: z.object({
    error_rate: z.number(),
    latency_ms: z.number(),
  }),
  telemetryAfter: z.object({
    error_rate: z.number(),
    latency_ms: z.number(),
  }),
  summary: z.string(),
  timestamp: z.string(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

/**
 * 7. Audit Event Schema
 * Immutable audit log record with credential redaction.
 */
export const AuditEventTypeSchema = z.enum([
  'INTENT_CREATED',
  'PLAN_CREATED',
  'PLAN_APPROVED',
  'PLAN_REJECTED',
  'STEP_QUEUED',
  'STEP_STARTED',
  'STEP_SUCCEEDED',
  'STEP_FAILED',
  'STEP_RETRIED',
  'TOOL_INVOKED',
  'TOOL_COMPLETED',
  'VERIFICATION_STARTED',
  'VERIFICATION_PASSED',
  'VERIFICATION_FAILED',
  'ROLLBACK_STARTED',
  'ROLLBACK_COMPLETED',
  'MODEL_INFERENCE',
  'MODEL_FEEDBACK',
  'MODEL_TRAINING_STARTED',
  'MODEL_TRAINING_COMPLETED',
  'MODEL_PROMOTED',
  'MODEL_REJECTED',
  'MODEL_ROLLED_BACK',
  'INCIDENT_CREATED',
  'INCIDENT_RESOLVED',
  'SECURITY_VIOLATION_BLOCKED',
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditEventSchema = z.object({
  eventId: z.string(),
  eventType: AuditEventTypeSchema,
  timestamp: z.string(),
  actor: z.string().default('user'),
  requestId: z.string(),
  conversationId: z.string(),
  intentId: z.string().optional(),
  planId: z.string().optional(),
  stepId: z.string().optional(),
  toolName: z.string().optional(),
  resource: z.string().optional(),
  resourceId: z.string().optional(),
  status: z.enum(['SUCCESS', 'FAILURE', 'PENDING', 'BLOCKED', 'WARNING', 'REJECTED']),
  risk: ToolPermissionSchema,
  modelVersion: z.string().optional(),
  confidence: z.number().optional(),
  metadata: z.record(z.string(), z.any()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * 8. Remediation Policy Schema
 * Server-side governance policy rules.
 */
export const RemediationPolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  targetComponent: z.string(),
  maxAutoRiskLevel: ToolPermissionSchema,
  requireConfirmationFor: z.array(ToolPermissionSchema),
  allowedTools: z.array(z.string()),
  blockedTools: z.array(z.string()),
  maxRetriesPerStep: z.number().default(2),
  executionTimeoutMs: z.number().default(60000),
});
export type RemediationPolicy = z.infer<typeof RemediationPolicySchema>;

/**
 * 9. ML Inference Schema
 */
export const MLInferenceSchema = z.object({
  inferenceId: z.string(),
  timestamp: z.string(),
  modelVersion: z.string(),
  issueType: z.string(),
  confidence: z.number().min(0).max(1),
  failurePrediction: z.string().optional(),
  anomalyScore: z.number().optional(),
  recommendedActions: z.array(z.string()),
  features: z.record(z.string(), z.number()).default({}),
});
export type MLInference = z.infer<typeof MLInferenceSchema>;

/**
 * 10. ML Feedback Schema
 * Recorded after every remediation attempt to feed the self-learning loop.
 */
export const MLFeedbackSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  modelName: z.string().default('predictive_aiops'),
  modelVersion: z.string(),
  inferenceId: z.string(),
  planId: z.string(),
  actionTaken: z.string(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'PARTIAL']),
  metricsBefore: z.object({
    errorRate: z.number(),
    latencyMs: z.number(),
  }),
  metricsAfter: z.object({
    errorRate: z.number(),
    latencyMs: z.number(),
  }),
  improvement: z.number(),
  eligibleForTraining: z.boolean(),
});
export type MLFeedback = z.infer<typeof MLFeedbackSchema>;
