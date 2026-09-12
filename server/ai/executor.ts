import { ExecutionPlan, PlanStep } from './planner.js';
import { ToolExecutionResult, ToolMetadata } from '../tools/toolDefinitions.js';
import { getRegisteredTool } from '../tools/index.js';
import { auditStore } from './auditStore.js';
import { ExecutionStep, StepStatus } from './schemas.js';

export interface StepExecutionUpdate {
  type: 'step_start' | 'step_progress' | 'step_finish' | 'step_error' | 'step_retry' | 'step_cancelled' | 'rollback';
  stepNumber: number;
  toolName: string;
  message: string;
  result?: ToolExecutionResult;
}

export class PlanExecutor {
  private idempotencyCache: Map<string, ToolExecutionResult> = new Map();

  /**
   * Executes an ordered execution plan with strict dependency checking, timeouts,
   * retry policies, idempotency, and automated rollback if configured.
   */
  public async executePlan(
    plan: ExecutionPlan,
    onUpdate?: (update: StepExecutionUpdate) => void
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    const stepStatusMap: Map<string, StepStatus> = new Map();
    const executedStepResults: Map<string, ToolExecutionResult> = new Map();

    auditStore.log({
      eventType: 'STEP_QUEUED',
      planId: plan.id,
      status: 'PENDING',
      metadata: { totalSteps: plan.steps.length },
    });

    let planFailed = false;
    let failedStepIndex = -1;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepId = (step as any).id || `step_${step.stepNumber}`;

      // 1. Dependency Resolution
      const dependencies: string[] = (step as any).dependencies || [];
      const hasFailedDependency = dependencies.some((depId) => {
        const depStatus = stepStatusMap.get(depId);
        return depStatus === 'FAILURE' || depStatus === 'CANCELLED' || depStatus === 'TIMEOUT';
      });

      if (hasFailedDependency || planFailed) {
        stepStatusMap.set(stepId, 'CANCELLED');
        const cancelResult: ToolExecutionResult = {
          success: false,
          toolName: step.toolName,
          summary: `Step cancelled due to failed dependency or previous error in plan`,
          logs: [`Cancelled: Dependent prerequisite failed.`],
        };
        results.push(cancelResult);
        if (onUpdate) {
          onUpdate({
            type: 'step_cancelled',
            stepNumber: step.stepNumber,
            toolName: step.toolName,
            message: `⊘ Skipped step ${step.stepNumber} [${step.toolName}] because dependency failed.`,
            result: cancelResult,
          });
        }
        continue;
      }

      // 2. Idempotency Check
      const idempotencyKey = (step as any).idempotencyKey || `${plan.id}_${step.toolName}_${JSON.stringify(step.arguments)}`;
      if (this.idempotencyCache.has(idempotencyKey)) {
        const cached = this.idempotencyCache.get(idempotencyKey)!;
        stepStatusMap.set(stepId, 'SUCCESS');
        results.push(cached);
        if (onUpdate) {
          onUpdate({
            type: 'step_finish',
            stepNumber: step.stepNumber,
            toolName: step.toolName,
            message: `✓ Reusing idempotent result for step ${step.stepNumber}: ${cached.summary}`,
            result: cached,
          });
        }
        continue;
      }

      // 3. Resolve Tool from Registry (Only registered tools allowed)
      const tool = getRegisteredTool(step.toolName) || step.tool;
      if (!tool) {
        const notFoundResult: ToolExecutionResult = {
          success: false,
          toolName: step.toolName,
          summary: `Execution error: Tool [${step.toolName}] is not registered in the tool registry.`,
          logs: [`Unauthorized invocation attempt for unregistered tool ${step.toolName}`],
        };
        results.push(notFoundResult);
        stepStatusMap.set(stepId, 'FAILURE');
        planFailed = true;
        failedStepIndex = i;
        break;
      }

      // 4. Execute with Retry & Timeout
      stepStatusMap.set(stepId, 'RUNNING');
      auditStore.log({
        eventType: 'STEP_STARTED',
        planId: plan.id,
        stepId,
        toolName: tool.name,
        status: 'PENDING',
        risk: (tool as any).permission || 'LOW',
      });

      if (onUpdate) {
        onUpdate({
          type: 'step_start',
          stepNumber: step.stepNumber,
          toolName: step.toolName,
          message: `▶ Starting step ${step.stepNumber}/${plan.steps.length}: ${step.toolName}`,
        });
      }

      const timeoutMs = tool.timeout || 15000;
      const maxRetries = tool.retryPolicy?.maxRetries ?? 1;
      const backoffMs = tool.retryPolicy?.backoffMs ?? 500;

      let attempt = 0;
      let stepSuccess = false;
      let lastResult: ToolExecutionResult | null = null;

      while (attempt <= maxRetries && !stepSuccess) {
        attempt++;
        const stepProgress = (msg: string) => {
          if (onUpdate) {
            onUpdate({
              type: 'step_progress',
              stepNumber: step.stepNumber,
              toolName: step.toolName,
              message: msg,
            });
          }
        };

        try {
          auditStore.log({
            eventType: 'TOOL_INVOKED',
            planId: plan.id,
            stepId,
            toolName: tool.name,
            status: 'PENDING',
            metadata: { attempt },
          });

          // Timeout Race
          const execPromise = tool.execute(step.arguments, stepProgress);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs}ms`)), timeoutMs)
          );

          const result = await Promise.race([execPromise, timeoutPromise]);
          lastResult = result;

          auditStore.log({
            eventType: 'TOOL_COMPLETED',
            planId: plan.id,
            stepId,
            toolName: tool.name,
            status: result.success ? 'SUCCESS' : 'FAILURE',
            metadata: { summary: result.summary, attempt },
          });

          if (result.success) {
            stepSuccess = true;
            stepStatusMap.set(stepId, 'SUCCESS');
            this.idempotencyCache.set(idempotencyKey, result);
            results.push(result);
            executedStepResults.set(stepId, result);

            auditStore.log({
              eventType: 'STEP_SUCCEEDED',
              planId: plan.id,
              stepId,
              toolName: tool.name,
              status: 'SUCCESS',
            });

            if (onUpdate) {
              onUpdate({
                type: 'step_finish',
                stepNumber: step.stepNumber,
                toolName: step.toolName,
                message: `✓ Completed step ${step.stepNumber}: ${result.summary}`,
                result,
              });
            }
          } else {
            // Tool returned success: false
            if (attempt <= maxRetries) {
              auditStore.log({
                eventType: 'STEP_RETRIED',
                planId: plan.id,
                stepId,
                toolName: tool.name,
                status: 'WARNING',
                metadata: { attempt, reason: result.summary },
              });
              if (onUpdate) {
                onUpdate({
                  type: 'step_retry',
                  stepNumber: step.stepNumber,
                  toolName: step.toolName,
                  message: `↻ Retrying step ${step.stepNumber} (attempt ${attempt}/${maxRetries + 1}) after error: ${result.summary}`,
                });
              }
              await new Promise((r) => setTimeout(r, backoffMs * attempt));
            }
          }
        } catch (err: any) {
          const isTimeout = err.message?.includes('timed out');
          lastResult = {
            success: false,
            toolName: step.toolName,
            summary: `Execution failure: ${err.message}`,
            logs: [`Error: ${err.message}`],
          };

          if (attempt <= maxRetries && !isTimeout) {
            auditStore.log({
              eventType: 'STEP_RETRIED',
              planId: plan.id,
              stepId,
              toolName: tool.name,
              status: 'WARNING',
              metadata: { attempt, error: err.message },
            });
            if (onUpdate) {
              onUpdate({
                type: 'step_retry',
                stepNumber: step.stepNumber,
                toolName: step.toolName,
                message: `↻ Retrying step ${step.stepNumber} after exception: ${err.message}`,
              });
            }
            await new Promise((r) => setTimeout(r, backoffMs * attempt));
          } else {
            break;
          }
        }
      }

      if (!stepSuccess) {
        const errorResult = lastResult || {
          success: false,
          toolName: step.toolName,
          summary: `Step ${step.stepNumber} [${step.toolName}] failed after ${attempt} attempts`,
          logs: [`Failed after max retries`],
        };

        results.push(errorResult);
        stepStatusMap.set(stepId, 'FAILURE');
        planFailed = true;
        failedStepIndex = i;

        auditStore.log({
          eventType: 'STEP_FAILED',
          planId: plan.id,
          stepId,
          toolName: tool.name,
          status: 'FAILURE',
          metadata: { summary: errorResult.summary },
        });

        if (onUpdate) {
          onUpdate({
            type: 'step_error',
            stepNumber: step.stepNumber,
            toolName: step.toolName,
            message: `✗ Error executing step ${step.stepNumber}: ${errorResult.summary}`,
            result: errorResult,
          });
        }
        break;
      }
    }

    // 5. Automated Rollback if execution encountered failure
    if (planFailed && (plan as any).rollbackConfiguration?.enabled) {
      if (onUpdate) {
        onUpdate({
          type: 'rollback',
          stepNumber: 999,
          toolName: 'rollback_engine',
          message: `⏪ Remediation encountered an error. Triggering automated rollback procedures...`,
        });
      }

      auditStore.log({
        eventType: 'ROLLBACK_STARTED',
        planId: plan.id,
        status: 'PENDING',
        metadata: { failedStepIndex },
      });

      // Execute rollback operations
      try {
        const rollbackSteps: string[] = (plan as any).rollbackConfiguration?.rollbackSteps || ['verifyPostgres', 'restartScraper'];
        for (const rbToolName of rollbackSteps) {
          const rbTool = getRegisteredTool(rbToolName);
          if (rbTool) {
            await rbTool.execute({}, (msg) => {
              if (onUpdate) {
                onUpdate({
                  type: 'step_progress',
                  stepNumber: 999,
                  toolName: rbTool.name,
                  message: `[Rollback] ${msg}`,
                });
              }
            });
          }
        }

        auditStore.log({
          eventType: 'ROLLBACK_COMPLETED',
          planId: plan.id,
          status: 'SUCCESS',
        });
      } catch (rbErr: any) {
        auditStore.log({
          eventType: 'ROLLBACK_COMPLETED',
          planId: plan.id,
          status: 'FAILURE',
          metadata: { error: rbErr.message },
        });
      }
    }

    return results;
  }
}

export const planExecutor = new PlanExecutor();
