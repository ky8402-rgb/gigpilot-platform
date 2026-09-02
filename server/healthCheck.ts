import axios from 'axios';
import { getPgPool, memoryStore } from './pgDatabase.js';
import { getPayPalConfig, getPayPalAccessToken, isPayPalConfigured, getPayPalBaseUrl } from './paypal.js';
import { getFreelancerConfig, checkFreelancerLinkHealth } from './freelancerApi.js';
import { getFreelancerSyncQueue } from './freelancerRetryQueue.js';
import { getPayoutRetryQueueStats } from './retryWorker.js';

export type HealthStatus = 'healthy' | 'degraded' | 'critical';

export interface DatabaseCheckResult {
  status: HealthStatus;
  latencyMs: number;
  message?: string;
  error?: string;
  provider?: string;
  inMemoryFallback?: boolean;
  tables?: {
    users?: number;
    jobs?: number;
    workOrders?: number;
    transactions?: number;
  };
}

export interface CronCheckResult {
  status: HealthStatus;
  lastRun: string;
  secondsSinceLastRun: number;
  intervalSeconds: number;
  message?: string;
}

export interface PayPalCheckResult {
  status: HealthStatus;
  message: string;
  latencyMs?: number;
  mode?: string;
  error?: string;
}

export interface FreelancerCheckResult {
  status: HealthStatus;
  message: string;
  latencyMs?: number;
  testedUrl?: string;
  error?: string;
}

export interface QueueCheckResult {
  status: HealthStatus;
  details: {
    'payout:waiting'?: number;
    'payout:failed'?: number;
    'freelancer:waiting'?: number;
    'freelancer:active'?: number;
    'freelancer:failed'?: number;
    'freelancer:delayed'?: number;
    inMemoryRetryQueue?: number;
    [key: string]: number | undefined;
  };
  failedJobsCount?: number;
  message?: string;
}

export interface WorkOrdersCheckResult {
  status: HealthStatus;
  stuckCount: number;
  failedPayments: number;
  totalActive?: number;
  totalCompleted?: number;
  message?: string;
}

export interface TransactionsCheckResult {
  status: HealthStatus;
  pendingOld: number;
  failedCount?: number;
  totalCount?: number;
  message?: string;
}

export interface AutoHealCheckResult {
  status: HealthStatus;
  enabled: boolean;
  intervalSeconds: number;
  maxAttempts: number;
  consecutiveFailures: number;
  recentAttemptsCount: number;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  isCurrentlyHealing?: boolean;
  escalated?: boolean;
  message?: string;
}

export interface FullHealthCheckResult {
  status: HealthStatus;
  timestamp: string;
  checks: {
    database: DatabaseCheckResult;
    cron: CronCheckResult;
    paypal: PayPalCheckResult;
    freelancer: FreelancerCheckResult;
    queues: QueueCheckResult;
    workOrders: WorkOrdersCheckResult;
    transactions: TransactionsCheckResult;
    autoHeal?: AutoHealCheckResult;
  };
  remediation: string;
  predictiveML?: {
    prediction_id?: string;
    issue_type: string;
    confidence: number;
    model_version: string;
    recommended_remediation: string;
    source: string;
    cached: boolean;
    probabilities?: Record<string, number>;
  };
}

// ----------------------------------------------------------------------------
// ML Predictor & AutoHealer Status Registration (to decouple imports)
// ----------------------------------------------------------------------------
let autoHealerStatusGetter: (() => any) | null = null;
export function registerAutoHealerStatusGetter(getter: () => any) {
  autoHealerStatusGetter = getter;
}

let mlPredictor: ((health: FullHealthCheckResult) => Promise<any>) | null = null;
export function registerMLPredictor(predictor: (health: FullHealthCheckResult) => Promise<any>) {
  mlPredictor = predictor;
}

// ----------------------------------------------------------------------------
// Cron Heartbeat State
// ----------------------------------------------------------------------------
let lastCronRunTimestamp = Date.now();
let lastCronJobName = 'auto_completion_worker';

