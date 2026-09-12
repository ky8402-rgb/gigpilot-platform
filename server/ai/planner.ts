import { getGeminiAI } from '../gemini.js';
import { ApplicationContext } from './context.js';
import { issueClassifier } from '../aiops/classifier.js';
import { failurePredictor } from '../aiops/predictor.js';
import { remediationSelector } from '../aiops/remediationSelector.js';
import { anomalyDetector } from '../aiops/anomalyDetector.js';
import { getRegisteredTool } from '../tools/index.js';
import { RiskLevel, ToolMetadata } from '../tools/toolDefinitions.js';
import {
  AIIntent,
  AIIntentSchema,
  AIPlan,
  AIPlanSchema,
  ExecutionStep,
  IntentType,
  ToolPermission,
} from './schemas.js';
import { auditStore } from './auditStore.js';

export interface StructuredCommand {
  intent: string;
  intentType?: IntentType;
  target: 'freelancer_api' | 'postgresql_neon' | 'bull_redis_queues' | 'automated_self_healing' | 'system' | 'mlops';
  objective: string;
  requested_actions: string[];
  risk: 'low' | 'medium' | 'high' | 'critical';
  requires_confirmation: boolean;
  rawIntent?: AIIntent;
}

export interface PlanStep {
  id?: string;
  stepNumber: number;
  toolName: string;
  tool: ToolMetadata;
  arguments: Record<string, any>;
  dependencies?: string[];
  description: string;
  riskLevel: RiskLevel;
  riskName: string;
  expectedOutcome: string;
}

export interface ExecutionPlan {
  id: string;
  intentId?: string;
  command: StructuredCommand;
  diagnosticChecklist: Array<{ item: string; status: 'ok' | 'warning' | 'error' | 'pending'; details?: string }>;
  mlInsight: {
    issue: string;
    confidence: number;
    failurePrediction?: string;
    anomalyScore?: number;
    recommendedRemediation?: string;
  };
  steps: PlanStep[];
  rawPlan?: AIPlan;
  rollbackConfiguration?: {
    enabled: boolean;
    rollbackSteps?: string[];
  };
  created_at: string;
}

export class AIPlanner {
  public async generatePlan(
    intent: AIIntent,
    context: ApplicationContext,
    conversationId?: string
  ): Promise<ExecutionPlan> {
    return this.createPlan(intent.originalUserRequest, context, conversationId || intent.conversationId);
  }

