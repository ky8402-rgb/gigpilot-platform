import { GoogleGenAI } from '@google/genai';
import { CapitalAccounting, EngineErrorRecord, EngineHealth, EngineModule, GridConfiguration, MarketRegime, ResearchItem, StrategyVersion, EngineId } from './types.js';

export interface AutonomousStrategyBuild {
  id: string;
  createdAt: string;
  objective: 'NET_REALIZED_PROFIT_AFTER_FEES';
  status: 'BUILT' | 'REJECTED';
  strategyName: string;
  parentStrategyId: string;
  parameters: StrategyVersion['parameters'];
  confidence: number;
  rationale: string;
  expectedEffect: string;
  liveEvidence: {
    netRealizedProfit: number;
    totalFees: number;
    totalTrades: number;
    currentDrawdownPct: number;
  };
}

export class AutonomousStrategyBuilder implements EngineModule {
  public readonly id: EngineId = 'STRATEGY_IDE';
  public readonly name = 'Autonomous Strategy Builder (AI Audit → Build → Validate)';
  private enabled = true;
  private status: EngineHealth['status'] = 'HEALTHY';
  private latencyMs = 0;
  private lastHeartbeat = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];
  private builds: AutonomousStrategyBuild[] = [];
  private aiClient: GoogleGenAI | null = null;

  public healthCheck(): EngineHealth {
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    return {
      id: this.id, name: this.name,
      status: !this.enabled ? 'OFF' : (!hasKey ? 'DEGRADED' : this.status),
      enabled: this.enabled, latencyMs: this.latencyMs, lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length, lastError: this.errorSurface[0]?.message,
      errorSurface: this.errorSurface.slice(0, 10),
      details: { objective: 'NET_REALIZED_PROFIT_AFTER_FEES', autonomousBuild: true, sourceData: 'LIVE_PRODUCTION_ONLY', buildsCount: this.builds.length }
    };
  }
  public getErrorSurface() { return [...this.errorSurface]; }
  public getOffSwitch() { return this.enabled; }
  public setOffSwitch(enabled: boolean) { this.enabled = enabled; this.status = enabled ? 'HEALTHY' : 'OFF'; }
  public clearErrors() { this.errorSurface = []; }
  public getBuilds() { return [...this.builds]; }

  private client() {
    if (!this.aiClient && process.env.GEMINI_API_KEY) this.aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return this.aiClient;
  }

  public async build(input: { capital: CapitalAccounting; grid: GridConfiguration; regime: MarketRegime; research: ResearchItem[]; champion: StrategyVersion; }): Promise<AutonomousStrategyBuild | null> {
    if (!this.enabled) return null;
    const ai = this.client();
    if (!ai) {
      this.status = 'DEGRADED';
      this.recordError('WARN', 'GEMINI_API_KEY is not configured; autonomous strategy building is fail-closed.');
      return null;
    }
    const start = Date.now();
    try {
      const prompt = `You are GigPilot's autonomous live-production strategy builder.

Your sole objective is sustainable NET REALIZED PROFIT AFTER FEES. Do not optimize trade count, volume, gross P&L, raw win rate, or other vanity metrics.

Use ONLY the live production evidence supplied below. Never invent data and never request paper, simulated, synthetic, backtest, or fabricated data.

Build one bounded strategy improvement for the existing live grid. You may change ONLY:
- gridLevels: integer 8..64
- gridSpacingPct: number 0.10..5.00
- volatilityMultiplier: number 0.50..2.00
- trendFilterEma: integer 9..200
- rsiFilterThreshold: number 20..80
- rebalanceIntervalSec: integer 30..900

Never change credentials, wallet/withdrawal settings, leverage limits, exposure limits, risk rules, reserve requirements, or kill-switch state.

A build is eligible only when confidence >= 0.85 and all proposed parameters remain within the bounds above. If live evidence is insufficient, return REJECTED.

LIVE ACCOUNTING:
${JSON.stringify({ totalEquity: input.capital.totalEquity, availableCash: input.capital.availableCash, lockedInOrders: input.capital.lockedInOrders, netRealizedProfit: input.capital.netRealizedProfit, totalTradingFees: input.capital.totalTradingFees, currentDrawdownPct: input.capital.currentDrawdownPct, totalTrades: input.capital.totalTrades })}

LIVE GRID:
${JSON.stringify({ spacingPct: input.grid.gridSpacingPct, levels: input.grid.levelsCount, allocatedUsd: input.grid.totalAllocatedUsd, spacingType: input.grid.spacingType })}

LIVE REGIME:
${JSON.stringify(input.regime)}

LATEST LIVE RESEARCH:
${JSON.stringify(input.research.slice(0, 5))}

CURRENT LIVE STRATEGY:
${JSON.stringify({ id: input.champion.id, version: input.champion.version, parameters: input.champion.parameters, liveResults: input.champion.liveTradingResults })}

Return JSON only:
{"status":"BUILT|REJECTED","strategyName":"...","confidence":0..1,"rationale":"...","expectedEffect":"...","parameters":{"gridLevels":16,"gridSpacingPct":0.65,"volatilityMultiplier":1.15,"trendFilterEma":50,"rsiFilterThreshold":35,"rebalanceIntervalSec":120}}`;

      const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
      const raw = response.text?.trim() || '{}';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Strategy builder returned non-JSON response');
      const parsed = JSON.parse(match[0]);
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const p = parsed.parameters || {};
      const validInt = (v: any, min: number, max: number) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
      const validNum = (v: any, min: number, max: number) => Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
      const valid = validInt(p.gridLevels, 8, 64) && validNum(p.gridSpacingPct, 0.10, 5.00) && validNum(p.volatilityMultiplier, 0.50, 2.00) && validInt(p.trendFilterEma, 9, 200) && validNum(p.rsiFilterThreshold, 20, 80) && validInt(p.rebalanceIntervalSec, 30, 900);
      const status = parsed.status === 'BUILT' && confidence >= 0.85 && valid ? 'BUILT' : 'REJECTED';
      const build: AutonomousStrategyBuild = {
        id: `build_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
        status,
        strategyName: String(parsed.strategyName || 'AI Live Grid Improvement'),
        parentStrategyId: input.champion.id,
        parameters: valid ? { ...input.champion.parameters, gridLevels: Number(p.gridLevels), gridSpacingPct: Number(Number(p.gridSpacingPct).toFixed(4)), volatilityMultiplier: Number(Number(p.volatilityMultiplier).toFixed(4)), trendFilterEma: Number(p.trendFilterEma), rsiFilterThreshold: Number(Number(p.rsiFilterThreshold).toFixed(2)), rebalanceIntervalSec: Number(p.rebalanceIntervalSec) } : input.champion.parameters,
        confidence,
        rationale: String(parsed.rationale || 'Insufficient live evidence.'),
        expectedEffect: String(parsed.expectedEffect || 'No change applied.'),
        liveEvidence: { netRealizedProfit: input.capital.netRealizedProfit, totalFees: input.capital.totalTradingFees, totalTrades: input.capital.totalTrades, currentDrawdownPct: input.capital.currentDrawdownPct }
      };
      this.builds.unshift(build);
      if (this.builds.length > 50) this.builds.pop();
      this.latencyMs = Date.now() - start;
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';
      return build;
    } catch (err: any) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', `Autonomous strategy build failed: ${err?.message || 'unknown error'}`);
      return null;
    }
  }

  private recordError(level: EngineErrorRecord['level'], message: string) {
    this.errorSurface.unshift({ id: `err_strategy_builder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, timestamp: new Date().toISOString(), level, message });
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }
}
