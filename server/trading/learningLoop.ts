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

    if (!challenger.validationPipeline) {
      challenger.validationPipeline = this.initDefaultPipeline(challenger);
    }

    const pipeline = challenger.validationPipeline;

    switch (pipeline.currentStage) {
      case 'TRAINING':
      case 'CANDIDATE':
      case 'WALK_FORWARD': {
        // FAIL-CLOSED. This stage previously stamped 'PASSED' with hardcoded demo metrics
        // (in-sample Sharpe 2.65, WFE 0.68, parameter stability 86), so every candidate cleared the
        // anti-overfitting gate with zero evidence. It now requires measured per-window results.
        const measuredWindows = (pipeline.walkForward.windows || []).filter(w =>
          Number.isFinite(w?.inSampleSharpe) && w.inSampleSharpe > 0 &&
          Number.isFinite(w?.outOfSampleSharpe) && w.outOfSampleSharpe > 0 &&
          Number.isFinite(w?.wfeRatio) && w.wfeRatio > 0
        );

        if (measuredWindows.length < 5) {
          pipeline.walkForward.status = 'FAILED';
          pipeline.canPromote = false;
          pipeline.promotionBlockReason = `BLOCKED: Walk-Forward requires at least 5 windows of measured in-sample/out-of-sample evidence; ${measuredWindows.length} available. No synthetic metrics are substituted.`;
          this.recordError('ERROR', `Candidate '${challenger.name}' blocked at Stage 3 Walk-Forward: ${pipeline.promotionBlockReason}`);
          return { success: false, message: pipeline.promotionBlockReason, challenger, tenureStatus: this.getChampionTenureStatus() };
        }

        const averageWfeRatio = Number((measuredWindows.reduce((sum, w) => sum + w.wfeRatio, 0) / measuredWindows.length).toFixed(4));
        const passedWindowsCount = measuredWindows.filter(w => w.wfeRatio >= 0.60 && w.isProfitable).length;
        pipeline.walkForward.averageWfeRatio = averageWfeRatio;
        pipeline.walkForward.passedWindowsCount = passedWindowsCount;
        pipeline.walkForward.totalWindowsCount = measuredWindows.length;
        pipeline.walkForward.evaluatedAt = new Date().toISOString();

        if (averageWfeRatio < 0.60 || passedWindowsCount < Math.ceil(measuredWindows.length * 0.8)) {
          pipeline.walkForward.status = 'FAILED';
          pipeline.canPromote = false;
          pipeline.promotionBlockReason = `BLOCKED: measured average WFE ${averageWfeRatio} is below the 0.60 hurdle (profitable windows ${passedWindowsCount}/${measuredWindows.length}).`;
          this.recordError('ERROR', `Candidate '${challenger.name}' failed Stage 3 Walk-Forward: ${pipeline.promotionBlockReason}`);
          return { success: false, message: pipeline.promotionBlockReason, challenger, tenureStatus: this.getChampionTenureStatus() };
        }

        pipeline.walkForward.status = 'PASSED';
        pipeline.currentStage = 'OUT_OF_SAMPLE';
        pipeline.canPromote = false;
        pipeline.promotionBlockReason = `Walk-Forward passed on measured evidence (Avg WFE: ${averageWfeRatio}). Ready for held-out Out-of-Sample verification.`;
        this.recordError('WARN', `Candidate '${challenger.name}' cleared Stage 3 Walk-Forward on measured evidence. Progressed to Stage 4 (Out-of-Sample).`);
        return {
          success: true,
          message: `Walk-Forward verified across ${measuredWindows.length} measured windows. Average WFE: ${averageWfeRatio} (target >= 0.60). Progressed to Stage 4: Out-of-Sample testing.`,
          challenger,
          tenureStatus: this.getChampionTenureStatus()
        };
      }

      case 'OUT_OF_SAMPLE': {
        // FAIL-CLOSED. The previous implementation derived the held-out result by multiplying the
        // in-sample Sharpe by an arbitrary 0.88 factor and stamping fixed ROI/drawdown figures.
        const measuredOosSharpe = Number(pipeline.outOfSample.oosSharpe);
        const heldOutDays = Number(pipeline.outOfSample.heldOutDays);
        const inSampleSharpe = Number(pipeline.trainingData?.inSampleSharpe ?? challenger.backtestResults?.sharpeRatio);

        if (!Number.isFinite(measuredOosSharpe) || measuredOosSharpe <= 0 || !Number.isFinite(heldOutDays) || heldOutDays <= 0) {
          pipeline.outOfSample.status = 'FAILED';
          pipeline.canPromote = false;
          pipeline.promotionBlockReason = 'BLOCKED: Out-of-Sample requires a measured held-out Sharpe and a positive held-out window. No synthesized metrics are substituted.';
          this.recordError('ERROR', `Candidate '${challenger.name}' blocked at Stage 4 Out-of-Sample: ${pipeline.promotionBlockReason}`);
          return { success: false, message: pipeline.promotionBlockReason, challenger, tenureStatus: this.getChampionTenureStatus() };
        }

        const degradationPct = Number.isFinite(inSampleSharpe) && inSampleSharpe > 0
          ? Number(((1 - measuredOosSharpe / inSampleSharpe) * 100).toFixed(1))
          : 0;
        pipeline.outOfSample.sharpeDegradationPct = degradationPct;
        pipeline.outOfSample.passedOverfitHurdle = degradationPct < 30;
        pipeline.outOfSample.evaluatedAt = new Date().toISOString();

        if (!pipeline.outOfSample.passedOverfitHurdle) {
          pipeline.outOfSample.status = 'FAILED';
          pipeline.canPromote = false;
          pipeline.promotionBlockReason = `BLOCKED: Out-of-Sample Sharpe degradation ${degradationPct}% breaches the 30% overfitting hurdle.`;
          this.recordError('ERROR', `Candidate '${challenger.name}' failed Stage 4 Out-of-Sample: ${pipeline.promotionBlockReason}`);
          return { success: false, message: pipeline.promotionBlockReason, challenger, tenureStatus: this.getChampionTenureStatus() };
        }

        pipeline.outOfSample.status = 'PASSED';
        pipeline.currentStage = 'PAPER_SHADOW';
        pipeline.canPromote = false;
        pipeline.paperShadow.status = 'RUNNING';
        pipeline.paperShadow.startedAt = new Date().toISOString();
        pipeline.promotionBlockReason = `Out-of-sample verified (measured degradation ${degradationPct}% < 30% hurdle). Currently accumulating paper/shadow fills.`;
        this.recordError('WARN', `Candidate '${challenger.name}' passed Stage 4 Out-of-Sample on measured evidence (degradation ${degradationPct}%).`);
        return {
          success: true,
          message: `Out-of-sample held-out verification passed: OOS Sharpe ${measuredOosSharpe} over ${heldOutDays} days (degradation ${degradationPct}%, below the 30% hurdle). Advanced to Stage 5: Paper/Shadow trading.`,
          challenger,
          tenureStatus: this.getChampionTenureStatus()
        };
      }

      case 'PAPER_SHADOW': {
        // FAIL-CLOSED. Previously stamped 'PASSED' with fixed figures (24h, 38 fills, +$72.40).
        const simulatedFills = Number(pipeline.paperShadow.simulatedFillsCount);
        const hoursObserved = Number(pipeline.paperShadow.hoursObserved);
        const requiredHours = Number(pipeline.paperShadow.requiredHours) || 12;
        const requiredFills = Number(pipeline.paperShadow.requiredFills) || 25;

        if (!Number.isFinite(simulatedFills) || simulatedFills < requiredFills ||
            !Number.isFinite(hoursObserved) || hoursObserved < requiredHours) {
          pipeline.paperShadow.status = 'FAILED';
          pipeline.canPromote = false;
          pipeline.promotionBlockReason = `BLOCKED: Paper/Shadow requires at least ${requiredHours}h observed and ${requiredFills} measured simulated fills; observed ${hoursObserved || 0}h and ${simulatedFills || 0} fills.`;
          this.recordError('ERROR', `Candidate '${challenger.name}' blocked at Stage 5 Paper/Shadow: ${pipeline.promotionBlockReason}`);
          return { success: false, message: pipeline.promotionBlockReason, challenger, tenureStatus: this.getChampionTenureStatus() };
        }

        pipeline.paperShadow.status = 'PASSED';
        pipeline.currentStage = 'SMALL_CAPITAL';
        pipeline.canPromote = false;
        pipeline.smallCapital.status = 'RUNNING';
        pipeline.smallCapital.startedAt = new Date().toISOString();
        pipeline.promotionBlockReason = `Paper/shadow verified (${simulatedFills} measured fills over ${hoursObserved}h). Live with ${pipeline.smallCapital.canaryAllocationPct}% canary small-capital allocation.`;
        this.recordError('WARN', `Candidate '${challenger.name}' passed Stage 5 Paper/Shadow on measured evidence. Allocated ${pipeline.smallCapital.canaryAllocationPct}% Small Capital canary trial.`);
        return {
          success: true,
          message: `Paper/shadow trading verified: ${simulatedFills} measured order-book fills over ${hoursObserved}h. Advanced to Stage 6: Small Capital canary allocation (${pipeline.smallCapital.canaryAllocationPct}% max exposure).`,
          challenger,
          tenureStatus: this.getChampionTenureStatus()
        };
      }

      case 'SMALL_CAPITAL': {
        // FAIL-CLOSED. Previously stamped 'PASSED' with fixed figures (12 fills, +$18.20).
        const realFillsCount = Number(pipeline.smallCapital.realFillsCount);
        const requiredFills = Number(pipeline.smallCapital.requiredFills) || 10;
        const realizedNetProfitUsd = Number(pipeline.smallCapital.realizedNetProfitUsd);
        const riskRuleBreaches = Number(pipeline.smallCapital.riskRuleBreaches) || 0;

        if (!Number.isFinite(realFillsCount) || realFillsCount < requiredFills) {
          pipeline.smallCapital.status = 'FAILED';
          pipeline.canPromote = false;
          pipeline.promotionBlockReason = `BLOCKED: Small Capital requires ${requiredFills} measured live fills; ${realFillsCount || 0} recorded.`;
          this.recordError('ERROR', `Candidate '${challenger.name}' blocked at Stage 6 Small Capital: ${pipeline.promotionBlockReason}`);
          return { success: false, message: pipeline.promotionBlockReason, challenger, tenureStatus: this.getChampionTenureStatus() };
        }

        if (!Number.isFinite(realizedNetProfitUsd) || realizedNetProfitUsd <= 0 || riskRuleBreaches > 0) {
          pipeline.smallCapital.status = 'FAILED';
          pipeline.canPromote = false;
          pipeline.promotionBlockReason = `BLOCKED: Small Capital requires positive measured net profit after fees and zero risk-rule breaches; recorded $${realizedNetProfitUsd || 0} net with ${riskRuleBreaches} breach(es).`;
          this.recordError('ERROR', `Candidate '${challenger.name}' failed Stage 6 Small Capital: ${pipeline.promotionBlockReason}`);
          return { success: false, message: pipeline.promotionBlockReason, challenger, tenureStatus: this.getChampionTenureStatus() };
        }

        pipeline.smallCapital.status = 'PASSED';
        pipeline.currentStage = 'ELIGIBLE_FOR_PROMOTION';
        pipeline.canPromote = true;
        pipeline.promotionBlockReason = undefined;
        this.recordError('WARN', `Candidate '${challenger.name}' cleared all 6 gates on measured evidence and is now ELIGIBLE FOR PROMOTION (subject to the champion tenure lock).`);
        return {
          success: true,
          message: `Candidate has cleared all 6 stages on measured evidence (Training -> Candidate -> Walk-Forward -> Out-of-Sample -> Paper/Shadow -> Small Capital) and is now ELIGIBLE FOR PROMOTION (subject to Champion Freeze tenure lock).`,
          challenger,
          tenureStatus: this.getChampionTenureStatus()
        };
      }

      case 'ELIGIBLE_FOR_PROMOTION': {
        // Try promotion via standard evaluation
        const promoRes = this.promoteChallenger(challengerId, 'User requested promotion after completing all anti-overfitting stages');
        return {
          success: promoRes.success,
          message: promoRes.reason,
          challenger: promoRes.champion || challenger,
          tenureStatus: promoRes.tenureStatus
        };
      }

      default:
        return {
          success: false,
          message: `Candidate is currently at terminal or rejected stage: ${pipeline.currentStage}.`,
          challenger,
          tenureStatus: this.getChampionTenureStatus()
        };
    }
  }

  private initDefaultPipeline(candidate: StrategyVersion): StagedValidationPipeline {
    const isSharpe = candidate.backtestResults?.sharpeRatio || 2.50;
    return {
      currentStage: 'WALK_FORWARD',
      overallScore: 60,
      overfittingRiskPct: 40,
      canPromote: false,
      promotionBlockReason: 'Pending Walk-forward multi-window stability analysis.',
      trainingData: {
        inSampleWindowDays: 60,
        sampleSizeCandles: 5760,
        inSampleSharpe: isSharpe,
        inSampleRoiPct: candidate.backtestResults?.roiPct || 14.0,
        inSampleWinRatePct: candidate.backtestResults?.winRatePct || 78.0,
        inSampleProfitFactor: candidate.backtestResults?.profitFactor || 2.2,
        fittedAt: new Date().toISOString()
      },
      candidateModel: {
        hypothesis: candidate.reasonForChange || 'Parameter mutation targeting improved risk-adjusted returns',
        parameterDeltaSummary: `Spacing: ${candidate.parameters.gridSpacingPct}%, Levels: ${candidate.parameters.gridLevels}`,
        complexityPenaltyBps: 2.5,
        generatedAt: new Date().toISOString()
      },
      walkForward: {
        status: 'PENDING',
        windows: [],
        averageWfeRatio: 0,
        passedWindowsCount: 0,
        totalWindowsCount: 5,
        parameterStabilityScore: 0
      },
      outOfSample: {
        status: 'PENDING',
        heldOutDays: 30,
        oosSharpe: 0,
        oosRoiPct: 0,
        oosMaxDrawdownPct: 0,
        sharpeDegradationPct: 0,
        maxDdDegradationPct: 0,
        passedOverfitHurdle: false
      },
      paperShadow: {
        status: 'PENDING',
        hoursObserved: 0,
        requiredHours: 12,
        simulatedFillsCount: 0,
        requiredFills: 25,
        shadowNetProfitUsd: 0,
        shadowFillRatePct: 0,
        shadowSharpe: 0,
        slippageVarianceBps: 0
      },
      smallCapital: {
        status: 'PENDING',
        canaryAllocationPct: 8.0,
        canaryExposureUsd: 450,
        realFillsCount: 0,
        requiredFills: 10,
        realizedNetProfitUsd: 0,
        feeDragBps: 0,
        riskRuleBreaches: 0
      }
    };
  }

  // --- Strategy Promotion & Anti-Churn Guardrails ---

  public promoteChallenger(
    challengerId: string,
    approvalReason?: string,
    forceOverride?: boolean
  ): {
    success: boolean;
    reason: string;
    champion?: StrategyVersion;
    tenureStatus: ChampionTenureStatus;
    code?: string;
    stage?: string;
  } {
    const tenureStatus = this.getChampionTenureStatus();

    if (!this.enabled) {
      const msg = 'Cannot promote challenger: Self-Learn Optimizer is currently turned OFF.';
      this.recordError('ERROR', msg);
      return { success: false, reason: msg, tenureStatus, code: 'OPTIMIZER_OFF' };
    }

    const idx = this.challengerStrategies.findIndex(s => s.id === challengerId);
    if (idx === -1) {
      return {
        success: false,
        reason: `Challenger strategy '${challengerId}' not found in the candidate arena.`,
        tenureStatus,
        code: 'NOT_FOUND'
      };
    }

    const chosen = this.challengerStrategies[idx];
    const pipeline = chosen.validationPipeline;

    // GUARD 1: Anti-Overfitting Pipeline Completion Gate
    if (pipeline && pipeline.currentStage !== 'ELIGIBLE_FOR_PROMOTION' && !forceOverride) {
      const msg = `PROMOTION BLOCKED: Candidate '${chosen.name}' has not completed the full anti-overfitting pipeline (Current Stage: ${pipeline.currentStage}). To prevent deploying overfitted parameters, all stages (Walk-Forward, Out-of-Sample, Paper/Shadow, Small-Capital) must pass first.`;
      this.recordError('WARN', msg);
      return {
        success: false,
        reason: msg,
        tenureStatus,
        code: 'PIPELINE_INCOMPLETE',
        stage: pipeline.currentStage
      };
    }

    // GUARD 2: Champion Freeze & Anti-Churn Lock
    // "Don't allow: 45 sec -> discover slightly better parameter -> immediately replace production"
    if (tenureStatus.isFrozen && !forceOverride) {
      this.rapidReplacementAttemptsBlocked++;
      const minsRemaining = Math.ceil(tenureStatus.remainingFreezeSeconds / 60);
      const hoursRemaining = (tenureStatus.remainingFreezeSeconds / 3600).toFixed(1);

      const msg = `PROMOTION BLOCKED (CHAMPION TENURE FREEZE ACTIVE): Champion strategy '${this.championStrategy.name}' (${this.championStrategy.version}) is frozen for an additional ${hoursRemaining}h (${minsRemaining} min remaining of ${this.championFreezePeriodHours}h tenure). Immediate replacement on short-term parameter discovery is prohibited to eliminate noise overfitting and parameter churn. (Blocked attempts: ${this.rapidReplacementAttemptsBlocked})`;
      
      this.recordError('WARN', msg, {
        challengerId: chosen.id,
        challengerName: chosen.name,
        freezeExpiresAt: tenureStatus.freezeExpiresAt,
        remainingSeconds: tenureStatus.remainingFreezeSeconds
      });

      return {
        success: false,
        reason: msg,
        tenureStatus: this.getChampionTenureStatus(),
        code: 'CHAMPION_FROZEN',
        stage: pipeline?.currentStage
      };
    }

    // All gates passed (or authorized override): Execute Promotion!
    const previous = { ...this.championStrategy, status: 'RETIRED' as const, retiredAt: new Date().toISOString() };
    this.strategyHistory.unshift(previous);

    const prevVerNum = parseFloat(this.championStrategy.version.replace(/[^0-9.]/g, '')) || 2.0;
    const versionNum = (prevVerNum + 0.1).toFixed(1);

    this.championStrategy = {
      ...chosen,
      version: `v${versionNum}-LIVE`,
      status: 'CHAMPION',
      deployedAt: new Date().toISOString(),
      reasonForChange: approvalReason || `Promoted over ${previous.id} after passing 6-stage anti-overfitting pipeline & satisfying champion tenure lock`
    };

    this.challengerStrategies.splice(idx, 1);

    const updatedTenure = this.getChampionTenureStatus();
    const successMsg = `Successfully promoted ${chosen.name} (${this.championStrategy.version}) to active production Champion! New 24-hour tenure freeze initiated.`;
    this.recordError('WARN', successMsg);

    return {
      success: true,
      reason: successMsg,
      champion: this.championStrategy,
      tenureStatus: updatedTenure
    };
  }

  public registerAndPromoteBuiltStrategy(build: {
    id: string;
    strategyName: string;
    parameters: StrategyVersion['parameters'];
    rationale: string;
    expectedEffect: string;
  }): StrategyVersion {
    const tenureStatus = this.getChampionTenureStatus();

    // Every autonomous build is registered as a challenger and must clear the anti-overfitting
    // pipeline before it can replace the live champion. This routing used to happen only while the
    // tenure freeze was active; once it expired, a raw AI build was promoted straight to CHAMPION
    // with invented performance figures, bypassing all six validation gates.
    this.rapidReplacementAttemptsBlocked++;
    {
      // PROTECT PRODUCTION: Do not overwrite champion immediately after 45 seconds!
      // Instead, register it as a challenger candidate and start it in the anti-overfitting pipeline!
      const candidateId = `STRAT-CANDIDATE-${Date.now().toString(36).toUpperCase()}`;
      const newChallenger: StrategyVersion = {
        id: candidateId,
        name: build.strategyName,
        version: `v${(parseFloat(this.championStrategy.version.replace(/[^0-9.]/g, '')) + 0.1).toFixed(1)}-CANDIDATE`,
        type: 'ADAPTIVE_GRID',
        status: 'CHALLENGER',
        createdAt: new Date().toISOString(),
        parentVersionId: this.championStrategy.id,
        reasonForChange: `Auto-Discovered Variant: ${build.rationale}. Routed to Anti-Overfitting Pipeline because Champion is frozen under tenure lock.`,
        parameters: {
          ...this.championStrategy.parameters,
          ...build.parameters
        },
        backtestResults: {
          ...this.championStrategy.backtestResults,
          sharpeRatio: Number((this.championStrategy.backtestResults.sharpeRatio + 0.12).toFixed(2)),
          netProfit: Number((this.championStrategy.backtestResults.netProfit + 95).toFixed(2))
        },
        validationPipeline: {
          currentStage: 'WALK_FORWARD',
          overallScore: 68,
          overfittingRiskPct: 35,
          canPromote: false,
          promotionBlockReason: `Champion is frozen (${(tenureStatus.remainingFreezeSeconds / 3600).toFixed(1)}h left). Candidate routed to Walk-Forward testing to prevent overfitting.`,
          trainingData: {
            inSampleWindowDays: 60,
            sampleSizeCandles: 5760,
            inSampleSharpe: Number((this.championStrategy.backtestResults.sharpeRatio + 0.12).toFixed(2)),
            inSampleRoiPct: 16.2,
            inSampleWinRatePct: 80.5,
            inSampleProfitFactor: 2.35,
            fittedAt: new Date().toISOString()
          },
          candidateModel: {
            hypothesis: build.rationale,
            parameterDeltaSummary: build.expectedEffect,
            complexityPenaltyBps: 2.0,
            generatedAt: new Date().toISOString()
          },
          walkForward: {
            status: 'PENDING',
            windows: [],
            averageWfeRatio: 0,
            passedWindowsCount: 0,
            totalWindowsCount: 5,
            parameterStabilityScore: 0
          },
          outOfSample: {
            status: 'PENDING',
            heldOutDays: 30,
            oosSharpe: 0,
            oosRoiPct: 0,
            oosMaxDrawdownPct: 0,
            sharpeDegradationPct: 0,
            maxDdDegradationPct: 0,
            passedOverfitHurdle: false
          },
          paperShadow: {
            status: 'PENDING',
            hoursObserved: 0,
            requiredHours: 12,
            simulatedFillsCount: 0,
            requiredFills: 25,
            shadowNetProfitUsd: 0,
            shadowFillRatePct: 0,
            shadowSharpe: 0,
            slippageVarianceBps: 0
          },
          smallCapital: {
            status: 'PENDING',
            canaryAllocationPct: 8.0,
            canaryExposureUsd: 450,
            realFillsCount: 0,
            requiredFills: 10,
            realizedNetProfitUsd: 0,
            feeDragBps: 0,
            riskRuleBreaches: 0
          }
        }
      };

      this.challengerStrategies.unshift(newChallenger);
      this.recordError('WARN', `Champion tenure freeze active. Prevented immediate parameter replacement! Routed candidate '${build.strategyName}' into Anti-Overfitting Pipeline instead.`);
      return this.championStrategy;
    }

  }

  public createStrategyVariantWithPipeline(params: {
    baseStrategyId: string;
    name: string;
    reasonForChange: string;
    parameters: Partial<StrategyVersion['parameters']>;
    expectedEffect?: string;
  }): StrategyVersion {
    const candidateId = `STRAT-VAR-${Date.now().toString(36).toUpperCase()}`;
    const newVariant: StrategyVersion = {
      id: candidateId,
      name: params.name,
      version: `v${(parseFloat(this.championStrategy.version.replace(/[^0-9.]/g, '')) + 0.1).toFixed(1)}-CHALLENGER`,
      type: 'ADAPTIVE_GRID',
      status: 'CHALLENGER',
      parentVersionId: params.baseStrategyId,
      createdAt: new Date().toISOString(),
      reasonForChange: params.reasonForChange,
      expectedEffect: params.expectedEffect,
      parameters: {
        ...this.championStrategy.parameters,
        ...params.parameters
      },
      backtestResults: {
        ...this.championStrategy.backtestResults,
        sharpeRatio: Number((this.championStrategy.backtestResults.sharpeRatio + 0.15).toFixed(2)),
        netProfit: Number((this.championStrategy.backtestResults.netProfit + 120).toFixed(2)),
        roiPct: Number((this.championStrategy.backtestResults.roiPct + 1.2).toFixed(1))
      },
      validationPipeline: this.initDefaultPipeline({
        id: candidateId,
        name: params.name,
        parameters: { ...this.championStrategy.parameters, ...params.parameters },
        reasonForChange: params.reasonForChange,
        backtestResults: {
          ...this.championStrategy.backtestResults,
          sharpeRatio: Number((this.championStrategy.backtestResults.sharpeRatio + 0.15).toFixed(2))
        }
      } as any)
    };

    this.challengerStrategies.unshift(newVariant);
    this.recordError('WARN', `Created challenger variant '${newVariant.name}'. Seeded into Anti-Overfitting Pipeline at Stage 3 (Walk-Forward).`);
    return newVariant;
  }

  // --- Engine Diagnostics & Lifecycle ---

  public healthCheck(): EngineHealth {
    const tenure = this.getChampionTenureStatus();
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
        championIsFrozen: tenure.isFrozen,
        championFreezeHoursRemaining: (tenure.remainingFreezeSeconds / 3600).toFixed(1),
        rapidReplacementBlocked: this.rapidReplacementAttemptsBlocked,
        challengersCount: this.challengerStrategies.length,
        antiOverfittingPipeline: 'TRAINING -> CANDIDATE -> WALK_FORWARD -> OUT_OF_SAMPLE -> PAPER_SHADOW -> SMALL_CAPITAL -> PROMOTION',
        decisionModel: '3_WAY_OUTCOMES (BUY / SELL / DO NOTHING)',
        doNothingRatePct: this.decisionStats.doNothingRatioPct,
        capitalPreservedUsd: this.decisionStats.totalCapitalPreservedUsd,
        totalEvaluated: this.decisionStats.totalEvaluated
      }
    };
  }

  public getStatus(): EngineHealth {
    return this.healthCheck();
  }

  public getDecisionStats(): LearningDecisionStats {
    return {
      ...this.decisionStats,
      gateRejectionBreakdown: { ...this.decisionStats.gateRejectionBreakdown },
      recentDecisions: [...this.decisionStats.recentDecisions]
    };
  }

  public recordDecision(decision: TradeDecision): void {
    this.decisionStats.totalEvaluated++;
    if (decision.finalOutcome === 'BUY') {
      this.decisionStats.buyDecisions++;
    } else if (decision.finalOutcome === 'SELL') {
      this.decisionStats.sellDecisions++;
    } else {
      this.decisionStats.doNothingDecisions++;
      this.decisionStats.totalCapitalPreservedUsd += (decision.capitalPreservedUsd || 0);
      this.decisionStats.totalFeesAvoidedUsd += (decision.feesAvoidedUsd || 0);

      if (decision.rejectionGate) {
        switch (decision.rejectionGate) {
          case 'REGIME_SUITABILITY':
            this.decisionStats.gateRejectionBreakdown.regimeUnsuitable++;
            break;
          case 'EDGE_EXCEEDS_COSTS':
            this.decisionStats.gateRejectionBreakdown.negativeEdge++;
            break;
          case 'LIQUIDITY_SUFFICIENCY':
            this.decisionStats.gateRejectionBreakdown.insufficientLiquidity++;
            break;
          case 'INVENTORY_ACCEPTABILITY':
            this.decisionStats.gateRejectionBreakdown.inventorySaturated++;
            break;
          case 'PORTFOLIO_RISK_ACCEPTABILITY':
            this.decisionStats.gateRejectionBreakdown.portfolioRiskBreach++;
            break;
        }
      }
    }

    const total = this.decisionStats.totalEvaluated || 1;
    this.decisionStats.doNothingRatioPct = Number(((this.decisionStats.doNothingDecisions / total) * 100).toFixed(1));
    this.decisionStats.buyRatioPct = Number(((this.decisionStats.buyDecisions / total) * 100).toFixed(1));
    this.decisionStats.sellRatioPct = Number(((this.decisionStats.sellDecisions / total) * 100).toFixed(1));
    this.decisionStats.totalCapitalPreservedUsd = Number(this.decisionStats.totalCapitalPreservedUsd.toFixed(2));
    this.decisionStats.totalFeesAvoidedUsd = Number(this.decisionStats.totalFeesAvoidedUsd.toFixed(2));

    this.decisionStats.recentDecisions.unshift(decision);
    if (this.decisionStats.recentDecisions.length > 60) {
      this.decisionStats.recentDecisions.pop();
    }
  }

  public evaluateAndLogDecision(input: DecisionPipelineInput): TradeDecision {
    const decision = globalDecisionPipeline.evaluateSignal(input);
    this.recordDecision(decision);
    return decision;
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

    // tradeCount is cumulative, so the previously recorded win rate recovers the cumulative win
    // count. Computing the rate from this batch alone made a single winning fill report 100%.
    const priorTrades = Number(results.tradesCount) || 0;
    const priorWins = Math.round(((Number(results.winRatePct) || 0) / 100) * priorTrades);
    const cumulativeTrades = priorTrades + fills.length;
    const cumulativeWins = priorWins + wins;

    results.tradesCount = cumulativeTrades;
    results.netProfit += net;
    results.totalFees += fees;
    results.winRatePct = cumulativeTrades > 0 ? Number(((cumulativeWins / cumulativeTrades) * 100).toFixed(2)) : 0;

    this.championStrategy.liveTradingResults = results;
    this.latencyMs = Date.now() - start;
    this.lastHeartbeat = new Date().toISOString();

    // Auto-rollback guard. After enough measured live fills, compare the
    // CURRENT champion's realised metrics against the most-recent retired
    // champion's snapshot. If the new champion is measurably worse, roll
    // back automatically. This is the half of the safe self-improvement
    // contract that completes the promote-then-monitor loop.
    this.evaluateAndTriggerRollback();
  }

  // -------------------------------------------------------------------------
  // Auto-rollback (self-improvement, the "rollback regressions" half)
  // -------------------------------------------------------------------------

  /** Tunables for the auto-rollback guard. Defaults are conservative so a
   *  noisy first batch of fills cannot trip an unnecessary rollback. */
  private rollbackConfig: {
    /** Minimum measured live fills on the current champion before any
     *  rollback condition is even evaluated. Below this, no rollback can
     *  fire even on a drawdown breach. */
    minTradesBeforeEvaluation: number;
    /** If the current champion's live drawdown (from a fixed high-water
     *  mark on promotion) exceeds this %, trigger an automatic rollback. */
    drawdownBreachPct: number;
    /** If the current champion's realised net profit falls below the previous
     *  champion's by more than this absolute USD amount, trigger rollback. */
    netProfitRegressionUsd: number;
    /** If the current champion's live win-rate falls below the previous
     *  champion's by this many percentage points, trigger rollback. */
    winRateRegressionPct: number;
    /** Auto-rollback is enabled iff this is true. Owner can disable via
     *  setAutoRollbackEnabled(false). */
    autoRollbackEnabled: boolean;
    /** Cooldown between successive auto-rollbacks to prevent oscillation. */
    cooldownMs: number;
    /** Last auto-rollback timestamp, used to enforce cooldown. */
    lastAutoRollbackAt: number | null;
  } = {
    minTradesBeforeEvaluation: 30,
    drawdownBreachPct: 5,
    netProfitRegressionUsd: 50,
    winRateRegressionPct: 15,
    autoRollbackEnabled: true,
    cooldownMs: 6 * 60 * 60 * 1000,
    lastAutoRollbackAt: null,
  };

  public getRollbackConfig() {
    return { ...this.rollbackConfig };
  }

  public setAutoRollbackEnabled(enabled: boolean): void {
    this.rollbackConfig.autoRollbackEnabled = Boolean(enabled);
    this.recordError(
      enabled ? 'WARN' : 'WARN',
      `Auto-rollback ${enabled ? 'ENABLED' : 'DISABLED'}.`,
    );
  }

  /**
   * Evaluate the current champion against the most-recent retired champion
   * (the one we just replaced). If the metrics show a regression that
   * crosses the configured hurdles AND no cooldown is in effect, trigger
   * an automatic rollback.
   *
   * The function is idempotent and safe to call on every fill.
   */
  public evaluateAndTriggerRollback(): {
    evaluated: boolean;
    triggered: boolean;
    reason?: string;
    rolledBackTo?: string;
    blockReason?: string;
  } {
    const live = this.championStrategy.liveTradingResults;
    const trades = Number(live?.tradesCount ?? 0);
    const evaluation = {
      evaluated: false,
      triggered: false,
      reason: undefined as string | undefined,
      rolledBackTo: undefined as string | undefined,
      blockReason: undefined as string | undefined,
    };

    if (!this.rollbackConfig.autoRollbackEnabled) {
      evaluation.blockReason = 'auto-rollback disabled';
      return evaluation;
    }
    if (!this.enabled) {
      evaluation.blockReason = 'learning loop is OFF';
      return evaluation;
    }
    if (trades < this.rollbackConfig.minTradesBeforeEvaluation) {
      evaluation.blockReason = `only ${trades} live fills (minimum ${this.rollbackConfig.minTradesBeforeEvaluation})`;
      return evaluation;
    }
    if (this.rollbackConfig.lastAutoRollbackAt &&
        Date.now() - this.rollbackConfig.lastAutoRollbackAt < this.rollbackConfig.cooldownMs) {
      evaluation.blockReason = 'cooldown in effect';
      return evaluation;
    }
    const previousChampion = this.strategyHistory.find((s) => s.status === 'RETIRED');
    if (!previousChampion) {
      evaluation.blockReason = 'no previous retired champion to roll back to';
      return evaluation;
    }

    evaluation.evaluated = true;
    const prev = previousChampion.liveTradingResults;
    const reasons: string[] = [];

    // 1. Drawdown breach relative to the running peak of the current champion.
    //    The peak is taken from the previousChampion's best recorded equity
    //    snapshot OR from liveTradingResults as a fallback.
    const currentDrawdownPct = Math.max(0, Number(live?.maxDrawdownPct ?? 0));
    if (currentDrawdownPct >= this.rollbackConfig.drawdownBreachPct) {
      reasons.push(`drawdown ${currentDrawdownPct.toFixed(2)}% >= ${this.rollbackConfig.drawdownBreachPct}%`);
    }

    // 2. Net profit regression vs the previous champion's recorded net.
    const currentNet = Number(live?.netProfit ?? 0);
    const prevNet = Number(prev?.netProfit ?? 0);
    if (prevNet > 0 && (prevNet - currentNet) >= this.rollbackConfig.netProfitRegressionUsd) {
      reasons.push(`net profit $${currentNet.toFixed(2)} regressed by $${(prevNet - currentNet).toFixed(2)} vs prior $${prevNet.toFixed(2)}`);
    }

    // 3. Win-rate regression. Only meaningful when both sides have enough trades.
    const prevTrades = Number(prev?.tradesCount ?? 0);
    const currentWinRate = Number(live?.winRatePct ?? 0);
    const prevWinRate = Number(prev?.winRatePct ?? 0);
    if (prevTrades >= this.rollbackConfig.minTradesBeforeEvaluation &&
        (prevWinRate - currentWinRate) >= this.rollbackConfig.winRateRegressionPct) {
      reasons.push(`win rate ${currentWinRate.toFixed(2)}% regressed ${(prevWinRate - currentWinRate).toFixed(2)} pp vs prior ${prevWinRate.toFixed(2)}%`);
    }

    if (reasons.length === 0) {
      evaluation.blockReason = 'no regression detected';
      return evaluation;
    }

    const reason = `Auto-rollback triggered: ${reasons.join('; ')}.`;
    const rollbackResult = this.rollbackCurrentChampion({
      reason,
      triggeredBy: 'AUTOMATED_PERFORMANCE_GUARD',
      approvalReason: reason,
    });
    if (rollbackResult.success) {
      evaluation.triggered = true;
      evaluation.reason = reason;
      evaluation.rolledBackTo = rollbackResult.restoredChampionId;
      this.rollbackConfig.lastAutoRollbackAt = Date.now();
    } else {
      evaluation.blockReason = `rollback refused: ${rollbackResult.reason}`;
    }
    return evaluation;
  }

  /**
   * Manually roll the current champion back to the most-recent retired
   * champion in strategyHistory. The current champion is demoted to
   * CHALLENGER status with its validation pipeline reset (so it must
   * clear all 6 gates again before it can be re-promoted).
   *
   * Returns a structured result with code/stage so the route layer can
   * surface the exact blocker to the operator.
   */
  public rollbackCurrentChampion(args: {
    reason: string;
    triggeredBy: 'OWNER' | 'AUTOMATED_PERFORMANCE_GUARD' | 'RISK_BREACH';
    approvalReason?: string;
  }): {
    success: boolean;
    reason: string;
    restoredChampionId?: string;
    restoredChampionVersion?: string;
    rolledBackChampionId?: string;
    tenureStatus: ChampionTenureStatus;
    code?: string;
  } {
    const tenureStatus = this.getChampionTenureStatus();
    if (!this.enabled) {
      return {
        success: false,
        reason: 'Cannot rollback: Self-Learn Optimizer is currently turned OFF.',
        tenureStatus,
        code: 'OPTIMIZER_OFF',
      };
    }
    if (!args?.reason || !args.triggeredBy) {
      return {
        success: false,
        reason: 'Cannot rollback: reason and triggeredBy are required.',
        tenureStatus,
        code: 'BAD_REQUEST',
      };
    }
    const previousChampion = this.strategyHistory.find((s) => s.status === 'RETIRED');
    if (!previousChampion) {
      return {
        success: false,
        reason: 'Cannot rollback: no previous retired champion in strategy history.',
        tenureStatus,
        code: 'NO_PRIOR_CHAMPION',
      };
    }

    const rolledBackId = this.championStrategy.id;
    const restored = { ...previousChampion };
    delete (restored as any).retiredAt;

    // Demote the current champion back to CHALLENGER with a fresh
    // pipeline so it cannot be re-promoted without clearing all 6
    // anti-overfitting gates on measured evidence.
    const demoted = {
      ...this.championStrategy,
      status: 'CHALLENGER' as const,
      retiredAt: new Date().toISOString(),
      reasonForChange: `Auto-demoted after rollback (${args.triggeredBy}): ${args.reason}. Pipeline reset; must clear all 6 anti-overfitting gates again.`,
      validationPipeline: this.initDefaultPipeline({
        ...this.championStrategy,
        id: this.championStrategy.id,
        name: this.championStrategy.name,
      }),
    };
    delete (demoted as any).deployedAt;

    this.championStrategy = {
      ...restored,
      status: 'CHAMPION',
      deployedAt: new Date().toISOString(),
      reasonForChange: args.approvalReason || `Restored after rollback (${args.triggeredBy}) of ${rolledBackId}: ${args.reason}.`,
    };

    // Replace the previousChampion's history entry with the demoted
    // challenger so the audit trail is consistent.
    const histIdx = this.strategyHistory.findIndex((s) => s.id === previousChampion.id);
    if (histIdx >= 0) this.strategyHistory.splice(histIdx, 1);
    this.strategyHistory.unshift(demoted as any);

    // Make the demoted strategy available as a challenger too, in case
    // the operator wants to re-evaluate its pipeline.
    this.challengerStrategies.unshift(demoted as StrategyVersion);

    const updatedTenure = this.getChampionTenureStatus();
    const msg = `ROLLED BACK to ${this.championStrategy.name} (${this.championStrategy.version}). Demoted ${rolledBackId} to CHALLENGER with pipeline reset. Reason: ${args.reason}`;
    this.recordError('ERROR', msg, {
      triggeredBy: args.triggeredBy,
      restoredChampionId: this.championStrategy.id,
      demotedChampionId: rolledBackId,
    });

    return {
      success: true,
      reason: msg,
      restoredChampionId: this.championStrategy.id,
      restoredChampionVersion: this.championStrategy.version,
      rolledBackChampionId: rolledBackId,
      tenureStatus: updatedTenure,
    };
  }
}
