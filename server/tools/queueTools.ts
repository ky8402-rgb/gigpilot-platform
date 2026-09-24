import { ToolMetadata, ToolExecutionResult } from './toolDefinitions.js';
import { eventBus } from '../events/eventBus.js';

let mockWaitingJobs = 0;
let mockFailedJobs = 0;
let workerConcurrency = 4;
let workersActive = true;

export const inspectQueueTool: ToolMetadata = {
  name: 'inspectQueue',
  description: 'Inspect Bull/Redis asynchronous job queues, waiting depth, and failed items',
  category: 'queues',
  riskLevel: 0,
  riskName: 'Read',
  requiresConfirmation: false,
  parameters: {},
  execute: async (_args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    log('📊 Inspecting background queue depths...');
    log(`✓ Active Workers: ${workersActive ? 'ACTIVE' : 'IDLE'} (concurrency: ${workerConcurrency})`);
    log(`✓ Waiting Jobs: ${mockWaitingJobs}`);
    log(`✓ Failed Jobs: ${mockFailedJobs}`);

    return {
      success: true,
      toolName: 'inspectQueue',
      summary: `Queue status: ${mockWaitingJobs} waiting, ${mockFailedJobs} failed, workers ${workersActive ? 'online' : 'offline'}`,
      logs,
      data: {
        waitingJobs: mockWaitingJobs,
        failedJobs: mockFailedJobs,
        concurrency: workerConcurrency,
        workersActive,
      },
      affectedComponent: 'bull_redis_queues',
      refreshTargets: ['health_status', 'queues'],
    };
  },
};

export const retryFailedJobsTool: ToolMetadata = {
  name: 'retryFailedJobs',
  description: 'Requeue failed background jobs with fresh exponential backoff tokens',
  category: 'queues',
  riskLevel: 1,
  riskName: 'Safe remediation',
  requiresConfirmation: false,
  parameters: {},
  execute: async (_args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    const countToRetry = Math.max(1, mockFailedJobs || 2);
    log(`🔄 Re-enqueueing ${countToRetry} failed job tasks into active processing pipeline...`);
    await new Promise((r) => setTimeout(r, 200));

    mockFailedJobs = 0;
    mockWaitingJobs = 0;
    log(`✓ ${countToRetry} jobs requeued and dispatched to worker pool.`);

    eventBus.emitEvent({
      type: 'JOBS_REQUEUED',
      component: 'bull_redis_queues',
      status: 'HEALTHY',
      action_applied: 'retry_failed_jobs',
      details: { requeuedCount: countToRetry },
      refresh_target: ['health_status', 'queues'],
    });

    return {
      success: true,
      toolName: 'retryFailedJobs',
      summary: `Requeued ${countToRetry} failed jobs back to worker queue`,
      logs,
      data: { requeued: countToRetry },
      stateMutated: true,
      affectedComponent: 'bull_redis_queues',
      refreshTargets: ['health_status', 'queues'],
    };
  },
};

export const restartWorkersTool: ToolMetadata = {
  name: 'restartWorkers',
  description: 'Restart asynchronous queue background workers and unblock throttled workers',
  category: 'queues',
  riskLevel: 1,
  riskName: 'Safe remediation',
  requiresConfirmation: false,
  parameters: {},
  execute: async (_args, onProgress): Promise<ToolExecutionResult> => {
    const logs: string[] = [];
    const log = (msg: string) => {
      logs.push(msg);
      if (onProgress) onProgress(msg);
    };

    log('⚙ Cycling asynchronous worker child threads...');
    workersActive = false;
    await new Promise((r) => setTimeout(r, 150));
    workersActive = true;
    log('✓ Worker threads restarted and listening to queue topics.');

    eventBus.emitEvent({
      type: 'WORKERS_RESTARTED',
      component: 'bull_redis_queues',
      status: 'HEALTHY',
      action_applied: 'restart_workers',
      refresh_target: ['health_status'],
    });

    return {
      success: true,
      toolName: 'restartWorkers',
      summary: 'Background queue workers restarted and operational',
      logs,
      stateMutated: true,
      affectedComponent: 'bull_redis_queues',
      refreshTargets: ['health_status'],
    };
  },
};
