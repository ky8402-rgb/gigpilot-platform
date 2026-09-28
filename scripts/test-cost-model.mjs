/**
 * Characterization tests for the authoritative post-cost model and the cost-aware grid-spacing
 * optimizer. Run with: node scripts/test-cost-model.mjs (uses the tsx dev dependency).
 *
 * These pin the invariants the profitability loop depends on:
 *   1. Execution cost is decomposed against the quote captured at dispatch: spread is separated
 *      from genuine slippage, and a fill with no captured quote is EXCLUDED rather than defaulted.
 *   2. Evidence is fail-closed: withheld entirely below the sample threshold or without a live
 *      two-sided book, instead of being filled with placeholder values.
 *   3. Fees are MEASURED from real fills rather than the hardcoded fee-rate assumption.
 *   4. Funding carry is only attributed from a real funding rate plus a defensible holding horizon.
 *   5. Markout sign convention: a move against the freshly opened side is adverse (positive).
 *   6. Spacing optimization stays inside its bounded ±25% neighbourhood and never widens risk.
 *
 * All fixtures below are synthetic TEST data, never production performance evidence.
 */
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();
const costModelUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'costModel.ts')).href;
const optimizerUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'autonomousProfitOptimizer.ts')).href;

const { buildCostEvidence, decomposeExecutionCost, computeMarkoutBps, DEFAULT_MIN_SAMPLES } = await import(costModelUrl);
const { AutonomousProfitOptimizer } = await import(optimizerUrl);
unregister();

let passed = 0;
const failures = [];
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failures.push({ name, message: e.message }); console.error(`  ✘ ${name}\n    ${e.message}`); }
}

// ---- Fixtures ---------------------------------------------------------------------------------

const book = {
  symbol: 'BTC/USDT',
  bids: [{ price: 99.99, amount: 5, total: 5 }],
  asks: [{ price: 100.01, amount: 5, total: 5 }],
  spread: 0.02,
  spreadBps: 2,
  midPrice: 100,
  timestamp: new Date().toISOString()
};

function fill(id, price, amount = 1, feeUsd = 0.055, extra = {}) {
  return {
    id,
    orderId: `ord-${id}`,
    price,
    amount,
    feeUsd,
    referenceMid: 100,
    referenceHalfSpreadBps: 1,
    timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
    side: 'BUY',
    ...extra
  };
}

const cleanFills = (n = 10) => Array.from({ length: n }, (_, i) => fill(`f${i}`, 100.01));

// ---- 1. Execution cost decomposition ----------------------------------------------------------

t('spread is separated from genuine slippage (fill at the touch => zero slippage)', () => {
  const d = decomposeExecutionCost(fill('a', 100.01));
  assert.ok(d, 'expected a decomposition');
  assert.equal(d.executionCostBps.toFixed(4), '1.0000');
  assert.equal(d.spreadCostBps.toFixed(4), '1.0000');
  assert.equal(d.excessSlippageBps.toFixed(4), '0.0000');
  assert.equal(d.notionalUsd, 100.01);
});

t('execution beyond the quote is attributed as slippage', () => {
  const d = decomposeExecutionCost(fill('b', 100.03));
  assert.ok(d);
  assert.equal(d.executionCostBps.toFixed(4), '3.0000');
  assert.equal(d.spreadCostBps.toFixed(4), '1.0000');
  assert.equal(d.excessSlippageBps.toFixed(4), '2.0000');
});

t('a fill with no captured quote is excluded, not defaulted to zero cost', () => {
  assert.equal(decomposeExecutionCost(fill('c', 100.01, 1, 0.055, { referenceMid: undefined })), null);
  assert.equal(decomposeExecutionCost(fill('d', 100.01, 1, 0.055, { referenceHalfSpreadBps: undefined })), null);
  assert.equal(decomposeExecutionCost(fill('e', 100.01, 1, 0.055, { referenceMid: 0 })), null);
});

