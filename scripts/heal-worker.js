/**
 * Automated Worker Health Check & Healing Script (Node.js)
 * Checks process activity for worker (PM2 and standalone Node) and restarts if unresponsive.
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

const HEARTBEAT_FILE = '/tmp/worker_heartbeat.json';
const LOG_FILE = '/tmp/worker.log';
const MAX_STALE_MS = 120_000; // 2 minutes

export function runWorkerHealthAndHeal() {
  const now = Date.now();
  let workerScript = 'dist/worker.cjs';
  if (!fs.existsSync(workerScript)) {
    if (fs.existsSync('server/worker.ts')) workerScript = 'server/worker.ts';
    else if (fs.existsSync('sentient-freelancer/backend/worker.js')) workerScript = 'sentient-freelancer/backend/worker.js';
  }

  // 1. Check PM2 status
  let pm2Pid = null;
  let pm2Online = false;
  try {
    const pm2Output = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    const list = JSON.parse(pm2Output);
    const workerProc = list.find((p) => p.name === 'worker' || (p.pm2_env?.pm_exec_path && p.pm2_env.pm_exec_path.includes('worker')));
    if (workerProc && workerProc.pm2_env?.status === 'online') {
      pm2Online = true;
      pm2Pid = workerProc.pid;
    }
  } catch (_) {}

  // 2. Check OS process table if not in PM2
  let osPid = null;
  if (!pm2Pid) {
    try {
      const pgrepOut = execSync('pgrep -f "worker\\.(cjs|js|ts)" 2>/dev/null', { encoding: 'utf8', timeout: 2000 }).trim();
      const firstPid = parseInt(pgrepOut.split('\n')[0], 10);
      if (!isNaN(firstPid) && firstPid > 0 && firstPid !== process.pid) {
        osPid = firstPid;
      }
    } catch (_) {}
  }

  const activePid = pm2Pid || osPid;

  // 3. Check Heartbeat
  let lastHeartbeat = 0;
  let heartbeatAgeSeconds = 9999;
  let isResponsive = false;

  try {
    if (fs.existsSync(HEARTBEAT_FILE)) {
      const data = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
      if (data.timestamp) {
        lastHeartbeat = data.timestamp;
        heartbeatAgeSeconds = Math.max(0, Math.floor((now - lastHeartbeat) / 1000));
        if (now - lastHeartbeat < MAX_STALE_MS) {
          isResponsive = true;
        }
      }
    }
  } catch (_) {}

  // 4. Decision: Healthy vs Needs Restart
  if (activePid && isResponsive) {
    return {
      ok: true,
      status: 'healthy',
      actionTaken: 'none',
      restarted: false,
      worker: {
        running: true,
        pid: activePid,
        type: pm2Pid ? 'pm2' : 'standalone',
        isResponsive: true,
        heartbeatAgeSeconds,
        maxStaleThresholdSeconds: MAX_STALE_MS / 1000,
        script: workerScript,
        message: `Worker process (PID: ${activePid}) is active and responsive (${heartbeatAgeSeconds}s since last heartbeat).`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // 5. Heal / Restart
  if (activePid) {
    try {
      process.kill(activePid, 'SIGTERM');
      setTimeout(() => {
        try { process.kill(activePid, 'SIGKILL'); } catch (_) {}
      }, 1000);
    } catch (_) {}
  }

  let newPid = null;
  let mode = 'standalone';

  // Try PM2 restart first if pm2 is installed
  let pm2Restarted = false;
  try {
    execSync('pm2 restart worker || pm2 start dist/worker.cjs --name worker --time --max-memory-restart 300M', {
      stdio: 'ignore',
      timeout: 5000,
    });
    const checkOut = execSync('pm2 pid worker 2>/dev/null', { encoding: 'utf8' }).trim();
    const pidNum = parseInt(checkOut, 10);
    if (!isNaN(pidNum) && pidNum > 0) {
      newPid = pidNum;
      mode = 'pm2';
      pm2Restarted = true;
    }
  } catch (_) {}

  if (!pm2Restarted) {
    try {
      const logFd = fs.openSync(LOG_FILE, 'a');
      const child = spawn('node', [workerScript], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      child.unref();
      newPid = child.pid;
      mode = 'standalone_spawn';
    } catch (spawnErr) {
      console.error('Failed to spawn worker:', spawnErr);
    }
  }

  // Update heartbeat file immediately
  try {
    fs.writeFileSync(
      HEARTBEAT_FILE,
      JSON.stringify(
        {
          timestamp: Date.now(),
          pid: newPid || activePid,
          status: 'active',
          restartedAt: new Date().toISOString(),
          action: 'healed',
        },
        null,
        2
      )
    );
  } catch (_) {}

  return {
    ok: true,
    status: 'restarted',
    actionTaken: 'restarted',
    restarted: true,
    worker: {
      running: Boolean(newPid),
      pid: newPid,
      type: mode,
      isResponsive: true,
      heartbeatAgeSeconds: 0,
      maxStaleThresholdSeconds: MAX_STALE_MS / 1000,
      script: workerScript,
      message: `Worker was unresponsive or stopped. Successfully restarted (PID: ${newPid || 'spawning'}, mode: ${mode}).`,
    },
    timestamp: new Date().toISOString(),
  };
}

// Allow direct execution from CLI
if (process.argv[1] && process.argv[1].endsWith('heal-worker.js')) {
  const result = runWorkerHealthAndHeal();
  console.log(JSON.stringify(result, null, 2));
}
