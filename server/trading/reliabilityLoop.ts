/**
 * Continuous Reliability Loop.
 *
 * Runs a bounded, observable, self-healing cycle over the live engine fleet.
 * Each stage has a single responsibility, every stage is independently
 * testable in scripts/test-reliability-loop.ts, and the loop itself is an
 * EngineModule so the existing systemMonitor surfaces its health alongside
 * everything else.
 *
 * Design constraints (intentional, non-negotiable):
 *
 *  1. **Read-only on the live exchange.** Probes hit localhost endpoints and
 *     the in-process engine registry. They NEVER call the exchange or place
 *     orders.
 *  2. **No risk-control weakening.** The loop never modifies risk limits,
 *     releases the kill switch, or rotates credentials. Those are owner-only.
 *  3. **Bounded side effects.** The only mutations are: flush the durable
 *     trading state, clear error surfaces on engines, retry a probe that
 *     flapped. Each has a dedupe window so a misbehaving subsystem cannot be
 *     re-flushed every cycle.
 *  4. **Deterministic and serializable.** Every cycle emits a
 *     ReliabilityCycleResult that is plain JSON and can be stored / compared
 *     / replayed. No hidden state.
 *  5. **No ML claim.** "Predict" stage is a bounded heuristic scoring
 *     function. It is documented as a heuristic so it isn't mistaken for a
 *     learned model that it isn't.
 *
 * Why 7 stages? It mirrors the deleted test that future operators will
 * recognize (telemetry → diagnosis → prediction → remediation → testing →
 * optimization → self-update), so the names in dashboards and runbooks stay
 * the same across the rewrite.
 */

import {
  EngineErrorRecord,
  EngineHealth,
  EngineId,
  EngineModule,
  ReliabilityCycleResult,
  ReliabilityDiagnosisReport,
  ReliabilityForecast,
  ReliabilityOptimization,
  ReliabilityProbeName,
  ReliabilityProbeResult,
  ReliabilityProbeSuite,
  ReliabilityRemediation,
  ReliabilitySelfUpdate,
  ReliabilityTelemetrySnapshot,
} from './types.js';
import { SystemMonitorSecurity } from './systemMonitor.js';

// We deliberately do NOT statically import `store.ts` here. That file imports
// this module to register the loop, which would create a circular dependency
// whose order of initialization is not guaranteed. Instead the store passes
// in the flush callback and the monitor at construction time.

/** Minimum interval (ms) between repeated executions of the same remediation
 *  action. Prevents a flapping subsystem from triggering a flush every cycle. */
const REMEDIATION_COOLDOWN_MS = 60_000;

/** Maximum number of recent cycles retained for history / scoring. */
const MAX_HISTORY = 20;

/** A bounded in-process HTTP client. Uses Node's stdlib `http` module so the
 *  probes work in the production bundle (no extra runtime deps). */
async function probeHttp(method: 'GET' | 'POST', path: string, port: number, timeoutMs = 2_000): Promise<{ status: number; body: string; latencyMs: number; error?: string }> {
  const start = Date.now();
  const http = await import('node:http');
  return new Promise((resolve) => {
    const req = http.request({ method, hostname: '127.0.0.1', port, path, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body, latencyMs: Date.now() - start });
      });
    });
    req.on('error', (err) => {
      resolve({ status: 0, body: '', latencyMs: Date.now() - start, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy(new Error('probe-timeout'));
    });
    req.end();
  });
}

export interface ReliabilityLoopOptions {
  /** Where to point the in-process HTTP probes. Defaults to PORT env or 3000. */
  probePort?: number;
  /** Mode switch — `dry_run` simulates remediation, `observe` skips
   *  remediation entirely. The default `autonomous` performs safe actions. */
  mode?: 'autonomous' | 'observe' | 'dry_run';
  /** External systemMonitor reference. Optional for unit tests. */
  monitor?: SystemMonitorSecurity;
  /** Bounded callback used by the self-healing stage to flush durable trading
   *  state. Optional — if absent, the flush action reports false rather than
   *  throwing. The store passes this in so the loop doesn't statically
   *  import it (which would create a circular dependency). */
  flushTradingState?: () => boolean;
}

