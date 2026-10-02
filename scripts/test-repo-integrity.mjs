#!/usr/bin/env node
/**
 * REPO INTEGRITY & SINGLE-OWNER BACKGROUND INVARIANTS
 *
 * These are the structural failures that unit tests of a single module cannot see:
 *
 *  [1] DEAD REFERENCES. A script importing a module that no longer exists fails only when
 *      somebody runs it — which may be never, until it is urgently needed.
 *
 *  [2] SINGLE-OWNER BACKGROUND LOOPS. `store.ts` exports a module-level singleton, so merely
 *      importing it constructs the engine graph. Engines that auto-start periodic work in their
 *      constructors therefore start that work in EVERY importing process. With the API process
 *      and the worker process both importing it, that means two reconcilers, two market-data
 *      ingestions and two autonomous optimizers against ONE live account with separate
 *      in-memory state: duplicate exchange calls, divergent positions, races on shared state.
 *
 *  [3] STALE DEPLOY. `pm2 start ecosystem.config.cjs` does not update an already-running app's
 *      code or env, so any app the deploy script forgets to delete keeps executing a stale
 *      bundle forever.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
let checks = 0;
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };
const pass = (m) => { checks++; console.log(`  ✔ ${m}`); };

console.log('Repo Integrity & Single-Owner Invariants');
console.log('========================================');

// ------------------------------------------------------------------ [1] dead references
console.log('');
console.log('[1] Every relative import resolves to a real file');

const SCAN_DIRS = ['server', 'scripts'];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|cjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

const unresolved = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    const src = fs.readFileSync(file, 'utf8');
    const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const rel = m[1];
      const base = path.resolve(path.dirname(file), rel.endsWith('.js') ? rel.slice(0, -3) : rel);
      const candidates = rel.endsWith('.js')
        ? [`${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.cjs`, `${base}.js`]
        : [base, `${base}.ts`, `${base}.mjs`, `${base}.cjs`, `${base}.js`, path.join(base, 'index.ts')];
      if (!candidates.some((c) => fs.existsSync(c))) {
        unresolved.push([path.relative(ROOT, file), rel]);
      }
    }
  }
}
if (unresolved.length === 0) pass('no unresolved relative imports in server/ or scripts/');
else unresolved.forEach(([f, r]) => fail(`${f} imports missing module '${r}'`));

// ------------------------------------------------------- [2] single-owner background loops
console.log('');
console.log('[2] Background loops have exactly one owner process');

const ownership = read('server/trading/backgroundOwnership.ts');
if (ownership.includes('ownsBackgroundLoops') && ownership.includes('GIGPILOT_DISABLE_BACKGROUND_LOOPS')) {
  pass('backgroundOwnership.ts defines the shared guard');
} else {
  fail('backgroundOwnership.ts is missing the ownsBackgroundLoops guard');
}

/** Extract a constructor body (naive brace matching from `constructor()`). */
function constructorBody(src) {
  const start = src.indexOf('constructor(');
  if (start < 0) return '';
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i); }
  }
  return '';
}

const GATED = [
  ['server/trading/dataEngine.ts', 'DataEngine', 'startLiveIngestion'],
  ['server/trading/exchangeExecutionEngine.ts', 'ExchangeExecutionEngine', 'startReconciliationLoop'],
];
for (const [file, label, autoStart] of GATED) {
  const body = constructorBody(read(file));
  if (!body) { fail(`${label}: constructor not found in ${file}`); continue; }
  if (body.includes('ownsBackgroundLoops()')) pass(`${label} constructor gates ${autoStart}() behind ownsBackgroundLoops()`);
  else fail(`${label} constructor calls ${autoStart}() UNGATED — a second importing process would duplicate it`);
}

const storeSrc = read('server/trading/store.ts');
if (storeSrc.includes('ownsBackgroundLoops()')) pass('TradingStore constructor gates its background loops');
else fail('TradingStore constructor background loops are ungated');

