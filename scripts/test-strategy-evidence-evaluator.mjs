/**
 * Real-Candle Strategy Evaluator & Evidence-Based Comparison Test Suite
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();

const evalUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'strategyEvaluator.ts')).href;
const loopUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'learningLoop.ts')).href;

const { StrategyEvaluator } = await import(evalUrl);
const { LearningLoopEngine } = await import(loopUrl);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ ${message}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${message}`);
    failed++;
  }
}

console.log('--- Real-Candle Strategy Evaluator & Evidence-Based Comparison Suite ---');

// Generate 40 deterministic candles representing a ranging / mean-reverting regime
const basePrice = 85000;
const testCandles = [];
for (let i = 0; i < 40; i++) {
  const angle = (i / 10) * Math.PI;
  const cycle = Math.sin(angle) * 800; // oscillating +/- $800
  const open = basePrice + cycle;
  const close = open + (Math.sin(angle * 1.5) * 200);
  const high = Math.max(open, close) + 150;
  const low = Math.min(open, close) - 150;
  testCandles.push({
    timestamp: 1700000000000 + (i * 60000),
    open,
    high,
    low,
    close,
    volume: 12.5 + (i % 5)
  });
}

// [1] Deterministic Simulation Invariants
console.log('\n[1] Deterministic Simulation Invariants');

const evaluator = new StrategyEvaluator(2.0, 5.5); // 2 bps maker, 5.5 bps taker

const emptySim = evaluator.simulate({}, []);
assert(emptySim.candlesEvaluated === 0, 'Empty candles return 0 evaluated');
assert(emptySim.metrics.netProfit === 0, 'Empty candles return 0 net profit');
assert(emptySim.trades.length === 0, 'No trades generated on empty candles');

const baselineSim = evaluator.simulate(
  { gridSpacingPct: 0.5, gridLevels: 16 },
  testCandles,
  1.0, // 1.0 bps funding
  1000 // $1000 capital
);
assert(baselineSim.candlesEvaluated === 40, 'Evaluates all 40 candles');
assert(typeof baselineSim.metrics.netProfit === 'number', 'Computes numeric net profit');
assert(baselineSim.metrics.totalFees >= 0, 'Deducts positive fees for maker trades & funding');
assert(baselineSim.metrics.roiPct !== undefined, 'ROI % computed');

// [2] Walk-Forward Evaluation & Overfitting Detection
console.log('\n[2] Walk-Forward Evaluation & Overfitting Detection');

const wf = evaluator.evaluateWalkForward(
  { gridSpacingPct: 0.5, gridLevels: 16 },
  testCandles,
  1.0,
  0.65
);
assert(wf.windows.length > 0, 'Produces at least 1 walk-forward window');
assert(typeof wf.wfeRatio === 'number', 'Computes numeric WFE ratio');
assert(wf.overfittingRiskPct >= 0 && wf.overfittingRiskPct <= 100, 'Overfitting risk bounded in [0, 100]%');

// [3] Head-to-Head Evidence-Based Comparison
console.log('\n[3] Head-to-Head Evidence-Based Comparison');

const champion = {
  id: 'CHAMP-BASELINE',
  name: 'Baseline Champion',
  version: 'v2.0-LIVE',
  type: 'ADAPTIVE_GRID',
  status: 'CHAMPION',
  createdAt: new Date().toISOString(),
  parameters: {
    gridSpacingPct: 0.8,
    gridLevels: 16
  },
  backtestResults: baselineSim.metrics,
  liveTradingResults: baselineSim.metrics
};

// Challenger with tighter spacing targeting mean-reversion
const challengerGood = {
  id: 'CHALL-TIGHT',
  name: 'Optimized Mean-Reversion Challenger',
  version: 'v2.1-CANDIDATE',
  type: 'ADAPTIVE_GRID',
  status: 'CHALLENGER',
  createdAt: new Date().toISOString(),
  parameters: {
    gridSpacingPct: 0.35,
    gridLevels: 24
  },
  backtestResults: baselineSim.metrics,
  liveTradingResults: baselineSim.metrics
};

const comparisonGood = evaluator.compareCandidateWithChampion(
  challengerGood,
  champion,
  testCandles,
  1.0
);
assert(comparisonGood.championId === champion.id, 'Records Champion ID in comparison');
assert(comparisonGood.challengerId === challengerGood.id, 'Records Challenger ID in comparison');
assert(typeof comparisonGood.netProfitDeltaUsd === 'number', 'Computes net profit delta');
assert(typeof comparisonGood.sharpeDelta === 'number', 'Computes Sharpe delta');
assert(['PROMOTE_ELIGIBLE', 'REJECT_UNDERPERFORMING', 'REJECT_OVERFIT', 'HOLD_FOR_MORE_EVIDENCE'].includes(comparisonGood.recommendation), 'Produces standard recommendation code');

// [4] LearningLoop Integration with Real Candle Evidence
console.log('\n[4] LearningLoop Integration with Real Candle Evidence');

const loop = new LearningLoopEngine();
const initialChamp = loop.getChampionStrategy();
assert(initialChamp.status === 'CHAMPION', 'Learning loop initializes with Champion');

// Create a challenger
const variant = loop.createStrategyVariantWithPipeline({
  baseStrategyId: initialChamp.id,
  name: 'Empirical Variant Alpha',
  reasonForChange: 'Hypothesis testing tighter rungs',
  parameters: { gridSpacingPct: 0.35, gridLevels: 20 },
  expectedEffect: 'Higher fill frequency on ranging candles'
});
assert(variant.status === 'CHALLENGER', 'Created variant has CHALLENGER status');

// Evaluate challenger using real candles
const evalResult = loop.evaluateChallengerWithRealCandles(variant.id, testCandles, 1.0);
assert(evalResult.success === true, 'Real candle evaluation succeeds');
assert(evalResult.comparison !== undefined, 'Returns comparison payload');

const updatedVariant = loop.getChallengerStrategies().find(s => s.id === variant.id);
assert(Boolean(updatedVariant.validationPipeline), 'Validation pipeline exists');
assert(updatedVariant.validationPipeline.trainingData.sampleSizeCandles === 40, 'Records real sample size of 40 candles');

// Insufficient candles fail-closed check
const badEval = loop.evaluateChallengerWithRealCandles(variant.id, [{ open: 1, high: 2, low: 0.5, close: 1.5, volume: 1, timestamp: 1 }]);
assert(badEval.success === false, 'Rejects evaluation with < 5 candles (fail closed)');

console.log(`\nStrategy Evaluator Suite: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL STRATEGY EVIDENCE EVALUATOR INVARIANTS HOLD.');
  process.exit(0);
}
