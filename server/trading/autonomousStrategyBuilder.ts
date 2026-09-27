import { GoogleGenAI } from '@google/genai';
import {
  CapitalAccounting,
  EngineErrorRecord,
  EngineHealth,
  EngineModule,
  GridConfiguration,
  MarketRegime,
  ResearchItem,
  StrategyVersion,
  EngineId,
  AutonomousStrategyBuild
} from './types.js';

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
  private lastSuccessfulBuildAt: number | null = null;
  private readonly requestTimeoutMs = 15_000;

  constructor() {
    // No synthetic baseline builds. A build exists only after a real validated Gemini response.
  }

  public healthCheck(): EngineHealth {
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    return {
      id: this.id,
      name: this.name,
      status: !this.enabled ? 'OFF' : (!hasKey || this.lastSuccessfulBuildAt === null || Date.now() - this.lastSuccessfulBuildAt > 30 * 60 * 1000 ? 'DEGRADED' : this.status),
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message,
      errorSurface: this.errorSurface.slice(0, 10),
      details: {
        objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
        autonomousBuild: true,
        sourceData: 'LIVE_PRODUCTION_ONLY',
        buildsCount: this.builds.length,
        lastSuccessfulBuildAt: this.lastSuccessfulBuildAt ? new Date(this.lastSuccessfulBuildAt).toISOString() : null,
        freshnessWindowMinutes: 30
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
  public getBuilds() { return [...this.builds]; }

  private client() {
    if (!this.aiClient && process.env.GEMINI_API_KEY) {
      this.aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return this.aiClient;
  }

  public async build(input: {
    capital: CapitalAccounting;
    grid: GridConfiguration;
    regime: MarketRegime;
    research: ResearchItem[];
    champion: StrategyVersion;
    overrideSpacing?: number;
  }): Promise<AutonomousStrategyBuild | null> {
    if (!this.enabled) return null;
    const ai = this.client();
    const start = Date.now();

    const targetSpacing = input.overrideSpacing ?? input.grid.gridSpacingPct;

    if (!ai) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', 'Gemini API credential is required for autonomous strategy builds; no fallback build is permitted.');
      return null;
    }

    let strategyName = '';
    let confidence: number | null = null;
    let rationale = '';
    let expectedEffect = '';
    let mutatedParams: StrategyVersion['parameters'] = { ...input.champion.parameters, gridSpacingPct: targetSpacing };
    try {
        const prompt = `You are GigPilot's Autonomous Strategy Builder.
Your sole mission: Build a refined crypto grid strategy variant optimizing ONLY FOR NET REALIZED PROFIT AFTER EXCHANGE FEES.
Zero vanity metrics (turnover volume, raw order count, cosmetic win rate).

LIVE CONTEXT:
- Active Regime: ${input.regime.regime} (ATR: $${input.regime.atr}, Volatility: ${input.regime.bbBandwidth}%)
- Current Strategy: ${input.champion.name} (${input.champion.id})
- Target Grid Spacing: ${targetSpacing}%
- Net Realized Profit: $${input.capital.netRealizedProfit}
- Exchange Fees Paid: $${input.capital.totalTradingFees}

Allowable Parameter Boundaries:
- gridLevels: 8..64 (integer)
- gridSpacingPct: 0.15..4.00 (number)
- volatilityMultiplier: 0.50..2.00 (number)
- trendFilterEma: 9..200 (integer)
- rsiFilterThreshold: 20..80 (number)
- rebalanceIntervalSec: 30..900 (integer)

Return JSON ONLY:
{
  "status": "BUILT",
  "strategyName": "Short descriptive name",
  "confidence": 0.85 - 0.99,
  "rationale": "Why this parameter set maximizes net revenue after fees",
  "expectedEffect": "Estimated net profit gain in USD or bps",
  "parameters": {
    "gridLevels": 16,
    "gridSpacingPct": ${targetSpacing},
    "volatilityMultiplier": 1.15,
    "trendFilterEma": 50,
    "rsiFilterThreshold": 35,
    "rebalanceIntervalSec": 120
  }
}`;

        const response = await Promise.race([
          ai.models.generateContent({ model: 'gemini-flash-latest', contents: prompt }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini strategy build timed out.')), this.requestTimeoutMs))
        ]);

        const raw = response.text?.trim() || '{}';
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (typeof parsed.strategyName !== 'string' || !parsed.strategyName.trim() ||
              typeof parsed.rationale !== 'string' || !parsed.rationale.trim() ||
              typeof parsed.expectedEffect !== 'string' || !parsed.expectedEffect.trim() ||
              !Number.isFinite(parsed.confidence) || parsed.confidence < 0.70 || parsed.confidence > 0.99) {
            throw new Error('Gemini strategy build response failed strict evidence validation.');
          }
          strategyName = parsed.strategyName.trim();
          rationale = parsed.rationale.trim();
          expectedEffect = parsed.expectedEffect.trim();
          confidence = Number(parsed.confidence);

          const p = parsed.parameters || {};
          if (Number.isFinite(p.gridSpacingPct) && p.gridSpacingPct >= 0.15 && p.gridSpacingPct <= 4.0) {
            mutatedParams.gridSpacingPct = Number(Number(p.gridSpacingPct).toFixed(4));
          }
          if (Number.isInteger(Number(p.gridLevels)) && p.gridLevels >= 8 && p.gridLevels <= 64) {
            mutatedParams.gridLevels = Number(p.gridLevels);
          }
          if (Number.isFinite(p.volatilityMultiplier) && p.volatilityMultiplier >= 0.5 && p.volatilityMultiplier <= 2.0) {
            mutatedParams.volatilityMultiplier = Number(Number(p.volatilityMultiplier).toFixed(2));
          }
          if (Number.isInteger(Number(p.trendFilterEma)) && p.trendFilterEma >= 9 && p.trendFilterEma <= 200) {
            mutatedParams.trendFilterEma = Number(p.trendFilterEma);
          }
        }
      } catch (err: any) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', `Gemini strategy build failed; no build was accepted: ${err?.message || String(err)}`);
      return null;
    }

    if (!strategyName || confidence === null || !rationale || !expectedEffect) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', 'Gemini strategy build returned incomplete evidence; no build was accepted.');
      return null;
    }

    const build: AutonomousStrategyBuild = {
      id: `build_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
      status: 'BUILT',
      strategyName,
      parentStrategyId: input.champion.id,
      parameters: mutatedParams,
      confidence,
      rationale,
      expectedEffect,
      liveEvidence: {
        netRealizedProfit: input.capital.netRealizedProfit,
        totalFees: input.capital.totalTradingFees,
        totalTrades: input.capital.totalTrades,
        currentDrawdownPct: input.capital.currentDrawdownPct
      }
    };

    this.builds.unshift(build);
    if (this.builds.length > 50) this.builds.pop();
    this.latencyMs = Date.now() - start;
    this.lastHeartbeat = new Date().toISOString();
    this.lastSuccessfulBuildAt = Date.now();
    this.status = 'HEALTHY';
    return build;
  }

  private recordError(level: EngineErrorRecord['level'], message: string) {
    this.errorSurface.unshift({
      id: `err_strategy_builder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      message
    });
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }
}
