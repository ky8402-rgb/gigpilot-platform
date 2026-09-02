import crypto from 'crypto';
import { getPgPool, memoryStore, WorkOrder, Transaction, User, Job } from './pgDatabase.js';
import { createPayPalPayout } from './paypal.js';
import { logActivityEvent } from './activityLogger.js';
import { recordCronHeartbeat } from './healthCheck.js';

export interface CompletionResult {
  success: boolean;
  workOrder: WorkOrder | null;
  transaction: Transaction | null;
  payoutStatus: 'paid' | 'failed' | 'processing';
  message: string;
  error?: string;
}

/**
 * Executes work order completion & triggers PayPal Payout to worker
 */
export async function completeWorkOrderAndPayout(
  workOrderId: string,
  triggerReason: 'worker_action' | 'customer_confirmation' | 'deadline_auto_approve' | 'retry_engine'
): Promise<CompletionResult> {
  const pool = getPgPool();
  const now = new Date();

  let workOrder: WorkOrder | null = null;
  let worker: User | null = null;
  let job: Job | null = null;

  // Fetch Work Order
  if (pool) {
    try {
      const woRes = await pool.query('SELECT * FROM work_orders WHERE id = $1', [workOrderId]);
      if (woRes.rows.length > 0) {
        workOrder = woRes.rows[0];
      }
    } catch (err: any) {
      console.warn('⚠️ [CompletionWorker] Postgres read fallback:', err.message);
    }
  }

  if (!workOrder) {
    workOrder = memoryStore.workOrders.get(workOrderId) || null;
  }

  if (!workOrder) {
    return {
      success: false,
      workOrder: null,
      transaction: null,
      payoutStatus: 'failed',
      message: `Work Order ${workOrderId} not found.`,
    };
  }

  // If already paid and completed, prevent duplicate payout
  if (workOrder.status === 'paid' && workOrder.payment_status === 'paid') {
    return {
      success: true,
      workOrder,
      transaction: null,
      payoutStatus: 'paid',
      message: `Work Order ${workOrderId} has already been completed and paid.`,
    };
  }

  // Fetch Worker details
  if (pool) {
    try {
      const workerRes = await pool.query('SELECT * FROM users WHERE id = $1', [workOrder.worker_id]);
      if (workerRes.rows.length > 0) {
        worker = workerRes.rows[0];
      }
      const jobRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [workOrder.job_id]);
      if (jobRes.rows.length > 0) {
        job = jobRes.rows[0];
      }
    } catch (err: any) {
      console.warn('⚠️ [CompletionWorker] Postgres worker/job lookup notice:', err.message);
    }
  }

  if (!worker) {
    worker = memoryStore.users.get(workOrder.worker_id) || null;
  }
  if (!job) {
    job = memoryStore.jobs.get(workOrder.job_id) || null;
  }

  if (!worker || !worker.paypal_email) {
    const errorMsg = `Worker ${workOrder.worker_id} has no valid PayPal payout email configured.`;
    workOrder.status = 'completed';
    workOrder.payment_status = 'failed';
    memoryStore.workOrders.set(workOrder.id, workOrder);

    logActivityEvent({
      source: 'PayPal',
      type: 'PAYOUT_FAILED',
      status: 'error',
      summary: `Payout failed for Work Order ${workOrderId}: ${errorMsg}`,
      tags: ['payout_failed', 'paypal', 'self_healing'],
    });

    return {
      success: false,
      workOrder,
      transaction: null,
      payoutStatus: 'failed',
      message: errorMsg,
      error: errorMsg,
    };
  }

  const payoutAmount = job?.budget || 100;

  // 1. Mark Work Order as completed
  workOrder.status = 'completed';
  workOrder.completed_at = now.toISOString();
  workOrder.payment_status = 'processing';
  if (triggerReason === 'customer_confirmation') {
    workOrder.customer_confirmed = true;
  } else if (triggerReason === 'worker_action') {
    workOrder.worker_marked_complete = true;
  }

  // 2. Decrement worker current_workload
  if (worker.current_workload > 0) {
    worker.current_workload -= 1;
  }

  // 3. Trigger PayPal Payout
  let payoutResponse;
  let payoutStatus: 'paid' | 'failed' = 'paid';
  let payoutBatchId = '';

  try {
    payoutResponse = await createPayPalPayout({
      receiverEmail: worker.paypal_email,
      amount: payoutAmount,
      currency: 'USD',
      note: `Payment for completed work order: ${job?.title || workOrderId} (${triggerReason})`,
      recipientName: worker.email,
    });

    payoutBatchId = payoutResponse.payoutBatchId;
    payoutStatus = 'paid';
    workOrder.payment_status = 'paid';
    workOrder.status = 'paid';
    if (job) job.status = 'paid';
  } catch (payoutErr: any) {
    console.error('❌ [CompletionWorker] PayPal Payout failed:', payoutErr?.message || payoutErr);
    payoutStatus = 'failed';
    workOrder.payment_status = 'failed';
  }

  // 4. Record Transaction in `transactions` table
  const transactionId = crypto.randomUUID();
  const transaction: Transaction = {
    id: transactionId,
    work_order_id: workOrder.id,
    amount: payoutAmount,
    status: payoutStatus,
    paypal_payout_batch_id: payoutBatchId || null,
    created_at: now.toISOString(),
  };

  // Persist to Postgres
  if (pool) {
    try {
      await pool.query(
        `UPDATE work_orders
         SET status = $1, completed_at = $2, payment_status = $3,
             customer_confirmed = COALESCE($4, customer_confirmed),
             worker_marked_complete = COALESCE($5, worker_marked_complete)
         WHERE id = $6`,
        [workOrder.status, workOrder.completed_at, workOrder.payment_status, workOrder.customer_confirmed || false, workOrder.worker_marked_complete || false, workOrder.id]
      );

      await pool.query(
        `UPDATE users
         SET current_workload = GREATEST(0, current_workload - 1)
         WHERE id = $1`,
        [worker.id]
      );

      if (job) {
        await pool.query(`UPDATE jobs SET status = $1 WHERE id = $2`, [job.status, job.id]);
      }

      await pool.query(
        `INSERT INTO transactions (id, work_order_id, amount, status, paypal_payout_batch_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [transaction.id, transaction.work_order_id, transaction.amount, transaction.status, transaction.paypal_payout_batch_id, transaction.created_at]
      );
    } catch (err: any) {
      console.warn('⚠️ [CompletionWorker] Postgres update error, updated memory store:', err.message);
    }
  }

  // Persist to Memory Store
  memoryStore.workOrders.set(workOrder.id, workOrder);
  memoryStore.users.set(worker.id, worker);
  memoryStore.transactions.set(transaction.id, transaction);
  if (job) memoryStore.jobs.set(job.id, job);

  logActivityEvent({
    source: 'PayPal',
    type: payoutStatus === 'paid' ? 'PAYOUT_COMPLETED' : 'PAYOUT_FAILED',
    status: payoutStatus === 'paid' ? 'success' : 'error',
    summary: payoutStatus === 'paid'
      ? `PayPal Payout of $${payoutAmount} sent to ${worker.paypal_email} (Batch: ${payoutBatchId}) for WorkOrder ${workOrderId} via [${triggerReason}]`
      : `PayPal Payout of $${payoutAmount} to ${worker.paypal_email} failed for WorkOrder ${workOrderId}`,
    tags: ['paypal_payout', 'revenue_withdrawal', triggerReason],
  });

  return {
    success: payoutStatus === 'paid',
    workOrder,
    transaction,
    payoutStatus,
    message: payoutStatus === 'paid'
      ? `Work order completed and $${payoutAmount} successfully transferred via PayPal Payouts to ${worker.paypal_email} (Batch ID: ${payoutBatchId}).`
      : `Work order marked complete, but PayPal payout failed. Enqueued for self-healing automatic retry.`,
  };
}

/**
 * Scan for overdue work orders whose completion deadline has passed, or marked completed by worker/customer, and auto-approve them
 */
export async function checkAndAutoApproveOverdueWorkOrders(): Promise<{
  scannedCount: number;
  autoApprovedCount: number;
  approvedIds: string[];
}> {
  recordCronHeartbeat('auto_completion_worker');
  const pool = getPgPool();
  const now = new Date();
  const approvedIds: string[] = [];

  let overdueOrders: WorkOrder[] = [];

  if (pool) {
    try {
      const res = await pool.query(
        `SELECT * FROM work_orders
         WHERE status IN ('assigned', 'in_progress')
           AND (completion_deadline <= $1 OR customer_confirmed = TRUE OR worker_marked_complete = TRUE)`,
        [now.toISOString()]
      );
      overdueOrders = res.rows;
    } catch (err: any) {
      console.warn('⚠️ [CompletionWorker] Postgres overdue scan fallback:', err.message);
    }
  }

  if (overdueOrders.length === 0) {
    overdueOrders = Array.from(memoryStore.workOrders.values()).filter((wo) => {
      const isOverdue = new Date(wo.completion_deadline) <= now;
      const isConfirmed = Boolean(wo.customer_confirmed || wo.worker_marked_complete);
      return (wo.status === 'assigned' || wo.status === 'in_progress') && (isOverdue || isConfirmed);
    });
  }

  for (const order of overdueOrders) {
    try {
      const reason = order.customer_confirmed
        ? 'customer_confirmation'
        : order.worker_marked_complete
        ? 'worker_action'
        : 'deadline_auto_approve';

      const res = await completeWorkOrderAndPayout(order.id, reason);
      if (res.success) {
        approvedIds.push(order.id);
      }
    } catch (err: any) {
      console.error(`❌ [CompletionWorker] Auto-approve error for ${order.id}:`, err.message);
    }
  }

  return {
    scannedCount: overdueOrders.length,
    autoApprovedCount: approvedIds.length,
    approvedIds,
  };
}
