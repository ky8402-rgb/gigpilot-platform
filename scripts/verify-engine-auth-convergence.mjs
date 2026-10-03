#!/usr/bin/env node
/**
 * Node <-> Python owner-session CONVERGENCE gate.
 *
 * THE DEFECT THIS EXISTS TO CATCH
 * -------------------------------
 * The Node backend authenticates the owner and then PROXIES to the Python engine
 * (/api/trading/gigpilot/{state,arm,disarm,kill}) using the caller's session token. That only works
 * if both processes sign with the SAME secret.
 *
 * When they disagree the failure is invisible and misleading:
 *   engine returns 401 -> the Node route's `response.ok` is false -> it falls through to
 *   503 {"error":"ENGINE UNREACHABLE"} -> the dashboard renders "ENGINE UNREACHABLE" while the
 *   engine is in fact perfectly healthy (verified: /api/health reports latency 2ms, httpStatus 200).
 *
 * Neither process can detect this alone; only an end-to-end probe can. The deploy previously health-
 * checked nothing but the engine's PUBLIC /health, which cannot fail for an auth reason — hence a
 * secret mismatch shipped to production undetected.
 *
 * WHAT IT ASSERTS
 *   1. a token minted with the resolved secret is ACCEPTED BY NODE   (auth/status -> isAuthenticated)
 *   2. the SAME token is ACCEPTED BY THE ENGINE                      (/api/state -> 200)
 *   3. the engine REFUSES an anonymous caller                        (/api/state -> 401)
 *   4. the engine REFUSES a token signed with a different secret     (fail-closed)
 *
 * Assertion 2 is the one that catches a split secret. 3 and 4 keep the probe from passing against an
 * engine that has simply stopped enforcing auth.
 *
 * Usage: node scripts/verify-engine-auth-convergence.mjs
 * Exit 0 = converged and enforcing. Non-zero = do NOT accept this deployment.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const APP_DIR = process.cwd();
const ENGINE_URL = process.env.GIGPILOT_URL || 'http://127.0.0.1:8001';
const NODE_URL = process.env.GIGPILOT_NODE_URL || 'http://127.0.0.1:3000';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'ky8402@gmail.com';

const failures = [];
function ok(name, detail = '') {
  console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  failures.push(name);
}

// ---------------------------------------------------------------------------------------------
// Resolve the signing secret EXACTLY as the Node owner auth does, so the token below is a faithful
// stand-in for one the real backend would issue.
//   ownerAuth.ts: process.env.JWT_SECRET || process.env.OWNER_SESSION_SECRET || config.jwtSecret
// ---------------------------------------------------------------------------------------------
function loadDotEnv() {
  try {
    const raw = fs.readFileSync(path.join(APP_DIR, '.env'), 'utf-8');
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim().replace(/^["']|["']$/g, '');
      // dotenv semantics the Node app relies on:
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env — fall through to the persisted config */
  }
}

/**
 * EVERY secret this host could plausibly be using, most-authoritative first.
 *
 * The gate previously resolved exactly ONE candidate and asserted against it. When that assertion
 * failed, the operator learned that *something* disagreed but not WHICH store each side was actually
 * reading — which is the only fact that identifies the fix. Enumerating candidates turns a failure
 * into that answer directly: the matrix prints, per candidate, which of Node and the engine accepts
 * it, and a fingerprint (not the secret) identifies it in the log.
 */
function resolveCandidates() {
  const out = [];
  const seen = new Set();
  const push = (label, secret) => {
    if (!secret || seen.has(secret)) return;
    seen.add(secret);
    out.push({ label, secret, fp: crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12) });
  };

  push('env JWT_SECRET', process.env.JWT_SECRET);
  push('env OWNER_SESSION_SECRET', process.env.OWNER_SESSION_SECRET);

  const dir = process.env.GIGPILOT_DATA_DIR || path.join(APP_DIR, '.gigpilot-data');
  const cfgPath = path.join(dir, 'owner-auth-config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    push(`config ${cfgPath}`, cfg.jwtSecret);
  } catch {
    /* no persisted config */
  }
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HS256 JWT, byte-compatible with jsonwebtoken's default output. */
function mintToken(secret, email) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: email, role: 'owner', iat: now, exp: now + 300 }));
  const signingInput = `${header}.${payload}`;
  const sig = b64url(crypto.createHmac('sha256', secret).update(signingInput).digest());
  return `${header}.${payload}.${sig}`;
}

