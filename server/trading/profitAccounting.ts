import { CapitalAccounting, EngineErrorRecord, EngineHealth, EngineModule, Fill, Position } from './types.js';

export class ProfitAccountingEngine implements EngineModule {
  public readonly id = 'PROFIT_ACCOUNTING';
  public readonly name = 'Profit Accounting & Capital Segregator';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private capital: CapitalAccounting;
  private fifoLots: Map<string, Array<{ qty: number; unitCost: number }>> = new Map();
  private processedFillIds = new Set<string>();

  constructor() {
    this.capital = {
      initialCapital: 0.0,
      totalEquity: 0.0,
      tradingCapital: 0.0,
      availableCash: 0.0,
      lockedInOrders: 0.0,
      profitReserve: 0.0,
      eligibleRealizedProfit: 0.0,
      withdrawableProfit: 0.0,
      totalSweptProfit: 0.0,
      netRealizedProfit: 0.0,
      unrealizedProfit: 0.0,
      grossProfit: 0.0,
      totalTradingFees: 0.0,
      totalSlippageCost: 0.0,
      totalFundingCosts: 0.0,
      totalWithdrawalCosts: 0.0,
      roiPct: 0.0,
      annualizedReturnPct: 0.0,
      sharpeRatio: 0.0,
      sortinoRatio: 0.0,
      maxDrawdownPct: 0.0,
      currentDrawdownPct: 0.0,
      winRatePct: 0.0,
      profitFactor: 0.0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0
    };
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
        totalEquity: this.capital.totalEquity,
        netRealizedProfit: this.capital.netRealizedProfit,
        eligibleRealizedProfit: this.capital.eligibleRealizedProfit,
        totalSweptProfit: this.capital.totalSweptProfit,
        tradesProcessed: this.capital.totalTrades,
        accountingStandard: 'FIFO_EXACT_REALIZED'
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
      this.recordError('WARN', 'Profit Accounting Engine switched OFF.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Profit Accounting Engine switched ON.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_acct_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  public getCapital(): CapitalAccounting {
    return { ...this.capital };
  }

  public syncFromRealAccount(balances: {
    totalEquityUsd: number;
    availableCashUsd: number;
    lockedInOrdersUsd: number;
    recentTradesCount?: number;
  }) {
    if (!this.enabled) return;
    const start = Date.now();

    try {
      this.capital.totalEquity = balances.totalEquityUsd;
      this.capital.availableCash = balances.availableCashUsd;
      this.capital.lockedInOrders = balances.lockedInOrdersUsd;
      this.capital.tradingCapital = balances.totalEquityUsd;

      if (this.capital.initialCapital === 0 && balances.totalEquityUsd > 0) {
        this.capital.initialCapital = balances.totalEquityUsd;
      }

      if (balances.recentTradesCount) {
        this.capital.totalTrades = balances.recentTradesCount;
      }

      this.latencyMs = Date.now() - start;
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';
    } catch (err: any) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', `Failed to sync capital balances: ${err.message}`);
    }
  }

  public recordFill(fill: Fill) {
    if (!this.enabled || this.processedFillIds.has(fill.id) || !Number.isFinite(fill.price) || !Number.isFinite(fill.amount) || fill.amount <= 0) return;

    this.processedFillIds.add(fill.id);
    if (this.processedFillIds.size > 10000) {
      const oldest = this.processedFillIds.values().next().value;
      if (oldest) this.processedFillIds.delete(oldest);
    }

    const symbol = fill.symbol;
    const lots = this.fifoLots.get(symbol) || [];
    let realized = 0;

    if (fill.side === 'BUY') {
      const totalCost = fill.price * fill.amount + Math.max(0, fill.feeUsd);
      lots.push({
        qty: fill.amount,
        unitCost: totalCost / fill.amount
      });
    } else {
      let remaining = fill.amount;
      const proceedsPerUnit = fill.price;
      while (remaining > 1e-12 && lots.length > 0) {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.qty);
        realized += (proceedsPerUnit * matched) - (lot.unitCost * matched);
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-12) lots.shift();
      }

      // A sell without a corresponding locally known lot is deliberately not treated
      // as profit. This prevents invented P&L after restarts or incomplete history.
      if (remaining > 1e-12) {
        this.recordError('WARN', 'FIFO accounting could not match the complete live sell fill; unmatched quantity was excluded from realized P&L.', {
          symbol, orderId: fill.orderId, unmatchedQty: remaining
        });
      }

      realized -= Math.max(0, fill.feeUsd);
    }

    this.fifoLots.set(symbol, lots);

    this.capital.totalTrades += 1;
    this.capital.totalTradingFees += Math.max(0, fill.feeUsd);
    this.capital.totalSlippageCost += Math.max(0, fill.slippageBps) * Math.max(0, fill.price * fill.amount) / 10000;

    if (realized !== 0) {
      this.capital.grossProfit += realized;
      this.capital.netRealizedProfit += realized;

      if (realized > 0) {
        this.capital.winningTrades += 1;
        const sweepablePortion = realized * 0.70;
        if (sweepablePortion > 0) {
          this.capital.eligibleRealizedProfit += sweepablePortion;
          this.capital.withdrawableProfit = this.capital.eligibleRealizedProfit;
        }
      } else {
        this.capital.losingTrades += 1;
        this.capital.eligibleRealizedProfit = Math.max(0, this.capital.eligibleRealizedProfit + realized);
        this.capital.withdrawableProfit = this.capital.eligibleRealizedProfit;
      }

      this.capital.winRatePct = Number(((this.capital.winningTrades / (this.capital.winningTrades + this.capital.losingTrades || 1)) * 100).toFixed(2));
      const gains = Math.max(0, this.capital.grossProfit);
      const losses = Math.max(0, -this.capital.netRealizedProfit);
      this.capital.profitFactor = losses > 0 ? Number((gains / losses).toFixed(2)) : gains > 0 ? Infinity : 0;
    }
  }

  public recordSweepExecuted(amountUsd: number) {
    this.capital.totalSweptProfit += amountUsd;
    this.capital.eligibleRealizedProfit = Math.max(0, this.capital.eligibleRealizedProfit - amountUsd);
    this.capital.withdrawableProfit = this.capital.eligibleRealizedProfit;
    this.capital.totalEquity = Math.max(0, this.capital.totalEquity - amountUsd);
    this.capital.availableCash = Math.max(0, this.capital.availableCash - amountUsd);
  }
}
