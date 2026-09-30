#!/usr/bin/env node
/**
 * Pre-flight readiness check for the GigPilot live-trading lifecycle.
 *
 * Calls the unauthenticated public health endpoints and prints a structured
 * report of what is currently holding autonomous trading back. Designed for
 * operators to run BEFORE they authenticate and press START, so they know
 * exactly what they need to do.
 *
 * What this script does NOT do:
 * - It does NOT authenticate. It does not need the owner PIN.
 * - It does NOT mutate any state. Pure read.
 * - It does NOT talk to the exchange. The unauthenticated /api/health
 *   endpoints are enough to surface most blockers; the exchange credential
 *   status, capital plan and net-edge evidence are owner-authenticated
 *   and are not probed here.
 *
 * What it CAN tell you:
 * - Whether the process is alive
 * - Whether the engine fleet is fail-closed or not
 * - Whether the kill switch is engaged
 * - Whether the safety interlocks and capital block look healthy
 * - Whether persistence is writable
 * - What the latest reliability score is
 *
 * Run after each deploy, before authenticating.
 *
 * Exit codes:
 *   0  every public check is healthy
 *   1  one or more checks failed
 *   2  bad CLI usage
 *   3  network / connectivity failure
 */

import http from 'node:http';
import https from 'node:https';

function parseArgs(argv) {
  const out = { url: 'https://35-154-110-156.sslip.io', timeoutMs: 6_000, json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--url': if (next) { out.url = next; i += 1; } break;
      case '--timeout-ms': if (next) { out.timeoutMs = Number.parseInt(next, 10) || out.timeoutMs; i += 1; } break;
      case '--json': out.json = true; break;
      case '-h':
      case '--help':
        process.stdout.write(
          [
            'Usage: node scripts/readiness-check.mjs [options]',
            '',
            'Options:',
            '  --url <URL>          Platform base URL (default: https://35-154-110-156.sslip.io)',
            '  --timeout-ms <ms>    HTTP timeout per call (default: 6000)',
            '  --json               Emit machine-readable JSON only',
            '  -h, --help           Show this help',
            '',
          ].join('\n'),
        );
        process.exit(0);
        break;
      default:
        process.stderr.write(`Unknown argument: ${arg}\n`);
        process.exit(2);
    }
  }
  return out;
}

