import Queue from 'bull';
import { getPgPool, memoryStore } from './pgDatabase.js';
import { createFreelancerProject, getFreelancerConfig } from './freelancerApi.js';
import { logActivityEvent } from './activityLogger.js';

let freelancerSyncQueue: Queue.Queue | null = null;
const redisUrl = (process.env.REDIS_URL || '').trim();

// Initialize Bull Queue safely only when REDIS_URL is explicitly configured and not an internal cloud host
if (redisUrl && !redisUrl.includes('red-')) {
  try {
    freelancerSyncQueue = new Queue('freelancer-sync', redisUrl, {
      redis: {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: () => null, // Do not hang indefinitely if Redis unreachable
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
      },
    });

    freelancerSyncQueue.process(async (job) => {
      const { jobId } = job.data;
      console.log(`🔄 [Bull Queue: freelancer-sync] Processing project creation retry for job: ${jobId} (Attempt ${job.attemptsMade + 1}/3)`);
      const success = await syncJobToFreelancer(jobId);
      if (!success && job.attemptsMade < 2) {
        throw new Error(`Freelancer sync retry failed for job ${jobId}. Bull will retry with exponential backoff.`);
      }
      return { success, jobId };
    });

    freelancerSyncQueue.on('failed', (job, err) => {
      console.warn(`⚠️ [Bull Queue: freelancer-sync] Job ${job.id} (app jobId: ${job.data?.jobId}) failed attempt ${job.attemptsMade}/3: ${err.message}`);
    });
  } catch (err: any) {
    console.warn(`⚠️ [Bull Queue: freelancer-sync] Redis unavailable at ${redisUrl}. Using in-memory retry processor:`, err.message);
    freelancerSyncQueue = null;
  }
} else {
  // Resilient in-memory retry queue processor is used automatically
  freelancerSyncQueue = null;
}

export function getFreelancerSyncQueue(): Queue.Queue | null {
  return freelancerSyncQueue;
}

/**
 * Syncs a specific job to the external freelancer platform and updates its external_id column
 */
export async function syncJobToFreelancer(jobId: string): Promise<boolean> {
  const pool = getPgPool();
  let jobData: { id: string; title: string; description: string; budget: number; external_id?: string | null } | null = null;

  if (pool) {
    try {
      const res = await pool.query('SELECT id, title, description, budget, external_id FROM jobs WHERE id = $1', [jobId]);
      if (res.rows.length > 0) {
        jobData = res.rows[0];
      }
    } catch (err: any) {
      console.warn('⚠️ [Freelancer Sync] Postgres query notice:', err.message);
    }
  }

  if (!jobData) {
    const memJob = memoryStore.jobs.get(jobId);
    if (memJob) {
      jobData = {
        id: memJob.id,
        title: memJob.title,
        description: memJob.description,
        budget: memJob.budget,
        external_id: memJob.external_id,
      };
    }
  }

  if (!jobData) {
    console.error(`❌ [Freelancer Sync] Job ${jobId} not found in DB or memory store.`);
    return false;
  }

  // Already has external_id
  if (jobData.external_id) {
    return true;
  }

  // Call the external freelancer API
  const syncResult = await createFreelancerProject({
    title: jobData.title,
    description: jobData.description,
    budget: Number(jobData.budget),
  });

  if (syncResult.success && syncResult.projectId) {
    const externalId = syncResult.projectId;

    // Update in Postgres
    if (pool) {
      try {
        await pool.query('UPDATE jobs SET external_id = $1 WHERE id = $2', [externalId, jobId]);
      } catch (err: any) {
        console.warn('⚠️ [Freelancer Sync] Postgres update notice:', err.message);
      }
    }

    // Update in Memory Store
    const memJob = memoryStore.jobs.get(jobId);
    if (memJob) {
      memJob.external_id = externalId;
      memoryStore.jobs.set(jobId, memJob);
    }

    logActivityEvent({
      source: 'SelfHealing',
      type: 'SYNC_REPAIRED',
      status: 'success',
      summary: `Auto-repaired external link for job "${jobData.title}" -> ${externalId}`,
      tags: ['self_healing', 'freelancer_sync', jobId],
    });

    console.log(`✅ [Freelancer Sync] Job ${jobId} successfully linked to external ID: ${externalId}`);
    return true;
  }

  return false;
}

/**
 * Enqueue a job for background sync to external freelancer platform
 */
