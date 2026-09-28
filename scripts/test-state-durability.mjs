/**
 * Characterization tests for durable trading state, phantom-order pruning and grid restoration.
 * Run with: node scripts/test-state-durability.mjs
 *
 * Pins the invariants that make realized performance survive a restart:
 *   1. Round-trip fidelity: capital counters, FIFO lots, the processed-fill de-dupe set and the
 *      measured cost-evidence fills all come back byte-for-byte equivalent.
 *   2. Fail-closed parsing: a corrupt file, an unknown version or a missing capital block yields
 *      null ("start clean") instead of a partially-hypothetical P&L.
 *   3. No credentials are ever written: secret-shaped keys are detected and the write is refused.
 *   4. Writes are atomic and 0600, and a partial temp file never becomes the live state.
 *   5. Reconciliation prunes only orders that are genuinely gone AND old enough to rule out an
 *      in-flight placement, so a live order is never forgotten.
 *   6. A restored grid is rejected when stale, malformed or drifted beyond its bounds.
 *
 * All fixtures are synthetic TEST data.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

// The persistence module resolves its data directory at import time, so the temp directory must be
// set BEFORE the module is imported.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gigpilot-state-test-'));
process.env.GIGPILOT_DATA_DIR = tempDir;

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();
const persistenceUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'statePersistence.ts')).href;
const engineUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'exchangeExecutionEngine.ts')).href;

const persistence = await import(persistenceUrl);
const { selectPhantomOrderIds, PHANTOM_ORDER_GRACE_MS } = await import(engineUrl);
unregister();

const {
  serializeTradingState,
  deserializeTradingState,
  findSecretLikeKeys,
  writeTradingState,
  readTradingState,
  isGridRestorable,
  TRADING_STATE_PATH,
  TRADING_STATE_VERSION,
  MAX_MEASURED_FILLS,
  GRID_RESTORE_MAX_AGE_MS
} = persistence;

let passed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failures.push({ name, message: e.message }); console.error(`  ✘ ${name}\n    ${e.message}`); }
}

// ---- Fixtures ---------------------------------------------------------------------------------

const capitalFixture = {
  initialCapital: 500,
  totalEquity: 512.34,
  totalEquityUsd: 512.34,
  tradingCapital: 500,
  availableCash: 312.34,
  lockedInOrders: 0,
  profitReserve: 200,
  eligibleRealizedProfit: 12.34,
  withdrawableProfit: 0,
  totalSweptProfit: 0,
  netRealizedProfit: 12.34,
  unrealizedProfit: 0,
  grossProfit: 15.9,
  totalTradingFees: 2.1,
  totalSlippageCost: 0.42,
  totalFundingCosts: 0.04,
  totalWithdrawalCosts: 0,
  roiPct: 2.468,
  annualizedReturnPct: 0,
  sharpeRatio: 0,
  sortinoRatio: 0,
  maxDrawdownPct: 1.2,
  currentDrawdownPct: 0.3,
  currentDailyLossPct: 0.1
};

const stateFixture = () => ({
  version: TRADING_STATE_VERSION,
  savedAt: new Date().toISOString(),
  capital: { ...capitalFixture },
  fifoLots: { 'BTC/USDT': [{ quantity: 0.002, unitCostUsd: 61000 }] },
  processedFillIds: ['fill-1', 'fill-2'],
  measuredFills: [{
    id: 'fill-1', orderId: 'ord-1', price: 61000, amount: 0.002, feeUsd: 0.11,
    referenceMid: 60999, referenceHalfSpreadBps: 0.8, timestamp: new Date().toISOString(), side: 'BUY'
  }],
  equityHighWaterMarkUsd: 515,
  utcDayKey: '2026-09-29',
  utcDayStartEquityUsd: 510,
  activeGrid: null,
  autonomyLevel: 0,
  activeSymbol: 'BTC/USDT'
});

const gridFixture = (over = {}) => ({
  id: 'grid-1',
  symbol: 'BTC/USDT',
  upperBoundary: 66000,
  lowerBoundary: 60000,
  levelsCount: 16,
  spacingType: 'GEOMETRIC',
  gridSpacingPct: 0.5,
  totalAllocatedUsd: 500,
  orderSizeUsd: 31,
  volatilityAdjustment: true,
  trendProtection: true,
  rebalanceThresholdPct: 2,
  activeLevels: [],
  lastRebalancedAt: new Date().toISOString(),
  ...over
});

// ---- 1. Round-trip fidelity -------------------------------------------------------------------

t('round-trip preserves every capital counter exactly', () => {
  const restored = deserializeTradingState(serializeTradingState(stateFixture()));
  assert.ok(restored, 'expected a restored state');
  for (const [key, value] of Object.entries(capitalFixture)) {
    assert.equal(restored.capital[key], value, `capital.${key} drifted`);
  }
});

t('round-trip preserves FIFO lots, de-dupe ids and measured fills', () => {
  const restored = deserializeTradingState(serializeTradingState(stateFixture()));
  assert.deepEqual(restored.fifoLots['BTC/USDT'], [{ quantity: 0.002, unitCostUsd: 61000 }]);
  assert.deepEqual(restored.processedFillIds, ['fill-1', 'fill-2']);
  assert.equal(restored.measuredFills.length, 1);
  assert.equal(restored.measuredFills[0].referenceMid, 60999, 'the quote snapshot must survive, or cost evidence is lost');
  assert.equal(restored.equityHighWaterMarkUsd, 515);
  assert.equal(restored.utcDayStartEquityUsd, 510);
});

// ---- 2. Fail-closed parsing -------------------------------------------------------------------

t('corrupt JSON yields null rather than a partial state', () => {
  assert.equal(deserializeTradingState('{ not json'), null);
  assert.equal(deserializeTradingState(''), null);
  assert.equal(deserializeTradingState('[]'), null);
  assert.equal(deserializeTradingState('null'), null);
});

t('unknown version is rejected', () => {
  const future = { ...stateFixture(), version: TRADING_STATE_VERSION + 1 };
  assert.equal(deserializeTradingState(JSON.stringify(future)), null);
  const past = { ...stateFixture(), version: 0 };
  assert.equal(deserializeTradingState(JSON.stringify(past)), null);
});

t('missing or empty capital block is rejected', () => {
  const { capital, ...withoutCapital } = stateFixture();
  assert.equal(deserializeTradingState(JSON.stringify(withoutCapital)), null);
  assert.equal(deserializeTradingState(JSON.stringify({ ...stateFixture(), capital: {} })), null);
  assert.equal(deserializeTradingState(JSON.stringify({ ...stateFixture(), capital: 'nope' })), null);
});

t('non-finite capital values are dropped, not silently coerced to zero', () => {
  const dirty = { ...stateFixture(), capital: { ...capitalFixture, totalEquity: 'NaN', grossProfit: null } };
  const restored = deserializeTradingState(JSON.stringify(dirty));
  assert.ok(restored);
  assert.equal('totalEquity' in restored.capital, false, 'a non-finite field must be dropped');
  assert.equal('grossProfit' in restored.capital, false);
  assert.equal(restored.capital.netRealizedProfit, 12.34, 'valid fields must survive');
});

t('malformed lots and quote-less fills are filtered out', () => {
  const dirty = {
    ...stateFixture(),
    fifoLots: { 'BTC/USDT': [{ quantity: 0, unitCostUsd: 10 }, { quantity: -1, unitCostUsd: 10 }, { quantity: 1, unitCostUsd: -5 }, { quantity: 2, unitCostUsd: 100 }] },
    measuredFills: [
      { id: 'no-quote', price: 100, amount: 1, referenceMid: 0, timestamp: new Date().toISOString(), side: 'BUY' },
      { id: 'ok', price: 100, amount: 1, referenceMid: 100, timestamp: new Date().toISOString(), side: 'BUY' }
    ]
  };
  const restored = deserializeTradingState(JSON.stringify(dirty));
  assert.deepEqual(restored.fifoLots['BTC/USDT'], [{ quantity: 2, unitCostUsd: 100 }]);
  assert.deepEqual(restored.measuredFills.map(f => f.id), ['ok'], 'a fill without a captured quote is unusable for cost attribution');
});

t(`measured fills are capped at ${MAX_MEASURED_FILLS}`, () => {
  const many = Array.from({ length: MAX_MEASURED_FILLS + 50 }, (_, i) => ({
    id: `f${i}`, orderId: `o${i}`, price: 100, amount: 1, feeUsd: 0, referenceMid: 100,
    referenceHalfSpreadBps: 1, timestamp: new Date().toISOString(), side: 'BUY'
  }));
  const restored = deserializeTradingState(JSON.stringify({ ...stateFixture(), measuredFills: many }));
  assert.equal(restored.measuredFills.length, MAX_MEASURED_FILLS);
  assert.equal(restored.measuredFills.at(-1).id, `f${MAX_MEASURED_FILLS + 49}`, 'the newest fills must be the ones kept');
});

// ---- 3. Secrets are never persisted -----------------------------------------------------------

t('a clean payload contains no secret-shaped keys', () => {
  assert.deepEqual(findSecretLikeKeys(stateFixture()), []);
});

t('secret-shaped keys are detected at any depth', () => {
  const found = findSecretLikeKeys({ a: { apiSecret: 'x' }, b: [{ totpSecret: 'y' }], c: 'password'.length ? { password: 'z' } : {} });
  assert.ok(found.includes('a.apiSecret'));
  assert.ok(found.includes('b.totpSecret'));
  assert.ok(found.includes('c.password'));
});

t('a write is REFUSED when the payload contains a credential', () => {
  const tainted = { ...stateFixture(), apiKey: 'should-never-hit-disk' };
  assert.equal(writeTradingState(tainted), false, 'the write must be refused');
  assert.equal(fs.existsSync(TRADING_STATE_PATH), false, 'nothing may be written');
});

// ---- 4. Atomic, permissioned writes -----------------------------------------------------------

t('write then read round-trips through the filesystem at mode 0600', () => {
  assert.equal(writeTradingState(stateFixture()), true);
  const mode = fs.statSync(TRADING_STATE_PATH).mode & 0o777;
  assert.equal(mode.toString(8), '600', `expected 0600, got ${mode.toString(8)}`);
  const restored = readTradingState();
  assert.ok(restored, 'expected the state to be readable');
  assert.equal(restored.capital.netRealizedProfit, 12.34);
  assert.equal(fs.existsSync(`${TRADING_STATE_PATH}.tmp`), false, 'the temp file must not be left behind');
});

t('a corrupt file on disk degrades to null instead of throwing', () => {
  fs.writeFileSync(TRADING_STATE_PATH, '{ truncated');
  assert.equal(readTradingState(), null);
});

t('a missing file degrades to null', () => {
  fs.rmSync(TRADING_STATE_PATH, { force: true });
  assert.equal(readTradingState(), null);
});

// ---- 5. Phantom order pruning -----------------------------------------------------------------

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

t('a stale local order absent from the exchange is pruned', () => {
  const local = [{ id: 'gone', symbol: 'BTCUSDT', placedAt: iso(5 * 60_000) }];
  assert.deepEqual(selectPhantomOrderIds(local, ['still-live'], now), ['gone']);
});

t('a local order still open on the exchange is kept', () => {
  const local = [{ id: 'live', symbol: 'BTCUSDT', placedAt: iso(10 * 60_000) }];
  assert.deepEqual(selectPhantomOrderIds(local, ['live'], now), []);
});

t('a just-placed order is never pruned (it may not be listed yet)', () => {
  const local = [{ id: 'inflight', symbol: 'BTCUSDT', placedAt: iso(2_000) }];
  assert.deepEqual(selectPhantomOrderIds(local, [], now, PHANTOM_ORDER_GRACE_MS), [], 'an in-flight placement must never be forgotten');
});

t('an order with an unparseable timestamp is kept', () => {
  const local = [{ id: 'weird', symbol: 'BTCUSDT', placedAt: 'not-a-date' }];
  assert.deepEqual(selectPhantomOrderIds(local, [], now), []);
  const local2 = [{ id: 'empty', symbol: 'BTCUSDT', placedAt: '' }];
  assert.deepEqual(selectPhantomOrderIds(local2, [], now), []);
});

t('pruning is selective across a mixed book', () => {
  const local = [
    { id: 'live-1', symbol: 'BTCUSDT', placedAt: iso(60_000) },
    { id: 'phantom-1', symbol: 'BTCUSDT', placedAt: iso(120_000) },
    { id: 'phantom-2', symbol: 'BTCUSDT', placedAt: iso(600_000) },
    { id: 'inflight-1', symbol: 'BTCUSDT', placedAt: iso(1_000) }
  ];
  assert.deepEqual(selectPhantomOrderIds(local, ['live-1'], now), ['phantom-1', 'phantom-2']);
});

// ---- 6. Grid restoration safety ---------------------------------------------------------------

t('a fresh, in-bounds grid is restorable', () => {
  assert.equal(isGridRestorable(gridFixture(), 63000, now), true);
});

t('a grid is NOT restored once it is stale', () => {
  const stale = gridFixture({ lastRebalancedAt: new Date(now - GRID_RESTORE_MAX_AGE_MS - 60_000).toISOString() });
  assert.equal(isGridRestorable(stale, 63000, now), false);
});

t('a grid is NOT restored when price has drifted beyond its bounds', () => {
  assert.equal(isGridRestorable(gridFixture(), 80000, now), false, 'far above the upper bound');
  assert.equal(isGridRestorable(gridFixture(), 45000, now), false, 'far below the lower bound');
  // just inside the 20% tolerance above the upper bound still restores
  assert.equal(isGridRestorable(gridFixture(), 66000 * 1.1, now), true);
  assert.equal(isGridRestorable(gridFixture(), 66000 * 1.3, now), false);
});

t('a malformed grid is never restored', () => {
  assert.equal(isGridRestorable(null, 63000, now), false);
  assert.equal(isGridRestorable(gridFixture({ upperBoundary: 0 }), 63000, now), false);
  assert.equal(isGridRestorable(gridFixture({ upperBoundary: 60000, lowerBoundary: 66000 }), 63000, now), false, 'inverted bounds');
  assert.equal(isGridRestorable(gridFixture({ lastRebalancedAt: 'garbage' }), 63000, now), false);
  assert.equal(isGridRestorable(gridFixture(), 0, now), false, 'no live price');
  assert.equal(isGridRestorable(gridFixture(), NaN, now), false);
});

// ---- Report ----------------------------------------------------------------------------------

try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\nstate-durability: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error(`  FAILED: ${f.name} -> ${f.message}`);
  process.exit(1);
}
