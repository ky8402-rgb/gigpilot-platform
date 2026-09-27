/**
 * Characterization tests for the autonomous profit gate.
 * Run after npm ci: node scripts/test-profit-gate.mjs (uses the tsx dev dependency).
 * These pin the profit-critical invariants that CI must protect:
 *   1. Net-edge formula and the 4.0 bps tradeability hurdle.
 *   2. Fail-closed allocation gating when live evidence is insufficient.
 *   3. Revenue-leak detection (negative edge, fee drag, vol mismatch).
 *   4. AutonomousOptimizationDecision shape conformance on every decision path.
 *   5. Off-switch and system-health fail-closed behavior.
 * Any change that breaks these invariants must fail CI.
 * Fixtures below are synthetic test data, never production performance evidence.
 */
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();
const optimizerUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'autonomousProfitOptimizer.ts')).href;
const { AutonomousProfitOptimizer } = await import(optimizerUrl);

let passed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failures.push({ name }); console.error(`  ✘ ${name}\n    ${e.message}`); }
}
async function ta(name, fn) {
  try { await fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failures.push({ name }); console.error(`  ✘ ${name}\n    ${e.message}`); }
}

// ---- fixtures ----
const baseCap = {
  initialCapital: 3500, totalEquity: 3500, totalEquityUsd: 3500, tradingCapital: 3500,
  availableCash: 3500, lockedInOrders: 0, profitReserve: 100, eligibleRealizedProfit: 0,
  withdrawableProfit: 0, totalSweptProfit: 0, netRealizedProfit: 0, unrealizedProfit: 0,
  grossProfit: 0, totalTradingFees: 0, totalSlippageCost: 0, totalFundingCosts: 0,
  totalWithdrawalCosts: 0, roiPct: 0, annualizedReturnPct: 0, sharpeRatio: 0, sortinoRatio: 0,
  maxDrawdownPct: 0, currentDrawdownPct: 0, winRatePct: 0, profitFactor: 0, totalTrades: 0,
  winningTrades: 0, losingTrades: 0
};
const regime = (over = {}) => ({
  regime: 'RANGE_BOUND_LOW_VOL', confidence: 0.9, atr: 43.2, rsi: 49, adx: 18, adxSlope: 0.1,
  bbBandwidth: 3.2, orderBookImbalance: 0.05, trendDirection: 'NEUTRAL', recommendedGridSpacing: 0.72,
  suggestedAction: 'test', detectedAt: new Date().toISOString(), ...over
});
const grid = (spacing = 0.72) => ({
  id: 'grid_test', symbol: 'BTC/USDT', upperBoundary: 65000, lowerBoundary: 55000, levelsCount: 12,
  spacingType: 'GEOMETRIC', gridSpacingPct: spacing, totalAllocatedUsd: 3500, orderSizeUsd: 175,
  volatilityAdjustment: true, trendProtection: true, rebalanceThresholdPct: 0.5, activeLevels: [],
  lastRebalancedAt: new Date().toISOString()
});
const perf = (over = {}) => ({
  netProfit: 120.5, grossProfit: 148.5, totalFees: 28, roiPct: 3.44, sharpeRatio: 1.42,
  sortinoRatio: 1.9, maxDrawdownPct: 4.2, winRatePct: 58, profitFactor: 1.31, tradesCount: 30,
  avgTradeProfitUsd: 4.01, avgHoldingTimeMinutes: 240, orderFillRatePct: 96.5, capitalUtilizationPct: 72,
  ...over
});
const pipeline = (score = 80) => ({
  currentStage: 'PROMOTED', overallScore: score, overfittingRiskPct: 12, canPromote: true,
  trainingData: { inSampleWindowDays: 90, sampleSizeCandles: 4320, inSampleSharpe: 1.6, inSampleRoiPct: 9, inSampleWinRatePct: 60, inSampleProfitFactor: 1.5, fittedAt: new Date().toISOString() },
  candidateModel: { hypothesis: 'test', parameterDeltaSummary: 'none', complexityPenaltyBps: 0.5, generatedAt: new Date().toISOString() },
  walkForward: { status: 'PASSED', windows: [], averageWfeRatio: 0.72, passedWindowsCount: 5, totalWindowsCount: 5, parameterStabilityScore: 82, evaluatedAt: new Date().toISOString() },
  outOfSample: { status: 'PASSED', heldOutDays: 30, oosSharpe: 1.3, oosRoiPct: 5, oosMaxDrawdownPct: 6, sharpeDegradationPct: 18, maxDdDegradationPct: 10, passedOverfitHurdle: true, evaluatedAt: new Date().toISOString() },
  paperShadow: { status: 'PASSED', hoursObserved: 168, requiredHours: 120, simulatedFillsCount: 42, requiredFills: 30, shadowNetProfitUsd: 18, shadowFillRatePct: 91, shadowSharpe: 1.1, slippageVarianceBps: 2, startedAt: new Date().toISOString() }
});
const champion = (over = {}) => ({
  id: 'sv_1', name: 'Champion Grid', version: 'v1', type: 'TREND_GRID', status: 'CHAMPION',
  createdAt: new Date().toISOString(), reasonForChange: 'genesis',
  parameters: { upperBoundary: 65000, lowerBoundary: 55000, gridLevels: 12, spacingType: 'GEOMETRIC', gridSpacingPct: 0.72 },
  backtestResults: perf(), liveTradingResults: perf(), validationScore: 75, validationPipeline: pipeline(), ...over
});
const research = [];
const costEvidence = {
  realizedSpreadCostUsd: 1.2, realizedSlippageCostUsd: 2.1, expectedMakerTakerFeesBps: 10, realizedAdverseSelectionCostUsd: 1.0, realizedFundingCostUsd: 0.2,
  expectedSpreadCostBps: 0.33, expectedSlippageCostBps: 1.2, expectedAdverseSelectionCostBps: 1.8,
  expectedFundingCarryingCostBps: 1.2, expectedExecutionUncertaintyBps: 1.8, sampleCount: 42,
  observedAt: new Date().toISOString()
};


