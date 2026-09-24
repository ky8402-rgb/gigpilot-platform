export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
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
  confidence: number;
  atr: number;
  rsi: number;
  adx: number;
  bbBandwidth: number;
  orderBookImbalance: number;
  trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  recommendedGridSpacing: number;
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
  baseAmount: number;
  quoteAmount: number;
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
  profitReserve: number;
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
  chain: string;
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
  paperTradingResults?: StrategyPerformanceMetrics;
  liveResults?: StrategyPerformanceMetrics;
  validationScore: number;
  expectedEffect: string;
  actualEffect?: string;
  code?: string;
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
  impactScore: number;
  summary: string;
  quantitativeAdjustment: {
    recommendedGridWidthModifier: number;
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

export interface MasterTradingState {
  success: boolean;
  activeSymbol: string;
  autonomyLevel: AutonomyLevel;
  tradingMode: TradingMode;
  GLOBAL_KILL_SWITCH_ACTIVE?: boolean;
  botsDisabled?: boolean;
  activeBotsCount?: number;
  failClosedStatus?: { failClosed: boolean; downEngines: string[] };
  engines?: EngineHealth[];
  killSwitch: {
    isActive: boolean;
    triggeredAt?: string;
    triggeredBy: string;
    reason?: string;
    ordersCancelledCount: number;
    positionsLiquidated: boolean;
  };
  capital: CapitalAccounting;
  currentRegime: MarketRegime;
  activeGrid: GridConfiguration | null;
  position?: Position;
  allPositions: Position[];
  openOrders: Order[];
  recentFills: Fill[];
  indicators: TechnicalIndicators | null;
  championStrategy: StrategyVersion;
  circuitBreakerActive: boolean;
  destinationWallet: DestinationWallet;
  sweepEligibility: {
    eligibleAmount: number;
    canSweep: boolean;
    reserveRetained: number;
    reason?: string;
  };
  serverTime: string;
}

export interface ExchangeAssetWithUsd {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdPrice: number;
  usdValue: number;
  allocationPct: number;
  change24hPct?: number;
}

export type BybitAssetWithUsd = ExchangeAssetWithUsd;

export interface ExchangeAccountState {
  status: 'CONNECTED' | 'RESTRICTED' | 'DISCONNECTED' | 'ERROR';
  message: string;
  serverIp: string;
  timestamp: string;
  totalEquityUsd: number;
  availableCashUsd: number;
  lockedInOrdersUsd: number;
  spotBalances: ExchangeAssetWithUsd[];
  realizedProfitUsd: number;
  unrealizedProfitUsd: number;
  todayPnLUsd: number;
  todayPnLPct: number;
  openOrdersCount: number;
  recentTrades: Fill[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType: string;
  apiKeyConfigured: boolean;
  keyMask: string;
  isTestnet?: boolean;
}

export type BybitAccountState = ExchangeAccountState;

export interface OwnerAuthStatus {
  isAuthenticated: boolean;
  isConfigured: boolean;
  ownerEmail: string;
  totpEnabled: boolean;
  hasPassword: boolean;
  GLOBAL_KILL_SWITCH_ACTIVE?: boolean;
}

export type EngineId =
  | 'DATA_ENGINE'
  | 'QUANT_ENGINE'
  | 'GRID_ENGINE'
  | 'AI_RESEARCH_AGENT'
  | 'SELF_LEARN_OPTIMIZER'
  | 'STRATEGY_IDE'
  | 'EXCHANGE_EXECUTION_ENGINE'
  | 'RISK_ENGINE'
  | 'PROFIT_ACCOUNTING'
  | 'AUTO_PROFIT_SWEEP'
  | 'SYSTEM_MONITOR_SECURITY';

export interface EngineErrorRecord {
  id: string;
  timestamp: string;
  level: 'WARN' | 'ERROR' | 'CRITICAL';
  message: string;
  details?: any;
}

export interface EngineHealth {
  id: EngineId;
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF';
  enabled: boolean;
  latencyMs: number;
  lastHeartbeat: string;
  errorCount: number;
  lastError?: string;
  errorSurface: EngineErrorRecord[];
  details?: Record<string, any>;
}

export type SupportedExchange = 'BYBIT';

export interface ExchangeCredentialsInfo {
  exchange: SupportedExchange;
  configured: boolean;
  apiKeyMask: string;
  status: 'CONNECTED' | 'ERROR' | 'UNCONFIGURED';
  permissions: {
    spotTrading: boolean;
    marginTrading: boolean;
    futuresTrading: boolean;
    withdrawals: boolean;
  };
  lastChecked?: string;
}


