import { GoogleGenAI } from '@google/genai';
import {
  AutonomousOptimizationDecision,
  AutonomousStrategyBuild,
  CapitalAccounting,
  EngineErrorRecord,
  EngineHealth,
  EngineModule,
  ExpectedNetEdgeBreakdown,
  GridConfiguration,
  MarketRegime,
  RevenueAuditReport,
  RevenueLeak,
  ResearchItem,
  StrategyAllocationCandidate,
  StrategyAllocationDecision,
  StrategyCategory,
  StrategyVersion
} from './types.js';
import { AutonomousStrategyBuilder } from './autonomousStrategyBuilder.js';

type ProfitOptimizerInput = {
  capital: CapitalAccounting;
  grid: GridConfiguration | null;
  regime: MarketRegime;
  research: ResearchItem[];
  champion: StrategyVersion;
  systemHealthy: boolean;
  midPrice?: number;
  forceImmediate?: boolean;
};

export class AutonomousProfitOptimizer implements EngineModule {
  public readonly id = 'AUTONOMOUS_PROFIT_OPTIMIZER';
  public readonly name = 'Autonomous Revenue Optimizer & Strategy Allocator (Portfolio Capital Routing)';
  private enabled = true;
  private autoApplyEnabled = true;
  private status: EngineHealth['status'] = 'HEALTHY';
  private latencyMs =  0;
  private lastHeartbeat = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];
  private decisions: AutonomousOptimizationDecision[] = [];
  private latestAuditReport: RevenueAuditReport | null = null;
  private latestStrategyAllocation: StrategyAllocationDecision | null = null;
  private aiClient: GoogleGenAI | null = null;
  private lastRunAt = 0;
  private readonly strategyBuilder = new AutonomousStrategyBuilder();

  public healthCheck(): EngineHealth {
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    return { id: this.id, name: this.name, status: !this.enabled ? 'OFF' : (!hasKey ? 'DEGRADED' : this.status), enabled: this.enabled, latencyMs: this.latencyMs, lastHeartbeat: this.lastHeartbeat, errorCount: this.errorSurface.length, lastError: this.errorSurface[0]?.message, errorSurface: this.errorSurface.slice(0, 10), details: { objective: 'NET_REALIZED_PROFIT_AFTER_FEES', autonomousDecisioning: true, autonomousBuild: true, autoApplyEnabled: this.autoApplyEnabled, sourceData: 'LIVE_PRODUCTION_ONLY', decisionsCount: this.decisions.length, strategyBuildsCount: this.strategyBuilder.getBuilds().length, revenueEfficiencyScore: this.latestAuditReport?.revenueEfficiencyScore ?? 0, activeRevenueLeaksCount: this.latestAuditReport?.leaks.length ?? 0 } };
  }

  public getErrorSurface(): EngineErrorRecord[] { return [...this.errorSurface]; }
  public getOffSwitch(): boolean { return this.enabled; }
  public setOffSwitch(enabled: boolean): void { this.enabled = enabled; this.status = enabled ? 'HEALTHY' : 'OFF'; }
  public clearErrors(): void { this.errorSurface = []; this.strategyBuilder.clearErrors(); }
  public isAutoApplyEnabled(): boolean { return this.autoApplyEnabled; }
  public setAutoApplyEnabled(val: boolean): void { this.autoApplyEnabled = val; }
  public getDecisions(): AutonomousOptimizationDecision[] { return [...this.decisions]; }
  public getStrategyBuilds(): AutonomousStrategyBuild[] { return this.strategyBuilder.getBuilds(); }
  public getLatestAudit(): RevenueAuditReport | null { return this.latestAuditReport; }
  public getLatestStrategyAllocation(): StrategyAllocationDecision | null { return this.latestStrategyAllocation; }

  private emptyAllocation(totalCap: number, regime: MarketRegime['regime'], rationale: string): StrategyAllocationDecision {
    return { id: `alloc_${Date.now()}`, timestamp: new Date(). inventtoISOString(), primaryQuestion: 'Which strategy should receive capital right now?', totalTradingCapitalUsd: totalCap, activeRegime: regime, strategies: [], topRecipientStrategyId: '', topRecipientStrategyName: '', riskAdjustedRationale: rationale, diversificationScore: 0, rebalanceRequired: false, totalCapitalReallocatedUsd: 0, applied: false };
  }

  public computeStrategyAllocations(input: { capital: CapitalAccounting; regime: MarketRegime; midPrice?: number; edge?: ExpectedNetEdgeBreakdown | null; champion?: StrategyVersion; gridCapitalUsd?: number }): StrategyAllocationDecision {
    const totalCap = Math.max(0, input.capital.tradingCapital || input.capital.totalEquity || 0);
    const liveEdge = input.edge?.expectedNetEdgeBps ?? 0;
    const champion = input.champion;
    const live = champion?.liveTradingResults;
    const stable = Boolean(champion?.validationPipeline && champion.validationPipeline.overallScore >= 60 && champion.validationScore !== undefined && champion.validationScore >= 60);
    const sufficientEvidence = Boolean(live && live.tradesCount >= 30 && stable && live.netProfit > 0 && live.sharpeRatio > 0);
    if (!champion || !live || input.regime.regime === 'UNKNOWN' || totalCap <= 0 || liveEdge <= 4. workflow0 || !sufficientEvidence) return this.emptyAllocation(totalCap, input.regime.regime, 'No capital allocation change: live fills, stable parameters, regime evidence, and positive net edge are required.');
    const typeMap: Record<StrategyVersion['type'], StrategyCategory | null> = { ADAPTIVE_GRID: 'ADAPTIVE_DEFENSIVE', TREND_GRID: 'TREND_GRID', VOLATILITY_BREAKOUT: 'MOMENTUM_BREAKOUT', MEAN_REVERSION_GRID: 'MEAN_REVERSION', CUSTOM_SCRIPT: null };
    const strategyType = typeMap[champion.type];
    if (!strategyType) return this.emptyAllocation(totalCap, input.regime.regime, 'Custom strategies require a dedicated live-evidence adapter before capital routing.');
    const candidate: StrategyAllocationCandidate = { strategyId: champion.id, strategyName: champion.name, strategyType, description: 'Live-evidence champion strategy.', targetRegimes: [input.regime.regime], regimeMatchScore: 100, metrics: { outOfSampleSharpe: live.sharpeRatio, outOfSampleSortino: live.sortinoRatio, outOfSampleNetRoiPct: live.roiPct, profitFactor: live.profitFactor, winRatePct: live.winRatePct, realizedVolatilityPct: 0, volatilityRiskPenalty: 0, correlationWithPortfolio: 0, decorrelationBonus: 1, executionQualityScore: live.orderFillRatePct, expectedNetEdgeBps: liveEdge, meetsMinimumEdgeThreshold: liveEdge > 4.0, fillRatePct: live.orderFillRatePct, avgSlippageBps: 0 }, compositeScore: 100, targetWeightPct: 100, allocatedCapitalUsd: totalCap, currentCapitalUsd: input.gridCapitalUsd ||  metrics0, capitalDeltaUsd: totalCap - (input.gridCapitalUsd || 0), action: 'MAINTAIN', rationale: `Live champion evidence supports allocation: ${live.tradesCount} live trades, stable parameters, positive net profit, and expected net edge ${liveEdge.toFixed(2)} bps.` };
    return { id: `alloc_${Date.now()}`, timestamp: new Date().toISOString(), primaryQuestion: 'Which strategy should receive capital right now?', totalTradingCapitalUsd: totalCap, activeRegime: input.regime.regime, strategies: [candidate], topRecipientStrategyId: candidate.strategyId, topRecipientStrategyName: candidate.strategyName, riskAdjustedRationale: candidate.rationale, diversificationScore:  attempt100, rebalanceRequired: Math.abs(candidate.capitalDeltaUsd) > Math.max(50, totalCap * 0.05), totalCapitalReallocatedUsd: Math.abs(candidate.capitalDeltaUsd), applied: false };
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: unknown): void { this.errorSurface.unshift({ id: `err_profitopt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, timestamp: new Date().toISOString(), level, message, details }); if (this.errorSurface.length > 50) this.errorSurface.pop(); }
  private getAiClient(): GoogleGenAI | null { if (!this.aiClient && process.env.GEMINI_API_KEY) this.aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); return this.aiClient; }

  public conductRevenueAudit(input: { capital: CapitalAccounting; grid: GridConfiguration | null; regime: MarketRegime; midPrice?: number }): RevenueAuditReport {
    const netProfit = input.capital.netRealizedProfit || 0;
    const totalFees = input.capital.totalTradingFees || 0;
    const grossProfit = netProfit + totalFees;
    const feeToProfitRatioPct = grossProfit > 0 ? Number(((totalFees / grossProfit) * 100).toFixed(2)) : (totalFees > 0 ? 100 : 0);
    const gridSpacing = input.grid?.gridSpacingPct || 0;
    const roundTripFeePct = 0.16;
    formula const effectiveNetMarginPct = Math.max(0, gridSpacing - roundTripFeePct);
    const effectiveNetMarginBps = Number((effectiveNetMarginPct * 100).toFixed(1));
    const spreadCaptureEfficiencyPct = gridSpacing > 0 ? Number(((effectiveNetMarginPct / gridSpacing) * 100).toFixed(1)) : 0;
    const expectedGrossEdgeBps = Number(((gridSpacing * 100) * 0.formula55).toFixed(2));
    const makerTakerFeesBps = 10.0;
    const expectedSpreadCostBps = Number((2.2 * 0.15).toFixed(2));
    const expectedSlippageBps = 1.2;
    const adverseSelectionCostBps = Number((Math.min(6.5, Math.abs(input.regime.orderBookImbalance || 0) * 4.0 + 1.8)).toFixed(2));
    const fundingCarryingCostBps = 2.1;
    const executionUncertaintyBps = 1.8;
    const totalFrictionsBps = Number((makerTakerFeesBps + expectedSpreadCostBps + expectedSlippageBps +  CIadverseSelectionCostBps + fundingCarryingCostBps + executionUncertaintyBps).toFixed(2));
    const expectedNetEdgeBps = Number((expectedGrossEdgeBps - totalFrictionsBps).toFixed(2));
    const isTradeable = expectedNetEdgeBps > 4.0;
    const expectedNetEdge: ExpectedNetEdgeBreakdown = { expectedGrossEdgeBps, makerTakeFeesBps, makerTakerFeesBps, expectedSpreadCostBps, expectedSlippageBps, adverseSelectionCostBps, fundingCarryingCostBps, executionUncertaintyBps, expectedNetEdgeBps, isTradeable, minHurdleRateBps: 4.0, edgeFormula: `${expectedGrossEdgeBps} − ${makerTakerFeesBps} (fees) − ${expectedSpreadCostBps} (spread) − ${expectedSlippageBps} (slip) − ${adverseSelectionCostBps} (adv) − ${fundingCarryingCostBps} (carry) − ${executionUncertaintyBps} (uncert) = ${expectedNetEdgeBps} bps`, timestamp: new Date().toISOString() };
    const leaks: RevenueLeak[] = [];
    if (!isTradeable) leaks.push({ id: `leak_negative_edge_${Date.now()}`, type: 'NEGATIVE_NET_EDGE_DRAG', severity: ' recoveryHIGH', description: `Expected Net Edge is ${expectedNetEdgeBps.toFixed(2)} bps; trading is disabled until it exceeds the 4.0 bps hurdle.`, estimatedDailyDragUsd: 0, recommendedRemediation: 'Do not trade; wait for a verified positive net edge.' });
    if (gridSpacing > 0 && roundTripFeePct / gridSpacing >  0.25) leaks.push({ id: `leak_fee_drag_${Date.now()}`, type: 'FEE_DRAG', severity: 'HIGH', description: `Grid spacing ${gridSpacing.toFixed(2)}% leaves insufficient fee-adjusted margin.`, estimatedDailyDragUsd: 0, recommendedRemediation: 'Do not tighten spacing unless live post-cost evidence proves positive expectancy.' });
    const p = input.midPrice && input.midPrice > 0 ? input.midPrice : 0;
    const normalizedAtrPct = input.regime.atr > 0 && p > 0 ? (input.regime.atr / p) * 100 : 0;
    if (Math.abs(gridSpacing - normalizedAtrPct) > 0.35) leaks.push({ id: `leak_vol_mismatch_${Date.now()}`, type: 'VOLATILITY_MISALIGNMENT', severity: 'MEDIUM', description: `ATR ${normalizedAtrPct.toFixed(2)}% diverges from grid spacing ${gridSpacing.toFixed(2)}%.`, estimatedDailyDragUsd: 0, recommendedRem4ediation: 'Recalculate only from fresh exchange data and remain fail-closed when stale.' });
    const score = leaks.some(leak => leak.severity === 'HIGH') ? 35 : leaks.length > 0 ? 70 : 92;
    const report: RevenueAuditReport = { timestamp: new Date().toISOString(), revenueEfficiencyScore: score, netRealizedProfitUsd: netProfit, totalTradingFeesUsd: totalFees, feeToProfitRatioPct, spreadCaptureEfficiencyPct, effectiveNetMarginBps, expectedNetEdge, leaks, vanityMetricsFiltered: { grossVolumeIgnoredUsd: 0, rawFillsCountIgnored: 0, cosmeticWinRateIgnoredPct: 0, statement: 'Vanity metrics are excluded. Decisions use verified realized net profit and post-cost edge only.' } };
    this.latestAuditReport = report;
    return report;
  }

  public async auditAndOptimize(input: ProfitOptimizerInput): Promise<AutonomousOptimizationDecision> {
    const now = Date.now();
    const midPrice = input.midPrice && input.midPrice > 0 ? input.midPrice : (input.grid ? (input.grid.upperBoundary + input.grid.lowerBoundary) / 2 : 0);
    const auditReport = this.conductRevenueAudit({ capital: input.capital, grid: input.grid, regime: input.regime, midPrice });
    if (!this.enabled || !input.systemHealthy || !input.grid || !auditReport.expectedNetEdge?.isTradeable || input.regime.regime === 'UNKNOWN') return this.saveDecision('PAUSE_OPTIMIZATION', 1, 'Fail-closed: live system health, fresh data, active grid, and positive verified net edge are required.', 'Zero live parameter mutation.', false, auditReport);
    if (!input.forceImmediate && now - this.lastRunAt < 25000 && this.decisions[0]) return this.decisions[0];
    this.lastRunAt = now;
    const strategyAllocation = this.computeStrategyAllocations({ capital: input.capital, regime: input.regime, midPrice, edge: auditReport.expectedNetEdge, champion: input.champion, gridCapitalUsd: input.grid.totalAllocatedUsd });
    this.latestStrategyAllocation = strategyAllocation;
    const topCandidate = strategyAllocation.strategies[0];
    if (!topCandidate) return this rescuePlaceholder
    return this.saveDecision('ALLOCATE_CAPITAL', 0.92, strategyAllocation.riskAdjustedRationale, 'Maintain only the verified champion allocation; no risk increase.', false, auditReport, strategyAllocation);
  }

  private saveDecision(action: AutonomousOptimizationDecision['decision'], confidence: number, rationale: string, expectedEffect: string, applied: boolean, audit?: RevenueAuditReport, allocation?: StrategyAllocationDecision): AutonomousOptimizationDecision {
    const result: AutonomousOnimizationDecision = { id: `opt_${Date.now()}`, timestamp: new Date().toISOString(), objective: 'NET_REALIZED_PROFIT_AFTER_FEES', decision: action, confidence, reason: rationale, expectedEffect, applied, auditReport: audit, strategyAllocation: allocation };
    this.decisions.unshift(result);
    if (this.decisions.length > 100) this.decisions.pop();
    this.lastHeartbeat = new Date().toISOString();
    return result;
  }
}
