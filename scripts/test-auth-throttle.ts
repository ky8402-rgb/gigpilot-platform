/**
 * Regression tests for the owner-authentication failed-attempt throttle.
 *
 * What this protects: the throttle exists to stop online password guessing. The property that
 * actually matters is that it counts *failures*, not requests — an implementation that counted
 * every request would let an attacker lock the real owner out of a live account. These tests pin
 * that behaviour, plus the window expiry and the operator override.
 */

import { EventEmitter } from 'node:events';
import {
  AUTH_THROTTLE_DISABLED,
  AUTH_THROTTLE_MAX_FAILURES,
  AUTH_THROTTLE_WINDOW_MS,
  authThrottle,
  FailureWindow,
} from '../server/trading/authThrottle.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  \u2713 PASS: ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${label}`);
    failed++;
  }
}

/** Minimal Express-like response double; emits `finish` when send() is called, like the real one. */
class FakeResponse extends EventEmitter {
  public statusCode = 200;
  public headers: Record<string, string> = {};
  public body: any = null;

  setHeader(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(payload: any): this {
    this.body = payload;
    this.emit('finish');
    return this;
  }
}

function driveThrottle(ip: string, finalStatus: number): { blocked: boolean; res: FakeResponse } {
  const req: any = { ip, socket: { remoteAddress: ip } };
  const res = new FakeResponse();
  let nextCalled = false;
  authThrottle(req, res as any, (() => { nextCalled = true; }) as any);
  if (nextCalled) {
    // Handler ran: emulate the route finishing with the given status.
    res.statusCode = finalStatus;
    res.emit('finish');
  }
  return { blocked: !nextCalled, res };
}

console.log('================================================================');
console.log('AUTH THROTTLE — FAILED-ATTEMPT LIMITER');
console.log('================================================================\n');

console.log('--- Defaults and operator override ---');
assert(AUTH_THROTTLE_MAX_FAILURES === 10, 'default max failed attempts is 10');
assert(AUTH_THROTTLE_WINDOW_MS === 15 * 60 * 1000, 'default window is 15 minutes');
assert(typeof AUTH_THROTTLE_DISABLED === 'boolean', 'disable flag is read as a boolean');

console.log('\n--- FailureWindow semantics (injected clock, fully deterministic) ---');
{
  const w = new FailureWindow(3, 1000);
  const t0 = 1_000_000;
  assert(!w.isBlocked('k', t0), 'a fresh key is not blocked');

  w.recordFailure('k', t0);
  w.recordFailure('k', t0 + 10);
  assert(!w.isBlocked('k', t0 + 20), 'two failures under a limit of three does not block');

  w.recordFailure('k', t0 + 20);
  assert(w.isBlocked('k', t0 + 30), 'reaching the limit blocks the key');
  // Oldest failure is 30ms in the past, so 1000 - 30 = 970ms of blockage remains.
  assert(w.blockageRemainingMs('k', t0 + 30) === 970, 'blockage counts down from the oldest failure');
  assert(
    w.blockageRemainingMs('k', t0 + 500) === 500,
    'blockage shortens as the oldest failure ages out of the window',
  );

  assert(!w.isBlocked('k', t0 + 1001), 'blockage expires once the window has rolled past the oldest failure');

  w.recordFailure('k', t0 + 2000);
  w.recordFailure('k', t0 + 2001);
  w.forget('k');
  assert(!w.isBlocked('k', t0 + 2002), 'forget() clears accumulated failures');
  assert(w.trackedKeyCount === 0, 'a forgotten key leaves no tracked state behind');
}
{
  const w = new FailureWindow(2, 1000);
  const t0 = 5_000_000;
  w.recordFailure('a', t0);
  w.recordFailure('a', t0 + 1);
  w.recordFailure('b', t0);
  assert(w.isBlocked('a', t0 + 2), 'a blocked key stays blocked');
  assert(!w.isBlocked('b', t0 + 2), 'a different key is unaffected (buckets are per-key)');
}
{
  let threw = false;
  try {
    new FailureWindow(0, 1000);
  } catch {
    threw = true;
  }
  assert(threw, 'a non-positive maxAttempts is rejected rather than silently disabling the limiter');
  threw = false;
  try {
    new FailureWindow(3, Number.NaN);
  } catch {
    threw = true;
  }
  assert(threw, 'a non-finite window is rejected rather than silently disabling the limiter');
}

console.log('\n--- Middleware integration (failure-only counting) ---');
{
  const ip = '203.0.113.7';
  let blockedEarly = false;
  for (let i = 0; i < 9; i++) {
    const r = driveThrottle(ip, 401);
    if (r.blocked) blockedEarly = true;
  }
  assert(!blockedEarly, 'nine failed logins do not reach the limit of ten');

  const tenth = driveThrottle(ip, 401);
  assert(!tenth.blocked, 'the tenth failed login is still evaluated by the handler');

  const eleventh = driveThrottle(ip, 401);
  assert(eleventh.blocked, 'the next attempt is refused before reaching the handler');
  assert(eleventh.res.statusCode === 429, 'the refusal is HTTP 429');
  assert(eleventh.res.headers['retry-after'] !== undefined, 'the refusal advertises Retry-After');
  assert(eleventh.res.body?.success === false, 'the refusal returns a JSON error body');
}
{
  const ip = '203.0.113.8';
  for (let i = 0; i < 5; i++) driveThrottle(ip, 401);
  driveThrottle(ip, 200);
  for (let i = 0; i < 5; i++) driveThrottle(ip, 401);
  const r = driveThrottle(ip, 401);
  assert(!r.blocked, 'a successful login clears the bucket (ten failures split by a success do not lock the owner out)');
}
{
  const r = driveThrottle('203.0.113.9', 200);
  assert(!r.blocked, 'successful requests are never limited');
}

console.log('\n================================================================');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) {
  process.exitCode = 1;
}