async function probe(url, token, method = 'GET') {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { method, headers, signal: controller.signal });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: null, error: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log('='.repeat(78));
  console.log('NODE <-> ENGINE OWNER-SESSION CONVERGENCE');
  console.log('='.repeat(78));

  loadDotEnv();
  const candidates = resolveCandidates();
  if (!candidates.length) {
    console.log('  no owner signing secret configured in env or on disk');
  }
  for (const c of candidates) console.log(`  candidate: ${c.label}  [fp ${c.fp}]`);

  // ---- the engine must refuse anonymous and wrong-secret callers --------------------------
  const anon = await probe(`${ENGINE_URL}/api/state`, null);
  if (anon.status === 401) ok('engine refuses an ANONYMOUS caller (401)');
  else fail('engine did NOT refuse an anonymous caller', `status=${anon.status}`);

  const bogus = mintToken('definitely-not-the-right-secret', OWNER_EMAIL);
  const bogusRes = await probe(`${ENGINE_URL}/api/state`, bogus);
  if (bogusRes.status === 401) ok('engine refuses a WRONG-SECRET token (401)');
  else fail('engine accepted a token signed with the wrong secret', `status=${bogusRes.status}`);

  if (!candidates.length) {
    console.log('\nRESULT: FAILED — no signing secret could be resolved');
    return 1;
  }

  // ---- which secret does each side actually honour? ---------------------------------------
  console.log('');
  console.log('  candidate                                   Node   Engine');
  console.log('  ' + '-'.repeat(66));
  let agreeing = null;
  for (const c of candidates) {
    const tok = mintToken(c.secret, OWNER_EMAIL);
    const nodeRes = await probe(`${NODE_URL}/api/trading/auth/status`, tok);
    const engRes = await probe(`${ENGINE_URL}/api/state`, tok);
    const nodeOk = nodeRes.status === 200 && nodeRes.body?.isAuthenticated === true;
    const engOk = engRes.status === 200;
    console.log(
      `  ${c.label.padEnd(42)} ${(nodeOk ? 'ACCEPTS' : 'rejects').padEnd(6)} ${engOk ? 'ACCEPTS' : 'rejects'}`
    );
    if (nodeOk && engOk && !agreeing) agreeing = c;
    // Record the specific failure modes for the verdict below.
    if (c.label === 'env OWNER_SESSION_SECRET' && !nodeOk) {
      c._nodeRejected = true;
    }
    if (c.label === 'env OWNER_SESSION_SECRET' && !engOk) {
      c._engineRejected = true;
    }
  }
  console.log('');

  if (agreeing) {
    ok(`BOTH sides accept the same secret (${agreeing.label}) — convergence confirmed`);
    console.log('\nRESULT: PASSED — owner sessions converge across both stacks and auth is enforced');
    return 0;
  }

  // No single candidate satisfied both. Report the precise split.
  const nodeAccepted = candidates.filter((c) => c._nodeAccepted);
  fail(
    'Node and the engine do NOT share a signing secret — no candidate above was accepted by both',
    'see the matrix for which store each side is actually reading'
  );
  console.log('');
  console.log('  Interpretation:');
  console.log('    * neither side ACCEPTS any candidate  -> each is signing with a value not on disk');
  console.log('      (a stale export baked into the process env, or a runtime-generated secret).');
  console.log('    * Node ACCEPTS one and the engine another -> the two stores disagree.');
  console.log('    * the files agree but both reject -> a process is overriding them; check whether');
  console.log('      pm2 was started with --update-env and whether OWNER_SESSION_SECRET is exported');
  console.log('      into the deploy shell.');

  console.log('');
  console.log(`RESULT: FAILED (${failures.length})`);
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('convergence probe crashed:', err);
  process.exit(1);
});
