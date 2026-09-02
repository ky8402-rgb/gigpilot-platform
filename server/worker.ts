import cron from 'node-cron';
import { fetchLivePlatformJobs } from './platformIntegrations.js';
import { syncLiveJobsToPostgres, prisma } from './db.js';
import { logActivityEvent } from './activityLogger.js';
import { getGeminiAI } from './gemini.js';
import { clearBidsCache } from './redisCache.js';
import { runSelfHealingDiagnostics } from './retryWorker.js';
import { scanAndRetryMissingExternalJobs } from './freelancerRetryQueue.js';
import { recordCronHeartbeat } from './healthCheck.js';

console.log('🚀 [GigPilot Background Worker] Initialized and running...');

/**
 * Auto-bidding & AI Draft generator for top tier matching opportunities
 */
async function processAutoDraftProposals(jobs: any[]) {
  const highValueJobs = jobs.filter((j) => {
    const title = (j.title || '').toLowerCase();
    return (
      title.includes('full stack') ||
      title.includes('ai') ||
      title.includes('react') ||
      title.includes('typescript') ||
      title.includes('backend') ||
      title.includes('node')
    );
  }).slice(0, 5);

  const ai = getGeminiAI();

  for (const job of highValueJobs) {
    try {
      let draftCoverLetter = '';
      if (ai) {
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-3.7-flash',
            contents: `You are an elite senior full-stack engineer and AI specialist. Write a concise, compelling, 3-paragraph proposal for the following freelance project:
Job Title: ${job.title}
Job Description: ${job.description || job.title}
Client: ${job.company || 'Client'}

Structure:
1. Strong hook proving direct technical domain competence.
2. Architecture solution & milestone plan.
3. Call to action offering immediate discovery/call.`
          });
          draftCoverLetter = response.text || '';
        } catch {
          // Graceful fallback to deterministic template when external Gemini API is unreachable or rate limited
        }
      }

      if (!draftCoverLetter) {
        draftCoverLetter = `Hello ${job.company || 'Hiring Manager'},\n\nI reviewed your requirements for "${job.title}" and have extensive hands-on experience building resilient full-stack systems and high-throughput automations with React, Node.js, and TypeScript.\n\nI can deliver this project with pristine test coverage, fast milestone execution, and high performance.\n\nBest regards,\nKundan Kumar | Senior Solutions Engineer`;
      }

      // Check if proposal or bid record already exists
      if (prisma && (prisma as any).bid) {
        const bidId = `autodraft_${job.id || Date.now().toString(36)}`;
        await (prisma as any).bid.upsert({
          where: { id: bidId },
          update: {
            jobTitle: job.title,
            company: job.company || 'Verified Client',
            notes: `[AI Auto-Draft Proposal]\n${draftCoverLetter}`,
            jobUrl: job.url || job.sourceUrl || 'https://remoteok.com',
          },
          create: {
            id: bidId,
            jobTitle: job.title,
            company: job.company || 'Verified Client',
            platform: job.platform || 'remoteok',
            amount: 499,
            status: 'pending',
            workStatus: 'Not Started',
            notes: `[AI Auto-Draft Proposal]\n${draftCoverLetter}`,
            jobUrl: job.url || job.sourceUrl || 'https://remoteok.com',
            estimatedDays: 7,
          }
        }).catch(() => {});
      }
    } catch (err: any) {
      console.warn(`[Worker Auto-Draft] Error processing job ${job.id}:`, err.message);
    }
  }
}

/**
 * Core Hourly Sync Worker Routine
 */
export async function runWorkerCycle() {
  const startTime = Date.now();
  console.log('[Worker] Executing scheduled automated feed sync & auto-bidding cycle...');

  try {
    const { jobs, source, platformsChecked } = await fetchLivePlatformJobs('');
    const dbSyncedCount = await syncLiveJobsToPostgres(jobs);
    
    // Process auto-draft proposals for high-value leads
    await processAutoDraftProposals(jobs);

    // Invalidate stale caches so live dashboard gets the fresh dataset
    await clearBidsCache();

    const latencyMs = Date.now() - startTime;
    console.log(`[Worker] Cycle complete: ${jobs.length} jobs retrieved, ${dbSyncedCount} synced to PostgreSQL in ${latencyMs}ms across [${platformsChecked.join(', ')}]`);

    logActivityEvent({
      source: 'WorkerProcess',
      type: 'FEED_SYNC',
      status: 'success',
      method: 'INTERNAL',
      endpoint: 'WORKER:0 * * * *',
      statusCode: 200,
      latencyMs,
      summary: `Background worker completed opportunity discovery and auto-drafting for ${jobs.length} opportunities`,
      tags: ['worker', 'cron', 'auto-bidding', 'ai-proposals']
    });

    return { success: true, count: jobs.length, dbSynced: dbSyncedCount };
  } catch (err: any) {
    console.error('[Worker] Cycle execution failed:', err.message);
    return { success: false, error: err.message };
  }
}

// Scheduled hourly execution
cron.schedule('0 * * * *', () => {
  console.log('[Worker] Cron trigger (0 * * * *) received');
  runWorkerCycle();
});

// Self-healing check & missing external jobs retry every 30 seconds
cron.schedule('*/30 * * * * *', async () => {
  try {
    recordCronHeartbeat('auto_completion_worker_30s');
    await runSelfHealingDiagnostics();
    await scanAndRetryMissingExternalJobs();
  } catch (e: any) {
    console.warn('[Worker] Self-healing cycle error:', e.message);
  }
});

// Startup trigger
setTimeout(() => {
  console.log('[Worker] Initial startup sync trigger...');
  runWorkerCycle();
}, 2000);
