import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import { logActivityEvent } from './activityLogger.js';

export interface WorkerMonitorCheckEvent {
  timestamp: string;
  status: 'healthy' | 'restarted' | 'unresponsive' | 'stopped';
  actionTaken: string;
  pid: number | null;
  heartbeatAgeSeconds: number;
  triggerSource: string;
  message: string;
}

export interface WorkerMonitorStatus {
  isMonitorActive: boolean;
  intervalSeconds: number;
  lastCheckAt: string | null;
  workerStatus: 'healthy' | 'restarted' | 'unresponsive' | 'stopped';
  isResponsive: boolean;
  workerPid: number | null;
  workerType: string;
  lastHeartbeatAt: string | null;
  heartbeatAgeSeconds: number;
  totalRestarts: number;
  lastRestartAt: string | null;
  lastAction: string;
  message: string;
  history: WorkerMonitorCheckEvent[];
}

const HEARTBEAT_FILE = '/tmp/worker_heartbeat.json';
const MAX_STALE_SECONDS = 120;
const MONITOR_INTERVAL_MS = 60 * 1000;

class WorkerMonitorService {
  private isMonitorActive = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private lastCheckAt: string | null = null;
  private workerStatus: 'healthy' | 'restarted' | 'unresponsive' | 'stopped' = 'healthy';
  private isResponsive = true;
  private workerPid: number | null = null;
  private workerType = 'pm2_or_standalone';
  private lastHeartbeatAt: string | null = null;
  private heartbeatAgeSeconds = 0;
  private totalRestarts = 0;
  private lastRestartAt: string | null = null;
  private lastAction = 'initialized';
  private message = 'Worker monitor active and tracking worker.js process activity.';
  private history: WorkerMonitorCheckEvent[] = [];

  constructor() {
    this.recordWorkerHeartbeat('startup_init');
  }

  public recordWorkerHeartbeat(source = 'worker_cycle'): void {
    const now = Date.now();
    this.lastHeartbeatAt = new Date(now).toISOString();
    this.heartbeatAgeSeconds = 0;
    this.isResponsive = true;

    try {
      fs.writeFileSync(
        HEARTBEAT_FILE,
        JSON.stringify(
          {
            timestamp: now,
            pid: this.workerPid || process.pid,
            status: 'active',
            source,
            updatedAt: this.lastHeartbeatAt,
          },
          null,
          2
        )
      );
    } catch (_) {}
  }

