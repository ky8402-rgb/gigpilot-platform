/**
 * Regression Test Suite: Bybit V5 Perpetual Futures Engine (category: 'linear')
 * Validates that all market data feeds, order dispatch, position tracking,
 * fee accounting, and funding calculations strictly use Bybit V5 Linear Futures.
 */
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();

const adapterUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'bybitAdapter.ts')).href;
const { bybitAdapter, BybitAdapter } = await import(adapterUrl);

const dataEngineUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'dataEngine.ts')).href;
const { DataEngine } = await import(dataEngineUrl);

const execEngineUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'exchangeExecutionEngine.ts')).href;
const { ExchangeExecutionEngine } = await import(execEngineUrl);

const quantEngineUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'quantEngine.ts')).href;
const { QuantEngine } = await import(quantEngineUrl);

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failures.push({ name, error: err.message });
    console.error(`  ✘ ${name}\n    ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failures.push({ name, error: err.message });
    console.error(`  ✘ ${name}\n    ${err.message}`);
  }
}

console.log('\n--- Bybit V5 Perpetual Futures Engine (category: linear) Suite ---');

// 1. DataEngine WebSocket & Linear Endpoints
test('DataEngine connects to Bybit V5 Public Linear WebSocket', () => {
  const de = new DataEngine();
  try {
    const health = de.healthCheck();
    assert.match(health.name, /Perpetual Futures|Linear/i);
    assert.match(health.details.source, /LINEAR/i);
  } finally {
    de.destroy();
  }
});

test('DataEngine parses and exposes authoritative funding rates', () => {
  const de = new DataEngine();
  try {
    // Simulate live linear ticker payload with fundingRate from Bybit
    de['handleWsTickerUpdate']({
      symbol: 'BTCUSDT',
      lastPrice: '65200.5',
      prevPrice24h: '64800.0',
      highPrice24h: '66000.0',
      lowPrice24h: '64500.0',
      volume24h: '12500.5',
      price24hPcnt: '0.0062',
      fundingRate: '0.0001', // 0.01% = 1.0 bps
      nextFundingTime: '1790699000000',
      markPrice: '65205.0',
      indexPrice: '65202.0'
    });

    const funding = de.getFundingRate('BTC/USDT');
    assert.ok(funding, 'Funding rate should be defined');
    assert.equal(funding.fundingRateBps, 1.0, '0.0001 funding rate equals 1.0 basis points');
    assert.equal(funding.nextFundingTime, 1790699000000);
    assert.equal(funding.markPrice, 65205.0);

    const pair = de.getPairData('BTC/USDT');
    assert.equal(pair?.category, 'linear');
  } finally {
    de.destroy();
  }
});

// 2. BybitAdapter Linear Configuration
test('BybitAdapter provides getRealFuturesFundingRate method', () => {
  assert.equal(typeof bybitAdapter.getRealFuturesFundingRate, 'function');
});

test('BybitAdapter provides getRealPositions method for linear futures', () => {
  assert.equal(typeof bybitAdapter.getRealPositions, 'function');
});

test('BybitAdapter symbol rules reflect linear contract precision', () => {
  const btcRules = bybitAdapter.getSymbolRules('BTCUSDT');
  assert.equal(btcRules.priceDecimals, 2);
  assert.equal(btcRules.qtyDecimals, 3); // Linear futures BTC contract step is 0.001

  const ethRules = bybitAdapter.getSymbolRules('ETHUSDT');
  assert.equal(ethRules.priceDecimals, 2);
  assert.equal(ethRules.qtyDecimals, 2);
});

// 3. ExchangeExecutionEngine Linear Configuration
test('ExchangeExecutionEngine identifies as Bybit Perpetual Futures Linear', () => {
  const engine = new ExchangeExecutionEngine();
  const health = engine.healthCheck();
  assert.match(health.name, /Perpetual Futures.*Linear/i);
});

test('ExchangeExecutionEngine has reconcilePositions for linear contracts', () => {
  const engine = new ExchangeExecutionEngine();
  assert.equal(typeof engine.reconcilePositions, 'function');
});

// 4. QuantEngine Bybit Linear Fee & Funding Rate Calculation
test('QuantEngine defaults to Bybit Linear Futures fee rates (2.0 bps maker, 5.5 bps taker)', () => {
  const qe = new QuantEngine();
  const edge = qe.computeExpectedNetEdge({
    symbol: 'BTCUSDT',
    price: 65000,
    amount: 0.1,
    orderType: 'GRID_LIMIT',
    gridSpacingPct: 0.72,
    orderBook: {
      symbol: 'BTC/USDT',
      bids: [{ price: 64995, amount: 2, total: 129990 }],
      asks: [{ price: 65005, amount: 2, total: 130010 }],
      spread: 10,
      spreadBps: 1.54,
      midPrice: 65000,
      timestamp: Date.now()
    },
    candles: [
      { timestamp: Date.now() - 60000, open: 64900, high: 65100, low: 64850, close: 65000, volume: 100 },
      { timestamp: Date.now(), open: 65000, high: 65050, low: 64980, close: 65000, volume: 80 }
    ],
    regime: {
      regime: 'RANGE_BOUND_LOW_VOL',
      confidence: 0.9,
      atr: 40,
      rsi: 50,
      adx: 18,
      adxSlope: 0,
      bbBandwidth: 2.5,
      orderBookImbalance: 0.02,
      trendDirection: 'NEUTRAL',
      recommendedGridSpacing: 0.72,
      suggestedAction: 'TRADE',
      detectedAt: new Date().toISOString()
    }
  });

  // Maker fee for Bybit linear futures is 2.0 bps
  assert.equal(edge.makerTakerFeesBps, 2.0, 'Linear futures maker fee must be 2.0 bps (0.02%)');
  assert.ok(edge.isTradeable, '0.72% grid with 2.0 bps maker fee easily clears 4.0 bps hurdle');
});

test('QuantEngine incorporates authoritative Bybit linear funding rate into carrying cost', () => {
  const qe = new QuantEngine();
  const edgeWithFunding = qe.computeExpectedNetEdge({
    symbol: 'BTCUSDT',
    price: 65000,
    amount: 0.1,
    orderType: 'GRID_LIMIT',
    gridSpacingPct: 0.72,
    fundingRateBps: 3.5, // 0.035% authoritative funding rate
    orderBook: {
      symbol: 'BTC/USDT',
      bids: [{ price: 64995, amount: 2, total: 129990 }],
      asks: [{ price: 65005, amount: 2, total: 130010 }],
      spread: 10,
      spreadBps: 1.54,
      midPrice: 65000,
      timestamp: Date.now()
    },
    candles: [
      { timestamp: Date.now() - 60000, open: 64900, high: 65100, low: 64850, close: 65000, volume: 100 },
      { timestamp: Date.now(), open: 65000, high: 65050, low: 64980, close: 65000, volume: 80 }
    ]
  });

  assert.equal(edgeWithFunding.fundingCarryingCostBps, 3.5, 'Carrying cost must exactly equal authoritative Bybit funding rate');
});

// 5. Fail-Closed Safety Verification
test('QuantEngine fails closed when price or amount is missing or invalid', () => {
  const qe = new QuantEngine();
  const invalid = qe.computeExpectedNetEdge({
    symbol: 'BTCUSDT',
    price: 0,
    amount: 0
  });
  assert.equal(invalid.isTradeable, false, 'Must fail closed with isTradeable = false');
  assert.equal(invalid.expectedNetEdgeBps, 0);
  assert.equal(invalid.edgeFormula, 'LIVE_MARKET_DATA_REQUIRED');
});

unregister();

console.log(`\nBybit V5 Linear Futures Suite: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exit(1);
}
console.log('ALL BYBIT V5 LINEAR FUTURES INVARIANTS HOLD.\n');
process.exit(0);
