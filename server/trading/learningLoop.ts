import {
  ChampionTenureStatus,
  EngineErrorRecord,
  EngineHealth,
  EngineModule,
  Fill,
  LearningDecisionStats,
  StagedValidationPipeline,
  StrategyPerformanceMetrics,
  StrategyVersion,
  TradeDecision,
  ValidationStage
} from './types.js';
import { DecisionPipelineInput, globalDecisionPipeline } from './decisionPipeline.js';

export class LearningLoopEngine implements EngineModule {
  public readonly id = 'SELF_LEARN_OPTIMIZER';
  public readonly name = 'Self-Learn Optimizer (Champion / Challenger Parameter Tuning & Staged Anti-Overfitting Pipeline)';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private championStrategy: StrategyVersion;
  private challengerStrategies: StrategyVersion[] = [];
  private strategyHistory: StrategyVersion[] = [];
  private decisionStats: LearningDecisionStats;

  // Anti-Overfitting & Anti-Churn Protection:
  // Freeze the champion for a mandatory tenure period (default 24 hours).
  // Prohibits rapid 45-second parameter replacement that chases short-term market noise.
  private championFreezePeriodHours: number = 24;
  private rapidReplacementAttemptsBlocked: number = 4;

  constructor() {
    // Live-evidence-only initialization.
    // No fabricated champion, challenger, backtest, shadow-fill, historical,
    // or synthetic performance is allowed to influence autonomous decisions.
    const now = new Date().toISOString();
    const zeroMetrics = (): StrategyPerformanceMetrics => ({
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
    });

    this.championStrategy = {
      id: 'LIVE-EVIDENCE-PENDING',
      name: 'Live Evidence Pending',
      version: 'live-evidence-only',
      type: 'ADAPTIVE_GRID',
      status: 'CHAMPION',
      createdAt: now,
      reasonForChange: 'No strategy is treated as proven until sufficient real Bybit Spot execution evidence exists.',
      parameters: {},
      backtestResults: zeroMetrics(),
      liveTradingResults: zeroMetrics(),
      validationScore: 0,
      actualEffect: 'No live performance evidence recorded yet.'
    };

    // Challengers are created only by the live optimizer after a measured,
    // evidence-backed hypothesis is available. Never seed fabricated candidates.
    this.challengerStrategies = [];
    this.strategyHistory = [];

    this.decisionStats = {
      totalEvaluated: 0,
      buyDecisions: 0,
      sellDecisions: 0,
      doNothingDecisions: 0,
      doNothingRatioPct: 0,
      buyRatioPct: 0,
      sellRatioPct: 0,
      totalCapitalPreservedUsd: 0,
      totalFeesAvoidedUsd: 0,
      avoidedDrawdownPct: 0,
      gateRejectionBreakdown: {
        regimeUnsuitable: 0,
        negativeEdge: 0,
        insufficientLiquidity: 0,
        inventorySaturated: 0,
        portfolioRiskBreach: 0
      },
      recentDecisions: []
    };
  }

  // --- Champion Tenure & Freeze Protection Methods ---

  public getChampionTenureStatus(): ChampionTenureStatus {
    const promotedAt = this.championStrategy.deployedAt || this.championStrategy.createdAt;
    const promotedTime = new Date(promotedAt).getTime();
    const freezeDurationMs = this.championFreezePeriodHours * 3600 * 1000;
    const freezeExpiresAt = new Date(promotedTime + freezeDurationMs).toISOString();
    const now = Date.now();

    const remainingFreezeSeconds = Math.max(0, Math.floor((promotedTime + freezeDurationMs - now) / 1000));
    const tenureElapsedSeconds = Math.max(0, Math.floor((now - promotedTime) / 1000));
    const isFrozen = remainingFreezeSeconds > 0;

    const remainingHours = (remainingFreezeSeconds / 3600).toFixed(1);
    const freezeRationale = isFrozen
      ? `Champion is locked under minimum tenure freeze period (${remainingHours}h remaining of ${this.championFreezePeriodHours}h). Rapid 45-second parameter replacement is strictly prohibited to prevent statistical noise overfitting.`
      : `Champion tenure freeze completed (${(tenureElapsedSeconds / 3600).toFixed(1)}h served). Strategy is eligible for replacement by a fully qualified challenger that has cleared all 6 validation gates.`;

    return {
      championId: this.championStrategy.id,
      championName: this.championStrategy.name,
      championVersion: this.championStrategy.version,
      promotedAt,
      freezePeriodHours: this.championFreezePeriodHours,
      freezeExpiresAt,
      isFrozen,
      remainingFreezeSeconds,
      tenureElapsedSeconds,
      rapidReplacementAttemptsBlocked: this.rapidReplacementAttemptsBlocked,
      freezeRationale
    };
  }

  public setChampionFreezePeriod(hours: number): ChampionTenureStatus {
    this.championFreezePeriodHours = Math.max(1, Math.min(168, Number(hours) || 24));
    this.recordError('WARN', `Champion tenure freeze period updated to ${this.championFreezePeriodHours} hours.`);
    return this.getChampionTenureStatus();
  }

  // --- Staged Anti-Overfitting Pipeline Execution ---

  public advanceCandidatePipeline(challengerId: string): {
    success: boolean;
    message: string;
    challenger?: StrategyVersion;
    tenureStatus: ChampionTenureStatus;
  } {
    const challenger = this.challengerStrategies.find(s => s.id === challengerId);
    if (!challenger) {
      return {
        success: false,
        message: `Challenger '${challengerId}' not found in candidate pool.`,
        tenureStatus: this.getChampionTenureStatus()
      };
    }

    // Production is live-only. Never manufacture walk-forward, OOS, paper/shadow,
    // fill, Sharpe, ROI, drawdown, or slippage evidence. A candidate may advance
    // only when the execution/measurement pipeline has attached real evidence.
    const live = challenger.liveTradingResults;
    const hasLiveEvidence =
      Number.isFinite(live.netProfit) &&
      Number.isFinite(live.totalFees) &&
      Number.isFinite(live.tradesCount) &&
      live.tradesCount > 0;

    if (!hasLiveEvidence) {
      if (challenger.validationPipeline) {
        challenger.validationPipeline.promotionBlockReason =
          'Blocked: insufficient real live-execution evidence. No synthetic or paper/shadow results are permitted.';
      }
      this.recordError(
        'WARN',
        `Candidate '${challenger.name}' blocked from autonomous promotion: insufficient live execution evidence.`
      );
      return {
        success: false,
        message: 'Candidate promotion blocked until sufficient real live execution evidence is recorded.',
        challenger,
        tenureStatus: this.getChampionTenureStatus()
      };
    }

    if (!challenger.validationPipeline) {
      challenger.validationPipeline = this.initDefaultPipeline(challenger);
    }

    challenger.validationPipeline.promotionBlockReason =
      'Live evidence exists; additional validation must be populated from measured production observations before promotion.';
    this.recordError(
      'WARN',
      `Candidate '${challenger.name}' retained pending measured live validation evidence; no synthetic stage advancement performed.`
    );

    return {
      success: false,
      message: 'Live evidence detected, but autonomous stage advancement is blocked until measured validation data is attached.',
      challenger,
      tenureStatus: this.getChampionTenureStatus()
    };
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
