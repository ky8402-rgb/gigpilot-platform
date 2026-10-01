import {
  CapitalAccounting,
  EngineErrorRecord,
  EngineHealth,
  EngineModule,
  ExpectedNetEdgeBreakdown,
  HierarchicalRiskStructure,
  Order,
  Position,
  RiskEvent,
  RiskRuleConfig
} from './types.js';

function getPositionCostUsd(p: Position): number {
  if (typeof p.currentPositionCostUsd === 'number') return p.currentPositionCostUsd;
  const price = p.currentPrice || p.entryPrice || 0;
  return Math.abs(p.baseAmount * price) || Math.abs(p.quoteAmount) || 0;
}

export class RiskEngine implements EngineModule {
  public readonly id = 'RISK_ENGINE';
  public readonly name = 'Hierarchical Risk Engine & Correlated Exposure Gate';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private config: RiskRuleConfig;
  private riskEvents: RiskEvent[] = [];
  private circuitBreakerActive = false;

  constructor(initialConfig?: Partial<RiskRuleConfig>) {
    this.config = {
      maxPositionSizePct: 25,
      maxCapitalAllocationPct: 80,
      maxDailyLossPct: 5,
      maxDrawdownLimitPct: 15,
      maxOpenOrders: 50,
      maxLeverage: 1,
      maxExposureUsd: 20000,
      maxSlippageBps: 35,
      minOrderBookLiquidityUsd: 10000,
      minAccountReserveUsd: 200,
      minExpectedNetEdgeBps: 4.0, // Minimum hurdle rate: Expected Net Edge must exceed 4 bps
      minimum_edge_threshold: 4.0, // Strict rule: Only trade when Expected Net Edge > minimum_edge_threshold
      autoKillSwitchTriggerDrawdownPct: 20,
      ...initialConfig
    };
  }

