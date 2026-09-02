import { getPgPool, memoryStore, Transaction, WorkOrder } from './pgDatabase.js';
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
  activeTicketsCount: number;
}> {
  // 1. Auto-approve work orders past deadline
  const autoApproveRes = await checkAndAutoApproveOverdueWorkOrders();

  // 2. Process retry queue
  const retryRes = await processRetryQueue();

  // 3. Scan for any un-enqueued failed work orders in DB or memory
  const pool = getPgPool();
  let failedOrders: WorkOrder[] = [];

  if (pool) {
    try {
      const res = await pool.query(`SELECT * FROM work_orders WHERE payment_status = 'failed'`);
      failedOrders = res.rows;
    } catch (err: any) {
      // ignore
    }
  }

  if (failedOrders.length === 0) {
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
