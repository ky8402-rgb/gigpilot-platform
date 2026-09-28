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
import { CostEvidence } from './costModel.js';

type ProfitOptimizerInput = {
  capital: CapitalAccounting;
  grid: GridConfiguration | null;
  regime: MarketRegime;
  research: ResearchItem[];
  champion: StrategyVersion;
  systemHealthy: boolean;
  midPrice?: number;
  forceImmediate?: boolean;
  costEvidence?: CostEvidence;
};

export class AutonomousProfitOptimizer implements EngineModule {
  public readonly id = 'AUTONOMOUS_PROFIT_OPTIMIZER';
  public readonly name = 'Autonomous Revenue Optimizer & Strategy Allocator (Portfolio Capital Routing)';
  private enabled = true;
  private autoApplyEnabled = true;
  private status: EngineHealth['status'] = 'HEALTHY';
  private latencyMs = 0;
  private lastHeartbeat = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];
  private decisions: AutonomousOptimizationDecision[] = [];
  private latestAuditReport: RevenueAuditReport | null = null;
  private latestStrategyAllocation: StrategyAllocationDecision | null = null;
  private aiClient: GoogleGenAI | null = null;
  private lastRunAt = 0;
  private readonly strategyBuilder = new AutonomousStrategyBuilder();

  public healthCheck(): EngineHealth {
    const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    const hasFreshPostCostEvidence = Boolean(this.latestAuditReport?.expectedNetEdge);
    const operational = hasKey && hasFreshPostCostEvidence && this.status === 'HEALTHY';
    return { id: this.id, name: this.name, status: !this.enabled ? 'OFF' : (operational ? 'HEALTHY' : 'DEGRADED'), enabled: this.enabled, latencyMs: this.latencyMs, lastHeartbeat: this.lastHeartbeat, errorCount: this.errorSurface.length, lastError: this.errorSurface[0]?.message, errorSurface: this.errorSurface.slice(0, 10), details: { objective: 'NET_REALIZED_PROFIT_AFTER_FEES_AND_ALL_VERIFIED_COSTS', autonomousDecisioning: true, autonomousBuild: true, autoApplyEnabled: this.autoApplyEnabled, sourceData: 'LIVE_PRODUCTION_ONLY', decisionsCount: this.decisions.length, strategyBuildsCount: this.strategyBuilder.getBuilds().length, revenueEfficiencyScore: this.latestAuditReport?.revenueEfficiencyScore ?? 0, activeRevenueLeaksCount: this.latestAuditReport?.leaks.length ?? 0, geminiConfigured: hasKey, freshPostCostEvidence: hasFreshPostCostEvidence, healthRequirement: 'HEALTHY only after a fresh evidence-backed audit and required Gemini dependency are operational' } };
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
    return { id: `alloc_${Date.now()}`, timestamp: new Date().toISOString(), primaryQuestion: 'Which strategy should receive capital right now?', totalTradingCapitalUsd: totalCap, activeRegime: regime, strategies: [], topRecipientStrategyId: '', topRecipientStrategyName: '', riskAdjustedRationale: rationale, diversificationScore: 0, rebalanceRequired: false, totalCapitalReallocatedUsd: 0, applied: false };
  }

  public computeStrategyAllocations(input: { capital: CapitalAccounting; regime: MarketRegime; midPrice?: number; edge?: ExpectedNetEdgeBreakdown | null; champion?: StrategyVersion; gridCapitalUsd?: number }): StrategyAllocationDecision {
    const totalCap = Math.max(0, input.capital.tradingCapital || input.capital.totalEquity || 0);
    const liveEdge = input.edge?.expectedNetEdgeBps ?? 0;
    const champion = input.champion;
    const live = champion?.liveTradingResults;
    const stable = Boolean(champion?.validationPipeline && champion.validationPipeline.overallScore >= 60 && champion.validationScore !== undefined && champion.validationScore >= 60);
    const sufficientEvidence = Boolean(live && live.tradesCount >= 30 && stable && live.netProfit > 0 && live.sharpeRatio > 0);
    if (!champion || !live || input.regime.regime === 'UNKNOWN' || totalCap <= 0 || liveEdge <= 4.0 || !sufficientEvidence) return this.emptyAllocation(totalCap, input.regime.regime, 'No capital allocation change: live fills, stable parameters, regime evidence, and positive net edge are required.');
    const typeMap: Record<StrategyVersion['type'], StrategyCategory | null> = { ADAPTIVE_GRID: 'ADAPTIVE_DEFENSIVE', TREND_GRID: 'TREND_GRID', VOLATILITY_BREAKOUT: 'MOMENTUM_BREAKOUT', MEAN_REVERSION_GRID: 'MEAN_REVERSION', CUSTOM_SCRIPT: null };
    const strategyType = typeMap[champion.type];
    if (!strategyType) return this.emptyAllocation(totalCap, input.regime.regime, 'Custom strategies require a dedicated live-evidence adapter before capital routing.');
    const candidate: StrategyAllocationCandidate = { strategyId: champion.id, strategyName: champion.name, strategyType, description: 'Live-evidence champion strategy.', targetRegimes: [input.regime.regime], regimeMatchScore: 100, metrics: { outOfSampleSharpe: live.sharpeRatio, outOfSampleSortino: live.sortinoRatio, outOfSampleNetRoiPct: live.roiPct, profitFactor: live.profitFactor, winRatePct: live.winRatePct, realizedVolatilityPct: 0, volatilityRiskPenalty: 0, correlationWithPortfolio: 0, decorrelationBonus: 1, executionQualityScore: live.orderFillRatePct, expectedNetEdgeBps: liveEdge, meetsMinimumEdgeThreshold: liveEdge > 4.0, fillRatePct: live.orderFillRatePct, avgSlippageBps: 0 }, compositeScore: 100, targetWeightPct: 100, allocatedCapitalUsd: totalCap, currentCapitalUsd: input.gridCapitalUsd || 0, capitalDeltaUsd: totalCap - (input.gridCapitalUsd || 0), action: 'MAINTAIN', rationale: `Live champion evidence supports allocation: ${live.tradesCount} live trades, stable parameters, positive net profit, and expected net edge ${liveEdge.toFixed(2)} bps.` };
    return { id: `alloc_${Date.now()}`, timestamp: new Date().toISOString(), primaryQuestion: 'Which strategy should receive capital right now?', totalTradingCapitalUsd: totalCap, activeRegime: input.regime.regime, strategies: [candidate], topRecipientStrategyId: candidate.strategyId, topRecipientStrategyName: candidate.strategyName, riskAdjustedRationale: candidate.rationale, diversificationScore: 100, rebalanceRequired: Math.abs(candidate.capitalDeltaUsd) > Math.max(50, totalCap * 0.05), totalCapitalReallocatedUsd: Math.abs(candidate.capitalDeltaUsd), applied: false };
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: unknown): void { this.errorSurface.unshift({ id: `err_profitopt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, timestamp: new Date().toISOString(), level, message, details }); if (this.errorSurface.length > 50) this.errorSurface.pop(); }
  private getAiClient(): GoogleGenAI | null { if (!this.aiClient && process.env.GEMINI_API_KEY) this.aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); return this.aiClient; }

  public conductRevenueAudit(input: { capital: CapitalAccounting; grid: GridConfiguration | null; regime: MarketRegime; midPrice?: number; costEvidence?: ProfitOptimizerInput['costEvidence'] }): RevenueAuditReport {
    const evidence = input.costEvidence;
    const netProfit = Number(input.capital.netRealizedProfit || 0);
    const totalFees = Number(input.capital.totalTradingFees || 0);
    const grossProfit = Number(input.capital.grossProfit || 0);
    const gridSpacing = Number(input.grid?.gridSpacingPct || 0);
    // Gate only on the fields the DECISION actually consumes. The ledger/reporting additions
    // (realizedTotalCostUsd, markoutSampleCount, feeRateSource) are deliberately not gating, and the
    // real fail-closed gate is buildCostEvidence() returning null when cost cannot be measured.
    const evidenceValid = Boolean(evidence && evidence.sampleCount > 0 &&
      Number.isFinite(evidence.realizedSpreadCostUsd) && Number.isFinite(evidence.realizedSlippageCostUsd) &&
      Number.isFinite(evidence.realizedAdverseSelectionCostUsd) && Number.isFinite(evidence.realizedFundingCostUsd) &&
      Number.isFinite(evidence.expectedSpreadCostBps) && Number.isFinite(evidence.expectedSlippageCostBps) &&
      Number.isFinite(evidence.expectedAdverseSelectionCostBps) && Number.isFinite(evidence.expectedFundingCarryingCostBps) &&
      Number.isFinite(evidence.expectedExecutionUncertaintyBps) && Number.isFinite(Date.parse(evidence.observedAt)) &&
      Date.now() - Date.parse(evidence.observedAt) <= 30 * 60 * 1000);
    const realizedNetAfterAllCosts = evidenceValid ? Number((netProfit - evidence!.realizedSpreadCostUsd - evidence!.realizedSlippageCostUsd - evidence!.realizedAdverseSelectionCostUsd - evidence!.realizedFundingCostUsd).toFixed(2)) : null;
    const feeToProfitRatioPct = grossProfit > 0 ? Number(((totalFees / grossProfit) * 100).toFixed(2)) : (totalFees > 0 ? 100 : 0);
    const expectedGrossEdgeBps = Number((gridSpacing * 100 * 0.55).toFixed(2));
    let expectedNetEdge: ExpectedNetEdgeBreakdown | undefined;
    if (evidenceValid) {
      const makerTakerFeesBps = evidence!.expectedMakerTakerFeesBps;
      const expectedNetEdgeBps = Number((expectedGrossEdgeBps - makerTakerFeesBps - evidence!.expectedSpreadCostBps - evidence!.expectedSlippageCostBps - evidence!.expectedAdverseSelectionCostBps - evidence!.expectedFundingCarryingCostBps - evidence!.expectedExecutionUncertaintyBps).toFixed(2));
      expectedNetEdge = { expectedGrossEdgeBps, makerTakerFeesBps, expectedSpreadCostBps: evidence!.expectedSpreadCostBps, expectedSlippageBps: evidence!.expectedSlippageCostBps, adverseSelectionCostBps: evidence!.expectedAdverseSelectionCostBps, fundingCarryingCostBps: evidence!.expectedFundingCarryingCostBps, executionUncertaintyBps: evidence!.expectedExecutionUncertaintyBps, expectedNetEdgeBps, isTradeable: expectedNetEdgeBps > 4, minHurdleRateBps: 4, edgeFormula: 'authoritative gross edge minus observed fees/spread/slippage/adverse-selection/carry/uncertainty', timestamp: new Date().toISOString() };
    }
    const effectiveNetMarginBps = expectedNetEdge?.expectedNetEdgeBps ?? 0;
    const spreadCaptureEfficiencyPct = gridSpacing > 0 ? Number((Math.max(0, effectiveNetMarginBps) / (gridSpacing * 100) * 100).toFixed(1)) : 0;
    const leaks: RevenueLeak[] = [];
    if (!evidenceValid) leaks.push({ id: 'leak_missing_cost_evidence_' + Date.now(), type: 'NEGATIVE_NET_EDGE_DRAG', severity: 'HIGH', description: 'Fresh realized spread, slippage, adverse-selection and carrying-cost evidence is missing or stale.', estimatedDailyDragUsd: 0, recommendedRemediation: 'Do not optimize or trade until authoritative cost telemetry is available.' });
    if (expectedNetEdge && !expectedNetEdge.isTradeable) leaks.push({ id: 'leak_negative_net_edge_' + Date.now(), type: 'NEGATIVE_NET_EDGE_DRAG', severity: 'HIGH', description: 'Verified expected net edge is at or below the required hurdle.', estimatedDailyDragUsd: 0, recommendedRemediation: 'Do not trade; wait for a verified positive net edge.' });
    const p = input.midPrice && input.midPrice > 0 ? input.midPrice : 0;
    const normalizedAtrPct = input.regime.atr > 0 && p > 0 ? (input.regime.atr / p) * 100 : 0;
    if (gridSpacing > 0 && p > 0 && Math.abs(gridSpacing - normalizedAtrPct) > 0.35) leaks.push({ id: 'leak_vol_mismatch_' + Date.now(), type: 'VOLATILITY_MISALIGNMENT', severity: 'MEDIUM', description: 'ATR diverges materially from grid spacing.', estimatedDailyDragUsd: 0, recommendedRemediation: 'Recalculate from fresh exchange data and remain fail-closed when stale.' });
    const score = !evidenceValid ? 0 : leaks.some(leak => leak.severity === 'HIGH') ? 35 : leaks.length > 0 ? 70 : 92;
    const report: RevenueAuditReport = { timestamp: new Date().toISOString(), revenueEfficiencyScore: score, netRealizedProfitUsd: realizedNetAfterAllCosts ?? 0, totalTradingFeesUsd: totalFees, feeToProfitRatioPct, spreadCaptureEfficiencyPct, effectiveNetMarginBps, expectedNetEdge, costEvidence: evidenceValid ? evidence : undefined, leaks, vanityMetricsFiltered: { grossVolumeIgnoredUsd: 0, rawFillsCountIgnored: 0, cosmeticWinRateIgnoredPct: 0, statement: 'No profitability decision is made without verified realized post-cost evidence.' } };
    this.latestAuditReport = report;
    return report;
  }

  public async auditAndOptimize(input: ProfitOptimizerInput): Promise<AutonomousOptimizationDecision> {
    const now = Date.now();
    const midPrice = input.midPrice && input.midPrice > 0 ? input.midPrice : (input.grid ? (input.grid.upperBoundary + input.grid.lowerBoundary) / 2 : 0);
    const auditReport = this.conductRevenueAudit({ capital: input.capital, grid: input.grid, regime: input.regime, midPrice, costEvidence: input.costEvidence });
    if (!this.enabled || !input.systemHealthy || !input.grid || !auditReport.expectedNetEdge?.isTradeable || input.regime.regime === 'UNKNOWN' || auditReport.netRealizedProfitUsd <= 0) return this.saveDecision('PAUSE_OPTIMIZATION', 1, 'Fail-closed: live health, fresh regime, active grid, fresh post-cost evidence, positive realized net profit, and verified net edge are required.', 'Zero live parameter mutation.', false, auditReport);
    if (!input.forceImmediate && now - this.lastRunAt < 25000 && this.decisions[0]) return this.decisions[0];
    this.lastRunAt = now;
    const strategyAllocation = this.computeStrategyAllocations({ capital: input.capital, regime: input.regime, midPrice, edge: auditReport.expectedNetEdge, champion: input.champion, gridCapitalUsd: input.grid.totalAllocatedUsd });
    this.latestStrategyAllocation = strategyAllocation;
    const topCandidate = strategyAllocation.strategies[0];
    if (!topCandidate) return this.saveDecision('PAUSE_OPTIMIZATION', 1, 'No strategy has sufficient verified live evidence for autonomous capital routing.', 'Zero live parameter mutation.', false, auditReport, strategyAllocation);
    // Cost-aware grid spacing selection, bounded to a ±25% neighbourhood of the active spacing and
    // accepted only when it genuinely improves the MEASURED post-cost edge. Risk limits are not
    // touched by this decision; every resulting rung is still re-validated by the risk engine.
    const currentSpacingPct = Number(input.grid.gridSpacingPct);
    const spacingPlan = this.optimiseGridSpacing({ currentSpacingPct, expectedNetEdge: auditReport.expectedNetEdge });
    const relativeChange = currentSpacingPct > 0 ? Math.abs(spacingPlan.recommendedSpacingPct - currentSpacingPct) / currentSpacingPct : 0;

    if (spacingPlan.improvementBps >= 0.5 && relativeChange >= 0.05) {
      const widening = spacingPlan.recommendedSpacingPct > currentSpacingPct;
      return this.saveDecision(
        widening ? 'WIDEN_GRID' : 'TIGHTEN_GRID',
        0.9,
        `Measured post-cost edge improves from ${spacingPlan.currentNetEdgeBps} to ${spacingPlan.candidateNetEdgeBps} bps by moving grid spacing from ${currentSpacingPct}% to ${spacingPlan.recommendedSpacingPct}% (bounded to ±25%). Costs are the live measured stack: ${auditReport.expectedNetEdge.edgeFormula}.`,
        `Grid spacing ${currentSpacingPct}% -> ${spacingPlan.recommendedSpacingPct}% (+${spacingPlan.improvementBps} bps measured net edge). Risk limits unchanged.`,
        true,
        auditReport,
        strategyAllocation,
        { previous: currentSpacingPct, next: spacingPlan.recommendedSpacingPct }
      );
    }

    const ai = this.getAiClient();
    void ai;
    return this.saveDecision('ALLOCATE_CAPITAL', 0.92, strategyAllocation.riskAdjustedRationale, 'Maintain only the verified champion allocation; no risk increase.', false, auditReport, strategyAllocation);
  }

  /**
   * Selects the grid spacing that maximises measured expected net edge within a bounded
   * neighbourhood of the current spacing.
   *
   * Gross capture per round-trip scales with spacing, while fees, spread, slippage and execution
   * uncertainty are paid per round-trip and are therefore spacing-independent. Funding carry scales
   * with how long inventory is held, which itself scales with spacing. The measured cost stack
   * decides which effect dominates. The search is a fixed, deterministic sweep of six candidates —
   * no randomness and no unbounded search.
   */
  public optimiseGridSpacing(input: {
    currentSpacingPct: number;
    expectedNetEdge: ExpectedNetEdgeBreakdown;
    maxRelativeChangePct?: number;
  }): { recommendedSpacingPct: number; currentNetEdgeBps: number; candidateNetEdgeBps: number; improvementBps: number } {
    const current = Number(input.currentSpacingPct);
    const edge = input.expectedNetEdge;
    if (!Number.isFinite(current) || current <= 0 || !edge) {
      return { recommendedSpacingPct: current, currentNetEdgeBps: 0, candidateNetEdgeBps: 0, improvementBps: 0 };
    }

    const maxChangePct = Number.isFinite(input.maxRelativeChangePct) ? Number(input.maxRelativeChangePct) : 25;
    const perRoundTripCostsBps =
      edge.makerTakerFeesBps + edge.expectedSpreadCostBps + edge.expectedSlippageBps +
      edge.adverseSelectionCostBps + edge.executionUncertaintyBps;

    const netEdgeFor = (spacingPct: number) => Number(
      (spacingPct * 100 * 0.55 - perRoundTripCostsBps - edge.fundingCarryingCostBps * (spacingPct / current)).toFixed(4)
    );

    const currentNetEdgeBps = netEdgeFor(current);
    let best = { spacing: current, netEdge: currentNetEdgeBps };

    const lo = 1 - maxChangePct / 100;
    const hi = 1 + maxChangePct / 100;
    for (const factor of [lo, lo + (1 - lo) / 6, 1 - (1 - lo) / 6, 1 + (hi - 1) / 6, 1 + (hi - 1) / 3, hi]) {
      const candidate = Number((current * factor).toPrecision(12));
      if (!Number.isFinite(candidate) || candidate <= 0) continue;
      const netEdge = netEdgeFor(candidate);
      if (netEdge > best.netEdge + 1e-9) best = { spacing: candidate, netEdge };
    }

    return {
      recommendedSpacingPct: Number(best.spacing.toFixed(6)),
      currentNetEdgeBps,
      candidateNetEdgeBps: Number(best.netEdge.toFixed(4)),
      improvementBps: Number((best.netEdge - currentNetEdgeBps).toFixed(4))
    };
  }

  private saveDecision(action: AutonomousOptimizationDecision['decision'], confidence: number, rationale: string, expectedEffect: string, applied: boolean, audit?: RevenueAuditReport, allocation?: StrategyAllocationDecision, spacing?: { previous: number; next: number }): AutonomousOptimizationDecision {
    const result: AutonomousOptimizationDecision = { id: `opt_${Date.now()}`, timestamp: new Date().toISOString(), objective: 'NET_REALIZED_PROFIT_AFTER_FEES', decision: action, confidence, reason: rationale, expectedEffect, applied, auditReport: audit, strategyAllocation: allocation, previousGridSpacingPct: spacing?.previous, newGridSpacingPct: spacing?.next };
    this.decisions.unshift(result);
    if (this.decisions.length > 100) this.decisions.pop();
    this.lastHeartbeat = new Date().toISOString();
    return result;
  }
}