  /**
   * Translates natural language user instruction into a verified AIIntent,
   * evaluates ML diagnostic context, and produces a strictly validated AIPlan.
   */
  public async createPlan(
    userMessage: string,
    context: ApplicationContext,
    conversationId = 'default-session'
  ): Promise<ExecutionPlan> {
    const planId = `plan_${Date.now()}`;
    const telemetry = context.telemetry;

    // 1. Run AIOps Diagnostic and Prediction Models
    const issueOutput = issueClassifier.classify(telemetry);
    const failureOutput = failurePredictor.predict(telemetry);
    const remediationOutput = remediationSelector.selectRemediation(issueOutput);
    const anomalyOutput = anomalyDetector.detect(telemetry);

    auditStore.log({
      eventType: 'MODEL_INFERENCE',
      conversationId,
      status: 'SUCCESS',
      resource: issueOutput.issue,
      confidence: issueOutput.confidence,
      metadata: {
        issue: issueOutput.issue,
        failureRisk: failureOutput.failure_probability,
        anomalyScore: anomalyOutput.anomaly_score,
      },
    });

    // 2. Classify and strictly validate AIIntent
    const rawIntent = await this.classifyIntent(userMessage, conversationId, issueOutput);
    const validatedIntent = AIIntentSchema.parse(rawIntent);

    auditStore.log({
      eventType: 'INTENT_CREATED',
      conversationId,
      intentId: validatedIntent.id,
      status: 'SUCCESS',
      resource: validatedIntent.target,
      risk: validatedIntent.risk,
      metadata: {
        type: validatedIntent.type,
        normalizedObjective: validatedIntent.normalizedObjective,
        confidence: validatedIntent.confidence,
      },
    });

    // 3. Build Structured Command
    const command = this.buildCommandFromIntent(validatedIntent, issueOutput);

    // 4. Map Requested Actions to Tools & Order Dependencies
    const steps: PlanStep[] = [];
    let stepNum = 1;

    for (let i = 0; i < command.requested_actions.length; i++) {
      const actionName = command.requested_actions[i];
      const tool = getRegisteredTool(actionName);
      if (tool) {
        const stepId = `step_${stepNum}`;
        const previousStepId = stepNum > 1 ? `step_${stepNum - 1}` : undefined;

        // Establish explicit dependency: step depends on previous critical execution step
        const dependencies: string[] = [];
        if (previousStepId && !tool.name.toLowerCase().includes('verify')) {
          // If previous was a prerequisite, depend on it
          dependencies.push(previousStepId);
        } else if (stepNum > 1 && tool.name.toLowerCase().includes('verify')) {
          // Verification depends on the action immediately preceding it
          dependencies.push(`step_${stepNum - 1}`);
        }

        steps.push({
          id: stepId,
          stepNumber: stepNum++,
          toolName: tool.name,
          tool,
          arguments: {},
          dependencies,
          description: tool.description,
          riskLevel: tool.riskLevel,
          riskName: tool.riskName,
          expectedOutcome: `Execute ${tool.name} successfully and verify component stability`,
        });
      }
    }

    // Ensure verification tool is appended if not present
    if (command.target === 'freelancer_api' && !steps.some((s) => s.toolName.toLowerCase().includes('verifysync'))) {
      const verifyTool = getRegisteredTool('verifySync');
      if (verifyTool) {
        const lastStep = steps[steps.length - 1];
        steps.push({
          id: `step_${stepNum}`,
          stepNumber: stepNum++,
          toolName: verifyTool.name,
          tool: verifyTool,
          arguments: {},
          dependencies: lastStep ? [lastStep.id || `step_${lastStep.stepNumber}`] : [],
          description: verifyTool.description,
          riskLevel: verifyTool.riskLevel,
          riskName: verifyTool.riskName,
          expectedOutcome: 'Confirm scraper feed and PostgreSQL cache are fully synchronized',
        });
      }
    }

    // 5. Construct and validate strict AIPlan
    const executionStepsForSchema: ExecutionStep[] = steps.map((s, idx) => ({
      id: s.id || `step_${idx + 1}`,
      planId,
      sequence: s.stepNumber,
      toolName: s.toolName,
      validatedArguments: s.arguments,
      dependencies: s.dependencies || [],
      status: 'QUEUED',
      risk: s.tool.permission || (s.riskLevel === 0 ? 'READ_ONLY' : s.riskLevel === 1 ? 'LOW' : s.riskLevel === 2 ? 'MEDIUM' : 'HIGH'),
      approvalState: s.tool.requiresConfirmation ? 'PENDING' : 'NOT_REQUIRED',
      idempotencyKey: `${planId}_${s.toolName}_${s.stepNumber}`,
      timeout: s.tool.timeout || 15000,
      retryPolicy: {
        maxRetries: s.tool.retryPolicy?.maxRetries ?? 2,
        backoffMs: s.tool.retryPolicy?.backoffMs ?? 500,
      },
      timestamps: {
        queuedAt: new Date().toISOString(),
      },
    }));

    const maxStepRisk: ToolPermission = steps.some((s) => s.riskLevel >= 3)
      ? 'HIGH'
      : steps.some((s) => s.riskLevel === 2)
      ? 'MEDIUM'
      : steps.some((s) => s.riskLevel === 1)
      ? 'LOW'
      : 'READ_ONLY';

    const rawPlan: AIPlan = {
      id: planId,
      intentId: validatedIntent.id,
      conversationId,
      status: 'DRAFT',
      summary: `Autonomous plan for [${validatedIntent.type}]: ${validatedIntent.normalizedObjective}`,
      risk: maxStepRisk,
      requiresApproval: steps.some((s) => s.tool.requiresConfirmation || s.riskLevel >= 3),
      orderedExecutionSteps: executionStepsForSchema,
      timeout: 60000,
      rollbackConfiguration: {
        enabled: true,
        rollbackSteps: ['verifyPostgres', 'restartScraper'],
      },
      timestamps: {
        createdAt: new Date().toISOString(),
      },
    };

    const validatedPlan = AIPlanSchema.parse(rawPlan);

    auditStore.log({
      eventType: 'PLAN_CREATED',
      conversationId,
      intentId: validatedIntent.id,
      planId: validatedPlan.id,
      status: 'PENDING',
      risk: validatedPlan.risk,
      metadata: {
        stepsCount: validatedPlan.orderedExecutionSteps.length,
        requiresApproval: validatedPlan.requiresApproval,
      },
    });

    // 6. Formulate diagnostic checklist for user interface
    const checklist = [
      {
        item: 'API Credentials & OAuth Token',
        status: context.freelancer?.auth_status === 'VALID' ? ('ok' as const) : ('warning' as const),
        details: `Token status: ${context.freelancer?.auth_status || 'UNKNOWN'}`,
      },
      {
        item: 'PostgreSQL Database Connection',
        status: context.database?.connected ? ('ok' as const) : ('error' as const),
        details: `${context.database?.latency_ms ?? 15}ms roundtrip latency`,
      },
      {
        item: 'Bull/Redis Queue Concurrency',
        status: (context.queues?.failed ?? 0) === 0 ? ('ok' as const) : ('warning' as const),
        details: `${context.queues?.waiting ?? 0} waiting, ${context.queues?.failed ?? 0} failed`,
      },
      {
        item: 'Freelancer.com Scraper Feed Endpoint',
        status: issueOutput.issue === 'freelancer_api_failure' ? ('warning' as const) : ('ok' as const),
        details: issueOutput.details,
      },
    ];

    return {
      id: planId,
      intentId: validatedIntent.id,
      command,
      diagnosticChecklist: checklist,
      mlInsight: {
        issue: issueOutput.issue,
        confidence: issueOutput.confidence,
        failurePrediction: `${failureOutput.component} (prob: ${failureOutput.failure_probability})`,
        anomalyScore: anomalyOutput.anomaly_score,
        recommendedRemediation: remediationOutput.recommended_action,
      },
      steps,
      rawPlan: validatedPlan,
      rollbackConfiguration: validatedPlan.rollbackConfiguration,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Classifies user prompt into a structured AIIntent with normalized objectives
   */
  public async classifyIntent(
    userMessage: string,
    conversationId: string,
    issue?: any
  ): Promise<AIIntent> {
    const msg = userMessage.toLowerCase().trim();
    const intentId = `intent_${Date.now()}`;

    // 1. Model MLOps Retrain / Rollback intents
    if (msg.includes('retrain') || (msg.includes('model') && (msg.includes('train') || msg.includes('update')))) {
      return {
        id: intentId,
        type: 'RETRAIN_MODEL',
        target: 'predictive_ml_aiops',
        originalUserRequest: userMessage,
        normalizedObjective: 'Retrain candidate AIOps model against recent incidents and evaluate promotion gates',
        extractedEntities: { domain: 'predictive_ml_aiops' },
        confidence: 0.95,
        risk: 'MEDIUM',
        requiresApproval: false,
        conversationId,
        createdAt: new Date().toISOString(),
      };
    }

    if (msg.includes('rollback') || (msg.includes('revert') && msg.includes('model'))) {
      return {
        id: intentId,
        type: 'ROLLBACK',
        target: 'predictive_ml_aiops',
        originalUserRequest: userMessage,
        normalizedObjective: 'Roll back active AIOps model to previous stable version',
        extractedEntities: { domain: 'predictive_ml_aiops' },
        confidence: 0.94,
        risk: 'HIGH',
        requiresApproval: true,
        conversationId,
        createdAt: new Date().toISOString(),
      };
    }

    // 2. Freelancer scraper / integration repair intents
    if (msg.includes('scraper') || msg.includes('freelancer') || msg.includes('fix scraper') || msg.includes('sync job')) {
      return {
        id: intentId,
        type: 'REPAIR',
        target: 'freelancer_api',
        originalUserRequest: userMessage,
        normalizedObjective: 'Diagnose scraper, restart worker thread, and verify synchronized database ingestion',
        extractedEntities: { integration: 'freelancer.com', component: 'scraper' },
        confidence: 0.98,
        risk: 'MEDIUM',
        requiresApproval: false,
        conversationId,
        createdAt: new Date().toISOString(),
      };
    }

    // 3. Work Orders
    if (msg.includes('order') || msg.includes('overdue') || msg.includes('priority')) {
      return {
        id: intentId,
        type: 'UPDATE',
        target: 'automated_self_healing',
        originalUserRequest: userMessage,
        normalizedObjective: 'Identify overdue work orders and escalate priority',
        extractedEntities: { entity: 'work_orders' },
        confidence: 0.92,
        risk: 'MEDIUM',
        requiresApproval: false,
        conversationId,
        createdAt: new Date().toISOString(),
      };
    }

    // 4. Database Optimization
    if (msg.includes('db') || msg.includes('database') || msg.includes('postgres')) {
      return {
        id: intentId,
        type: 'VERIFY',
        target: 'postgresql_neon',
        originalUserRequest: userMessage,
        normalizedObjective: 'Verify PostgreSQL pool connectivity and latency benchmarks',
        extractedEntities: { database: 'postgresql' },
        confidence: 0.95,
        risk: 'LOW',
        requiresApproval: false,
        conversationId,
        createdAt: new Date().toISOString(),
      };
    }

    // 5. Queues & Workers
    if (msg.includes('queue') || msg.includes('retry') || msg.includes('worker')) {
      return {
        id: intentId,
        type: 'RETRY',
        target: 'bull_redis_queues',
        originalUserRequest: userMessage,
        normalizedObjective: 'Inspect queue latency and retry failed jobs',
        extractedEntities: { queue: 'bull_redis' },
        confidence: 0.93,
        risk: 'LOW',
        requiresApproval: false,
        conversationId,
        createdAt: new Date().toISOString(),
      };
    }

    // 6. Payments & PayPal
    if (msg.includes('paypal') || msg.includes('payout') || msg.includes('payment') || msg.includes('reconcile')) {
      return {
        id: intentId,
        type: 'SYNC',
        target: 'system',
        originalUserRequest: userMessage,
        normalizedObjective: 'Verify PayPal REST gateway status and reconcile pending balances',
        extractedEntities: { gateway: 'paypal' },
        confidence: 0.91,
        risk: 'HIGH',
        requiresApproval: true,
        conversationId,
        createdAt: new Date().toISOString(),
      };
    }

    // Default DIAGNOSE / MONITOR
    return {
      id: intentId,
      type: 'DIAGNOSE',
      target: 'system',
      originalUserRequest: userMessage,
      normalizedObjective: 'Perform full system health check and telemetry diagnosis',
      extractedEntities: {},
      confidence: 0.85,
      risk: 'READ_ONLY',
      requiresApproval: false,
      conversationId,
      createdAt: new Date().toISOString(),
    };
  }

  private buildCommandFromIntent(intent: AIIntent, issue: any): StructuredCommand {
    if (intent.type === 'RETRAIN_MODEL') {
      return {
        intent: 'retrain_model',
        intentType: 'RETRAIN_MODEL',
        target: 'mlops',
        objective: intent.normalizedObjective,
        requested_actions: ['evaluate_model', 'retrain_model', 'evaluate_model'],
        risk: 'medium',
        requires_confirmation: false,
        rawIntent: intent,
      };
    }

    if (intent.type === 'ROLLBACK') {
      return {
        intent: 'rollback_model',
        intentType: 'ROLLBACK',
        target: 'mlops',
        objective: intent.normalizedObjective,
        requested_actions: ['evaluate_model', 'rollback_model', 'run_health_check'],
        risk: 'high',
        requires_confirmation: true,
        rawIntent: intent,
      };
    }

    if (intent.target === 'freelancer_api') {
      return {
        intent: 'repair_integration',
        intentType: 'REPAIR',
        target: 'freelancer_api',
        objective: intent.normalizedObjective,
        requested_actions: [
          'diagnoseFreelancer',
          'verifyPostgres',
          'inspectQueue',
          'restartScraper',
          'syncFreelancerJobs',
          'verifySync',
        ],
        risk: 'medium',
        requires_confirmation: false,
        rawIntent: intent,
      };
    }

    if (intent.target === 'automated_self_healing') {
      return {
        intent: 'remediate_work_orders',
        intentType: 'UPDATE',
        target: 'automated_self_healing',
        objective: intent.normalizedObjective,
        requested_actions: [
          'findOverdueOrders',
          'updateWorkOrderPriority',
          'healWorkOrders',
          'verifyWorkOrders',
        ],
        risk: 'medium',
        requires_confirmation: false,
        rawIntent: intent,
      };
    }

    if (intent.target === 'postgresql_neon') {
      return {
        intent: 'optimize_database',
        intentType: 'VERIFY',
        target: 'postgresql_neon',
        objective: intent.normalizedObjective,
        requested_actions: ['verifyPostgres', 'reconnectDatabase', 'createDatabaseSnapshot'],
        risk: 'low',
        requires_confirmation: false,
        rawIntent: intent,
      };
    }

    if (intent.target === 'bull_redis_queues') {
      return {
        intent: 'recover_queues',
        intentType: 'RETRY',
        target: 'bull_redis_queues',
        objective: intent.normalizedObjective,
        requested_actions: ['inspectQueue', 'retryFailedJobs', 'restartWorkers'],
        risk: 'low',
        requires_confirmation: false,
        rawIntent: intent,
      };
    }

    return {
      intent: 'diagnose_system',
      intentType: 'DIAGNOSE',
      target: 'system',
      objective: intent.normalizedObjective,
      requested_actions: ['run_health_check', 'verifyPostgres', 'inspectQueue'],
      risk: 'low',
      requires_confirmation: false,
      rawIntent: intent,
    };
  }
}

export const aiPlanner = new AIPlanner();
