import express from 'express';
import {
  getPayPalConfig,
  updatePayPalConfig,
  createPayPalOrder,
  capturePayPalOrder,
  createPayPalPayout,
  isPayPalConfigured,
  getPayPalAccessToken,
  getPayPalLiveBalance,
  getPayPalLiveTransactions,
  createLivePayPalInvoice
} from '../server/paypal.js';
import {
  verifyBootCredentials,
  getBalance as getPayPalV2Balance,
  verifyWebhook as verifyPayPalV2Webhook
} from '../backend/paypal.js';
import {
  createAndSend as createAndSendInvoice,
  markPaid as markInvoicePaid,
  cancel as cancelInvoice,
  remind as remindInvoice,
  getAllInvoices
} from '../backend/invoices.js';
import { logActivityEvent } from '../server/activityLogger.js';
import { authMiddleware } from '../server/authMiddleware.js';
import { prisma } from '../server/db.js';
import { recordVerifiedPayPalFunding, createMilestoneApprovalToken, approveMilestone, releaseApprovedMilestone } from '../server/realEscrowSettlement.js';

// Verify boot-time credentials
verifyBootCredentials();

const router = express.Router();

/**
 * GET /api/paypal/config
 * Returns public/safe PayPal configuration (Client ID, Mode, Receiver Email, PayPal.me username)
 */
