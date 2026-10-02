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
// [4] EXECUTION SAFETY: idempotency key + honest failure classification
// Exercised against the REAL engine with a stubbed transport, because these are exactly the
// behaviours a future refactor can silently remove.
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('[4] Execution idempotency and honest failure classification');

const { ExchangeExecutionEngine } = await import('../server/trading/exchangeExecutionEngine.ts');
const engine: any = new ExchangeExecutionEngine();
engine.setOffSwitch(true); // enable execution for the duration of this test
engine.configureKeys('BYBIT', 'runtime-test-key', 'runtime-test-secret');

const realFetch = globalThis.fetch;
let capturedBody: any = null;
let transport: 'ok' | 'network' | 'reject' | 'http5xx' = 'ok';

(globalThis as any).fetch = async (_url: string, init: any) => {
  capturedBody = init?.body ? JSON.parse(init.body) : null;
  if (transport === 'network') throw new Error('socket hang up');
  if (transport === 'reject') {
    return { ok: true, status: 200, json: async () => ({ retCode: 110001, retMsg: 'order value invalid' }) };
  }
  if (transport === 'http5xx') {
    return { ok: false, status: 502, json: async () => ({}) };
  }
  return { ok: true, status: 200, json: async () => ({ retCode: 0, result: { orderId: 'EXCH-ORDER-1' } }) };
};

const spec = {
  symbol: 'BTC/USDT',
  side: 'BUY' as const,
  type: 'LIMIT' as const,
  price: 50000,
  amount: 0.001,
};

try {
  // (a) the submission carries an idempotency key
  transport = 'ok';
  const okRes: any = await engine.executeOrder(spec);
  if (capturedBody && typeof capturedBody.orderLinkId === 'string' && capturedBody.orderLinkId.length > 0) {
    pass(`live order carries an orderLinkId idempotency key (${capturedBody.orderLinkId})`);
  } else {
    fail('live order was submitted WITHOUT an orderLinkId — a lost response could not be resolved and a retry would double the position');
  }
  if (okRes.success && okRes.order?.clientOrderId === capturedBody.orderLinkId) {
    pass('the local order records the same clientOrderId that was sent to the exchange');
  } else {
    fail('the local order does not record the clientOrderId that was sent');
  }
  if (okRes.order?.status === 'OPEN') pass('a successful submission yields an OPEN order');
  else fail(`a successful submission produced status ${okRes.order?.status}`);

  // (b) a definitive exchange refusal is REJECTED
  transport = 'reject';
  const rejRes: any = await engine.executeOrder(spec);
  if (rejRes.order?.status === 'REJECTED' && rejRes.success === false) {
    pass('a parsed non-zero retCode is reported as REJECTED (definitive refusal)');
  } else {
    fail(`a definitive refusal produced ${rejRes.order?.status}, expected REJECTED`);
  }

  // (c) a network failure is UNKNOWN, never REJECTED
  transport = 'network';
  const netRes: any = await engine.executeOrder(spec);
  if (netRes.order?.status === 'UNKNOWN') {
    pass('a network failure is reported as UNKNOWN (the order may exist), NOT rejected');
  } else {
    fail(`a network failure produced ${netRes.order?.status}, expected UNKNOWN — REJECTED here would invite a duplicate order`);
  }
  if (netRes.order?.clientOrderId) {
    pass('an UNKNOWN order retains its clientOrderId so it can be resolved later');
  } else {
    fail('an UNKNOWN order lost its clientOrderId and can no longer be resolved');
  }
  const retained = engine.getOpenOrders().some((o: any) => o.status === 'UNKNOWN');
  if (retained) pass('an UNKNOWN order stays visible to reconciliation instead of being discarded');
  else fail('an UNKNOWN order was discarded, leaving a permanent blind spot');

  // (d) a transport-level 5xx is also indeterminate, not a refusal
  transport = 'http5xx';
  const bad5xx: any = await engine.executeOrder(spec);
  if (bad5xx.order?.status === 'UNKNOWN') {
    pass('an HTTP 5xx is treated as indeterminate rather than a refusal');
  } else {
    fail(`an HTTP 5xx produced ${bad5xx.order?.status}, expected UNKNOWN`);
  }

  // (e) the resolution path exists and is reachable
  if (typeof engine.resolveUnknownOrders === 'function') {
    const r = await engine.resolveUnknownOrders();
    if (typeof r?.resolved === 'number') pass('resolveUnknownOrders() exists and reports what it resolved');
    else fail('resolveUnknownOrders() returned an unexpected shape');
  } else {
    fail('resolveUnknownOrders() is missing — UNKNOWN orders could never be closed out');
  }

  // (f) a non-JSON / empty body must produce a DESCRIPTIVE error, not a parse throw.
  // This is the defect that filled the error surface with "Unexpected end of JSON input".
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  let reconError = '';
  try {
    const recon: any = await engine.reconcileOpenOrders('BTC/USDT');
    reconError = String(recon?.error || '');
  } catch (thrown: any) {
    reconError = `THREW: ${thrown?.message}`;
  }
  if (/EMPTY body/i.test(reconError)) {
    pass('an empty response body yields a descriptive error instead of a JSON parse throw');
  } else {
    fail(`empty-bodied response produced: ${reconError || '(no error reported)'}`);
  }

  (globalThis as any).fetch = async () => ({ ok: true, status: 502, text: async () => '<html>Bad Gateway</html>' });
  let htmlError = '';
  try {
    const recon2: any = await engine.reconcileOpenOrders('BTC/USDT');
    htmlError = String(recon2?.error || '');
  } catch (thrown: any) {
    htmlError = `THREW: ${thrown?.message}`;
  }
  if (/non-JSON body/i.test(htmlError)) {
    pass('an HTML (proxy 502) body is reported as non-JSON, naming what was received');
  } else {
    fail(`HTML response body produced: ${htmlError || '(no error reported)'}`);
  }
} finally {
  (globalThis as any).fetch = realFetch;
}

