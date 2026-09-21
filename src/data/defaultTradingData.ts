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

export const DEFAULT_PAIRS = [
  {
    symbol: 'BTC/USDT',
    price: 66520.40,
    open24h: 65120.00,
    high24h: 67340.00,
    low24h: 64890.00,
    volume24h: 18450.25,
    change24hPct: 2.15
  },
  {
    symbol: 'ETH/USDT',
    price: 3485.60,
    open24h: 3390.00,
    high24h: 3520.00,
    low24h: 3360.00,
    volume24h: 42100.80,
    change24hPct: 2.82
  },
  {
    symbol: 'SOL/USDT',
    price: 158.45,
    open24h: 151.20,
    high24h: 162.30,
    low24h: 149.80,
    volume24h: 89400.10,
    change24hPct: 4.79
  },
  {
    symbol: 'AVAX/USDT',
    price: 28.60,
    open24h: 29.10,
    high24h: 29.85,
    low24h: 27.90,
    volume24h: 15200.50,
    change24hPct: -1.72
  },
  {
    symbol: 'BNB/USDT',
    price: 582.10,
    open24h: 574.50,
    high24h: 588.00,
    low24h: 571.20,
    volume24h: 9850.40,
    change24hPct: 1.32
  }
];

export const DEFAULT_CAPITAL: CapitalAccounting = {
  initialCapital: 10000.00,
  totalEquity: 12480.50,
  tradingCapital: 10000.00,
  availableCash: 7240.20,
  lockedInOrders: 2759.80,
  profitReserve: 300.00,
  eligibleRealizedProfit: 2180.50,
  withdrawableProfit: 1880.50,
  totalSweptProfit: 1500.00,
  netRealizedProfit: 2480.50,
  unrealizedProfit: 320.10,
  grossProfit: 2795.80,
  totalTradingFees: 215.30,
  totalSlippageCost: 35.20,
  totalFundingCosts: 64.80,
  totalWithdrawalCosts: 5.00,
  roiPct: 24.8,
  annualizedReturnPct: 58.4,
  sharpeRatio: 2.52,
  sortinoRatio: 3.28,
  maxDrawdownPct: 4.2,
  currentDrawdownPct: 1.1,
  winRatePct: 79.2,
  profitFactor: 2.34,
  totalTrades: 214,
  winningTrades: 169,
  losingTrades: 45
};

export const DEFAULT_MARKET_REGIME: MarketRegime = {
  regime: 'RANGE_BOUND_LOW_VOL',
  confidence: 0.88,
  atr: 840.5,
  rsi: 48.6,
  adx: 18.2,
  bbBandwidth: 3.4,
  orderBookImbalance: 0.04,
  trendDirection: 'NEUTRAL',
  recommendedGridSpacing: 0.72,
  suggestedAction: 'Maintain geometric grid with mean-reversion rebalancing',
  detectedAt: '2026-09-20T10:00:00.000Z'
};

export const DEFAULT_INDICATORS: TechnicalIndicators = {
  rsi14: 48.6,
  macd: {
    macd: 84.5,
    signal: 62.1,
    histogram: 22.4
  },
  ema9: 66410.2,
  ema21: 66280.5,
  ema50: 65900.0,
  ema200: 64200.0,
  bollingerBands: {
    upper: 67450.0,
    middle: 66320.0,
    lower: 65190.0,
    bandwidth: 3.4
  },
  atr14: 840.5,
  vwap: 66380.0,
  spreadBps: 2.4,
  volatility24h: 2.85
};

export const DEFAULT_CHAMPION_STRATEGY: StrategyVersion = {
  id: 'STRAT-GRID-001',
  name: 'Dynamic Volatility-Scaled Geometric Grid',
  version: 'v1.4.2',
  type: 'ADAPTIVE_GRID',
  status: 'CHAMPION',
  createdAt: '2026-09-13T10:00:00.000Z',
  deployedAt: '2026-09-17T10:00:00.000Z',
  reasonForChange: 'Benchmark validated in walk-forward backtests with 2.52 Sharpe ratio',
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
  backtestResults: {
    netProfit: 1420.50,
    grossProfit: 1610.80,
    totalFees: 190.30,
    roiPct: 14.2,
    sharpeRatio: 2.45,
    sortinoRatio: 3.12,
    maxDrawdownPct: 4.8,
    winRatePct: 78.4,
    profitFactor: 2.18,
    tradesCount: 184,
    avgTradeProfitUsd: 7.72,
    avgHoldingTimeMinutes: 48,
    orderFillRatePct: 91.5,
    capitalUtilizationPct: 65
  },
  validationScore: 94,
  expectedEffect: 'Captures daily volatility swings while keeping inventory delta-neutral',
  actualEffect: 'Exceeded baseline profit targets with stable low drawdown in sideways chop'
};