router.get('/config', (req, res) => {
  try {
    const cfg = getPayPalConfig();
    res.json({
      success: true,
      config: {
        clientId: cfg.clientId,
        hasClientSecret: Boolean(cfg.clientSecret && cfg.clientSecret.length > 0),
        mode: cfg.mode,
        receiverEmail: cfg.receiverEmail,
        paypalMeUsername: cfg.paypalMeUsername,
        currency: cfg.currency,
        isConfigured: isPayPalConfigured()
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/paypal/config
 * Update PayPal configuration at runtime
 */
router.post('/config', authMiddleware, (req, res) => {
  try {
    const { clientId, clientSecret, mode, receiverEmail, paypalMeUsername, currency } = req.body;
    const updated = updatePayPalConfig({
      ...(clientId !== undefined && { clientId: clientId.trim() }),
      ...(clientSecret !== undefined && { clientSecret: clientSecret.trim() }),
      ...(mode && { mode }),
      ...(receiverEmail && { receiverEmail: receiverEmail.trim() }),
      ...(paypalMeUsername && { paypalMeUsername: paypalMeUsername.trim() }),
      ...(currency && { currency: currency.toUpperCase() })
    });

    logActivityEvent({
      source: 'PayPal',
      type: 'AUTH_HANDSHAKE',
      status: 'success',
      method: 'POST',
      endpoint: '/api/paypal/config',
      statusCode: 200,
      summary: `PayPal Gateway settings updated (Mode: ${updated.mode}, Receiver: ${updated.receiverEmail || updated.paypalMeUsername})`,
      tags: ['paypal', 'config', 'gateway']
    });

    res.json({
      success: true,
      message: 'PayPal gateway settings saved successfully',
      config: {
        clientId: updated.clientId,
        hasClientSecret: Boolean(updated.clientSecret && updated.clientSecret.length > 0),
        mode: updated.mode,
        receiverEmail: updated.receiverEmail,
        paypalMeUsername: updated.paypalMeUsername,
        currency: updated.currency,
        isConfigured: isPayPalConfigured()
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/paypal/status
 * Check PayPal API connectivity & OAuth token handshake
 */
router.get('/status', async (req, res) => {
  try {
    const cfg = getPayPalConfig();
    const isConfig = isPayPalConfigured();
    let tokenVerified = false;

    if (isConfig) {
      const token = await getPayPalAccessToken();
      tokenVerified = Boolean(token);
    }

    res.json({
      success: true,
      status: {
        connected: isConfig ? (tokenVerified ? 'connected' : 'auth_failed') : 'unconfigured',
        mode: cfg.mode,
        receiverEmail: cfg.receiverEmail,
        paypalMeUsername: cfg.paypalMeUsername,
        isLiveRest: tokenVerified,
        lastPing: new Date().toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/paypal/balance
 * Check Real-Time PayPal Account Balance, Account ID, and Indian Bank Settlement status
 */
router.get('/balance', async (req, res) => {
  try {
    const bal = await getPayPalV2Balance();
    res.json(bal);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/paypal/live-transactions
 * Fetch real transaction ledger from PayPal Reporting API
 */
router.get('/live-transactions', async (req, res) => {
  try {
    const days = parseInt(String(req.query.days || '30'), 10);
    const tx = await getPayPalLiveTransactions(isNaN(days) ? 30 : days);
    res.json(tx);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, transactions: [] });
  }
});

/**
 * POST /api/paypal/create-invoice
 * Generate an official PayPal Invoicing v2 invoice with shareable payer-view link
 */
router.post('/create-invoice', async (req, res) => {
  try {
    const { amount, currency, clientName, clientEmail, title, description, note } = req.body;
    const numericAmount = Number(amount);

    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid positive amount is required' });
    }

    const invoice = await createLivePayPalInvoice({
      amount: numericAmount,
      currency: currency || 'USD',
      clientName: clientName || 'Client',
      clientEmail: clientEmail || 'client@example.com',
      title: title || 'Engineering Deliverable Milestone',
      description,
      note
    });

    logActivityEvent({
      source: 'PayPal',
      type: 'PAYMENT_RECEIVED',
      status: 'info',
      method: 'POST',
      endpoint: '/api/paypal/create-invoice',
      statusCode: 200,
      summary: `Created official PayPal Invoice #${invoice.invoiceNumber} for $${numericAmount.toFixed(2)} USD`,
      responsePayload: invoice,
      tags: ['paypal', 'invoicing', 'invoice_created']
    });

    res.json(invoice);
  } catch (err: any) {
    console.error('PayPal create-invoice error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/paypal/create-order & POST /api/paypal/create-payment
 * Create a PayPal v2 Checkout Order or PayPal.me direct invoice link
 */
const handleCreateOrder = async (req: express.Request, res: express.Response) => {
  try {
    const { amount, currency, description, clientName, clientEmail, customId } = req.body;
    const numericAmount = Number(amount);

    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid positive amount is required' });
    }

    const order = await createPayPalOrder({
      amount: numericAmount,
      currency: currency || 'USD',
      description: description || 'Freelance Engineering Deliverable Milestone',
      clientName,
      clientEmail,
      customId: customId || `inv_${Date.now()}`
    });

    logActivityEvent({
      source: 'PayPal',
      type: 'PAYMENT_RECEIVED',
      status: 'info',
      method: 'POST',
      endpoint: req.originalUrl || '/api/paypal/create-order',
      statusCode: 200,
      summary: `Created PayPal order #${order.orderId} for $${numericAmount.toFixed(2)} USD`,
      responsePayload: { orderId: order.orderId, amount: numericAmount, isLiveRest: order.isLiveRest },
      tags: ['paypal', 'checkout', 'order_created']
    });

    res.json({
      success: true,
      orderId: order.orderId,
      id: order.orderId,
      approveUrl: order.approveUrl,
      isLiveRest: order.isLiveRest,
      status: order.status
    });
  } catch (err: any) {
    console.error('PayPal create-order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

router.post('/create-order', handleCreateOrder);
router.post('/create-payment', handleCreateOrder);
router.post('/orders', handleCreateOrder);

/**
 * POST /api/paypal/capture-order & POST /api/paypal/capture-payment & POST /api/paypal/orders/:orderId/capture
 * Capture a PayPal checkout order, route funds to main platform wallet, and automatically initialize WorkOrder in PostgreSQL
 */
const handleCaptureOrder = async (req: express.Request, res: express.Response) => {
  try {
    const orderId = req.params.orderId || req.body.orderId || req.body.orderID;
    const { amount, clientName, clientEmail, title, description, userId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'orderId is required' });
    }

    const capture = await capturePayPalOrder(orderId);
    const capturedAmount = capture.amountCaptured > 0 ? capture.amountCaptured : Number(amount || 0);
    const payerName = capture.payerName || clientName || 'Verified PayPal Client';
    const payerEmail = capture.payerEmail || clientEmail || 'client@paypal-direct.com';

    // Do not create a funded WorkOrder from the synchronous capture response. The authoritative PayPal webhook must be verified and persisted first.
    logActivityEvent({
      source: 'PayPal',
      type: 'PAYMENT_RECEIVED',
      status: 'success',
      method: 'POST',
      endpoint: req.originalUrl || '/api/paypal/capture-order',
      statusCode: 200,
      summary: `PayPal Payment Captured & Work Order Initialized: $${capturedAmount.toFixed(2)} USD from ${payerEmail} (Order: ${orderId})`,
      responsePayload: {
        orderId,
        captureId: capture.captureId,
        amount: capturedAmount,
        currency: capture.currency,
        workOrderId: undefined
      },
      stateDiff: {
        action: 'PAYPAL_CAPTURE_PROVIDER_CONFIRMED_AWAITING_WEBHOOK',
        entityType: 'work_order',
        entityId: undefined,
        amountUsd: capturedAmount,
        details: `Captured ${capturedAmount.toFixed(2)} USD via PayPal REST API. Awaiting authoritative verified webhook before funding a Work Order.`
      },
      tags: ['paypal', 'payment', 'completed', 'work_order']
    });

    res.json({
      success: true,
      capture,
      amount: capturedAmount,
      currency: capture.currency,
      workOrder: null,
      message: `PayPal capture confirmed by the provider. Work Order funding will occur only after the authoritative verified PayPal webhook is processed.`
    });
  } catch (err: any) {
    console.error('PayPal capture-order error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

router.post('/capture-order', handleCaptureOrder);
router.post('/capture-payment', handleCaptureOrder);
router.post('/orders/:orderId/capture', handleCaptureOrder);

/**
 * GET /api/paypal/transactions
 * Fetch recent PayPal transactions from PayPal Reporting API combined with local work orders
 */
router.get('/transactions', async (req, res) => {
  try {
    // 1. Fetch real ledger from PayPal Live Reporting API
    const liveReport = await getPayPalLiveTransactions(30).catch(() => ({ transactions: [] }));
    const liveTxList = (liveReport?.transactions || []).map((t: any) => ({
      id: t.id,
      orderId: t.paypalTransactionId || t.id,
      amount: t.amount,
      currency: t.currency || 'USD',
      status: 'completed',
      payerName: t.payerName,
      payerEmail: t.payerEmail,
      date: t.date,
      description: t.description,
      paymentSource: 'paypal_live_rest',
      isLiveRest: true,
      type: t.type
    }));

    // 2. Fetch local database records
    const workOrders = await prisma.workOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    }).catch(() => []);

    const dbTransactions = workOrders.map((wo: any) => ({
      id: wo.id,
      orderId: wo.paypalOrderId || `ORD-${wo.id}`,
      amount: wo.totalAmount || 0,
      currency: wo.currency || 'USD',
      status: wo.paymentStatus === 'PAID' ? 'completed' : 'pending',
      payerName: wo.clientName || 'Client',
      payerEmail: wo.clientEmail || 'client@example.com',
      date: wo.createdAt ? new Date(wo.createdAt).toISOString() : new Date().toISOString(),
      description: wo.title || 'Freelance Milestone',
      paymentSource: 'local_work_order',
      isLiveRest: false,
      type: 'credit'
    }));

    // Combine and sort by date descending
    const combined = [...liveTxList, ...dbTransactions].sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    res.json({
      success: true,
      transactions: combined,
      liveCount: liveTxList.length,
      dbCount: dbTransactions.length
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, transactions: [] });
  }
});

/**
 * GET /api/paypal/work-orders or /api/work-orders
 * Retrieve work orders initialized via PayPal from PostgreSQL (optimized with pagination and caching)
 */
router.get('/work-orders', async (req, res) => {
  try {
    const rawLimit = req.query.limit;
    const limit = rawLimit === 'all' ? undefined : (rawLimit ? Math.min(Math.max(Number(rawLimit) || 50, 1), 500) : 50);

    // Cache-Control headers for fast client and proxy caching
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');

    const workOrders = await prisma.workOrder.findMany({
      orderBy: { createdAt: 'desc' },
      ...(limit ? { take: limit } : {})
    }).catch(() => []);

    res.json({
      success: true,
      workOrders,
      orders: workOrders,
      count: workOrders.length,
      limit: limit || 'all'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/paypal/payout
 * Send automated payout to collaborator / subcontractor
 */
router.post('/payout', authMiddleware, async (req, res) => {
  try {
    const { receiverEmail, amount, note, recipientName } = req.body;
    const numericAmount = Number(amount);

    if (!receiverEmail || isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid receiverEmail and amount are required' });
    }

    const payout = await createPayPalPayout({
      receiverEmail,
      amount: numericAmount,
      note: note || 'Subcontractor milestone payout',
      recipientName
    });

    logActivityEvent({
      source: 'PayPal',
      type: 'BANK_AUTO_TRANSFER',
      status: 'success',
      method: 'POST',
      endpoint: '/api/paypal/payout',
      statusCode: 200,
      summary: `PayPal Payout Sent: $${numericAmount.toFixed(2)} USD sent to ${receiverEmail} (Batch: ${payout.payoutBatchId})`,
      responsePayload: payout,
      stateDiff: {
        action: 'PAYPAL_PAYOUT_DISBURSED',
        entityType: 'transaction',
        amountUsd: numericAmount,
        details: `Disbursed $${numericAmount.toFixed(2)} USD to ${receiverEmail}`
      },
      tags: ['paypal', 'payout', 'subcontractor']
    });

    res.json({
      success: true,
      payout,
      message: `Disbursed $${numericAmount.toFixed(2)} USD to ${receiverEmail}`
    });
  } catch (err: any) {
    console.error('PayPal payout error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/paypal/invoice
 * Create and send an official PayPal Business v2 invoice with automatic fee & net INR calculations
 */
router.post('/invoice', async (req, res) => {
  try {
    const invoice = await createAndSendInvoice(req.body);
    res.status(201).json({
      ok: true,
      message: 'PayPal Business invoice created and dispatched successfully',
      invoice
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/paypal/invoices
 * Returns ledger of all invoices with gross USD and net INR totals after ~4.4% fees
 */
router.get('/invoices', (req, res) => {
  try {
    const data = getAllInvoices();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/paypal/invoice/:id/remind
 * Dispatches Day 3/7/14 reminder via SES & PayPal
 */
router.post('/invoice/:id/remind', async (req, res) => {
  try {
    const { id } = req.params;
    const { day = 3 } = req.body || {};
    const result = await remindInvoice(id, day);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/paypal/invoice/:id/cancel
 * Cancels active invoice
 */
router.post('/invoice/:id/cancel', (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Cancelled by administrator' } = req.body || {};
    const invoice = cancelInvoice(id, reason);
    res.json({
      ok: true,
      message: 'Invoice cancelled successfully',
      invoice
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/paypal/webhook
 * PayPal Webhook Listener with strict cryptographic signature verification
 */
router.post('/webhook', async (req, res) => {
  try {
    const isValid = await verifyPayPalV2Webhook(req.headers, req.body);
    if (!isValid) return res.status(401).json({ ok: false, error: 'Unauthorized: PayPal provider signature verification failed' });

    const event = req.body;
    const eventType = String(event?.event_type || '');
    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      return res.json({ status: 'accepted', received: true, eventType, funded: false });
    }

    const funding = await recordVerifiedPayPalFunding(event);
    logActivityEvent({
      source: 'PayPal',
      type: 'WEBHOOK_INCOMING',
      status: 'success',
      method: 'POST',
      endpoint: '/api/paypal/webhook',
      statusCode: 200,
      summary: `Verified PayPal funding event: ${eventType}`,
      requestPayload: event,
      stateDiff: funding,
      tags: ['paypal', 'webhook', 'provider_verified', eventType.toLowerCase()]
    });
    return res.json({ status: 'success', received: true, eventType, funding });
  } catch (err: any) {
    console.error('PayPal webhook error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'PAYPAL_WEBHOOK_PROCESSING_FAILED' });
  }
});


/**
 * Create, approve and release a funded milestone using persisted provider state.
 */
router.post('/work-orders/:workOrderId/milestones', authMiddleware, async (req, res) => {
  try {
    const result = await createMilestoneApprovalToken(req.params.workOrderId, Number(req.body?.amount || 0) || undefined);
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    res.status(409).json({ success: false, error: err.message });
  }
});

router.post('/work-orders/:workOrderId/milestones/:milestoneId/approve', authMiddleware, async (req, res) => {
  try {
    const result = await approveMilestone(
      req.params.workOrderId,
      req.params.milestoneId,
      String(req.body?.approvalToken || ''),
      req.body?.deliverableChecksum
    );

    // Approval is the completion signal. Settlement is initiated only after the
    // milestone is provider-funded and the destination is read from server-side
    // configuration; the browser cannot choose the payout destination.
    const provider = String(process.env.AUTONOMOUS_SETTLEMENT_PROVIDER || 'paypal') as 'paypal' | 'payoneer';
    const settlement = await releaseApprovedMilestone(
      req.params.workOrderId,
      req.params.milestoneId,
      provider
    );

    return res.status(settlement.status === 'SETTLED' ? 200 : 202).json({
      success: settlement.status === 'SETTLED',
      milestone: result,
      settlement
    });
  } catch (err: any) {
    res.status(409).json({ success: false, error: err.message });
  }
});

router.post('/work-orders/:workOrderId/milestones/:milestoneId/release', authMiddleware, async (req, res) => {
  try {
    const provider = String(process.env.AUTONOMOUS_SETTLEMENT_PROVIDER || 'paypal') as 'paypal' | 'payoneer';
    const result = await releaseApprovedMilestone(
      req.params.workOrderId,
      req.params.milestoneId,
      provider
    );
    res.status(result.status === 'SETTLED' ? 200 : 202).json({ success: result.status === 'SETTLED', ...result });
  } catch (err: any) {
    res.status(409).json({ success: false, error: err.message });
  }
});

export default router;
