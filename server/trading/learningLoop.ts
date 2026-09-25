import { EngineErrorRecord, EngineHealth, EngineModule, Fill, ParameterStabilityReport, ParameterStabilitySample, StrategyPerformanceMetrics, StrategyVersion } from './types.js';

export class LearningLoopEngine implements EngineModule {
  public readonly id = 'SELF_LEARN_OPTIMIZER';
  public readonly name = 'Self-Learn Optimizer (Champion / Challenger Parameter Tuning)';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private championStrategy: StrategyVersion;
  private challengerStrategies: StrategyVersion[] = [];
  private strategyHistory: StrategyVersion[] = [];

  constructor() {
    this.championStrategy = {
      id: 'STRAT-GRID-001',
      name: 'Dynamic Volatility-Scaled Geometric Grid',
      version: 'v2.1.0-LIVE',
      type: 'ADAPTIVE_GRID',
      status: 'CHAMPION',
      createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
      deployedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      reasonForChange: 'Live champion parameters configured; no synthetic or historical performance evidence is used for promotion.',
      parameters: {
        upperBoundary: 92500,
        lowerBoundary: 78000,
        gridLevels: 24,
        spacingType: 'GEOMETRIC',
        gridSpacingPct: 0.65,
        volatilityMultiplier: 1.15,
        trendFilterEma: 50,
        rsiFilterThreshold: 35,
        stopLossPct: 8.5,
        takeProfitPct: 15.0,
        rebalanceIntervalSec: 120
      },
      backtestResults: {
        netProfit: 0,
        grossProfit: 0,
        totalFees: 0,
        roiPct: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        maxDrawdownPct: 0,
        winRatePct: 0,
        profitFactor: 0,
        tradesCount: 0,
        avgTradeProfitUsd: 0,
        avgHoldingTimeMinutes: 0,
        orderFillRatePct: 0,
        capitalUtilizationPct: 0
      },      liveTradingResults: {
        netProfit: 0.0,
        grossProfit: 0.0,
        totalFees: 0.0,
        roiPct: 0.0,
        sharpeRatio: 0.0,
        sortinoRatio: 0.0,
        maxDrawdownPct: 0.0,
        winRatePct: 0.0,
        profitFactor: 0.0,
        tradesCount: 0,
        avgTradeProfitUsd: 0.0,
        avgHoldingTimeMinutes: 0,
        orderFillRatePct: 100.0,
        capitalUtilizationPct: 0.0
      }
    };

    // No pre-seeded challenger is treated as evidence. Challengers must be created from live observations.
    this.challengerStrategies = [];

  }