// ---- 2. Fail-closed evidence ------------------------------------------------------------------

t('no evidence below the sample threshold', () => {
  assert.equal(buildCostEvidence({ fills: cleanFills(DEFAULT_MIN_SAMPLES - 1), orderBook: book }), null);
  const ev = buildCostEvidence({ fills: cleanFills(DEFAULT_MIN_SAMPLES), orderBook: book });
  assert.ok(ev, 'expected evidence at the threshold');
  assert.equal(ev.sampleCount, DEFAULT_MIN_SAMPLES);
});

t('no evidence without a live two-sided book', () => {
  assert.equal(buildCostEvidence({ fills: cleanFills(), orderBook: null }), null);
  assert.equal(buildCostEvidence({ fills: cleanFills(), orderBook: { ...book, asks: [] } }), null);
  assert.equal(buildCostEvidence({ fills: cleanFills(), orderBook: { ...book, bids: [{ price: 0, amount: 0, total: 0 }] } }), null);
});

t('unmeasured fills do not inflate the sample count', () => {
  const mixed = [...cleanFills(10), fill('bad', 100.01, 1, 0.055, { referenceMid: undefined })];
  const ev = buildCostEvidence({ fills: mixed, orderBook: book });
  assert.equal(ev.sampleCount, 10, 'the unmeasured fill must be excluded');
});

// ---- 3. Fees measured, not assumed ------------------------------------------------------------

t('fee cost is measured from real fills, not the hardcoded 10 bps assumption', () => {
  const ev = buildCostEvidence({ fills: cleanFills(), orderBook: book });
  // fee 0.055 over notional 100.01 = 5.4995 bps (the measured value, not the 10 bps assumption)
  assert.equal(ev.expectedMakerTakerFeesBps.toFixed(4), '5.4995');
  assert.ok(Math.abs(ev.expectedMakerTakerFeesBps - 5.5) < 0.01, 'must reflect the real fill fees');
  assert.notEqual(ev.expectedMakerTakerFeesBps, 10, 'must not fall back to the spot VIP0 constant');
  assert.equal(ev.realizedFeesUsd.toFixed(4), '0.5500');
  assert.equal(ev.feeRateSource, 'MEASURED_FROM_FILLS');
});

t('realized cost components sum to the reported total', () => {
  const fills = [...cleanFills(9), fill('slip', 100.03)];
  const ev = buildCostEvidence({ fills, orderBook: book });
  const sum = ev.realizedFeesUsd + ev.realizedSpreadCostUsd + ev.realizedSlippageCostUsd + ev.realizedAdverseSelectionCostUsd + ev.realizedFundingCostUsd;
  assert.ok(Math.abs(sum - ev.realizedTotalCostUsd) < 1e-6, `components ${sum} != total ${ev.realizedTotalCostUsd}`);
  assert.ok(ev.realizedSlippageCostUsd > 0, 'the wide fill must contribute slippage');
  assert.ok(ev.expectedExecutionUncertaintyBps > 0, 'dispersion of real slippage must drive uncertainty');
});

// ---- 4. Funding only from a real rate + real horizon ------------------------------------------

t('funding is UNAVAILABLE (not zero-assumed) without a live rate', () => {
  const ev = buildCostEvidence({ fills: cleanFills(), orderBook: book, fundingRateHourly: null, expectedHoldingHours: 2 });
  assert.equal(ev.fundingRateSource, 'UNAVAILABLE');
  assert.equal(ev.expectedFundingCarryingCostBps, 0);
  assert.equal(ev.realizedFundingCostUsd, 0);
});

t('funding is attributed from a real hourly rate and holding horizon', () => {
  const ev = buildCostEvidence({
    fills: cleanFills(),
    orderBook: book,
    fundingRateHourly: 0.0001, // 1 bps per hour
    expectedHoldingHours: 3,
    openPositionNotionalUsd: 100
  });
  assert.equal(ev.fundingRateSource, 'LIVE_TICKER');
  assert.equal(ev.expectedFundingCarryingCostBps.toFixed(4), '3.0000');
  assert.equal(ev.realizedFundingCostUsd.toFixed(4), '0.0300');
});

