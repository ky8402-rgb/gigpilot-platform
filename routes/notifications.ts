import { Router, Request, Response } from 'express';
import {
  getCookieConfig,
  updateCookieConfig,
  validateSessionCookies,
  getNotificationConfig,
  updateNotificationConfig,
  sendTelegramLeadAlert,
  sendEmailLeadAlert,
  pollHeadlessFeed,
  getDaemonStatus,
  toggleDaemon,
  getDispatchedHistory
} from '../server/leadNotifications.js';
import { createPayPalOrder, isPayPalConfigured } from '../server/paypal.js';
import { authMiddleware, AuthenticatedRequest } from '../server/authMiddleware.js';

const router = Router();

/**
 * GET /api/notifications/status
 * Get real-time status of the Lead Aggregator daemon, session cookies, and push channels
 */
router.get('/status', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const daemon = getDaemonStatus();
    const cookies = getCookieConfig();
    const config = getNotificationConfig();
    const history = getDispatchedHistory();

    return res.json({
      success: true,
      daemon,
      cookies: {
        upworkStatus: cookies.upworkStatus,
        freelancerStatus: cookies.freelancerStatus,
        lastValidatedAt: cookies.lastValidatedAt,
        hasUpworkCookies: Boolean(cookies.upworkCookies),
        hasFreelancerCookies: Boolean(cookies.freelancerCookies)
      },
      config,
      recentPushes: history.slice(0, 10)
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/cookies
 * Update & validate user session cookies for Upwork / Freelancer
 */
router.post('/cookies', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { platform, cookies } = req.body;
    if (!platform || !cookies) {
      return res.status(400).json({ success: false, error: 'Platform and cookies string are required' });
    }

    const validation = validateSessionCookies(platform, cookies);
    return res.json({
      success: validation.valid,
      validation,
      cookiesState: getCookieConfig()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/config
 * Update push notification channels (Telegram, Email, filters, min budget)
 */
router.post('/config', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = updateNotificationConfig(req.body);
    return res.json({
      success: true,
      config: updated,
      message: 'Lead push notification preferences updated successfully.'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/test-telegram
 * Dispatches an instant test Telegram notification to user's configured Chat ID
 */
router.post('/test-telegram', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sampleLead = {
      id: `lead_test_${Date.now()}`,
      title: req.body.title || 'Senior Full-Stack AI Engineer (Next.js, Gemini 2.5, Express)',
      company: req.body.company || 'Apex Flow Labs',
      platform: req.body.platform || 'Upwork',
      budget: Number(req.body.budget) || 4500,
      hourlyRate: Number(req.body.hourlyRate) || 85,
      proposalsCount: 2,
      url: req.body.url || 'https://upwork.com/jobs/~0189a7491b2c',
      tags: ['Next.js', 'Gemini AI', 'Node.js', 'Playwright'],
      aiWinningAngle: 'Focus on instant 48h prototype MVP delivery with high-throughput Playwright scraper.'
    };

    const result = await sendTelegramLeadAlert(sampleLead);
    return res.json({
      success: result.success,
      result,
      lead: sampleLead
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/test-email
 * Dispatches an instant test Email notification
 */
router.post('/test-email', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sampleLead = {
      id: `lead_test_${Date.now()}`,
      title: req.body.title || 'Autonomous Python Scraper & Multi-Platform Webhook Ingestion Engine',
      company: req.body.company || 'QuantVantage Technologies',
      platform: req.body.platform || 'Freelancer',
      budget: Number(req.body.budget) || 2800,
      hourlyRate: 70,
      proposalsCount: 3,
      url: 'https://freelancer.com/projects/python/autonomous-scraper-engine',
      tags: ['Python', 'Playwright', 'Redis', 'Docker'],
      aiWinningAngle: 'Emphasize cloudflare bypass cookie rotation and sub-second webhook delivery.'
    };

    const result = await sendEmailLeadAlert(sampleLead);
    return res.json({
      success: result.success,
      result,
      lead: sampleLead
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/daemon/poll
 * Triggers an immediate headless scraper poll cycle
 */
router.post('/daemon/poll', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pollResult = pollHeadlessFeed();
    return res.json({
      success: true,
      pollResult,
      daemon: getDaemonStatus()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/daemon/toggle
 * Start or pause the aggregator daemon
 */
router.post('/daemon/toggle', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const running = toggleDaemon(req.body.running);
    return res.json({
      success: true,
      isRunning: running,
      message: running ? 'Headless Lead Aggregator Daemon started.' : 'Headless Lead Aggregator Daemon paused.'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/notifications/history
 * Returns dispatched push notifications log
 */
router.get('/history', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = getDispatchedHistory();
    return res.json({
      success: true,
      count: history.length,
      history
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/speed-checkout
 * Monetization: Buy Lead Aggregator Speed Subscriptions via Live PayPal
 * - Pro Speed ($29/mo): 30s fast polling + Telegram/Email push
 * - Ultra Speed Alpha ($79/mo): 5s sub-second streaming + 1-Click Telegram Auto-Bid
 */
router.post('/speed-checkout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const plan = req.body.plan || 'pro_speed'; // 'pro_speed' | 'ultra_alpha'
    const email = req.user?.email || 'ky8402@gmail.com';
    const userId = req.user?.id || 'user_active_1';

    const planConfig = plan === 'ultra_alpha'
      ? { name: 'Ultra Speed Alpha ($79/mo) - Sub-Second 5s Real-Time Push & Telegram Auto-Bid', amount: 79, speedTier: 'ultra_alpha' }
      : { name: 'Pro Speed Plan ($29/mo) - 30s Fast Polling & Telegram / Email Alerts', amount: 29, speedTier: 'pro_speed' };

    const frontendUrl = getFrontendUrl(req);
    const returnUrl = `${frontendUrl}/dashboard?tab=leads&payment=paypal_success&speed_upgrade=${plan}`;
    const cancelUrl = `${frontendUrl}/dashboard?tab=leads&payment=paypal_cancelled`;

    const order = await createPayPalOrder({
      amount: planConfig.amount,
      currency: 'USD',
      description: planConfig.name,
      clientName: req.user?.email ? req.user.email.split('@')[0] : 'Freelancer',
      clientEmail: email,
      returnUrl,
      cancelUrl,
      customId: `speed_${plan}_${userId}_${Date.now()}`
    });

    return res.json({
      url: order.approveUrl,
      orderId: order.orderId,
      plan,
      isLiveRest: order.isLiveRest,
      message: `PayPal speed subscription session initialized for ${planConfig.name}`
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function getFrontendUrl(req: Request): string {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.replace(/\/$/, '');
  }
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

export default router;
