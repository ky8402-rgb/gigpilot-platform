import crypto from 'crypto';
import { prisma, isDatabaseConfigured } from './db.js';
import {
  createPayPalPayout,
  getPayPalPayoutBatch,
  isPayPalConfigured
} from './paypal.js';

export type SettlementProvider = 'paypal' | 'payoneer';

function requireDatabase() {
  if (!isDatabaseConfigured) {
    throw new Error('DATABASE_REQUIRED: Funded work orders and settlement ledger require PostgreSQL.');
  }
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function recordVerifiedPayPalFunding(event: any) {
  requireDatabase();

  const eventId = String(event?.id || '').trim();
  const eventType = String(event?.event_type || '').trim();
  if (!eventId || !eventType) throw new Error('PAYPAL_WEBHOOK_INVALID: event id and type are required.');

  const resource = event?.resource || {};
  if (eventType !== 'PAYMENT.CAPTURE.COMPLETED' && eventType !== 'CHECKOUT.ORDER.COMPLETED') {
    return { processed: false, reason: 'EVENT_NOT_A_FUNDED_CAPTURE' };
  }

  const orderId = String(
    resource?.supplementary_data?.related_ids?.order_id ||
    resource?.id ||
    ''
  ).trim();

  const captureId = eventType === 'PAYMENT.CAPTURE.COMPLETED'
    ? String(resource?.id || '').trim()
    : String(resource?.purchase_units?.[0]?.payments?.captures?.[0]?.id || '').trim();

  const amountValue = eventType === 'PAYMENT.CAPTURE.COMPLETED'
    ? resource?.amount?.value
    : resource?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value;

  const currency = eventType === 'PAYMENT.CAPTURE.COMPLETED'
    ? resource?.amount?.currency_code
    : resource?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.currency_code;

  const amount = Number(amountValue);
  if (!orderId || !captureId || !Number.isFinite(amount) || amount <= 0 || !currency) {
    throw new Error('PAYPAL_WEBHOOK_INVALID: completed capture must contain order id, capture id, amount and currency.');
  }

  const payer = resource?.payer || {};
  const clientName = payer?.name
    ? [payer.name.given_name, payer.name.surname].filter(Boolean).join(' ')
    : undefined;
  const clientEmail = payer?.email_address || undefined;

  const existingEvent = await prisma.paymentWebhookEvent.findUnique({ where: { eventId } });
  if (existingEvent) return { processed: false, reason: 'DUPLICATE_EVENT', workOrderId: undefined };

  const result = await prisma.$transaction(async (tx: any) => {
    await tx.paymentWebhookEvent.create({
      data: {
        provider: 'paypal',
        eventId,
        eventType,
        payload: event,
        status: 'PROCESSING'
      }
    });

    const workOrder = await tx.workOrder.upsert({
      where: { paypalOrderId: orderId },
      update: {
        amount,
        currency,
        paypalCaptureId: captureId,
        fundedAt: new Date(),
        fundingProvider: 'paypal',
        fundingProviderTransactionId: captureId,
        escrowStatus: 'FUNDED',
        status: 'IN_PROGRESS',
        ...(clientName ? { clientName } : {}),
        ...(clientEmail ? { clientEmail } : {})
      },
      create: {
        title: `Funded PayPal Work Order ${orderId}`,
        clientName: clientName || 'PayPal Client',
        clientEmail,
        amount,
        currency,
        status: 'IN_PROGRESS',
        platform: 'DIRECT_PAYPAL',
        paypalOrderId: orderId,
        paypalCaptureId: captureId,
        description: 'Created only from a PayPal provider-confirmed completed capture.',
        fundedAt: new Date(),
        fundingProvider: 'paypal',
        fundingProviderTransactionId: captureId,
        escrowStatus: 'FUNDED',
        milestoneStatus: 'PENDING_APPROVAL',
        startDate: new Date()
      }
    });

    const milestone = await tx.escrowMilestone.findFirst({
      where: { workOrderId: workOrder.id, status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' }
    });

    if (!milestone) {
      await tx.escrowMilestone.create({
        data: {
          workOrderId: workOrder.id,
          amount,
          currency,
          status: 'PENDING_APPROVAL'
        }
      });
    }

    await tx.paymentWebhookEvent.update({
      where: { eventId },
      data: { status: 'PROCESSED', processedAt: new Date() }
    });

    return { workOrderId: workOrder.id };
  });

  return { processed: true, ...result };
}

export async function createMilestoneApprovalToken(workOrderId: string, amount?: number) {
  requireDatabase();
  const token = crypto.randomBytes(32).toString('base64url');

  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (!workOrder || workOrder.escrowStatus !== 'FUNDED') {
    throw new Error('WORK_ORDER_NOT_FUNDED: A milestone can only be created for a provider-funded work order.');
  }

  const milestone = await prisma.escrowMilestone.create({
    data: {
      workOrderId,
      amount: amount && amount > 0 ? amount : workOrder.amount,
      currency: workOrder.currency,
      status: 'PENDING_APPROVAL',
      approvalTokenHash: hashToken(token)
    }
  });

  return {
    milestoneId: milestone.id,
    approvalToken: token,
    amount: milestone.amount,
    currency: milestone.currency,
    warning: 'Return this token to the client through an authenticated client channel. It is shown only once.'
  };
}

export async function approveMilestone(workOrderId: string, milestoneId: string, approvalToken: string, deliverableChecksum?: string) {
  requireDatabase();
  if (!approvalToken || approvalToken.length < 32) {
    throw new Error('CLIENT_APPROVAL_REQUIRED: A valid client approval token is required.');
  }

  const tokenHash = hashToken(approvalToken);

  const result = await prisma.$transaction(async (tx: any) => {
    const milestone = await tx.escrowMilestone.findUnique({ where: { id: milestoneId } });
    if (!milestone || milestone.workOrderId !== workOrderId) throw new Error('MILESTONE_NOT_FOUND');
    if (milestone.status === 'APPROVED' || milestone.status === 'RELEASING' || milestone.status === 'SETTLED') {
      return milestone;
    }
    if (milestone.status !== 'PENDING_APPROVAL' || milestone.approvalTokenHash !== tokenHash) {
      throw new Error('CLIENT_APPROVAL_INVALID');
    }

    const order = await tx.workOrder.findUnique({ where: { id: workOrderId } });
    if (!order || order.escrowStatus !== 'FUNDED') throw new Error('ESCROW_NOT_FUNDED');

    const updated = await tx.escrowMilestone.update({
      where: { id: milestoneId },
      data: {
        status: 'APPROVED',
        approvalTokenHash: null,
        approvedAt: new Date(),
        deliverableChecksum
      }
    });

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        clientApprovedAt: new Date(),
        milestoneStatus: 'APPROVED',
        escrowStatus: 'RELEASE_PENDING'
      }
    });

    return updated;
  });

  return result;
}

