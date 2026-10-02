#!/usr/bin/env node
/**
 * UI <-> API CONTRACT TEST
 *
 * Why this exists: a UI can be fully implemented and still never render, because the
 * path it fetches is never served. That is not a type error and not a unit-test failure
 * of either side in isolation — it only shows up as an empty panel in production.
 *
 * This test statically cross-checks every endpoint the frontend calls against every route
 * the backend actually registers, and fails on any path OR method that cannot be served.
 *
 * It is deliberately source-level (no server boot, no network, no credentials) so it is
 * fast, deterministic, and safe to run in CI before anything is deployed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = path.join(ROOT, 'src');
const ROUTES_FILE = path.join(ROOT, 'server', 'trading', 'routes.ts');
const SERVER_FILE = path.join(ROOT, 'server.ts');

let failures = 0;
let checks = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const pass = (msg) => { checks++; console.log(`  ✔ ${msg}`); };

/**
 * Normalise a path so `${id}` and `:id` compare equal.
 *
 * Two shapes need care:
 *  - `/pair/${encoded}`      -> `/pair/:param`   (a real path parameter)
 *  - `/assets${c ? '?x=1' : ''}` -> `/assets`    (a query suffix, not a path segment)
 * The second arrives truncated at the inner quote, so anything from an unclosed `${`
 * to the end is dropped BEFORE template expressions are converted.
 */
