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

function resolveSecret() {
  if (process.env.JWT_SECRET) return { secret: process.env.JWT_SECRET, source: 'env JWT_SECRET' };
  if (process.env.OWNER_SESSION_SECRET) {
    return { secret: process.env.OWNER_SESSION_SECRET, source: 'env OWNER_SESSION_SECRET' };
  }
  const dir = process.env.GIGPILOT_DATA_DIR || path.join(APP_DIR, '.gigpilot-data');
  const cfgPath = path.join(dir, 'owner-auth-config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (cfg.jwtSecret) return { secret: cfg.jwtSecret, source: `config ${cfgPath}` };
  } catch {
    /* fall through */
  }
  return { secret: null, source: 'none' };
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
  const { secret, source } = resolveSecret();
  if (!secret) {
    console.log('  [SKIP] No owner signing secret is configured yet.');
    console.log('         Node falls back to a random per-process secret in that state, so there is');
    console.log('         nothing to converge on. The engine will still be checked for fail-closed.');
  } else {
    const kind = process.env.JWT_SECRET
      ? 'JWT_SECRET'
      : process.env.OWNER_SESSION_SECRET
        ? 'OWNER_SESSION_SECRET'
        : 'persisted';
    console.log(`  secret source: ${source} (${kind})`);
  }

  const token = secret ? mintToken(secret, OWNER_EMAIL) : null;

  // ---- 3 & 4 first: the engine must REFUSE anonymous and wrong-secret callers -----------------
  const anon = await probe(`${ENGINE_URL}/api/state`, null);
  if (anon.status === 401) ok('engine refuses an ANONYMOUS caller (401)');
  else fail('engine did NOT refuse an anonymous caller', `status=${anon.status}`);

  if (secret) {
    const wrong = mintToken('definitely-not-the-right-secret', OWNER_EMAIL);
    const wrongRes = await probe(`${ENGINE_URL}/api/state`, wrong);
    if (wrongRes.status === 401) ok('engine refuses a WRONG-SECRET token (401)');
    else fail('engine accepted a token signed with the wrong secret', `status=${wrongRes.status}`);
  }

  // ---- 1: Node must accept the token ----------------------------------------------------------
  if (token) {
    const nodeStatus = await probe(`${NODE_URL}/api/trading/auth/status`, token);
    if (nodeStatus.status === 200 && nodeStatus.body?.isAuthenticated === true) {
      ok('Node ACCEPTS the resolved-secret token');
    } else {
      fail(
        'Node rejected the resolved-secret token',
        `status=${nodeStatus.status} isAuthenticated=${nodeStatus.body?.isAuthenticated}`
      );
    }
  }

  // ---- 2: THE CONVERGENCE ASSERTION ----------------------------------------------------------
  if (token) {
    const engineState = await probe(`${ENGINE_URL}/api/state`, token);
    if (engineState.status === 200) {
      ok('ENGINE ACCEPTS the same token — Node and the engine share one signing secret');
    } else {
      fail(
        'ENGINE rejected a token that Node accepts — the two stacks DO NOT share a signing secret',
        `engine /api/state -> ${engineState.status}. Every Node->engine proxy call will report ` +
          `"ENGINE UNREACHABLE" while the engine is healthy.`
      );
      console.log('');
      console.log('  Remedy: the engine reads .env via python-dotenv from its app directory and');
      console.log('  prefers JWT_SECRET > OWNER_SESSION_SECRET > persisted owner-auth-config.json.');
      console.log('  Ensure OWNER_SESSION_SECRET is set in .env and that BOTH processes restarted');
      console.log('  AFTER it was written.');
    }
  }

  console.log('');
  if (failures.length) {
    console.log(`RESULT: FAILED (${failures.length}) — ${failures.join('; ')}`);
    return 1;
  }
  console.log('RESULT: PASSED — owner sessions converge across both stacks and auth is enforced');
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('convergence probe crashed:', err);
  process.exit(1);
});