/**
 * Record a heartbeat whenever the cron or completion worker runs
 */
export function recordCronHeartbeat(jobName: string = 'auto_completion_worker'): void {
  lastCronRunTimestamp = Date.now();
  lastCronJobName = jobName;
}

/**
 * Retrieve the last recorded cron execution timestamp
 */
export function getLastCronRun(): { timestamp: number; iso: string; jobName: string } {
  return {
    timestamp: lastCronRunTimestamp,
    iso: new Date(lastCronRunTimestamp).toISOString(),
    jobName: lastCronJobName,
  };
}

// ----------------------------------------------------------------------------
// 1. Database Connectivity & Health Check
// ----------------------------------------------------------------------------
export async function checkDatabase(): Promise<DatabaseCheckResult> {
  const pool = getPgPool();
  const startTime = Date.now();

  if (!pool) {
    // In-memory resilient fallback is active
    return {
      status: 'healthy',
      latencyMs: 1,
      message: 'In-Memory Resilient Store active (DATABASE_URL not configured)',
      provider: 'MemoryStore (Neon/Postgres Fallback)',
      inMemoryFallback: true,
      tables: {
        users: memoryStore.users.size,
        jobs: memoryStore.jobs.size,
        workOrders: memoryStore.workOrders.size,
        transactions: memoryStore.transactions.size,
      },
    };
  }

  try {
    const client = await pool.connect();
    try {
      const pingRes = await client.query('SELECT 1 AS ping, NOW() AS server_time');
      const latencyMs = Date.now() - startTime;

      let usersCount = memoryStore.users.size;
      let jobsCount = memoryStore.jobs.size;
      let workOrdersCount = memoryStore.workOrders.size;
      let transactionsCount = memoryStore.transactions.size;

      try {
        const countsRes = await client.query(`
          SELECT 
            (SELECT COUNT(*) FROM users) AS u_count,
            (SELECT COUNT(*) FROM jobs) AS j_count,
            (SELECT COUNT(*) FROM work_orders) AS wo_count,
            (SELECT COUNT(*) FROM transactions) AS tx_count
        `);
        if (countsRes.rows.length > 0) {
          const row = countsRes.rows[0];
          usersCount = Number(row.u_count) || usersCount;
          jobsCount = Number(row.j_count) || jobsCount;
          workOrdersCount = Number(row.wo_count) || workOrdersCount;
          transactionsCount = Number(row.tx_count) || transactionsCount;
        }
      } catch {
        // Table queries optional if schema in bootstrap
      }

      const status: HealthStatus = latencyMs > 800 ? 'degraded' : 'healthy';

      return {
        status,
        latencyMs,
        message: status === 'healthy' ? 'Connected to PostgreSQL (Neon)' : 'High query latency on PostgreSQL (Neon)',
        provider: 'Neon / PostgreSQL',
        inMemoryFallback: false,
        tables: {
          users: usersCount,
          jobs: jobsCount,
          workOrders: workOrdersCount,
          transactions: transactionsCount,
        },
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      status: 'critical',
      latencyMs,
      message: 'PostgreSQL database connection failed',
      error: err.message || 'Connection error',
      provider: 'Neon / PostgreSQL',
      inMemoryFallback: false,
    };
  }
}

// ----------------------------------------------------------------------------
// 2. Auto-Completion Cron Health Check
// ----------------------------------------------------------------------------
export async function checkCronJob(): Promise<CronCheckResult> {
  const now = Date.now();
  const secondsSinceLastRun = Math.max(0, Math.floor((now - lastCronRunTimestamp) / 1000));
  const lastRunIso = new Date(lastCronRunTimestamp).toISOString();

  // The cron is scheduled to run every 30 seconds
  if (secondsSinceLastRun <= 45) {
    return {
      status: 'healthy',
      lastRun: lastRunIso,
      secondsSinceLastRun,
      intervalSeconds: 30,
      message: 'Cron running on schedule (30s interval)',
    };
  } else if (secondsSinceLastRun <= 90) {
    return {
      status: 'degraded',
      lastRun: lastRunIso,
      secondsSinceLastRun,
      intervalSeconds: 30,
      message: `Cron execution delayed (${secondsSinceLastRun}s elapsed since last heartbeat)`,
    };
  } else {
    return {
      status: 'critical',
      lastRun: lastRunIso,
      secondsSinceLastRun,
      intervalSeconds: 30,
      message: `Cron worker inactive (${secondsSinceLastRun}s elapsed since last heartbeat)`,
    };
  }
}

// ----------------------------------------------------------------------------
// 3. PayPal API Connectivity Check
// ----------------------------------------------------------------------------
export async function checkPayPalConnectivity(): Promise<PayPalCheckResult> {
  const startTime = Date.now();
  const cfg = getPayPalConfig();

  if (!isPayPalConfigured()) {
    return {
      status: 'healthy',
      message: 'Direct Gateway & PayPal.me active (REST OAuth optional)',
      mode: cfg.mode,
    };
  }

  try {
    // Perform lightweight OAuth token verification with 6-second timeout
    const token = await getPayPalAccessToken();
    const latencyMs = Date.now() - startTime;

    if (token && typeof token === 'string' && token.length > 10) {
      return {
        status: 'healthy',
        message: 'Connected (REST OAuth2 Verified)',
        latencyMs,
        mode: cfg.mode,
      };
    } else {
      return {
        status: 'degraded',
        message: 'PayPal Client ID/Secret unverified (fallback to PayPal.me active)',
        latencyMs,
        mode: cfg.mode,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      status: 'degraded',
      message: err.response?.data?.error_description || err.message || 'PayPal API connectivity notice',
      error: err.message,
      latencyMs,
      mode: cfg.mode,
    };
  }
}

// ----------------------------------------------------------------------------
// 4. Freelancer.com API Connectivity Check
// ----------------------------------------------------------------------------
export async function checkFreelancerConnectivity(): Promise<FreelancerCheckResult> {
  const { accessToken, apiBase } = getFreelancerConfig();

  if (!accessToken || accessToken.trim().length === 0) {
    return {
      status: 'degraded',
      message: 'FREELANCER_ACCESS_TOKEN not configured',
    };
  }

  try {
    // Perform link health check and token test
    const linkHealth = await checkFreelancerLinkHealth('sample-project');

    if (linkHealth.isHealthy || linkHealth.httpStatus === 200 || linkHealth.httpStatus === 301 || linkHealth.httpStatus === 302 || linkHealth.httpStatus === 404) {
      return {
        status: 'healthy',
        message: 'Connected (Freelancer.com reachable)',
        latencyMs: linkHealth.responseTimeMs,
        testedUrl: linkHealth.testedUrl,
      };
    } else if (linkHealth.httpStatus === 401 || linkHealth.httpStatus === 403) {
      return {
        status: 'degraded',
        message: 'Freelancer token expired or unauthorized (HTTP 401)',
        latencyMs: linkHealth.responseTimeMs,
        testedUrl: linkHealth.testedUrl,
      };
    } else {
      return {
        status: 'degraded',
        message: linkHealth.error || `Freelancer API returned HTTP ${linkHealth.httpStatus}`,
        latencyMs: linkHealth.responseTimeMs,
        testedUrl: linkHealth.testedUrl,
      };
    }
  } catch (err: any) {
    return {
      status: 'degraded',
      message: err.message || 'Freelancer.com network check failed',
      error: err.message,
    };
  }
}

// ----------------------------------------------------------------------------
// 5. Bull & In-Memory Queue Health Check
// ----------------------------------------------------------------------------
export async function checkQueueHealth(): Promise<QueueCheckResult> {
  const details: Record<string, number> = {
    'payout:waiting': 0,
    'payout:failed': 0,
    'freelancer:waiting': 0,
    'freelancer:active': 0,
    'freelancer:failed': 0,
    'freelancer:delayed': 0,
    inMemoryRetryQueue: 0,
  };

  let failedJobsCount = 0;

  // 1. Inspect Bull Freelancer Queue
  const bullQueue = getFreelancerSyncQueue();
  if (bullQueue) {
    try {
      const counts = await Promise.race([
        bullQueue.getJobCounts(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Bull queue timeout')), 1500)),
      ]);
      details['freelancer:waiting'] = counts.waiting || 0;
      details['freelancer:active'] = counts.active || 0;
      details['freelancer:failed'] = counts.failed || 0;
      details['freelancer:delayed'] = counts.delayed || 0;
      failedJobsCount += counts.failed || 0;
    } catch (e: any) {
      // Redis unavailable or connection error
    }
  }

  // 2. Inspect In-Memory Payout Retry Queue
  const payoutStats = getPayoutRetryQueueStats();
  details['payout:waiting'] = payoutStats.waiting || 0;
  details.inMemoryRetryQueue = payoutStats.waiting || 0;

  // 3. Inspect failed payments in DB/memory
  const failedWos = Array.from(memoryStore.workOrders.values()).filter((w) => w.payment_status === 'failed');
  details['payout:failed'] = failedWos.length;
  failedJobsCount += failedWos.length;

  let status: HealthStatus = 'healthy';
  let message = 'All queues operational';

  if (failedJobsCount > 5) {
    status = 'critical';
    message = `Critical queue failure volume: ${failedJobsCount} failed jobs`;
  } else if (failedJobsCount > 0 || (details['freelancer:waiting'] || 0) > 15 || (details['payout:waiting'] || 0) > 10) {
    status = 'degraded';
    message = `Active retries pending: ${failedJobsCount} failed, ${(details['freelancer:waiting'] || 0) + (details['payout:waiting'] || 0)} waiting`;
  }

  return {
    status,
    details,
    failedJobsCount,
    message,
  };
}

// ----------------------------------------------------------------------------
// 6. Work Orders Lifecycle & Overdue Health Check
// ----------------------------------------------------------------------------
export async function checkWorkOrders(): Promise<WorkOrdersCheckResult> {
  const pool = getPgPool();
  const now = new Date();

  let allOrders: any[] = [];
  let stuckCount = 0;
  let failedPayments = 0;

  if (pool) {
    try {
      const res = await pool.query(`
        SELECT id, status, completion_deadline, payment_status, customer_confirmed, worker_marked_complete
        FROM work_orders
      `);
      allOrders = res.rows;
    } catch {
      // fallback
    }
  }

  if (allOrders.length === 0) {
    allOrders = Array.from(memoryStore.workOrders.values());
  }

  let totalActive = 0;
  let totalCompleted = 0;

  for (const wo of allOrders) {
    const isPendingOrActive = wo.status === 'assigned' || wo.status === 'in_progress';
    const isOverdue = new Date(wo.completion_deadline) <= now;
    const isFailedPayment = wo.payment_status === 'failed';

    if (isPendingOrActive) {
      totalActive++;
      if (isOverdue) {
        stuckCount++;
      }
    }

    if (wo.status === 'completed' || wo.status === 'paid') {
      totalCompleted++;
    }

    if (isFailedPayment) {
      failedPayments++;
    }
  }

  let status: HealthStatus = 'healthy';
  let message = 'All active work orders on schedule';

  if (stuckCount > 5 || failedPayments > 3) {
    status = 'critical';
    message = `Critical work order delays: ${stuckCount} overdue, ${failedPayments} payments failed`;
  } else if (stuckCount > 0 || failedPayments > 0) {
    status = 'degraded';
    message = `Attention needed: ${stuckCount} work orders overdue, ${failedPayments} payments failed`;
  }

  return {
    status,
    stuckCount,
    failedPayments,
    totalActive,
    totalCompleted,
    message,
  };
}

// ----------------------------------------------------------------------------
// 7. Transactions Stale / Failed Health Check
// ----------------------------------------------------------------------------
export async function checkTransactions(): Promise<TransactionsCheckResult> {
  const pool = getPgPool();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  let allTxs: any[] = [];
  let pendingOld = 0;
  let failedCount = 0;

  if (pool) {
    try {
      const res = await pool.query(`SELECT id, status, created_at FROM transactions`);
      allTxs = res.rows;
    } catch {
      // fallback
    }
  }

  if (allTxs.length === 0) {
    allTxs = Array.from(memoryStore.transactions.values());
  }

  for (const tx of allTxs) {
    const isOld = new Date(tx.created_at || Date.now()) <= oneHourAgo;
    if ((tx.status === 'pending' || tx.status === 'processing') && isOld) {
      pendingOld++;
    }
    if (tx.status === 'failed') {
      failedCount++;
    }
  }

  let status: HealthStatus = 'healthy';
  let message = 'No stale pending or failed transactions';

  if (failedCount > 5 || pendingOld > 5) {
    status = 'critical';
    message = `Critical transaction errors: ${failedCount} failed, ${pendingOld} stuck > 1 hour`;
  } else if (failedCount > 0 || pendingOld > 0) {
    status = 'degraded';
    message = `Transaction warnings: ${failedCount} failed, ${pendingOld} stuck > 1 hour`;
  }

  return {
    status,
    pendingOld,
    failedCount,
    totalCount: allTxs.length,
    message,
  };
}

// ----------------------------------------------------------------------------
// 8. Full Unified System Health Check
// ----------------------------------------------------------------------------
export async function runFullHealthCheck(): Promise<FullHealthCheckResult> {
  const [
    dbResult,
    cronResult,
    paypalResult,
    freelancerResult,
    queueResult,
    workOrdersResult,
    transactionsResult,
  ] = await Promise.all([
    checkDatabase().catch((err) => ({ status: 'critical' as HealthStatus, latencyMs: 0, error: err.message })),
    checkCronJob().catch((err) => ({ status: 'critical' as HealthStatus, lastRun: new Date().toISOString(), secondsSinceLastRun: 999, intervalSeconds: 30, message: err.message })),
    checkPayPalConnectivity().catch((err) => ({ status: 'degraded' as HealthStatus, message: err.message })),
    checkFreelancerConnectivity().catch((err) => ({ status: 'degraded' as HealthStatus, message: err.message })),
    checkQueueHealth().catch((err) => ({ status: 'degraded' as HealthStatus, details: {}, failedJobsCount: 0, message: err.message })),
    checkWorkOrders().catch((err) => ({ status: 'degraded' as HealthStatus, stuckCount: 0, failedPayments: 0, message: err.message })),
    checkTransactions().catch((err) => ({ status: 'degraded' as HealthStatus, pendingOld: 0, failedCount: 0, message: err.message })),
  ]);

  // Overall system status calculation
  const allStatuses: HealthStatus[] = [
    dbResult.status,
    cronResult.status,
    paypalResult.status,
    freelancerResult.status,
    queueResult.status,
    workOrdersResult.status,
    transactionsResult.status,
  ];

  let overallStatus: HealthStatus = 'healthy';
  if (allStatuses.includes('critical')) {
    overallStatus = 'critical';
  } else if (allStatuses.includes('degraded')) {
    overallStatus = 'degraded';
  }

  // Construct actionable remediation guidance
  const remediationPoints: string[] = [];

  if (dbResult.status === 'critical') {
    remediationPoints.push('Verify PostgreSQL connection string in DATABASE_URL and database availability');
  }

  if (cronResult.status !== 'healthy') {
    remediationPoints.push('Restart background auto-completion cron worker');
  }

  if (freelancerResult.status !== 'healthy') {
    remediationPoints.push('Renew Freelancer.com OAuth token in Settings or check API availability');
  }

  if (paypalResult.status !== 'healthy') {
    remediationPoints.push('Verify PayPal Client ID & Secret credentials');
  }

  if (workOrdersResult.stuckCount > 0 || workOrdersResult.failedPayments > 0) {
    remediationPoints.push(`Auto-approve ${workOrdersResult.stuckCount} overdue work order(s) and retry ${workOrdersResult.failedPayments} failed payment(s)`);
  }

  if (transactionsResult.failedCount && transactionsResult.failedCount > 0) {
    remediationPoints.push(`Retry ${transactionsResult.failedCount} failed transaction(s) via self-healing engine`);
  }

  if (transactionsResult.pendingOld > 0) {
    remediationPoints.push(`Resolve ${transactionsResult.pendingOld} stale transaction(s) older than 1 hour`);
  }

  if ((queueResult.failedJobsCount || 0) > 0) {
    remediationPoints.push(`Process and flush ${queueResult.failedJobsCount} failed queue job(s)`);
  }

  // AutoHealer Status check
  let autoHealResult: AutoHealCheckResult | undefined;
  if (autoHealerStatusGetter) {
    try {
      const ahStatus = autoHealerStatusGetter();
      if (ahStatus) {
        let ahHealth: HealthStatus = 'healthy';
        let ahMessage = `Auto-healer active (${ahStatus.intervalSeconds}s interval)`;

        if (!ahStatus.enabled) {
          ahHealth = 'degraded';
          ahMessage = 'Auto-healer loop is paused';
        } else if (ahStatus.consecutiveFailures >= ahStatus.maxAttempts) {
          ahHealth = 'critical';
          ahMessage = `Auto-healer escalated: ${ahStatus.consecutiveFailures} consecutive remediation failures`;
        } else if (ahStatus.consecutiveFailures > 0) {
          ahHealth = 'degraded';
          ahMessage = `Auto-healer retrying: ${ahStatus.consecutiveFailures}/${ahStatus.maxAttempts} attempts`;
        }

        autoHealResult = {
          status: ahHealth,
          enabled: ahStatus.enabled,
          intervalSeconds: ahStatus.intervalSeconds,
          maxAttempts: ahStatus.maxAttempts,
          consecutiveFailures: ahStatus.consecutiveFailures,
          recentAttemptsCount: ahStatus.recentAttemptsCount,
          lastRunAt: ahStatus.lastRunAt,
          lastSuccessAt: ahStatus.lastSuccessAt,
          lastFailureAt: ahStatus.lastFailureAt,
          isCurrentlyHealing: ahStatus.isCurrentlyHealing,
          escalated: ahStatus.escalated,
          message: ahMessage,
        };

        if (ahHealth === 'critical') {
          overallStatus = 'critical';
          remediationPoints.push('DevOps attention required: Auto-healing escalation limit reached');
        }
      }
    } catch {
      // Ignore getter error
    }
  }

  const baseRemediation = remediationPoints.length > 0
    ? remediationPoints.join('; ') + '.'
    : 'System operating normally. No remediation needed.';

  let predictiveMLResult: any = undefined;
  if (mlPredictor) {
    try {
      const intermediateResult: FullHealthCheckResult = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks: {
          database: dbResult,
          cron: cronResult,
          paypal: paypalResult,
          freelancer: freelancerResult,
          queues: queueResult,
          workOrders: workOrdersResult,
          transactions: transactionsResult,
          autoHeal: autoHealResult,
        },
        remediation: baseRemediation,
      };
      predictiveMLResult = await mlPredictor(intermediateResult);
      if (predictiveMLResult && predictiveMLResult.confidence >= 0.70 && predictiveMLResult.issue_type !== 'healthy') {
        remediationPoints.push(`[ML Predictive Warning (${Math.round(predictiveMLResult.confidence * 100)}% conf)]: ${predictiveMLResult.recommended_remediation}`);
      }
    } catch {
      // Ignore prediction error in health check
    }
  }

  const remediation = remediationPoints.length > 0
    ? remediationPoints.join('; ') + '.'
    : 'System operating normally. No remediation needed.';

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks: {
      database: dbResult,
      cron: cronResult,
      paypal: paypalResult,
      freelancer: freelancerResult,
      queues: queueResult,
      workOrders: workOrdersResult,
      transactions: transactionsResult,
      autoHeal: autoHealResult,
    },
    remediation,
    predictiveML: predictiveMLResult,
  };
}
