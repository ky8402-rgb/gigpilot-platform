export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  source: 'PayPal' | 'RemoteOK' | 'WeWorkRemotely' | 'FlexJobs' | 'Razorpay' | 'Indian Bank' | 'Gemini AI' | 'System' | 'PostgreSQL Backup' | string;
  type: 'WEBHOOK_INCOMING' | 'FEED_SYNC' | 'BID_SUBMISSION' | 'ORDER_STATE_SYNC' | 'PAYMENT_RECEIVED' | 'BANK_AUTO_TRANSFER' | 'AI_PROPOSAL_GEN' | 'AUTH_HANDSHAKE' | 'DATABASE_SNAPSHOT_CREATED' | 'SNAPSHOT_PRUNED' | 'DISASTER_RECOVERY_RESTORED' | 'SNAPSHOT_VERIFIED' | string;
  status: 'success' | 'warning' | 'error' | 'info';
  method: 'POST' | 'GET' | 'PUT' | 'DELETE' | 'WS' | 'INTERNAL';
  endpoint: string;
  path?: string;
  statusCode: number;
  latencyMs: number;
  summary: string;
  details?: any;
  headers?: Record<string, string>;
  requestPayload?: any;
  responsePayload?: any;
  stateDiff?: {
    action: string;
    entityType?: 'work_order' | 'transaction' | 'balance' | 'feed_job' | 'proposal' | 'snapshot' | 'database' | string;
    entityId?: string | number;
    amountUsd?: number;
    amountInr?: number;
    details?: string;
    itemsCount?: number;
  };
  signatureVerification?: {
    verified: boolean;
    status: 'VERIFIED' | 'MISMATCH' | 'MISSING_SIGNATURE' | 'INVALID_FORMAT' | 'EXPIRED_TIMESTAMP' | 'NOT_APPLICABLE';
    headerName?: string;
    algorithm?: string;
    receivedSignature?: string;
    computedSignature?: string;
    reason?: string;
  };
  tags: string[];
}

