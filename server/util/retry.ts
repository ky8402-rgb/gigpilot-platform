/**
 * Retry-with-backoff + bounded-timeout primitives for transient-failure paths.
 *
 * Why it exists
 * -------------
 * The exchange adapters, market data fetcher, and outbound webhooks all hit services that
 * occasionally return 429 / 5xx / network resets. The legacy pattern was to wrap each call
 * site in its own ad-hoc `for (let i = 0; i < 3; i++)` loop, often with no jitter, no
 * timeout, and no consistent classification of "is this error retryable?". This file is
 * the single source of truth: every caller asks `withRetry(...)` to handle the loop, the
 * jitter, the timeout, and the classification. The decision of WHICH errors are retryable
 * stays at the call site because the only thing that knows whether a 422 from Bybit is a
 * rate limit or a permanent rejection is the caller.
 */
import { log, rid } from "./requestId.js";

export interface RetryOptions {
  /** Total attempts including the first call. Must be >= 1. */
  maxAttempts?: number;
  /** Base delay between attempts, in milliseconds. Multiplied by 2^(attempt-1) and jittered. */
  baseDelayMs?: number;
  /** Hard cap on any single attempt's wall-clock time. */
  timeoutMs?: number;
  /** Predicates consulted on every error. Default: retry anything whose message hints at a 5xx/429. */
  isRetryable?: (err: unknown) => boolean;
  /** Hook fired when a retry happens. Useful for tests and metrics. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Stable name for log correlation. e.g. "bybit.placeOrder". */
  op?: string;
}

const TRANSIENT_PATTERNS = [
  /\b(429|5\d\d|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|aborted\()/i,
  /\bfetch failed\b/i,
  /\btimeout\b/i
];

/**
 * Default retryable classifier: retry anything that looks like a transient network /
 * HTTP failure, and skip anything that looks like a permanent validation failure (4xx
 * other than 408/425/429, JSON parse errors, signature mismatches). The caller can
 * override for cases where only a subset of these patterns should be retried.
 */
export function defaultIsRetryable(err: unknown): boolean {
  if (!err) return false;
  // An explicit status field wins over message inspection.
  const status =
    (err as { status?: number; statusCode?: number; response?: { status?: number } }).status ??
    (err as { statusCode?: number }).statusCode ??
    (err as { response?: { status?: number } }).response?.status;
  if (typeof status === "number") {
    if (status === 408 || status === 425 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;
  }
  const message = String((err as { message?: string })?.message || err);
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/**
 * Race a promise against a timeout. On expiry, reject with an `AbortError`-shaped value
 * (own message so callers can `instanceof`-free distinguish from real network aborts).
 * The timeout always rejects — it does NOT resolve early. If the underlying operation
 * supports an AbortSignal, pass it as `signal` so the call is cancelled instead of
 * leaking.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  if (!(ms > 0)) return Promise.reject(new Error(`withTimeout(${label}): ms must be > 0, got ${ms}`));

  return new Promise<T>((resolve, reject) => {
    const ac = new AbortController();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ac.abort();
      reject(new TimeoutError(ms));
    }, ms);

    // Invoke through a microtask so a synchronous throw is handled exactly like a
    // rejected Promise. Both handlers remain attached after a timeout, preventing a
    // late completion from becoming an unhandled rejection; the settled guard makes
    // it a no-op after the authoritative TimeoutError has been delivered.
    Promise.resolve()
      .then(() => fn(ac.signal))
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff and bounded per-attempt timeout. The total
 * wall-clock time is bounded by `maxAttempts * timeoutMs + sum(baseDelayMs * 2^i)`. Caller
 * controls retryable classification via `isRetryable`. Re-throws the final error after
 * the last attempt so the upstream stack sees the original failure mode, not a wrapped
 * one.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal, attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 250,
    timeoutMs = 8000,
    isRetryable = defaultIsRetryable,
    onRetry,
    op = "withRetry"
  } = opts;
  if (!(maxAttempts >= 1)) {
    throw new Error(`withRetry(${op}): maxAttempts must be >= 1, got ${maxAttempts}`);
  }
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await withTimeout(
        (signal) => fn(signal, attempt),
        timeoutMs,
        `${op}.attempt${attempt}`
      );
    } catch (err) {
      lastErr = err;
      const retry = attempt < maxAttempts && isRetryable(err);
      if (!retry) {
        if (attempt > 1) {
          log.warn(rid(undefined), `${op} failed permanently`, { op, attempts: attempt, error: errorMessage(err) });
        }
        throw err;
      }
      // Decorrelated jitter: randomise between baseDelay and previous-sleep * 3, capped
      // at 8s so a flapping upstream cannot park us in an unbounded backoff.
      const expo = Math.min(8000, baseDelayMs * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * expo);
      const delayMs = Math.max(baseDelayMs, jitter);
      if (onRetry) onRetry({ attempt, delayMs, error: err });
      log.warn(rid(undefined), `${op} retrying`, { op, attempt: attempt + 1, delayMs, error: errorMessage(err) });
      await sleep(delayMs);
    }
  }
  // Unreachable: the loop either returns or throws. Defensive throw for type soundness.
  throw lastErr instanceof Error ? lastErr : new Error(errorMessage(lastErr));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}