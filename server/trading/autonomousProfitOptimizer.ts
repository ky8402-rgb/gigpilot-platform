import { GoogleGenAI } from '@google/genai';
import { EngineErrorRecord, EngineHealth, EngineModule, GridConfiguration, MarketRegime, CapitalAccounting, ResearchItem, StrategyVersion } from './types.js';
import { AutonomousStrategyBuilder, AutonomousStrategyBuild } from './autonomousStrategyBuilder.js';

export interface AutonomousOptimizationDecision {
  id: string;
  timestamp: string;
  objective: 'NET_REALIZED_PROFIT_AFTER_FEES';
  decision: 'NO_CHANGE' | 'TIGHTEN_GRID' | 'WIDEN_GRID' | 'BUILD_STRATEGY' | 'PAUSE_OPTIMIZATION';
  confidence: number;
  reason: string;
  expectedEffect: string;
  applied: boolean;
  previousGridSpacingPct?: number;
  newGridSpacingPct?: number;
  strategyBuildId?: string;
}

export class AutonomousProfitOptimizer implements EngineModule {
  public readonly id = 'AUTONOMOUS_PROFIT_OPTIMIZER';
  public readonly name = 'Autonomous Profit Optimizer (AI Audit → Decide → Build → Live Improvement)';
  private enabled = true;
  private status: EngineHealth['status'] = 'HEALTHY';
  private latencyMs = 0;
  private lastHeartbeat = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];
  private decisions: AutonomousOptimizationDecision[] = [];
  private aiClient: GoogleGenAI | null = null;
  private lastRunAt = 0;
  private readonly strategyBuilder = new AutonomousStrategyBuilder();

  public healthCheck(): EngineHealth {
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    return {
      id: this.id, name: this.name,
      status: !this.enabled ? 'OFF' : (!hasKey ? 'DEGRADED' : this.status),
      enabled: this.enabled, latencyMs: this.latencyMs, lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length, lastError: this.errorSurface[0]?.message,
      errorSurface: this.errorSurface.slice(0, 10),
      details: {
        objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
        autonomousDecisioning: true,
        autonomousBuild: true,
        sourceData: 'LIVE_PRODUCTION_ONLY',
        decisionsCount: this.decisions.length,
        strategyBuildsCount: this.strategyBuilder.getBuilds().length
      }
    };
  }

  public getErrorSurface() { return [...this.errorSurface]; }
  public getOffSwitch() { return this.enabled; }
  public setOffSwitch(enabled: boolean) { this.enabled = enabled; this.status = enabled ? 'HEALTHY' : 'OFF'; }
  public clearErrors() { this.errorSurface = []; this.strategyBuilder.clearErrors(); }
  public getDecisions() { return [...this.decisions]; }
  public getStrategyBuilds() { return this.strategyBuilder.getBuilds(); }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    this.errorSurface.unshift({
      id: `err_profitopt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(), level, message, details
    });
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  private getAiClient() {
    if (!this.aiClient && process.env.GEMINI_API_KEY) this.aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return this.aiClient;
  }

  public async auditAndOptimize(input: {
    capital: CapitalAccounting;
    grid: GridConfiguration | null;
    regime: MarketRegime;
    research: ResearchItem[];
    champion: StrategyVersion;
    systemHealthy: boolean;
  }): Promise<AutonomousOptimizationDecision> {
    const now = Date.now();
    if (!this.enabled) return this.saveDecision('PAUSE_OPTIMIZATION', 1, 'Optimizer is disabled.', 'No change.', false);
    if (!input.systemHealthy) return this.saveDecision('PAUSE_OPTIMIZATION', 1, 'System is fail-closed or a critical engine is degraded.', 'No live parameter change.', false);
    if (!input.grid) return this.saveDecision('NO_CHANGE', 1, 'No active live grid exists.', 'Wait for a live grid.', false);
    if (now - this.lastRunAt < 30000) return this.decisions[0] || this.saveDecision('NO_CHANGE', 1, 'Optimization cooldown active.', 'No change.', false);
    this.lastRunAt = now;

    const ai = this.getAiClient();
    if (!ai) {
      this.status = 'DEGRADED';
      return this.saveDecision('PAUSE_OPTIMIZATION', 1, 'GEMINI_API_KEY is not configured; autonomous AI decisioning is paused fail-closed.', 'No live parameter change.', false);
    }

    const prompt = `You are GigPilot's autonomous production profit auditor.

Audit ONLY REAL LIVE TRADING STATE and decide whether an improvement is justified.
Objective: maximize sustainable NET REALIZED PROFIT AFTER FEES.
Never optimize trade count, gross volume, raw win rate, or gross P&L.
Never invent market data and never use paper, simulation, synthetic, or backtest evidence.
Never change credentials, withdrawals, risk limits, reserve requirements, or kill-switch state.
If evidence is insufficient, choose NO_CHANGE.
Return JSON only: {"decision":"NO_CHANGE|TIGHTEN_GRID|WIDEN_GRID|BUILD_STRATEGY","confidence":0..1,"reason":"...","expectedEffect":"..."}

LIVE ACCOUNTING:
${JSON.stringify({
  totalEquity: input.capital.totalEquity,
  availableCash: input.capital.availableCash,
  lockedInOrders: input.capital.lockedInOrders,
  netRealizedProfit: input.capital.netRealizedProfit,
  totalTradingFees: input.capital.totalTradingFees,
  currentDrawdownPct: input.capital.currentDrawdownPct,
  totalTrades: input.capital.totalTrades
})}

LIVE GRID:
${JSON.stringify({ spacingPct: input.grid.gridSpacingPct, levels: input.grid.levelsCount, allocatedUsd: input.grid.totalAllocatedUsd })}

LIVE REGIME:
${JSON.stringify(input.regime)}

LATEST LIVE RESEARCH:
${JSON.stringify(input.research.slice(0, 5))}

CURRENT LIVE STRATEGY:
${JSON.stringify({ id: input.champion.id, version: input.champion.version, parameters: input.champion.parameters, liveResults: input.champion.liveTradingResults })}`;

    const start = Date.now();
    try {
      const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const raw = response.text?.trim() || '{}';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Optimizer returned non-JSON response');
      const parsed = JSON.parse(match[0]);
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const requested = ['NO_CHANGE', 'TIGHTEN_GRID', 'WIDEN_GRID', 'BUILD_STRATEGY'].includes(parsed.decision) ? parsed.decision : 'NO_CHANGE';

      if (requested === 'NO_CHANGE' || confidence < 0.75) {
        const result = this.saveDecision(requested === 'NO_CHANGE' ? 'NO_CHANGE' : 'PAUSE_OPTIMIZATION', confidence,
          String(parsed.reason || 'Insufficient live evidence.'), String(parsed.expectedEffect || 'No measurable effect established.'), false);
        this.latencyMs = Date.now() - start;
        this.lastHeartbeat = new Date().toISOString();
        this.status = 'HEALTHY';
        return result;
      }

      const build = await this.strategyBuilder.build({
        capital: input.capital,
        grid: input.grid,
        regime: input.regime,
        research: input.research,
        champion: input.champion
      });

      if (!build || build.status !== 'BUILT') {
        this.status = 'DEGRADED';
        return this.saveDecision('PAUSE_OPTIMIZATION', confidence,
          'AI audit requested an improvement, but the autonomous strategy builder rejected the build under live-only validation.',
          'No live parameter change.', false, input.grid.gridSpacingPct, input.grid.gridSpacingPct, build?.id);
      }

      const previous = input.grid.gridSpacingPct;
      const proposed = build.parameters.gridSpacingPct ?? previous;
      const bounded = Math.max(previous * 0.85, Math.min(previous * 1.15, proposed));
      const next = Number(bounded.toFixed(4));
      const direction = next < previous ? 'TIGHTEN_GRID' : next > previous ? 'WIDEN_GRID' : 'BUILD_STRATEGY';
      const apply = confidence >= 0.85 && build.confidence >= 0.85 && next > 0;

      const result = this.saveDecision(
        apply ? (direction as AutonomousOptimizationDecision['decision']) : 'PAUSE_OPTIMIZATION',
        Math.min(confidence, build.confidence),
        String(parsed.reason || build.rationale),
        build.expectedEffect,
        apply,
        previous,
        next,
        build.id
      );
      this.latencyMs = Date.now() - start;
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';
      return result;
    } catch (err: any) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', `Autonomous optimization failed: ${err?.message || 'unknown error'}`);
      return this.saveDecision('PAUSE_OPTIMIZATION', 1, `AI audit failed: ${err?.message || 'unknown error'}`, 'No live parameter change.', false);
    }
  }

  private saveDecision(
    decision: AutonomousOptimizationDecision['decision'],
    confidence: number,
    reason: string,
    expectedEffect: string,
    applied: boolean,
    previousGridSpacingPct?: number,
    newGridSpacingPct?: number,
    strategyBuildId?: string
  ): AutonomousOptimizationDecision {
    const item: AutonomousOptimizationDecision = {
      id: `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
      decision, confidence, reason, expectedEffect, applied,
      previousGridSpacingPct, newGridSpacingPct, strategyBuildId
    };
    this.decisions.unshift(item);
    if (this.decisions.length > 100) this.decisions.pop();
    return item;
  }
}