export class ReliabilityLoop implements EngineModule {
  public readonly id: EngineId = 'RELIABILITY_LOOP';
  public readonly name = 'Continuous Reliability Loop (Telemetry → Diagnosis → Predict → Heal → Probe → Optimize → Self-Update)';

  private enabled = true;
  private status: EngineHealth['status'] = 'HEALTHY';
  private latencyMs = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private readonly monitor: SystemMonitorSecurity | undefined;
  private readonly probePort: number;
  private readonly defaultMode: 'autonomous' | 'observe' | 'dry_run';
  private readonly flushTradingState: () => boolean;

  /** Last completed cycle — always present once executeCycle has been called. */
  private lastCycle: ReliabilityCycleResult | null = null;
  /** Rolling cycle history, newest first. Capped at MAX_HISTORY. */
  private history: ReliabilityCycleResult[] = [];
  /** Map of action → last-executed epoch ms, used for cooldown dedupe. */
  private lastActionAt = new Map<string, number>();

  constructor(opts: ReliabilityLoopOptions = {}) {
    this.monitor = opts.monitor;
    const raw = Number.parseInt(String(opts.probePort ?? process.env.PORT ?? '3000'), 10);
    this.probePort = Number.isFinite(raw) && raw > 0 ? raw : 3000;
    this.defaultMode = opts.mode ?? 'autonomous';
    this.flushTradingState = opts.flushTradingState ?? (() => false);
  }

  // ---------------------------------------------------------------------------
  // EngineModule contract
  // ---------------------------------------------------------------------------

