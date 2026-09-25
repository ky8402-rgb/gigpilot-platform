import {
  AuditLog,
  AutonomyLevel,
  CapitalAccounting,
  DestinationWallet,
  GridConfiguration,
  GridLevel,
  MarketRegime,
  MasterTradingState,
  Order,
  Position,
  ProfitSweep,
  ResearchItem,
  RiskRuleConfig,
  StrategyVersion,
  SystemUpdate,
  TechnicalIndicators,
  TradingMode
} from '../types/trading';

export const DEFAULT_PAIRS: Array<{symbol:string;price:number;open24h:number;high24h:number;low24h:number;volume24h:number;change24hPct:number}> = [];

export function getBasePairPrice(symbol: string): number {
  if (!symbol) return 0;
  const norm = symbol.replace(/[\/\-_]/g, '').toUpperCase();
  const pair = DEFAULT_PAIRS.find(p => p.symbol.replace(/[\/\-_]/g, '').toUpperCase() === norm);
  return pair ? pair.price : 0;
}

export const DEFAULT_CAPITAL: CapitalAccounting = {
  initialCapital: 0, totalEquity: 0, tradingCapital: 0, availableCash: 0, lockedInOrders: 0,
  profitReserve: 0, eligibleRealizedProfit: 0, withdrawableProfit: 0, totalSweptProfit: 0,
  netRealizedProfit: 0, unrealizedProfit: 0, grossProfit: 0, totalTradingFees: 0,
  totalSlippageCost: 0, totalFundingCosts: 0, totalWithdrawalCosts: 0, roiPct: 0,
  annualizedReturnPct: 0, sharpeRatio: 0, sortinoRatio: 0, maxDrawdownPct: 0,
  currentDrawdownPct: 0, winRatePct: 0, profitFactor: 0, totalTrades: 0,
  winningTrades: 0, losingTrades: 0
};

export const DEFAULT_MARKET_REGIME: MarketRegime = {
  regime: 'RANGE_BOUND_LOW_VOL', confidence: 0, atr: 0, rsi: 0, adx: 0, bbBandwidth: 0,
  orderBookImbalance: 0, trendDirection: 'NEUTRAL', recommendedGridSpacing: 0,
  suggestedAction: 'Awaiting live Bybit market data', detectedAt: ''
};

export const DEFAULT_INDICATORS: TechnicalIndicators = {
  rsi14: 0, macd: { macd: 0, signal: 0, histogram: 0 }, ema9: 0, ema21: 0, ema50: 0,
  ema200: 0, bollingerBands: { upper: 0, middle: 0, lower: 0, bandwidth: 0 },
  atr14: 0, vwap: 0, spreadBps: 0, volatility24h: 0
};

export function generateDefaultIndicators(_price?: number): TechnicalIndicators {
  return { ...DEFAULT_INDICATORS };
}

export const DEFAULT_CHAMPION_STRATEGY: StrategyVersion = {
  id: 'STRAT-GRID-001', name: 'Dynamic Volatility-Scaled Geometric Grid', version: 'v1.0.0-LIVE',
  type: 'ADAPTIVE_GRID', status: 'CHAMPION', createdAt: '', reasonForChange: 'Awaiting verified live trading evidence.',
  parameters: {
    upperBoundary: 72500,
    lowerBoundary: 61000,
    gridLevels: 24,
    spacingType: 'GEOMETRIC',
    gridSpacingPct: 0.72,
    volatilityMultiplier: 1.15,
    trendFilterEma: 50,
    rsiFilterThreshold: 35,
    stopLossPct: 8.5,
    takeProfitPct: 15,
    rebalanceIntervalSec: 120
  },
  liveTradingResults: {
    netProfit: 0, grossProfit: 0, totalFees: 0, roiPct: 0, sharpeRatio: 0, sortinoRatio: 0,
    maxDrawdownPct: 0, winRatePct: 0, profitFactor: 0, tradesCount: 0, avgTradeProfitUsd: 0,
    avgHoldingTimeMinutes: 0, orderFillRatePct: 0, capitalUtilizationPct: 0
  },
  validationScore: 0, expectedEffect: 'Awaiting verified live trading evidence.'
};

export const DEFAULT_DESTINATION_WALLET: DestinationWallet = {
  address: '', chain: '', label: 'Unconfigured', isWhitelisted: false, addedAt: '', lastVerifiedAt: ''
};