  public healthCheck(): EngineHealth {
    return {
      id: this.id,
      name: this.name,
      status: !this.enabled ? 'OFF' : this.status,
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message,
      errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        championId: this.championStrategy.id,
        championVersion: this.championStrategy.version,
        challengersCount: this.challengerStrategies.length,
        optimizationCriteria: 'REAL_SHARPE_RATIO_WALK_FORWARD'
      }
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
      this.recordError('WARN', 'Self-Learn Optimizer switched OFF. Parameter adaptation suspended.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Self-Learn Optimizer switched ON.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_learn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  public getChampionStrategy(): StrategyVersion {
    return { ...this.championStrategy };
  }

  public getChallengerStrategies(): StrategyVersion[] {
    return [...this.challengerStrategies];
  }

  public getStrategyHistory(): StrategyVersion[] {
    return [...this.strategyHistory];
  }

  /**
   * Evaluate a candidate parameter across a local neighborhood before promotion.
   * Promotion is intentionally rejected when stability evidence is missing or unstable.
   */
  public assessParameterStability(
    challengerId: string,
    parameter: string,
    baselineValue: number,
    samples: ParameterStabilitySample[]
  ): { stable: boolean; report?: ParameterStabilityReport; reason?: string } {
    const challenger = this.challengerStrategies.find(s => s.id === challengerId);
    if (!challenger) return { stable: false, reason: 'Challenger not found' };
    if (!Number.isFinite(baselineValue) || samples.length < 3) {
      return { stable: false, reason: 'At least 3 nearby parameter samples are required for stability validation.' };
    }

    const valid = samples.filter(s => Number.isFinite(s.value) && Number.isFinite(s.metrics.netProfit) && Number.isFinite(s.metrics.sharpeRatio));
    if (valid.length < 3) {
      return { stable: false, reason: 'At least 3 valid nearby parameter samples are required.' };
    }

    const sorted = [...valid].sort((a, b) => a.metrics.netProfit - b.metrics.netProfit);
    const median = (values: number[]) => {
      const v = [...values].sort((a, b) => a - b);
      const m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const profits = valid.map(s => s.metrics.netProfit);
    const sharpes = valid.map(s => s.metrics.sharpeRatio);
    const medianNetProfit = median(profits);
    const medianSharpeRatio = median(sharpes);
    const worstCaseNetProfit = sorted[0].metrics.netProfit;
    const worstCaseSharpeRatio = Math.min(...sharpes);
    const meanProfit = profits.reduce((a, b) => a + b, 0) / profits.length;
    const stdProfit = Math.sqrt(profits.reduce((a, b) => a + Math.pow(b - meanProfit, 2), 0) / profits.length);
    const coefficientOfVariation = Math.abs(meanProfit) > 1e-9 ? stdProfit / Math.abs(meanProfit) : 999;

    // Robustness rewards a profitable neighborhood and penalizes isolated peaks/noisy dispersion.
    const baselineProfit = Math.max(Math.abs(challenger.backtestResults.netProfit), 1);
    const profitRetention = Math.max(0, Math.min(1, worstCaseNetProfit / baselineProfit));
    const dispersionStability = Math.max(0, Math.min(1, 1 - coefficientOfVariation));
    const robustnessScore = Number(((profitRetention * 0.6 + dispersionStability * 0.4) * 100).toFixed(2));
    const stable = worstCaseNetProfit > 0 && worstCaseSharpeRatio > 0 && robustnessScore >= 60;

    const report: ParameterStabilityReport = {
      parameter,
      baselineValue,
      samples: valid,
      medianNetProfit,
      medianSharpeRatio,
      worstCaseNetProfit,
      worstCaseSharpeRatio,
      coefficientOfVariation,
      robustnessScore,
      stable,
      generatedAt: new Date().toISOString()
    };
    challenger.parameterStability = report;
    const expectancy = challenger.backtestResults.tradesCount > 0
      ? challenger.backtestResults.netProfit / challenger.backtestResults.tradesCount
      : 0;
    const expectancyFactor = Math.max(0, Math.min(1, expectancy / 10));
    const riskAdjustedFactor = Math.max(0, Math.min(1, challenger.backtestResults.sharpeRatio / 3));
    challenger.promotionScore = Number((robustnessScore * expectancyFactor * riskAdjustedFactor).toFixed(2));

    return stable
      ? { stable: true, report }
      : { stable: false, report, reason: 'Parameter neighborhood is not sufficiently robust; candidate remains a challenger.' };
  }

  public promoteChallenger(challengerId: string, approvalReason: string): StrategyVersion | null {
    if (!this.enabled) {
      this.recordError('ERROR', 'Cannot promote challenger while Self-Learn Optimizer is OFF.');
      return null;
    }

    const idx = this.challengerStrategies.findIndex(s => s.id === challengerId);
    if (idx === -1) return null;

    const chosen = this.challengerStrategies[idx];
    if (!chosen.parameterStability?.stable || (chosen.promotionScore ?? 0) <= 0) {
      this.recordError('WARN', `Promotion blocked for ${chosen.id}: parameter stability evidence is missing or failed.`);
      return null;
    }
    const previous = { ...this.championStrategy, status: 'RETIRED' as const };
    this.strategyHistory.unshift(previous);

    this.championStrategy = {
      ...chosen,
      status: 'CHAMPION',
      deployedAt: new Date().toISOString(),
      reasonForChange: approvalReason || `Promoted over ${previous.id} based on superior performance metrics`
    };

    this.challengerStrategies.splice(idx, 1);
    this.recordError('WARN', `Promoted strategy ${chosen.id} (${chosen.name}) to active Champion.`);
    return this.championStrategy;
  }

  public recordRealFills(fills: Fill[]) {
    if (!this.enabled || fills.length === 0) return;
    const start = Date.now();

    const results = this.championStrategy.liveTradingResults || {
      netProfit: 0,
      grossProfit: 0,
      totalFees: 0,
      roiPct: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdownPct: 0,
      winRatePct: 0,
      profitFactor: 0,
      tradesCount: 0,
      avgTradeProfitUsd: 0,
      avgHoldingTimeMinutes: 0,
      orderFillRatePct: 100,
      capitalUtilizationPct: 50
    };

    let net = 0;
    let fees = 0;
    let wins = 0;

    for (const f of fills) {
      net += (f.realizedPnL - f.feeUsd);
      fees += f.feeUsd;
      if (f.realizedPnL > 0) wins++;
    }

    results.tradesCount += fills.length;
    results.netProfit += net;
    results.totalFees += fees;
    results.winRatePct = Number(((wins / (fills.length || 1)) * 100).toFixed(2));

    this.championStrategy.liveTradingResults = results;
    this.latencyMs = Date.now() - start;
    this.lastHeartbeat = new Date().toISOString();
  }
}
