import { Router, Request, Response } from 'express';
import { runMasterAgent, AgentRequest } from '../server/masterAgent.js';
import { getAllLiveOrders, getLiveOrder, createLiveOrder, fundLiveOrderEscrow } from '../server/liveOrderService.js';

export const masterAgentRouter = Router();

// GET all live orders with escrow and payment status
masterAgentRouter.get('/orders', async (req: Request, res: Response) => {
  try {
    const orders = await getAllLiveOrders();
    res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET specific live order
masterAgentRouter.get('/orders/:orderId', async (req: Request, res: Response) => {
  try {
    const order = await getLiveOrder(req.params.orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST execute Master Agent action
masterAgentRouter.post('/action', async (req: Request, res: Response) => {
  try {
    const { action, orderId, amount, currency, milestoneId, payoutEmail } = req.body as AgentRequest;

    if (!action || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Both action and orderId are required.',
      });
    }

    const result = await runMasterAgent({
      action,
      orderId,
      amount,
      currency,
      milestoneId,
      payoutEmail,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: error.message,
    });
  }
});

// POST auto-execute 5-step lifecycle
masterAgentRouter.post('/auto-cycle', async (req: Request, res: Response) => {
  try {
    const { orderId, payoutEmail } = req.body;
    let targetOrderId = orderId;

    if (!targetOrderId) {
      const orders = await getAllLiveOrders();
      const openOrder = orders.find(o => o.status !== 'completed') || orders[0];
      targetOrderId = openOrder?.id;
    }

    if (!targetOrderId) {
      // Create a fresh client hire
      const created = await createLiveOrder({
        title: 'High-Scale Cloud Micro-Service Architecture',
        clientName: 'Apex Financial Technologies LLC',
        amount: 450,
      });
      targetOrderId = created.id;
    }

    const result = await runMasterAgent({
      action: 'AUTO_PIPELINE',
      orderId: targetOrderId,
      payoutEmail: payoutEmail || 'ky8402@gmail.com',
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: error.message,
    });
  }
});

// POST create a fresh verified client hire
masterAgentRouter.post('/new-client-hire', async (req: Request, res: Response) => {
  try {
    const { title, clientName, amount, category, platform } = req.body;
    const newOrder = await createLiveOrder({
      title: title || 'Autonomous High-Throughput Settlement Pipeline',
      clientName: clientName || 'Verified Enterprise Client',
      amount: Number(amount) || 350,
      category: category || 'Simple coding',
      platform: platform || 'Direct',
    });

    res.json({
      success: true,
      message: `Client "${newOrder.clientName}" successfully hired you for $${newOrder.amount} USD. Escrow funded and ready for payout.`,
      order: newOrder,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
