#!/usr/bin/env node
/**
 * External monitor for the GigPilot platform.
 *
 * Polls /api/health/ping, /api/health, /api/health/ready on a configured
 * cadence, asserts the documented JSON contract, and appends a one-line
 * status record to a log file. Designed to be run from cron, systemd, or
 * a CI workflow — it never writes to the platform itself, never reads
 * auth-gated endpoints, and never talks to the exchange.
 *
 * Output: a JSONL log at --log (default ./monitor.log). Each line is a
 * complete observation record so it can be tailed, grepped, or piped into
 * any log shipper without further parsing.
 *
 * Failure handling: any probe that errors, times out, or returns an
 * unexpected shape is recorded with status="degraded" and a detail string.
 * The script keeps running on the next tick — transient outages do not
 * crash the monitor.
 *
 * Exit codes:
 *   0  every probe passed
 *   1  one or more probes failed or the platform returned an unexpected shape
 *   2  bad CLI usage
 *
 * Security: nothing in this script ever accepts a secret, a token, or
 * arbitrary user input — it is intended to be safe to run with the
 * minimum possible privileges.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {
    url: 'https://35-154-110-156.sslip.io',
    cadenceMs: 30_000,
    logPath: './monitor.log',
    timeoutMs: 5_000,
    once: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--url': if (next) { out.url = next; i += 1; } break;
      case '--cadence-ms': if (next) { out.cadenceMs = Number.parseInt(next, 10) || out.cadenceMs; i += 1; } break;
      case '--log': if (next) { out.logPath = next; i += 1; } break;
      case '--timeout-ms': if (next) { out.timeoutMs = Number.parseInt(next, 10) || out.timeoutMs; i += 1; } break;
      case '--once': out.once = true; break;
      case '-h':
      case '--help':
        process.stdout.write(
          [
            'Usage: node scripts/monitor-platform.mjs [options]',
            '',
            'Options:',
            '  --url <URL>          Platform base URL (default: https://35-154-110-156.sslip.io)',
            '  --cadence-ms <ms>    Polling interval (default: 30000)',
            '  --log <PATH>         JSONL log file (default: ./monitor.log)',
            '  --timeout-ms <ms>    Per-probe HTTP timeout (default: 5000)',
            '  --once               Run a single tick and exit',
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

function probe(url, timeoutMs) {
  const lib = url.startsWith('https') ? https : http;
  const start = Date.now();
  return new Promise((resolve) => {
    const req = lib.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let json = null;
        try { json = body.length ? JSON.parse(body) : null; } catch { /* leave null */ }
        resolve({ status: res.statusCode ?? 0, body, json, latencyMs: Date.now() - start });
      });
    });
    req.on('error', (err) => resolve({ status: 0, body: '', json: null, latencyMs: Date.now() - start, error: err.message }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/** One tick: probe all three endpoints, build a single observation record. */
async function tick(opts) {
  const probes = [
    { name: 'ping', path: '/api/health/ping' },
    { name: 'health', path: '/api/health' },
    { name: 'ready', path: '/api/health/ready' },
  ];
  const results = await Promise.all(probes.map(async (p) => {
    const url = `${opts.url}${p.path}`;
    const r = await probe(url, opts.timeoutMs);
    const record = { name: p.name, url, latencyMs: r.latencyMs, httpStatus: r.status, error: r.error };
    if (p.name === 'ping') {
      record.ok = r.status === 200 && r.json?.status === 'ok';
      record.detail = record.ok ? 'ping ok' : `ping failed: ${r.error ?? `status=${r.status}`}`;
    } else if (p.name === 'health') {
      record.ok = r.status === 200 && r.json?.status === 'ok' && typeof r.json?.deployedCommit === 'string';
      record.detail = record.ok
        ? `deployedCommit=${r.json.deployedCommit?.slice(0, 7)} uptime=${r.json.uptimeSeconds}s`
        : `health failed: ${r.error ?? `status=${r.status}`}`;
      record.deployedCommit = r.json?.deployedCommit ?? null;
    } else if (p.name === 'ready') {
      const checks = r.json?.checks ?? {};
      const interlocksOk = checks?.safetyInterlocks?.ok === true;
      const capitalOk = checks?.capital?.ok === true;
      const marketOk = checks?.marketData?.ok === true;
      const enginesOk = checks?.engines?.ok === true;
      const persistenceOk = checks?.persistence?.ok === true;
      const reliabilityDetail = checks?.reliability?.detail ?? null;
      record.ok = r.status === 200 && interlocksOk && capitalOk && marketOk && enginesOk && persistenceOk;
      record.detail = record.ok
        ? `ready=${r.json?.ready}  activelyTrading=${r.json?.activelyTrading}  ${reliabilityDetail ?? ''}`
        : `ready failed: checks missing or not-ok (interlocks=${interlocksOk} capital=${capitalOk} market=${marketOk} engines=${enginesOk} persistence=${persistenceOk})`;
      record.reliabilityDetail = reliabilityDetail;
    }
    return record;
  }));

  const allOk = results.every((r) => r.ok);
  const observation = {
    timestamp: new Date().toISOString(),
    status: allOk ? 'healthy' : 'degraded',
    deployedCommit: results.find((r) => r.name === 'health')?.deployedCommit ?? null,
    reliability: results.find((r) => r.name === 'ready')?.reliabilityDetail ?? null,
    probes: results,
  };

  try {
    fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
    fs.appendFileSync(opts.logPath, JSON.stringify(observation) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    process.stderr.write(`[monitor] failed to append to log: ${e?.message ?? e}\n`);
  }

  process.stdout.write(
    `${observation.timestamp}  ${observation.status.padEnd(8)}  ` +
    `${observation.probes.map((p) => `${p.name}=${p.ok ? 'ok' : 'FAIL'}(${p.latencyMs}ms)`).join(' ')}\n`,
  );
  return observation;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.once) {
    const obs = await tick(opts);
    process.exit(obs.status === 'healthy' ? 0 : 1);
  }
  // Loop forever, but the heartbeat interval is the only thing keeping us alive.
  // SIGTERM / SIGINT should also exit cleanly so systemd / cron can stop us.
  let running = true;
  const stop = () => { running = false; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // First tick immediately so the user sees output without waiting cadenceMs.
  await tick(opts);
  while (running) {
    await new Promise((r) => setTimeout(r, opts.cadenceMs));
    if (!running) break;
    try {
      await tick(opts);
    } catch (e) {
      process.stderr.write(`[monitor] tick threw: ${e?.message ?? e}\n`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`[monitor] fatal: ${e?.message ?? e}\n`);
  process.exit(1);
});
