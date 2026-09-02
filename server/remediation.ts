import { checkAndAutoApproveOverdueWorkOrders } from './completionWorker.js';
import { processRetryQueue, runSelfHealingDiagnostics } from './retryWorker.js';
import { scanAndRetryMissingExternalJobs } from './freelancerRetryQueue.js';
import { runFullHealthCheck, recordCronHeartbeat, HealthStatus, FullHealthCheckResult } from './healthCheck.js';
import { logActivityEvent } from './activityLogger.js';

export interface RemediationResult {
  success: boolean;
  timestamp: string;
  autoApprovedOrders: number;
  processedPayoutRetries: number;
  succeededPayoutRetries: number;
  freelancerRetriedCount: number;
  diagnostics: any;
  initialStatus: HealthStatus;
  finalStatus: HealthStatus;
  resolved: boolean;
  actionsTaken: string[];
  health: FullHealthCheckResult;
  error?: string;
}

/**
 * Execute a comprehensive, idempotent self-healing remediation cycle
 */
export async function autoRemediate(triggerSource: string = 'autonomous_healer'): Promise<RemediationResult> {
  const startTime = Date.now();
  const actionsTaken: string[] = [];
  recordCronHeartbeat(`remediation_${triggerSource}`);

  console.log(`🛠️ [AutoRemediate] Starting remediation cycle triggered by [${triggerSource}]...`);

  // 1. Snapshot initial health check
  const initialHealth = await runFullHealthCheck().catch(() => null);
  const initialStatus: HealthStatus = initialHealth?.status || 'degraded';

  try {
    // 2. Auto-approve overdue work orders that have passed their deadline
    const autoApproveRes = await checkAndAutoApproveOverdueWorkOrders();
    if (autoApproveRes.autoApprovedCount > 0) {
      actionsTaken.push(`Auto-approved ${autoApproveRes.autoApprovedCount} overdue work order(s)`);
    }

    // 3. Process exponential backoff payout retries for failed work orders
    const retryRes = await processRetryQueue();
    if (retryRes.processed > 0) {
      actionsTaken.push(`Processed ${retryRes.processed} payout retries (${retryRes.succeeded} succeeded, ${retryRes.failed} pending/failed)`);
    }

    // 4. Scan and sync missing Freelancer.com external project records
    const flSyncRes = await scanAndRetryMissingExternalJobs();
    if (flSyncRes.fixedCount > 0) {
      actionsTaken.push(`Resynchronized ${flSyncRes.fixedCount} missing external freelance project(s)`);
    }

    // 5. Run general self-healing diagnostics across database & in-memory stores
    const selfHealingRes = await runSelfHealingDiagnostics();
    if (selfHealingRes.failedTransactionsCount > 0) {
      actionsTaken.push(`Enqueued ${selfHealingRes.failedTransactionsCount} unrecovered failed transaction(s) for retry`);
    }

    if (actionsTaken.length === 0) {
      actionsTaken.push('Ran diagnostic reconciliation; all work orders and queues are in sync');
    }

    // 6. Re-run full health check to verify if the issues were resolved
    const finalHealth = await runFullHealthCheck();
    const finalStatus: HealthStatus = finalHealth.status;
    const resolved = finalStatus === 'healthy' || (initialStatus === 'critical' && finalStatus === 'degraded');

    const latencyMs = Date.now() - startTime;

    logActivityEvent({
      source: 'AutoHealer',
      type: 'HEALTH_REMEDIATION',
      status: resolved ? 'success' : 'warning',
      summary: `Auto-remediation [${triggerSource}] completed in ${latencyMs}ms: ${actionsTaken.join('; ')}`,
      tags: ['auto_healing', triggerSource, `status_${finalStatus}`]
    });

    console.log(`✅ [AutoRemediate] Completed in ${latencyMs}ms. Status transition: ${initialStatus} -> ${finalStatus}`);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      autoApprovedOrders: autoApproveRes.autoApprovedCount,
      processedPayoutRetries: retryRes.processed,
      succeededPayoutRetries: retryRes.succeeded,
      freelancerRetriedCount: flSyncRes.fixedCount,
      diagnostics: selfHealingRes,
      initialStatus,
      finalStatus,
      resolved,
      actionsTaken,
      health: finalHealth,
    };
  } catch (err: any) {
    const errorMsg = err.message || 'Unknown remediation error';
    console.error(`❌ [AutoRemediate] Remediation execution failed:`, errorMsg);

    const fallbackHealth = await runFullHealthCheck().catch(() => ({
      status: 'critical' as HealthStatus,
      timestamp: new Date().toISOString(),
      checks: {} as any,
      remediation: 'Restart backend server'
    }));

    return {
      success: false,
      timestamp: new Date().toISOString(),
      autoApprovedOrders: 0,
      processedPayoutRetries: 0,
      succeededPayoutRetries: 0,
      freelancerRetriedCount: 0,
      diagnostics: {},
      initialStatus,
      finalStatus: fallbackHealth.status,
      resolved: false,
      actionsTaken,
      health: fallbackHealth,
      error: errorMsg,
    };
  }
}