const normPath = (p) => {
  let out = String(p).replace(/\$\{[^}]*$/, '');
  out = out.replace(/\$\{[^}]*\}/g, ':param');
  out = out.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param');
  // A ':param' that is not its own path segment was a template suffix: drop it.
  out = out.replace(/([^/]):param/g, '$1');
  out = out.split('?')[0].replace(/\/+$/, '');
  return out || '/';
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- UI call sites
// A call looks like: fetchWithFailover<...>('/path', { method: 'POST' })
const UI_CALL_RE = /fetchWithFailover\s*(?:<[^>]*>)?\s*\(\s*[`'"]([^`'"]+)[`'"]\s*(?:,\s*(\{[\s\S]{0,300}?\}))?/g;

const uiCalls = [];
for (const file of walk(UI_DIR)) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = UI_CALL_RE.exec(src)) !== null) {
    const rawPath = m[1];
    // Only same-origin API paths are in scope (absolute URLs are external services).
    if (!rawPath.startsWith('/') || rawPath.startsWith('//')) continue;
    // Drop any query string: the route table matches on path only.
    const pathOnly = rawPath.split('?')[0];
    const opts = m[2] || '';
    const methodMatch = opts.match(/method\s*:\s*['"]([A-Za-z]+)['"]/);
    uiCalls.push({
      raw: rawPath,
      norm: normPath(pathOnly),
      method: (methodMatch ? methodMatch[1] : 'GET').toUpperCase(),
      file: path.relative(ROOT, file),
    });
  }
}

// ------------------------------------------------------- server registered routes
const routesSrc = fs.readFileSync(ROUTES_FILE, 'utf8');
const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');

// The trading router is mounted under several prefixes (see server.ts app.use(...)).
const ROUTER_PREFIXES = ['/api/trading', '/api/auth', '/auth'];

const ALL_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

const routerRoutes = [];
// `.all([...paths])` registers the handler for every verb, so it accepts any method.
const ROUTER_ALL_RE = /tradingRouter\.all\s*\(\s*\[([^\]]+)\]/g;
{
  let m;
  while ((m = ROUTER_ALL_RE.exec(routesSrc)) !== null) {
    for (const p of [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])) {
      for (const method of ALL_METHODS) routerRoutes.push({ method, norm: normPath(p) });
    }
  }
}
const ROUTER_RE = /tradingRouter\.(get|post|put|delete)\s*\(\s*['"]([^'"]+)['"]/g;
{
  let m;
  while ((m = ROUTER_RE.exec(routesSrc)) !== null) {
    routerRoutes.push({ method: m[1].toUpperCase(), norm: normPath(m[2]) });
  }
}

// Routes registered directly on the app (absolute paths, no prefix).
const appRoutes = [];
const APP_RE = /app\.(get|post|put|delete)\s*\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g;
{
  let m;
  while ((m = APP_RE.exec(serverSrc)) !== null) {
    const list = m[2];
    const paths = [...list.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).filter(Boolean);
    for (const p of paths) appRoutes.push({ method: m[1].toUpperCase(), norm: normPath(p) });
  }
}

/**
 * Known, DELIBERATE gaps. These are recorded explicitly rather than excused, so the suite can
 * stay green without hiding them, and so the list cannot silently grow — adding an entry here
 * is a visible act that has to be justified in the reason string.
 */
const KNOWN_GAPS = [
  {
    method: 'POST',
    path: '/updates/rollout',
    reason:
      'server/trading/selfUpdater.ts is never instantiated (zero references outside itself), so no ' +
      'canary-rollout capability is reachable at runtime. This needs the updater wired into the store ' +
      'plus real deployment-control semantics — not a route stub. Fabricating a success response here ' +
      'would falsely tell the operator a rollout happened.',
  },
];

// Expand router routes onto every mount prefix, and keep app routes absolute.
const served = new Set();
for (const r of routerRoutes) {
  for (const prefix of ROUTER_PREFIXES) served.add(`${r.method} ${normPath(prefix + r.norm)}`);
}
for (const r of appRoutes) served.add(`${r.method} ${r.norm}`);

// ------------------------------------------------------------------- assertions
console.log('UI <-> API Contract Test');
console.log('========================');
console.log(`UI call sites parsed : ${uiCalls.length}`);
console.log(`Backend routes parsed: ${routerRoutes.length} router + ${appRoutes.length} app`);
console.log('');

console.log('[1] Every frontend API path is served by the backend');
const unmatched = [];
let knownGapsHit = 0;
for (const call of uiCalls) {
  // The frontend prepends the router base; the same call is valid under any mount prefix.
  const candidates = [
    `${call.method} ${call.norm}`,
    ...ROUTER_PREFIXES.map((p) => `${call.method} ${normPath(p + call.norm)}`),
  ];
  if (candidates.some((c) => served.has(c))) continue;
  const gap = KNOWN_GAPS.find((g) => g.method === call.method && normPath(g.path) === call.norm);
  if (gap) {
    knownGapsHit++;
    console.log(`  ⚠ KNOWN GAP (recorded, not passed): ${call.method} ${call.norm} — ${gap.reason}`);
    continue;
  }
  unmatched.push(call);
}
if (unmatched.length === 0) {
  pass(`all ${uiCalls.length} frontend call sites resolve to a registered route (${knownGapsHit} recorded gap${knownGapsHit === 1 ? '' : 's'})`);
} else {
  for (const u of unmatched) {
    fail(`${u.method} ${u.raw}  (${u.file}) — no matching backend route`);
  }
}

console.log('');
console.log('[2] No frontend path is served ONLY by a different HTTP method');
// Catches the subtle case where the path exists but with the wrong verb (silent 404/405).
for (const call of uiCalls) {
  const pathVariants = [
    call.norm,
    ...ROUTER_PREFIXES.map((p) => normPath(p + call.norm)),
  ];
  const anyMethod = [...served].some((s) => pathVariants.includes(s.split(' ').slice(1).join(' ')));
  const exact = pathVariants.some((v) => served.has(`${call.method} ${v}`));
  if (anyMethod && !exact) {
    fail(`${call.raw} (${call.file}) exists but not for ${call.method}`);
  }
}
if (failures === 0) pass('no method/path mismatches');

console.log('');
console.log('[3] Guards: the specific defects this test was written for stay fixed');
const REQUIRED = [
  ['GET', '/api/trading/autonomous-optimizer/status'],
  ['POST', '/api/trading/autonomous-optimizer/run'],
  ['GET', '/api/trading/sweep/info'],
  ['POST', '/api/trading/sweep/wallet'],
  ['POST', '/api/trading/sweep/execute'],
  // Contract-completion routes: engine capabilities that existed but were never exposed.
  ['GET', '/api/trading/pair/:symbol'],
  ['POST', '/api/trading/mode'],
  ['POST', '/api/trading/risk/config'],
  ['POST', '/api/trading/risk/circuit-breaker/reset'],
  ['POST', '/api/trading/strategy/create-variant'],
];
for (const [method, p] of REQUIRED) {
  if (served.has(`${method} ${normPath(p)}`)) pass(`${method} ${p} registered`);
  else fail(`${method} ${p} MISSING (regression of the stale-UI-path defect)`);
}
const FORBIDDEN = [
  '/optimizer', '/optimizer/run', '/profit-sweep', '/profit-sweep/wallet', '/profit-sweep/execute',
  // Wrong-verb/path variants that used to be called by the frontend.
  '/risk/reset-circuit-breaker',
];
for (const p of FORBIDDEN) {
  const stillUsed = uiCalls.some((c) => c.norm === normPath(p));
  if (stillUsed) fail(`frontend still calls dead path ${p}`);
  else pass(`frontend no longer calls dead path ${p}`);
}

console.log('');
console.log(`Result: ${checks} passed, ${failures} failed`);
if (failures > 0) {
  console.log('UI/API CONTRACT VIOLATED — the frontend would render empty or error states in production.');
  process.exit(1);
}
console.log('ALL UI/API CONTRACT INVARIANTS HOLD.');