// ---------------------------------------------------------------------------------------------
// [5] WORKER PROCESS STARTUP
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('[5] Worker process startup behaviour');

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

// ---------------------------------------------------------------------------------------------
// [6] TRADING READINESS must never report ready without evidence
// This is the rule that stops a green dashboard while execution is impossible.
// ---------------------------------------------------------------------------------------------
console.log('');
console.log('[6] Trading readiness requires evidence, never the absence of an objection');

const { assessTradingReadiness } = await import('../server/trading/tradingReadiness.ts');

const allGood = {
  engineTradingReady: true,
  engineCredentialsOk: true,
  engineCredentialsError: null,
  tradePermissionsOk: true,
  tradePermissionsError: null,
  engineBlockers: [],
  executionEngineEnabled: true,
  executionEngineLastError: null,
  killSwitchActive: false,
  systemFailClosed: false,
  autonomyLevel: 1,
  armed: true,
};

const ready = assessTradingReadiness(allGood);
if (ready.ready === true && ready.blockers.length === 0) {
  pass('readiness is TRUE only when every gate is positively verified');
} else {
  fail(`readiness was ${ready.ready} despite all gates passing (${ready.blockers.join(' | ')})`);
}

// Every single failing gate must independently force NOT-ready.
const GATE_FAILURES: Array<[string, Record<string, unknown>]> = [
  ['credentials rejected by the exchange', { engineCredentialsOk: false, engineCredentialsError: 'API key is invalid', engineTradingReady: false }],
  ['credentials never validated (unknown)', { engineCredentialsOk: null, engineTradingReady: null }],
  ['authenticated but NOT authorised to trade', { tradePermissionsOk: false, tradePermissionsError: 'API key lacks the ContractTrade permission' }],
  ['trade permission never validated (unknown)', { tradePermissionsOk: null }],
  ['execution engine switched OFF', { executionEngineEnabled: false, executionEngineLastError: 'API key is invalid' }],
  ['kill switch active', { killSwitchActive: true }],
  ['system fail-closed', { systemFailClosed: true }],
  ['execution engine state unknown', { executionEngineEnabled: null }],
  ['kill switch state unknown', { killSwitchActive: null }],
  ['fail-closed state unknown', { systemFailClosed: null }],
];
for (const [label, override] of GATE_FAILURES) {
  const r = assessTradingReadiness({ ...allGood, ...override } as any);
  if (r.ready === false && r.blockers.length > 0) {
    pass(`readiness is FALSE with a stated blocker when ${label}`);
  } else {
    fail(`readiness reported ${r.ready} when ${label} — it must never be green there`);
  }
}

