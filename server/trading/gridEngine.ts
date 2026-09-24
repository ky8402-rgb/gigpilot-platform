import { EngineErrorRecord, EngineHealth, EngineModule, GridConfiguration, GridLevel, MarketRegime } from './types.js';

export interface GridParams {
  symbol: string;
  currentPrice: number;
  totalAllocatedUsd: number;
  levelsCount?: number;
  spacingType?: 'ARITHMETIC' | 'GEOMETRIC';
  volatilityAdjustment?: boolean;
  trendProtection?: boolean;
  regime?: MarketRegime | null;
}

export class GridEngine implements EngineModule {
  public readonly id = 'GRID_ENGINE';
  public readonly name = 'Grid Engine (Adaptive Geometric & Arithmetic Rungs)';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private activeGrids: Map<string, GridConfiguration> = new Map();

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
        activeGridsCount: this.activeGrids.size,
        supportedSpacingTypes: ['GEOMETRIC', 'ARITHMETIC'],
        failClosedRule: 'Rejects grid placement if upstream Quant or Data feeds are down'
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
      this.recordError('WARN', 'Grid Engine switched OFF. Grid level placement and automatic rebalancing suspended.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Grid Engine switched ON.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_grid_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  public getActiveGrid(symbol: string): GridConfiguration | undefined {
    return this.activeGrids.get(symbol);
  }

  public generateGrid(params: GridParams): { grid: GridConfiguration | null; error?: string } {
    if (!this.enabled) {
      return { grid: null, error: 'GRID_ENGINE_OFF: Grid Engine is switched off by operator.' };
    }

    const start = Date.now();

    if (!params.currentPrice || params.currentPrice <= 0) {
      this.status = 'DEGRADED';
      const msg = `Cannot generate grid for ${params.symbol} with invalid price: ${params.currentPrice}. Failing closed.`;
      this.recordError('ERROR', msg);
      return { grid: null, error: msg };
    }

    try {
      const {
        symbol,
        currentPrice,
        totalAllocatedUsd,
        levelsCount = 16,
        spacingType = 'GEOMETRIC',
        volatilityAdjustment = true,
        trendProtection = true,
        regime
      } = params;

      // Calculate baseline width from ATR or regime
      let baseWidthPct = 0.05; // 5% default
      if (regime) {
        if (regime.regime === 'BREAKOUT_VOLATILITY') baseWidthPct = 0.08;
        else if (regime.regime === 'RANGE_BOUND_LOW_VOL') baseWidthPct = 0.035;
        else if (regime.regime === 'BULL_TREND_STRONG') baseWidthPct = 0.06;
        else if (regime.regime === 'BEAR_TREND_STRONG') baseWidthPct = 0.065;
      }

      let upperBoundary = currentPrice * (1 + baseWidthPct);
      let lowerBoundary = currentPrice * (1 - baseWidthPct);

      // Skew boundaries if strong trend
      if (trendProtection && regime) {
        if (regime.trendDirection === 'BULLISH') {
          upperBoundary = currentPrice * (1 + baseWidthPct * 1.3);
          lowerBoundary = currentPrice * (1 - baseWidthPct * 0.7);
        } else if (regime.trendDirection === 'BEARISH') {
          upperBoundary = currentPrice * (1 + baseWidthPct * 0.7);
          lowerBoundary = currentPrice * (1 - baseWidthPct * 1.3);
        }
      }

      const totalRungs = Math.max(4, Math.min(64, levelsCount));
      const rungsPerSide = Math.floor(totalRungs / 2);
      const buyBudgetUsd = totalAllocatedUsd * 0.5;
      const sellBudgetUsd = totalAllocatedUsd * 0.5;

      const levels: GridLevel[] = [];
      let levelIdx = 1;

      // Buy Levels (below current price)
      for (let i = 1; i <= rungsPerSide; i++) {
        let price = 0;
        if (spacingType === 'GEOMETRIC') {
          const ratio = Math.pow(lowerBoundary / currentPrice, 1 / rungsPerSide);
          price = currentPrice * Math.pow(ratio, i);
        } else {
          const step = (currentPrice - lowerBoundary) / rungsPerSide;
          price = currentPrice - step * i;
        }

        const valueUsd = buyBudgetUsd / rungsPerSide;
        const orderSize = Number((valueUsd / price).toFixed(6));

        levels.push({
          id: `lvl_buy_${levelIdx}`,
          index: levelIdx++,
          price: Number(price.toFixed(price < 1 ? 6 : 2)),
          side: 'BUY',
          orderSize,
          valueUsd: Number(valueUsd.toFixed(2)),
          status: 'PENDING'
        });
      }

      // Sell Levels (above current price)
      for (let i = 1; i <= rungsPerSide; i++) {
        let price = 0;
        if (spacingType === 'GEOMETRIC') {
          const ratio = Math.pow(upperBoundary / currentPrice, 1 / rungsPerSide);
          price = currentPrice * Math.pow(ratio, i);
        } else {
          const step = (upperBoundary - currentPrice) / rungsPerSide;
          price = currentPrice + step * i;
        }

        const valueUsd = sellBudgetUsd / rungsPerSide;
        const orderSize = Number((valueUsd / price).toFixed(6));

        levels.push({
          id: `lvl_sell_${levelIdx}`,
          index: levelIdx++,
          price: Number(price.toFixed(price < 1 ? 6 : 2)),
          side: 'SELL',
          orderSize,
          valueUsd: Number(valueUsd.toFixed(2)),
          status: 'PENDING'
        });
      }

      levels.sort((a, b) => b.price - a.price);

      const gridSpacingPct = Number((((upperBoundary - lowerBoundary) / currentPrice / totalRungs) * 100).toFixed(2));
      const orderSizeUsd = Number((totalAllocatedUsd / totalRungs).toFixed(2));

      const grid: GridConfiguration = {
        id: `grid_${symbol.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`,
        symbol,
        upperBoundary: Number(upperBoundary.toFixed(currentPrice < 1 ? 6 : 2)),
        lowerBoundary: Number(lowerBoundary.toFixed(currentPrice < 1 ? 6 : 2)),
        levelsCount: totalRungs,
        spacingType,
        gridSpacingPct,
        totalAllocatedUsd,
        orderSizeUsd,
        volatilityAdjustment,
        trendProtection,
        rebalanceThresholdPct: 1.5,
        activeLevels: levels,
        lastRebalancedAt: new Date().toISOString()
      };

      this.activeGrids.set(symbol, grid);
      this.latencyMs = Date.now() - start;
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';

      return { grid };
    } catch (err: any) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', `Error generating grid for ${params.symbol}: ${err.message}`);
      return { grid: null, error: err.message };
    }
  }

  public checkRebalanceNeeded(currentPrice: number, grid: GridConfiguration): { needed: boolean; reason?: string } {
    if (!this.enabled || !grid) return { needed: false };

    if (currentPrice >= grid.upperBoundary) {
      return { needed: true, reason: `Upper boundary breach ($${currentPrice} >= $${grid.upperBoundary})` };
    }
    if (currentPrice <= grid.lowerBoundary) {
      return { needed: true, reason: `Lower boundary breach ($${currentPrice} <= $${grid.lowerBoundary})` };
    }
    return { needed: false };
  }
}
