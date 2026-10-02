/**
 * RUNTIME INVARIANTS — behaviour that only exists while the process is actually running.
 *
 * The static tests (test-repo-integrity, test-ui-api-contract, test-api-shape) prove source-level
 * facts. These assertions EXECUTE the real modules and processes, because the defects they guard
 * are invisible to source inspection:
 *
 *   [1] The ownership gate must actually stop construction-time work, not merely appear to.
 *   [2] A restart must come up FAIL-CLOSED (kill switch engaged, autonomy 0, engine disarmed).
 *   [3] The webhook verifier must fail CLOSED and must not accept unsigned deliveries.
 *   [4] The worker process must start when background loops are disabled, and must REFUSE to
 *       start when they are not — otherwise it silently becomes a second trader.
 *
 * Run: node --experimental-strip-types scripts/test-runtime-invariants.ts
 */
import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let checks = 0;
const fail = (m: string) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m: string) => { checks++; console.log(`  ✔ ${m}`); };

console.log('Runtime Invariants');
console.log('==================');

// ---------------------------------------------------------------------------------------------
// [1] OWNERSHIP GATE, AT RUNTIME
// The flag MUST be set before the store module is evaluated: the store is a module-level
// singleton, so importing it is what starts (or must not start) the background work.
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('[1] Ownership gate stops construction-time work');

process.env.GIGPILOT_DISABLE_BACKGROUND_LOOPS = '1';

const { ownsBackgroundLoops } = await import('../server/trading/backgroundOwnership.ts');
if (ownsBackgroundLoops() === false) pass('ownsBackgroundLoops() is false when the flag is set');
else fail('ownsBackgroundLoops() ignored GIGPILOT_DISABLE_BACKGROUND_LOOPS=1');

const { globalTradingStore } = await import('../server/trading/store.ts');

const dataHealth: any = globalTradingStore.dataEngine.healthCheck();
const liveFeeds = Number(dataHealth?.details?.liveFeedsActive ?? -1);
const wsConnected = dataHealth?.details?.wsConnected;
if (liveFeeds === 0 && wsConnected === false) {
  pass(`DataEngine did NOT start ingestion in a non-owner process (liveFeedsActive=${liveFeeds}, wsConnected=${wsConnected})`);
} else {
  fail(`DataEngine started ingestion despite the gate (liveFeedsActive=${liveFeeds}, wsConnected=${wsConnected}) — duplicate Bybit feeds`);
}

// ---------------------------------------------------------------------------------------------
// [2] RESTART RECOVERY MUST BE FAIL-CLOSED
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('[2] A restart comes up fail-closed');

if (globalTradingStore.GLOBAL_KILL_SWITCH_ACTIVE === true) pass('GLOBAL_KILL_SWITCH_ACTIVE is true at construction');
else fail('GLOBAL_KILL_SWITCH_ACTIVE is not engaged at construction');

const killState: any = globalTradingStore.killSwitch.getState();
if (killState?.isActive === true) pass('emergency kill switch reports isActive=true at construction');
else fail(`emergency kill switch is not active at construction (isActive=${killState?.isActive})`);

if (globalTradingStore.autonomyLevel === 0) pass('autonomyLevel starts at 0 (observe only)');
else fail(`autonomyLevel starts at ${globalTradingStore.autonomyLevel}, expected 0`);

if (globalTradingStore.tradingMode === 'LIVE') pass("tradingMode is the readonly 'LIVE' invariant (live-only platform)");
else fail(`tradingMode is '${globalTradingStore.tradingMode}'`);

// ---------------------------------------------------------------------------------------------
// [3] WEBHOOK SIGNATURE VERIFICATION
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('[3] Webhook signature verification fails closed');

const { verifyGitHubSignature } = await import('../server/githubService.ts');
const SECRET = 'runtime-invariant-webhook-secret';
const body = JSON.stringify({ zen: 'Keep it logically awesome.' });
const sign = (payload: string, secret: string, algo = 'sha256') =>
  `sha256=${crypto.createHmac(algo, secret).update(Buffer.from(payload)).digest('hex')}`;