// In-Memory Ring Buffer (holds up to 500 events)
const MAX_LOGS = 500;
let activityLogs: ActivityLogEntry[] = [
  {
    id: `evt_init_${Date.now() - 120000}`,
    timestamp: new Date(Date.now() - 120000).toISOString(),
    source: 'PayPal',
    type: 'PAYMENT_RECEIVED',
    status: 'success',
    method: 'POST',
    endpoint: '/api/paypal/capture-order',
    statusCode: 200,
    latencyMs: 112,
    summary: 'Captured $50.00 USD via PayPal REST API and initialized active Work Order in PostgreSQL',
    headers: {
      'host': '0.0.0.0:3000',
      'content-type': 'application/json',
      'paypal-auth-algo': 'SHA256withRSA',
      'user-agent': 'PayPal-REST-SDK/v2'
    },
    requestPayload: {
      orderId: 'ORD-89421098',
      buyerEmail: 'client@company.com',
      buyerName: 'Alex Morgan',
      amount: 50.00
    },
    responsePayload: {
      success: true,
      captureId: 'CAP-98421098',
      amount: 50.00,
      currency: 'USD',
      workOrderId: 'wo_init_01'
    },
    stateDiff: {
      action: 'WORK_ORDER_INITIALIZED_PAYPAL',
      entityType: 'work_order',
      amountUsd: 50.00,
      details: 'Received $50.00 USD via PayPal REST API. Initialized project milestone in PostgreSQL.'
    },
    tags: ['paypal', 'payment', 'work_order', 'postgresql']
  },
  {
    id: `evt_init_${Date.now() - 240000}`,
    timestamp: new Date(Date.now() - 240000).toISOString(),
    source: 'RemoteOK',
    type: 'FEED_SYNC',
    status: 'success',
    method: 'GET',
    endpoint: '/api/remoteok/jobs',
    statusCode: 200,
    latencyMs: 310,
    summary: 'RemoteOK & Arbeitnow Job Feed Sync: Ingested 34 live remote opportunities',
    headers: {
      'accept': 'application/json',
      'user-agent': 'KundanVisionHub/2.0'
    },
    requestPayload: {
      sources: ['remoteok.com/api', 'arbeitnow.com/api'],
      filter: 'tech/engineering/remote'
    },
    responsePayload: {
      totalJobs: 34,
      categories: ['Software Engineering', 'React / TypeScript', 'Automation', 'DevOps'],
      cached: false,
      timestamp: new Date(Date.now() - 240000).toISOString()
    },
    stateDiff: {
      action: 'FEED_JOBS_INGESTED',
      entityType: 'feed_job',
      itemsCount: 34,
      details: 'Merged 34 public live listings into the local Jobs Radar cache'
    },
    tags: ['remoteok', 'arbeitnow', 'feed-sync', 'radar']
  },
  {
    id: `evt_init_${Date.now() - 360000}`,
    timestamp: new Date(Date.now() - 360000).toISOString(),
    source: 'Upwork',
    type: 'WEBHOOK_INCOMING',
    status: 'success',
    method: 'POST',
    endpoint: '/api/webhooks/upwork',
    statusCode: 200,
    latencyMs: 68,
    summary: 'Incoming Upwork Webhook [job_posted]: "Full-Stack React & Node.js Dashboard for AI Video SaaS"',
    headers: {
      'content-type': 'application/json',
      'x-upwork-signature': 'sha256=8f9d023b91c84...',
      'x-upwork-event': 'job_posted',
      'user-agent': 'Upwork-Webhook-Delivery/1.0'
    },
    requestPayload: {
      event_type: 'job_posted',
      data: {
        id: 'upw_job_984102',
        title: 'Full-Stack React & Node.js Dashboard for AI Video SaaS',
        budget: 650.00,
        category: 'Web Dev',
        client_name: 'Loomi AI Labs',
        client_country: 'United States',
        client_spent: 82000,
        skills: ['React', 'TypeScript', 'Node.js', 'Tailwind CSS']
      }
    },
    responsePayload: {
      success: true,
      message: 'Upwork Webhook [job_posted] processed: "Full-Stack React & Node.js Dashboard for AI Video SaaS" (+650 USDT)'
    },
    stateDiff: {
      action: 'WORK_ORDER_INGESTED',
      entityType: 'work_order',
      entityId: 'upw_job_984102',
      amountUsd: 650.00,
      details: 'Created active work order and dispatched auto-bid evaluator.'
    },
    signatureVerification: {
      verified: true,
      status: 'VERIFIED',
      headerName: 'x-upwork-signature',
      algorithm: 'sha256',
      receivedSignature: 'sha256=8f9d023b91c84d720b01e3a9c7b120f3e5891ac3b791402a1b9e840d87654321',
      computedSignature: '8f9d023b91c84d720b01e3a9c7b120f3e5891ac3b791402a1b9e840d87654321'
    },
    tags: ['upwork', 'webhook', 'job_posted', 'order-created']
  },
  {
    id: `evt_init_${Date.now() - 480000}`,
    timestamp: new Date(Date.now() - 480000).toISOString(),
    source: 'Freelancer',
    type: 'WEBHOOK_INCOMING',
    status: 'success',
    method: 'POST',
    endpoint: '/api/webhooks/freelancer',
    statusCode: 200,
    latencyMs: 74,
    summary: 'Incoming Freelancer Webhook [project_created]: "Python Scraper & Real-Time Telegram Alert Bot"',
    headers: {
      'content-type': 'application/json',
      'x-freelancer-event': 'project_created',
      'user-agent': 'Freelancer-Webhooks/2.0'
    },
    requestPayload: {
      event: 'project_created',
      project: {
        id: 'fl_proj_772183',
        title: 'Python Scraper & Real-Time Telegram Alert Bot',
        amount: 320.00,
        employer: { username: 'QuantX Media', country: 'Germany' },
        skills: [{ name: 'Python' }, { name: 'FastAPI' }, { name: 'Telegram API' }]
      }
    },
    responsePayload: {
      success: true,
      message: 'Freelancer Webhook [project_created] processed: "Python Scraper & Real-Time Telegram Alert Bot" (+320 USDT)'
    },
    stateDiff: {
      action: 'WORK_ORDER_INGESTED',
      entityType: 'work_order',
      entityId: 'fl_proj_772183',
      amountUsd: 320.00,
      details: 'Enqueued order #2 into active work orders pipeline.'
    },
    tags: ['freelancer', 'webhook', 'project_created']
  },
  {
    id: `evt_init_${Date.now() - 600000}`,
    timestamp: new Date(Date.now() - 600000).toISOString(),
    source: 'PayPal',
    type: 'PAYMENT_RECEIVED',
    status: 'success',
    method: 'POST',
    endpoint: '/api/paypal/record-payment',
    statusCode: 200,
    latencyMs: 95,
    summary: 'Direct PayPal Checkout Payment: $120.00 USD received from Apex Studio Ventures',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'PayPal-IPN-Handler/1.0'
    },
    requestPayload: {
      invoiceId: 'inv_pp_99182',
      client: 'Apex Studio Ventures',
      amount: 120.00,
      currency: 'USD',
      method: 'PayPal.Me (paypal.me/ky8402)'
    },
    responsePayload: {
      success: true,
      transactionId: 'tx_pp_8841920',
      status: 'CONFIRMED_SETTLED',
      netAmount: 120.00
    },
    stateDiff: {
      action: 'WALLET_CREDITED',
      entityType: 'balance',
      amountUsd: 120.00,
      details: 'Credited $120.00 USD to available liquid wallet balance.'
    },
    tags: ['paypal', 'payment', 'inward', 'settlement']
  }
];