export const DEFAULT_DESTINATION_WALLET: DestinationWallet = {
  address: '0x178166ffac90e6d94d2c1f822c1026f87641a0ec',
  chain: 'bsc',
  label: 'BSC USDT Payout Destination',
  isWhitelisted: true,
  addedAt: '2026-09-10T12:00:00.000Z',
  lastVerifiedAt: '2026-09-20T08:00:00.000Z'
};

export function generateDefaultGrid(symbol: string = 'BTC/USDT', price: number = 66520): GridConfiguration {
  const upperBoundary = Math.round(price * 1.08);
  const lowerBoundary = Math.round(price * 0.92);
  const levelsCount = 20;
  const activeLevels: GridLevel[] = [];

  const step = (upperBoundary - lowerBoundary) / (levelsCount - 1);
  for (let i = 0; i < levelsCount; i++) {
    const levelPrice = Number((lowerBoundary + step * i).toFixed(2));
    const side = levelPrice < price ? 'BUY' : 'SELL';
    activeLevels.push({
      id: `grid-${symbol.toLowerCase()}-${i}`,
      index: i,
      price: levelPrice,
      side: side as 'BUY' | 'SELL',
      orderSize: Number((175 / levelPrice).toFixed(6)),
      valueUsd: 175,
      status: 'PLACED'
    });
  }

  return {
    id: `grid_cfg_${symbol.replace('/', '_')}`,
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

export function generateDefaultOrders(symbol: string = 'BTC/USDT', price: number = 66520): Order[] {
  const orders: Order[] = [];
  const buyPrices = [price * 0.995, price * 0.988, price * 0.981, price * 0.974, price * 0.967];
  const sellPrices = [price * 1.006, price * 1.013, price * 1.020, price * 1.027, price * 1.034];

  buyPrices.forEach((p, idx) => {
    orders.push({
      id: `ord_buy_${idx}_${Date.now()}`,
      symbol,
      side: 'BUY',
      type: 'GRID_LIMIT',
      price: Number(p.toFixed(2)),
      amount: Number((175 / p).toFixed(6)),
      filledAmount: 0,
      remainingAmount: Number((175 / p).toFixed(6)),
      costUsd: 175,
      status: 'OPEN',
      isGridOrder: true,
      gridLevelId: `grid-${symbol.toLowerCase()}-${idx}`,
      strategyId: 'STRAT-GRID-001',
      mode: 'LIVE',
      feesPaid: 0,
      slippageBps: 0,
      latencyMs: 24,
      placedAt: new Date(Date.now() - (idx + 1) * 60000).toISOString()
    });
  });

  sellPrices.forEach((p, idx) => {
    orders.push({
      id: `ord_sell_${idx}_${Date.now()}`,
      symbol,
      side: 'SELL',
      type: 'GRID_LIMIT',
      price: Number(p.toFixed(2)),
      amount: Number((175 / p).toFixed(6)),
      filledAmount: 0,
      remainingAmount: Number((175 / p).toFixed(6)),
      costUsd: 175,
      status: 'OPEN',
      isGridOrder: true,
      gridLevelId: `grid-${symbol.toLowerCase()}-${idx + 10}`,
      strategyId: 'STRAT-GRID-001',
      mode: 'LIVE',
      feesPaid: 0,
      slippageBps: 0,
      latencyMs: 18,
      placedAt: new Date(Date.now() - (idx + 1) * 55000).toISOString()
    });
  });

  return orders;
}

export function generateDefaultPosition(symbol: string = 'BTC/USDT', price: number = 66520.40): Position {
  return {
    symbol,
    baseAmount: 0.052,
    quoteAmount: 3459.06,
    entryPrice: 66100.00,
    currentPrice: price,
    unrealizedPnL: 21.86,
    unrealizedPnLPct: 0.63,
    realizedPnL: 148.50,
    totalFeesPaid: 12.40,
    netPnL: 157.96,
    liquidationPrice: 58200.00
  };
}

export function generateDefaultMasterState(symbol: string = 'BTC/USDT'): MasterTradingState {
  const activeGrid = generateDefaultGrid(symbol);
  const openOrders = generateDefaultOrders(symbol);
  const position = generateDefaultPosition(symbol);

  return {
    success: true,
    activeSymbol: symbol,
    autonomyLevel: 1, // OWNER-CONTROLLED LIVE TRADING
    tradingMode: 'LIVE',
    GLOBAL_KILL_SWITCH_ACTIVE: false,
    botsDisabled: false,
    activeBotsCount: 1,
    killSwitch: {
      isActive: false,
      triggeredBy: 'None',
      ordersCancelledCount: 0,
      positionsLiquidated: false
    },
    capital: { ...DEFAULT_CAPITAL },
    currentRegime: { ...DEFAULT_MARKET_REGIME },
    activeGrid,
    position,
    allPositions: [position],
    openOrders,
    recentFills: [
      {
        id: `fill_${Date.now() - 120000}`,
        orderId: 'ord_fill_prev_1',
        symbol,
        side: 'BUY',
        price: 66120.00,
        amount: 0.002646,
        feeUsd: 0.087,
        slippageBps: 0.2,
        realizedPnL: 8.42,
        timestamp: new Date(Date.now() - 120000).toISOString()
      },
      {
        id: `fill_${Date.now() - 360000}`,
        orderId: 'ord_fill_prev_2',
        symbol,
        side: 'SELL',
        price: 66840.00,
        amount: 0.002618,
        feeUsd: 0.088,
        slippageBps: 0.1,
        realizedPnL: 11.20,
        timestamp: new Date(Date.now() - 360000).toISOString()
      }
    ],
    indicators: { ...DEFAULT_INDICATORS },
    championStrategy: { ...DEFAULT_CHAMPION_STRATEGY },
    circuitBreakerActive: false,
    destinationWallet: { ...DEFAULT_DESTINATION_WALLET },
    sweepEligibility: {
      eligibleAmount: 1880.50,
      canSweep: true,
      reserveRetained: 300.00
    },
    serverTime: new Date().toISOString()
  };
}

export const DEFAULT_RESEARCH_ITEMS: ResearchItem[] = [
  {
    id: 'res-1',
    timestamp: '2026-09-20T08:15:00.000Z',
    category: 'FACT',
    title: 'Perpetual Funding Rate Equilibrium & Volatility Compression',
    source: 'Binance / Deribit Live Telemetry',
    summary: 'BTC 8h funding rate remains neutral (+0.004%). Bollinger bandwidth at 14-day low of 3.4%, signaling high probability of mean-reversion range-bound continuation.',
    sentiment: 'NEUTRAL',
    impactScore: 88,
    quantitativeAdjustment: {
      recommendedGridWidthModifier: 1.0,
      riskLevel: 'LOW',
      notes: 'Maintain geometric grid spacing between $61,000 and $72,500 with ATR volatility scaling.'
    },
    verifiedByAi: true
  },
  {
    id: 'res-2',
    timestamp: '2026-09-20T06:30:00.000Z',
    category: 'ANALYSIS',
    title: 'Whale Exchange Inflow/Outflow Delta Contraction',
    source: 'Glassnode On-Chain Analytics',
    summary: 'Spot net exchange outflows of 4,200 BTC over last 24h. Minimal liquidation clusters above $67,500; support fortified near $64,800 VWAP anchor.',
    sentiment: 'BULLISH',
    impactScore: 82,
    quantitativeAdjustment: {
      recommendedGridWidthModifier: 1.05,
      riskLevel: 'LOW',
      notes: 'Lower boundary stop protection preserved at $61,000.'
    },
    verifiedByAi: true
  }
];

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

export const DEFAULT_SWEEPS: ProfitSweep[] = [
  {
    id: 'sweep_1',
    timestamp: '2026-09-18T14:20:00.000Z',
    destinationWallet: DEFAULT_DESTINATION_WALLET.address,
    chain: 'bsc',
    grossSweepAmount: 1500.00,
    networkFeeUsd: 3.20,
    netTransferredUsd: 1496.80,
    reserveRetainedUsd: 300.00,
    status: 'CONFIRMED',
    txHash: '0x3a4b9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
    auditSignature: 'ECDSA_VERIFIED_SWEEP_1',
    operator: 'AUTONOMOUS_SWEEPER'
  }
];

export const DEFAULT_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    timestamp: '2026-09-20T10:35:00.000Z',
    operator: 'AUTONOMOUS_AGENT',
    action: 'GRID_LEVEL_REBALANCED',
    details: { symbol: 'BTC/USDT', levels: 20, regime: 'RANGE_BOUND_LOW_VOL' },
    result: 'SUCCESS'
  },
  {
    id: 'log-2',
    timestamp: '2026-09-20T10:00:00.000Z',
    operator: 'RISK_ENGINE',
    action: 'PORTFOLIO_HEALTH_AUDIT',
    details: { drawdown: '1.1%', var99: '2.4%', sharpe: 2.52 },
    result: 'SUCCESS'
  }
];

export const DEFAULT_SYSTEM_UPDATES: SystemUpdate[] = [
  {
    version: 'v2.5.0',
    discoveredAt: '2026-09-20T10:00:00.000Z',
    integrityVerified: true,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    automatedTestsPassed: true,
    securityTestsPassed: true,
    backtestPassed: true,
    canaryStatus: 'FULL_DEPLOYMENT',
    rollbackPoint: 'v2.4.9-stable',
    deployedAt: '2026-09-20T10:30:00.000Z',
    notes: 'Global Kill Switch prominent header control with instant bot halt synchronization.'
  }
];
