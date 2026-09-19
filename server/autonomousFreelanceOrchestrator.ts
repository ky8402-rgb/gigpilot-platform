import { prisma } from './db.js';
import { executeWorkOrderDeliverable } from './workExecutionEngine.js';
import { getPlatformStatus } from './platformIntegrations.js';
import { getFreelancerBidStatus } from './freelancerService.js';
import { logActivityEvent } from './activityLogger.js';

export interface AutonomousReadiness {
  ready: boolean;
  blockers: string[];
  capabilities: {
    liveMarketplaceFeed: boolean;
    realBidSubmission: boolean;
    contractAcceptanceTracking: boolean;
    autonomousExecution: boolean;
    realClientDelivery: boolean;
    realPayout: boolean;
  };
}

/**
 * Reports the actual state of the full freelance loop.
 * A configured credential is not treated as a successful provider transaction.
 */
export function getAutonomousReadiness(): AutonomousReadiness {
  const status = getPlatformStatus();
  const blockers: string[] = [];

  if (!status.freelancer.tokenConfigured) {
    blockers.push('FREELANCER_ACCESS_TOKEN/FREELANCER_API_KEY is not configured.');
  }
  if (!status.autonomous.biddingEnabled) {
    blockers.push('AUTONOMOUS_BIDDING_ENABLED is false.');
  }
  if (!status.autonomous.executionEnabled) {
    blockers.push('AUTONOMOUS_EXECUTION_ENABLED is false.');
  }
  if (!status.paypal.connected) {
    blockers.push('PayPal client credentials are not configured for real settlement.');
  }

  // Acceptance is now polled from the provider's bid resource. Delivery remains
  // intentionally fail-closed until an official delivery contract is wired.
  blockers.push('Marketplace file/message delivery is not yet backed by a verified provider delivery adapter.');
  
  return {
    ready: blockers.length === 0,
    blockers,
    capabilities: {
      liveMarketplaceFeed: true,
      realBidSubmission: status.freelancer.tokenConfigured,
      contractAcceptanceTracking: status.freelancer.tokenConfigured,
      autonomousExecution: status.autonomous.executionEnabled,
      realClientDelivery: false,
      realPayout: status.paypal.connected,
    }
  };
}

/**
 * Poll submitted Freelancer bids and persist only provider-confirmed awards.
 * This does not create a WorkOrder or funding record by itself.
 */
export async function syncFreelancerContractAcceptances(): Promise<{ scanned: number; accepted: number; errors: number }> {
  const candidates = await prisma.workOrder.findMany({
    where: {
      externalProvider: { equals: 'Freelancer', mode: 'insensitive' },
      externalBidId: { not: null },
      externalAcceptanceVerified: false,
    },
    select: { id: true, externalBidId: true, externalProjectId: true },
    take: 25,
  });
  let accepted = 0;
  let errors = 0;
  for (const order of candidates) {
    try {
      const status = await getFreelancerBidStatus(String(order.externalBidId));
      if (!status.success) { errors += 1; continue; }
      const awarded = String(status.awardStatus || '').toLowerCase() === 'awarded';
      const projectAwarded = String(status.raw?.project?.status || '').toLowerCase() === 'awarded';
      if (!awarded && !projectAwarded) continue;
      await prisma.workOrder.update({
        where: { id: order.id },
        data: {
          externalAcceptanceVerified: true,
          externalAcceptedAt: new Date(),
          status: 'PENDING',
          ...(status.projectId ? { externalProjectId: status.projectId } : {}),
        },
      });
      accepted += 1;
      logActivityEvent({
        source: 'FreelancerAcceptanceSync',
        type: 'CONTRACT_ACCEPTED',
        status: 'success',
        summary: `Freelancer provider confirmed award for bid ${order.externalBidId}.`,
        tags: ['freelancer', 'award', 'provider_confirmed'],
      });
    } catch (err: any) {
      errors += 1;
      console.warn('[FreelancerAcceptanceSync] Order sync failed:', order.id, err?.message || err);
    }
  }
  return { scanned: candidates.length, accepted, errors };
}

/**
 * Execute only provider-confirmed AND funded contracts.
 * Public job listings and merely-submitted proposals can never enter this path.
 */
export async function runAutonomousContractorCycle(maxJobs = 3) {
  if (process.env.AUTONOMOUS_EXECUTION_ENABLED !== 'true') {
    return { success: false, processed: 0, results: [], error: 'AUTONOMOUS_EXECUTION_DISABLED' };
  }

  const orders = await prisma.workOrder.findMany({
    where: {
      externalAcceptanceVerified: true,
      escrowStatus: 'FUNDED',
      status: { in: ['IN_PROGRESS', 'PENDING'] },
      deliveryStatus: { in: ['NOT_READY', 'FAILED_RETRYABLE'] }
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, Math.min(maxJobs, 10))
  });

  const results: any[] = [];
  for (const order of orders) {
    try {
      const deliverable = await executeWorkOrderDeliverable({
        orderId: order.id,
        title: order.title,
        description: order.description || '',
        category: 'Marketplace Contract',
        tags: [order.platform, order.externalProvider || 'provider-confirmed'],
        budget: order.amount
      });

      await prisma.workOrder.update({
        where: { id: order.id },
        data: {
          status: 'IN_PROGRESS',
          deliveryStatus: 'READY_FOR_PROVIDER_DELIVERY',
          deliverableChecksum: deliverable.checksum,
          deliverables: deliverable.summary
        }
      });

      results.push({
        orderId: order.id,
        title: order.title,
        deliveryStatus: 'READY_FOR_PROVIDER_DELIVERY',
        checksum: deliverable.checksum,
        files: deliverable.files.length
      });

      logActivityEvent({
        source: 'AutonomousFreelanceOrchestrator',
        type: 'WORK_READY_FOR_PROVIDER_DELIVERY',
        status: 'success',
        summary: 'Provider-confirmed work order ' + order.id + ' executed; deliverable is ready for the configured provider delivery adapter.',
        tags: ['autonomous_freelance', 'execution', order.platform]
      });
    } catch (err: any) {
      await prisma.workOrder.update({
        where: { id: order.id },
        data: { deliveryStatus: 'FAILED_RETRYABLE' }
      }).catch(() => undefined);
      results.push({
        orderId: order.id,
        title: order.title,
        deliveryStatus: 'FAILED_RETRYABLE',
        error: err.message
      });
    }
  }

  return { success: true, processed: results.length, results };
}