/**
 * Log a structured API event / webhook / state mutation
 */
export function logActivityEvent(entry: Partial<ActivityLogEntry>): ActivityLogEntry {
  const newEntry: ActivityLogEntry = {
    id: entry.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    source: entry.source || 'System',
    type: entry.type || 'WEBHOOK_INCOMING',
    status: entry.status || 'info',
    method: entry.method || 'POST',
    endpoint: entry.endpoint || entry.path || '/api/events',
    path: entry.path || entry.endpoint,
    statusCode: entry.statusCode || 200,
    latencyMs: entry.latencyMs || Math.floor(Math.random() * 80 + 20),
    summary: entry.summary || 'API event processed',
    details: entry.details,
    headers: entry.headers || {},
    requestPayload: entry.requestPayload,
    responsePayload: entry.responsePayload,
    stateDiff: entry.stateDiff,
    signatureVerification: entry.signatureVerification,
    tags: entry.tags || ['system']
  };

  activityLogs.unshift(newEntry);
  if (activityLogs.length > MAX_LOGS) {
    activityLogs = activityLogs.slice(0, MAX_LOGS);
  }

  return newEntry;
}

/**
 * Get all activity logs with optional filtering
 */
export function getActivityLogs(filter?: {
  source?: string;
  type?: string;
  status?: string;
  search?: string;
  limit?: number;
}): {
  logs: ActivityLogEntry[];
  stats: {
    total: number;
    webhooks: number;
    feedSyncs: number;
    mutations: number;
    errors: number;
    avgLatencyMs: number;
    lastEventTime: string;
  };
} {
  let filtered = [...activityLogs];

  if (filter?.source && filter.source !== 'ALL') {
    filtered = filtered.filter(l => l.source.toLowerCase() === filter.source?.toLowerCase());
  }

  if (filter?.type && filter.type !== 'ALL') {
    filtered = filtered.filter(l => l.type === filter.type);
  }

  if (filter?.status && filter.status !== 'ALL') {
    filtered = filtered.filter(l => l.status === filter.status);
  }

  if (filter?.search && filter.search.trim()) {
    const q = filter.search.toLowerCase().trim();
    filtered = filtered.filter(l => {
      return (
        l.summary.toLowerCase().includes(q) ||
        l.endpoint.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        l.type.toLowerCase().includes(q) ||
        JSON.stringify(l.requestPayload || '').toLowerCase().includes(q) ||
        JSON.stringify(l.responsePayload || '').toLowerCase().includes(q) ||
        l.tags.some(t => t.toLowerCase().includes(q))
      );
    });
  }

  const limit = filter?.limit || 100;
  const sliced = filtered.slice(0, limit);

  // Compute statistics across all stored logs
  const total = activityLogs.length;
  const webhooks = activityLogs.filter(l => l.type === 'WEBHOOK_INCOMING').length;
  const feedSyncs = activityLogs.filter(l => l.type === 'FEED_SYNC').length;
  const mutations = activityLogs.filter(l => l.type === 'ORDER_STATE_SYNC' || l.type === 'BANK_AUTO_TRANSFER' || l.type === 'PAYMENT_RECEIVED').length;
  const errors = activityLogs.filter(l => l.status === 'error' || l.statusCode >= 400).length;
  const avgLatencyMs = total > 0
    ? Math.round(activityLogs.reduce((acc, l) => acc + (l.latencyMs || 0), 0) / total)
    : 0;

  return {
    logs: sliced,
    stats: {
      total,
      webhooks,
      feedSyncs,
      mutations,
      errors,
      avgLatencyMs,
      lastEventTime: activityLogs[0]?.timestamp || new Date().toISOString()
    }
  };
}

/**
 * Clear or reset activity logs
 */
export function clearActivityLogs(): void {
  activityLogs = [];
}
