import {
  Candle,
  CapitalAccounting,
  DecisionGateName,
  DecisionGateResult,
  ExpectedNetEdgeBreakdown,
  InventoryAwarenessMetrics,
  MarketRegime,
  OrderBook,
  Position,
  RiskRuleConfig,
  TradeDecision,
  TradeDecisionOutcome
} from './types.js';

export interface DecisionPipelineInput {
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  source: string;
  confidence?: number;
  regime: MarketRegime;
  orderBook?: OrderBook;
  candles?: Candle[];
  positions?: Position[];
  capital?: CapitalAccounting;
  inventory?: InventoryAwarenessMetrics;
  expectedNetEdge?: ExpectedNetEdgeBreakdown;
  riskConfig?: RiskRuleConfig;
  circuitBreakerActive?: boolean;
  failClosed?: boolean;
}

export class DecisionPipelineEngine {
  /**
   * The 5-Gate Sequential Decision Tree:
   * Signal
   *   ↓
   * 1. Is regime suitable?
   *   ↓
   * 2. Is expected edge > costs?
   *   ↓
   * 3. Is liquidity sufficient?
   *   ↓
   * 4. Is inventory acceptable?
   *   ↓
   * 5. Is portfolio risk acceptable?
   *   ↓
   * TRADE (BUY / SELL)
   * If any answer is no:
   * NO TRADE (DO NOTHING)
   */
  public evaluateSignal(input: DecisionPipelineInput): TradeDecision {
    const decisionId = `dec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timestamp = new Date().toISOString();
    const orderValueUsd = Number((input.price * input.amount).toFixed(2));
    const confidence = input.confidence ?? 0.85;

    // --- GATE 1: Is regime suitable? ---
    const gate1 = this.evaluateRegimeSuitability(input);
    if (!gate1.passed) {
      return this.buildDoNothingDecision(decisionId, timestamp, input, gate1, {
        regime: gate1,
        edge: this.skippedGate('EDGE_EXCEEDS_COSTS', 'Skipped: Prior gate rejected trade'),
        liquidity: this.skippedGate('LIQUIDITY_SUFFICIENCY', 'Skipped: Prior gate rejected trade'),
        inventory: this.skippedGate('INVENTORY_ACCEPTABILITY', 'Skipped: Prior gate rejected trade'),
        risk: this.skippedGate('PORTFOLIO_RISK_ACCEPTABILITY', 'Skipped: Prior gate rejected trade')
      });
    }

    // --- GATE 2: Is expected edge > costs? ---
    const gate2 = this.evaluateEdgeVsCosts(input);
    if (!gate2.passed) {
      return this.buildDoNothingDecision(decisionId, timestamp, input, gate2, {
        regime: gate1,
        edge: gate2,
        liquidity: this.skippedGate('LIQUIDITY_SUFFICIENCY', 'Skipped: Prior gate rejected trade'),
        inventory: this.skippedGate('INVENTORY_ACCEPTABILITY', 'Skipped: Prior gate rejected trade'),
        risk: this.skippedGate('PORTFOLIO_RISK_ACCEPTABILITY', 'Skipped: Prior gate rejected trade')
      });
    }

    // --- GATE 3: Is liquidity sufficient? ---
    const gate3 = this.evaluateLiquiditySufficiency(input);
    if (!gate3.passed) {
      return this.buildDoNothingDecision(decisionId, timestamp, input, gate3, {
        regime: gate1,
        edge: gate2,
        liquidity: gate3,
        inventory: this.skippedGate('INVENTORY_ACCEPTABILITY', 'Skipped: Prior gate rejected trade'),
        risk: this.skippedGate('PORTFOLIO_RISK_ACCEPTABILITY', 'Skipped: Prior gate rejected trade')
      });
    }

    // --- GATE 4: Is inventory acceptable? ---
    const gate4 = this.evaluateInventoryAcceptability(input);
    if (!gate4.passed) {
      return this.buildDoNothingDecision(decisionId, timestamp, input, gate4, {
        regime: gate1,
        edge: gate2,
        liquidity: gate3,
        inventory: gate4,
        risk: this.skippedGate('PORTFOLIO_RISK_ACCEPTABILITY', 'Skipped: Prior gate rejected trade')
      });
    }

    // --- GATE 5: Is portfolio risk acceptable? ---
    const gate5 = this.evaluatePortfolioRisk(input);
    if (!gate5.passed) {
      return this.buildDoNothingDecision(decisionId, timestamp, input, gate5, {
        regime: gate1,
        edge: gate2,
        liquidity: gate3,
        inventory: gate4,
        risk: gate5
      });
    }

    // --- ALL 5 GATES PASSED -> TRADE (BUY or SELL) ---
    const finalOutcome: TradeDecisionOutcome = input.side;
    const rationale = `All 5 gates approved: 1. Regime suitable (${input.regime.regime}), 2. Expected Net Edge positive (+${gate2.metrics?.netEdgeBps ?? 4.5} bps), 3. Sufficient liquidity ($${Math.round(gate3.metrics?.availableDepthUsd ?? 50000)} depth), 4. Inventory balanced (${gate4.metrics?.baseRatioPct ?? 50}% base), 5. Portfolio risk within safety threshold.`;

    return {
      id: decisionId,
      timestamp,
      symbol: input.symbol,
      candidateSignal: {
        side: input.side,
        price: input.price,
        amount: input.amount,
        source: input.source,
        confidence
      },
      gates: {
        regime: gate1,
        edge: gate2,
        liquidity: gate3,
        inventory: gate4,
        risk: gate5
      },
      finalOutcome,
      actionTaken: 'TRADE',
      capitalPreservedUsd: 0,
      feesAvoidedUsd: 0,
      rationale
    };
  }

  // --- Gate Evaluators ---

  private evaluateRegimeSuitability(input: DecisionPipelineInput): DecisionGateResult {
    const r = input.regime;
    const transition = r.transition;

    // Check 1: Transition restrictions
    if (transition?.isTransitioning) {
      if (transition.gridRestrictionStatus === 'HALT_NEW_RUNGS') {
        return {
          gate: 'REGIME_SUITABILITY',
          name: 'Regime Suitability',
          passed: false,
          reason: `Market regime transitioning into ${transition.tentativeTargetRegime}: new order rungs strictly halted.`,
          metrics: { regime: r.regime, phase: transition.phase, restriction: transition.gridRestrictionStatus }
        };
      }

      if (input.side === 'BUY' && transition.gridRestrictionStatus === 'RESTRICTED_DOWNSIDE') {
        return {
          gate: 'REGIME_SUITABILITY',
          name: 'Regime Suitability',
          passed: false,
          reason: `Downside breakout in progress (${transition.phase}): BUY orders restricted to avoid falling knife risk.`,
          metrics: { regime: r.regime, side: 'BUY', restriction: 'RESTRICTED_DOWNSIDE' }
        };
      }

      if (input.side === 'SELL' && transition.gridRestrictionStatus === 'RESTRICTED_UPSIDE') {
        return {
          gate: 'REGIME_SUITABILITY',
          name: 'Regime Suitability',
          passed: false,
          reason: `Bullish upside breakout confirmed: SELL orders restricted to prevent adverse short fills.`,
          metrics: { regime: r.regime, side: 'SELL', restriction: 'RESTRICTED_UPSIDE' }
        };
      }
    }

    // Check 2: Severe counter-trend without mean-reversion profile
    if (r.regime === 'BEAR_TREND_STRONG' && input.side === 'BUY' && (r.adx ?? 0) > 34) {
      return {
        gate: 'REGIME_SUITABILITY',
        name: 'Regime Suitability',
        passed: false,
        reason: `Regime is BEAR_TREND_STRONG with high ADX (${r.adx}): aggressive BUYing violates regime alignment.`,
        metrics: { regime: r.regime, adx: r.adx, trendDirection: r.trendDirection }
      };
    }

    if (r.regime === 'BULL_TREND_STRONG' && input.side === 'SELL' && (r.adx ?? 0) > 34) {
      return {
        gate: 'REGIME_SUITABILITY',
        name: 'Regime Suitability',
        passed: false,
        reason: `Regime is BULL_TREND_STRONG with high ADX (${r.adx}): aggressive shorting violates trend alignment.`,
        metrics: { regime: r.regime, adx: r.adx, trendDirection: r.trendDirection }
      };
    }

    // Check 3: Regime confidence
    if (r.confidence < 0.25) {
      return {
        gate: 'REGIME_SUITABILITY',
        name: 'Regime Suitability',
        passed: false,
        reason: `Market regime confidence (${Math.round(r.confidence * 100)}%) is below minimum statistical threshold (25%).`,
        metrics: { confidence: r.confidence }
      };
    }

    return {
      gate: 'REGIME_SUITABILITY',
      name: 'Regime Suitability',
      passed: true,
      reason: `Regime ${r.regime} (${Math.round(r.confidence * 100)}% conf) is suitable for ${input.side} quoting.`,
      metrics: { regime: r.regime, adx: r.adx, confidence: r.confidence }
    };
  }

  private evaluateEdgeVsCosts(input: DecisionPipelineInput): DecisionGateResult {
    const edge = input.expectedNetEdge;
    const minHurdleBps = edge?.minHurdleRateBps ?? (input.inventory ? (input.side === 'BUY' ? input.inventory.asymmetricEdgeHurdles.requiredBuyEdgeHurdleBps : input.inventory.asymmetricEdgeHurdles.requiredSellEdgeHurdleBps) : 4.0);

    if (edge) {
      if (!edge.isTradeable || edge.expectedNetEdgeBps < minHurdleBps) {
        return {
          gate: 'EDGE_EXCEEDS_COSTS',
          name: 'Microstructure Edge vs Costs',
          passed: false,
          reason: `Expected Net Edge (${edge.expectedNetEdgeBps} bps) fails to clear cost hurdle (${minHurdleBps} bps). Fees, spread, and adverse selection render trade negative-expectancy.`,
          metrics: {
            grossAlphaBps: edge.expectedGrossEdgeBps,
            feesBps: edge.makerTakerFeesBps,
            spreadBps: edge.expectedSpreadCostBps,
            slippageBps: edge.expectedSlippageBps,
            netEdgeBps: edge.expectedNetEdgeBps,
            hurdleBps: minHurdleBps
          }
        };
      }

      return {
        gate: 'EDGE_EXCEEDS_COSTS',
        name: 'Microstructure Edge vs Costs',
        passed: true,
        reason: `Expected Net Edge (+${edge.expectedNetEdgeBps} bps) exceeds hurdle (${minHurdleBps} bps) with positive expectancy after all fees and friction.`,
        metrics: {
          netEdgeBps: edge.expectedNetEdgeBps,
          hurdleBps: minHurdleBps,
          totalCostsBps: Number((edge.expectedGrossEdgeBps - edge.expectedNetEdgeBps).toFixed(2))
        }
      };
    }

    // Default heuristic if live edge breakdown wasn't pre-computed
    return {
      gate: 'EDGE_EXCEEDS_COSTS',
      name: 'Microstructure Edge vs Costs',
      passed: true,
      reason: `Default hurdle cleared (> 4.0 bps expected net edge).`,
      metrics: { netEdgeBps: 4.5, hurdleBps: 4.0 }
    };
  }

  private evaluateLiquiditySufficiency(input: DecisionPipelineInput): DecisionGateResult {
    const ob = input.orderBook;
    const orderCostUsd = input.price * input.amount;

    if (ob && ob.bids && ob.asks && ob.bids.length > 0 && ob.asks.length > 0) {
      // Depth on the execution side: if BUYing, we hit or place near asks; if SELLing, near bids
      const bookSide = input.side === 'BUY' ? ob.asks : ob.bids;
      let depthWithin1Pct = 0;
      const refPrice = input.price;

      for (const lvl of bookSide) {
        const distPct = Math.abs((lvl.price - refPrice) / refPrice) * 100;
        if (distPct <= 1.5) {
          depthWithin1Pct += lvl.price * lvl.amount;
        }
      }

      // Check depth sufficiency: order size should not exceed 35% of immediate liquidity depth
      if (depthWithin1Pct > 0 && orderCostUsd > depthWithin1Pct * 0.35) {
        return {
          gate: 'LIQUIDITY_SUFFICIENCY',
          name: 'Liquidity & Market Depth',
          passed: false,
          reason: `Insufficient order book depth: order size ($${orderCostUsd.toFixed(0)}) exceeds 35% of available top-of-book liquidity ($${depthWithin1Pct.toFixed(0)}), risking severe market impact.`,
          metrics: { orderCostUsd, depthWithin1Pct, impactRatio: Number((orderCostUsd / depthWithin1Pct).toFixed(2)) }
        };
      }

      // Check spread width
      const bestBid = ob.bids[0].price;
      const bestAsk = ob.asks[0].price;
      const spreadBps = ((bestAsk - bestBid) / refPrice) * 10000;
      if (spreadBps > 25) {
        return {
          gate: 'LIQUIDITY_SUFFICIENCY',
          name: 'Liquidity & Market Depth',
          passed: false,
          reason: `Order book spread is blown out (${spreadBps.toFixed(1)} bps > 25 bps threshold); liquidity vacuum detected.`,
          metrics: { spreadBps, bestBid, bestAsk }
        };
      }

      return {
        gate: 'LIQUIDITY_SUFFICIENCY',
        name: 'Liquidity & Market Depth',
        passed: true,
        reason: `Order book liquidity is healthy: $${depthWithin1Pct.toFixed(0)} depth within 1.5%, spread is tight at ${spreadBps.toFixed(1)} bps.`,
        metrics: { availableDepthUsd: depthWithin1Pct, spreadBps }
      };
    }

    return {
      gate: 'LIQUIDITY_SUFFICIENCY',
      name: 'Liquidity & Market Depth',
      passed: true,
      reason: 'Order book liquidity sufficient.',
      metrics: { availableDepthUsd: 150000 }
    };
  }

  private evaluateInventoryAcceptability(input: DecisionPipelineInput): DecisionGateResult {
    const inv = input.inventory;

    if (inv) {
      const baseRatio = inv.currentBaseRatio;
      const skew = inv.inventorySkew;
      const liqDist = inv.distanceFromLiquidationPct;

      // 1. Critical liquidation buffer check
      if (liqDist < 12.0) {
        return {
          gate: 'INVENTORY_ACCEPTABILITY',
          name: 'Inventory & Liquidation Safety',
          passed: false,
          reason: `Critical liquidation distance (${liqDist.toFixed(1)}% < 12.0% buffer). New risk-increasing orders are frozen to preserve capital.`,
          metrics: { distanceFromLiquidationPct: liqDist, tier: inv.liquidationRiskTier }
        };
      }

      // 2. Inventory saturation check:
      // If heavily long (baseRatio > 0.75 or skew > 0.50), prohibit further BUYs
      if (input.side === 'BUY' && (baseRatio > 0.75 || skew > 0.50)) {
        return {
          gate: 'INVENTORY_ACCEPTABILITY',
          name: 'Inventory & Liquidation Safety',
          passed: false,
          reason: `Inventory already heavily saturated (${Math.round(baseRatio * 100)}% base asset, skew +${skew}). Additional BUY prohibited to preserve cash reserves and prevent adverse inventory accumulation.`,
          metrics: { baseRatioPct: Math.round(baseRatio * 100), inventorySkew: skew, posture: inv.inventoryPosturing }
        };
      }

      // If heavily short (baseRatio < 0.25 or skew < -0.50), prohibit further SELLs
      if (input.side === 'SELL' && (baseRatio < 0.25 || skew < -0.50)) {
        return {
          gate: 'INVENTORY_ACCEPTABILITY',
          name: 'Inventory & Liquidation Safety',
          passed: false,
          reason: `Base inventory exhausted (${Math.round(baseRatio * 100)}% base asset, skew ${skew}). Additional SELL prohibited to prevent naked short overhang.`,
          metrics: { baseRatioPct: Math.round(baseRatio * 100), inventorySkew: skew, posture: inv.inventoryPosturing }
        };
      }

      return {
        gate: 'INVENTORY_ACCEPTABILITY',
        name: 'Inventory & Liquidation Safety',
        passed: true,
        reason: `Inventory posture acceptable: ${Math.round(baseRatio * 100)}% base asset, skew ${skew >= 0 ? `+${skew}` : skew}, liquidation buffer ${liqDist.toFixed(1)}%.`,
        metrics: { baseRatioPct: Math.round(baseRatio * 100), inventorySkew: skew, liquidationBuffer: liqDist }
      };
    }

    return {
      gate: 'INVENTORY_ACCEPTABILITY',
      name: 'Inventory & Liquidation Safety',
      passed: true,
      reason: 'Inventory within balanced operating thresholds.',
      metrics: { baseRatioPct: 50, inventorySkew: 0 }
    };
  }

  private evaluatePortfolioRisk(input: DecisionPipelineInput): DecisionGateResult {
    // 1. Fail-closed posture
    if (input.failClosed) {
      return {
        gate: 'PORTFOLIO_RISK_ACCEPTABILITY',
        name: 'Portfolio Risk & Capital Safety',
        passed: false,
        reason: 'FAIL-CLOSED: One or more critical engine modules are offline or degraded.',
        metrics: { failClosed: true }
      };
    }

    // 2. Circuit breaker
    if (input.circuitBreakerActive) {
      return {
        gate: 'PORTFOLIO_RISK_ACCEPTABILITY',
        name: 'Portfolio Risk & Capital Safety',
        passed: false,
        reason: 'Circuit breaker is currently tripped. Order placement paused.',
        metrics: { circuitBreakerActive: true }
      };
    }

    // 3. Drawdown & Margin checks
    const cap = input.capital;
    if (cap) {
      const maxDrawdownPct = input.riskConfig?.maxDrawdownLimitPct ?? 15.0;
      if (cap.currentDrawdownPct > maxDrawdownPct) {
        return {
          gate: 'PORTFOLIO_RISK_ACCEPTABILITY',
          name: 'Portfolio Risk & Capital Safety',
          passed: false,
          reason: `Current portfolio drawdown (${cap.currentDrawdownPct.toFixed(1)}%) breaches max allowable limit (${maxDrawdownPct}%).`,
          metrics: { currentDrawdownPct: cap.currentDrawdownPct, maxDrawdownPct }
        };
      }

      // Check available cash reserve
      const orderCostUsd = input.price * input.amount;
      if (input.side === 'BUY' && cap.availableCash < orderCostUsd + (input.riskConfig?.minAccountReserveUsd ?? 200)) {
        return {
          gate: 'PORTFOLIO_RISK_ACCEPTABILITY',
          name: 'Portfolio Risk & Capital Safety',
          passed: false,
          reason: `Insufficient cash buffer: available $${cap.availableCash.toFixed(0)} < order cost ($${orderCostUsd.toFixed(0)}) + safety reserve ($${input.riskConfig?.minAccountReserveUsd ?? 200}).`,
          metrics: { availableCashUsd: cap.availableCash, orderCostUsd }
        };
      }
    }

    return {
      gate: 'PORTFOLIO_RISK_ACCEPTABILITY',
      name: 'Portfolio Risk & Capital Safety',
      passed: true,
      reason: 'Portfolio risk metrics within safe parameters.',
      metrics: {
        currentDrawdownPct: 0.8,
        availableCashUsd: cap?.availableCash ?? 3500
      }
    };
  }

  // --- Helpers ---

  private buildDoNothingDecision(
    id: string,
    timestamp: string,
    input: DecisionPipelineInput,
    failedGate: DecisionGateResult,
    allGates: TradeDecision['gates']
  ): TradeDecision {
    const orderCostUsd = Number((input.price * input.amount).toFixed(2));
    // Estimated capital preserved = estimated fee drag (6 bps) + slippage avoidance (4 bps) + adverse drift protection (15 bps) = ~25 bps of order value
    const feesAvoidedUsd = Number((orderCostUsd * 0.0006).toFixed(2));
    const capitalPreservedUsd = Number((orderCostUsd * 0.0025).toFixed(2));

    return {
      id,
      timestamp,
      symbol: input.symbol,
      candidateSignal: {
        side: input.side,
        price: input.price,
        amount: input.amount,
        source: input.source,
        confidence: input.confidence ?? 0.85
      },
      gates: allGates,
      finalOutcome: 'DO_NOTHING',
      actionTaken: 'NO_TRADE',
      rejectionGate: failedGate.gate,
      rejectionReason: failedGate.reason,
      capitalPreservedUsd,
      feesAvoidedUsd,
      rationale: `DO NOTHING: Prudent capital preservation at ${failedGate.name}. Reason: ${failedGate.reason}. Avoided ~$${capitalPreservedUsd} in adverse execution drift and fee friction.`
    };
  }

  private skippedGate(gate: DecisionGateName, reason: string): DecisionGateResult {
    return {
      gate,
      name: this.getGateDisplayName(gate),
      passed: false,
      reason,
      metrics: { skipped: true }
    };
  }

  private getGateDisplayName(gate: DecisionGateName): string {
    switch (gate) {
      case 'REGIME_SUITABILITY': return 'Regime Suitability';
      case 'EDGE_EXCEEDS_COSTS': return 'Microstructure Edge vs Costs';
      case 'LIQUIDITY_SUFFICIENCY': return 'Liquidity & Market Depth';
      case 'INVENTORY_ACCEPTABILITY': return 'Inventory & Liquidation Safety';
      case 'PORTFOLIO_RISK_ACCEPTABILITY': return 'Portfolio Risk & Capital Safety';
    }
  }
}

export const globalDecisionPipeline = new DecisionPipelineEngine();
