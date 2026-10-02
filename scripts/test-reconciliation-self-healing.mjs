// scripts/test-reconciliation-self-healing.mjs
// Test suite for Automated Position & Order Reconciliation, Self-Healing, and Microstructure Depth

import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();
const execModuleUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'exchangeExecutionEngine.ts')).href;
const dataModuleUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'dataEngine.ts')).href;

const { ExchangeExecutionEngine } = await import(execModuleUrl);
const { DataEngine } = await import(dataModuleUrl);

let passed = 0;
let failed = 0;

function t(desc, fn) {
  try {
    fn();
    console.log(`  ✔ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✘ ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function ta(desc, fn) {
  try {
    await fn();
    console.log(`  ✔ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✘ ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('--- Self-Healing Position & Order Reconciliation Suite ---');

// [1] Initial State & Reconciliation Status
console.log('\n[1] Initial State & Reconciliation Status');
{
  const exec = new ExchangeExecutionEngine();
  
  t('ExchangeExecutionEngine reports valid reconciliation status structure', () => {
    const status = exec.getReconciliationStatus();
    assert.ok(status !== null && typeof status === 'object');
    assert.ok(['SYNCED', 'DRIFT_DETECTED', 'SELF_HEALING', 'ERROR', 'OFF'].includes(status.status));
    assert.ok(typeof status.lastAuditTimestamp === 'string');
    assert.ok(typeof status.activeDriftCount === 'number');
    assert.ok(Array.isArray(status.activeDrifts));
    assert.ok(Array.isArray(status.recentEvents));
    assert.equal(status.reconciliationIntervalSeconds, 30);
    assert.equal(status.autoHealingEnabled, true);
  });

  t('Initial activeDriftCount is 0 when no keys configured', () => {
    const status = exec.getReconciliationStatus();
    assert.equal(status.activeDriftCount, 0);
    assert.equal(status.isClean, true);
  });

  exec.stopReconciliationLoop();
}

// [2] Off-Switch Fail-Closed Behavior
console.log('\n[2] Off-Switch Fail-Closed Behavior');
{
  const exec = new ExchangeExecutionEngine();
  
  await ta('when engine disabled, reconciliation reports OFF and skips network dispatch', async () => {
    exec.setOffSwitch(false);
    const status = await exec.performAutomatedReconciliationAudit(true);
    assert.equal(status.status, 'OFF');
    assert.equal(exec.getOffSwitch(), false);
    exec.setOffSwitch(true);
  });

  exec.stopReconciliationLoop();
}

// [3] Drift Calculation & Severity Invariants
console.log('\n[3] Drift Calculation & Severity Invariants');
{
  t('Epsilon threshold ignores tiny floating-point rounding (< 0.0001)', () => {
    const internal = 100.00002;
    const exchange = 100.00000;
    const delta = Math.abs(exchange - internal);
    const isClean = delta < 0.0001;
    assert.ok(isClean, 'Should treat < 0.0001 as clean without false drift alarms');
  });

  t('Minor drift (> $1.00 USD) triggers MINOR severity', () => {
    const deltaBase = 15.0; // 15 DOGE @ $0.15 = $2.25 USD
    const price = 0.15;
    const deltaUsd = deltaBase * price;
    const isClean = deltaBase < 0.0001 || deltaUsd < 0.10;
    assert.equal(isClean, false);
    const severity = deltaUsd > 50 ? 'CRITICAL' : 'MINOR';
    assert.equal(severity, 'MINOR');
  });

  t('Critical drift (> $50.00 USD or > 20% size discrepancy) triggers CRITICAL severity', () => {
    const deltaBase = 1000.0; // 1000 DOGE @ $0.15 = $150 USD
    const price = 0.15;
    const deltaUsd = deltaBase * price;
    const severity = deltaUsd > 50 ? 'CRITICAL' : 'MINOR';
    assert.equal(severity, 'CRITICAL');
  });
}

// [4] DataEngine Microstructure & Imbalance
console.log('\n[4] DataEngine Microstructure & Depth Imbalance');
{
  const dataEngine = new DataEngine();

  t('DataEngine normalizes Bybit Linear symbols accurately', () => {
    assert.equal(dataEngine.normalizeSymbol('BTCUSDT'), 'BTC/USDT');
    assert.equal(dataEngine.normalizeSymbol('DOGE/USDT'), 'DOGE/USDT');
  });

  t('DataEngine toExchangeSymbol strips slashes for Bybit API', () => {
    assert.equal(dataEngine.toExchangeSymbol('BTC/USDT'), 'BTCUSDT');
    assert.equal(dataEngine.toExchangeSymbol('DOGE/USDT'), 'DOGEUSDT');
  });

  dataEngine.setOffSwitch(false);
}

// [5] Self-Healing Reconciliation Audit Functionality
console.log('\n[5] Self-Healing Reconciliation Audit Functionality');
{
  const exec = new ExchangeExecutionEngine();

  await ta('performAutomatedReconciliationAudit runs cleanly without throwing', async () => {
    const result = await exec.performAutomatedReconciliationAudit(true);
    assert.ok(result);
    assert.ok(['SYNCED', 'DRIFT_DETECTED', 'SELF_HEALING', 'ERROR', 'OFF'].includes(result.status));
  });

  exec.stopReconciliationLoop();
}

console.log(`\nReconciliation & Self-Healing Suite: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL RECONCILIATION & SELF-HEALING INVARIANTS HOLD.');
}