function get(url, timeoutMs) {
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = body.length ? JSON.parse(body) : null; } catch { /* leave null */ }
        resolve({ status: res.statusCode ?? 0, body, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const ICONS = { ok: '✓', warn: '!', bad: '✗' };

function renderHuman(report) {
  const lines = [];
  lines.push('GigPilot live-trading readiness check');
  lines.push(`Platform: ${report.url}`);
  lines.push(`Time:     ${report.timestamp}`);
  lines.push('');
  lines.push(`Overall: ${report.overallOk ? 'READY (no public blockers)' : 'NOT READY'}`);
  lines.push('');

  if (report.liveness) {
    lines.push(`${report.liveness.ok ? ICONS.ok : ICONS.bad}  /api/health/ping`);
    lines.push(`     HTTP ${report.liveness.status}  ${report.liveness.detail}`);
  }
  if (report.health) {
    lines.push(`${report.health.ok ? ICONS.ok : ICONS.bad}  /api/health`);
    lines.push(`     HTTP ${report.health.status}  uptime ${report.health.uptimeSeconds}s  commit ${report.health.deployedCommit?.slice(0, 7) ?? 'unknown'}  ${report.health.tradingMode ?? ''}`);
    lines.push(`     killSwitch=${report.health.killSwitchActive ? 'ACTIVE' : 'released'}  circuitBreaker=${report.health.circuitBreakerActive ? 'ACTIVE' : 'inactive'}  equity=$${report.health.totalEquityUsd}  netPnL=$${report.health.netProfitUsd}`);
  }
  if (report.ready) {
    lines.push(`${report.ready.ok ? ICONS.ok : ICONS.warn}  /api/health/ready`);
    for (const [name, c] of Object.entries(report.ready.checks)) {
      const icon = c.ok ? ICONS.ok : ICONS.bad;
      lines.push(`     ${icon} ${name}: ${c.detail}`);
    }
  }

  lines.push('');
  lines.push('What the public health endpoints can NOT tell you (owner-authenticated only):');
  lines.push('  - whether Bybit trade-only credentials are CONNECTED vs VALIDATING');
  lines.push('  - whether the measured expected net edge clears the hurdle');
  lines.push('  - the exact capital-plan shortfall vs your allocation');
  lines.push('  - whether your Bybit account has sufficient USDT balance for the grid');
  lines.push('');
  lines.push('Run the owner-authenticated pre-flight (POST /api/trading/login -> /api/trading/autonomy/status)');
  lines.push('to see the exact blockers, then resolve them in this order:');
  lines.push('  1. Configure Bybit trade-only keys if missing');
  lines.push('  2. POST /api/trading/kill-switch/deactivate to release the safety latch');
  lines.push('  3. POST /api/trading/autonomy  with level 2+');
  lines.push('  4. POST /api/trading/grid/configure with your capital plan');
  lines.push('  5. POST /api/trading/autonomous/start with the same capital + leverage');
  lines.push('');
  lines.push('Each step has a fail-closed pre-flight: if a precondition is not met, the');
  lines.push('endpoint returns the exact reason and refuses to mutate live state.');
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv);
  const report = { url: opts.url, timestamp: new Date().toISOString() };
  let exitCode = 1;

  try {
    // Liveness: must be 200 + status:ok
    const ping = await get(`${opts.url}/api/health/ping`, opts.timeoutMs);
    report.liveness = {
      ok: ping.status === 200 && ping.json?.status === 'ok',
      status: ping.status,
      detail: ping.json?.status === 'ok' ? 'liveness ok' : `unexpected: ${ping.body.slice(0, 80)}`,
    };

    // Process + engine telemetry
    const health = await get(`${opts.url}/api/health`, opts.timeoutMs);
    report.health = {
      ok: health.status === 200 && health.json?.status === 'ok',
      status: health.status,
      uptimeSeconds: health.json?.uptimeSeconds,
      deployedCommit: health.json?.deployedCommit,
      killSwitchActive: health.json?.tradingEngine?.killSwitchActive,
      circuitBreakerActive: health.json?.tradingEngine?.circuitBreakerActive,
      tradingMode: health.json?.tradingEngine?.tradingMode,
      totalEquityUsd: health.json?.tradingEngine?.totalEquityUsd,
      netProfitUsd: health.json?.tradingEngine?.netProfitUsd,
    };

    // Readiness
    const ready = await get(`${opts.url}/api/health/ready`, opts.timeoutMs);
    report.ready = {
      ok: ready.status === 200 && ready.json?.ready === true,
      status: ready.status,
      ready: ready.json?.ready,
      activelyTrading: ready.json?.activelyTrading,
      checks: ready.json?.checks ?? {},
    };
  } catch (e) {
    report.networkError = e?.message ?? String(e);
    if (opts.json) {
      process.stdout.write(JSON.stringify({ overallOk: false, error: report.networkError }, null, 2) + '\n');
    } else {
      process.stdout.write(`Connectivity failed: ${report.networkError}\n`);
    }
    process.exit(3);
  }

  report.overallOk =
    report.liveness.ok &&
    report.health.ok &&
    report.health.killSwitchActive !== true && // released (or never engaged)
    report.ready.ready === true;
  // The system is "ready" to receive owner actions when liveness + health are ok
  // AND the readiness gate is green. Kill-switch state is informational at this
  // layer (the owner-auth pre-flight will tell them precisely how to release it).
  // Trade-only key state, net-edge evidence, and capital plan require auth.

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(report) + '\n');
  }

  exitCode = report.liveness.ok && report.health.ok && report.ready.ok ? 0 : 1;
  process.exit(exitCode);
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e?.message ?? e}\n`);
  process.exit(3);
});