// ---- 1. Net-edge formula and tradeability hurdle
console.log('\n[1] Net-edge formula and tradeability hurdle');
{
  const opt = new AutonomousProfitOptimizer();
  const audit = opt.conductRevenueAudit({ capital: baseCap, grid: grid(0.72), regime: regime(), midPrice: 60000, costEvidence });
  t('gross edge = gridSpacing * 100 * 0.55', () => assert.equal(audit.expectedNetEdge.expectedGrossEdgeBps, 39.6));
  t('authoritative frictions are included', () => {
    const e = audit.expectedNetEdge;
    assert.equal(e.makerTakerFeesBps, 10);
    assert.equal(e.expectedSpreadCostBps, 0.33);
    assert.equal(e.expectedSlippageBps, 1.2);
    assert.equal(e.adverseSelectionCostBps, 1.8);
    assert.equal(e.fundingCarryingCostBps, 1.2);
    assert.equal(e.executionUncertaintyBps, 1.8);
  });
  t('net edge = gross - all authoritative frictions', () => {
    const e = audit.expectedNetEdge;
    assert.ok(Math.abs(e.expectedNetEdgeBps - 23.27) < 0.005);
  });
  t('0.72% spacing clears the 4.0 bps hurdle', () => assert.equal(audit.expectedNetEdge.isTradeable, true));
  t('tight 0.20% spacing fails the hurdle', () => {
    const a = opt.conductRevenueAudit({ capital: baseCap, grid: grid(0.20), regime: regime(), midPrice: 60000, costEvidence });
    assert.equal(a.expectedNetEdge.isTradeable, false);
  });
  t('missing cost evidence fails closed', () => {
    const a = opt.conductRevenueAudit({ capital: baseCap, grid: grid(0.72), regime: regime(), midPrice: 60000 });
    assert.equal(a.expectedNetEdge, undefined);
    assert.equal(a.netRealizedProfitUsd, 0);
    assert.ok(a.leaks.length > 0);
  });
  t('realized net profit subtracts verified post-cost USD evidence', () => {
    assert.equal(audit.netRealizedProfitUsd, -4.5);
  });
}

