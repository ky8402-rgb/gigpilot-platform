import axios from 'axios';
import Bull, { Queue as BullQueue } from 'bull';
import { runFullHealthCheck, HealthStatus, FullHealthCheckResult, recordCronHeartbeat, registerAutoHealerStatusGetter } from './healthCheck.js';
import { autoRemediate, RemediationResult } from './remediation.js';
import { insertSelfHealingLog, getSelfHealingLogs, SelfHealingLog } from './pgDatabase.js';
import { logActivityEvent } from './activityLogger.js';
import { triggerAISupportIncident } from './supportChat.js';
import { SimpleJobQueue } from './asyncQueue.js';

export interface AutoHealerConfig {
  enabled: boolean;
  intervalSeconds: number;
  maxAttempts: number;
  alertWebhookUrl: string;
}

export interface AutoHealerStatus {
  enabled: boolean;
  intervalSeconds: number;
  maxAttempts: number;
  consecutiveFailures: number;
  recentAttemptsCount: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  isCurrentlyHealing: boolean;
  alertWebhookConfigured: boolean;
  escalated: boolean;
  queueType: 'bull_redis' | 'in_memory';
  queueStats: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  };
}

export class AutoHealer {
  private config: AutoHealerConfig;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isCycleRunning: boolean = false;
  private consecutiveFailures: number = 0;
  private recentAttemptsCount: number = 0;
  private lastRunAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private isCurrentlyHealing: boolean = false;
  private lastBackoffUntil: number = 0;

  // Queues: Bull (Redis) with In-Memory fallback
  private bullQueue: BullQueue | null = null;
  private inMemoryQueue: SimpleJobQueue<any>;
  private isUsingBullRedis: boolean = false;

  constructor() {
    // 1. Load configuration from environment variables
    const rawEnabled = process.env.AUTO_HEAL_ENABLED;
    const enabled = rawEnabled !== 'false' && rawEnabled !== '0';
    const intervalSeconds = Math.max(30, Number(process.env.AUTO_HEAL_INTERVAL) || 60);
    const maxAttempts = Math.max(1, Number(process.env.AUTO_HEAL_MAX_ATTEMPTS) || 3);
    const alertWebhookUrl = (process.env.ALERT_WEBHOOK_URL || '').trim();

    this.config = {
      enabled,
      intervalSeconds,
      maxAttempts,
      alertWebhookUrl,
    };

    // 2. Initialize In-Memory Queue fallback
    this.inMemoryQueue = new SimpleJobQueue('self-healing-fallback', 1);
    this.inMemoryQueue.process(async (job) => {
      const source = job.data?.source || 'auto_healer_memory_queue';
      return await autoRemediate(source);
    });

    // 3. Initialize Bull Redis Queue if REDIS_URL is available
    this.initBullQueue();

    // 4. Register status getter for healthCheck telemetry
    registerAutoHealerStatusGetter(() => this.getStatus());

    // 5. Start periodic scheduler if enabled
    if (this.config.enabled) {
      this.start();
    }
  }

  /**
   * Initialize Bull Queue for asynchronous background remediation
   */
  private initBullQueue() {
    const redisUrl = (process.env.REDIS_URL || '').trim();
    // Render internal redis hosts (e.g. red-*) are not resolvable outside Render network
    if (!redisUrl || redisUrl.includes('red-')) {
      console.log('ℹ️ [AutoHealer] Redis unavailable or internal cloud host. Operating with in-memory resilient self-healing queue.');
      return;
    }

    try {
      this.bullQueue = new Bull('self-healing', redisUrl, {
        settings: {
          maxStalledCount: 2,
          lockDuration: 30000,
        },
      });

      // Register processor on the Bull queue
      this.bullQueue.process(async (job) => {
        const source = job.data?.source || 'auto_healer_bull_queue';
        console.log(`⚙️ [AutoHealer Bull Worker] Processing self-healing remediation job (${job.id})...`);
        const result = await autoRemediate(source);
        return result;
      });

      this.bullQueue.on('error', (err) => {
        console.warn('⚠️ [AutoHealer Bull Queue] Redis notice (using fallback):', err.message);
        this.isUsingBullRedis = false;
      });

      this.bullQueue.on('completed', (job, result) => {
        console.log(`✅ [AutoHealer Bull Queue] Remediation job ${job.id} completed. Status: ${result?.finalStatus}`);
      });

      this.bullQueue.on('failed', (job, err) => {
        console.error(`❌ [AutoHealer Bull Queue] Remediation job ${job.id} failed:`, err.message);
      });

      this.isUsingBullRedis = true;
      console.log('🚀 [AutoHealer] Bull Redis Queue initialized for [self-healing] background tasks.');
    } catch (err: any) {
      console.warn('⚠️ [AutoHealer] Bull Redis initialization notice (fallback active):', err.message);
      this.bullQueue = null;
      this.isUsingBullRedis = false;
    }
  }

