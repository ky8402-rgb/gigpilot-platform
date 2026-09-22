import { GoogleGenAI } from '@google/genai';
import { EngineErrorRecord, EngineHealth, EngineModule, GridConfiguration, MarketRegime, CapitalAccounting, ResearchItem, StrategyVersion } from './types.js';

export interface AutonomousOptimizationDecision {
  id: string;
  timestamp: string;
  objective: 'NET_REALIZED_PROFIT_AFTER_FEES';
  decision: 'NO_CHANGE' | 'TIGHTEN_GRID' | 'WIDEN_GRID' | 'PAUSE_OPTIMIZATION';
  confidence: number;
  reason: string;
  expectedEffect: string;
  applied: boolean;
  previousGridSpacingPct?: number;
  newGridSpacingPct?: number;
}

export class AutonomousProfitOptimizer implements EngineModule {
  public readonly id = 'SELF_LEARN_OPTIMIZER';
  public readonly name = 'Autonomous Profit Optimizer (AI Audit → Decision → Live Parameter Improvement)';

  private enabled = true;
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs = 0;
  private lastHeartbeat = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];
  private decisions: AutonomousOptimizationDecision[] = [];
  private aiClient: GoogleGenAI | null = null;
  private lastRunAt = 0;

  public healthCheck(): EngineHealth {
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    return {
      id: this.id,
      name: this.name,
      status: !this.enabled ? 'OFF' : (!hasKey ? 'DEGRADED' : this.status),
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message,
      errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
        autonomousDecisioning: true,
        autonomousCodeMutation: false,
        decisionsCount: this.decisions.length
      }
    };
  }

  public getErrorSurface() { return [...this.errorSurface]; }
  public getOffSwitch() { return this.enabled; }

  public setOffSwitch(enabled: boolean) {
    this.enabled = enabled;
    this.status = enabled ? 'HEALTHY' : 'OFF';
  }

  public clearErrors() { this.errorSurface = []; }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    this.errorSurface.unshift({
      id: `err_profitopt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    });
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  private getAiClient() {
    if (!this.aiClient && process.env.GEMINI_API_KEY) {
      this.aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return this.aiClient;
  }

  public getDecisions() { return [...this.decisions]; }

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

    const prompt = `You are GigPilot's autonomous production profit optimizer. Audit ONLY REAL LIVE TRADING STATE and decide whether to change the live grid spacing parameter.

Objective: maximize sustainable NET REALIZED PROFIT AFTER FEES. Vanity metrics such as trade count, gross volume, raw win rate, and gross P&L must never be optimization objectives.

Hard constraints:
- Never invent market data.
- Never request or create paper/simulation/backtest data.
- Never change exchange credentials, withdrawal settings, risk limits, or kill-switch state.
- Only choose NO_CHANGE, TIGHTEN_GRID, or WIDEN_GRID.
- Maximum one-step spacing change is 15%.
- If evidence is insufficient, choose NO_CHANGE.
- If system health is not healthy, choose NO_CHANGE.
- Treat risk limits as hard constraints, not optimization objectives.

LIVE ACCOUNTING:
totalEquity=${input.capital.totalEquity}
availableCash=${input.capital.availableCash}
lockedInOrders=${input.capital.lockedInOrders}
netRealizedProfit=${input.capital.netRealizedProfit}
grossProfit=${input.capital.grossProfit}
fees=${input.capital.totalTradingFees}
roiPct=${input.capital.roiPct}
drawdownPct=${input.capital.currentDrawdownPct}
trades=${input.capital.totalTrades}

LIVE GRID:
spacingPct=${input.grid.gridSpacingPct}
levels=${input.grid.levelsCount}
allocatedUsd=${input.grid.totalAllocatedUsd}

LIVE REGIME:
${JSON.stringify(input.regime)}

LATEST LIVE RESEARCH:
${JSON.stringify(input.research.slice(0, 5))}

CURRENT CHAMPION:
id=${input.champion.id}; version=${input.champion.version}; liveNetProfit=${input.champion.liveTradingResults?.netProfit ?? 0}; liveFees=${input.champion.liveTradingResults?.totalFees ?? 0}; liveTrades=${input.champion.liveTradingResults?.tradesCount ?? 0}

Return JSON only:
{"decision":"NO_CHANGE|TIGHTEN_GRID|WIDEN_GRID","confidence":0..1,"reason":"...","expectedEffect":"..."}`;

    const start = Date.now();
    try {
      const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const raw = response.text?.trim() || '{}';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Optimizer returned non-JSON response');
      const parsed = JSON.parse(match[0]);
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const decision = ['NO_CHANGE','TIGHTEN_GRID','WIDEN_GRID'].includes(parsed.decision) ? parsed.decision : 'NO_CHANGE';

      // AI decides; deterministic guardrails decide whether that decision is safe to apply.
      const shouldApply = confidence >= 0.75 && decision !== 'NO_CHANGE';
      const previous = input.grid.gridSpacingPct;
      const factor = decision === 'TIGHTEN_GRID' ? 0.90 : decision === 'WIDEN_GRID' ? 1.10 : 1;
      const next = Number((previous * factor).toFixed(4));

      const result = this.saveDecision(
        decision,
        confidence,
        String(parsed.reason || 'AI found insufficient evidence for a stronger conclusion.'),
        String(parsed.expectedEffect || 'No measurable effect established yet.'),
        shouldApply,
        previous,
        shouldApply ? next : previous
      );
      this.latencyMs = Date.now() - start;
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';
      return result;
    } catch (err: any) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', `Autonomous optimization failed: ${err.message}`);
      return this.saveDecision('PAUSE_OPTIMIZATION', 1, `AI audit failed: ${err.message}`, 'No live parameter change.', false);
    }
  }

  private saveDecision(
    decision: AutonomousOptimizationDecision['decision'],
    confidence: number,
    reason: string,
    expectedEffect: string,
    applied: boolean,
    previousGridSpacingPct?: number,
    newGridSpacingPct?: number
  ): AutonomousOptimizationDecision {
    const item: AutonomousOptimizationDecision = {
      id: `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
      decision,
      confidence,
      reason,
      expectedEffect,
      applied,
      previousGridSpacingPct,
      newGridSpacingPct
    };
    this.decisions.unshift(item);
    if (this.decisions.length > 100) this.decisions.pop();
    return item;
  }
}
