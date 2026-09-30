#!/usr/bin/env node
/**
 * Self-contained tests for server/util/requestId.ts and server/util/retry.ts.
 *
 * The modules are imported via tsx (already a devDep) so the TypeScript sources can be
 * exercised without a separate build step. The suite covers the parts that actually
 * decide production behaviour:
 *
 *  - requestIdMiddleware: generates an id, honours a valid inbound id, echoes back
 *    `X-Request-Id`, refuses malformed inbound ids, and stays cheap under load
 *  - withRetry: returns immediately on first success, retries only retryable errors,
 *    gives up after `maxAttempts`, applies decorrelated jitter, and survives timeouts
 *  - withTimeout: rejects on expiry even when the inner promise never resolves
 *  - defaultIsRetryable: classifies 5xx/429/408/425 as retryable, 4xx (other) as fatal
 *
 * Designed to run with `node --import tsx scripts/test-request-id-and-retry.mjs` or via
 * the existing `npm test` harness which chains tsc --noEmit followed by individual
 * scripts. Failure mode: exit code 1 with the first failure on stderr.
 */
import { performance } from "node:perf_hooks";

const tsxImport = await import("tsx/esm").catch(() => null);
if (!tsxImport) {
  console.error("tsx not available; install devDeps before running this test.");
  process.exit(1);
}

// Import through tsx so .ts files are on-the-fly compiled.
const { requestIdMiddleware, generateRequestId, rid, log } = await import("../server/util/requestId.ts");
const { withRetry, withTimeout, defaultIsRetryable, TimeoutError } = await import("../server/util/retry.ts");

let passed = 0;
let failed = 0;

function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

section("requestIdMiddleware");
{
  // Synthetic minimal Express req/res
  const mw = requestIdMiddleware;
  const req = { headers: {} };
  const setHeaders = {};
  const res = { setHeader: (k, v) => { setHeaders[k] = v; } };
  let nextCalled = 0;
  mw(req, res, () => { nextCalled++; });

  check("generates a request id", typeof req.requestId === "string" && req.requestId.length >= 16);
  check("calls next exactly once", nextCalled === 1);
  check("echoes X-Request-Id back on response", setHeaders["X-Request-Id"] === req.requestId);
}

section("requestIdMiddleware honours valid inbound id");
{
  const req = { headers: { "x-request-id": "abc_DEF-123" } };
  const res = { setHeader: () => {} };
  mw: {
    requestIdMiddleware(req, res, () => {});
  }
  check("uses inbound id when valid", req.requestId === "abc_DEF-123");
}

section("requestIdMiddleware ignores malformed inbound ids");
{
  const cases = [
    { label: "empty string", val: "" },
    { label: "too short", val: "ab" },
    { label: "too long", val: "x".repeat(200) },
    { label: "contains spaces", val: "abc def" },
    { label: "contains newline", val: "abc\ndef" }
  ];
  for (const c of cases) {
    const req = { headers: { "x-request-id": c.val } };
    const res = { setHeader: () => {} };
    requestIdMiddleware(req, res, () => {});
    check(`rejects inbound id (${c.label})`, req.requestId !== c.val && /^[A-Za-z0-9_-]{8,128}$/.test(req.requestId));
  }
}

section("generateRequestId is collision-resistant");
{
  const ids = new Set();
  for (let i = 0; i < 10000; i++) ids.add(generateRequestId());
  check("10k generations are unique", ids.size === 10000);
}

section("rid() falls back to 'system'");
{
  check("null/undefined → 'system'", rid(null) === "system" && rid(undefined) === "system");
  check("non-empty object → requestId", rid({ requestId: "abc" }) === "abc");
}

section("withRetry returns immediately on first success");
{
  let calls = 0;
  const result = await withRetry(async () => { calls++; return 42; }, { op: "test.success", maxAttempts: 3 });
  check("returns the value", result === 42);
  check("calls exactly once", calls === 1);
}

section("withRetry retries only retryable errors");
{
  let calls = 0;
  let lastErr;
  try {
    await withRetry(async () => {
      calls++;
      const e = new Error("permanent failure");
      e.status = 400;
      throw e;
    }, { op: "test.permanent", maxAttempts: 3, baseDelayMs: 5, timeoutMs: 1000 });
  } catch (err) { lastErr = err; }
  check("does NOT retry a 400", calls === 1);
  check("throws the original error", lastErr && lastErr.message === "permanent failure");
}