t('live spread drives the forward-looking spread cost', () => {
  const ev = buildCostEvidence({ fills: cleanFills(), orderBook: book });
  assert.equal(ev.expectedSpreadCostBps.toFixed(4), '1.0000');
  const wide = { ...book, spreadBps: 8 };
  assert.equal(buildCostEvidence({ fills: cleanFills(), orderBook: wide }).expectedSpreadCostBps.toFixed(4), '4.0000');
});

// ---- 5. Markout sign convention --------------------------------------------------------------

t('markout is adverse when the market moves against the new side', () => {
  assert.equal(computeMarkoutBps(100, 'BUY', 99.9).toFixed(2), '10.00', 'a fall after buying is adverse');
  assert.equal(computeMarkoutBps(100, 'BUY', 100.1).toFixed(2), '-10.00', 'a rise after buying is favourable');
  assert.equal(computeMarkoutBps(100, 'SELL', 100.1).toFixed(2), '10.00', 'a rise after selling is adverse');
  assert.equal(computeMarkoutBps(100, 'SELL', 99.9).toFixed(2), '-10.00');
  assert.equal(computeMarkoutBps(0, 'BUY', 100), 0, 'invalid inputs must not produce a value');
});

t('only adverse markouts are charged, and they are apportioned to the fill notional', () => {
  const fills = cleanFills(10);
  const ev = buildCostEvidence({
    fills,
    orderBook: book,
    markouts: [
      { fillId: 'f0', markoutBps: 5 },    // adverse: 5 bps on ~100 notional
      { fillId: 'f1', markoutBps: -20 },  // favourable: must not reduce cost
      { fillId: 'unknown', markoutBps: 500 } // unmatched: ignored
    ]
  });
  assert.equal(ev.markoutSampleCount, 2, 'the unmatched markout must be ignored');
  assert.ok(Math.abs(ev.realizedAdverseSelectionCostUsd - 0.05) < 1e-6, `got ${ev.realizedAdverseSelectionCostUsd}`);
  assert.equal(ev.expectedAdverseSelectionCostBps.toFixed(4), '2.5000', 'mean of adverse-only markouts (5 and 0)');
});

// ---- 6. Cost-aware spacing optimization -------------------------------------------------------

const edgeFixture = (over = {}) => ({
  expectedGrossEdgeBps: 25,
  makerTakerFeesBps: 5.5,
  expectedSpreadCostBps: 1,
  expectedSlippageBps: 0.5,
  adverseSelectionCostBps: 0.5,
  fundingCarryingCostBps: 1.2,
  executionUncertaintyBps: 0.3,
  expectedNetEdgeBps: 17,
  isTradeable: true,
  minHurdleRateBps: 4,
  edgeFormula: 'fixture',
  timestamp: new Date().toISOString(),
  ...over
});

t('spacing optimization never leaves its bounded ±25% neighbourhood', () => {
  const opt = new AutonomousProfitOptimizer();
  for (const funding of [0, 1.2, 40, 500]) {
    for (const current of [0.05, 0.5, 2]) {
      for (const maxChange of [25, 10]) {
        const r = opt.optimiseGridSpacing({ currentSpacingPct: current, expectedNetEdge: edgeFixture({ fundingCarryingCostBps: funding }), maxRelativeChangePct: maxChange });
        const lo = current * (1 - maxChange / 100) - 1e-9;
        const hi = current * (1 + maxChange / 100) + 1e-9;
        assert.ok(r.recommendedSpacingPct >= lo && r.recommendedSpacingPct <= hi,
          `spacing ${r.recommendedSpacingPct} outside [${lo}, ${hi}] (funding ${funding}, current ${current}, max ${maxChange})`);
      }
    }
  }
});