// The ecosystem file is a real CommonJS module; assert against its parsed objects, not its text.
const ecosystem = require(path.join(ROOT, 'ecosystem.config.cjs'));
const apps = ecosystem.apps || [];
const worker = apps.find((a) => a.name === 'worker');
const api = apps.find((a) => a.name === 'gigpilot');
if (worker && worker.env && worker.env.GIGPILOT_DISABLE_BACKGROUND_LOOPS === '1') {
  pass('ecosystem.config.cjs sets GIGPILOT_DISABLE_BACKGROUND_LOOPS=1 on the worker app');
} else {
  fail('worker app does NOT set GIGPILOT_DISABLE_BACKGROUND_LOOPS=1 — it would run duplicate loops');
}
// The deploy starts with `--env production`; the flag must survive that path too, or the worker
// (which exits 1 when it is unset) would crash-loop.
if (worker && worker.env_production && worker.env_production.GIGPILOT_DISABLE_BACKGROUND_LOOPS === '1') {
  pass('the flag is also present under env_production (survives --env production)');
} else {
  fail('env_production does not carry the flag — `pm2 start --env production` could crash-loop the worker');
}
if (api && api.env && api.env.GIGPILOT_DISABLE_BACKGROUND_LOOPS === undefined) {
  pass('the API app does NOT disable background loops (it is the owner)');
} else {
  fail('the API app disables background loops — nothing would own reconciliation or the optimizer');
}

// Every app must define env_production, or `pm2 start --env production` logs
// "Environment [production] is not defined in process file" for the ones that don't.
for (const app of apps) {
  if (app.env_production && Object.keys(app.env_production).length > 0) {
    pass(`app '${app.name}' defines env_production (no pm2 env-resolution warning)`);
  } else {
    fail(`app '${app.name}' has no env_production — pm2 would warn and env resolution is ambiguous`);
  }
}
// The engine's disarmed flag must survive the production env path.
const engine = apps.find((a) => a.name === 'gigpilot-engine');
if (engine?.env_production && engine.env_production.GIGPILOT_ARM === '0') {
  pass("engine keeps GIGPILOT_ARM='0' under env_production (cannot become armed via env resolution)");
} else {
  fail("engine's env_production does not pin GIGPILOT_ARM='0' — it could resolve to an armed state");
}

const workerSrc = read('server/worker.ts');
if (workerSrc.includes('ownsBackgroundLoops()') && workerSrc.includes('process.exit(1)')) {
  pass('worker fails fast instead of silently becoming a second trading process');
} else {
  fail('worker does not fail fast when background ownership is not explicitly disabled');
}

// --------------------------------------------------------------- [3] deploy recreates apps
console.log('');
console.log('[3] Deploys recreate every pm2 app (no stale bundles or env)');

const deploy = read('scripts/deploy-ec2.sh');
for (const app of ['gigpilot-engine', 'gigpilot', 'worker']) {
  if (new RegExp(`pm2 delete ${app}\\b`).test(deploy)) pass(`deploy deletes '${app}' so it is recreated`);
  else fail(`deploy never deletes '${app}' — it would keep running a stale bundle and env`);
}

// ------------------------------------------------------------------ [4] dead code stays gone
console.log('');
console.log('[4] Previously-dead references stay removed');

const DELETED = [
  'scripts/test-autonomous-loop.ts',
  'scripts/update-godaddy-dns.ts',
  'scripts/update-cloudflare-dns.ts',
];
for (const f of DELETED) {
  if (!fs.existsSync(path.join(ROOT, f))) pass(`${f} stays removed`);
  else fail(`${f} came back, but its imported module still does not exist`);
}
const pkg = read('package.json');
for (const name of ['test:loop', 'update-godaddy-dns', 'update-cloudflare-dns']) {
  if (!pkg.includes(`"${name}"`)) pass(`npm script '${name}' stays removed`);
  else fail(`npm script '${name}' points at a deleted script`);
}

console.log('');
console.log(`Result: ${checks} passed, ${failures} failed`);
if (failures > 0) {
  console.log('REPO INTEGRITY VIOLATED.');
  process.exit(1);
}
console.log('ALL REPO INTEGRITY INVARIANTS HOLD.');