export async function releaseApprovedMilestone(
  workOrderId: string,
  milestoneId: string,
  provider: SettlementProvider,
  receiverEmail: string
) {
  requireDatabase();
  if (!receiverEmail) throw new Error('SETTLEMENT_DESTINATION_REQUIRED');

  const reservationKey = `escrow:${workOrderId}:${milestoneId}`;
  const reserved = await prisma.$transaction(async (tx: any) => {
    const milestone = await tx.escrowMilestone.findUnique({ where: { id: milestoneId } });
    if (!milestone || milestone.workOrderId !== workOrderId) throw new Error('MILESTONE_NOT_FOUND');
    if (milestone.status !== 'APPROVED') {
      if (milestone.status === 'SETTLED') return { alreadySettled: true, milestone };
      throw new Error('MILESTONE_NOT_APPROVED');
    }

    const order = await tx.workOrder.findUnique({ where: { id: workOrderId } });
    if (!order || order.escrowStatus !== 'RELEASE_PENDING') throw new Error('ESCROW_NOT_RELEASEABLE');

    await tx.escrowMilestone.update({
      where: { id: milestoneId },
      data: { status: 'RELEASING' }
    });

    return {
      alreadySettled: false,
      milestone,
      order
    };
  });

  if (reserved.alreadySettled) return { status: 'SETTLED', providerTransactionId: null };

  if (provider !== 'paypal') {
    throw new Error('PAYONEER_PROVIDER_NOT_CONFIGURED: Configure an official Payoneer payout API contract before enabling this provider.');
  }
  if (!isPayPalConfigured()) throw new Error('PAYPAL_NOT_CONFIGURED');

  const payout = await createPayPalPayout({
    receiverEmail,
    amount: reserved.milestone.amount,
    currency: reserved.milestone.currency,
    note: `GigPilot approved milestone ${milestoneId}`
  });

  const confirmation = await getPayPalPayoutBatch(payout.payoutBatchId);
  const successfulItem = confirmation.items?.find((item: any) =>
    item.transactionStatus === 'SUCCESS' &&
    item.transactionId
  );

  if (!successfulItem) {
    await prisma.escrowMilestone.update({
      where: { id: milestoneId },
      data: { status: 'APPROVED' }
    });
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: { escrowStatus: 'RELEASE_PENDING' }
    });
    return {
      status: 'PROVIDER_PENDING',
      providerBatchId: payout.payoutBatchId,
      providerStatus: confirmation.batchStatus || payout.status
    };
  }

  const settled = await prisma.$transaction(async (tx: any) => {
    const ledger = await tx.escrowLedger.upsert({
      where: { idempotencyKey: reservationKey },
      update: {
        state: 'SETTLED',
        providerReference: payout.payoutBatchId,
        providerTransactionId: successfulItem.transactionId,
        updatedAt: new Date()
      },
      create: {
        workOrderId,
        milestoneId,
        provider: 'paypal',
        amount: reserved.milestone.amount,
        currency: reserved.milestone.currency,
        state: 'SETTLED',
        providerReference: payout.payoutBatchId,
        providerTransactionId: successfulItem.transactionId,
        idempotencyKey: reservationKey
      }
    });

    await tx.escrowMilestone.update({
      where: { id: milestoneId },
      data: { status: 'SETTLED' }
    });

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        escrowStatus: 'SETTLED',
        milestoneStatus: 'SETTLED',
        status: 'COMPLETED'
      }
    });

    return ledger;
  });

  return {
    status: 'SETTLED',
    provider: 'paypal',
    providerBatchId: payout.payoutBatchId,
    providerTransactionId: settled.providerTransactionId,
    ledgerId: settled.id
  };
}