t('wider spacing is chosen when per-round-trip costs are amortised over a larger capture', () => {
  const opt = new AutonomousProfitOptimizer();
  const r = opt.optimiseGridSpacing({ currentSpacingPct: 0.5, expectedNetEdge: edgeFixture() });
  assert.equal(r.recommendedSpacingPct.toFixed(6), '0.625000');
  assert.ok(r.improvementBps > 0, 'expected a measured improvement');
});

t('tighter spacing is chosen when carrying cost dominates', () => {
  const opt = new AutonomousProfitOptimizer();
  const r = opt.optimiseGridSpacing({ currentSpacingPct: 0.5, expectedNetEdge: edgeFixture({ fundingCarryingCostBps: 40 }) });
  assert.equal(r.recommendedSpacingPct.toFixed(6), '0.375000');
  assert.ok(r.improvementBps > 0);
});

t('an unchanged spacing reports no improvement (so no mutation is applied)', () => {
  const opt = new AutonomousProfitOptimizer();
  const r = opt.optimiseGridSpacing({ currentSpacingPct: 0, expectedNetEdge: edgeFixture() });
  assert.equal(r.improvementBps, 0);
  assert.equal(r.recommendedSpacingPct, 0);
});

// ---- 7. Regression: the optimizer stays paused without evidence -------------------------------

t('audit without cost evidence is fail-closed with a HIGH leak and zero efficiency score', () => {
  const opt = new AutonomousProfitOptimizer();
  const report = opt.conductRevenueAudit({
    capital: { netRealizedProfit: 100, totalTradingFees: 5, grossProfit: 120 },
    grid: { gridSpacingPct: 0.5, totalAllocatedUsd: 1000, upperBoundary: 101, lowerBoundary: 99 },
    regime: { atr: 50 },
    midPrice: 100
  });
  assert.equal(report.revenueEfficiencyScore, 0, 'must not score efficiency without evidence');
  assert.equal(report.expectedNetEdge, undefined, 'no net edge may be asserted without evidence');
  assert.ok(report.leaks.some(l => l.severity === 'HIGH'), 'a HIGH leak must be reported');
  assert.equal(report.costEvidence, undefined);
});

t('audit with real evidence produces a tradeable net edge and exposes the ledger', () => {
  const opt = new AutonomousProfitOptimizer();
  const ev = buildCostEvidence({ fills: cleanFills(), orderBook: book, fundingRateHourly: 0.0001, expectedHoldingHours: 2 });
  assert.ok(ev);
  const report = opt.conductRevenueAudit({
    capital: { netRealizedProfit: 100, totalTradingFees: 5, grossProfit: 120 },
    grid: { gridSpacingPct: 0.5, totalAllocatedUsd: 1000, upperBoundary: 101, lowerBoundary: 99 },
    regime: { atr: 50 },
    midPrice: 100,
    costEvidence: ev
  });
  assert.ok(report.expectedNetEdge, 'a net edge must be computed from evidence');
  assert.equal(report.costEvidence.sampleCount, 10, 'the ledger must be exposed for inspection');
  // gross = 0.5% * 100 * 0.55 = 27.5 bps
  // costs  = 5.4995 (measured fees) + 1 (half-spread) + 0 (no excess slippage) + 0 (no markouts)
  //          + 2 (0.0001/hr * 2h = 2 bps carry) + 0 (zero slippage dispersion) = 8.4995 bps
  assert.equal(report.expectedNetEdge.expectedNetEdgeBps.toFixed(2), '19.00');
  assert.equal(report.expectedNetEdge.isTradeable, true);
  assert.equal(report.revenueEfficiencyScore > 0, true);
});

// ---- Report ----------------------------------------------------------------------------------

console.log(`\ncost-model: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.error(`  FAILED: ${f.name} -> ${f.message}`);
  process.exit(1);
}
