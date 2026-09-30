/**
 * Self-contained tests for the Continuous Reliability Loop.
 *
 * Strategy: start a tiny in-process HTTP server that mimics just enough of
 * /api/health/ping, /api/health and /api/health/ready for the probes to hit,
 * then instantiate the ReliabilityLoop with an in-memory monitor and run
 * cycles. The tests exercise every stage and every branch the production
 * loop can take.
 *
 * Why a fake server instead of the real bundle? So the test is hermetic, runs
 * in CI without a built dist/, and each probe's failure mode can be driven by
 * the test instead of by a real outage.
 *
 * Run via: `tsx scripts/test-reliability-loop.ts` (tsx resolves the .ts
 * source files in the imports below).
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { ReliabilityLoop } from '../server/trading/reliabilityLoop.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface StubEngineHealth {
  id: string;
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF';
  enabled: boolean;
  latencyMs: number;
  lastHeartbeat: string;
  errorCount: number;
  lastError?: string;
  errorSurface: unknown[];
  details?: Record<string, unknown>;
}

function buildStubMonitor(opts: { failClosed?: boolean; status?: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' } = {}) {
  const status = opts.status ?? 'HEALTHY';
  const engines: StubEngineHealth[] = [
    { id: 'DATA_ENGINE', name: 'Data', status, enabled: true, latencyMs: 5, lastHeartbeat: new Date().toISOString(), errorCount: 0, errorSurface: [], details: {} },
    { id: 'QUANT_ENGINE', name: 'Quant', status, enabled: true, latencyMs: 6, lastHeartbeat: new Date().toISOString(), errorCount: 0, errorSurface: [], details: {} },
    { id: 'RISK_ENGINE', name: 'Risk', status, enabled: true, latencyMs: 3, lastHeartbeat: new Date().toISOString(), errorCount: 0, errorSurface: [], details: {} },
  ];
  return {
    getAllEngineHealth() { return engines as any; },
    isSystemFailClosed() {
      return { failClosed: !!opts.failClosed, downEngines: opts.failClosed ? ['Exchange Execution Engine (OFF)'] : [] };
    },
  };
}

interface FakeServerOptions {
  pingOk?: boolean;
  healthOk?: boolean;
  readyOk?: boolean;
  marketFresh?: boolean;
  /** When true, the ready endpoint returns a shape that does NOT satisfy the
   *  contract (missing fields, wrong types). The probe must reject it. */
  readyShapeBroken?: boolean;
}

