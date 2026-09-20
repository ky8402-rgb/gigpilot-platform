import { GridConfiguration, GridLevel, MarketRegime } from './types.js';

export interface GridParamsInput {
  symbol: string;
  currentPrice: number;
  upperBoundary?: number;
  lowerBoundary?: number;
  levelsCount?: number;
  spacingType?: 'ARITHMETIC' | 'GEOMETRIC';
  totalAllocatedUsd: number;
  volatilityAdjustment?: boolean;
  trendProtection?: boolean;
  regime?: MarketRegime;
}

export function generateAdaptiveGrid(params: GridParamsInput): GridConfiguration {
  const {
    symbol,
    currentPrice,
    totalAllocatedUsd,
    spacingType = 'ARITHMETIC',
    volatilityAdjustment = true,
    trendProtection = true,
    regime
  } = params;

  let levelsCount = params.levelsCount || 20;
  if (levelsCount < 5) levelsCount = 5;
  if (levelsCount > 60) levelsCount = 60;

  // Calculate default upper and lower boundaries based on ATR and Volatility if not manually locked
  let upper = params.upperBoundary;
  let lower = params.lowerBoundary;

  const volatilityMultiplier = regime?.bbBandwidth ? Math.max(0.8, regime.bbBandwidth / 3.0) : 1.0;
  const gridWidthPct = 0.08 * (volatilityAdjustment ? volatilityMultiplier : 1.0); // 8% base band

  if (!upper || upper <= currentPrice) {
    let upwardMultiplier = 1 + gridWidthPct;
    if (trendProtection && regime?.trendDirection === 'BULLISH') {
      upwardMultiplier = 1 + (gridWidthPct * 1.35); // Expand upside in bull trend
    }
    upper = Number((currentPrice * upwardMultiplier).toFixed(2));
  }

  if (!lower || lower >= currentPrice) {
    let downwardMultiplier = 1 - gridWidthPct;
    if (trendProtection && regime?.trendDirection === 'BEARISH') {
      downwardMultiplier = 1 - (gridWidthPct * 1.35); // Defend downside in bear trend
    }
    lower = Number((currentPrice * downwardMultiplier).toFixed(2));
  }

  // Generate levels
  const levels: GridLevel[] = [];
  const orderSizeUsd = totalAllocatedUsd / levelsCount;

  if (spacingType === 'ARITHMETIC') {
    const priceStep = (upper - lower) / (levelsCount - 1);
    for (let i = 0; i < levelsCount; i++) {
      const price = Number((lower + (i * priceStep)).toFixed(2));
      const side = price < currentPrice ? 'BUY' : 'SELL';
      const orderAmount = Number((orderSizeUsd / price).toFixed(6));
      
      levels.push({
        id: `grid-${symbol.toLowerCase()}-${i}-${Date.now()}`,
        index: i,
        price,
        side,
        orderSize: orderAmount,
        valueUsd: Number(orderSizeUsd.toFixed(2)),
        status: 'PLACED'
      });
    }
  } else {
    // Geometric spacing: constant ratio (1 + r)^i
    const ratio = Math.pow(upper / lower, 1 / (levelsCount - 1));
    for (let i = 0; i < levelsCount; i++) {
      const price = Number((lower * Math.pow(ratio, i)).toFixed(2));
      const side = price < currentPrice ? 'BUY' : 'SELL';
      const orderAmount = Number((orderSizeUsd / price).toFixed(6));

      levels.push({
        id: `grid-${symbol.toLowerCase()}-${i}-${Date.now()}`,
        index: i,
        price,
        side,
        orderSize: orderAmount,
        valueUsd: Number(orderSizeUsd.toFixed(2)),
        status: 'PLACED'
      });
    }
  }

  const gridSpacingPct = Number((((upper - lower) / lower / levelsCount) * 100).toFixed(2));

  return {
    id: `grid_cfg_${Date.now()}`,
    symbol,
    upperBoundary: upper,
    lowerBoundary: lower,
    levelsCount,
    spacingType,
    gridSpacingPct,
    totalAllocatedUsd,
    orderSizeUsd: Number(orderSizeUsd.toFixed(2)),
    volatilityAdjustment,
    trendProtection,
    rebalanceThresholdPct: 3.5,
    activeLevels: levels,
    lastRebalancedAt: new Date().toISOString()
  };
}

export function checkRebalanceNeeded(currentPrice: number, grid: GridConfiguration): {
  needed: boolean;
  reason?: string;
} {
  if (currentPrice >= grid.upperBoundary * 0.99) {
    return { needed: true, reason: `Price ${currentPrice} reached upper grid boundary ${grid.upperBoundary}` };
  }
  if (currentPrice <= grid.lowerBoundary * 1.01) {
    return { needed: true, reason: `Price ${currentPrice} reached lower grid boundary ${grid.lowerBoundary}` };
  }
  return { needed: false };
}
