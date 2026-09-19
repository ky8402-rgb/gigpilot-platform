import { memoryStore, safeExecutePgQuery, Transaction, WorkOrder } from './pgDatabase.js';
import { completeWorkOrderAndPayout, checkAndAutoApproveOverdueWorkOrders } from './completionWorker.js';
import { triggerAISupportIncident, activeSupportTickets } from './supportChat.js';
import { logActivityEvent } from './activityLogger.js';

interface RetryItem {
  workOrderId: string;
  attempt: number;
  maxAttempts: number;
  nextRetryTime: number;
  lastError: string;
}

const retryQueue: Map<string, RetryItem> = new Map();
const MAX_RETRY_ATTEMPTS = 3;
const STALLED_CONTRACT_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const stalledRemediationQueue = new Map<string, { workOrderId: string; attempts: number; nextAttemptAt: number; reason: string }>();

export function getPayoutRetryQueueStats(): {
  waiting: number;
  items: RetryItem[];
} {
  return {
    waiting: retryQueue.size,
    items: Array.from(retryQueue.values()),
  };
}

/**
 * Enqueue a failed work order payout for self-healing retry with exponential backoff
 */
export function enqueuePayoutRetry(workOrderId: string, errorMsg: string) {
  const existing = retryQueue.get(workOrderId);
  const attempt = existing ? existing.attempt + 1 : 1;

  if (attempt > MAX_RETRY_ATTEMPTS) {
    console.warn(`🚨 [RetryWorker] Max retry attempts (${MAX_RETRY_ATTEMPTS}) reached for WorkOrder ${workOrderId}. Escalating to AI Support.`);
    retryQueue.delete(workOrderId);

    triggerAISupportIncident({
      category: 'PAYPAL_PAYOUT_ERROR',
      severity: 'high',
      title: `PayPal Payout Exceeded ${MAX_RETRY_ATTEMPTS} Retries for Work Order ${workOrderId}`,
      errorMessage: errorMsg,
      context: { workOrderId, attempts: attempt, finalError: errorMsg },
    }).catch(() => {});
    return;
  }

  // Exponential backoff: 2^attempt * 2000ms (e.g., attempt 1 = 4s, attempt 2 = 8s, attempt 3 = 16s)
  const delayMs = Math.pow(2, attempt) * 2000;
  const nextRetryTime = Date.now() + delayMs;

  retryQueue.set(workOrderId, {
    workOrderId,
    attempt,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    nextRetryTime,
    lastError: errorMsg,
  });

  logActivityEvent({
    source: 'PayPal',
    type: 'PAYOUT_RETRY_SCHEDULED',
    status: 'warning',
    summary: `Scheduled self-healing retry ${attempt}/${MAX_RETRY_ATTEMPTS} for WorkOrder ${workOrderId} in ${delayMs / 1000}s`,
    tags: ['retry_engine', 'exponential_backoff', `attempt_${attempt}`],
  });
}



/**
 * Create a bounded self-healing remediation task for a genuinely stalled contract.
 * This never changes contract/payment state by itself; it only schedules diagnostics.
 */
export function enqueueStalledContractRemediation(workOrderId: string, reason: string) {
  const existing = stalledRemediationQueue.get(workOrderId);
  const attempts = existing ? existing.attempts + 1 : 1;
  if (attempts > MAX_RETRY_ATTEMPTS) {
    stalledRemediationQueue.delete(workOrderId);
    triggerAISupportIncident({
      category: 'CONTRACT_STALLED',
      severity: 'high',
      title: `Contract ${workOrderId} remains stalled after remediation retries`,
      errorMessage: reason,
      context: { workOrderId, attempts, reason },
    }).catch(() => {});
    return;
  }
  const delayMs = Math.pow(2, attempts) * 30_000;
  stalledRemediationQueue.set(workOrderId, {
    workOrderId,
    attempts,
    nextAttemptAt: Date.now() + delayMs,
    reason,
  });
  logActivityEvent({
    source: 'SelfHealing',
    type: 'CONTRACT_REMEDIATION_SCHEDULED',
    status: 'warning',
    summary: `Scheduled stalled-contract diagnostic ${attempts}/${MAX_RETRY_ATTEMPTS} for ${workOrderId}`,
    tags: ['self_healing', 'contract_stalled', `attempt_${attempts}`],
  });
}

async function scanStalledContracts() {
  const res = await safeExecutePgQuery(
    `SELECT id, status, updated_at, escrow_status, delivery_status, external_acceptance_verified
     FROM work_orders
     WHERE status NOT IN ('COMPLETED', 'CANCELLED')
       AND updated_at < NOW() - INTERVAL '6 hours'`
  );
  if (!res?.rows?.length) return 0;
  let discovered = 0;
  for (const row of res.rows) {
    const reasons: string[] = [];
    if (row.escrow_status === 'RELEASE_PENDING') reasons.push('provider settlement pending');
    if (row.delivery_status === 'READY_FOR_PROVIDER_DELIVERY') reasons.push('provider delivery confirmation pending');
    if (row.external_acceptance_verified === false) reasons.push('provider acceptance pending');
    if (!reasons.length) reasons.push('no lifecycle progress recorded for more than 6 hours');
    if (!stalledRemediationQueue.has(row.id)) {
      enqueueStalledContractRemediation(row.id, reasons.join('; '));
      discovered++;
    }
  }
  return discovered;
}