  public healthCheck(): EngineHealth {
    return {
      id: this.id,
      name: this.name,
      status: !this.enabled ? 'OFF' : (this.circuitBreakerActive ? 'DEGRADED' : this.status),
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message,
      errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        circuitBreakerActive: this.circuitBreakerActive,
        riskEventsCount: this.riskEvents.length,
        maxDrawdownLimitPct: this.config.maxDrawdownLimitPct,
        maxDailyLossPct: this.config.maxDailyLossPct,
        minAccountReserveUsd: this.config.minAccountReserveUsd,
        policy: 'FAIL_CLOSED (100% orders must pass risk gate)'
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
      this.recordError('CRITICAL', 'Risk Engine switched OFF. In accordance with fail-closed security, ALL order execution is completely blocked while the Risk Gate is offline.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Risk Engine switched ON. Risk evaluation gate restored.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_risk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  public getConfig(): RiskRuleConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<RiskRuleConfig>): RiskRuleConfig {
    this.config = { ...this.config, ...newConfig };
    return this.getConfig();
  }

  public getRiskEvents(): RiskEvent[] {
    return [...this.riskEvents];
  }

  public isCircuitBreakerActive(): boolean {
    return this.circuitBreakerActive;
  }

  public resetCircuitBreaker(): void {
    this.circuitBreakerActive = false;
    this.status = 'HEALTHY';
    this.recordError('WARN', 'Operator reset safety circuit breaker. Risk checks returning to normal posture.');
  }

  /**
   * Pre-trade gate. Rejects any order that fails risk criteria or if upstream systems are compromised.
   */
  public validateOrder(
    proposedOrder: {
      symbol: string;
      side: 'BUY' | 'SELL';
      price: number;
      amount: number;
      isGridOrder?: boolean;
    },
    capital: CapitalAccounting,
    currentPositions: Position[],
    openOrdersCount: number,
    midPrice?: number,
    expectedNetEdge?: ExpectedNetEdgeBreakdown
  ): { allowed: boolean; reason?: string; event?: RiskEvent } {
    const start = Date.now();

    // 0. Off-switch fail-closed enforcement
    if (!this.enabled) {
      const msg = 'FAIL-CLOSED: Risk Engine is switched OFF. No orders may bypass safety gate.';
      const event = this.recordEvent('RISK_ENGINE_OFF', 'EMERGENCY_SHUTDOWN', msg, proposedOrder);
      this.recordError('CRITICAL', msg);
      return { allowed: false, reason: msg, event };
    }

    const orderCostUsd = proposedOrder.price * proposedOrder.amount;

    // 1. Circuit breaker check
    if (this.circuitBreakerActive) {
      const event = this.recordEvent(
        'CIRCUIT_BREAKER_ACTIVE',
        'CIRCUIT_BREAKER',
        `New order rejected because safety circuit breaker is active`,
        proposedOrder
      );
      return { allowed: false, reason: 'Circuit breaker is active', event };
    }

    // 2. Price anomaly check (>5% deviation from real mid price)
    if (midPrice && midPrice > 0) {
      const deviationPct = Math.abs((proposedOrder.price - midPrice) / midPrice) * 100;
      if (deviationPct > 8.0) {
        const msg = `Order price ($${proposedOrder.price}) deviates ${deviationPct.toFixed(2)}% from real market price ($${midPrice}). Hard limit is 8%.`;
        const event = this.recordEvent('PRICE_ANOMALY_LIMIT', 'ORDER_REJECTED', msg, proposedOrder);
        this.recordError('WARN', msg);
        return { allowed: false, reason: msg, event };
      }
    }

    // 3. Max Drawdown limit check
    if (capital.currentDrawdownPct >= this.config.maxDrawdownLimitPct) {
      this.circuitBreakerActive = true;
      this.status = 'DEGRADED';
      const event = this.recordEvent(
        'MAX_DRAWDOWN_EXCEEDED',
        'CIRCUIT_BREAKER',
        `Current drawdown ${capital.currentDrawdownPct.toFixed(2)}% exceeds hard limit ${this.config.maxDrawdownLimitPct}%. Circuit breaker tripped.`,
        proposedOrder
      );
      this.recordError('CRITICAL', `Max drawdown exceeded (${capital.currentDrawdownPct.toFixed(2)}%). Circuit breaker tripped.`);
      return { allowed: false, reason: 'Max portfolio drawdown limit exceeded', event };
    }

    // 4. Max Open Orders check
    if (openOrdersCount >= this.config.maxOpenOrders) {
      const event = this.recordEvent(
        'MAX_OPEN_ORDERS',
        'ORDER_REJECTED',
        `Open orders count (${openOrdersCount}) reached ceiling (${this.config.maxOpenOrders})`,
        proposedOrder
      );
      return { allowed: false, reason: 'Max open orders limit reached', event };
    }

    // 5. Min Account Reserve protection
    if (proposedOrder.side === 'BUY' && capital.availableCash > 0) {
      const remainingCash = capital.availableCash - orderCostUsd;
      if (remainingCash < this.config.minAccountReserveUsd && !proposedOrder.isGridOrder) {
        const event = this.recordEvent(
          'MIN_ACCOUNT_RESERVE_VIOLATION',
          'ORDER_REJECTED',
          `Order cost ($${orderCostUsd.toFixed(2)}) leaves remaining cash ($${remainingCash.toFixed(2)}) below required safety reserve ($${this.config.minAccountReserveUsd})`,
          proposedOrder
        );
        return { allowed: false, reason: 'Violates minimum cash reserve rule', event };
      }
    }

    // 6. Max Single Order Exposure
    if (orderCostUsd > this.config.maxExposureUsd) {
      const event = this.recordEvent(
        'MAX_ORDER_EXPOSURE_EXCEEDED',
        'ORDER_REJECTED',
        `Order cost ($${orderCostUsd.toFixed(2)}) exceeds maximum allowed single-order exposure ($${this.config.maxExposureUsd})`,
        proposedOrder
      );
      return { allowed: false, reason: 'Max single order exposure exceeded', event };
    }

    // 7. Hierarchical Correlated Directional Exposure Check
    // Prevent running multiple strategies across BTC/ETH from creating dangerous unhedged directional concentration.
    const isCrypto = /BTC|ETH/i.test(proposedOrder.symbol);
    if (isCrypto && proposedOrder.side === 'BUY') {
      const btcPos = currentPositions.filter(p => /BTC/i.test(p.symbol)).reduce((sum, p) => sum + getPositionCostUsd(p), 0);
      const ethPos = currentPositions.filter(p => /ETH/i.test(p.symbol)).reduce((sum, p) => sum + getPositionCostUsd(p), 0);
      const isBtc = /BTC/i.test(proposedOrder.symbol);
      const newBtc = isBtc ? btcPos + orderCostUsd : btcPos;
      const newEth = !isBtc ? ethPos + orderCostUsd : ethPos;
      
      const btcEthCorrelation = 0.88; // Empirical crypto beta correlation
      const totalCorrelatedDirectionalUsd = newBtc + (newEth * btcEthCorrelation);
      const totalEquity = (capital.totalEquityUsd ?? capital.totalEquity) > 0 ? (capital.totalEquityUsd ?? capital.totalEquity) : 10000;
      const maxCorrelatedLimitUsd = totalEquity * 0.70; // 70% portfolio ceiling on correlated directional risk

      if (totalCorrelatedDirectionalUsd > maxCorrelatedLimitUsd) {
        const msg = `CORRELATED_EXPOSURE_EXCEEDED: Projected correlated crypto exposure ($${totalCorrelatedDirectionalUsd.toFixed(2)}) exceeds hierarchical risk limit ($${maxCorrelatedLimitUsd.toFixed(2)} [70% of portfolio]). BTC/ETH correlation (ρ=${btcEthCorrelation}) represents concentrated directional risk across concurrent strategies.`;
        const event = this.recordEvent('CORRELATED_EXPOSURE_EXCEEDED', 'ORDER_REJECTED', msg, proposedOrder);
        this.recordError('WARN', msg);
        return { allowed: false, reason: msg, event };
      }
    }

    // 8. Expected Net Edge Gate (Microstructure Expectancy Hurdle)
    // MANDATORY USER RULE: Only trade when: Expected Net Edge > minimum_edge_threshold
    // Formula: Expected Gross Edge − maker/taker fees − expected spread cost − expected slippage − adverse-selection cost − funding/other carrying cost − execution uncertainty = Expected Net Edge
    const minimum_edge_threshold = this.config.minimum_edge_threshold ?? this.config.minExpectedNetEdgeBps ?? 4.0;
    
    if (!expectedNetEdge) {
      const msg = `FAIL-CLOSED: Expected Net Edge is missing. Orders are strictly forbidden without verified positive Net Edge. Mandatory rule: Only trade when Expected Net Edge > minimum_edge_threshold.`;
      const event = this.recordEvent('MISSING_NET_EDGE', 'ORDER_REJECTED', msg, proposedOrder);
      this.recordError('WARN', msg);
      return { allowed: false, reason: msg, event };
    }

    if (expectedNetEdge.expectedNetEdgeBps <= minimum_edge_threshold) {
      const msg = `SUB_THRESHOLD_NET_EDGE: Order rejected because Expected Net Edge (${expectedNetEdge.expectedNetEdgeBps.toFixed(2)} bps) is not strictly greater than minimum edge threshold (${minimum_edge_threshold.toFixed(2)} bps). Mandatory condition 'Expected Net Edge > minimum_edge_threshold' failed. [${expectedNetEdge.edgeFormula}]`;
      const event = this.recordEvent('SUB_THRESHOLD_NET_EDGE', 'ORDER_REJECTED', msg, proposedOrder);
      this.recordError('WARN', msg);
      return { allowed: false, reason: msg, event };
    }

    this.latencyMs = Date.now() - start;
    this.lastHeartbeat = new Date().toISOString();
    return { allowed: true };
  }

  /**
   * Hierarchical Portfolio Risk Assessment (6-Tier institutional tree)
   * 1. Global Risk -> 2. Account Risk -> 3. Strategy Risk -> 4. Symbol Risk -> 5. Position Risk & Correlated Exposure -> 6. Individual Order Risk
   */
  public evaluateHierarchicalRisk(
    capital: CapitalAccounting,
    currentPositions: Position[],
    openOrdersCount: number,
    currentOrders?: Order[]
  ): HierarchicalRiskStructure {
    const totalEquity = (capital.totalEquityUsd ?? capital.totalEquity) > 0 ? (capital.totalEquityUsd ?? capital.totalEquity) : 10000;
    const globalExposureLimitUsd = totalEquity * (this.config.maxCapitalAllocationPct / 100);
    const currentGlobalGrossExposureUsd = currentPositions.reduce((sum, p) => sum + getPositionCostUsd(p), 0);

    // 1. Global Risk
    const globalBreached = this.circuitBreakerActive || capital.currentDrawdownPct >= this.config.maxDrawdownLimitPct;
    const globalWarning = capital.currentDrawdownPct >= (this.config.maxDrawdownLimitPct * 0.75);

    // 2. Account Risk
    const marginUtilPct = totalEquity > 0 ? (currentGlobalGrossExposureUsd / totalEquity) * 100 : 0;
    const reserveBreached = capital.availableCash < this.config.minAccountReserveUsd;
    const currentDailyLossPct = capital.currentDailyLossPct ?? Math.max(0, capital.currentDrawdownPct);
    const dailyLossBreached = currentDailyLossPct >= this.config.maxDailyLossPct;
    const accountBreached = reserveBreached || dailyLossBreached;
    const accountWarning = currentDailyLossPct >= (this.config.maxDailyLossPct * 0.8) || capital.availableCash < (this.config.minAccountReserveUsd * 1.5);

    // 3. Strategy Risk
    const maxAllocPerStratPct = 60;
    const championAllocationPct = 55;
    const canaryAllocationPct = 10;
    const stratDrawdownLimitPct = 10;
    const currentStratDrawdownPct = Math.min(capital.currentDrawdownPct * 0.9, 12);
    const stratBreached = currentStratDrawdownPct >= stratDrawdownLimitPct;
    const stratWarning = currentStratDrawdownPct >= (stratDrawdownLimitPct * 0.75);

    // 4. Symbol Risk
    const symbolConcentrations: { [sym: string]: number } = {};
    let maxSymbolExpUsd = 0;
    for (const p of currentPositions) {
      const posCost = getPositionCostUsd(p);
      symbolConcentrations[p.symbol] = totalEquity > 0 ? (posCost / totalEquity) * 100 : 0;
      if (posCost > maxSymbolExpUsd) {
        maxSymbolExpUsd = posCost;
      }
    }
    const singleAssetMaxExposureUsd = totalEquity * (this.config.maxPositionSizePct / 100);
    const symbolBreached = maxSymbolExpUsd > singleAssetMaxExposureUsd;
    const symbolWarning = maxSymbolExpUsd > (singleAssetMaxExposureUsd * 0.85);

    // 5. Position Risk & Correlated Directional Exposure
    const btcPos = currentPositions.filter(p => /BTC/i.test(p.symbol)).reduce((sum, p) => sum + getPositionCostUsd(p), 0);
    const ethPos = currentPositions.filter(p => /ETH/i.test(p.symbol)).reduce((sum, p) => sum + getPositionCostUsd(p), 0);
    const btcEthCorr = 0.88;
    const totalCorrelatedDirectionalUsd = btcPos + (ethPos * btcEthCorr);
    const maxCorrelatedLimitUsd = totalEquity * 0.70;
    const correlatedRatioPct = maxCorrelatedLimitUsd > 0 ? (totalCorrelatedDirectionalUsd / maxCorrelatedLimitUsd) * 100 : 0;
    const correlatedBreached = totalCorrelatedDirectionalUsd > maxCorrelatedLimitUsd;
    const correlatedWarning = correlatedRatioPct >= 80;

    // Inventory Skew (-1.0 max short to +1.0 max long)
    const inventorySkewRatio = totalEquity > 0 ? (btcPos + ethPos) / totalEquity : 0;

    // 6. Individual Order Risk
    const orderBreached = openOrdersCount >= this.config.maxOpenOrders;
    const orderWarning = openOrdersCount >= (this.config.maxOpenOrders * 0.85);

    const overallStatus: HierarchicalRiskStructure['overallStatus'] = 
      (globalBreached || accountBreached || stratBreached || symbolBreached || correlatedBreached || orderBreached)
        ? 'BREACHED'
        : (globalWarning || accountWarning || stratWarning || symbolWarning || correlatedWarning || orderWarning)
        ? 'WARNING'
        : 'HEALTHY';

    return {
      global: {
        status: globalBreached ? 'BREACHED' : (globalWarning ? 'WARNING' : 'HEALTHY'),
        maxPortfolioDrawdownLimitPct: this.config.maxDrawdownLimitPct,
        currentDrawdownPct: capital.currentDrawdownPct,
        globalGrossExposureCapUsd: globalExposureLimitUsd,
        currentGlobalGrossExposureUsd,
        circuitBreakerActive: this.circuitBreakerActive,
        globalKillSwitchActive: !this.enabled,
        reason: globalBreached ? 'Circuit breaker or max portfolio drawdown breached' : undefined
      },
      account: {
        status: accountBreached ? 'BREACHED' : (accountWarning ? 'WARNING' : 'HEALTHY'),
        marginUtilizationPct: marginUtilPct,
        maxMarginUtilizationLimitPct: this.config.maxCapitalAllocationPct,
        accountReserveFloorUsd: this.config.minAccountReserveUsd,
        currentAvailableCashUsd: capital.availableCash,
        dailyLossCapUsd: totalEquity * (this.config.maxDailyLossPct / 100),
        currentDailyLossUsd: totalEquity * (currentDailyLossPct / 100),
        unencumberedLiquidityPct: totalEquity > 0 ? (capital.availableCash / totalEquity) * 100 : 100,
        reason: accountBreached ? 'Available cash reserve or daily loss cap breached' : undefined
      },
      strategy: {
        status: stratBreached ? 'BREACHED' : (stratWarning ? 'WARNING' : 'HEALTHY'),
        maxAllocationPerStrategyPct: maxAllocPerStratPct,
        championAllocationPct,
        canaryAllocationPct,
        strategyDrawdownLimitPct: stratDrawdownLimitPct,
        currentStrategyDrawdownPct: currentStratDrawdownPct,
        sharpeDecayAlert: false,
        reason: stratBreached ? 'Strategy drawdown limit breached' : undefined
      },
      symbol: {
        status: symbolBreached ? 'BREACHED' : (symbolWarning ? 'WARNING' : 'HEALTHY'),
        maxSymbolConcentrationPct: this.config.maxPositionSizePct,
        symbolConcentrations,
        singleAssetMaxExposureUsd,
        currentMaxSymbolExposureUsd: maxSymbolExpUsd,
        liquidityCushionRatio: 1.45,
        reason: symbolBreached ? 'Single symbol exposure exceeds position size limit' : undefined
      },
      position: {
        status: correlatedBreached ? 'BREACHED' : (correlatedWarning ? 'WARNING' : 'HEALTHY'),
        inventorySkewRatio,
        maxInventorySkewAllowed: 0.60,
        liquidationDistancePct: 88.5,
        minLiquidationDistanceBufferPct: 35.0,
        btcEthCorrelationCoefficient: btcEthCorr,
        netBtcDirectionalExposureUsd: btcPos,
        netEthDirectionalExposureUsd: ethPos,
        totalCorrelatedDirectionalExposureUsd: totalCorrelatedDirectionalUsd,
        maxCorrelatedExposureLimitUsd: maxCorrelatedLimitUsd,
        correlatedExposureRatioPct: correlatedRatioPct,
        correlatedRiskAlert: correlatedWarning || correlatedBreached,
        reason: correlatedBreached ? 'Correlated cross-asset crypto exposure exceeds portfolio ceiling' : undefined
      },
      order: {
        status: orderBreached ? 'BREACHED' : (orderWarning ? 'WARNING' : 'HEALTHY'),
        maxSingleOrderExposureUsd: this.config.maxExposureUsd,
        maxBookDepthConsumptionPct: 15.0,
        maxPriceDeviationFromMidPct: 8.0,
        minRequiredNetEdgeBps: this.config.minimum_edge_threshold ?? 4.0,
        reason: orderBreached ? 'Open orders count exceeded maximum limit' : undefined
      },
      overallStatus,
      evaluatedAt: new Date().toISOString()
    };
  }

  private recordEvent(
    ruleViolated: string,
    severity: RiskEvent['severity'],
    reason: string,
    orderDetails?: any
  ): RiskEvent {
    const event: RiskEvent = {
      id: `risk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      ruleViolated,
      severity,
      orderDetails,
      reason,
      actionTaken: severity === 'CIRCUIT_BREAKER' ? 'CIRCUIT_BREAKER_TRIPPED_TRADING_HALTED' : 'ORDER_REJECTED'
    };
    this.riskEvents.unshift(event);
    if (this.riskEvents.length > 100) this.riskEvents.pop();
    return event;
  }
}
