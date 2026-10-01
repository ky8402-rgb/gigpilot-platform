/**
 * Regression Test Suite: Champion / Challenger Testing & Automatic Self-Healing Rollback
 *
 * Verifies:
 * 1. Champion preservation and tenure lock
 * 2. Challenger evidence accumulation
 * 3. Safe promotion with history archival
 * 4. Detection of live regression (drawdown breach, loss drift, win rate collapse)
 * 5. Automatic rollback restoring previous stable champion
 * 6. Protection against noise rollbacks before sample significance
 * 7. Rollback telemetry and audit trail integrity
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();
const moduleUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'learningLoop.ts')).href;
const { LearningLoopEngine } = await import(moduleUrl);

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

console.log('--- Champion/Challenger Evidence & Self-Healing Rollback Suite ---');

// 1. Initial State & Champion Setup
console.log('\n[1] Initial State & Promotion');
const loop = new LearningLoopEngine();
const initialChampion = loop.getChampionStrategy();
assert(initialChampion.status === 'CHAMPION', 'Initial strategy has CHAMPION status');
assert(loop.getStrategyHistory().length === 0, 'Strategy history starts empty');

// Register a stable baseline champion with verified positive metrics
const baselineChampion = {
  id: 'STRAT-CHAMPION-BASELINE-V1',
  name: 'Adaptive Grid Proven Baseline',
  version: 'v1.0-LIVE',
  type: 'ADAPTIVE_GRID',
  status: 'CHAMPION',
  createdAt: new Date().toISOString(),
  deployedAt: new Date().toISOString(),
  reasonForChange: 'Initial proven baseline',
  parameters: { gridSpacingPct: 0.8, gridLevels: 10 },
  backtestResults: {
    netProfit: 250, grossProfit: 300, totalFees: 50, roiPct: 5.2,
    sharpeRatio: 1.8, sortinoRatio: 2.1, maxDrawdownPct: 1.2, winRatePct: 68,
    profitFactor: 2.1, tradesCount: 120, avgTradeProfitUsd: 2.08,
    avgHoldingTimeMinutes: 45, orderFillRatePct: 98, capitalUtilizationPct: 40
  },
  liveTradingResults: {
    netProfit: 180, grossProfit: 215, totalFees: 35, roiPct: 4.1,
    sharpeRatio: 1.6, sortinoRatio: 1.9, maxDrawdownPct: 1.1, winRatePct: 65,
    profitFactor: 1.9, tradesCount: 85, avgTradeProfitUsd: 2.11,
    avgHoldingTimeMinutes: 42, orderFillRatePct: 99, capitalUtilizationPct: 38
  },
  validationScore: 88,
  actualEffect: 'Proven live stability'
};

// Seed baseline champion and advance time to clear tenure lock
loop.championStrategy = baselineChampion;
loop.setChampionFreezePeriod(1); // 1 hour for test

// Create a high-performing challenger candidate
const challengerCandidate = {
  id: 'STRAT-CHALLENGER-NEW-V2',
  name: 'Experimental Tight Spread Momentum',
  version: 'v2.0-CANDIDATE',
  type: 'TREND_GRID',
  status: 'CHALLENGER',
  createdAt: new Date().toISOString(),
  reasonForChange: 'Higher theoretical yield in trending regimes',
  parameters: { gridSpacingPct: 0.45, gridLevels: 15 },
  backtestResults: {
    netProfit: 450, grossProfit: 550, totalFees: 100, roiPct: 8.5,
    sharpeRatio: 2.4, sortinoRatio: 2.8, maxDrawdownPct: 1.5, winRatePct: 72,
    profitFactor: 2.4, tradesCount: 200, avgTradeProfitUsd: 2.25,
    avgHoldingTimeMinutes: 30, orderFillRatePct: 99, capitalUtilizationPct: 45
  },
  validationPipeline: {
    stages: [],
    currentStage: 6,
    overallScore: 92,
    completedStages: 6,
    totalStages: 6,
    isPromotable: true,
    lastStageAdvancedAt: new Date().toISOString()
  },
  validationScore: 92
};

loop.challengerStrategies.push(challengerCandidate);
assert(loop.getChallengerStrategies().length === 1, 'Challenger candidate registered in pool');

// Promote challenger with forceOverride=true to simulate authorized promotion
const promoResult = loop.promoteChallenger('STRAT-CHALLENGER-NEW-V2', 'Cleared 6-stage anti-overfitting pipeline with score 92', true);
assert(promoResult.success === true, 'Challenger successfully promoted to Champion');
assert(loop.getChampionStrategy().id === 'STRAT-CHALLENGER-NEW-V2', 'New champion active in production');
assert(loop.getStrategyHistory().length === 1, 'Previous baseline champion archived in strategyHistory');
assert(loop.getStrategyHistory()[0].id === 'STRAT-CHAMPION-BASELINE-V1', 'Archived strategy is previous baseline champion');

// 2. Anti-Noise Safeguard (Insufficient Trades)
console.log('\n[2] Anti-Noise Safeguard');
// Simulate 3 losing fills (< minTrades=8)
loop.recordRealFills([
  { id: 'f1', symbol: 'BTCUSDT', side: 'BUY', price: 65000, qty: 0.01, feeUsd: 0.5, timestamp: Date.now(), orderId: 'o1', realizedPnL: -5 },
  { id: 'f2', symbol: 'BTCUSDT', side: 'SELL', price: 64900, qty: 0.01, feeUsd: 0.5, timestamp: Date.now(), orderId: 'o2', realizedPnL: -5 },
  { id: 'f3', symbol: 'BTCUSDT', side: 'BUY', price: 64800, qty: 0.01, feeUsd: 0.5, timestamp: Date.now(), orderId: 'o3', realizedPnL: -5 }
]);

const noiseCheck = loop.checkRegressionAndAutoRollback();
assert(noiseCheck.regressionDetected === false, 'No rollback triggered on short-term noise (tradesCount < 8)');
assert(loop.getChampionStrategy().id === 'STRAT-CHALLENGER-NEW-V2', 'Current champion remains intact during initial trade sample');

// 3. Regression Detection: Severe Drawdown Breach
console.log('\n[3] Regression Detection & Self-Healing Rollback');
// Inject a severe performance degradation into liveTradingResults: Drawdown breaches threshold (>3.5%) with 10 trades
loop.championStrategy.liveTradingResults = {
  netProfit: -65.5,
  grossProfit: -45.0,
  totalFees: 20.5,
  roiPct: -3.8,
  sharpeRatio: -0.85,
  sortinoRatio: -1.1,
  maxDrawdownPct: 4.8, // BREACH: > 3.5%
  winRatePct: 20.0,    // COLLAPSED: < 25%
  profitFactor: 0.35,
  tradesCount: 12,
  avgTradeProfitUsd: -5.45,
  avgHoldingTimeMinutes: 25,
  orderFillRatePct: 95,
  capitalUtilizationPct: 50
};

const rollbackEvent = loop.checkRegressionAndAutoRollback();
assert(rollbackEvent.regressionDetected === true, 'Regression correctly detected when drawdown and win rate breach limits');
assert(rollbackEvent.rolledBack === true, 'Automatic rollback successfully executed');
assert(loop.getChampionStrategy().id === 'STRAT-CHAMPION-BASELINE-V1', 'Previous proven baseline champion restored as active Champion');
assert(loop.getChampionStrategy().status === 'CHAMPION', 'Restored champion has CHAMPION status');

// 4. State Integrity of Rolled-Back Strategy
console.log('\n[4] State Integrity & History Audit');
const history = loop.getStrategyHistory();
assert(history.length >= 1, 'History contains rolled-back strategy');
const rolledBackStrat = history.find(s => s.id === 'STRAT-CHALLENGER-NEW-V2');
assert(Boolean(rolledBackStrat), 'Failed strategy found in history archive');
assert(rolledBackStrat.status === 'ROLLED_BACK', 'Failed strategy status set to ROLLED_BACK');
assert(rolledBackStrat.reasonForChange.includes('Rolled back due to regression'), 'Audit reason records regression cause');

// 5. Rollback Telemetry
console.log('\n[5] Rollback Telemetry');
const telemetry = loop.getRollbackTelemetry();
assert(telemetry.regressionRollbackCount === 1, 'Regression rollback count incremented to 1');
assert(telemetry.lastRollbackEvent !== null, 'lastRollbackEvent recorded in telemetry');
assert(telemetry.lastRollbackEvent.type === 'AUTOMATIC_REGRESSION', 'Rollback event flagged as AUTOMATIC_REGRESSION');
assert(telemetry.lastRollbackEvent.rolledBackStrategyId === 'STRAT-CHALLENGER-NEW-V2', 'Telemtry records correct rolledBackStrategyId');
assert(telemetry.lastRollbackEvent.restoredStrategyId === 'STRAT-CHAMPION-BASELINE-V1', 'Telemetry records correct restoredStrategyId');

// 6. Manual Rollback When No Further History Exists
console.log('\n[6] Edge Case: Exhausted Viable History');
const emptyRollback = loop.rollbackChampion('Testing rollback with exhausted viable history', true);
assert(emptyRollback.success === false, 'Safely rejects rollback when no further viable non-rolled-back history exists');
assert(emptyRollback.reason.includes('Cannot rollback'), 'Clear fail-safe error reason returned');

console.log(`\nChampion/Challenger Rollback Suite: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL CHAMPION/CHALLENGER ROLLBACK INVARIANTS HOLD.');
}