async function processStalledRemediationQueue() {
  let processed = 0;
  for (const [workOrderId, item] of stalledRemediationQueue.entries()) {
    if (Date.now() < item.nextAttemptAt) continue;
    processed++;
    const check = await safeExecutePgQuery(
      `SELECT id, status, updated_at FROM work_orders WHERE id = $1 LIMIT 1`,
      [workOrderId]
    );
    const row = check?.rows?.[0];
    if (!row || ['COMPLETED', 'CANCELLED'].includes(row.status) || Date.now() - new Date(row.updated_at).getTime() < STALLED_CONTRACT_THRESHOLD_MS) {
      stalledRemediationQueue.delete(workOrderId);
      continue;
    }
    logActivityEvent({
      source: 'SelfHealing',
      type: 'CONTRACT_REMEDIATION_DIAGNOSTIC',
      status: 'warning',
      summary: `Diagnostic pass requested for stalled WorkOrder ${workOrderId}: ${item.reason}`,
      tags: ['self_healing', 'diagnostic', 'contract_stalled'],
    });
    stalledRemediationQueue.delete(workOrderId);
    enqueueStalledContractRemediation(workOrderId, item.reason);
  }
  return processed;
}

/**
 * Process all items in retry queue ready for execution
 */
export async function processRetryQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const now = Date.now();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const [workOrderId, item] of retryQueue.entries()) {
    if (now >= item.nextRetryTime) {
      processed++;
      console.log(`🔄 [RetryWorker] Executing self-healing payout retry attempt ${item.attempt}/${item.maxAttempts} for WorkOrder ${workOrderId}...`);

      const res = await completeWorkOrderAndPayout(workOrderId, 'retry_engine');
      if (res.success) {
        succeeded++;
        retryQueue.delete(workOrderId);
        console.log(`✅ [RetryWorker] Self-healing succeeded for WorkOrder ${workOrderId}!`);
      } else {
        failed++;
        enqueuePayoutRetry(workOrderId, res.message || res.error || 'Retry attempt failed');
      }
    }
  }

  return { processed, succeeded, failed };
}

/**
 * Scan database and memory store for failed transactions or stuck work orders
 */
export async function runSelfHealingDiagnostics(): Promise<{
  overdueAutoApproved: number;
  retriesProcessed: number;
  failedTransactionsCount: number;
  stuckWorkOrdersCount: number;
  stalledContractsDetected: number;
  stalledRemediationsProcessed: number;
  activeTicketsCount: number;
}> {
  // 0. Detect stalled contracts and schedule bounded diagnostics
  const stalledDetected = await scanStalledContracts();
  const stalledProcessed = await processStalledRemediationQueue();

  // 1. Auto-approve work orders past deadline
  const autoApproveRes = await checkAndAutoApproveOverdueWorkOrders();

  // 2. Process retry queue
  const retryRes = await processRetryQueue();

  // 3. Scan for any un-enqueued failed work orders in DB or memory
  let failedOrders: WorkOrder[] = [];
  const res = await safeExecutePgQuery(`SELECT * FROM work_orders WHERE payment_status = 'failed'`);
  if (res && res.rows.length > 0) {
    failedOrders = res.rows;
  } else {
    failedOrders = Array.from(memoryStore.workOrders.values()).filter((w) => w.payment_status === 'failed');
  }

  for (const fo of failedOrders) {
    if (!retryQueue.has(fo.id)) {
      enqueuePayoutRetry(fo.id, 'Detected unrecovered failed payment status in work_orders table');
    }
  }

  return {
    overdueAutoApproved: autoApproveRes.autoApprovedCount,
    retriesProcessed: retryRes.processed,
    failedTransactionsCount: failedOrders.length,
    stuckWorkOrdersCount: autoApproveRes.scannedCount,
    stalledContractsDetected: stalledDetected,
    stalledRemediationsProcessed: stalledProcessed,
    activeTicketsCount: activeSupportTickets.length,
  };
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startSelfHealingWorker(intervalMs: number = 15000) {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(async () => {
    try {
      await runSelfHealingDiagnostics();
    } catch (err: any) {
      console.error('❌ [RetryWorker] Cycle error:', err.message);
    }
  }, intervalMs);

  console.log(`🚀 [SelfHealingWorker] Started autonomous retry & stuck work order monitor (${intervalMs / 1000}s interval).`);
}

export function stopSelfHealingWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

// Auto-start worker on module load
startSelfHealingWorker();