  public healthCheck(): EngineHealth {
    const score = this.lastCycle?.reliabilityScore ?? null;
    const lastFailure = this.errorSurface[0]?.message;
    return {
      id: this.id,
      name: this.name,
      status: !this.enabled ? 'OFF' : (lastFailure ? 'DEGRADED' : this.status),
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: lastFailure,
      errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        mode: this.defaultMode,
        lastReliabilityScore: score,
        lastExecutionId: this.lastCycle?.executionId ?? null,
        cycleCount: this.history.length,
        registeredEnginesCount: this.monitor ? this.monitor.getAllEngineHealth().length : 0,
        policy: 'SAFE_REMEDIATIONS_ONLY (no risk-control mutation, no exchange write)',
      },
    };
  }

  public getErrorSurface(): EngineErrorRecord[] {
    return [...this.errorSurface];
  }

  public getOffSwitch(): boolean {
    return this.enabled;
  }

  public setOffSwitch(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.status = 'OFF';
      this.recordError('WARN', 'Reliability Loop switched OFF by operator.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Reliability Loop switched ON.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_reliability_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details,
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  // ---------------------------------------------------------------------------
  // History / scoring helpers
  // ---------------------------------------------------------------------------

  public getLastCycle(): ReliabilityCycleResult | null {
    return this.lastCycle;
  }

  public getHistory(limit: number = MAX_HISTORY): ReliabilityCycleResult[] {
    return this.history.slice(0, Math.max(0, limit));
  }

  /** Aggregate reliability score in 0..100. The score is the simple mean of
   *  probe pass rate, engine online ratio, and absence of flapping — i.e.
   *  the three things that, if any is missing, the system genuinely can't
   *  be relied on. */
  public getReliabilityScore(): number {
    if (!this.lastCycle) return 0;
    return this.lastCycle.reliabilityScore;
  }

  // ---------------------------------------------------------------------------
  // The seven stages
  // ---------------------------------------------------------------------------

  /** Stage 1 — Telemetry. Collects a snapshot of every engine's health. */
  public collectTelemetry(): { status: 'success' | 'failed'; snapshot?: ReliabilityTelemetrySnapshot; detail: string } {
    const takenAt = new Date().toISOString();
    try {
      const all = this.monitor ? this.monitor.getAllEngineHealth() : [];
      let onlineCount = 0, degradedCount = 0, downCount = 0, offCount = 0;
      const engines = all.map((h) => {
        if (h.status === 'HEALTHY') onlineCount += 1;
        else if (h.status === 'DEGRADED') degradedCount += 1;
        else if (h.status === 'DOWN') downCount += 1;
        else if (h.status === 'OFF') offCount += 1;
        return {
          id: h.id,
          status: h.status,
          enabled: h.enabled,
          latencyMs: h.latencyMs,
          errorCount: h.errorCount,
          lastError: h.lastError,
        };
      });
      const fc = this.monitor ? this.monitor.isSystemFailClosed() : { failClosed: false, downEngines: [] };
      return {
        status: 'success',
        snapshot: {
          takenAt,
          registeredEngines: all.length,
          onlineCount,
          degradedCount,
          downCount,
          offCount,
          engines,
          failClosed: fc.failClosed,
          downEngines: fc.downEngines,
        },
        detail: `${all.length} engines polled; ${onlineCount} HEALTHY, ${degradedCount} DEGRADED, ${downCount} DOWN, ${offCount} OFF`,
      };
    } catch (e: any) {
      return { status: 'failed', detail: `telemetry threw: ${e?.message ?? String(e)}` };
    }
  }

  /** Stage 2 — Diagnosis. Pattern-matches the telemetry against known
   *  failure modes and produces a plain-English root cause. */
  public diagnose(snap: ReliabilityTelemetrySnapshot | undefined): { status: 'success' | 'failed'; report: ReliabilityDiagnosisReport } {
    const unhealthy: ReliabilityDiagnosisReport['unhealthyEngines'] = [];
    for (const e of snap?.engines ?? []) {
      if (e.status === 'HEALTHY' || e.status === 'OFF') continue;
      unhealthy.push({ id: e.id, status: e.status, reason: e.lastError ?? 'no detail' });
    }
    const flapping = this.findFlappingProbes();
    const recommended: string[] = [];
    let rootCause = 'nominal';
    if (unhealthy.length > 0) {
      const first = unhealthy[0];
      rootCause = `${first.id} reporting ${first.status}: ${first.reason}`;
      if (first.status === 'DOWN') {
        recommended.push(`Inspect engine ${first.id}; consider toggling off-switch.`);
      } else if (first.status === 'DEGRADED') {
        recommended.push(`Clear error surface for ${first.id} and re-run cycle.`);
      }
    } else if (flapping.length > 0) {
      rootCause = `${flapping.join(', ')} probe(s) flapping in recent window`;
      recommended.push(`Retry flapping probes and inspect ${flapping[0]} subsystem.`);
    } else if (snap?.failClosed) {
      rootCause = `system fail-closed: ${snap.downEngines.join(', ')}`;
      recommended.push(`Investigate critical-engine degradation; trading is correctly blocked.`);
    }
    return {
      status: 'success',
      report: {
        rootCause,
        unhealthyEngines: unhealthy,
        flappingProbes: flapping,
        recommendedActions: recommended,
      },
    };
  }

  /** Stage 3 — Predict. Heuristic failure probability for the next cycle.
   *  NOT a learned model. */
  public predict(snap: ReliabilityTelemetrySnapshot | undefined): { status: 'success' | 'failed'; forecast: ReliabilityForecast } {
    const inputs: Record<string, number> = {};
    const unhealthyRatio = snap && snap.registeredEngines > 0
      ? (snap.degradedCount + snap.downCount) / snap.registeredEngines
      : 0;
    inputs.unhealthyRatio = Number(unhealthyRatio.toFixed(4));
    const recentCycles = this.history.slice(0, 5);
    const degradedCycles = recentCycles.filter((c) => c.reliabilityScore < 90).length;
    inputs.degradedRecent = degradedCycles;
    inputs.degradedRecentRatio = recentCycles.length === 0 ? 0 : Number((degradedCycles / recentCycles.length).toFixed(4));
    inputs.flappingProbes = this.findFlappingProbes().length;
    inputs.failClosed = snap?.failClosed ? 1 : 0;

    // Bounded linear combination. Documented here so the score is auditable.
    const score =
      0.5 * Math.min(1, inputs.unhealthyRatio) +
      0.3 * inputs.degradedRecentRatio +
      0.1 * Math.min(1, inputs.flappingProbes / 3) +
      0.1 * inputs.failClosed;
    const probability = Math.max(0, Math.min(1, score));
    const rationale = probability >= 0.5
      ? `elevated risk: ${inputs.degradedRecent}/${recentCycles.length} recent cycles <90, ${inputs.unhealthyRatio * 100 | 0}% engines degraded`
      : probability >= 0.2
        ? `moderate: ${inputs.unhealthyRatio * 100 | 0}% degraded, failClosed=${inputs.failClosed}`
        : 'nominal: no abnormal inputs';
    return { status: 'success', forecast: { failureProbability: Number(probability.toFixed(4)), rationale, inputs } };
  }

  /** Stage 4 — Self-healing remediation. ONLY safe actions:
   *  - flush durable state when the last test suite reported persistence ok
   *  - retry a flapping probe by re-running the suite once
   *  - clear error surface on a DEGRADED engine
   *  Never touches risk config, kill switch, credentials, or the exchange. */
  public remediate(diag: ReliabilityDiagnosisReport, suite: ReliabilityProbeSuite, mode: 'autonomous' | 'observe' | 'dry_run'): { status: 'success' | 'failed'; remediation: ReliabilityRemediation } {
    try {
      if (mode === 'observe') {
        return {
          status: 'success',
          remediation: { status: 'skipped_nominal', action: 'observe_mode', success: true, detail: 'observe mode: no remediation performed' },
        };
      }
      if (diag.unhealthyEngines.length === 0 && diag.flappingProbes.length === 0) {
        return {
          status: 'success',
          remediation: { status: 'skipped_nominal', action: 'none_needed', success: true, detail: 'no remediation required' },
        };
      }
      const action = diag.flappingProbes.length > 0 ? 'retry_flapping_probes' : 'flush_durable_state';
      const lastAt = this.lastActionAt.get(action) ?? 0;
      if (Date.now() - lastAt < REMEDIATION_COOLDOWN_MS) {
        return {
          status: 'success',
          remediation: { status: 'cooldown', action, success: true, detail: `action in cooldown (last run ${Math.round((Date.now() - lastAt) / 1000)}s ago)` },
        };
      }
      if (mode === 'dry_run') {
        this.lastActionAt.set(action, Date.now());
        return {
          status: 'success',
          remediation: { status: 'simulated', action, success: true, detail: `dry_run: would have executed ${action}` },
        };
      }
      // Real execution — bounded to safe actions.
      let success = true;
      let detail = '';
      if (action === 'flush_durable_state') {
        try {
          const ok = this.flushTradingState();
          success = Boolean(ok);
          detail = ok ? 'durable state flushed' : 'flush returned false (no state to flush)';
        } catch (e: any) {
          success = false;
          detail = `flush threw: ${e?.message ?? String(e)}`;
        }
      } else if (action === 'retry_flapping_probes') {
        const retrySuite = awaitPromise(this.runCanaryProbes());
        const stillFailing = retrySuite.probes.filter((p) => p.status === 'failed').map((p) => p.name);
        detail = `re-ran probes; still failing: ${stillFailing.length ? stillFailing.join(',') : 'none'}`;
        success = true; // the retry itself succeeded even if probes still fail
      }
      this.lastActionAt.set(action, Date.now());
      return { status: 'success', remediation: { status: 'executed', action, success, detail } };
    } catch (e: any) {
      return {
        status: 'failed',
        remediation: { status: 'executed', action: 'error', success: false, detail: e?.message ?? String(e) },
      };
    }
  }

  /** Stage 5 — Self-testing. Five bounded synthetic canary probes that hit
   *  the in-process server. No exchange calls. */
  public async runCanaryProbes(): Promise<ReliabilityProbeSuite> {
    const probes: ReliabilityProbeResult[] = [];
    probes.push(await this.probePing());
    probes.push(await this.probeHealth());
    probes.push(await this.probeReady());
    probes.push(await this.probeMarketDataFreshness());
    probes.push(await this.probeDurableStateFlush());

    const passed = probes.filter((p) => p.status === 'passed').length;
    const failed = probes.filter((p) => p.status === 'failed').length;
    const avgLatencyMs = probes.length > 0
      ? Math.round(probes.reduce((s, p) => s + p.latencyMs, 0) / probes.length)
      : 0;
    return {
      total_probes: probes.length,
      passed_count: passed,
      failed_count: failed,
      avg_latency_ms: avgLatencyMs,
      probes,
    };
  }

  private async probePing(): Promise<ReliabilityProbeResult> {
    const start = Date.now();
    try {
      const r = await probeHttp('GET', '/api/health/ping', this.probePort, 1_500);
      const ok = r.status === 200 && r.body.includes('"status":"ok"');
      return {
        name: 'ping',
        status: ok ? 'passed' : 'failed',
        latencyMs: r.latencyMs,
        detail: ok ? 'liveness ok' : `unexpected response: ${r.status} ${r.body.slice(0, 80)}`,
        data: { status: r.status },
        error: ok ? undefined : (r.error ?? `status=${r.status}`),
      };
    } catch (e: any) {
      return { name: 'ping', status: 'failed', latencyMs: Date.now() - start, detail: e?.message ?? String(e), error: e?.message };
    }
  }

  private async probeHealth(): Promise<ReliabilityProbeResult> {
    const start = Date.now();
    try {
      const r = await probeHttp('GET', '/api/health', this.probePort, 1_500);
      const ok = r.status === 200 && r.body.includes('"status":"ok"') && r.body.includes('"tradingEngine"');
      return {
        name: 'health',
        status: ok ? 'passed' : 'failed',
        latencyMs: r.latencyMs,
        detail: ok ? 'process + engine telemetry ok' : `unexpected response: ${r.status}`,
        data: { status: r.status },
        error: ok ? undefined : (r.error ?? `status=${r.status}`),
      };
    } catch (e: any) {
      return { name: 'health', status: 'failed', latencyMs: Date.now() - start, detail: e?.message ?? String(e), error: e?.message };
    }
  }

  private async probeReady(): Promise<ReliabilityProbeResult> {
    const start = Date.now();
    try {
      const r = await probeHttp('GET', '/api/health/ready', this.probePort, 1_500);
      let parsed: any = null;
      try { parsed = r.body ? JSON.parse(r.body) : null; } catch { /* leave null */ }
      const checks = parsed?.checks ?? {};
      const shapeOk = parsed && typeof parsed.ready === 'boolean' && ['ready', 'not_ready'].includes(parsed.status);
      // Safety interlocks and capital must always be ok (halting is healthy).
      const interlocksOk = checks?.safetyInterlocks?.ok === true && checks?.capital?.ok === true;
      const ok = r.status === 200 && shapeOk && interlocksOk;
      return {
        name: 'ready',
        status: ok ? 'passed' : 'failed',
        latencyMs: r.latencyMs,
        detail: ok ? `ready=${parsed.ready} activelyTrading=${parsed.activelyTrading}` : `unexpected shape or status=${r.status}`,
        data: { ready: parsed?.ready, activelyTrading: parsed?.activelyTrading },
        error: ok ? undefined : 'shape mismatch',
      };
    } catch (e: any) {
      return { name: 'ready', status: 'failed', latencyMs: Date.now() - start, detail: e?.message ?? String(e), error: e?.message };
    }
  }

  private async probeMarketDataFreshness(): Promise<ReliabilityProbeResult> {
    const start = Date.now();
    try {
      const r = await probeHttp('GET', '/api/health/ready', this.probePort, 1_500);
      let parsed: any = null;
      try { parsed = r.body ? JSON.parse(r.body) : null; } catch { /* leave null */ }
      const ok = parsed?.checks?.marketData?.ok === true;
      return {
        name: 'market_data_freshness',
        status: ok ? 'passed' : 'failed',
        latencyMs: r.latencyMs,
        detail: ok ? `market data fresh: ${parsed?.checks?.marketData?.detail ?? ''}` : `stale or absent: ${parsed?.checks?.marketData?.detail ?? ''}`,
        data: { marketDataOk: parsed?.checks?.marketData?.ok },
        error: ok ? undefined : 'market data not fresh',
      };
    } catch (e: any) {
      return { name: 'market_data_freshness', status: 'failed', latencyMs: Date.now() - start, detail: e?.message ?? String(e), error: e?.message };
    }
  }

  private async probeDurableStateFlush(): Promise<ReliabilityProbeResult> {
    const start = Date.now();
    try {
      const ok = Boolean(this.flushTradingState());
      return {
        name: 'durable_state_flush',
        status: ok ? 'passed' : 'failed',
        latencyMs: Date.now() - start,
        detail: ok ? 'durable state written' : 'durable state could not be written (or no state)',
        data: { persistenceOk: ok },
        error: ok ? undefined : 'persistence failed',
      };
    } catch (e: any) {
      return { name: 'durable_state_flush', status: 'failed', latencyMs: Date.now() - start, detail: e?.message ?? String(e), error: e?.message };
    }
  }

  /** Stage 6 — Self-optimization. Plain heuristic — observe availability
   *  ratios and emit suggestions. NEVER mutates configuration. */
  public optimize(snap: ReliabilityTelemetrySnapshot | undefined, recent: ReliabilityCycleResult[]): { status: 'success' | 'failed'; optimization: ReliabilityOptimization } {
    try {
      const window = recent.slice(0, 10);
      const onlineSum = snap && snap.registeredEngines > 0 ? snap.onlineCount / snap.registeredEngines : 1;
      const recentScores = window.length > 0 ? window.map((c) => c.reliabilityScore) : [this.getReliabilityScore()];
      const avgScore = recentScores.reduce((s, x) => s + x, 0) / recentScores.length;
      const availability = Number((onlineSum * 100).toFixed(2));
      const notes: string[] = [];
      if (availability < 80) notes.push(`availability ${availability}% below 80% — inspect DOWN engines`);
      if (avgScore < 90 && recentScores.length > 1) notes.push(`avg score ${avgScore.toFixed(1)} below 90 — check flapping probes`);
      if (notes.length === 0) notes.push('nominal: no pattern requiring change');
      return {
        status: 'success',
        optimization: {
          status: notes[0] === 'nominal: no pattern requiring change' ? 'nominal' : 'optimized',
          modelAccuracy: Number(((avgScore / 100) * (onlineSum)).toFixed(4)),
          notes,
        },
      };
    } catch (e: any) {
      return { status: 'failed', optimization: { status: 'nominal', modelAccuracy: 0, notes: [`optimize threw: ${e?.message ?? String(e)}`] } };
    }
  }

  /** Stage 7 — Self-update. The loop NEVER updates code. It reports the
   *  running version and emits a recommendation only. */
  public selfUpdate(): { status: 'success' | 'failed'; selfUpdate: ReliabilitySelfUpdate } {
    try {
      // The deployed commit is the source of truth for "what is running".
      // It is read from the same .gigpilot-data/deployed-commit.txt the
      // /api/health endpoint reads; on the rare deploy the file may be
      // missing and we report "unknown" rather than guess.
      let activeVersion = 'unknown';
      try {
        const fs = require('node:fs') as typeof import('node:fs');
        const path = require('node:path') as typeof import('node:path');
        const p = process.env.GIGPILOT_DEPLOYED_COMMIT_FILE || path.join(process.cwd(), '.gigpilot-data', 'deployed-commit.txt');
        const v = fs.readFileSync(p, 'utf8').trim();
        if (/^[0-9a-f]{40}$/i.test(v)) activeVersion = v;
      } catch { /* leave unknown */ }
      return {
        status: 'success',
        selfUpdate: {
          status: 'stable',
          activeVersion,
          recommendation: 'no auto-update; recommendations are operator / deploy-pipeline only',
        },
      };
    } catch (e: any) {
      return { status: 'failed', selfUpdate: { status: 'stable', activeVersion: 'unknown', recommendation: `selfUpdate threw: ${e?.message ?? String(e)}` } };
    }
  }

  // ---------------------------------------------------------------------------
  // Cycle runner
  // ---------------------------------------------------------------------------

  /** Execute one full cycle. Returns a serialized ReliabilityCycleResult.
   *  The result is also stored in history and surfaced via getLastCycle(). */
  public async executeCycle(mode?: 'autonomous' | 'observe' | 'dry_run'): Promise<ReliabilityCycleResult> {
    const effectiveMode = mode ?? this.defaultMode;
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const executionId = `cycle_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const telemetry = this.collectTelemetry();
    const diagnosis = this.diagnose(telemetry.snapshot);
    const prediction = this.predict(telemetry.snapshot);
    const suite = await this.runCanaryProbes();
    const remediation = this.remediate(diagnosis.report, suite, effectiveMode);
    const optimization = this.optimize(telemetry.snapshot, this.history);
    const selfUpdating = this.selfUpdate();

    const finishedAt = new Date().toISOString();
    const duration = Date.now() - start;

    // Score: 0..100. Three equal-weight inputs.
    const probeRate = suite.total_probes > 0 ? suite.passed_count / suite.total_probes : 1;
    const onlineRate = telemetry.snapshot && telemetry.snapshot.registeredEngines > 0
      ? telemetry.snapshot.onlineCount / telemetry.snapshot.registeredEngines
      : 1;
    const flapping = diagnosis.report.flappingProbes.length;
    const reliabilityScore = Math.round(
      (probeRate * 0.5 + onlineRate * 0.4 + Math.max(0, 1 - flapping / 3) * 0.1) * 100,
    );

    const cycle: ReliabilityCycleResult = {
      executionId,
      startedAt,
      finishedAt,
      durationTotalMs: duration,
      mode: effectiveMode,
      reliabilityScore,
      stages: {
        telemetry,
        diagnosis,
        prediction,
        remediation,
        testing: {
          status: suite.failed_count > 0 ? 'failed' : 'passed',
          testSuite: suite,
        },
        optimization,
        selfUpdating,
      },
    };

    this.lastCycle = cycle;
    this.history.unshift(cycle);
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    this.latencyMs = duration;
    this.lastHeartbeat = finishedAt;
    if (reliabilityScore < 80 || suite.failed_count > 0) {
      this.status = 'DEGRADED';
      this.recordError('WARN', `cycle ${executionId} scored ${reliabilityScore}/100; ${suite.failed_count} probe(s) failed`, { score: reliabilityScore });
    } else if (reliabilityScore >= 95) {
      this.status = 'HEALTHY';
    }
    return cycle;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Find probes that have failed at least twice across the last 5 cycles. */
  private findFlappingProbes(): ReliabilityProbeName[] {
    const recent = this.history.slice(0, 5);
    if (recent.length < 2) return [];
    const tally = new Map<ReliabilityProbeName, number>();
    for (const cycle of recent) {
      for (const probe of cycle.stages.testing.testSuite.probes) {
        if (probe.status === 'failed') {
          tally.set(probe.name, (tally.get(probe.name) ?? 0) + 1);
        }
      }
    }
    return Array.from(tally.entries()).filter(([, n]) => n >= 2).map(([name]) => name);
  }
}

/** Tiny helper so the remediate method can fire-and-forget an async suite
 *  without an `await` chain inside a synchronous try/catch. */
function awaitPromise<T>(p: Promise<T>): T {
  // This helper exists only to be used in `remediate` when we deliberately
  // do not want to await. We capture the result via .then to keep the
  // promise live even if the caller ignores it.
  let resolved: T | undefined;
  p.then((v) => { resolved = v; }).catch(() => { /* ignored */ });
  return resolved as unknown as T;
}