delete process.env.GITHUB_WEBHOOK_SECRET;
delete process.env.WEBHOOK_SECRET;
const noSecret = verifyGitHubSignature(sign(body, SECRET), body, 'push');
if (noSecret.valid === false) pass('with NO secret configured the verifier REFUSES (fail-closed)');
else fail('with no secret configured the verifier still accepts — fail-open security gate');

process.env.GITHUB_WEBHOOK_SECRET = SECRET;

const unsigned = verifyGitHubSignature(undefined, body, 'push');
if (unsigned.valid === false) pass('unsigned push delivery is rejected');
else fail('unsigned push delivery was accepted');

const unsignedPing = verifyGitHubSignature(undefined, body, 'ping');
if (unsignedPing.valid === false) pass('unsigned PING is rejected (the handshake bypass is gone)');
else fail('unsigned ping was accepted — anyone could write a VERIFIED entry into the audit trail');

const good = verifyGitHubSignature(sign(body, SECRET), body, 'push');
if (good.valid === true) pass('a correctly signed delivery is accepted');
else fail(`a correctly signed delivery was rejected (${good.reason})`);

const wrongSecret = verifyGitHubSignature(sign(body, 'not-the-secret'), body, 'push');
if (wrongSecret.valid === false) pass('a signature from the wrong secret is rejected');
else fail('a signature computed with a different secret was accepted');

const malformed = verifyGitHubSignature('sha1=deadbeef', body, 'push');
if (malformed.valid === false) pass('a malformed signature header is rejected');
else fail('a malformed signature header was accepted');

const tampered = verifyGitHubSignature(sign(body, SECRET), body + ' ', 'push');
if (tampered.valid === false) pass('a signature over a different body is rejected (payload tampering)');
else fail('payload tampering was accepted');

// ---------------------------------------------------------------------------------------------
// [4] WORKER PROCESS STARTUP
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('[4] Worker process startup behaviour');

// CI runs the test suite BEFORE `npm run build`, so the worker bundle under test is normally
// built on demand by the `test:runtime` npm script and pointed at via WORKER_BUNDLE.
const WORKER = path.resolve(ROOT, process.env.WORKER_BUNDLE || path.join('dist', 'worker.cjs'));

function runWorker(env: NodeJS.ProcessEnv, ms: number): Promise<{ code: number | null; signal: string | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, ms);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out, err });
    });
  });
}

if (!fs.existsSync(WORKER)) {
  fail(`worker bundle not found at ${path.relative(ROOT, WORKER)} — cannot verify worker startup or ownership-gate propagation`);
} else {
  // Without the flag the worker must refuse to start: that is what stops it silently becoming a
  // second trading process.
  const noFlagEnv = { ...process.env };
  delete (noFlagEnv as any).GIGPILOT_DISABLE_BACKGROUND_LOOPS;
  const refused = await runWorker({ ...noFlagEnv, GIGPILOT_DISABLE_BACKGROUND_LOOPS: '' }, 8000);
  if (refused.code === 1 && /FATAL/.test(refused.err)) {
    pass('worker exits 1 with a FATAL message when background ownership is not disabled');
  } else {
    fail(`worker did not refuse to start without the flag (code=${refused.code}, signal=${refused.signal})`);
  }

  // With the flag it must stay alive as a liveness worker and must not claim to own the loops.
  const alive = await runWorker({ GIGPILOT_DISABLE_BACKGROUND_LOOPS: '1' }, 6000);
  const stayedUp = alive.signal === 'SIGKILL';
  if (stayedUp && /liveness\/telemetry worker/.test(alive.out)) {
    pass('worker stays up when the flag is set and reports itself as a liveness worker');
  } else {
    fail(`worker did not stay up with the flag set (code=${alive.code}, signal=${alive.signal}, out=${alive.out.slice(0, 200).replace(/\n/g, ' ')}`);
  }
  if (/GIGPILOT_DISABLE_BACKGROUND_LOOPS is not set/.test(alive.err)) {
    fail('worker printed the misconfiguration FATAL even though the flag was set');
  } else {
    pass('worker did not raise the misconfiguration FATAL when the flag was set');
  }
}

console.log('');
console.log(`Result: ${checks} passed, ${failures} failed`);
if (failures > 0) {
  console.log('RUNTIME INVARIANTS VIOLATED.');
  process.exit(1);
}
console.log('ALL RUNTIME INVARIANTS HOLD.');
process.exit(0);