  public async verifyAndHealWorker(triggerSource = 'background_monitor'): Promise<{
    ok: boolean;
    status: 'healthy' | 'restarted' | 'unresponsive' | 'stopped';
    actionTaken: string;
    restarted: boolean;
    worker: {
      running: boolean;
      pid: number | null;
      type: string;
      isResponsive: boolean;
      heartbeatAgeSeconds: number;
      message: string;
    };
    timestamp: string;
  }> {
    const timestamp = new Date().toISOString();
    this.lastCheckAt = timestamp;

    try {
      // 1. Prefer executing the dedicated automated bash script scripts/heal-worker.sh
      const scriptPath = path.resolve(process.cwd(), 'scripts/heal-worker.sh');
      let scriptOutput = '';

      if (fs.existsSync(scriptPath)) {
        try {
          scriptOutput = execSync(`bash "${scriptPath}"`, {
            encoding: 'utf8',
            timeout: 10000,
          });
        } catch (execErr: any) {
          if (execErr.stdout) scriptOutput = execErr.stdout.toString();
        }
      }

      // If bash script didn't run or produce valid json, try node script
      if (!scriptOutput || !scriptOutput.includes('"ok"')) {
        const jsScriptPath = path.resolve(process.cwd(), 'scripts/heal-worker.js');
        if (fs.existsSync(jsScriptPath)) {
          scriptOutput = execSync(`node "${jsScriptPath}"`, {
            encoding: 'utf8',
            timeout: 10000,
          });
        }
      }

      const parsed = JSON.parse(scriptOutput.trim());
      const isRestarted = Boolean(parsed.restarted || parsed.actionTaken === 'restarted');

      this.workerStatus = parsed.status || (isRestarted ? 'restarted' : 'healthy');
      this.isResponsive = Boolean(parsed.worker?.isResponsive);
      this.workerPid = parsed.worker?.pid || null;
      this.workerType = parsed.worker?.type || 'standalone';
      this.heartbeatAgeSeconds = Number(parsed.worker?.heartbeatAgeSeconds || 0);
      this.lastAction = parsed.actionTaken || 'none';
      this.message = parsed.worker?.message || 'Worker activity verified successfully.';

      if (this.heartbeatAgeSeconds >= 0) {
        this.lastHeartbeatAt = new Date(Date.now() - this.heartbeatAgeSeconds * 1000).toISOString();
      }

      if (isRestarted) {
        this.totalRestarts++;
        this.lastRestartAt = timestamp;

        try {
          logActivityEvent({
            source: 'WorkerMonitor',
            type: 'WORKER_AUTO_HEAL',
            status: 'warning',
            method: 'POST',
            endpoint: '/api/heal',
            statusCode: 200,
            latencyMs: 120,
            summary: `Automated recovery: worker process restarted (New PID: ${this.workerPid})`,
            details: {
              triggerSource,
              workerPid: this.workerPid,
              mode: this.workerType,
              totalRestarts: this.totalRestarts,
              reason: 'Unresponsive or stopped worker.js process detected by automated health script.',
            },
            tags: ['worker', 'auto-heal', 'sentient', 'pm2'],
          });
        } catch (_) {}
      }

      // Append to history log (keep last 25)
      this.history.unshift({
        timestamp,
        status: this.workerStatus,
        actionTaken: this.lastAction,
        pid: this.workerPid,
        heartbeatAgeSeconds: this.heartbeatAgeSeconds,
        triggerSource,
        message: this.message,
      });

      if (this.history.length > 25) {
        this.history.pop();
      }

      return {
        ok: true,
        status: this.workerStatus,
        actionTaken: this.lastAction,
        restarted: isRestarted,
        worker: {
          running: Boolean(this.workerPid),
          pid: this.workerPid,
          type: this.workerType,
          isResponsive: this.isResponsive,
          heartbeatAgeSeconds: this.heartbeatAgeSeconds,
          message: this.message,
        },
        timestamp,
      };
    } catch (err: any) {
      console.error('❌ [WorkerMonitor] Failed to execute automated heal script:', err.message);

      this.workerStatus = 'unresponsive';
      this.isResponsive = false;
      this.lastAction = 'verification_error';
      this.message = `Verification failed: ${err.message}`;

      return {
        ok: false,
        status: 'unresponsive',
        actionTaken: 'error',
        restarted: false,
        worker: {
          running: false,
          pid: this.workerPid,
          type: this.workerType,
          isResponsive: false,
          heartbeatAgeSeconds: this.heartbeatAgeSeconds,
          message: this.message,
        },
        timestamp,
      };
    }
  }

  public startMonitor(): void {
    if (this.isMonitorActive) return;
    this.isMonitorActive = true;
    console.log(`🛡️ [WorkerMonitor] Background process activity monitor started (${MONITOR_INTERVAL_MS / 1000}s interval).`);

    // Initial check
    this.verifyAndHealWorker('monitor_startup').catch(() => {});

    // Periodic check
    this.intervalTimer = setInterval(() => {
      this.verifyAndHealWorker('background_cron').catch(() => {});
    }, MONITOR_INTERVAL_MS);
  }

  public stopMonitor(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isMonitorActive = false;
  }

  public getStatus(): WorkerMonitorStatus {
    // Dynamically calculate current heartbeat age in seconds
    let currentHeartbeatAge = this.heartbeatAgeSeconds;
    if (this.lastHeartbeatAt) {
      const diffSec = Math.floor((Date.now() - new Date(this.lastHeartbeatAt).getTime()) / 1000);
      if (diffSec >= 0) currentHeartbeatAge = diffSec;
    }

    return {
      isMonitorActive: this.isMonitorActive,
      intervalSeconds: MONITOR_INTERVAL_MS / 1000,
      lastCheckAt: this.lastCheckAt,
      workerStatus: this.workerStatus,
      isResponsive: this.isResponsive && currentHeartbeatAge < MAX_STALE_SECONDS,
      workerPid: this.workerPid,
      workerType: this.workerType,
      lastHeartbeatAt: this.lastHeartbeatAt,
      heartbeatAgeSeconds: currentHeartbeatAge,
      totalRestarts: this.totalRestarts,
      lastRestartAt: this.lastRestartAt,
      lastAction: this.lastAction,
      message: this.message,
      history: this.history,
    };
  }
}

export const workerMonitor = new WorkerMonitorService();
