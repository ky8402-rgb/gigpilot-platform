/**
 * Per-request correlation id, plus a tiny structured logger that emits it.
 *
 * Why it exists
 * -------------
 * When the deploy pipeline rolls back to a prior commit, or the on-call engineer is staring
 * at PM2 logs in the middle of the night, the question is always the same: "which call
 * triggered this failure, and what was the user doing?". The answer used to be "scroll up
 * and guess". Now every log line carries a stable id that ties the HTTP request to every
 * subsystem it touched — engine probe, exchange call, persistence write — and the same id
 * is echoed back to the client in `X-Request-Id` so a bug report can be cross-referenced
 * with a single grep.
 *
 * The implementation is intentionally trivial: a random 96-bit hex token, with a small
 * preference for the inbound header so upstream proxies / GitHub Actions can keep a single
 * id across a multi-hop call. No external clock, no monotonic counter, no UUID v4 library
 * — `crypto.randomUUID()` is built into Node 20 and good enough.
 */
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export const REQUEST_ID_HEADER = "X-Request-Id";

export function generateRequestId(): string {
  // Node 22 exposes globalThis.crypto.randomUUID() (RFC 4122 v4). Strip the dashes so the
  // id is unambiguous in shell copy-paste and PM2 log scans.
  return crypto.randomUUID().replace(/-/g, "");
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Honour an inbound id when it is present and looks sane. Bound the cap so a hostile
  // header cannot push arbitrarily long strings into every log line.
  const inbound = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const id =
    typeof candidate === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(candidate)
      ? candidate
      : generateRequestId();
  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

/**
 * Minimal structured logger. Emits one JSON object per line so production log shippers
 * (CloudWatch, Loki, Datadog, etc.) can parse without regex. Includes the active request
 * id when the caller is inside a request scope; otherwise emits a synthetic `system` id
 * so worker heartbeats and shutdown logs do not lose their breadcrumb.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (() => {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LEVEL_RANK[raw] !== undefined ? raw : "info";
})();

function emit(level: LogLevel, requestId: string | undefined, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    requestId: requestId ?? "system"
  };
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      payload[k] = v;
    }
  }
  // The single-line JSON keeps `console.*` semantics intact: stdout for happy-path info,
  // stderr for warn/error so log shippers can route severity.
  const line = JSON.stringify(payload);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (requestId: string | undefined, msg: string, fields?: Record<string, unknown>) => emit("debug", requestId, msg, fields),
  info: (requestId: string | undefined, msg: string, fields?: Record<string, unknown>) => emit("info", requestId, msg, fields),
  warn: (requestId: string | undefined, msg: string, fields?: Record<string, unknown>) => emit("warn", requestId, msg, fields),
  error: (requestId: string | undefined, msg: string, fields?: Record<string, unknown>) => emit("error", requestId, msg, fields)
};

/**
 * Resolve the current request id from any function that has access to `req`. Returns the
 * synthetic "system" id when called outside a request scope (worker heartbeat, shutdown
 * flush, scheduled cron, etc.).
 */
export function rid(req: { requestId?: string } | null | undefined): string {
  return req?.requestId ?? "system";
}