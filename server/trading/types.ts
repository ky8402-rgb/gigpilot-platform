// Autonomous Cryptocurrency Grid Trading Platform - Core Types

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
// 0: OBSERVE (No trading)
// 1: OWNER_CONTROLLED (Live trading with manual strategy release)
// 2: ASSISTED (AI proposes changes; Owner approves live deployment)
// 3: AUTONOMOUS (AI can deploy validated strategies automatically)
// 4: CONTINUOUS_OPTIMIZATION (AI continuously researches, tests, optimizes, and deploys)

export type TradingMode = 'LIVE';

export type MarketRegimeType = 
  | 'RANGE_BOUND_LOW_VOL' 
  | 'RANGE_BOUND_HIGH_VOL' 
  | 'BULL_TREND_STRONG' 
  | 'BEAR_TREND_STRONG' 
  | 'BREAKOUT_VOLATILITY' 
  | 'LIQUIDITY_SQUEEZE';

export interface MarketRegime {
  regime: MarketRegimeType;
  confidence: number; // 0 to 1
  atr: number;
  rsi: number;
  adx: number;
  bbBandwidth: number;
  orderBookImbalance: number; // -1 (heavy ask) to +1 (heavy bid)
  trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  recommendedGridSpacing: number; // in percentage
  suggestedAction: string;
  detectedAt: string;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookLevel {
  price: number;
  amount: number;
  total: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  spreadBps: number;
  midPrice: number;
  timestamp: number;
}

export interface TechnicalIndicators {
  rsi14: number;
  macd: { macd: number; signal: number; histogram: number };
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  bollingerBands: { upper: number; middle: number; lower: number; bandwidth: number };
  atr14: number;
  vwap: number;
  spreadBps: number;
  volatility24h: number;
}

export interface GridLevel {
  id: string;
  index: number;
  price: number;
  side: 'BUY' | 'SELL';
  orderSize: number;
  valueUsd: number;
  status: 'PENDING' | 'PLACED' | 'FILLED' | 'CANCELLED';
  matchedFillId?: string;
  filledAt?: string;
}

export interface GridConfiguration {
  id: string;
  symbol: string;
  upperBoundary: number;
  lowerBoundary: number;
  levelsCount: number;
  spacingType: 'ARITHMETIC' | 'GEOMETRIC';
  gridSpacingPct: number;
  totalAllocatedUsd: number;
  orderSizeUsd: number;
  volatilityAdjustment: boolean;
  trendProtection: boolean;
  rebalanceThresholdPct: number;
  activeLevels: GridLevel[];
  lastRebalancedAt: string;
}

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'GRID_LIMIT';
export type OrderStatus = 'NEW' | 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED';

export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  amount: number;
  filledAmount: number;
  remainingAmount: number;
  costUsd: number;
  status: OrderStatus;
  isGridOrder: boolean;
  gridLevelId?: string;
  strategyId: string;
  mode: TradingMode;
  feesPaid: number;
  slippageBps: number;
  latencyMs: number;
  placedAt: string;
  filledAt?: string;
  rejectionReason?: string;
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  amount: number;
  feeUsd: number;
  slippageBps: number;
  realizedPnL: number;
  timestamp: string;
}

export interface Position {
  symbol: string;
  baseAmount: number; // e.g. BTC
  quoteAmount: number; // e.g. USDT
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  realizedPnL: number;
  totalFeesPaid: number;
  netPnL: number;
  liquidationPrice?: number;
}

export interface CapitalAccounting {
  initialCapital: number;
  totalEquity: number;
  tradingCapital: number;
  availableCash: number;
  lockedInOrders: number;
  profitReserve: number; // Safe buffer retained in account
  eligibleRealizedProfit: number;
  withdrawableProfit: number;
  totalSweptProfit: number;
  netRealizedProfit: number;
  unrealizedProfit: number;
  grossProfit: number;
  totalTradingFees: number;
  totalSlippageCost: number;
  totalFundingCosts: number;
  totalWithdrawalCosts: number;
  roiPct: number;
  annualizedReturnPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
}

export interface DestinationWallet {
  address: string;
  chain: string; // 'ethereum' | 'solana' | 'bitcoin' | 'polygon'
  label: string;
  isWhitelisted: boolean;
  addedAt: string;
  lastVerifiedAt: string;
}