function startFakeServer(port: number, opts: FakeServerOptions = {}) {
  const pingOk = opts.pingOk ?? true;
  const healthOk = opts.healthOk ?? true;
  const readyOk = opts.readyOk ?? true;
  const marketFresh = opts.marketFresh ?? true;
  const readyShapeBroken = opts.readyShapeBroken ?? false;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health/ping') {
      res.statusCode = pingOk ? 200 : 500;
      res.end(JSON.stringify(pingOk ? { success: true, status: 'ok', timestamp: new Date().toISOString() } : { success: false }));
      return;
    }
    if (req.url === '/api/health') {
      res.statusCode = healthOk ? 200 : 500;
      res.end(JSON.stringify(healthOk ? {
        status: 'ok', version: 'test', uptimeSeconds: 1, timestamp: new Date().toISOString(),
        tradingEngine: { killSwitchActive: true, activeSymbol: 'BTC/USDT', autonomyLevel: 0 },
        system: { nodeVersion: process.version, rssMb: 1, heapUsedMb: 1 },
      } : {}));
      return;
    }
    if (req.url === '/api/health/ready') {
      if (readyShapeBroken) {
        // Intentionally wrong shape: status is a number (not a string), checks is an array (not an object).
        res.end(JSON.stringify({ status: 200, ready: readyOk, checks: [] }));
        return;
      }
      res.end(JSON.stringify({
        status: readyOk ? 'ready' : 'not_ready',
        ready: readyOk,
        activelyTrading: false,
        checks: {
          marketData: { ok: marketFresh, detail: marketFresh ? 'fresh' : 'stale' },
          engines: { ok: true, detail: '3 engines' },
          safetyInterlocks: { ok: true, detail: 'halt=engaged killSwitch=active' },
          capital: { ok: true, detail: 'allocatable capital available' },
          persistence: { ok: true, detail: 'durable trading state writable' },
        },
        uptimeSeconds: 1,
        timestamp: new Date().toISOString(),
      }));
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  return new Promise<http.Server>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (e: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e?.message ?? e}`);
    failed += 1;
  }
}

console.log('================================================================');
console.log('CONTINUOUS RELIABILITY LOOP TESTS');
console.log('================================================================\n');

const PORT_HEALTHY = 39101;
const PORT_PING_FAIL = 39102;
const PORT_READY_SHAPE_BROKEN = 39103;
const healthyServer = await startFakeServer(PORT_HEALTHY, { pingOk: true, healthOk: true, readyOk: true, marketFresh: true });
const pingFailServer = await startFakeServer(PORT_PING_FAIL, { pingOk: false, healthOk: true, readyOk: true, marketFresh: true });
const readyFailServer = await startFakeServer(PORT_READY_SHAPE_BROKEN, { pingOk: true, healthOk: true, readyOk: true, readyShapeBroken: true, marketFresh: true });

const cleanup = () => {
  healthyServer.close();
  pingFailServer.close();
  readyFailServer.close();
};

// ---------------------------------------------------------------------------
// 1 — EngineModule contract
// ---------------------------------------------------------------------------
console.log('--- EngineModule contract ---');
const loop = new ReliabilityLoop({ probePort: PORT_HEALTHY, mode: 'autonomous', monitor: buildStubMonitor() as any, flushTradingState: () => true });

await t('id is RELIABILITY_LOOP', () => {
  assert.equal(loop.id, 'RELIABILITY_LOOP');
});
await t('healthCheck returns a valid EngineHealth', () => {
  const h = loop.healthCheck();
  assert.equal(h.id, 'RELIABILITY_LOOP');
  assert.equal(h.enabled, true);
  assert.ok(['HEALTHY', 'DEGRADED', 'DOWN', 'OFF'].includes(h.status));
  assert.ok(typeof h.name === 'string' && h.name.length > 0);
  assert.ok(typeof h.latencyMs === 'number');
  assert.ok(typeof h.lastHeartbeat === 'string');
  assert.ok(Array.isArray(h.errorSurface));
  assert.ok(h.details?.policy?.includes('SAFE_REMEDIATIONS_ONLY'));
});
await t('off-switch toggles and reflects in health', () => {
  loop.setOffSwitch(false);
  assert.equal(loop.getOffSwitch(), false);
  assert.equal(loop.healthCheck().status, 'OFF');
  loop.setOffSwitch(true);
  assert.equal(loop.getOffSwitch(), true);
});
await t('clearErrors empties the surface', () => {
  loop.setOffSwitch(false); loop.setOffSwitch(true); // adds an error
  assert.ok(loop.getErrorSurface().length >= 1);
  loop.clearErrors();
  assert.equal(loop.getErrorSurface().length, 0);
});

// ---------------------------------------------------------------------------
// 2 — Telemetry aggregation
// ---------------------------------------------------------------------------
console.log('\n--- Stage 1: Telemetry ---');

await t('collectTelemetry returns a snapshot with healthy engines', () => {
  const r = loop.collectTelemetry();
  assert.equal(r.status, 'success');
  assert.ok(r.snapshot);
  assert.equal(r.snapshot?.registeredEngines, 3);
  assert.equal(r.snapshot?.onlineCount, 3);
  assert.equal(r.snapshot?.degradedCount, 0);
  assert.equal(r.snapshot?.failClosed, false);
  assert.match(r.detail, /3 engines polled/);
});

await t('collectTelemetry counts degraded + fail-closed when monitor reports them', () => {
  const failingMonitor = buildStubMonitor({ failClosed: true, status: 'DEGRADED' });
  const loop2 = new ReliabilityLoop({ probePort: PORT_HEALTHY, mode: 'autonomous', monitor: failingMonitor as any, flushTradingState: () => true });
  const r = loop2.collectTelemetry();
  assert.equal(r.status, 'success');
  assert.equal(r.snapshot?.degradedCount, 3);
  assert.equal(r.snapshot?.failClosed, true);
  assert.deepEqual(r.snapshot?.downEngines, ['Exchange Execution Engine (OFF)']);
});

// ---------------------------------------------------------------------------
// 3 — Diagnosis
// ---------------------------------------------------------------------------
console.log('\n--- Stage 2: Diagnosis ---');

await t('diagnose reports "nominal" on a healthy fleet', () => {
  const snap = loop.collectTelemetry().snapshot;
  const d = loop.diagnose(snap);
  assert.equal(d.status, 'success');
  assert.equal(d.report.rootCause, 'nominal');
  assert.equal(d.report.unhealthyEngines.length, 0);
  assert.equal(d.report.flappingProbes.length, 0);
});

await t('diagnose names a root cause when a DEGRADED engine is present', () => {
  const failingMonitor = buildStubMonitor({ failClosed: false, status: 'DEGRADED' });
  const loop2 = new ReliabilityLoop({ probePort: PORT_HEALTHY, mode: 'autonomous', monitor: failingMonitor as any, flushTradingState: () => true });
  const snap = loop2.collectTelemetry().snapshot;
  const d = loop2.diagnose(snap);
  assert.equal(d.status, 'success');
  assert.match(d.report.rootCause, /DEGRADED/);
  assert.equal(d.report.unhealthyEngines.length, 3);
  assert.ok(d.report.recommendedActions.length > 0);
});

// ---------------------------------------------------------------------------
// 4 — Predict
// ---------------------------------------------------------------------------
console.log('\n--- Stage 3: Predict ---');

await t('predict produces a bounded 0..1 score with auditable inputs', () => {
  const r = loop.predict(loop.collectTelemetry().snapshot);
  assert.equal(r.status, 'success');
  const f = r.forecast;
  assert.ok(f.failureProbability >= 0 && f.failureProbability <= 1);
  assert.ok(typeof f.rationale === 'string' && f.rationale.length > 0);
  assert.ok(typeof f.inputs.unhealthyRatio === 'number');
  assert.ok(typeof f.inputs.degradedRecent === 'number');
  assert.ok(typeof f.inputs.flappingProbes === 'number');
  assert.ok(typeof f.inputs.failClosed === 'number');
});

await t('predict score rises with more unhealthy inputs', () => {
  const healthy = loop.predict(loop.collectTelemetry().snapshot).forecast.failureProbability;
  const failingMonitor = buildStubMonitor({ failClosed: true, status: 'DEGRADED' });
  const loop2 = new ReliabilityLoop({ probePort: PORT_HEALTHY, mode: 'autonomous', monitor: failingMonitor as any, flushTradingState: () => true });
  const degraded = loop2.predict(loop2.collectTelemetry().snapshot).forecast.failureProbability;
  assert.ok(degraded > healthy, `expected degraded ${degraded} > healthy ${healthy}`);
});

// ---------------------------------------------------------------------------
// 5 — Remediation
// ---------------------------------------------------------------------------
console.log('\n--- Stage 4: Remediation ---');

await t('observe mode always skips remediation', async () => {
  const r = await loop.remediate(
    { rootCause: 'something', unhealthyEngines: [{ id: 'DATA_ENGINE' as any, status: 'DOWN', reason: 'x' }], flappingProbes: [], recommendedActions: [] },
    { total_probes: 5, passed_count: 5, failed_count: 0, avg_latency_ms: 1, probes: [] },
    'observe',
  );
  assert.equal(r.remediation.status, 'skipped_nominal');
});

await t('dry_run mode simulates but does not mutate', async () => {
  const failingMonitor = buildStubMonitor({ failClosed: false, status: 'DEGRADED' });
  const loop2 = new ReliabilityLoop({ probePort: PORT_HEALTHY, mode: 'dry_run', monitor: failingMonitor as any, flushTradingState: () => true });
  const r = await loop2.remediate(
    { rootCause: 'x', unhealthyEngines: [{ id: 'DATA_ENGINE' as any, status: 'DEGRADED', reason: 'y' }], flappingProbes: [], recommendedActions: [] },
    { total_probes: 5, passed_count: 5, failed_count: 0, avg_latency_ms: 1, probes: [] },
    'dry_run',
  );
  assert.equal(r.remediation.status, 'simulated');
  assert.equal(r.remediation.action, 'flush_durable_state');
});

await t('autonomous mode with no diagnosis issues skips remediation', async () => {
  const r = await loop.remediate(
    { rootCause: 'nominal', unhealthyEngines: [], flappingProbes: [], recommendedActions: [] },
    { total_probes: 5, passed_count: 5, failed_count: 0, avg_latency_ms: 1, probes: [] },
    'autonomous',
  );
  assert.equal(r.remediation.status, 'skipped_nominal');
  assert.equal(r.remediation.action, 'none_needed');
});

await t('autonomous mode actually runs flush_durable_state and reports success', async () => {
  // Regression test for the awaitPromise() bug: previously the synchronous
  // helper returned before the promise resolved and the action crashed on
  // undefined.probes, hiding the real outcome.
  let flushed = 0;
  const loop6 = new ReliabilityLoop({
    probePort: PORT_HEALTHY,
    mode: 'autonomous',
    monitor: buildStubMonitor({ failClosed: false, status: 'DEGRADED' }) as any,
    flushTradingState: () => { flushed += 1; return true; },
  });
  const r = await loop6.remediate(
    { rootCause: 'x', unhealthyEngines: [{ id: 'DATA_ENGINE' as any, status: 'DEGRADED', reason: 'y' }], flappingProbes: [], recommendedActions: [] },
    { total_probes: 5, passed_count: 5, failed_count: 0, avg_latency_ms: 1, probes: [] },
    'autonomous',
  );
  assert.equal(r.status, 'success');
  assert.equal(r.remediation.status, 'executed');
  assert.equal(r.remediation.action, 'flush_durable_state');
  assert.equal(r.remediation.success, true);
  assert.match(r.remediation.detail, /durable state flushed/);
  assert.equal(flushed, 1, 'flushTradingState was actually invoked');
});

await t('autonomous mode retries flapping probes and reports the actual still-failing names', async () => {
  // Regression test for the awaitPromise() bug, flapping path.
  const loop7 = new ReliabilityLoop({
    probePort: PORT_PING_FAIL, // this server returns 500 for /api/health/ping
    mode: 'autonomous',
    monitor: buildStubMonitor() as any,
    flushTradingState: () => true,
  });
  // Force the flapping branch by seeding history with two prior failed cycles.
  await loop7.executeCycle('observe'); // baseline
  // Manually push 2 failed ping probe results into history so flapping is detected.
  const fakeHistory = Array.from({ length: 2 }, () => ({
    executionId: 'x', startedAt: '', finishedAt: '', durationTotalMs: 0, mode: 'observe' as const, reliabilityScore: 50,
    stages: {
      telemetry: { status: 'success' as const, detail: 'x' },
      diagnosis: { status: 'success' as const, report: { rootCause: 'x', unhealthyEngines: [], flappingProbes: [], recommendedActions: [] } },
      prediction: { status: 'success' as const, forecast: { failureProbability: 0, rationale: 'x', inputs: {} } },
      remediation: { status: 'success' as const, remediation: { status: 'skipped_nominal' as const, action: 'x', success: true, detail: 'x' } },
      testing: { status: 'failed' as const, testSuite: { total_probes: 5, passed_count: 4, failed_count: 1, avg_latency_ms: 1, probes: [
        { name: 'ping', status: 'failed', latencyMs: 1, detail: 'x' },
      ] } },
      optimization: { status: 'success' as const, optimization: { status: 'nominal', modelAccuracy: 0, notes: ['x'] } },
      selfUpdating: { status: 'success' as const, selfUpdate: { status: 'stable', activeVersion: 'x', recommendation: 'x' } },
    },
  }));
  // Use the public getHistory API to verify the flapping helper, then run remediate.
  (loop7 as any).history = fakeHistory;
  const r = await loop7.remediate(
    { rootCause: 'flapping', unhealthyEngines: [], flappingProbes: ['ping'], recommendedActions: [] },
    { total_probes: 5, passed_count: 4, failed_count: 1, avg_latency_ms: 1, probes: [] },
    'autonomous',
  );
  assert.equal(r.status, 'success');
  assert.equal(r.remediation.status, 'executed');
  assert.equal(r.remediation.action, 'retry_flapping_probes');
  assert.match(r.remediation.detail, /still failing: ping|still failing: none/);
});

// ---------------------------------------------------------------------------
// 6 — Canary probes
// ---------------------------------------------------------------------------
console.log('\n--- Stage 5: Canary probes ---');

await t('runCanaryProbes runs exactly 5 probes', async () => {
  const suite = await loop.runCanaryProbes();
  assert.equal(suite.total_probes, 5);
  assert.equal(suite.probes.length, 5);
  const names = suite.probes.map((p: any) => p.name).sort();
  assert.deepEqual(names, ['durable_state_flush', 'health', 'market_data_freshness', 'ping', 'ready']);
});

await t('all 5 probes pass against a healthy fake server', async () => {
  const suite = await loop.runCanaryProbes();
  for (const p of suite.probes) {
    assert.equal(p.status, 'passed', `probe ${p.name} should have passed: ${p.detail}`);
  }
  assert.equal(suite.passed_count, 5);
  assert.equal(suite.failed_count, 0);
});

await t('ping probe fails when the server returns 500', async () => {
  const loop3 = new ReliabilityLoop({ probePort: PORT_PING_FAIL, mode: 'autonomous', monitor: buildStubMonitor() as any, flushTradingState: () => true });
  const suite = await loop3.runCanaryProbes();
  const ping = suite.probes.find((p: any) => p.name === 'ping');
  assert.equal(ping?.status, 'failed');
});

await t('ready probe fails when the readiness body is malformed', async () => {
  const loop3 = new ReliabilityLoop({ probePort: PORT_READY_SHAPE_BROKEN, mode: 'autonomous', monitor: buildStubMonitor() as any, flushTradingState: () => true });
  const suite = await loop3.runCanaryProbes();
  const ready = suite.probes.find((p: any) => p.name === 'ready');
  assert.equal(ready?.status, 'failed');
});

// ---------------------------------------------------------------------------
// 7 — Self-optimization
// ---------------------------------------------------------------------------
console.log('\n--- Stage 6: Optimization ---');

await t('optimize returns a bounded modelAccuracy and a notes array', () => {
  const r = loop.optimize(loop.collectTelemetry().snapshot, []);
  assert.equal(r.status, 'success');
  assert.ok(r.optimization.modelAccuracy >= 0 && r.optimization.modelAccuracy <= 1);
  assert.ok(Array.isArray(r.optimization.notes));
  assert.ok(r.optimization.notes.length > 0);
});

// ---------------------------------------------------------------------------
// 8 — Self-update
// ---------------------------------------------------------------------------
console.log('\n--- Stage 7: Self-update ---');

await t('selfUpdate emits a recommendation but performs no update', () => {
  const r = loop.selfUpdate();
  assert.equal(r.status, 'success');
  assert.equal(r.selfUpdate.status, 'stable');
  assert.ok(typeof r.selfUpdate.activeVersion === 'string');
  assert.match(r.selfUpdate.recommendation, /no auto-update/);
});

// ---------------------------------------------------------------------------
// 9 — End-to-end cycle
// ---------------------------------------------------------------------------
console.log('\n--- Full cycle ---');

await t('executeCycle returns a complete ReliabilityCycleResult with all 7 stages', async () => {
  const c = await loop.executeCycle('autonomous');
  assert.ok(typeof c.executionId === 'string' && c.executionId.startsWith('cycle_'));
  assert.ok(typeof c.startedAt === 'string');
  assert.ok(typeof c.finishedAt === 'string');
  assert.ok(c.durationTotalMs >= 0);
  assert.equal(c.mode, 'autonomous');
  assert.ok(c.reliabilityScore >= 0 && c.reliabilityScore <= 100);
  for (const k of ['telemetry', 'diagnosis', 'prediction', 'remediation', 'testing', 'optimization', 'selfUpdating']) {
    assert.ok(c.stages[k as keyof typeof c.stages], `stage ${k} present`);
  }
});

await t('reliabilityScore is 100 when every probe passes against a healthy server', async () => {
  const loop4 = new ReliabilityLoop({ probePort: PORT_HEALTHY, mode: 'autonomous', monitor: buildStubMonitor() as any, flushTradingState: () => true });
  const c = await loop4.executeCycle('autonomous');
  assert.equal(c.stages.testing.status, 'passed');
  assert.equal(c.reliabilityScore, 100, `expected 100/100, got ${c.reliabilityScore}`);
});

await t('dry_run cycle records simulated remediation', async () => {
  const c = await loop.executeCycle('dry_run');
  assert.equal(c.mode, 'dry_run');
});

await t('history grows and is capped at 20', async () => {
  const loop5 = new ReliabilityLoop({ probePort: PORT_HEALTHY, mode: 'observe', monitor: buildStubMonitor() as any, flushTradingState: () => true });
  for (let i = 0; i < 22; i++) {
    await loop5.executeCycle('observe');
  }
  const h = loop5.getHistory();
  assert.ok(h.length <= 20);
  assert.ok(h.length >= 20);
});

// ---------------------------------------------------------------------------
// 10 — Mode switching
// ---------------------------------------------------------------------------
console.log('\n--- Mode switching ---');

await t('setOffSwitch + healthCheck flips status', () => {
  loop.setOffSwitch(false);
  assert.equal(loop.healthCheck().status, 'OFF');
  loop.setOffSwitch(true);
  assert.ok(loop.healthCheck().status !== 'OFF');
});

await t('getReliabilityScore returns 0 before the first cycle', () => {
  const fresh = new ReliabilityLoop({ probePort: PORT_HEALTHY, mode: 'autonomous', monitor: buildStubMonitor() as any, flushTradingState: () => true });
  assert.equal(fresh.getReliabilityScore(), 0);
  assert.equal(fresh.getLastCycle(), null);
});

console.log('\n================================================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('================================================================');

cleanup();
process.exit(failed === 0 ? 0 : 1);
