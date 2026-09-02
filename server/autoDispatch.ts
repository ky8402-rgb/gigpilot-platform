import crypto from 'crypto';
import { getPgPool, memoryStore, Job, Bid, WorkOrder, User } from './pgDatabase.js';
import { logActivityEvent } from './activityLogger.js';
import { createFreelancerProject } from './freelancerApi.js';
import { enqueueFreelancerJobSync, triggerWorkOrderFreelancerSync } from './freelancerRetryQueue.js';

export interface DispatchResult {
  job: Job;
  selectedWorker: User | null;
  bid: Bid | null;
  workOrder: WorkOrder | null;
  dispatchStatus: 'dispatched' | 'no_workers_available' | 'error';
  message: string;
}

/**
 * Auto-Dispatch Engine:
 * 1. Syncs project to external freelancer site (or queues for retry if offline/error).
 * 2. Selects best available worker based on lowest current workload and highest rating.
 * 3. Creates a bid and marks it accepted.
 * 4. Creates an active work order with completion deadline.
 * 5. Increments the worker's current workload and updates job status to 'assigned'.
 */
export async function autoDispatchJob(jobParams: {
  title: string;
  description: string;
  budget: number;
  customerId?: string;
  deadlineHours?: number;
  externalId?: string;
}): Promise<DispatchResult> {
  const pool = getPgPool();
  const jobId = crypto.randomUUID();
  const customerId = jobParams.customerId || '44444444-4444-4444-8444-444444444444';
  const budget = Number(jobParams.budget) || 100;
  const deadlineHours = jobParams.deadlineHours || 24;
  const now = new Date();
  const deadline = new Date(now.getTime() + deadlineHours * 60 * 60 * 1000);

  // 1. Create or resolve external project ID on the freelancer site
  let externalId: string | null = jobParams.externalId || null;
  if (!externalId) {
    try {
      const syncResult = await createFreelancerProject({
        title: jobParams.title,
        description: jobParams.description,
        budget,
      });
      if (syncResult.success && syncResult.projectId) {
        externalId = syncResult.projectId;
      } else {
        // Enqueue for background retry via Bull queue
        enqueueFreelancerJobSync(jobId);
      }
    } catch (e: any) {
      console.warn(`⚠️ [Job Creation] Freelancer API sync error, enqueuing for retry: ${e.message}`);
      enqueueFreelancerJobSync(jobId);
    }
  }

  const job: Job = {
    id: jobId,
    title: jobParams.title,
    description: jobParams.description || 'Auto-dispatched milestone project',
    budget,
    status: 'open',
    customer_id: customerId,
    external_id: externalId,
    created_at: now.toISOString(),
  };

  // Find best available worker: available, has paypal_email, lowest workload, highest rating
  let selectedWorker: User | null = null;

  if (pool) {
    try {
      // 1. Insert Job with external_id
      await pool.query(
        `INSERT INTO jobs (id, title, description, budget, status, customer_id, external_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [job.id, job.title, job.description, job.budget, job.status, job.customer_id, job.external_id, job.created_at]
      );

      // 2. Select best worker
      const workerRes = await pool.query(
        `SELECT id, email, paypal_email, rating, current_workload, is_available
         FROM users
         WHERE is_available = true AND paypal_email IS NOT NULL
         ORDER BY current_workload ASC, rating DESC
         LIMIT 1`
      );

      if (workerRes.rows.length > 0) {
        selectedWorker = {
          ...workerRes.rows[0],
          rating: parseFloat(workerRes.rows[0].rating),
          current_workload: parseInt(workerRes.rows[0].current_workload, 10),
        };
      }
    } catch (err: any) {
      console.warn('⚠️ [AutoDispatch] PostgreSQL query notice, using memory store fallback:', err.message);
    }
  }

  // Fallback to memory store if no DB worker selected
  if (!selectedWorker) {
    const availableWorkers = Array.from(memoryStore.users.values())
      .filter((u) => u.is_available && u.paypal_email)
      .sort((a, b) => {
        if (a.current_workload !== b.current_workload) {
          return a.current_workload - b.current_workload;
        }
        return b.rating - a.rating;
      });

    selectedWorker = availableWorkers[0] || null;
  }

  // Update memory store with job
  memoryStore.jobs.set(job.id, job);

  if (!selectedWorker) {
    logActivityEvent({
      source: 'System',
      type: 'DISPATCH_BLOCKED',
      status: 'error',
      summary: `Auto-dispatch for job "${job.title}" failed: No available workers found.`,
      tags: ['dispatch', 'no_workers'],
    });

    return {
      job,
      selectedWorker: null,
      bid: null,
      workOrder: null,
      dispatchStatus: 'no_workers_available',
      message: 'No available workers with configured PayPal payout emails found.',
    };
  }

  // 3. Create Bid
  const bidId = crypto.randomUUID();
  const bid: Bid = {
    id: bidId,
    job_id: jobId,
    worker_id: selectedWorker.id,
    amount: budget,
    status: 'accepted',
    created_at: now.toISOString(),
  };

  // 4. Create Work Order
  const workOrderId = crypto.randomUUID();
  const workOrder: WorkOrder = {
    id: workOrderId,
    job_id: jobId,
    worker_id: selectedWorker.id,
    bid_id: bidId,
    status: 'assigned',
    completion_deadline: deadline.toISOString(),
    completed_at: null,
    payment_status: 'pending',
  };

  // Update Job Status
  job.status = 'assigned';
  selectedWorker.current_workload += 1;

  // Persist to Postgres
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO bids (id, job_id, worker_id, amount, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bid.id, bid.job_id, bid.worker_id, bid.amount, bid.status, bid.created_at]
      );

      await pool.query(
        `INSERT INTO work_orders (id, job_id, worker_id, bid_id, status, completion_deadline, payment_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [workOrder.id, workOrder.job_id, workOrder.worker_id, workOrder.bid_id, workOrder.status, workOrder.completion_deadline, workOrder.payment_status]
      );

      await pool.query(`UPDATE jobs SET status = 'assigned' WHERE id = $1`, [jobId]);
      await pool.query(`UPDATE users SET current_workload = current_workload + 1 WHERE id = $1`, [selectedWorker.id]);
    } catch (err: any) {
      console.warn('⚠️ [AutoDispatch] Postgres persistence fallback:', err.message);
    }
  }

  // Persist to memory store
  memoryStore.bids.set(bid.id, bid);
  memoryStore.workOrders.set(workOrder.id, workOrder);
  memoryStore.users.set(selectedWorker.id, selectedWorker);
  memoryStore.jobs.set(job.id, job);

  // Trigger background auto-sync to Freelancer.com for the newly created Work Order
  triggerWorkOrderFreelancerSync(workOrder.id, jobId).catch((err) => {
    console.error(`⚠️ [WorkOrder Freelancer Sync Error]:`, err.message);
  });

  logActivityEvent({
    source: 'System',
    type: 'AUTO_DISPATCH_SUCCESS',
    status: 'success',
    summary: `Auto-dispatched job "${job.title}" to ${selectedWorker.email} ($${budget}) - WorkOrder: ${workOrderId}`,
    tags: ['auto_dispatch', 'bid', 'work_order', 'paypal'],
  });

  return {
    job,
    selectedWorker,
    bid,
    workOrder,
    dispatchStatus: 'dispatched',
    message: `Successfully matched with worker ${selectedWorker.email} (Rating: ${selectedWorker.rating}★, Workload: ${selectedWorker.current_workload}). Work order created.`,
  };
}