// The fail-closed default: nothing known at all.
const unknownAll = assessTradingReadiness({
  engineTradingReady: null, engineCredentialsOk: null, engineCredentialsError: null,
  engineBlockers: [], executionEngineEnabled: null, executionEngineLastError: null,
  killSwitchActive: null, systemFailClosed: null, autonomyLevel: null, armed: null,
} as any);
if (unknownAll.ready === false) pass('all-unknown inputs yield NOT ready (fail-closed default)');
else fail('all-unknown inputs yielded READY — unknown must never be treated as evidence');

// The blocker must name the real cause, not a generic message.
const creds = assessTradingReadiness({ ...allGood, engineCredentialsOk: false, engineCredentialsError: 'API key is invalid', engineTradingReady: false } as any);
const credsText = creds.blockers.join(' | ');
if (/credentials rejected/i.test(credsText) && /API key is invalid/.test(credsText)) {
  pass('the blocker says "credentials rejected for trading" AND names the exchange error verbatim');
} else {
  fail(`credential blocker did not name the cause: ${credsText}`);
}

// THE PRODUCTION CASE, asserted explicitly: the key AUTHENTICATES fine (reads succeed) but is
// refused on order endpoints. This is exactly what shipped a green "credentials accepted" line
// next to a red "API key is invalid", so it gets its own test.
const authOkTradeDenied = assessTradingReadiness({
  ...allGood,
  engineCredentialsOk: true,
  engineCredentialsError: null,
  tradePermissionsOk: false,
  tradePermissionsError: 'API key lacks the ContractTrade permission',
} as any);
const tradeText = authOkTradeDenied.blockers.join(' | ');
if (authOkTradeDenied.ready === false && /cannot trade/i.test(tradeText)) {
  pass('authenticated-but-unauthorised credentials yield NOT ready and say "cannot trade"');
} else {
  fail(`read-only/unauthorised credentials produced ready=${authOkTradeDenied.ready} blockers=${tradeText}`);
}
// And the authentication signal must not claim more than it proves.
const authSignal = authOkTradeDenied.signals.find((s) => s.id === 'CREDENTIALS_AUTHENTICATE');
if (authSignal && /does NOT permit order placement/i.test(authSignal.detail)) {
  pass('the authentication signal states it does not imply permission to place orders');
} else {
  fail('the authentication signal reads as a green light for trading');
}
// A trade-authorisation failure must never be reported as merely informational.
const tradeSignal = authOkTradeDenied.signals.find((s) => s.id === 'TRADE_AUTHORIZED');
if (tradeSignal && tradeSignal.ok === false) {
  pass('TRADE_AUTHORIZED is a hard gate, not a warning');
} else {
  fail('TRADE_AUTHORIZED did not fail for unauthorised credentials');
}

// The engine's own blockers must survive into the report.
const withEngineBlockers = assessTradingReadiness({ ...allGood, engineTradingReady: false, engineBlockers: ['market data is stale'] } as any);
if (withEngineBlockers.blockers.includes('market data is stale')) {
  pass("the engine's own blockers are surfaced verbatim, not summarised away");
} else {
  fail('engine blockers were dropped from the readiness report');
}

// Being unarmed/observe-only makes trading INADVISABLE, not IMPOSSIBLE — it must not be a gate,
// or the dashboard would claim execution is broken when it is merely idle.
const unarmed = assessTradingReadiness({ ...allGood, armed: false, autonomyLevel: 0 } as any);
if (unarmed.ready === true && unarmed.context.autonomousTradingActive === false) {
  pass('unarmed/observe-only is reported as context, not as an execution blocker');
} else {
  fail(`unarmed state wrongly affected readiness (ready=${unarmed.ready})`);
}

console.log('');
console.log(`Result: ${checks} passed, ${failures} failed`);
if (failures > 0) {
  console.log('RUNTIME INVARIANTS VIOLATED.');
  process.exit(1);
}
console.log('ALL RUNTIME INVARIANTS HOLD.');
process.exit(0);