// ---- 2. Fail-closed allocation gating ----
console.log('\n[2] Fail-closed allocation gating');
{
  const opt = new AutonomousProfitOptimizer();
  const cap = { ...baseCap };
  t('no champion -> empty allocation', () => {
    const alloc = opt.computeStrategyAllocations({ capital: cap, regime: regime(), edge: { expectedNetEdgeBps: 10 } });
    assert.equal(alloc.strategies.length, 0);
    assert.equal(alloc.applied, false);
  });
  t('missing validation pipeline -> empty allocation despite positive profit', () => {
    const ch = champion({ validationPipeline: undefined });
    const alloc = opt.computeStrategyAllocations({ capital: cap, regime: regime(), edge: { expectedNetEdgeBps: 10 }, champion: ch });
    assert.equal(alloc.strategies.length, 0);
    assert.equal(alloc.applied, false);
    assert.equal(alloc.rebalanceRequired, false);
  });
  t('edge at/below 4.0 bps -> empty allocation regardless of champion quality', () => {
    const alloc = opt.computeStrategyAllocations({ capital: cap, regime: regime(), edge: { expectedNetEdgeBps: 4.0 }, champion: champion() });
    assert.equal(alloc.strategies.length, 0);
  });
  t('insufficient live trades (<30) -> empty allocation', () => {
    const ch = champion({ liveTradingResults: perf({ tradesCount: 29 }) });
    const alloc = opt.computeStrategyAllocations({ capital: cap, regime: regime(), edge: { expectedNetEdgeBps: 10 }, champion: ch });
    assert.equal(alloc.strategies.length, 0);
  });
  t('negative net live profit -> empty allocation', () => {
    const ch = champion({ liveTradingResults: perf({ netProfit: -50 }) });
    const alloc = opt.computeStrategyAllocations({ capital: cap, regime: regime(), edge: { expectedNetEdgeBps: 10 }, champion: ch });
    assert.equal(alloc.strategies.length, 0);
  });
  t('unstable validation (overallScore < 60) -> empty allocation', () => {
    const ch = champion({ validationScore: 50, validationPipeline: pipeline(55) });
    const alloc = opt.computeStrategyAllocations({ capital: cap, regime: regime(), edge: { expectedNetEdgeBps: 10 }, champion: ch });
    assert.equal(alloc.strategies.length, 0);
  });
  t('unknown regime -> empty allocation', () => {
    const alloc = opt.computeStrategyAllocations({ capital: cap, regime: regime({ regime: 'UNKNOWN' }), edge: { expectedNetEdgeBps: 10 }, champion: champion() });
    assert.equal(alloc.strategies.length, 0);
  });
  t('zero capital -> empty allocation', () => {
    const alloc = opt.computeStrategyAllocations({ capital: { ...cap, tradingCapital: 0, totalEquity: 0 }, regime: regime(), edge: { expectedNetEdgeBps: 10 }, champion: champion() });
    assert.equal(alloc.strategies.length, 0);
  });
  t('eligible champion -> MAINTAIN allocation with edge recorded', () => {
    const alloc = opt.computeStrategyAllocations({ capital: cap, regime: regime(), edge: { expectedNetEdgeBps: 10 }, champion: champion(), gridCapitalUsd: 3500 });
    assert.equal(alloc.strategies.length, 1);
    assert.equal(alloc.strategies[0].action, 'MAINTAIN');
    assert.ok(alloc.strategies[0].metrics.meetsMinimumEdgeThreshold);
    assert.equal(alloc.applied, false);
  });
}

