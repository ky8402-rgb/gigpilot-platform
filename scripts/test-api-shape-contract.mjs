#!/usr/bin/env node
/**
 * API RESPONSE-SHAPE CONTRACT TEST
 *
 * The path/verb test (test-ui-api-contract.mjs) proves a route EXISTS. This proves the route
 * still returns the SHAPE its consumers depend on: required fields, nested structures, and
 * important enum literals. A rename, removal or incompatible change fails here immediately,
 * instead of surfacing as a blank panel or a silent `undefined` in production.
 *
 * It is source-level: no server boot, no network, no credentials, so it runs in CI.
 *
 * DESIGN RULE: if the extractor cannot read a handler, that is a FAILURE, never a pass.
 * A shape test that silently verifies nothing is worse than no test at all.
 *
 * Endpoints whose body is produced by the Python engine rather than by a literal in the handler
 * (proxies) declare `owner: 'python-engine'` and assert only what the handler itself guarantees;
 * their inner fields are verified live instead (see the live-shape note at the end).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
let checks = 0;
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m) => { checks++; console.log(`  ✔ ${m}`); };

/** Return the object literal following `marker`, matched by braces. */
function literalAfter(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  return null;
}

// Bare identifiers that are JS literals / values, never property names.
const VALUE_WORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this']);

/**
 * Keys declared at the top level of an object literal.
 *
 * Handles BOTH forms, because a test that only understood `key: value` reported every ES6
 * shorthand property (`{ success: true, engines }`) as a missing field — ten false failures on
 * correct code. Presence checks must never invent absence.
 */
function topLevelKeys(objText) {
  if (!objText) return [];
  const body = objText.slice(1, -1);
  const keys = [];
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (depth === 0) {
      // `key: value`
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
      if (m) { keys.push(m[1]); i += m[0].length; continue; }
      // `...spread` — contributes keys we cannot know statically; never a key itself.
      const spread = /^\s*\.\.\./.exec(body.slice(i));
      if (spread) { i += spread[0].length; continue; }
      // `shorthand,` — a bare identifier followed by a separator or the end.
      const shorthand = /^\s*([A-Za-z_$][\w$]*)\s*(?=[,\n}]|$)/.exec(body.slice(i));
      if (shorthand) {
        // Consume the whole word either way, so a skipped literal like `true` cannot be
        // re-scanned from its second character and reported as a bogus key ('rue').
        i += shorthand[0].length;
        if (!VALUE_WORDS.has(shorthand[1])) keys.push(shorthand[1]);
        continue;
      }
    }
    i++;
  }
  return keys;
}

