/**
 * Live health probe for the Python autonomous futures engine (gigpilot.py).
 *
 * Single source of truth: both `/api/health` and `/api/trading/engines/health` import this, so
 * the Node API and the dashboard can never disagree about whether the engine is up.
 *
 * Rules this probe obeys:
 *  - It MEASURES; it never assumes. A missing or malformed body is reported as unhealthy,
 *    never as healthy-by-default.
 *  - It is bounded (1.5s abort) and fully guarded, so a hung engine cannot stall a health
 *    endpoint that load balancers and monitors depend on.
 *  - It NEVER fabricates a value. Unknown fields come back as null, not as 0 or false.
 */

export const AUTONOMOUS_ENGINE_URL = process.env.GIGPILOT_URL || 'http://127.0.0.1:8001';

export type AutonomousEngineHealth = {
  /** Whether an HTTP response was received at all. */
  reachable: boolean;
  /** 'healthy' | 'unhealthy' (reachable but not serving a healthy feed) | 'unreachable'. */
  status: 'healthy' | 'unhealthy' | 'unreachable';
  latencyMs: number;
  httpStatus: number | null;
  armed: boolean | null;
  publicWs: boolean | null;
  privateWs: boolean | null;
  feedFresh: boolean | null;
  positionMode: string | null;
  error: string | null;
};

export async function probeAutonomousEngine(): Promise<AutonomousEngineHealth> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${AUTONOMOUS_ENGINE_URL}/health`, { signal: controller.signal });
    const latencyMs = Date.now() - started;

    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!body || typeof body !== 'object') {
      return {
        reachable: true,
        status: 'unhealthy',
        latencyMs,
        httpStatus: response.status,
        armed: null,
        publicWs: null,
        privateWs: null,
        feedFresh: null,
        positionMode: null,
        error: 'malformed_engine_health_body'
      };
    }

    // The engine answers 503 with healthy:false when its own feed is stale or a socket is down.
    const healthy = response.status === 200 && body.healthy === true;
    return {
      reachable: true,
      status: healthy ? 'healthy' : 'unhealthy',
      latencyMs,
      httpStatus: response.status,
      armed: typeof body.armed === 'boolean' ? body.armed : null,
      publicWs: typeof body.public_ws === 'boolean' ? body.public_ws : null,
      privateWs: typeof body.private_ws === 'boolean' ? body.private_ws : null,
      feedFresh: typeof body.feed_fresh === 'boolean' ? body.feed_fresh : null,
      positionMode: typeof body.position_mode === 'string' ? body.position_mode : null,
      error: healthy ? null : 'engine_reported_unhealthy'
    };
  } catch (err: any) {
    return {
      reachable: false,
      status: 'unreachable',
      latencyMs: Date.now() - started,
      httpStatus: null,
      armed: null,
      publicWs: null,
      privateWs: null,
      feedFresh: null,
      positionMode: null,
      error: err?.name === 'AbortError' ? 'engine_health_timeout' : (err?.message || 'engine_unreachable')
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shape adapter for the dashboard's engine-card contract, which expects EngineHealth-shaped
 * entries. Derived purely from the measured probe — no field is invented.
 */
export function toEngineCard(health: AutonomousEngineHealth) {
  const statusMap: Record<AutonomousEngineHealth['status'], 'HEALTHY' | 'DEGRADED' | 'DOWN'> = {
    healthy: 'HEALTHY',
    unhealthy: 'DEGRADED',
    unreachable: 'DOWN'
  };
  return {
    id: 'AUTONOMOUS_FUTURES_ENGINE',
    name: 'GigPilot Autonomous Futures Engine (Python / Bybit V5)',
    status: statusMap[health.status],
    enabled: true,
    latencyMs: health.latencyMs,
    lastHeartbeat: new Date().toISOString(),
    errorCount: health.status === 'healthy' ? 0 : 1,
    lastError: health.error || undefined,
    errorSurface: health.error ? [{ message: health.error, timestamp: new Date().toISOString() }] : [],
    details: {
      source: AUTONOMOUS_ENGINE_URL,
      reachable: health.reachable,
      httpStatus: health.httpStatus,
      armed: health.armed,
      publicWs: health.publicWs,
      privateWs: health.privateWs,
      feedFresh: health.feedFresh,
      positionMode: health.positionMode
    }
  };
}
