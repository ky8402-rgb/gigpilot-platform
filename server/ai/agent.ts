import { getApplicationContext, getSystemState, ApplicationContext } from './context.js';
import { aiPlanner, ExecutionPlan } from './planner.js';
import { policyEngine, PolicyCheckResult } from './policy.js';
import { planExecutor, StepExecutionUpdate } from './executor.js';
import { verifier } from './verifier.js';
import { learningPipeline } from '../aiops/training.js';
import { eventBus } from '../events/eventBus.js';
import { ToolExecutionResult } from '../tools/toolDefinitions.js';
import { auditStore } from './auditStore.js';
import { MLFeedback, MLFeedbackSchema, VerificationResult } from './schemas.js';

export type AgentState =
  | 'RECEIVED'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'AUTHORIZATION'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED';

export interface AgentProgressEvent {
  state: AgentState;
  message: string;
  plan?: ExecutionPlan;
  policyCheck?: PolicyCheckResult;
  currentStep?: StepExecutionUpdate;
  verification?: VerificationResult | any;
  summary?: string;
  progressPct: number;
}

export class AIAgent {
  /**
   * Run the full autonomous AIOps control loop with streaming progress events
   */
  public async handleCommand(
    message: string,
    userConfirmed = false,
    onProgress?: (event: AgentProgressEvent) => void,
    conversationId = 'default-session',
    actor = 'user'
  ): Promise<{
    success: boolean;
    state: AgentState;
    plan: ExecutionPlan;
    policyCheck: PolicyCheckResult;
    results: ToolExecutionResult[];
    verification?: VerificationResult;
    summary: string;
  }> {
    const startTime = Date.now();
    const requestId = `req_${startTime}`;
    const emit = (event: AgentProgressEvent) => {
      if (onProgress) onProgress(event);
    };

    // 0. Safety & Adversarial Attack Check
    const safetyCheck = policyEngine.checkRawCommandSafety(message, actor);
    if (!safetyCheck.safe) {
      auditStore.log({
        eventType: 'SECURITY_VIOLATION_BLOCKED',
        actor,
        conversationId,
        status: 'BLOCKED',
        risk: 'CRITICAL',
        resource: 'system',
        metadata: {
          rawMessage: message,
          reason: safetyCheck.reason,
        },
      });

      const blockedPlan: ExecutionPlan = {
        id: `plan_blocked_${Date.now()}`,
        command: {
          intent: 'blocked_adversarial_request',
          target: 'system',
          objective: 'security_violation_blocked',
          requested_actions: [],
          risk: 'critical',
          requires_confirmation: true,
        },
        diagnosticChecklist: [],
        mlInsight: { issue: 'security_violation', confidence: 1.0 },
        steps: [],
        created_at: new Date().toISOString(),
      };

      const blockedPolicy: PolicyCheckResult = {
        allowed: false,
        maxRiskLevel: 4,
        maxRiskPermission: 'CRITICAL',
        requiresConfirmation: true,
        blockedReason: safetyCheck.reason,
        evaluatedTools: [],
      };

      emit({
        state: 'FAILED',
        message: `Security Policy Violation: ${safetyCheck.reason}`,
        plan: blockedPlan,
        policyCheck: blockedPolicy,
        summary: `Command rejected by Policy Engine: ${safetyCheck.reason}`,
        progressPct: 100,
      });

      return {
        success: false,
        state: 'FAILED',
        plan: blockedPlan,
        policyCheck: blockedPolicy,
        results: [],
        summary: `Command rejected by Policy Engine: ${safetyCheck.reason}`,
      };
    }

    // 1. State: RECEIVED
    emit({
      state: 'RECEIVED',
      message: `Command received: "${message}"`,
      progressPct: 5,
    });

    // 2. State: UNDERSTANDING (Loads verified real application state)
    emit({
      state: 'UNDERSTANDING',
      message: 'Inspecting live telemetry, PostgreSQL connection, Bull/Redis queues, and Freelancer session...',
      progressPct: 15,
    });

    const systemState = await getSystemState();
    const context = await getApplicationContext();

    // 3. State: PLANNING (Zod intent & plan validation)
    emit({
      state: 'PLANNING',
      message: 'Formulating structured execution plan and ordering tool dependency chain...',
      progressPct: 30,
    });

    const plan = await aiPlanner.createPlan(message, context, conversationId);

    // 4. Policy Check & Authorization State
    const policyCheck = policyEngine.evaluatePlan(
      plan.steps.map((s) => ({
        name: s.toolName,
        riskLevel: s.riskLevel,
        requiresConfirmation: s.tool.requiresConfirmation,
        permission: s.tool.permission,
      })),
      userConfirmed,
      actor
    );

    if (!policyCheck.allowed) {
      auditStore.log({
        eventType: 'PLAN_REJECTED',
        conversationId,
        planId: plan.id,
        status: 'BLOCKED',
        risk: policyCheck.maxRiskPermission,
        resource: plan.command.target,
        metadata: { reason: policyCheck.blockedReason },
      });

      emit({
        state: 'AUTHORIZATION',
        message: `Plan requires explicit authorization (${policyCheck.maxRiskPermission} Risk Level ${policyCheck.maxRiskLevel})`,
        plan,
        policyCheck,
        progressPct: 50,
      });

      return {
        success: false,
        state: 'AUTHORIZATION',
        plan,
        policyCheck,
        results: [],
        summary: `Action paused. User authorization required before executing: ${policyCheck.blockedReason || 'Elevated risk detected.'}`,
      };
    }

    auditStore.log({
      eventType: 'PLAN_APPROVED',
      conversationId,
      planId: plan.id,
      status: 'SUCCESS',
      risk: policyCheck.maxRiskPermission,
      resource: plan.command.target,
      metadata: { stepsCount: plan.steps.length, userConfirmed },
    });

    eventBus.emitEvent({
      type: 'AIOPS_PLAN_CREATED',
      component: plan.command.target,
      status: 'INFO',
      action_applied: 'plan_creation',
      details: {
        planId: plan.id,
        objective: plan.command.objective,
        stepsCount: plan.steps.length,
      },
      refresh_target: ['health_status', 'leads'],
    });

    // 5. State: EXECUTING
    emit({
      state: 'EXECUTING',
      message: `Executing ${plan.steps.length} remediation actions with dependency verification...`,
      plan,
      policyCheck,
      progressPct: 60,
    });

    const executionResults = await planExecutor.executePlan(plan, (stepUpdate) => {
      emit({
        state: 'EXECUTING',
        message: stepUpdate.message,
        plan,
        policyCheck,
        currentStep: stepUpdate,
        progressPct: 60 + Math.round((stepUpdate.stepNumber / plan.steps.length) * 20),
      });

      if (stepUpdate.type === 'step_start') {
        eventBus.emitEvent({
          type: 'AIOPS_STEP_STARTED',
          component: plan.command.target,
          status: 'INFO',
          action_applied: stepUpdate.toolName,
          details: { stepNumber: stepUpdate.stepNumber, toolName: stepUpdate.toolName },
        });
      } else if (stepUpdate.type === 'step_finish') {
        eventBus.emitEvent({
          type: 'AIOPS_STEP_COMPLETED',
          component: plan.command.target,
          status: 'HEALTHY',
          action_applied: stepUpdate.toolName,
          details: { stepNumber: stepUpdate.stepNumber, toolName: stepUpdate.toolName, summary: stepUpdate.message },
          refresh_target: ['health_status', 'leads', 'work_orders'],
        });
      }
    });

    const allSuccessful = executionResults.length > 0 && executionResults.every((r) => r.success);

    // 6. State: VERIFYING (Empirical evidence verification)
    emit({
      state: 'VERIFYING',
      message: 'Verifying system telemetry, database health, and queue latency...',
      plan,
      policyCheck,
      progressPct: 85,
    });

    const telemetryBefore = {
      error_rate: context.telemetry.error_rate,
      latency_ms: context.telemetry.api_latency_ms,
    };

    const verification = await verifier.verifyExecution(
      plan.steps,
      executionResults,
      telemetryBefore,
      plan.command.target,
      plan.id
    );

    eventBus.emitEvent({
      type: 'AIOPS_VERIFICATION_COMPLETED',
      component: plan.command.target,
      status: verification.overallHealthy ? 'HEALTHY' : 'DEGRADED',
      action_applied: 'verification_engine',
      details: {
        healthy: verification.overallHealthy,
        summary: verification.summary,
        checks: verification.checks?.length || 0,
      },
      refresh_target: ['health_status', 'leads'],
    });

    // 7. Closed Learning Loop & MLFeedback
    const durationMs = Date.now() - startTime;
    const isOverallSuccess = allSuccessful && verification.overallHealthy;

    const rawFeedback: MLFeedback = {
      id: `feedback_${Date.now()}`,
      timestamp: new Date().toISOString(),
      modelName: context.activeModel.version ? 'predictive_aiops' : 'default_aiops',
      modelVersion: context.activeModel.version,
      inferenceId: plan.id,
      planId: plan.id,
      actionTaken: plan.steps.map((s) => s.toolName).join(' -> '),
      outcome: isOverallSuccess ? 'SUCCESS' : executionResults.some((r) => r.success) ? 'PARTIAL' : 'FAILURE',
      metricsBefore: {
        errorRate: telemetryBefore.error_rate,
        latencyMs: telemetryBefore.latency_ms,
      },
      metricsAfter: {
        errorRate: verification.telemetryAfter.error_rate,
        latencyMs: verification.telemetryAfter.latency_ms,
      },
      improvement: Number((telemetryBefore.error_rate - verification.telemetryAfter.error_rate).toFixed(3)),
      eligibleForTraining: isOverallSuccess,
    };

    const mlFeedback = MLFeedbackSchema.parse(rawFeedback);

    auditStore.log({
      eventType: 'MODEL_FEEDBACK',
      conversationId,
      planId: plan.id,
      status: isOverallSuccess ? 'SUCCESS' : 'FAILURE',
      modelVersion: mlFeedback.modelVersion,
      confidence: plan.mlInsight.confidence,
      metadata: {
        improvement: mlFeedback.improvement,
        outcome: mlFeedback.outcome,
      },
    });

    learningPipeline.recordIncident({
      incident_id: `inc_${Date.now()}`,
      model_version: context.activeModel.version,
      problem: plan.command.objective,
      action: plan.steps.map((s) => s.toolName).join(' -> '),
      confidence: plan.mlInsight.confidence,
      before: telemetryBefore,
      after: verification.telemetryAfter,
      success: isOverallSuccess,
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
      notes: verification.summary,
    });

    // 8. State: COMPLETED or FAILED
    const finalState: AgentState = isOverallSuccess ? 'COMPLETED' : 'FAILED';
    const summary = isOverallSuccess
      ? `Successfully executed and verified remediation plan for [${plan.command.target}]. Empirical verification confirms nominal status.`
      : `Remediation execution completed with issues: ${verification.summary}`;

    emit({
      state: finalState,
      message: summary,
      plan,
      policyCheck,
      verification,
      summary,
      progressPct: 100,
    });

    eventBus.emitEvent({
      type: isOverallSuccess ? 'AIOPS_REMEDIATION_COMPLETED' : 'AIOPS_REMEDIATION_FAILED',
      component: plan.command.target,
      status: isOverallSuccess ? 'HEALTHY' : 'DEGRADED',
      action_applied: plan.steps.map((s) => s.toolName).join(', '),
      details: {
        stepsCount: plan.steps.length,
        durationMs,
        verification: verification.summary,
      },
      refresh_target: ['health_status', 'leads', 'work_orders', 'queues'],
    });

    return {
      success: isOverallSuccess,
      state: finalState,
      plan,
      policyCheck,
      results: executionResults,
      verification,
      summary,
    };
  }

  /**
   * Orchestrator alias method handleUserMessage
   */
  public async handleUserMessage(
    message: string,
    options?: { userConfirmed?: boolean; conversationId?: string; actor?: string }
  ) {
    return this.handleCommand(
      message,
      options?.userConfirmed ?? false,
      undefined,
      options?.conversationId ?? 'default-session',
      options?.actor ?? 'user'
    );
  }
}

export const aiAgent = new AIAgent();
export const aiOrchestrator = aiAgent;
export type AIOrchestrator = AIAgent;