// ---- 3. Decision conformance (the regression that broke CI) ----
console.log('\n[3] AutonomousOptimizationDecision conformance');
{
  const opt = new AutonomousProfitOptimizer();
  const fullInput = { capital: { ...baseCap, netRealizedProfit: 120.5, grossProfit: 148.5, totalTradingFees: 28 }, grid: grid(), regime: regime(), research, champion: champion(), systemHealthy: true, midPrice: 60000, forceImmediate: true, costEvidence };
  await ta('eligible cycle emits conformant ALLOCATE_CAPITAL decision', async () => {
    const d = await opt.auditAndOptimize(fullInput);
    assert.equal(d.objective, 'NET_REALIZED_PROFIT_AFTER_FEES');
    assert.equal(d.decision, 'ALLOCATE_CAPITAL');
    assert.ok(typeof d.reason === 'string' && d.reason.length > 0);
    assert.ok(!('previousParams' in d));
    assert.ok(!('proposedParams' in d));
    assert.ok(!('builtStrategy' in d));
    assert.ok(d.auditReport && d.auditReport.expectedNetEdge);
    assert.equal(d.applied, false);
  });
  await ta('missing validation pipeline pauses optimization without applying allocation', async () => {
    const d = await opt.auditAndOptimize({ ...fullInput, champion: champion({ validationPipeline: undefined }) });
    assert.equal(d.decision, 'PAUSE_OPTIMIZATION');
    assert.equal(d.applied, false);
    assert.equal(d.strategyAllocation.strategies.length, 0);
  });
  await ta('fail-closed cycle emits conformant PAUSE_OPTIMIZATION decision', async () => {
    const d = await opt.auditAndOptimize({ ...fullInput, grid: null });
    assert.equal(d.decision, 'PAUSE_OPTIMIZATION');
    assert.equal(d.objective, 'NET_REALIZED_PROFIT_AFTER_FEES');
    assert.equal(d.applied, false);
  });
  await ta('unhealthy system emits PAUSE_OPTIMIZATION (fail-closed)', async () => {
    const d = await opt.auditAndOptimize({ ...fullInput, systemHealthy: false });
    assert.equal(d.decision, 'PAUSE_OPTIMIZATION');
    assert.equal(d.applied, false);
  });
  await ta('non-tradeable edge emits PAUSE_OPTIMIZATION', async () => {
    const d = await opt.auditAndOptimize({ ...fullInput, grid: grid(0.2) });
    assert.equal(d.decision, 'PAUSE_OPTIMIZATION');
  });
  await ta('cooldown returns last decision when not forced', async () => {
    const first = await opt.auditAndOptimize(fullInput);
    const second = await opt.auditAndOptimize({ ...fullInput, forceImmediate: false });
    assert.equal(second.id, first.id);
  });
}

// ---- 4. Off-switch fail-closed behavior ----
console.log('\n[4] Off-switch fail-closed behavior');
{
  const opt = new AutonomousProfitOptimizer();
  const fullInput = { capital: baseCap, grid: grid(), regime: regime(), research, champion: champion(), systemHealthy: true, midPrice: 60000, forceImmediate: true };
  await ta('disabled optimizer pauses and mutates nothing', async () => {
    opt.setOffSwitch(false);
    const d = await opt.auditAndOptimize(fullInput);
    assert.equal(d.decision, 'PAUSE_OPTIMIZATION');
    assert.equal(d.applied, false);
    opt.setOffSwitch(true);
  });
  t('healthCheck reports OFF when disabled and objective is profit-pure', () => {
    opt.setOffSwitch(false);
    const h = opt.healthCheck();
    assert.equal(h.status, 'OFF');
    assert.equal(h.details.objective, 'NET_REALIZED_PROFIT_AFTER_FEES');
    opt.setOffSwitch(true);
  });
}

// ---- Health truthfulness ----
console.log('\n[6] Profit optimizer health truthfulness');
{
  const opt = new AutonomousProfitOptimizer();
  process.env.GEMINI_API_KEY = 'test-only';
  t('health is DEGRADED before evidence-backed audit', () => assert.equal(opt.healthCheck().status, 'DEGRADED'));
  opt.conductRevenueAudit({ capital: { ...baseCap, netRealizedProfit: 120.5, grossProfit: 148.5, totalTradingFees: 28 }, grid: grid(0.72), regime: regime(), midPrice: 60000, costEvidence });
  t('health becomes HEALTHY only after evidence-backed audit', () => assert.equal(opt.healthCheck().status, 'HEALTHY'));
}

// ---- Post-cost evidence regression ----
console.log('\n[5] Authoritative post-cost evidence');
{
  const opt = new AutonomousProfitOptimizer();
  const audit = opt.conductRevenueAudit({ capital: baseCap, grid: grid(0.72), regime: regime(), midPrice: 60000 });
  t('missing cost evidence fails closed', () => {
    assert.equal(audit.expectedNetEdge, undefined);
    assert.equal(audit.netRealizedProfitUsd, 0);
    assert.ok(audit.leaks.length > 0);
  });
  t('fresh cost evidence is accepted', () => {
    const a = opt.conductRevenueAudit({ capital: baseCap, grid: grid(0.72), regime: regime(), midPrice: 60000, costEvidence });
    assert.ok(a.expectedNetEdge);
    assert.equal(a.expectedNetEdge.isTradeable, true);
    assert.equal(a.netRealizedProfitUsd, -4.5);
  });
}

unregister();
console.log(`\nProfit-gate characterization: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('\nFAILED assertions:');
  for (const f of failures) console.error(`  ✘ ${f.name}`);
  process.exit(1);
}
console.log('ALL PROFIT-GATE INVARIANTS HOLD.');
