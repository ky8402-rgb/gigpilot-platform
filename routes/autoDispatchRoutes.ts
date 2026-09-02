import express from 'express';
import { autoDispatchJob } from '../server/autoDispatch.js';
import { completeWorkOrderAndPayout, checkAndAutoApproveOverdueWorkOrders } from '../server/completionWorker.js';
import { runSelfHealingDiagnostics } from '../server/retryWorker.js';
import { triggerAISupportIncident, queryAISupportChat, activeSupportTickets } from '../server/supportChat.js';
import { getPgPool, memoryStore, User } from '../server/pgDatabase.js';
import { getPayPalConfig, isPayPalConfigured } from '../server/paypal.js';
import { logActivityEvent } from '../server/activityLogger.js';
import { checkExternalLinkHealth, getFreelancerProjectUrl } from '../server/freelancerApi.js';
import { scanAndRetryMissingExternalJobs, syncJobToFreelancer, enqueueFreelancerJobSync, triggerWorkOrderFreelancerSync } from '../server/freelancerRetryQueue.js';

const router = express.Router();

/**
 * POST /api/jobs
 * 1. Post a new job & automatically trigger auto-dispatch:
 *    - Selects the best worker (rating & workload)
 *    - Automatically creates and accepts bid
 *    - Creates work order with deadline
 */
router.post('/jobs', async (req, res) => {
  try {
    const { title, description, budget, customerId, deadlineHours } = req.body;

    if (!title || !budget) {
      return res.status(400).json({
        success: false,
        error: 'Job title and budget are required.',
      });
    }

    const result = await autoDispatchJob({
      title: title.trim(),
      description: description || '',
      budget: parseFloat(budget),
      customerId,
      deadlineHours: deadlineHours ? parseInt(deadlineHours, 10) : 24,
    });

    return res.status(201).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || String(err),
    });
  }
});

/**
 * GET /api/jobs
 * List all jobs enriched with external_id and external_project_url
 */