export function generateDefaultGrid(symbol: string = 'BTC/USDT', price?: number): GridConfiguration {
  const p = (price && price > 0) ? price : 0;
  const isSmall = p > 0 && p < 1;
  const isMid = p > 0 && p < 100;
  const decimals = isSmall ? 5 : (isMid ? 3 : 2);

  const upperBoundary = Number((p * 1.08).toFixed(decimals));
  const lowerBoundary = Number((p * 0.92).toFixed(decimals));
  const levelsCount = 20;
  const activeLevels: GridLevel[] = [];

  const step = levelsCount > 1 ? (upperBoundary - lowerBoundary) / (levelsCount - 1) : 0;
  for (let i = 0; i < levelsCount; i++) {
    const levelPrice = Number((lowerBoundary + step * i).toFixed(decimals));
    const side = levelPrice < p ? 'BUY' : 'SELL';
    const orderSize = levelPrice > 0 ? Number((175 / levelPrice).toFixed(isSmall ? 2 : 6)) : 0;
    activeLevels.push({
      id: `grid-${symbol.toLowerCase().replace(/[\/\-_]/g, '')}-${i}`,
      index: i,
      price: levelPrice,
      side: side as 'BUY' | 'SELL',
      orderSize,
      valueUsd: 175,
      status: 'PLACED'
    });
  }

  return {
    id: `grid_cfg_${symbol.replace(/[\/\-_]/g, '_')}`,
    symbol,
    upperBoundary,
    lowerBoundary,
    levelsCount,
    spacingType: 'GEOMETRIC',
    gridSpacingPct: 0.72,
    totalAllocatedUsd: 3500,
    orderSizeUsd: 175,
    volatilityAdjustment: true,
    trendProtection: true,
    rebalanceThresholdPct: 1.5,
    activeLevels,
    lastRebalancedAt: new Date().toISOString()
  };
}

export function generateDefaultOrders(_symbol: string = 'BTC/USDT', _price?: number): Order[] {
  // Live-only mode: No synthetic or paper orders generated.
  // Real orders only populate when fetched from Bybit exchange execution engine.
  return [];
}

export function generateDefaultPosition(symbol: string = 'BTC/USDT', price?: number): Position {
  const p = (price && price > 0) ? price : 0;
  return {
    symbol,
    baseAmount: 0,
    quoteAmount: 0,
    entryPrice: 0,
    currentPrice: p,
    unrealizedPnL: 0,
    unrealizedPnLPct: 0,
    realizedPnL: 0,
    totalFeesPaid: 0,
    netPnL: 0,
    liquidationPrice: 0
  };
}

export function generateDefaultMasterState(symbol: string = 'BTC/USDT'): MasterTradingState {
  const price = getBasePairPrice(symbol);
  const activeGrid = null;
  const openOrders: Order[] = [];
  const position = generateDefaultPosition(symbol, price);
  const indicators = generateDefaultIndicators(price);

  return {
    success: true,
    activeSymbol: symbol,
    autonomyLevel: 0, // LEVEL 0 SAFETY OBSERVE DEFAULT
    tradingMode: 'LIVE',
    GLOBAL_KILL_SWITCH_ACTIVE: true,
    botsDisabled: true,
    activeBotsCount: 0,
    killSwitch: {
      isActive: true,
      triggeredBy: 'Production Startup (Safe Fail-Closed Default)',
      ordersCancelledCount: 0,
      positionsLiquidated: false
    },
    capital: { ...DEFAULT_CAPITAL },
    currentRegime: { ...DEFAULT_MARKET_REGIME },
    activeGrid,
    position,
    allPositions: [],
    openOrders,
    recentFills: [],
    indicators,
    championStrategy: { ...DEFAULT_CHAMPION_STRATEGY },
    circuitBreakerActive: false,
    destinationWallet: { ...DEFAULT_DESTINATION_WALLET },
    sweepEligibility: {
      eligibleAmount: 0,
      canSweep: false,
      reserveRetained: 300.00
    },
    serverTime: new Date().toISOString()
  };
}

export const DEFAULT_RESEARCH_ITEMS: ResearchItem[] = [];

export const DEFAULT_RISK_DATA: RiskRuleConfig = {
  maxPositionSizePct: 25,
  maxCapitalAllocationPct: 40,
  maxDailyLossPct: 3.0,
  maxDrawdownLimitPct: 5.0,
  maxOpenOrders: 30,
  maxLeverage: 1.0,
  maxExposureUsd: 5000,
  maxSlippageBps: 15,
  minOrderBookLiquidityUsd: 100000,
  minAccountReserveUsd: 300,
  autoKillSwitchTriggerDrawdownPct: 5.0
};

export const DEFAULT_SWEEPS: ProfitSweep[] = [];

export const DEFAULT_AUDIT_LOGS: AuditLog[] = [];

export const DEFAULT_SYSTEM_UPDATES: SystemUpdate[] = [];