export async function enqueueFreelancerJobSync(jobId: string): Promise<void> {
  if (freelancerSyncQueue) {
    try {
      await freelancerSyncQueue.add(
        { jobId },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
      );
      console.log(`📥 [Bull Queue: freelancer-sync] Enqueued job ${jobId} for background retry.`);
      return;
    } catch (err: any) {
      console.warn(`⚠️ [Bull Queue Enqueue Notice]`, err.message);
    }
  }

  // Fallback async retry execution
  setTimeout(async () => {
    try {
      console.log(`🔄 [In-Memory Retry] Retrying Freelancer sync for job ${jobId}...`);
      await syncJobToFreelancer(jobId);
    } catch (e: any) {
      console.error(`⚠️ [In-Memory Retry] Sync failed for job ${jobId}:`, e.message);
    }
  }, 4000);
}

/**
 * Background auto-sync process triggered whenever a new Work Order is created.
 * 1. Resolves the associated job.
 * 2. Calls Freelancer.com API to create a matching project.
 * 3. Stores the returned ID as 'external_id' in the 'jobs' table.
 * 4. Logs sync status (success / error).
 * 5. If the API call fails, enqueues the job to Bull queue for retries.
 */
export async function triggerWorkOrderFreelancerSync(
  workOrderId: string,
  explicitJobId?: string
): Promise<{ success: boolean; externalId?: string; error?: string; enqueued?: boolean }> {
  const pool = getPgPool();
  let jobId = explicitJobId;

  console.log(`🚀 [WorkOrder Auto-Sync] Background auto-sync initiated for Work Order: ${workOrderId}`);

  // 1. Resolve jobId if not explicitly provided
  if (!jobId && pool) {
    try {
      const woRes = await pool.query('SELECT job_id FROM work_orders WHERE id = $1', [workOrderId]);
      if (woRes.rows.length > 0) {
        jobId = woRes.rows[0].job_id;
      }
    } catch (err: any) {
      console.warn(`⚠️ [WorkOrder Auto-Sync] Work order query notice:`, err.message);
    }
  }

  if (!jobId) {
    const memWo = memoryStore.workOrders.get(workOrderId);
    if (memWo) {
      jobId = memWo.job_id;
    }
  }

  if (!jobId) {
    console.error(`❌ [WorkOrder Auto-Sync] Could not resolve job_id for Work Order: ${workOrderId}`);
    logActivityEvent({
      source: 'WorkOrderSync',
      type: 'WORK_ORDER_FREELANCER_SYNC_FAILED',
      status: 'error',
      summary: `Failed to auto-sync Work Order ${workOrderId}: associated job ID not found.`,
      tags: ['work_order', 'freelancer_api', 'error', workOrderId],
    });
    return { success: false, error: 'Associated job ID not found' };
  }

  // 2. Resolve job data
  let jobData: { id: string; title: string; description: string; budget: number; external_id?: string | null } | null = null;
  if (pool) {
    try {
      const jobRes = await pool.query('SELECT id, title, description, budget, external_id FROM jobs WHERE id = $1', [jobId]);
      if (jobRes.rows.length > 0) {
        jobData = jobRes.rows[0];
      }
    } catch (err: any) {
      console.warn(`⚠️ [WorkOrder Auto-Sync] Job query notice:`, err.message);
    }
  }

  if (!jobData) {
    const memJob = memoryStore.jobs.get(jobId);
    if (memJob) {
      jobData = {
        id: memJob.id,
        title: memJob.title,
        description: memJob.description,
        budget: memJob.budget,
        external_id: memJob.external_id,
      };
    }
  }

  if (!jobData) {
    console.error(`❌ [WorkOrder Auto-Sync] Job record ${jobId} not found for Work Order: ${workOrderId}`);
    logActivityEvent({
      source: 'WorkOrderSync',
      type: 'WORK_ORDER_FREELANCER_SYNC_FAILED',
      status: 'error',
      summary: `Failed to auto-sync Work Order ${workOrderId}: Job ${jobId} not found in database.`,
      tags: ['work_order', 'freelancer_api', 'error', workOrderId],
    });
    return { success: false, error: `Job record ${jobId} not found` };
  }

  // 3. If job already has an external_id, confirm sync status and return
  if (jobData.external_id) {
    console.log(`ℹ️ [WorkOrder Auto-Sync] Work Order ${workOrderId} job ${jobId} already synced with Freelancer ID: ${jobData.external_id}`);
    logActivityEvent({
      source: 'WorkOrderSync',
      type: 'WORK_ORDER_FREELANCER_SYNCED',
      status: 'success',
      summary: `Work Order ${workOrderId} linked to existing Freelancer.com project #${jobData.external_id}`,
      details: { workOrderId, jobId, externalId: jobData.external_id },
      tags: ['work_order', 'freelancer_api', 'sync_confirmed', workOrderId],
    });
    return { success: true, externalId: jobData.external_id };
  }

  // 4. Call Freelancer API to create matching project
  try {
    console.log(`📡 [WorkOrder Auto-Sync] Calling Freelancer.com API for Work Order "${workOrderId}" (Job: "${jobData.title}")...`);
    const syncResult = await createFreelancerProject({
      title: jobData.title,
      description: jobData.description,
      budget: Number(jobData.budget),
    });

    if (syncResult.success && syncResult.projectId) {
      const externalId = syncResult.projectId;

      // Update external_id in Postgres
      if (pool) {
        try {
          await pool.query('UPDATE jobs SET external_id = $1 WHERE id = $2', [externalId, jobId]);
        } catch (err: any) {
          console.warn(`⚠️ [WorkOrder Auto-Sync] Postgres update notice:`, err.message);
        }
      }

      // Update external_id in Memory Store
      const memJob = memoryStore.jobs.get(jobId);
      if (memJob) {
        memJob.external_id = externalId;
        memoryStore.jobs.set(jobId, memJob);
      }

      // Log success status
      logActivityEvent({
        source: 'WorkOrderSync',
        type: 'WORK_ORDER_FREELANCER_SYNCED',
        status: 'success',
        summary: `Work Order ${workOrderId} auto-synced to Freelancer.com project #${externalId} (Job: "${jobData.title}")`,
        details: {
          workOrderId,
          jobId,
          externalId,
          projectUrl: syncResult.url,
          budget: jobData.budget,
        },
        tags: ['work_order', 'freelancer_api', 'auto_sync', 'sync_success', workOrderId],
      });

      console.log(`✅ [WorkOrder Auto-Sync] Work Order ${workOrderId} successfully auto-synced! Freelancer project ID: ${externalId}`);
      return { success: true, externalId };
    } else {
      const errorMsg = syncResult.error || 'Freelancer API creation failed';
      console.warn(`⚠️ [WorkOrder Auto-Sync] Freelancer API call failed for Work Order ${workOrderId}: ${errorMsg}. Enqueuing in Bull retry queue.`);

      // Log failure status
      logActivityEvent({
        source: 'WorkOrderSync',
        type: 'WORK_ORDER_FREELANCER_SYNC_FAILED',
        status: 'error',
        summary: `Work Order ${workOrderId} Freelancer API sync failed: ${errorMsg}. Enqueued to Bull retry queue.`,
        details: { workOrderId, jobId, error: errorMsg },
        tags: ['work_order', 'freelancer_api', 'sync_failed', 'retry_enqueued', workOrderId],
      });

      // Enqueue job in Bull retry queue
      await enqueueFreelancerJobSync(jobId);

      return { success: false, error: errorMsg, enqueued: true };
    }
  } catch (err: any) {
    const errorMsg = err.message || 'Unexpected background sync error';
    console.error(`❌ [WorkOrder Auto-Sync] Exception during auto-sync for Work Order ${workOrderId}:`, errorMsg);

    logActivityEvent({
      source: 'WorkOrderSync',
      type: 'WORK_ORDER_FREELANCER_SYNC_FAILED',
      status: 'error',
      summary: `Work Order ${workOrderId} auto-sync exception: ${errorMsg}. Enqueued to Bull retry queue.`,
      details: { workOrderId, jobId, error: errorMsg },
      tags: ['work_order', 'freelancer_api', 'sync_failed', 'retry_enqueued', workOrderId],
    });

    await enqueueFreelancerJobSync(jobId);

    return { success: false, error: errorMsg, enqueued: true };
  }
}

/**
 * Self-healing scanner: Finds all jobs with missing external_id and enqueues them
 */
export async function scanAndRetryMissingExternalJobs(): Promise<{
  scannedCount: number;
  fixedCount: number;
  missingJobIds: string[];
}> {
  const pool = getPgPool();
  const missingJobIds: string[] = [];

  if (pool) {
    try {
      const res = await pool.query('SELECT id FROM jobs WHERE external_id IS NULL OR external_id = \'\'');
      for (const row of res.rows) {
        missingJobIds.push(row.id);
      }
    } catch (err: any) {
      console.warn('⚠️ [Scan Missing External Jobs] Postgres query notice:', err.message);
    }
  }

  // Also check memory store
  for (const [id, job] of memoryStore.jobs.entries()) {
    if (!job.external_id && !missingJobIds.includes(id)) {
      missingJobIds.push(id);
    }
  }

  let fixedCount = 0;
  for (const id of missingJobIds) {
    await enqueueFreelancerJobSync(id);
    fixedCount++;
  }

  return {
    scannedCount: missingJobIds.length,
    fixedCount,
    missingJobIds,
  };
}
