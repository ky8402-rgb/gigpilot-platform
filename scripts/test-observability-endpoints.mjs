#!/usr/bin/env node
/**
 * Observability contract test for the production server bundle.
 *
 * The /api/health/* endpoints are intentionally reachable without authentication so
 * that monitoring, the deploy gate, and the kill-switch can always observe the
 * process. Their response shape is a public contract: a future regression would
 * silently blind monitoring and the deploy rollback gate. This test pins that
 * contract by booting the production bundle on a private port and asserting the
 * documented JSON shape.
 *
 * The test is hermetic. No .env, no Bybit credentials, no DATABASE_URL — the
 * endpoints under test only depend on the process being alive and on durable
 * state being writable.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const bundle = path.join(repoRoot, 'dist', 'server.cjs');

const TEST_PORT = 38911;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${label}`);
    failed += 1;
  }
}

function getJson(p) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${p}`, { timeout: 5000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = body.length ? JSON.parse(body) : null; } catch { /* leave null */ }
        resolve({ status: res.statusCode, headers: res.headers, body, json: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await getJson('/api/health/ping');
      if (r.status === 200 && r.json && r.json.status === 'ok') return;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`server did not respond on ${BASE} within ${timeoutMs} ms`);
}

async function main() {
  console.log('================================================================');
  console.log('OBSERVABILITY ENDPOINT CONTRACT TEST');
  console.log('================================================================\n');

  if (!await fileExists(bundle)) {
    console.error(`Missing production bundle: ${bundle}. Run \`npm run build\` first.`);
    process.exit(2);
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(TEST_PORT),
    GLOBAL_KILL_SWITCH_ACTIVE: 'true',
    OWNER_SESSION_SECRET: 'observability-test-only-not-a-real-secret',
  };

  const child = spawn('node', [bundle], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf8'); });

  try {
    await waitForServer(15_000);
  } catch (err) {
    console.error('Server failed to boot within timeout.');
    console.error('--- stderr ---');
    console.error(stderrBuf);
    child.kill('SIGTERM');
    process.exit(1);
  }

  // ---- /api/health/ping ----
  console.log('--- /api/health/ping (liveness, unauthenticated) ---');
  {
    const r = await getJson('/api/health/ping');
    assert(r.status === 200, 'HTTP 200');
    assert(r.json !== null, 'response is JSON');
    assert(r.json && r.json.success === true, 'success === true');
    assert(r.json && r.json.status === 'ok', 'status === "ok"');
    assert(r.json && typeof r.json.timestamp === 'string' && !Number.isNaN(Date.parse(r.json.timestamp)), 'timestamp is parseable ISO');
    assert(r.headers['content-type'] && r.headers['content-type'].includes('application/json'), 'Content-Type is JSON');
  }

  // ---- /api/health ----
  console.log('\n--- /api/health (process + engine telemetry, unauthenticated) ---');
  {
    const r = await getJson('/api/health');
    assert(r.status === 200, 'HTTP 200');
    assert(r.json && r.json.status === 'ok', 'status === "ok"');
    assert(r.json && typeof r.json.service === 'string', 'service is a string');
    assert(r.json && typeof r.json.version === 'string', 'version is a string');
    assert(r.json && typeof r.json.uptimeSeconds === 'number' && r.json.uptimeSeconds >= 0, 'uptimeSeconds is a non-negative number');
    assert(r.json && typeof r.json.timestamp === 'string', 'timestamp is a string');
    assert(r.json && r.json.system && typeof r.json.system.nodeVersion === 'string', 'system.nodeVersion present');
    assert(r.json && r.json.system && Number.isFinite(r.json.system.rssMb), 'system.rssMb numeric');
    assert(r.json && r.json.tradingEngine && typeof r.json.tradingEngine.killSwitchActive === 'boolean', 'tradingEngine.killSwitchActive boolean');
    // deployedCommit may be null in a sandbox, but the field must exist
    assert(r.json && Object.prototype.hasOwnProperty.call(r.json, 'deployedCommit'), 'deployedCommit key present');
  }

  // ---- /api/health/ready ----
  console.log('\n--- /api/health/ready (deploy-gate signal, unauthenticated) ---');
  {
    const r = await getJson('/api/health/ready');
    assert(r.status === 200, 'HTTP 200 (always — see /ready docstring)');
    assert(r.json && (r.json.status === 'ready' || r.json.status === 'not_ready'), 'status is "ready" or "not_ready"');
    assert(r.json && typeof r.json.ready === 'boolean', 'ready boolean');
    assert(r.json && typeof r.json.activelyTrading === 'boolean', 'activelyTrading boolean');
    assert(r.json && r.json.checks && typeof r.json.checks === 'object', 'checks is an object');
    // Each documented probe must be present
    for (const key of ['marketData', 'engines', 'safetyInterlocks', 'capital', 'persistence', 'reliability']) {
      assert(r.json && r.json.checks[key] && typeof r.json.checks[key].ok === 'boolean', `checks.${key}.ok boolean`);
      assert(r.json && r.json.checks[key] && typeof r.json.checks[key].detail === 'string', `checks.${key}.detail string`);
    }
    // Safety interlocks, capital, and reliability MUST always be ok (informational only).
    assert(r.json && r.json.checks.safetyInterlocks.ok === true, 'safetyInterlocks always ok');
    assert(r.json && r.json.checks.capital.ok === true, 'capital ok is observed (not a gate)');
    assert(r.json && r.json.checks.reliability.ok === true, 'reliability ok is observed (not a gate)');
    // Reliability detail must be either "warming up" or score+probes+timestamp.
    const reliabilityDetail = r.json && r.json.checks.reliability && r.json.checks.reliability.detail;
    assert(
      typeof reliabilityDetail === 'string' && (
        reliabilityDetail.startsWith('reliability loop warming up') ||
        /reliability score \d+\/100; probes \d+\/\d+ passed; last cycle /.test(reliabilityDetail)
      ),
      'reliability.detail has expected format',
    );
    // In a fail-closed sandbox with GLOBAL_KILL_SWITCH_ACTIVE=true, engines must report as not-healthy
    // and ready must be false — but the endpoint MUST respond, not 5xx.
    if (process.env.GLOBAL_KILL_SWITCH_ACTIVE === 'true') {
      assert(r.json && r.json.ready === false, 'ready is false in the deliberate fail-closed sandbox');
      assert(r.json && r.json.activelyTrading === false, 'activelyTrading false in fail-closed sandbox');
    }
  }

  // ---- unknown API path is JSON, not HTML ----
  console.log('\n--- /api/* contract for unknown paths ---');
  {
    const r = await getJson('/api/this-does-not-exist');
    assert(r.status === 404, 'unknown API route returns 404');
    assert(r.json && r.json.success === false, 'unknown API route returns JSON with success:false');
    assert(r.json && typeof r.json.error === 'string', 'unknown API route returns JSON with an error string');
  }

  // ---- /api/trading/state is auth-gated ----
  console.log('\n--- /api/trading/state auth gate ---');
  {
    const r = await getJson('/api/trading/state');
    assert(r.status === 401, 'trading state is 401 without owner token');
    assert(r.json && r.json.success === false, 'trading state refuses unauthenticated JSON');
    assert(r.json && typeof r.json.error === 'string' && r.json.error.length > 0, 'trading state refusal explains why');
  }

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  child.kill('SIGTERM');
  // Give it a moment to flush
  await new Promise((res) => setTimeout(res, 250));

  process.exit(failed === 0 ? 0 : 1);
}

async function fileExists(p) {
  try {
    const { stat } = await import('node:fs/promises');
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
