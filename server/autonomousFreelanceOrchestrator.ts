import { prisma } from './db.js';
import { executeWorkOrderDeliverable } from './workExecutionEngine.js';
import { getPlatformStatus } from './platformIntegrations.js';
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

  // Deliberately explicit: no invented provider acceptance or delivery.
  blockers.push('Freelancer award/acceptance tracking is not yet backed by an official webhook/polling contract.');
  blockers.push('Marketplace file/message delivery is not yet backed by an official provider delivery API.');
  
  return {
    ready: blockers.length === 0,
    blockers,
    capabilities: {
      liveMarketplaceFeed: true,
      realBidSubmission: status.freelancer.tokenConfigured,
      contractAcceptanceTracking: false,
      autonomousExecution: status.autonomous.executionEnabled,
      realClientDelivery: false,
      realPayout: status.paypal.connected,
    }
  };
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