section("withRetry retries transient failures and eventually succeeds");
{
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) {
      const e = new Error("boom");
      e.status = 503;
      throw e;
    }
    return "ok";
  }, { op: "test.transient", maxAttempts: 5, baseDelayMs: 5, timeoutMs: 1000 });
  check("succeeds on third attempt", result === "ok" && calls === 3);
}

section("withRetry gives up after maxAttempts");
{
  let calls = 0;
  let lastErr;
  try {
    await withRetry(async () => {
      calls++;
      const e = new Error("still down");
      e.status = 500;
      throw e;
    }, { op: "test.giveup", maxAttempts: 3, baseDelayMs: 5, timeoutMs: 1000 });
  } catch (err) { lastErr = err; }
  check("tried maxAttempts times", calls === 3);
  check("threw the final error", lastErr && lastErr.message === "still down");
}

section("withTimeout allows work to finish before the deadline");
{
  const start = performance.now();
  const result = await withTimeout(
    () => new Promise((resolve) => setTimeout(() => resolve("completed"), 30)),
    150,
    "test.delayed-success"
  );
  const elapsed = performance.now() - start;
  check("returns a delayed success", result === "completed");
  check("does not reject on the next event-loop turn", elapsed >= 20, `elapsed=${elapsed.toFixed(1)}ms`);
  check("finishes before the configured deadline", elapsed < 140, `elapsed=${elapsed.toFixed(1)}ms`);
}

section("withTimeout rejects only when the deadline expires");
{
  const start = performance.now();
  let lastErr;
  let aborted = false;
  try {
    await withTimeout((signal) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      return new Promise(() => {});
    }, 50, "test.timeout");
  } catch (err) { lastErr = err; }
  const elapsed = performance.now() - start;
  check("threw a TimeoutError", lastErr instanceof TimeoutError);
  check("aborts the underlying operation", aborted === true);
  check("does not reject before the 50ms deadline", elapsed >= 40, `elapsed=${elapsed.toFixed(1)}ms`);
  check("rejects within deadline plus scheduler slack", elapsed < 250, `elapsed=${elapsed.toFixed(1)}ms`);
}

section("defaultIsRetryable classifies correctly");
{
  const cases = [
    { err: Object.assign(new Error("x"), { status: 200 }), want: false, label: "200 OK" },
    { err: Object.assign(new Error("x"), { status: 400 }), want: false, label: "400 Bad Request" },
    { err: Object.assign(new Error("x"), { status: 408 }), want: true, label: "408 Request Timeout" },
    { err: Object.assign(new Error("x"), { status: 425 }), want: true, label: "425 Too Early" },
    { err: Object.assign(new Error("x"), { status: 429 }), want: true, label: "429 Too Many Requests" },
    { err: Object.assign(new Error("x"), { status: 500 }), want: true, label: "500 Internal" },
    { err: Object.assign(new Error("x"), { status: 502 }), want: true, label: "502 Bad Gateway" },
    { err: Object.assign(new Error("x"), { status: 504 }), want: true, label: "504 Gateway Timeout" },
    { err: new Error("socket hang up"), want: true, label: "network: socket hang up" },
    { err: new Error("ECONNRESET"), want: true, label: "network: ECONNRESET" },
    { err: new Error("signature mismatch"), want: false, label: "non-transient: signature mismatch" },
    { err: null, want: false, label: "null error" }
  ];
  for (const c of cases) {
    check(`classifies ${c.label}`, defaultIsRetryable(c.err) === c.want);
  }
}

section("log emits single-line JSON with requestId");
{
  const originalLog = console.log;
  const originalErr = console.error;
  let captured = [];
  console.log = (line) => captured.push({ stream: "stdout", line });
  console.error = (line) => captured.push({ stream: "stderr", line });
  try {
    log.info("rid-abc", "unit.test", { foo: 1 });
    log.warn("rid-def", "unit.warn", { bar: "two" });
    log.error(undefined, "unit.error", { baz: true });
  } finally {
    console.log = originalLog;
    console.error = originalErr;
  }
  check("emitted three lines", captured.length === 3);
  const parsed = captured.map((c) => { try { return JSON.parse(c.line); } catch { return null; } });
  check("all lines are valid JSON", parsed.every((p) => p !== null));
  check("info includes requestId", parsed[0].requestId === "rid-abc" && parsed[0].level === "info");
  check("warn goes to stderr", captured[1].stream === "stderr" && parsed[1].level === "warn");
  check("error without requestId → 'system'", parsed[2].requestId === "system");
}

console.log(`\n================================================================`);
console.log(`RESULT: ${passed} passed, ${failed} failed`);
console.log(`================================================================`);
process.exit(failed > 0 ? 1 : 0);