import { prisma } from './db.js';
import { executeWorkOrderDeliverable } from './workExecutionEngine.js';
import { getPlatformStatus } from './platformIntegrations.js';
import { getFreelancerBidStatus, deliverFreelancerWorkPackage } from './freelancerService.js';
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

  // Acceptance and delivery adapters are provider-backed. Execution is still gated
  // on real acceptance + real funding, and settlement on real provider confirmation.
  return {
    ready: blockers.length === 0,
    blockers,
    capabilities: {
      liveMarketplaceFeed: true,
      realBidSubmission: status.freelancer.tokenConfigured,
      contractAcceptanceTracking: status.freelancer.tokenConfigured,
      autonomousExecution: status.autonomous.executionEnabled,
      realClientDelivery: status.freelancer.tokenConfigured,
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

      let deliveryStatus = 'READY_FOR_PROVIDER_DELIVERY';
      let deliveryError: string | undefined;

      if (String(order.externalProvider || '').toLowerCase() === 'freelancer' && order.externalProjectId) {
        const delivery = await deliverFreelancerWorkPackage({
          projectId: order.externalProjectId,
          message: deliverable.clientHandoverNote + `\\n\\nDelivery checksum: ${deliverable.checksum}`,
          files: deliverable.files.map((file) => ({ filename: file.filename, content: file.content })),
        });
        if (delivery.success) {
          deliveryStatus = 'PROVIDER_DELIVERED';
          logActivityEvent({
            source: 'FreelancerDeliveryAdapter',
            type: 'WORK_DELIVERED',
            status: 'success',
            summary: `Work order ${order.id} delivered through Freelancer project messaging with ${delivery.uploadedFiles} attachments.`,
            tags: ['freelancer', 'delivery', 'provider_confirmed'],
          });
        } else {
          deliveryError = delivery.error;
        }
      }

      await prisma.workOrder.update({
        where: { id: order.id },
        data: {
          status: 'IN_PROGRESS',
          deliveryStatus,
          deliverableChecksum: deliverable.checksum,
          deliverables: deliverable.summary
        }
      });

      results.push({
        orderId: order.id,
        title: order.title,
        deliveryStatus,
        checksum: deliverable.checksum,
        files: deliverable.files.length,
        ...(deliveryError ? { error: deliveryError } : {})
      });

      logActivityEvent({
        source: 'AutonomousFreelanceOrchestrator',
        type: deliveryStatus === 'PROVIDER_DELIVERED' ? 'WORK_DELIVERED' : 'WORK_READY_FOR_PROVIDER_DELIVERY',
        status: deliveryStatus === 'PROVIDER_DELIVERED' ? 'success' : 'warning',
        summary: deliveryStatus === 'PROVIDER_DELIVERED'
          ? 'Provider-confirmed work order ' + order.id + ' was executed and delivered through the marketplace.'
          : 'Provider-confirmed work order ' + order.id + ' executed; provider delivery is still pending.',
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
