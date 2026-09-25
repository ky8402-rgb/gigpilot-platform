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
      liveTradingResults: {
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
