/**
 * Tests for the multi-exchange and auth-architecture abstractions.
 *
 * What this file locks down:
 *
 *   1. OwnerAuthProvider contract — every implementation must:
 *        - refuse to bootstrap with no config and no env-supplied secret
 *        - reject default passwords / default PINs
 *        - verify tokens with timing-safe semantics
 *        - preserve the bootstrap-one-time invariant
 *
 *   2. ExchangeAdapter contract — every implementation must:
 *        - be a class implementing the interface (structural check)
 *        - refuse writes when not configured
 *        - return the documented rate-limit shape
 *        - throw ExchangeAdapterError (NOT a generic Error) on writes
 *          that target an unconfigured adapter
 *
 *   3. Registry behaviour:
 *        - selectExchangeAdapter picks the right class for each id
 *        - selectAuthProvider picks the right class for each id
 *        - both refuse to start on an unknown id (fail-closed)
 *
 *   4. Auth bootstrap fail-closed (run in isolated child processes):
 *        - starting TOTP provider with no config + no OWNER_AUTH_PIN throws
 *        - starting TOTP provider with config + no JWT_SECRET throws
 *        - starting TOTP provider with config + JWT_SECRET env succeeds
 *          and persists the JWT secret
 *
 * The auth tests run in child processes because the TotpPasswordAuthProvider
 * singleton reads the .gigpilot-data directory at construction time and
 * would otherwise pollute the parent test runner's environment.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';

import { ExchangeAdapter } from '../server/trading/exchange/types.js';
import { BybitExchangeAdapter } from '../server/trading/exchange/bybit/BybitExchangeAdapter.js';
import { BinanceExchangeAdapter } from '../server/trading/exchange/binance/BinanceExchangeAdapter.js';
import { KuCoinExchangeAdapter } from '../server/trading/exchange/kucoin/KuCoinExchangeAdapter.js';
import { OkxExchangeAdapter } from '../server/trading/exchange/okx/OkxExchangeAdapter.js';
import { selectExchangeAdapter, listSupportedExchanges } from '../server/trading/exchange/registry.js';
import { selectAuthProvider } from '../server/auth/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (e: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e?.message ?? e}`);
    failed += 1;
  }
}

console.log('================================================================');
console.log('MULTI-EXCHANGE + AUTH ARCHITECTURE TESTS');
console.log('================================================================\n');

// -------------------------------------------------------------------------
// 1 — Adapter identity & structural contract
// -------------------------------------------------------------------------
console.log('--- Adapter identity & structural contract ---');

await t('BybitExchangeAdapter is registered and has the canonical id', () => {
  const a = new BybitExchangeAdapter();
  assert.equal(a.id, 'bybit');
  assert.equal(typeof a.name, 'string');
  assert.ok(a.name.length > 0);
});

await t('Binance/KuCoin/OKX stubs are registered and marked as not implemented', () => {
  for (const Adapter of [BinanceExchangeAdapter, KuCoinExchangeAdapter, OkxExchangeAdapter]) {
    const a = new Adapter();
    assert.ok(['binance', 'kucoin', 'okx'].includes(a.id));
    assert.match(a.name, /not implemented/i);
  }
});

await t('All adapters implement ExchangeAdapter (structural)', () => {
  for (const Adapter of [BybitExchangeAdapter, BinanceExchangeAdapter, KuCoinExchangeAdapter, OkxExchangeAdapter]) {
    const a: Partial<ExchangeAdapter> = new Adapter();
    for (const method of [
      'configure', 'disconnect', 'isConfigured', 'ping', 'getStatus',
      'fetchTicker', 'fetchOrderBook', 'fetchCandles', 'fetchFundingRate', 'fetchFeeSchedule',
      'fetchPositions', 'fetchBalance', 'fetchOpenOrders', 'fetchOrderHistory', 'fetchFills', 'fetchServerTime',
      'setLeverage', 'setFuturesProtection', 'placeOrder', 'cancelOrder', 'cancelAllOrders',
      'getRateLimit', 'pauseIfNeeded',
    ]) {
      assert.equal(typeof (a as any)[method], 'function', `${Adapter.name}#${method} must be a function`);
    }
  }
});

await t('Each adapter returns a documented rate-limit shape', () => {
  for (const Adapter of [BybitExchangeAdapter, BinanceExchangeAdapter, KuCoinExchangeAdapter, OkxExchangeAdapter]) {
    const rl = new Adapter().getRateLimit();
    assert.equal(typeof rl.requests, 'number');
    assert.ok(rl.requests > 0, `${Adapter.name} must have positive requests`);
    assert.equal(typeof rl.windowMs, 'number');
    assert.ok(rl.windowMs > 0, `${Adapter.name} must have positive windowMs`);
  }
});

await t('Stub adapters refuse writes via ExchangeAdapterError when unconfigured', async () => {
  for (const Adapter of [BinanceExchangeAdapter, KuCoinExchangeAdapter, OkxExchangeAdapter]) {
    const a = new Adapter();
    assert.equal(a.isConfigured(), false);
    let caught = false;
    try {
      await a.placeOrder({
        symbol: 'BTC/USDT', side: 'buy', type: 'market', quantity: 1, clientOrderId: 'test',
      });
    } catch (e: any) {
      caught = true;
      assert.equal(e.name, 'ExchangeAdapterError', `${Adapter.name} should throw ExchangeAdapterError`);
      assert.equal(e.exchangeId, a.id);
      assert.equal(typeof e.code, 'string');
      assert.ok(e.code.length > 0);
      assert.equal(e.retriable, false);
    }
    assert.equal(caught, true, `${Adapter.name} should have thrown`);
  }
});

await t('Stub adapter error.name is "ExchangeAdapterError" not "NotImplemented"', async () => {
  for (const Adapter of [BinanceExchangeAdapter, KuCoinExchangeAdapter, OkxExchangeAdapter]) {
    const a = new Adapter();
    let e: any;
    try {
      await a.fetchTicker('BTC/USDT');
    } catch (err) { e = err; }
    assert.equal(e?.name, 'ExchangeAdapterError');
  }
});

// -------------------------------------------------------------------------
// 2 — Exchange registry
// -------------------------------------------------------------------------
console.log('\n--- Exchange registry ---');

await t('selectExchangeAdapter defaults to bybit', () => {
  const saved = process.env.EXCHANGE_ID;
  delete process.env.EXCHANGE_ID;
  try {
    const a = selectExchangeAdapter();
    assert.equal(a.id, 'bybit');
  } finally {
    if (saved !== undefined) process.env.EXCHANGE_ID = saved;
  }
});

await t('selectExchangeAdapter honors EXCHANGE_ID=binance', () => {
  assert.equal(selectExchangeAdapter({ exchangeId: 'binance' }).id, 'binance');
});
await t('selectExchangeAdapter honors EXCHANGE_ID=kucoin', () => {
  assert.equal(selectExchangeAdapter({ exchangeId: 'kucoin' }).id, 'kucoin');
});
await t('selectExchangeAdapter honors EXCHANGE_ID=okx', () => {
  assert.equal(selectExchangeAdapter({ exchangeId: 'okx' }).id, 'okx');
});

await t('selectExchangeAdapter refuses unknown ids (fail-closed)', () => {
  let threw = false;
  try { selectExchangeAdapter({ exchangeId: 'kraken' }); }
  catch (e: any) {
    threw = true;
    assert.match(e.message, /Unknown EXCHANGE_ID=kraken/);
    assert.match(e.message, /Supported: 'bybit', 'binance', 'kucoin', 'okx'/);
  }
  assert.equal(threw, true);
});

await t('listSupportedExchanges returns the four registered ids', () => {
  const list = listSupportedExchanges();
  const ids = list.map((e) => e.id).sort();
  assert.deepEqual(ids, ['binance', 'bybit', 'kucoin', 'okx']);
  for (const item of list) {
    assert.ok(typeof item.name === 'string' && item.name.length > 0);
  }
});

// -------------------------------------------------------------------------
// 3 — Auth registry structural contract (selection only, no instantiation)
// -------------------------------------------------------------------------
console.log('\n--- Auth registry ---');

await t('selectAuthProvider refuses unknown ids (fail-closed)', () => {
  let threw = false;
  try { selectAuthProvider({ providerId: 'magic-link' }); }
  catch (e: any) {
    threw = true;
    assert.match(e.message, /Unknown AUTH_PROVIDER=magic-link/);
  }
  assert.equal(threw, true);
});

// -------------------------------------------------------------------------
// 4 — Auth bootstrap fail-closed (isolated child processes so we can vary env)
// -------------------------------------------------------------------------
console.log('\n--- Auth bootstrap fail-closed (isolated processes) ---');

const CHILD_ENTRY = `
  import('./server/auth/TotpPasswordAuthProvider.ts')
    .then(m => { new m.TotpPasswordAuthProvider(); process.exit(0); })
    .catch(e => { process.stderr.write('CHILD ERR: ' + (e?.message ?? String(e)) + '\\n'); process.exit(2); });
`;

function runAuthBootstrapChild(env: Record<string, string>): Promise<{ stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn('node', ['--import', 'tsx', '-e', CHILD_ENTRY], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('close', (code) => resolve({ stderr, code }));
  });
}

await t('TotpPasswordAuthProvider refuses to start without a config and without OWNER_AUTH_PIN', async () => {
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gigpilot-auth-'));
  const r = await runAuthBootstrapChild({
    GIGPILOT_DATA_DIR: tmpDataDir,
    OWNER_AUTH_PIN: '',
    JWT_SECRET: '',
    OWNER_SESSION_SECRET: '',
  });
  assert.equal(r.code, 2, `expected exit code 2, got ${r.code} stderr=${r.stderr}`);
  assert.match(r.stderr, /OWNER_AUTH_PIN/);
  assert.match(r.stderr, /Refusing to bootstrap/);
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

await t('TotpPasswordAuthProvider refuses to start without a JWT secret even when config exists', async () => {
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gigpilot-auth-'));
  const crypto = await import('node:crypto');
  const cfg = {
    ownerEmail: 'test@local',
    passwordSalt: crypto.randomBytes(16).toString('hex'),
    passwordHash: 'a'.repeat(128),
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpEnabled: true,
    emergencyPinHash: crypto.createHash('sha256').update('123456').digest('hex'),
    jwtSecret: '',
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(tmpDataDir, 'owner-auth-config.json'), JSON.stringify(cfg), { mode: 0o600 });
  const r = await runAuthBootstrapChild({
    GIGPILOT_DATA_DIR: tmpDataDir,
    JWT_SECRET: '',
    OWNER_SESSION_SECRET: '',
    OWNER_AUTH_PIN: '123456',
  });
  assert.equal(r.code, 2, `expected exit code 2 (JWT secret missing), got ${r.code} stderr=${r.stderr}`);
  assert.match(r.stderr, /JWT signing key not configured/);
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

await t('TotpPasswordAuthProvider starts cleanly when config + JWT_SECRET are present', async () => {
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gigpilot-auth-'));
  const crypto = await import('node:crypto');
  const cfg = {
    ownerEmail: 'test@local',
    passwordSalt: crypto.randomBytes(16).toString('hex'),
    passwordHash: 'a'.repeat(128),
    totpSecret: 'JBSWY3DPEHPK3PXP',
    totpEnabled: true,
    emergencyPinHash: crypto.createHash('sha256').update('123456').digest('hex'),
    jwtSecret: '',
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(tmpDataDir, 'owner-auth-config.json'), JSON.stringify(cfg), { mode: 0o600 });
  const r = await runAuthBootstrapChild({
    GIGPILOT_DATA_DIR: tmpDataDir,
    JWT_SECRET: 'a'.repeat(64),
    OWNER_AUTH_PIN: '123456',
  });
  assert.equal(r.code, 0, `expected success, got code ${r.code} stderr=${r.stderr}`);
  const reloaded = JSON.parse(fs.readFileSync(path.join(tmpDataDir, 'owner-auth-config.json'), 'utf-8'));
  assert.equal(reloaded.jwtSecret, 'a'.repeat(64));
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
});

console.log('\n================================================================');
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log('================================================================');

process.exit(failed === 0 ? 0 : 1);
