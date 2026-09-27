import { CapitalAccounting, EngineErrorRecord, EngineHealth, EngineModule, Fill } from './types.js';

interface FifoLot {
  quantity: number;
  unitCostUsd: number;
}

export class ProfitAccountingEngine implements EngineModule {
  public readonly id = 'PROFIT_ACCOUNTING';
  public readonly name = 'Profit Accounting & Capital Segregator';

  private enabled = true;
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs = 0;
  private lastHeartbeat = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];
  private capital: CapitalAccounting;
  private fifoLots = new Map<string, FifoLot[]>();
  private processedFillIds = new Set<string>();

  constructor() {
    this.capital = {
      initialCapital: 0, totalEquity: 0, tradingCapital: 0, availableCash: 0, lockedInOrders: 0,
      profitReserve: 0, eligibleRealizedProfit: 0, withdrawableProfit: 0, totalSweptProfit: 0,
      netRealizedProfit: 0, unrealizedProfit: 0, grossProfit: 0, totalTradingFees: 0,
      totalSlippageCost: 0, totalFundingCosts: 0, totalWithdrawalCosts: 0, roiPct: 0,
      annualizedReturnPct: 0, sharpeRatio: 0, sortinoRatio: 0, maxDrawdownPct: 0,
      currentDrawdownPct: 0, winRatePct: 0, profitFactor: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0
    };
  }

  public healthCheck(): EngineHealth {
    return {
      id: this.id, name: this.name, status: !this.enabled ? 'OFF' : this.status, enabled: this.enabled,
      latencyMs: this.latencyMs, lastHeartbeat: this.lastHeartbeat, errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message, errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        totalEquity: this.capital.totalEquity,
        netRealizedProfit: this.capital.netRealizedProfit,
        eligibleRealizedProfit: this.capital.eligibleRealizedProfit,
        totalSweptProfit: this.capital.totalSweptProfit,
        tradesProcessed: this.capital.totalTrades,
        accountingStandard: 'FIFO_EXACT_REALIZED_LIVE_FILLS'
      }
    };
  }

  public getErrorSurface(): EngineErrorRecord[] { return [...this.errorSurface]; }
  public getOffSwitch(): boolean { return this.enabled; }
  public setOffSwitch(enabled: boolean): void {
    this.enabled = enabled;
    this.status = enabled ? 'HEALTHY' : 'OFF';
  }
  public clearErrors(): void { this.errorSurface = []; }
  public getCapital(): CapitalAccounting { return { ...this.capital }; }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any): void {
    const rec: EngineErrorRecord = {
      id: `err_acct_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(), level, message, details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  private recalculateSweepEligibility(): void {
    // Swept profit is permanently unavailable until new realized profit is produced.
    const eligible = Math.max(
      0,
      this.capital.netRealizedProfit - this.capital.profitReserve - this.capital.totalSweptProfit
    );
    this.capital.eligibleRealizedProfit = Number(eligible.toFixed(2));
    this.capital.withdrawableProfit = this.capital.eligibleRealizedProfit;
  }

  public syncFromRealAccount(balances: {
    totalEquityUsd: number;
    availableCashUsd: number;
    lockedInOrdersUsd: number;
  }): void {
    if (!this.enabled) return;
    const start = Date.now();
    if (!Number.isFinite(balances.totalEquityUsd) || balances.totalEquityUsd < 0) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', 'Invalid live Bybit equity received; accounting sync rejected.');
      return;
    }
    this.capital.totalEquity = balances.totalEquityUsd;
    this.capital.availableCash = Math.max(0, balances.availableCashUsd);
    this.capital.lockedInOrders = Math.max(0, balances.lockedInOrdersUsd);
    this.capital.tradingCapital = this.capital.totalEquity;
    if (this.capital.initialCapital === 0 && this.capital.totalEquity > 0) this.capital.initialCapital = this.capital.totalEquity;
    this.capital.roiPct = this.capital.initialCapital > 0
      ? Number(((this.capital.netRealizedProfit / this.capital.initialCapital) * 100).toFixed(2))
      : 0;
    this.recalculateSweepEligibility();
    this.latencyMs = Date.now() - start;
    this.lastHeartbeat = new Date().toISOString();
    this.status = 'HEALTHY';
  }

  public recordFill(fill: Fill): void {
    if (!this.enabled || !fill?.id || this.processedFillIds.has(fill.id)) return;
    if (!Number.isFinite(fill.price) || fill.price <= 0 || !Number.isFinite(fill.amount) || fill.amount <= 0) {
      this.recordError('WARN', `Ignored invalid live fill ${fill?.id || 'unknown'}.`);
      return;
    }

    this.processedFillIds.add(fill.id);
    if (this.processedFillIds.size > 10000) {
      const oldest = this.processedFillIds.values().next().value as string | undefined;
      if (oldest) this.processedFillIds.delete(oldest);
    }

    const symbol = fill.symbol;
    const lots = this.fifoLots.get(symbol) || [];
    const fee = Math.max(0, Number(fill.feeUsd) || 0);
    let realized = 0;
    let matchedQty = 0;

    if (fill.side === 'BUY') {
      const unitCost = (fill.price * fill.amount + fee) / fill.amount;
      lots.push({ quantity: fill.amount, unitCostUsd: unitCost });
    } else {
      let remaining = fill.amount;
      while (remaining > 1e-12 && lots.length) {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.quantity);
        realized += (fill.price * matched) - (lot.unitCostUsd * matched);
        lot.quantity -= matched;
        remaining -= matched;
        matchedQty += matched;
        if (lot.quantity <= 1e-12) lots.shift();
      }
      if (remaining > 1e-12) {
        this.recordError('WARN', `Sell fill ${fill.id} exceeded tracked FIFO inventory; unmatched quantity excluded from realized P&L.`, { symbol, unmatchedQuantity: remaining });
      }
      realized -= fee;
    }

    this.fifoLots.set(symbol, lots);
    this.capital.totalTrades += 1;
    this.capital.totalTradingFees += fee;
    this.capital.totalSlippageCost += Math.max(0, Number(fill.slippageBps) || 0) * fill.price * fill.amount / 10000;

    if (fill.side === 'SELL' && matchedQty > 0) {
      this.capital.grossProfit += realized + fee;
      this.capital.netRealizedProfit += realized;
      if (realized > 0) this.capital.winningTrades += 1;
      else if (realized < 0) this.capital.losingTrades += 1;
    }

    const totalClosed = this.capital.winningTrades + this.capital.losingTrades;
    this.capital.winRatePct = totalClosed > 0 ? Number(((this.capital.winningTrades / totalClosed) * 100).toFixed(2)) : 0;
    const grossGains = Math.max(0, this.capital.grossProfit);
    const grossLosses = Math.max(0, -this.capital.netRealizedProfit);
    this.capital.profitFactor = grossLosses > 0 ? Number((grossGains / grossLosses).toFixed(2)) : (grossGains > 0 ? Infinity : 0);
    this.recalculateSweepEligibility();
    this.lastHeartbeat = new Date().toISOString();
    this.status = 'HEALTHY';
  }

  public recordSweepExecuted(amountUsd: number, feeUsd = 0): void {
    const amount = Math.max(0, amountUsd);
    if (amount <= 0) return;
    this.capital.totalSweptProfit += amount;
    this.capital.totalWithdrawalCosts += Math.max(0, feeUsd);
    this.capital.totalEquity = Math.max(0, this.capital.totalEquity - amount - Math.max(0, feeUsd));
    this.capital.availableCash = Math.max(0, this.capital.availableCash - amount - Math.max(0, feeUsd));
    this.recalculateSweepEligibility();
  }
}
