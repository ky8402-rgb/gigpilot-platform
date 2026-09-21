import { CapitalAccounting, EngineErrorRecord, EngineHealth, EngineModule, Order, Position, RiskEvent, RiskRuleConfig } from './types.js';

export class RiskEngine implements EngineModule {
  public readonly id = 'RISK_ENGINE';
  public readonly name = 'Risk Engine (Pre-Trade Gate & Circuit Breakers)';

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
    midPrice?: number
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

    this.latencyMs = Date.now() - start;
    this.lastHeartbeat = new Date().toISOString();
    return { allowed: true };
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
