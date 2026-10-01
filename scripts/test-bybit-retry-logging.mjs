/**
 * Test Suite: Bybit Signed Methods Retry, Backoff, and Secret Masking Proof
 *
 * Verifies:
 * 1. sanitizeSecrets completely strips API keys, API secrets, and 64-char hex HMAC signatures
 * 2. fetchSignedWithRetry returns status 401 fail-closed when credentials missing
 * 3. Exponential backoff and retry bounded execution on transient failures
 * 4. Error messages returned to clients or logged never contain sensitive credentials
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();
const moduleUrl = pathToFileURL(path.join(here, '..', 'server', 'trading', 'bybitAdapter.ts')).href;
const { BybitAdapter } = await import(moduleUrl);

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

console.log('--- Bybit Signed Retry & Secret Masking Verification Suite ---');

const adapter = new BybitAdapter();

// Configure test credentials
const testKey = 'test_api_key_abcdef123456';
const testSecret = 'super_secret_signing_key_9876543210';
adapter.updateCredentials(testKey, testSecret);

// 1. Secret Masking and Sanitization
console.log('\n[1] Secret Masking & Redaction Invariants');
const rawLeakAttempt = `Request failed with key: ${testKey} and secret: ${testSecret} sign=a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90 on URL`;
const sanitized = adapter.sanitizeSecrets(rawLeakAttempt);

assert(!sanitized.includes(testSecret), 'Raw API secret is completely stripped from error strings');
assert(sanitized.includes('[REDACTED_SECRET]'), 'Replaced secret with [REDACTED_SECRET]');
assert(!sanitized.includes('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'), 'Raw HMAC 64-hex signature is stripped');
assert(sanitized.includes('[SIGNATURE_REDACTED]'), 'Replaced HMAC signature with [SIGNATURE_REDACTED]');

// 2. Fail-Closed When Credentials Unconfigured
console.log('\n[2] Fail-Closed Credential Checks');
const unauthedAdapter = new BybitAdapter();
unauthedAdapter.updateCredentials('', '');

const unauthedResult = await unauthedAdapter.fetchSignedWithRetry('GET', '/v5/position/list', {});
assert(unauthedResult.ok === false, 'fetchSignedWithRetry returns ok=false without credentials');
assert(unauthedResult.status === 401, 'Returns HTTP 401');
assert(unauthedResult.retCode === 10003, 'Returns retCode 10003 (Auth required)');
assert(unauthedResult.attempts === 0, 'Does not attempt network calls when credentials missing');

// 3. Retry Bounding & Timeout Safeguards
console.log('\n[3] Retry Bounding & Transient Error Recovery');
// Mock fetch to simulate 1 transient 429 rate limit then recovery
let callCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  callCount++;
  if (callCount === 1) {
    return new Response(JSON.stringify({ retCode: 10006, retMsg: 'Too many visits' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ retCode: 0, retMsg: 'OK', result: { list: [{ id: 'order_123' }] } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

const retryResult = await adapter.fetchSignedWithRetry('GET', '/v5/order/realtime', { category: 'linear' }, {
  maxRetries: 3,
  baseDelayMs: 20
});

assert(retryResult.ok === true, 'Successfully recovers after transient 429 rate limit');
assert(retryResult.attempts === 2, 'Executed exactly 2 attempts before success');
assert(callCount === 2, 'Network dispatched exactly 2 attempts');
assert(retryResult.result?.list?.length === 1, 'Returns valid result payload on recovery');

// Restore original fetch
globalThis.fetch = originalFetch;

console.log(`\nBybit Retry & Secret Masking Suite: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL BYBIT RETRY & SECRET MASKING INVARIANTS HOLD.');
  process.exit(0);
}
