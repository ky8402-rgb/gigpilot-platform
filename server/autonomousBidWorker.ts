import { prisma } from './db.js';
import { fetchLivePlatformJobs, submitPlatformBid, type NormalizedWorkOrder } from './platformIntegrations.js';
import { checkHardExcludeFilter } from './autoBidFilters.js';
import { logActivityEvent } from './activityLogger.js';

const MAX_BIDS_PER_CYCLE = Math.max(1, Math.min(Number(process.env.AUTONOMOUS_MAX_BIDS_PER_CYCLE || 3), 10));
const MIN_BID_INTERVAL_MS = Math.max(5000, Number(process.env.AUTONOMOUS_MIN_BID_INTERVAL_MS || 12000));

function buildCoverLetter(job: NormalizedWorkOrder, bidAmount: number, deliveryDays: number): string {
  const skills = (job.skills || []).slice(0, 6).join(', ');
  return [
    'Hello,',
    '',
    `I can handle “${job.title}” as a focused, verifiable deliverable.`,
    skills ? `Relevant skills: ${skills}.` : 'I will work directly against the requirements in the project description.',
    `Proposed delivery: ${deliveryDays} day${deliveryDays === 1 ? '' : 's'}, with a working result and verification notes before handoff.`,
    `Proposed bid: $${bidAmount.toFixed(2)} USD.`,
    '',
    'I will keep the implementation scoped to the posted requirements and provide the final artifacts through the marketplace workflow.',
    '',
    'Regards,',
    'GigPilot'
  ].join('\n');
}

function scoreJob(job: NormalizedWorkOrder): number {
  const text = `${job.title} ${job.description || ''} ${(job.skills || []).join(' ')}`.toLowerCase();
  const keywordHits = ['python','javascript','typescript','scraping','data','automation','api','pdf','excel','seo','transcription','translation']
    .reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
  const budget = Math.max(0, Number(job.salaryMax || job.amount || 0));
  return keywordHits * 10 + Math.min(40, budget / 25);
}

export async function runAutonomousBidCycle(): Promise<{
  enabled: boolean;
  scanned: number;
  submitted: number;
  skipped: number;
  errors: number;
  results: Array<Record<string, unknown>>;
}> {
  const enabled = process.env.AUTONOMOUS_BIDDING_ENABLED === 'true';
  if (!enabled) return { enabled: false, scanned: 0, submitted: 0, skipped: 0, errors: 0, results: [] };

  const token = String(process.env.FREELANCER_ACCESS_TOKEN || process.env.FREELANCER_API_KEY || process.env.FREELANCER_OAUTH_TOKEN || '').trim();
  if (!token) {
    return { enabled: true, scanned: 0, submitted: 0, skipped: 0, errors: 1, results: [{ error: 'FREELANCER_NOT_CONFIGURED' }] };
  }

  const { jobs } = await fetchLivePlatformJobs('');
  const candidates = jobs
    .filter((job) => job.platform === 'Freelancer')
    .filter((job) => checkHardExcludeFilter({ title: job.title, description: job.description || '' }).shouldSkip === false)
    .filter((job) => Number(job.externalId || job.id))
    .sort((a, b) => scoreJob(b) - scoreJob(a))
    .slice(0, MAX_BIDS_PER_CYCLE);

  let submitted = 0;
  let skipped = 0;
  let errors = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const job of candidates) {
    const projectId = String(job.externalId || job.id);
    try {
      const existing = await prisma.workOrder.findFirst({
        where: {
          externalProvider: 'Freelancer',
          externalProjectId: projectId,
        },
        select: { id: true, externalBidId: true, externalAcceptanceVerified: true }
      });
      if (existing) {
        skipped += 1;
        results.push({ projectId, skipped: true, reason: existing.externalAcceptanceVerified ? 'ALREADY_ACCEPTED' : 'ALREADY_BIDDED', workOrderId: existing.id });
        continue;
      }

      const ceiling = Number(job.salaryMax || job.amount || 0);
      if (!Number.isFinite(ceiling) || ceiling <= 0) {
        skipped += 1;
        results.push({ projectId, skipped: true, reason: 'NO_VERIFIABLE_BUDGET' });
        continue;
      }

      const bidAmount = Math.max(10, Math.round(ceiling * Math.min(1, Number(process.env.AUTONOMOUS_BID_RATIO || 0.9))));
      const deliveryDays = Math.max(1, Math.min(14, Number(process.env.AUTONOMOUS_DEFAULT_DELIVERY_DAYS || 5)));
      const proposal = buildCoverLetter(job, bidAmount, deliveryDays);
      const result = await submitPlatformBid(job.id, {
        bidAmount,
        deliveryDays,
        coverLetter: proposal,
        milestones: [{ title: 'Complete and verify deliverable', amount: bidAmount }]
      });

      if (result.success && result.externalBidId) {
        submitted += 1;
        results.push({ projectId, externalBidId: result.externalBidId, bidAmount, success: true });
        logActivityEvent({
          source: 'AutonomousBidWorker',
          type: 'BID_SUBMITTED',
          status: 'success',
          summary: `Provider-confirmed Freelancer bid submitted for project ${projectId} at $${bidAmount.toFixed(2)}.`,
          tags: ['autonomous_bidding', 'freelancer', 'provider_confirmed']
        });
      } else {
        errors += 1;
        results.push({ projectId, success: false, error: result.error || result.message });
      }
    } catch (error: any) {
      errors += 1;
      results.push({ projectId, success: false, error: error?.message || 'BID_CYCLE_ERROR' });
    }

    await new Promise((resolve) => setTimeout(resolve, MIN_BID_INTERVAL_MS));
  }

  return { enabled: true, scanned: jobs.filter((j) => j.platform === 'Freelancer').length, submitted, skipped, errors, results };
}