/** The response body literal of the handler that starts at `anchor`. */
function responseBody(fileSrc, anchor, marker = 'res.json({') {
  const start = fileSrc.indexOf(anchor);
  if (start < 0) return null;
  // Bound the handler: next route registration, or 4000 chars, whichever comes first.
  const rest = fileSrc.slice(start);
  const next = rest.search(/\n(tradingRouter|githubRoutes|app)\.(get|post|put|delete|all)\s*\(/);
  const handler = next > 0 ? rest.slice(0, next) : rest.slice(0, 4000);
  return literalAfter(handler, marker);
}

const ROUTES_SRC = read('server/trading/routes.ts');
const SERVER_SRC = read('server.ts');

/**
 * required: top-level keys that MUST exist.
 * nested:   { parentKey: [childKeys...] } — children must exist inside that parent literal.
 * literals: exact text (quotes normalised) that must appear in the handler.
 */
const SCHEMAS = [
  {
    id: 'GET /api/health',
    src: () => SERVER_SRC,
    anchor: 'app.get("/api/health"',
    required: ['status', 'deployedCommit', 'degraded', 'autonomousEngine', 'tradingEngine', 'system'],
    // `autonomousEngine` is a shorthand variable, so its inner shape is asserted at its true
    // source — see the AutonomousEngineHealth schema below.
    nested: {
      tradingEngine: ['activeSymbol', 'autonomyLevel', 'tradingMode', 'killSwitchActive', 'circuitBreakerActive', 'totalEquityUsd', 'netProfitUsd']
    },
    literals: ['status: "ok"']
  },
  {
    id: 'GET /api/trading/engines/health',
    anchor: "tradingRouter.get('/engines/health'",
    required: ['success', 'failClosed', 'engines', 'autonomousEngine', 'autonomousEngineCard']
    // `failClosed` is a call result, not an inline literal, so its nested shape is asserted at
    // its true source instead — see the systemMonitor.isSystemFailClosed() schema below.
  },
  {
    id: 'GET /api/trading/autonomous-optimizer/status',
    anchor: "tradingRouter.get('/autonomous-optimizer/status'",
    required: ['success', 'health', 'engine', 'autoApplyEnabled', 'latestAudit', 'latestStrategyAllocation', 'decisions', 'builds', 'strategyBuilds', 'championStrategy']
  },
  {
    id: 'POST /api/trading/autonomous-optimizer/run',
    anchor: "tradingRouter.post('/autonomous-optimizer/run'",
    required: ['success', 'decision', 'latestAudit', 'latestStrategyAllocation', 'builds', 'championStrategy']
  },
  {
    id: 'GET /api/trading/sweep/info',
    anchor: "tradingRouter.get('/sweep/info'",
    required: ['success', 'destinationWallet', 'sweeps', 'history', 'eligibleProfitUsd', 'totalSweptUsd', 'minSweepThresholdUsd', 'profitReserveBufferUsd', 'eligibility'],
    nested: { eligibility: ['eligibleAmount', 'canSweep', 'reserveRetained'] }
  },
  {
    id: 'GET /api/trading/pair/:symbol',
    anchor: "tradingRouter.get('/pair/:symbol'",
    required: ['success'],
    owner: 'bybit-market-data'
  },
  {
    id: 'POST /api/trading/mode',
    anchor: "tradingRouter.post('/mode'",
    required: ['success', 'mode'],
    literals: ['LIVE']
  },
  {
    id: 'POST /api/trading/risk/config',
    anchor: "tradingRouter.post('/risk/config'",
    required: ['success', 'config']
  },
  {
    id: 'POST /api/trading/strategy/create-variant',
    anchor: "tradingRouter.post('/strategy/create-variant'",
    required: ['success', 'challenger']
  },
  {
    id: 'GET /api/trading/state',
    anchor: "tradingRouter.get('/state'",
    required: ['success']
  },
  {
    id: 'GET /api/trading/risk',
    anchor: "tradingRouter.get('/risk'",
    required: ['success', 'config', 'riskEvents', 'circuitBreakerActive']
  },
  {
    id: 'GET /api/trading/pairs',
    anchor: "tradingRouter.get('/pairs'",
    required: ['success', 'pairs']
  },
  {
    id: 'GET /api/trading/gigpilot/state',
    anchor: "tradingRouter.get('/gigpilot/state'",
    required: ['success'],
    owner: 'python-engine'
  },
  {
    id: 'GET /api/trading/engines/health (off-switch)',
    anchor: "tradingRouter.post('/engines/:id/off-switch'",
    required: ['success', 'engineHealth', 'failClosed']
  },
  {
    // Asserted at its true source, because /engines/health returns this by calling it.
    id: 'systemMonitor.isSystemFailClosed() shape (consumed by /engines/health)',
    src: () => read('server/trading/systemMonitor.ts'),
    anchor: 'isSystemFailClosed(',
    marker: 'return {',
    required: ['failClosed', 'downEngines']
  },
  {
    // The declared shape behind /api/health.autonomousEngine (returned by reference, not inline).
    id: 'AutonomousEngineHealth type (source of /api/health.autonomousEngine)',
    src: () => read('server/trading/autonomousEngineProbe.ts'),
    anchor: 'type AutonomousEngineHealth =',
    marker: 'type AutonomousEngineHealth =',
    required: ['reachable', 'status', 'latencyMs', 'httpStatus', 'armed', 'publicWs', 'privateWs', 'feedFresh', 'positionMode', 'error'],
    literals: ["'healthy'", "'unhealthy'", "'unreachable'"]
  }
];

console.log('API Response-Shape Contract Test');
console.log('================================');
console.log(`Schemas: ${SCHEMAS.length}`);
console.log('');

const normalise = (s) => s.replace(/"/g, "'").replace(/\s+/g, ' ');

for (const schema of SCHEMAS) {
  const src = schema.src ? schema.src() : ROUTES_SRC;
  const body = responseBody(src, schema.anchor, schema.marker);

  if (!body) {
    fail(`${schema.id}: could not locate the response object literal (handler moved or reshaped) — treated as FAILURE, not a pass`);
    continue;
  }
  const keys = topLevelKeys(body);
  if (keys.length === 0) {
    fail(`${schema.id}: parsed zero keys from the response literal — extractor cannot verify this route`);
    continue;
  }

  const missing = (schema.required || []).filter((k) => !keys.includes(k));
  if (missing.length === 0) {
    pass(`${schema.id} — all ${(schema.required || []).length} required top-level fields present`);
  } else {
    fail(`${schema.id} — MISSING required field(s): ${missing.join(', ')} (present: ${keys.join(', ')})`);
  }

  for (const [parent, children] of Object.entries(schema.nested || {})) {
    if (!keys.includes(parent)) continue; // already reported as missing
    const inner = literalAfter(body, `${parent}:`);
    if (!inner) { fail(`${schema.id} — nested '${parent}' is no longer an object literal`); continue; }
    const innerKeys = topLevelKeys(inner);
    const innerMissing = children.filter((c) => !innerKeys.includes(c));
    if (innerMissing.length === 0) pass(`${schema.id} — nested '${parent}' intact (${children.length} fields)`);
    else fail(`${schema.id} — nested '${parent}' MISSING: ${innerMissing.join(', ')}`);
  }

  const handlerText = normalise(src.slice(src.indexOf(schema.anchor), src.indexOf(schema.anchor) + 2500));
  for (const lit of schema.literals || []) {
    if (handlerText.includes(normalise(lit))) pass(`${schema.id} — enum/flag literal ${lit} preserved`);
    else fail(`${schema.id} — expected literal ${lit} not found (enum value changed?)`);
  }
}

console.log('');
console.log('[Live-only surfaces]');
// Fields produced by the Python engine or Bybit cannot be asserted statically. Say so rather
// than implying coverage that does not exist.
const pyOwned = SCHEMAS.filter((s) => s.owner);
console.log(`  ⓘ ${pyOwned.length} endpoint(s) are proxy surfaces owned by another runtime; only their`);
console.log('    handler-guaranteed fields are asserted here. Their inner fields require live verification:');
for (const s of pyOwned) console.log(`      - ${s.id} (owner: ${s.owner})`);

console.log('');
console.log(`Result: ${checks} passed, ${failures} failed`);
if (failures > 0) {
  console.log('API RESPONSE SHAPE CONTRACT VIOLATED — a consumer would break in production.');
  process.exit(1);
}
console.log('ALL API RESPONSE-SHAPE INVARIANTS HOLD.');