router.get('/jobs', async (req, res) => {
  try {
    const pool = getPgPool();
    if (pool) {
      try {
        const result = await pool.query('SELECT * FROM jobs ORDER BY created_at DESC');
        const enrichedJobs = result.rows.map((j) => ({
          ...j,
          external_project_url: getFreelancerProjectUrl(j.external_id),
        }));
        return res.json({ success: true, jobs: enrichedJobs });
      } catch (err: any) {
        console.warn('⚠️ [Jobs Route] Postgres read fallback:', err.message);
      }
    }

    const jobs = Array.from(memoryStore.jobs.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((j) => ({
        ...j,
        external_project_url: getFreelancerProjectUrl(j.external_id),
      }));

    return res.json({ success: true, jobs });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Helper to fetch a single work order by id
 */
async function getWorkOrderById(id: string) {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query(`
        SELECT 
          wo.*,
          j.title as job_title,
          j.budget as job_budget,
          u.email as worker_email,
          u.paypal_email as worker_paypal_email,
          u.rating as worker_rating
        FROM work_orders wo
        LEFT JOIN jobs j ON wo.job_id = j.id
        LEFT JOIN users u ON wo.worker_id = u.id
        WHERE wo.id = $1
      `, [id]);
      if (res.rows.length > 0) return res.rows[0];
    } catch (err: any) {
      console.warn('⚠️ [WorkOrder Lookup] Postgres query fallback:', err.message);
    }
  }

  const wo = memoryStore.workOrders.get(id);
  if (!wo) return null;
  const job = memoryStore.jobs.get(wo.job_id);
  const worker = memoryStore.users.get(wo.worker_id);
  return {
    ...wo,
    job_title: job?.title || 'Unknown Job',
    job_budget: job?.budget || 0,
    worker_email: worker?.email || 'Unknown',
    worker_paypal_email: worker?.paypal_email || null,
    worker_rating: worker?.rating || 0,
  };
}

/**
 * GET /api/workorders/status or /api/work-orders/status
 * Returns current status, completion_deadline, time remaining, and completed_at
 */
router.get(['/workorders/status', '/work-orders/status'], async (req, res) => {
  try {
    const { id } = req.query;
    const now = Date.now();

    if (id) {
      const order = await getWorkOrderById(String(id));
      if (!order) {
        return res.status(404).json({ success: false, error: `Work order ${id} not found.` });
      }
      const deadlineMs = new Date(order.completion_deadline).getTime();
      const timeRemainingMs = Math.max(0, deadlineMs - now);
      const isOverdue = deadlineMs <= now && order.status !== 'completed' && order.status !== 'paid';

      return res.json({
        success: true,
        id: order.id,
        status: order.status,
        payment_status: order.payment_status,
        completion_deadline: order.completion_deadline,
        completed_at: order.completed_at,
        customer_confirmed: order.customer_confirmed || false,
        worker_marked_complete: order.worker_marked_complete || false,
        timeRemainingMs,
        timeRemainingSeconds: Math.floor(timeRemainingMs / 1000),
        isOverdue,
        serverTime: new Date(now).toISOString(),
      });
    }

    // Return status summary for all orders
    const pool = getPgPool();
    let orders: any[] = [];
    if (pool) {
      try {
        const result = await pool.query('SELECT * FROM work_orders ORDER BY completion_deadline ASC');
        orders = result.rows;
      } catch (err: any) {
        console.warn('⚠️ [WorkOrders Status] Postgres query fallback:', err.message);
      }
    }
    if (orders.length === 0) {
      orders = Array.from(memoryStore.workOrders.values());
    }

    const statuses = orders.map((wo) => {
      const deadlineMs = new Date(wo.completion_deadline).getTime();
      const timeRemainingMs = Math.max(0, deadlineMs - now);
      return {
        id: wo.id,
        status: wo.status,
        payment_status: wo.payment_status,
        completion_deadline: wo.completion_deadline,
        completed_at: wo.completed_at,
        customer_confirmed: wo.customer_confirmed || false,
        worker_marked_complete: wo.worker_marked_complete || false,
        timeRemainingMs,
        timeRemainingSeconds: Math.floor(timeRemainingMs / 1000),
        isOverdue: deadlineMs <= now && wo.status !== 'completed' && wo.status !== 'paid',
      };
    });

    return res.json({
      success: true,
      serverTime: new Date(now).toISOString(),
      count: statuses.length,
      statuses,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/workorders/:id/status or /api/work-orders/:id/status
 */
router.get(['/workorders/:id/status', '/work-orders/:id/status'], async (req, res) => {
  try {
    const { id } = req.params;
    const now = Date.now();
    const order = await getWorkOrderById(id);

    if (!order) {
      return res.status(404).json({ success: false, error: `Work order ${id} not found.` });
    }

    const deadlineMs = new Date(order.completion_deadline).getTime();
    const timeRemainingMs = Math.max(0, deadlineMs - now);
    const isOverdue = deadlineMs <= now && order.status !== 'completed' && order.status !== 'paid';

    return res.json({
      success: true,
      id: order.id,
      status: order.status,
      payment_status: order.payment_status,
      completion_deadline: order.completion_deadline,
      completed_at: order.completed_at,
      customer_confirmed: order.customer_confirmed || false,
      worker_marked_complete: order.worker_marked_complete || false,
      timeRemainingMs,
      timeRemainingSeconds: Math.floor(timeRemainingMs / 1000),
      isOverdue,
      serverTime: new Date(now).toISOString(),
      order,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/work-orders or /api/workorders
 * List all work orders with worker and job details including external project link
 */
router.get(['/work-orders', '/workorders'], async (req, res) => {
  try {
    const pool = getPgPool();
    if (pool) {
      try {
        const result = await pool.query(`
          SELECT 
            wo.*,
            COALESCE(j.title, 'Auto-Dispatched Task') as title,
            COALESCE(b.amount, j.budget, 250) as amount,
            j.title as job_title,
            j.budget as job_budget,
            j.external_id,
            b.amount as bid_amount,
            u.email as worker_email,
            u.paypal_email as worker_paypal_email,
            u.rating as worker_rating
          FROM work_orders wo
          LEFT JOIN jobs j ON wo.job_id = j.id
          LEFT JOIN bids b ON wo.bid_id = b.id
          LEFT JOIN users u ON wo.worker_id = u.id
          ORDER BY wo.completion_deadline ASC
        `);
        const workOrders = result.rows.map((wo) => ({
          ...wo,
          external_project_url: getFreelancerProjectUrl(wo.external_id),
        }));
        return res.json({ success: true, workOrders });
      } catch (err: any) {
        console.warn('⚠️ [WorkOrders Route] Postgres query fallback:', err.message);
      }
    }

    const workOrders = Array.from(memoryStore.workOrders.values()).map((wo) => {
      const job = memoryStore.jobs.get(wo.job_id);
      const worker = memoryStore.users.get(wo.worker_id);
      const bid = wo.bid_id ? memoryStore.bids.get(wo.bid_id) : null;
      return {
        ...wo,
        title: job?.title || 'Auto-Dispatched Task',
        amount: bid?.amount || job?.budget || 250,
        job_title: job?.title || 'Unknown Job',
        job_budget: job?.budget || 0,
        external_id: job?.external_id || null,
        external_project_url: getFreelancerProjectUrl(job?.external_id),
        bid_amount: bid?.amount || null,
        worker_email: worker?.email || 'Unknown',
        worker_paypal_email: worker?.paypal_email || null,
        worker_rating: worker?.rating || 0,
      };
    });

    return res.json({ success: true, workOrders });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/work-orders/:id/complete or /api/workorders/:id/complete
 * Worker marks work order as complete -> Triggers automated PayPal Payout
 */
router.post(['/work-orders/:id/complete', '/workorders/:id/complete'], async (req, res) => {
  try {
    const { id } = req.params;
    const result = await completeWorkOrderAndPayout(id, 'worker_action');

    if (result.success) {
      return res.json({
        success: true,
        message: result.message,
        workOrder: result.workOrder,
        transaction: result.transaction,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.message,
        error: result.error,
        workOrder: result.workOrder,
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/work-orders/:id/confirm or /api/workorders/:id/confirm
 * Customer confirms completion -> Triggers automated PayPal Payout
 */
router.post(['/work-orders/:id/confirm', '/workorders/:id/confirm'], async (req, res) => {
  try {
    const { id } = req.params;
    const result = await completeWorkOrderAndPayout(id, 'customer_confirmation');

    if (result.success) {
      return res.json({
        success: true,
        message: result.message,
        workOrder: result.workOrder,
        transaction: result.transaction,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.message,
        error: result.error,
        workOrder: result.workOrder,
      });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/work-orders or /api/workorders
 * Creates a work order and automatically triggers background sync to Freelancer.com API
 */
router.post(['/work-orders', '/workorders'], async (req, res) => {
  try {
    const { jobId, workerId, bidId, deadlineHours } = req.body;

    if (!jobId || !workerId) {
      return res.status(400).json({ success: false, error: 'jobId and workerId are required.' });
    }

    const pool = getPgPool();
    const workOrderId = crypto.randomUUID();
    const hours = deadlineHours ? Number(deadlineHours) : 24;
    const deadline = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    const workOrder = {
      id: workOrderId,
      job_id: jobId,
      worker_id: workerId,
      bid_id: bidId || null,
      status: 'assigned',
      completion_deadline: deadline,
      completed_at: null,
      payment_status: 'pending',
      customer_confirmed: false,
      worker_marked_complete: false,
    };

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO work_orders (id, job_id, worker_id, bid_id, status, completion_deadline, payment_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [workOrder.id, workOrder.job_id, workOrder.worker_id, workOrder.bid_id, workOrder.status, workOrder.completion_deadline, workOrder.payment_status]
        );
      } catch (err: any) {
        console.warn('⚠️ [WorkOrder Direct Creation] Postgres persistence fallback:', err.message);
      }
    }

    memoryStore.workOrders.set(workOrderId, workOrder as any);

    // Trigger background auto-sync to Freelancer.com API
    triggerWorkOrderFreelancerSync(workOrderId, jobId).catch((e) => {
      console.error(`⚠️ [WorkOrder Freelancer Sync Error]:`, e.message);
    });

    logActivityEvent({
      source: 'WorkOrders',
      type: 'WORK_ORDER_CREATED',
      status: 'success',
      summary: `Created Work Order ${workOrderId} for Job ${jobId}. Background Freelancer.com sync triggered.`,
      tags: ['work_order', 'created', 'freelancer_sync', workOrderId],
    });

    return res.status(201).json({
      success: true,
      message: 'Work order created successfully. Background Freelancer.com sync initiated.',
      workOrder,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/work-orders/:id/sync-freelancer or /api/workorders/:id/sync-freelancer
 * Manually or programmatically triggers the Freelancer API sync for a specific work order
 */
router.post(['/work-orders/:id/sync-freelancer', '/workorders/:id/sync-freelancer'], async (req, res) => {
  try {
    const { id } = req.params;
    const syncResult = await triggerWorkOrderFreelancerSync(id);

    return res.json({
      success: syncResult.success,
      workOrderId: id,
      externalId: syncResult.externalId || null,
      error: syncResult.error || null,
      enqueuedForRetry: syncResult.enqueued || false,
      message: syncResult.success
        ? `Work order ${id} successfully synced to Freelancer.com project #${syncResult.externalId}`
        : `Freelancer API sync failed: ${syncResult.error}. Enqueued in Bull retry queue.`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/transactions
 * List all payout transactions
 */
router.get('/transactions', async (req, res) => {
  try {
    const pool = getPgPool();
    if (pool) {
      try {
        const result = await pool.query('SELECT * FROM transactions ORDER BY created_at DESC');
        return res.json({ success: true, transactions: result.rows });
      } catch (err: any) {
        console.warn('⚠️ [Transactions Route] Postgres read fallback:', err.message);
      }
    }

    const transactions = Array.from(memoryStore.transactions.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return res.json({ success: true, transactions });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/workers
 * List all workers with workload, ratings, and PayPal payout email
 */
router.get('/workers', async (req, res) => {
  try {
    const pool = getPgPool();
    if (pool) {
      try {
        const result = await pool.query('SELECT * FROM users ORDER BY rating DESC');
        return res.json({ success: true, workers: result.rows });
      } catch (err: any) {
        console.warn('⚠️ [Workers Route] Postgres read fallback:', err.message);
      }
    }

    const workers = Array.from(memoryStore.users.values());
    return res.json({ success: true, workers });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/workers
 * Register or update a worker with paypal_email
 */
router.post('/workers', async (req, res) => {
  try {
    const { email, paypal_email, rating, is_available } = req.body;
    if (!email || !paypal_email) {
      return res.status(400).json({ success: false, error: 'email and paypal_email are required.' });
    }

    const crypto = await import('crypto');
    const worker: User = {
      id: crypto.randomUUID(),
      email: email.trim(),
      paypal_email: paypal_email.trim(),
      rating: rating !== undefined ? parseFloat(rating) : 5.0,
      current_workload: 0,
      is_available: is_available !== undefined ? Boolean(is_available) : true,
    };

    const pool = getPgPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, email, paypal_email, rating, current_workload, is_available)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (email) DO UPDATE
           SET paypal_email = EXCLUDED.paypal_email, rating = EXCLUDED.rating, is_available = EXCLUDED.is_available`,
          [worker.id, worker.email, worker.paypal_email, worker.rating, worker.current_workload, worker.is_available]
        );
      } catch (err: any) {
        console.warn('⚠️ [Workers Route] Postgres insert notice:', err.message);
      }
    }

    memoryStore.users.set(worker.id, worker);
    return res.status(201).json({ success: true, worker });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/health/self-healing
 * Health-check endpoint that monitors pending work orders, failed transactions,
 * PayPal gateway status, and active AI support incident tickets.
 */
router.get('/health/self-healing', async (req, res) => {
  try {
    const pool = getPgPool();
    const isDbConnected = Boolean(pool);
    const payPalCfg = getPayPalConfig();

    const pendingWorkOrders = Array.from(memoryStore.workOrders.values()).filter(
      (w) => w.status === 'assigned' || w.status === 'in_progress'
    );
    const failedWorkOrders = Array.from(memoryStore.workOrders.values()).filter((w) => w.payment_status === 'failed');
    const failedTransactions = Array.from(memoryStore.transactions.values()).filter((t) => t.status === 'failed');

    const now = new Date();
    const overdueWorkOrders = pendingWorkOrders.filter((w) => new Date(w.completion_deadline) <= now);

    const isSystemHealthy = failedWorkOrders.length === 0 && failedTransactions.length === 0;

    return res.json({
      status: isSystemHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      selfHealing: {
        active: true,
        monitoringIntervalSeconds: 15,
        exponentialBackoffMaxRetries: 3,
      },
      metrics: {
        pendingWorkOrdersCount: pendingWorkOrders.length,
        overdueWorkOrdersCount: overdueWorkOrders.length,
        failedWorkOrdersCount: failedWorkOrders.length,
        failedTransactionsCount: failedTransactions.length,
        activeSupportTicketsCount: activeSupportTickets.length,
        totalRegisteredWorkers: memoryStore.users.size,
      },
      paypalGateway: {
        configured: isPayPalConfigured(),
        mode: payPalCfg.mode,
        receiverEmail: payPalCfg.receiverEmail,
      },
      database: {
        status: isDbConnected ? 'connected' : 'in_memory_fallback',
        engine: 'Neon / PostgreSQL',
      },
      activeTickets: activeSupportTickets.slice(0, 5),
    });
  } catch (err: any) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * POST /api/support/ai-chat
 * AI Support Chat endpoint for questions, debugging, and interactive assistance
 */
router.post('/support/ai-chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message) {
      return res.status(400).json({ success: false, error: 'message string is required.' });
    }

    const response = await queryAISupportChat(message, history || []);
    return res.json({ success: true, ...response });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/support/trigger-incident
 * Diagnostic endpoint to trigger AI Support analysis manually
 */
router.post('/support/trigger-incident', async (req, res) => {
  try {
    const { category, severity, title, errorMessage, context } = req.body || {};
    const ticket = await triggerAISupportIncident({
      category: category || 'GENERAL_SUPPORT',
      severity: severity || 'medium',
      title: title || 'Manual Diagnostic Trigger',
      errorMessage,
      context,
    });

    return res.json({ success: true, ticket });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/retry/trigger
 * Manually trigger self-healing retry engine
 */
router.post('/retry/trigger', async (req, res) => {
  try {
    const diagnostic = await runSelfHealingDiagnostics();
    return res.json({
      success: true,
      message: 'Self-healing diagnostic cycle executed successfully.',
      diagnostic,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/health/freelancer-links and /api/health/external-links
 * Picks a sample job with external_id, does a HEAD request to the Freelancer.com external URL,
 * and returns { valid: true/false, ... }. If invalid, triggers the Bull retry queue to re-sync.
 */
router.get(['/health/freelancer-links', '/health/external-links'], async (req, res) => {
  try {
    const pool = getPgPool();
    let sampleJob: { id: string; title: string; external_id?: string | null } | null = null;
    let missingCount = 0;
    let missingJobs: any[] = [];

    if (pool) {
      try {
        const sampleRes = await pool.query('SELECT id, title, external_id FROM jobs WHERE external_id IS NOT NULL AND external_id != \'\' ORDER BY created_at DESC LIMIT 1');
        if (sampleRes.rows.length > 0) {
          sampleJob = sampleRes.rows[0];
        }

        const missingRes = await pool.query('SELECT id, title, budget, created_at FROM jobs WHERE external_id IS NULL OR external_id = \'\' LIMIT 20');
        missingCount = missingRes.rows.length;
        missingJobs = missingRes.rows;
      } catch (e: any) {
        console.warn('⚠️ [Health Freelancer Links] Query notice:', e.message);
      }
    }

    if (!sampleJob) {
      for (const job of memoryStore.jobs.values()) {
        if (job.external_id) {
          sampleJob = { id: job.id, title: job.title, external_id: job.external_id };
          break;
        }
      }
    }

    // Perform HTTP HEAD verification on the sample job's external Freelancer.com URL
    const linkCheck = await checkExternalLinkHealth(sampleJob?.external_id || 'sample_proj_1001');

    // If invalid, degraded, or missing external IDs exist, trigger Bull retry queue to heal/re-sync
    let autoHealResult = { scannedCount: 0, fixedCount: 0 };
    if (!linkCheck.valid || missingCount > 0) {
      if (sampleJob && !linkCheck.valid) {
        // Enqueue this specific invalid job for immediate re-sync
        await enqueueFreelancerJobSync(sampleJob.id);
      }
      autoHealResult = await scanAndRetryMissingExternalJobs();
    }

    const isValid = linkCheck.valid;

    return res.json({
      valid: isValid,
      status: isValid ? 'healthy' : 'degraded',
      testedJobId: sampleJob?.id || null,
      testedExternalId: sampleJob?.external_id || 'sample_proj_1001',
      testedUrl: linkCheck.testedUrl,
      httpStatus: linkCheck.httpStatus,
      responseTimeMs: linkCheck.responseTimeMs,
      error: linkCheck.error || null,
      missingExternalIdsCount: missingCount,
      missingJobsSample: missingJobs.map(j => ({ id: j.id, title: j.title })),
      autoHealingQueueTriggered: autoHealResult.fixedCount > 0 || !isValid,
      autoHealedEnqueuedCount: autoHealResult.fixedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ valid: false, status: 'error', error: err.message });
  }
});

/**
 * POST /api/jobs/:id/sync-freelancer
 * Manually forces external sync of a job to the Freelancer website
 */
router.post('/jobs/:id/sync-freelancer', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await syncJobToFreelancer(id);
    return res.json({
      success,
      jobId: id,
      message: success
        ? `Successfully synced job ${id} with external freelancer platform.`
        : `Could not sync job ${id}. Enqueued for automatic background retry.`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
