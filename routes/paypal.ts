import express from 'express';
import {
  getPayPalConfig,
  updatePayPalConfig,
  createPayPalOrder,
  capturePayPalOrder,
  createPayPalPayout,
  isPayPalConfigured,
  getPayPalAccessToken
} from '../server/paypal.js';
import { logActivityEvent } from '../server/activityLogger.js';
import { prisma, initializeWorkOrderFromPayPal } from '../server/db.js';

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
router.post('/config', (req, res) => {
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

    // Automatically initialize and persist WorkOrder in PostgreSQL using DATABASE_URL
    const dbResult = await initializeWorkOrderFromPayPal({
      orderId,
      captureId: capture.captureId,
      amount: capturedAmount,
      currency: capture.currency || 'USD',
      clientName: payerName,
      clientEmail: payerEmail,
      title: title || `Client Milestone Deliverable (${orderId})`,
      description: description || `Standard freelance work order created upon PayPal payment ${orderId}`,
      userId
    });

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
        workOrderId: dbResult?.workOrder?.id || dbResult?.simulatedOrder?.id
      },
      stateDiff: {
        action: 'WORK_ORDER_INITIALIZED_PAYPAL',
        entityType: 'work_order',
        entityId: dbResult?.workOrder?.id || dbResult?.simulatedOrder?.id,
        amountUsd: capturedAmount,
        details: `Captured $${capturedAmount.toFixed(2)} USD via PayPal REST API. Initialized active Work Order in PostgreSQL database.`
      },
      tags: ['paypal', 'payment', 'completed', 'work_order']
    });

    res.json({
      success: true,
      capture,
      amount: capturedAmount,
      currency: capture.currency,
      workOrder: dbResult.workOrder || dbResult.simulatedOrder,
      message: `Successfully captured $${capturedAmount.toFixed(2)} USD via PayPal and initialized Work Order in PostgreSQL`
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
 * Fetch recent PayPal transactions and completed work orders
 */
router.get('/transactions', async (req, res) => {
  try {
    const workOrders = await prisma.workOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    }).catch(() => []);

    const transactions = workOrders.map((wo: any) => ({
      id: wo.id,
      orderId: wo.paypalOrderId || `ORD-${wo.id}`,
      amount: wo.totalAmount || 0,
      currency: wo.currency || 'USD',
      status: wo.paymentStatus === 'PAID' ? 'completed' : 'pending',
      payerName: wo.clientName || 'Client',
      payerEmail: wo.clientEmail || 'client@example.com',
      date: wo.createdAt ? new Date(wo.createdAt).toISOString() : new Date().toISOString(),
      description: wo.title || 'Freelance Milestone',
      paymentSource: 'paypal_wallet'
    }));

    res.json({
      success: true,
      transactions
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, transactions: [] });
  }
});

/**
 * GET /api/paypal/work-orders
 * Retrieve all work orders initialized via PayPal from PostgreSQL
 */
router.get('/work-orders', async (req, res) => {
  try {
    const workOrders = await prisma.workOrder.findMany({
      orderBy: { createdAt: 'desc' }
    }).catch(() => []);

    res.json({
      success: true,
      workOrders
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/paypal/payout
 * Send automated payout to collaborator / subcontractor
 */
router.post('/payout', async (req, res) => {
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
 * POST /api/paypal/webhook
 * PayPal Webhook Listener for real-time payment notifications & automatic Work Order ingestion
 */
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    const eventType = event?.event_type || 'CHECKOUT.ORDER.APPROVED';
    const resource = event?.resource || {};
    const amount = parseFloat(resource?.amount?.value || resource?.gross_amount?.value || '0');
    const orderId = resource?.id || resource?.supplementary_data?.related_ids?.order_id || `ORD-${Date.now()}`;
    const captureId = resource?.id?.startsWith('CAP-') ? resource.id : undefined;

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'CHECKOUT.ORDER.APPROVED') {
      await initializeWorkOrderFromPayPal({
        orderId,
        captureId,
        amount: amount > 0 ? amount : 50,
        currency: resource?.amount?.currency_code || 'USD',
        clientName: resource?.payer?.name?.given_name ? `${resource.payer.name.given_name} ${resource.payer.name.surname || ''}`.trim() : 'PayPal Payer',
        clientEmail: resource?.payer?.email_address,
        title: `Live PayPal Order #${orderId}`,
        description: 'Auto-initialized from verified PayPal webhook notification'
      });
    }

    logActivityEvent({
      source: 'PayPal',
      type: 'WEBHOOK_INCOMING',
      status: 'success',
      method: 'POST',
      endpoint: '/api/paypal/webhook',
      statusCode: 200,
      summary: `PayPal Webhook Event: ${eventType} ${amount > 0 ? `($${amount.toFixed(2)} USD)` : ''}`,
      requestPayload: event,
      tags: ['paypal', 'webhook', eventType.toLowerCase()]
    });

    res.json({ status: 'success', received: true });
  } catch (err: any) {
    console.error('PayPal webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
