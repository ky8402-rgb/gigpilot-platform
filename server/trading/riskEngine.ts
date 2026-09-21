import { CapitalAccounting, Order, Position, RiskEvent, RiskRuleConfig } from './types.js';

export class RiskEngine {
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

  public getConfig(): RiskRuleConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<RiskRuleConfig>): RiskRuleConfig {
    const next = { ...this.config };

    const bounded = (
      key: keyof RiskRuleConfig,
      min: number,
      max: number,
      integer = false
    ) => {
      const raw = newConfig[key];
      if (raw === undefined) return;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`Risk setting ${String(key)} must be a finite number.`);
      }
      const normalized = integer ? Math.round(value) : value;
      next[key] = Math.min(max, Math.max(min, normalized)) as never;
    };

    bounded('maxPositionSizePct', 0.1, 100);
    bounded('maxCapitalAllocationPct', 0.1, 100);
    bounded('maxDailyLossPct', 0.1, 100);
    bounded('maxDrawdownLimitPct', 0.1, 100);
    bounded('maxOpenOrders', 1, 200, true);
    // GigPilot is Binance Spot only: leverage above 1 is never permitted.
    bounded('maxLeverage', 1, 1);
    bounded('maxExposureUsd', 1, 1_000_000_000);
    bounded('maxSlippageBps', 0, 500);
    bounded('minOrderBookLiquidityUsd', 0, 1_000_000_000);
    bounded('minAccountReserveUsd', 0, 1_000_000_000);
    bounded('autoKillSwitchTriggerDrawdownPct', 0.1, 100);

    this.config = next;
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
  }

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
    openOrdersCount: number
  ): { allowed: boolean; reason?: string; event?: RiskEvent } {
    if (!Number.isFinite(proposedOrder.price) || !Number.isFinite(proposedOrder.amount) || proposedOrder.price <= 0 || proposedOrder.amount <= 0) {
      const event = this.recordEvent(
        'INVALID_ORDER_PARAMETERS',
        'ORDER_REJECTED',
        'Order price and amount must be finite positive numbers.',
        proposedOrder
      );
      return { allowed: false, reason: 'Invalid order price or amount', event };
    }

    if (!Number.isFinite(capital.totalEquity) || capital.totalEquity <= 0) {
      const event = this.recordEvent(
        'INVALID_CAPITAL_STATE',
        'ORDER_REJECTED',
        'Trading capital is unavailable or invalid; order gateway is fail-closed.',
        proposedOrder
      );
      return { allowed: false, reason: 'Invalid or unavailable capital state', event };
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

    // 2. Max Drawdown limit check
    if (capital.currentDrawdownPct >= this.config.maxDrawdownLimitPct) {
      this.circuitBreakerActive = true;
      const event = this.recordEvent(
        'MAX_DRAWDOWN_EXCEEDED',
        'CIRCUIT_BREAKER',
        `Current drawdown ${capital.currentDrawdownPct.toFixed(2)}% exceeds hard limit ${this.config.maxDrawdownLimitPct}%. Circuit breaker tripped.`,
        proposedOrder
      );
      return { allowed: false, reason: 'Max portfolio drawdown limit exceeded', event };
    }

    // 3. Max Open Orders check
    if (openOrdersCount >= this.config.maxOpenOrders) {
      const event = this.recordEvent(
        'MAX_OPEN_ORDERS',
        'ORDER_REJECTED',
        `Open orders count (${openOrdersCount}) reached ceiling (${this.config.maxOpenOrders})`,
        proposedOrder
      );
      return { allowed: false, reason: 'Max open orders limit reached', event };
    }

    // 4. Min Account Reserve protection
    if (proposedOrder.side === 'BUY') {
      const remainingCash = capital.availableCash - orderCostUsd;
      if (remainingCash < this.config.minAccountReserveUsd) {
        const event = this.recordEvent(
          'MIN_ACCOUNT_RESERVE_VIOLATION',
          'ORDER_REJECTED',
          `Order cost $${orderCostUsd.toFixed(2)} leaves $${remainingCash.toFixed(2)}, below required reserve buffer $${this.config.minAccountReserveUsd}`,
          proposedOrder
        );
        return { allowed: false, reason: 'Violates minimum required cash reserve buffer', event };
      }
    }

    // 5. Max Position Size check (e.g. max 25% in a single asset)
    const existingPosition = currentPositions.find(p => p.symbol === proposedOrder.symbol);
    const existingPositionValue = existingPosition ? existingPosition.baseAmount * proposedOrder.price : 0;
    const newPositionValue = proposedOrder.side === 'BUY' ? existingPositionValue + orderCostUsd : existingPositionValue;
    const maxPositionUsd = (capital.totalEquity * this.config.maxPositionSizePct) / 100;

    if (newPositionValue > maxPositionUsd && proposedOrder.side === 'BUY') {
      const event = this.recordEvent(
        'MAX_POSITION_SIZE_EXCEEDED',
        'ORDER_REJECTED',
        `Resulting position $${newPositionValue.toFixed(2)} would exceed max position limit $${maxPositionUsd.toFixed(2)} (${this.config.maxPositionSizePct}% of equity)`,
        proposedOrder
      );
      return { allowed: false, reason: 'Exceeds maximum position size percentage limit', event };
    }

    // 6. Max Exposure check across all positions
    const totalExposure = currentPositions.reduce((acc, p) => acc + (p.baseAmount * p.currentPrice), 0) + (proposedOrder.side === 'BUY' ? orderCostUsd : 0);
    const maxAllowedExposure = (capital.totalEquity * this.config.maxCapitalAllocationPct) / 100;

    // Hard USD exposure ceiling is independent of the percentage ceiling.
    if (totalExposure > this.config.maxExposureUsd && proposedOrder.side === 'BUY') {
      const event = this.recordEvent(
        'MAX_EXPOSURE_USD_EXCEEDED',
        'ORDER_REJECTED',
        `Total exposure ${totalExposure.toFixed(2)} exceeds hard exposure ceiling ${this.config.maxExposureUsd.toFixed(2)}`,
        proposedOrder
      );
      return { allowed: false, reason: 'Exceeds maximum USD exposure limit', event };
    }

    if (totalExposure > maxAllowedExposure && proposedOrder.side === 'BUY') {
      const event = this.recordEvent(
        'MAX_CAPITAL_ALLOCATION_EXCEEDED',
        'ORDER_REJECTED',
        `Total capital allocation $${totalExposure.toFixed(2)} exceeds ${this.config.maxCapitalAllocationPct}% ceiling ($${maxAllowedExposure.toFixed(2)})`,
        proposedOrder
      );
      return { allowed: false, reason: 'Exceeds maximum capital allocation threshold', event };
    }

    return { allowed: true };
  }

  private recordEvent(
    ruleViolated: string,
    severity: RiskEvent['severity'],
    reason: string,
    orderDetails?: any
  ): RiskEvent {
    const event: RiskEvent = {
      id: `risk_evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ruleViolated,
      severity,
      orderDetails,
      reason,
      actionTaken: severity === 'CIRCUIT_BREAKER' ? 'Trip circuit breaker & halt autonomous fills' : 'Order rejected at gateway'
    };
    this.riskEvents.unshift(event);
    if (this.riskEvents.length > 200) this.riskEvents.pop();
    return event;
  }
}
