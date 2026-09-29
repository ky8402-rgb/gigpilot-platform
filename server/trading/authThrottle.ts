import type { NextFunction, Request, Response } from 'express';

/**
 * Failed-attempt throttle for the owner authentication routes.
 *
 * Design decisions that matter:
 *
 * 1. Only FAILED attempts are counted. The middleware inspects the response status once the
 *    handler has finished, so a successful login clears the bucket. A legitimate owner can sign in
 *    as often as they like; what gets limited is repeated guessing. Counting every request instead
 *    would let an attacker lock the real owner out of a live trading account by hammering the
 *    endpoint on their behalf — a self-inflicted denial of service.
 *
 * 2. The bucket key is the transport peer address (`req.ip`) and deliberately NOT
 *    `X-Forwarded-For`. Node binds to loopback behind nginx, so the peer address cannot be forged;
 *    a client-supplied header can be. Trusting the header would let an attacker bypass the limit by
 *    rotating it. The trade-off is that all clients share one bucket, which for this single-owner
 *    deployment is the stricter and therefore correct behaviour.
 *
 * 3. State is in-process. GigPilot runs as one PM2 process (`ecosystem.config.cjs`), and this layer
 *    is defence in depth on top of TOTP rather than the only barrier, so a distributed store would
 *    add operational surface without adding real protection.
 *
 * 4. It is fail-safe and operator-overridable: `AUTH_THROTTLE_DISABLED=true` turns it off entirely
 *    (documented recovery path if the owner ever locks themselves out), and the defaults are a
 *    bounded 10 failures per 15 minutes.
 */

export class FailureWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly maxAttempts: number, private readonly windowMs: number) {
    if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
      throw new Error('FailureWindow: maxAttempts must be a number >= 1');
    }
    if (!Number.isFinite(windowMs) || windowMs < 1) {
      throw new Error('FailureWindow: windowMs must be a number >= 1');
    }
  }

  /** Failures for `key` that are still inside the rolling window; prunes expired entries. */
  private recent(key: string, now: number): number[] {
    const kept = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (kept.length > 0) {
      this.hits.set(key, kept);
    } else {
      this.hits.delete(key);
    }
    return kept;
  }

  /** Milliseconds until `key` may try again; 0 when it is not currently blocked. */
  public blockageRemainingMs(key: string, now: number = Date.now()): number {
    const recent = this.recent(key, now);
    if (recent.length < this.maxAttempts) return 0;
    const oldest = Math.min(...recent);
    const remaining = this.windowMs - (now - oldest);
    return remaining > 0 ? remaining : 0;
  }

  public isBlocked(key: string, now: number = Date.now()): boolean {
    return this.blockageRemainingMs(key, now) > 0;
  }

  public recordFailure(key: string, now: number = Date.now()): void {
    const recent = this.recent(key, now);
    recent.push(now);
    this.hits.set(key, recent);
  }

  /** Forget a key entirely, e.g. after a verified successful login. */
  public forget(key: string): void {
    this.hits.delete(key);
  }

  /** Number of keys with live failure history (diagnostics only). */
  public get trackedKeyCount(): number {
    return this.hits.size;
  }
}

function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const AUTH_THROTTLE_MAX_FAILURES = positiveIntFromEnv(process.env.AUTH_THROTTLE_MAX_FAILURES, 10);
export const AUTH_THROTTLE_WINDOW_MS = positiveIntFromEnv(process.env.AUTH_THROTTLE_WINDOW_MS, 15 * 60 * 1000);
export const AUTH_THROTTLE_DISABLED = process.env.AUTH_THROTTLE_DISABLED === 'true';

export const authFailureWindow = new FailureWindow(AUTH_THROTTLE_MAX_FAILURES, AUTH_THROTTLE_WINDOW_MS);

function clientKey(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function authThrottle(req: Request, res: Response, next: NextFunction): void {
  if (AUTH_THROTTLE_DISABLED) {
    next();
    return;
  }

  const key = clientKey(req);
  const remaining = authFailureWindow.blockageRemainingMs(key);
  if (remaining > 0) {
    const retryAfterSeconds = Math.ceil(remaining / 1000);
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      success: false,
      error: 'Too many failed authentication attempts. This source is temporarily locked out.',
      retryAfterSeconds,
    });
    return;
  }

  // A blocked request never reaches this point, so hammering a locked-out source cannot extend its
  // own lockout. Success clears the bucket; only 400/401 (rejected credentials/codes) count.
  res.on('finish', () => {
    if (res.statusCode === 400 || res.statusCode === 401) {
      authFailureWindow.recordFailure(key);
    } else if (res.statusCode >= 200 && res.statusCode < 300) {
      authFailureWindow.forget(key);
    }
  });

  next();
}