export interface ProfitSweep {
  id: string;
  timestamp: string;
  destinationWallet: string;
  chain: string;
  grossSweepAmount: number;
  networkFeeUsd: number;
  netTransferredUsd: number;
  reserveRetainedUsd: number;
  status: 'PENDING' | 'EXECUTED' | 'CONFIRMED' | 'FAILED';
  txHash: string;
  auditSignature: string;
  operator: 'AUTONOMOUS_SWEEPER' | 'MANUAL_OWNER';
}

export interface StrategyPerformanceMetrics {
  netProfit: number;
  grossProfit: number;
  totalFees: number;
  roiPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  tradesCount: number;
  avgTradeProfitUsd: number;
  avgHoldingTimeMinutes: number;
  orderFillRatePct: number;
  capitalUtilizationPct: number;
}

export interface StrategyVersion {
  id: string;
  name: string;
  version: string;
  type: 'ADAPTIVE_GRID' | 'TREND_GRID' | 'VOLATILITY_BREAKOUT' | 'MEAN_REVERSION_GRID' | 'CUSTOM_SCRIPT';
  status: 'CHAMPION' | 'CHALLENGER' | 'RETIRED' | 'REJECTED' | 'VALIDATING';
  parentVersionId?: string;
  createdAt: string;
  deployedAt?: string;
  retiredAt?: string;
  reasonForChange: string;
  parameters: {
    upperBoundary: number;
    lowerBoundary: number;
    gridLevels: number;
    spacingType: 'ARITHMETIC' | 'GEOMETRIC';
    gridSpacingPct: number;
    volatilityMultiplier: number;
    trendFilterEma: number;
    rsiFilterThreshold: number;
    stopLossPct: number;
    takeProfitPct: number;
    rebalanceIntervalSec: number;
  };
  backtestResults: StrategyPerformanceMetrics;
  liveResults?: StrategyPerformanceMetrics;
  validationScore: number; // 0 - 100
  expectedEffect: string;
  actualEffect?: string;
  code?: string;
}

export interface BacktestRun {
  id: string;
  strategyId: string;
  symbol: string;
  periodDays: number;
  initialBalance: number;
  finalBalance: number;
  metrics: StrategyPerformanceMetrics;
  walkForwardScore: number;
  monteCarloConfidence: number;
  createdAt: string;
}

export type ResearchCategory = 'FACT' | 'ANALYSIS' | 'UNVERIFIED_CLAIM' | 'SPECULATION';

export interface ResearchItem {
  id: string;
  timestamp: string;
  title: string;
  source: string;
  url?: string;
  category: ResearchCategory;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  impactScore: number; // 1 to 10
  summary: string;
  quantitativeAdjustment: {
    recommendedGridWidthModifier: number; // 1.0 is default, 1.2 = widen grid, 0.8 = tighten
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    notes: string;
  };
  verifiedByAi: boolean;
}

export interface RiskRuleConfig {
  maxPositionSizePct: number;
  maxCapitalAllocationPct: number;
  maxDailyLossPct: number;
  maxDrawdownLimitPct: number;
  maxOpenOrders: number;
  maxLeverage: number;
  maxExposureUsd: number;
  maxSlippageBps: number;
  minOrderBookLiquidityUsd: number;
  minAccountReserveUsd: number;
  autoKillSwitchTriggerDrawdownPct: number;
}

export interface RiskEvent {
  id: string;
  timestamp: string;
  ruleViolated: string;
  severity: 'WARNING' | 'ORDER_REJECTED' | 'CIRCUIT_BREAKER' | 'EMERGENCY_SHUTDOWN';
  orderDetails?: Partial<Order>;
  reason: string;
  actionTaken: string;
}

export interface SystemUpdate {
  version: string;
  discoveredAt: string;
  integrityVerified: boolean;
  sha256: string;
  automatedTestsPassed: boolean;
  securityTestsPassed: boolean;
  backtestPassed: boolean;
  canaryStatus: 'STAGING' | 'CANARY_10PCT' | 'FULL_DEPLOYMENT' | 'ROLLED_BACK';
  rollbackPoint: string;
  deployedAt?: string;
  notes: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  operator: 'AUTONOMOUS_AGENT' | 'OWNER' | 'RISK_ENGINE' | 'SWEEP_DAEMON';
  action: string;
  details: Record<string, any>;
  result: 'SUCCESS' | 'REJECTED' | 'FAILED' | 'ROLLED_BACK';
}

export interface ScriptExecutionResult {
  success: boolean;
  output: string;
  ordersGenerated: Array<{
    side: OrderSide;
    type: OrderType;
    price: number;
    amount: number;
  }>;
  logs: string[];
  executionTimeMs: number;
  error?: string;
}