  /**
   * Start the periodic automated health check & self-healing loop
   */
  public start(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.config.enabled = true;
    console.log(`🔁 [AutoHealer] Starting automated self-healing loop (interval: ${this.config.intervalSeconds}s, max retries: ${this.config.maxAttempts}).`);

    // Initial check after short delay (5 seconds after boot)
    setTimeout(() => {
      this.runSelfHealingCycle().catch((err) => {
        console.error('❌ [AutoHealer] Initial cycle error:', err.message);
      });
    }, 5000);

    // Periodic scheduled interval
    this.intervalHandle = setInterval(() => {
      this.runSelfHealingCycle().catch((err) => {
        console.error('❌ [AutoHealer] Background cycle error:', err.message);
      });
    }, this.config.intervalSeconds * 1000);
  }

  /**
   * Stop the automated self-healing loop
   */
  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.config.enabled = false;
    console.log('⏸️ [AutoHealer] Automated self-healing loop paused.');
  }

  /**
   * Core Autonomous Self-Healing Cycle
   * 1. Run health check
   * 2. If degraded/critical, trigger remediation via background Bull queue
   * 3. Re-run health check to verify resolution
   * 4. Apply exponential backoff and escalate if max attempts exceeded
   * 5. Persist audit trail to self_healing_logs
   */
  public async runSelfHealingCycle(manualTrigger: boolean = false): Promise<{
    status: HealthStatus;
    remediationTriggered: boolean;
    remediationSuccess: boolean;
    consecutiveFailures: number;
    details: any;
  }> {
    if (this.isCycleRunning && !manualTrigger) {
      console.log('ℹ️ [AutoHealer] Cycle already in progress, skipping duplicate cycle.');
      return {
        status: 'healthy',
        remediationTriggered: false,
        remediationSuccess: true,
        consecutiveFailures: this.consecutiveFailures,
        details: { skipped: 'Cycle in progress' },
      };
    }

    // Exponential Backoff Check:
    // If consecutive failures > 0, wait 2^(failures - 1) * interval before retrying automatically
    const now = Date.now();
    if (!manualTrigger && this.consecutiveFailures > 0 && now < this.lastBackoffUntil) {
      const remainingSec = Math.round((this.lastBackoffUntil - now) / 1000);
      console.log(`⏳ [AutoHealer] Exponential backoff active. Next remediation in ${remainingSec}s (Attempt ${this.consecutiveFailures}/${this.config.maxAttempts}).`);
      return {
        status: 'degraded',
        remediationTriggered: false,
        remediationSuccess: false,
        consecutiveFailures: this.consecutiveFailures,
        details: { skipped: `Exponential backoff active (${remainingSec}s remaining)` },
      };
    }

    this.isCycleRunning = true;
    this.lastRunAt = new Date().toISOString();
    recordCronHeartbeat('auto_healer_cycle');

    try {
      // Step 1: Run comprehensive health check
      const initialHealth: FullHealthCheckResult = await runFullHealthCheck();
      const initialStatus: HealthStatus = initialHealth.status;

      // If healthy, reset failure counters
      if (initialStatus === 'healthy') {
        if (this.consecutiveFailures > 0) {
          console.log(`🎉 [AutoHealer] All systems recovered to healthy status! Resetting retry counter.`);
        }
        this.consecutiveFailures = 0;
        this.lastSuccessAt = new Date().toISOString();
        this.isCurrentlyHealing = false;

        return {
          status: 'healthy',
          remediationTriggered: false,
          remediationSuccess: true,
          consecutiveFailures: 0,
          details: { message: 'All systems healthy. No remediation required.' },
        };
      }

      // Step 2: System is degraded or critical -> Trigger Background Remediation
      console.log(`⚠️ [AutoHealer] Health anomaly detected (Status: ${initialStatus}). Triggering background remediation...`);
      this.isCurrentlyHealing = true;
      this.recentAttemptsCount++;

      let remediationRes: RemediationResult;

      // Dispatch to Bull Redis queue if operational, otherwise execute via In-Memory Queue
      if (this.bullQueue && this.isUsingBullRedis) {
        try {
          const job = await this.bullQueue.add({
            source: manualTrigger ? 'manual_auto_healer_trigger' : 'scheduled_auto_healer',
            initialStatus,
            timestamp: new Date().toISOString(),
          }, {
            attempts: 2,
            backoff: 5000,
            removeOnComplete: true,
          });

          // Await job completion
          remediationRes = await job.finished();
        } catch (bullErr: any) {
          console.warn('⚠️ [AutoHealer] Bull dispatch fallback to in-memory worker:', bullErr.message);
          remediationRes = await autoRemediate(manualTrigger ? 'manual_auto_healer' : 'scheduled_auto_healer');
        }
      } else {
        const inMemJob = await this.inMemoryQueue.add('remediation', {
          source: manualTrigger ? 'manual_auto_healer' : 'scheduled_auto_healer',
        });
        // Wait up to 15s for in-memory completion
        remediationRes = await autoRemediate(manualTrigger ? 'manual_auto_healer' : 'scheduled_auto_healer');
      }

      // Step 3: Verify Resolution via Post-Remediation Health Check
      const finalHealth: FullHealthCheckResult = remediationRes.health || (await runFullHealthCheck());
      const finalStatus: HealthStatus = finalHealth.status;
      const isResolved = finalStatus === 'healthy' || (initialStatus === 'critical' && finalStatus === 'degraded');

      const attemptNumber = this.consecutiveFailures + 1;

      // Step 4: Handle Success vs Retry Escalation
      if (isResolved) {
        this.consecutiveFailures = 0;
        this.lastSuccessAt = new Date().toISOString();
        this.lastBackoffUntil = 0;
        this.isCurrentlyHealing = false;

        console.log(`✅ [AutoHealer] Autonomous remediation succeeded! Status: ${initialStatus} -> ${finalStatus}`);
      } else {
        this.consecutiveFailures = attemptNumber;
        this.lastFailureAt = new Date().toISOString();
        this.isCurrentlyHealing = false;

        // Exponential backoff calculation: wait 2^(attempt - 1) * intervalSeconds
        const backoffMultiplier = Math.min(8, Math.pow(2, this.consecutiveFailures - 1));
        const backoffMs = backoffMultiplier * this.config.intervalSeconds * 1000;
        this.lastBackoffUntil = Date.now() + backoffMs;

        console.warn(`⚠️ [AutoHealer] Remediation attempt ${this.consecutiveFailures}/${this.config.maxAttempts} did not fully resolve anomalies (Status: ${finalStatus}). Backoff: ${backoffMs / 1000}s.`);

        // Step 5: Check if Max Attempts Reached -> Escalate Alert
        if (this.consecutiveFailures >= this.config.maxAttempts) {
          const escalationMessage = `🚨 [CRITICAL ALERT] Autonomous Self-Healing Failed after ${this.consecutiveFailures} consecutive attempts. System Status: ${finalStatus.toUpperCase()}. Remediation actions taken: ${remediationRes.actionsTaken.join(', ')}. Current guidance: ${finalHealth.remediation}`;
          await this.escalateAlert(escalationMessage, {
            consecutiveFailures: this.consecutiveFailures,
            initialStatus,
            finalStatus,
            actionsTaken: remediationRes.actionsTaken,
            healthChecks: finalHealth.checks,
          });
        }
      }

      // Step 6: Persist audit log to `self_healing_logs`
      const logDetails = {
        initialStatus,
        finalStatus,
        actionsTaken: remediationRes.actionsTaken,
        autoApprovedOrders: remediationRes.autoApprovedOrders,
        processedPayoutRetries: remediationRes.processedPayoutRetries,
        succeededPayoutRetries: remediationRes.succeededPayoutRetries,
        freelancerRetriedCount: remediationRes.freelancerRetriedCount,
        remediationGuidance: finalHealth.remediation,
        manualTrigger,
      };

      await insertSelfHealingLog({
        check_status: finalStatus,
        remediation_triggered: true,
        remediation_success: isResolved,
        details: logDetails,
        retry_count: this.consecutiveFailures,
      });

      return {
        status: finalStatus,
        remediationTriggered: true,
        remediationSuccess: isResolved,
        consecutiveFailures: this.consecutiveFailures,
        details: logDetails,
      };
    } catch (err: any) {
      console.error('❌ [AutoHealer] Error during self-healing cycle execution:', err);
      this.consecutiveFailures++;
      this.lastFailureAt = new Date().toISOString();
      this.isCurrentlyHealing = false;

      await insertSelfHealingLog({
        check_status: 'critical',
        remediation_triggered: true,
        remediation_success: false,
        details: { error: err.message || 'Self-healing exception' },
        retry_count: this.consecutiveFailures,
      });

      return {
        status: 'critical',
        remediationTriggered: true,
        remediationSuccess: false,
        consecutiveFailures: this.consecutiveFailures,
        details: { error: err.message },
      };
    } finally {
      this.isCycleRunning = false;
    }
  }

  /**
   * Escalate critical alert to external webhook (Slack/Discord/PagerDuty) and internal AI Support
   */
  public async escalateAlert(message: string, details?: any): Promise<boolean> {
    console.error(`🚨 [AutoHealer Escalation] ${message}`);

    // 1. Log high-severity activity event
    logActivityEvent({
      source: 'AutoHealer',
      type: 'HEALTH_ESCALATION_ALERT',
      status: 'error',
      summary: message,
      tags: ['critical_alert', 'devops_escalation', 'auto_healing_failed'],
    });

    // 2. Trigger AI Support Incident Ticket
    triggerAISupportIncident({
      category: 'DATABASE_ANOMALY',
      severity: 'critical',
      title: `DevOps Auto-Healing Escalation: ${this.consecutiveFailures} Consecutive Failures`,
      errorMessage: message,
      context: details || {},
    }).catch(() => {});

    // 3. Dispatch HTTP Post to external webhook if configured
    if (this.config.alertWebhookUrl) {
      try {
        const payload = {
          text: message,
          attachments: [
            {
              color: '#f43f5e',
              title: 'GigPilot Autonomous DevOps Escalation',
              fields: [
                { title: 'Consecutive Failures', value: String(this.consecutiveFailures), short: true },
                { title: 'Max Allowed Retries', value: String(this.config.maxAttempts), short: true },
                { title: 'Timestamp', value: new Date().toISOString(), short: false },
                { title: 'Details', value: JSON.stringify(details, null, 2), short: false },
              ],
            },
          ],
        };

        await axios.post(this.config.alertWebhookUrl, payload, {
          timeout: 8000,
          headers: { 'Content-Type': 'application/json' },
        });

        console.log(`📢 [AutoHealer] External alert webhook successfully dispatched to ${this.config.alertWebhookUrl.slice(0, 30)}...`);
        return true;
      } catch (err: any) {
        console.warn(`⚠️ [AutoHealer] Failed to send alert to ALERT_WEBHOOK_URL:`, err.message);
        return false;
      }
    } else {
      console.log('ℹ️ [AutoHealer] ALERT_WEBHOOK_URL not configured in environment. Alert recorded to activity log & AI incident feed.');
      return true;
    }
  }

  /**
   * Return comprehensive telemetry and health of the Auto-Healer
   */
  public getStatus(): AutoHealerStatus {
    const memStats = this.inMemoryQueue.getStats();

    return {
      enabled: this.config.enabled,
      intervalSeconds: this.config.intervalSeconds,
      maxAttempts: this.config.maxAttempts,
      consecutiveFailures: this.consecutiveFailures,
      recentAttemptsCount: this.recentAttemptsCount,
      lastRunAt: this.lastRunAt,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      isCurrentlyHealing: this.isCurrentlyHealing,
      alertWebhookConfigured: Boolean(this.config.alertWebhookUrl),
      escalated: this.consecutiveFailures >= this.config.maxAttempts,
      queueType: this.bullQueue && this.isUsingBullRedis ? 'bull_redis' : 'in_memory',
      queueStats: {
        waiting: memStats.pending,
        active: memStats.processing,
        completed: memStats.completed,
        failed: memStats.failed,
      },
    };
  }

  /**
   * Query recent audit logs
   */
  public async getLogs(limit: number = 50): Promise<SelfHealingLog[]> {
    return await getSelfHealingLogs(limit);
  }

  /**
   * Runtime Toggle to enable/disable automated healing loop
   */
  public toggle(enabled: boolean): AutoHealerStatus {
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
    return this.getStatus();
  }
}

// Global Singleton Instance
export const autoHealer = new AutoHealer();
