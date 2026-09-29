export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
export type TradingMode = 'LIVE';

export type MarketRegimeType = 
  | 'RANGE_BOUND_LOW_VOL' 
  | 'RANGE_BOUND_HIGH_VOL' 
  | 'BULL_TREND_STRONG' 
  | 'BEAR_TREND_STRONG' 
  | 'BREAKOUT_VOLATILITY' 
  | 'LIQUIDITY_SQUEEZE';

export type RegimeTransitionPhase = 
  | 'STABLE'
  | 'EXPANDING_VOLATILITY'
  | 'BREAKOUT_TESTING'
  | 'BREAKOUT_CONFIRMED'
  | 'BREAKOUT_REJECTED';

export type GridRestrictionStatus = 
  | 'NORMAL'
  | 'RESTRICTED_UPSIDE'
  | 'RESTRICTED_DOWNSIDE'
  | 'HALT_NEW_RUNGS'
  | 'WIDEN_DEFENSIVE';

export interface RegimeTransitionCandidateNext {
  regime: MarketRegimeType;
  probability: number; // 0 to 1
  triggerCondition: string;
}

export interface RegimeTransitionMetrics {
  volatilityExpansionRatio: number;
  adxSlope: number;
  adxValue: number;
  bbBandwidthExpansionPct: number;
  breakoutThresholdUpper: number;
  breakoutThresholdLower: number;
  breakoutDistancePct: number;
  breakoutSide: 'BULLISH' | 'BEARISH' | 'NONE';
  volumeSurgeRatio: number;
  confirmationBarsCount: number;
}

export interface RegimeTransitionState {
  isTransitioning: boolean;
  phase: RegimeTransitionPhase;
  sourceRegime: MarketRegimeType;
  targetRegimes: RegimeTransitionCandidateNext[];
  tentativeTargetRegime?: MarketRegimeType;
  resolution?: 'BREAKOUT_CONFIRMED' | 'BREAKOUT_REJECTED' | 'PENDING';
  confidence: number;
  transitionStartTime: string;
  timeInTransitionSeconds: number;
  metrics: RegimeTransitionMetrics;
  
  // Risk & Grid Protections
  positionSizeMultiplier: number;
  gridRestrictionStatus: GridRestrictionStatus;
  restrictionReason: string;
  actionGuidance: string;
}

export interface MarketRegime {
  regime: MarketRegimeType;
  confidence: number;
  atr: number;
  rsi: number;
  adx: number;
  adxSlope?: number;
  bbBandwidth: number;
  orderBookImbalance: number;
  trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  recommendedGridSpacing: number;
  suggestedAction: string;
  detectedAt: string;
  transition?: RegimeTransitionState;
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
  adx?: number;
  adxSlope?: number;
  plusDI?: number;
  minusDI?: number;
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
  requiredEdgeHurdleBps?: number;
  orderSizeMultiplier?: number;
  inventorySkewMultiplier?: number;
}

export type InventoryPosturing =
  | 'HEAVILY_LONG'
  | 'MODERATELY_LONG'
  | 'BALANCED'
  | 'MODERATELY_SHORT'
  | 'HEAVILY_SHORT';

export type LiquidationRiskTier = 'SAFE' | 'ELEVATED' | 'CRITICAL' | 'NO_LIQUIDATION_RISK';

export interface InventoryAwarenessMetrics {
  baseAsset: string;
  quoteAsset: string;
  currentBaseInventory: number;
  currentBaseValueUsd: number;
  totalPortfolioValueUsd: number;
  targetBaseRatio: number; // e.g. 0.50 (50% target inventory)
  currentBaseRatio: number; // e.g. 0.82 (82% currently in base asset -> too long)
  inventorySkew: number; // Normalized -1.0 to +1.0 (positive = too long, negative = too short)
  inventoryPosturing: InventoryPosturing;

  // Distance from Liquidation
  liquidationPrice?: number;
  distanceFromLiquidationPct?: number; // e.g. 18.5%
  liquidationRiskTier: LiquidationRiskTier;
  marginUtilizationPct?: number;

  // Order Book Liquidity
  bidDepthUsd: number;
  askDepthUsd: number;
  liquidityImbalanceRatio: number;
  orderBookToxicityScore: number;

  // Asymmetric Outputs Derived
  asymmetricSpacing: {
    buySpacingPct: number;
    sellSpacingPct: number;
    reservationPrice: number; // Avellaneda-Stoikov shifted reservation price
    reservationPriceShiftBps: number;
  };
  asymmetricBudgeting: {
    buyAllocationPct: number; // e.g. 15% when heavily long
    sellAllocationPct: number; // e.g. 85% when heavily long
    buyBudgetUsd: number;
    sellBudgetUsd: number;
  };
  asymmetricOrderSizing: {
    buyOrderSizeMultiplier: number; // e.g. 0.25x
    sellOrderSizeMultiplier: number; // e.g. 1.85x
  };
  asymmetricEdgeHurdles: {
    baseHurdleBps: number;
    requiredBuyEdgeHurdleBps: number; // e.g. 10.5 bps (increased hurdle for BUYs)
    requiredSellEdgeHurdleBps: number; // e.g. 2.2 bps (reduced hurdle to offload inventory)
  };
  sideBias: 'BUY_HEAVY' | 'SELL_HEAVY' | 'NEUTRAL';
  activeSafeguards: string[];
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
  inventoryAwareness?: InventoryAwarenessMetrics;
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
  expectedNetEdge?: ExpectedNetEdgeBreakdown;
  signalPrice?: number;
  expectedPrice?: number;
  actualFillPrice?: number;
  decisionTimestamp?: string;
  orderSubmitTimestamp?: string;
  exchangeAckTimestamp?: string;
  fillTimestamp?: string;
  decisionToSubmissionMs?: number;
  submissionToAckMs?: number;
  ackToFillMs?: number;
  expectedToActualDriftBps?: number;
  bookStateAtDecision?: OrderBookStateSnapshot;
  bookStateAtFill?: OrderBookStateSnapshot;
  adverseSelectionMarkout?: AdverseSelectionMarkout;
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
  leverage?: number;
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

/**
 * Backend-computed capital & leverage plan, returned nested under `capitalPlan`
 * on the owner-authed `GET /autonomy/status`. Every field is optional because
 * the plan is authoritative on the backend and can be partially populated (or
 * absent) when live price / account cash data is unavailable. The UI must never
 * invent a value the backend did not send.
 */
export interface CapitalPlan {
  availableCashUsd?: number;
  minAccountReserveUsd?: number;
  maxCapitalAllocationPct?: number;
  /** Already net of the account reserve and the allocation-percentage cap. */
  maxAllocatableUsd?: number;
  /** Leverage the backend sizing actually used. */
  leverage?: number;
  /** Backend-enforced floor; always 1. */
  minLeverage?: number;
  /** Backend-enforced safe ceiling = min(configured limit, exchange maximum). */
  maxLeverage?: number;
  leverageStep?: number;
  leverageCeilingSource?: 'CONFIG' | 'EXCHANGE' | 'CONFIG_AND_EXCHANGE';
  /** Smallest grid that can exist (4). */
  minimumViableLevels?: number;
  requestedLevels?: number;
  /** Levels actually used to compute the requirement. */
  effectiveLevels?: number;
  /** Most rungs the current balance can fund. */
  maxAffordableLevels?: number;
  /** Notional per rung at effectiveLevels. */
  perRungUsd?: number;
  exchangeMinNotionalUsd?: number;
  minRequiredForGridUsd?: number;
  /** EXACT account cash needed to become tradeable; null when not computable. */
  requiredMinCashUsd?: number | null;
  /** Additional cash needed right now; null when not computable. */
  shortfallUsd?: number | null;
  canTrade?: boolean;
  /** Legacy alias retained so existing readers do not break. */
  gridLevelsCount?: number;
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
  validationPipeline?: StagedValidationPipeline;
  plateauAnalysis?: ParameterPlateauAnalysis;
}

export type ValidationStage =
  | 'TRAINING'
  | 'CANDIDATE'
  | 'WALK_FORWARD'
  | 'OUT_OF_SAMPLE'
  | 'PAPER_SHADOW'
  | 'SMALL_CAPITAL'
  | 'ELIGIBLE_FOR_PROMOTION'
  | 'PROMOTED'
  | 'REJECTED_OVERFIT';

export type StageStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'REJECTED';

export interface WalkForwardWindowResult {
  windowIndex: number;
  regimeName: string;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  wfeRatio: number; // Out-of-window return / in-window return
  isProfitable: boolean;
}

export interface StagedValidationPipeline {
  currentStage: ValidationStage;
  overallScore: number; // 0 - 100
  overfittingRiskPct: number; // 0 - 100, lower is better
  canPromote: boolean;
  promotionBlockReason?: string;

  // Stage 1: Training Data
  trainingData: {
    inSampleWindowDays: number;
    sampleSizeCandles: number;
    inSampleSharpe: number;
    inSampleRoiPct: number;
    inSampleWinRatePct: number;
    inSampleProfitFactor: number;
    fittedAt: string;
  };

  // Stage 2: Candidate Models
  candidateModel: {
    hypothesis: string;
    parameterDeltaSummary: string;
    complexityPenaltyBps: number;
    generatedAt: string;
  };

  // Stage 3: Walk-Forward Test & Parameter Stability
  walkForward: {
    status: StageStatus;
    windows: WalkForwardWindowResult[];
    averageWfeRatio: number; // Target >= 0.60 (60%)
    passedWindowsCount: number;
    totalWindowsCount: number;
    parameterStabilityScore: number; // 0-100
    plateauAnalysis?: ParameterPlateauAnalysis;
    evaluatedAt?: string;
  };

  // Stage 4: Out-of-Sample Test
  outOfSample: {
    status: StageStatus;
    heldOutDays: number;
    oosSharpe: number;
    oosRoiPct: number;
    oosMaxDrawdownPct: number;
    sharpeDegradationPct: number; // (1 - OOS_Sharpe / IS_Sharpe) * 100
    maxDdDegradationPct: number;
    passedOverfitHurdle: boolean;
    evaluatedAt?: string;
  };

  // Stage 5: Paper/Shadow Trading
  paperShadow: {
    status: StageStatus;
    hoursObserved: number;
    requiredHours: number;
    simulatedFillsCount: number;
    requiredFills: number;
    shadowNetProfitUsd: number;
    shadowFillRatePct: number;
    shadowSharpe: number;
    slippageVarianceBps: number;
    startedAt?: string;
  };

  // Stage 6: Small Capital (Canary)
  smallCapital: {
    status: StageStatus;
    canaryAllocationPct: number; // e.g. 5% to 10%
    canaryExposureUsd: number;
    realFillsCount: number;
    requiredFills: number;
    realizedNetProfitUsd: number;
    feeDragBps: number;
    riskRuleBreaches: number;
    startedAt?: string;
  };
}

export interface ChampionTenureStatus {
  championId: string;
  championName: string;
  championVersion: string;
  promotedAt: string;
  freezePeriodHours: number; // e.g. 24
  freezeExpiresAt: string;
  isFrozen: boolean;
  remainingFreezeSeconds: number;
  tenureElapsedSeconds: number;
  rapidReplacementAttemptsBlocked: number;
  freezeRationale: string;
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
  minExpectedNetEdgeBps?: number;
  minimum_edge_threshold?: number;
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
  futuresRisk?: {
    maxLeverage: number;
    maxExposureUsd: number;
    maxDrawdownLimitPct: number;
    maxCapitalAllocationPct: number;
    minimumNetEdgeBps: number;
  };
  autonomousBot?: {
    status: 'RUNNING' | 'PAUSED' | 'BLOCKED';
    allocatedCapitalUsd: number;
    startedAt?: string | null;
    startupSafetyLatch: boolean;
    currentNetEdgeBps: number | null;
    decisionReason: string;
    requiredNetEdgeBps: number;
  };
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
  decisionStats?: LearningDecisionStats;
  circuitBreakerActive: boolean;
  destinationWallet: DestinationWallet;
  autonomousOptimizer?: {
    enabled: boolean;
    autoApplyEnabled: boolean;
    latestAudit: RevenueAuditReport | null;
    latestStrategyAllocation?: StrategyAllocationDecision | null;
    decisions: AutonomousOptimizationDecision[];
    builds: AutonomousStrategyBuild[];
  };
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
}

export type BybitAccountState = ExchangeAccountState;

export interface OwnerAuthStatus {
  isAuthenticated: boolean;
  isConfigured: boolean;
  /** Only present on an authenticated response; the server withholds it from anonymous callers. */
  ownerEmail?: string;
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
  | 'SYSTEM_MONITOR_SECURITY'
  | 'AUTONOMOUS_PROFIT_OPTIMIZER';

export interface ExpectedNetEdgeBreakdown {
  expectedGrossEdgeBps: number;       // Expected gross theoretical return (bps)
  makerTakerFeesBps: number;          // Exchange trading fee (bps)
  expectedSpreadCostBps: number;      // Bid-ask crossing / spread cost (bps)
  expectedSlippageBps: number;        // Market depth slippage estimate (bps)
  adverseSelectionCostBps: number;    // Toxicity / adverse selection against informed flow (bps)
  fundingCarryingCostBps: number;     // Inventory holding / opportunity / carrying cost (bps)
  executionUncertaintyBps: number;    // Latency jitter, queue decay & non-fill penalty (bps)
  expectedNetEdgeBps: number;         // Gross - (Fees + Spread + Slippage + AdverseSelection + CarryingCost + ExecutionUncertainty)
  isTradeable: boolean;               // True if expectedNetEdgeBps >= minHurdleRateBps
  minHurdleRateBps: number;           // Required hurdle rate (default: 4.0 bps)
  edgeFormula: string;                // Formula representation
  timestamp: string;
}

export interface RevenueLeak {
  id: string;
  type: 'FEE_DRAG' | 'VOLATILITY_MISALIGNMENT' | 'CAPITAL_UNDERUTILIZATION' | 'ASYMMETRIC_SLIPPAGE' | 'NEGATIVE_NET_EDGE_DRAG';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  estimatedDailyDragUsd: number;
  recommendedRemediation: string;
}

export interface RevenueAuditReport {
  timestamp: string;
  revenueEfficiencyScore: number;
  netRealizedProfitUsd: number;
  totalTradingFeesUsd: number;
  feeToProfitRatioPct: number;
  spreadCaptureEfficiencyPct: number;
  effectiveNetMarginBps: number;
  expectedNetEdge?: ExpectedNetEdgeBreakdown;
  leaks: RevenueLeak[];
  vanityMetricsFiltered: {
    grossVolumeIgnoredUsd: number;
    rawFillsCountIgnored: number;
    cosmeticWinRateIgnoredPct: number;
    statement: string;
  };
}

export interface AutonomousStrategyBuild {
  id: string;
  createdAt: string;
  objective: 'NET_REALIZED_PROFIT_AFTER_FEES';
  status: 'BUILT' | 'REJECTED';
  strategyName: string;
  parentStrategyId: string;
  parameters: Partial<StrategyVersion['parameters']>;
  confidence: number;
  rationale: string;
  expectedEffect: string;
  liveEvidence: {
    netRealizedProfit: number;
    totalFees: number;
    totalTrades: number;
    currentDrawdownPct: number;
  };
}

export type StrategyCategory = 'TREND_GRID' | 'MEAN_REVERSION' | 'MOMENTUM_BREAKOUT' | 'ADAPTIVE_DEFENSIVE';

export interface StrategyAllocationCandidate {
  strategyId: string;
  strategyName: string;
  strategyType: StrategyCategory;
  description: string;
  targetRegimes: MarketRegimeType[];
  regimeMatchScore: number; // 0-100 match with current active regime
  
  // 4 Core Pillars:
  metrics: {
    // 1. Recent out-of-sample performance
    outOfSampleSharpe: number;
    outOfSampleSortino: number;
    outOfSampleNetRoiPct: number;
    profitFactor: number;
    winRatePct: number;
    // 2. Volatility
    realizedVolatilityPct: number;
    volatilityRiskPenalty: number; // 0.0 - 1.0 (higher = worse for current vol)
    // 3. Correlation with other strategies
    correlationWithPortfolio: number; // -1.0 to 1.0
    decorrelationBonus: number; // multiplier >= 1.0
    // 4. Execution quality
    executionQualityScore: number; // 0-100
    expectedNetEdgeBps: number;
    meetsMinimumEdgeThreshold: boolean; // Expected Net Edge > minimum_edge_threshold
    fillRatePct: number;
    avgSlippageBps: number;
  };

  compositeScore: number; // 0 - 100
  targetWeightPct: number; // e.g. 52.4%
  allocatedCapitalUsd: number; // e.g. $5,240 USDT
  currentCapitalUsd: number;
  capitalDeltaUsd: number;
  action: 'INCREASE_ALLOCATION' | 'REDUCE_ALLOCATION' | 'MAINTAIN' | 'DEFUND';
  rationale: string;
}

export interface StrategyAllocationDecision {
  id: string;
  timestamp: string;
  primaryQuestion: 'Which strategy should receive capital right now?';
  totalTradingCapitalUsd: number;
  activeRegime: MarketRegimeType;
  strategies: StrategyAllocationCandidate[];
  topRecipientStrategyId: string;
  topRecipientStrategyName: string;
  riskAdjustedRationale: string;
  diversificationScore: number; // Shannon entropy / effective N (0-100)
  rebalanceRequired: boolean;
  totalCapitalReallocatedUsd: number;
  applied: boolean;
}

export interface AutonomousOptimizationDecision {
  id: string;
  timestamp: string;
  objective: 'NET_REALIZED_PROFIT_AFTER_FEES';
  decision: 'NO_CHANGE' | 'TIGHTEN_GRID' | 'WIDEN_GRID' | 'BUILD_STRATEGY' | 'PAUSE_OPTIMIZATION' | 'ALLOCATE_CAPITAL';
  confidence: number;
  reason: string;
  expectedEffect: string;
  applied: boolean;
  previousGridSpacingPct?: number;
  newGridSpacingPct?: number;
  strategyBuildId?: string;
  auditReport?: RevenueAuditReport;
  strategyAllocation?: StrategyAllocationDecision;
}

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
  status: 'CONNECTED' | 'VALIDATING' | 'ERROR' | 'RESTRICTED' | 'DISCONNECTED' | 'UNCONFIGURED';
  permissions: {
    spotTrading: boolean;
    marginTrading: boolean;
    futuresTrading: boolean;
    withdrawals: boolean;
  };
  lastChecked?: string;
}

// 3-Way Trade Decision System (BUY / SELL / DO NOTHING)
export type TradeDecisionOutcome = 'BUY' | 'SELL' | 'DO_NOTHING';

export type DecisionGateName =
  | 'REGIME_SUITABILITY'
  | 'EDGE_EXCEEDS_COSTS'
  | 'LIQUIDITY_SUFFICIENCY'
  | 'INVENTORY_ACCEPTABILITY'
  | 'PORTFOLIO_RISK_ACCEPTABILITY';

export interface DecisionGateResult {
  gate: DecisionGateName;
  name: string;
  passed: boolean;
  reason: string;
  metrics?: Record<string, any>;
  latencyMs?: number;
}

export interface TradeDecision {
  id: string;
  timestamp: string;
  symbol: string;
  candidateSignal: {
    side: 'BUY' | 'SELL';
    price: number;
    amount: number;
    source: string;
    confidence: number;
  };
  gates: {
    regime: DecisionGateResult;
    edge: DecisionGateResult;
    liquidity: DecisionGateResult;
    inventory: DecisionGateResult;
    risk: DecisionGateResult;
  };
  finalOutcome: TradeDecisionOutcome;
  actionTaken: 'TRADE' | 'NO_TRADE';
  rejectionGate?: DecisionGateName;
  rejectionReason?: string;
  capitalPreservedUsd?: number;
  feesAvoidedUsd?: number;
  rationale: string;
}

export interface LearningDecisionStats {
  totalEvaluated: number;
  buyDecisions: number;
  sellDecisions: number;
  doNothingDecisions: number;
  doNothingRatioPct: number;
  buyRatioPct: number;
  sellRatioPct: number;
  totalCapitalPreservedUsd: number;
  totalFeesAvoidedUsd: number;
  avoidedDrawdownPct: number;
  gateRejectionBreakdown: {
    regimeUnsuitable: number;
    negativeEdge: number;
    insufficientLiquidity: number;
    inventorySaturated: number;
    portfolioRiskBreach: number;
  };
  recentDecisions: TradeDecision[];
}

// ==========================================
// 1. PARAMETER STABILITY & PLATEAU ROBUSTNESS
// ==========================================

export interface ParameterPlateauPoint {
  parameterValue: number;
  deltaFromOptimalPct: number;
  backtestReturnPct: number;
  sharpeRatio: number;
  winRatePct: number;
  isRobust: boolean; // within acceptable performance corridor (>= 80% of peak)
}

export interface ParameterPlateauAnalysis {
  parameterName: string;
  optimalValue: number;
  testRange: [number, number];
  points: ParameterPlateauPoint[];
  plateauScorePct: number; // % of neighborhood that performs well (target >= 70%)
  spikeWarning: boolean; // true if peak is a sharp isolated spike (e.g. 1.70 -> +12%, 1.73 -> +31%, 1.76 -> +9%)
  peakToNeighborRatio: number; // ratio of peak return to immediate neighbor average (> 1.8x triggers warning)
  robustnessMultiplier: number; // 0.0 to 1.0 based on plateau stability
  netExpectancyBps: number;
  riskAdjustedSharpe: number;
  compositeObjectiveScore: number; // Maximizes: Robustness × Net Expectancy × Sharpe
  verdict: 'ROBUST_PLATEAU' | 'SUSPICIOUS_SPIKE_REJECTED' | 'MODERATE_STABILITY';
  rationale: string;
}

// ==========================================
// 2. EXECUTION QUALITY FEEDBACK LOOP
// ==========================================

export interface OrderBookStateSnapshot {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spreadBps: number;
  depthTop5LevelsUsd: number;
}

export interface ExecutionQualityRecord {
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  signalPrice: number;
  expectedPrice: number;
  actualFillPrice: number;
  feeUsd: number;
  slippageUsd: number;
  slippageBps: number;

  // Timestamps
  decisionTimestamp: string;
  orderSubmitTimestamp: string;
  exchangeAckTimestamp: string;
  fillTimestamp: string;

  // Latency Breakdown (ms)
  decisionToSubmissionMs: number; // Internal pipeline & risk gate
  submissionToAckMs: number;      // Network transit & exchange gateway
  ackToFillMs: number;            // Matching engine queue time
  totalLatencyMs: number;

  // Book State Snapshots
  bookStateAtDecision: OrderBookStateSnapshot;
  bookStateAtFill: OrderBookStateSnapshot;

  // Drift & Realized Expectancy
  expectedToActualDriftBps: number;
  theoreticalExpectancyUsd: number;
  realizedExpectancyUsd: number;
  latencyDriftLossUsd: number;
  adverseDriftFlag: boolean;
}

export interface ExecutionQualityMetrics {
  totalOrdersAnalyzed: number;
  avgDecisionToSubmissionMs: number;
  avgSubmissionToAckMs: number;
  avgAckToFillMs: number;
  avgTotalLatencyMs: number;
  avgSlippageBps: number;
  avgExpectedToActualDriftBps: number;
  totalLatencyDriftLossUsd: number;
  pctOrdersWithAdverseFillTiming: number;
  executionQualityScore: number; // 0 - 100
  recentRecords: ExecutionQualityRecord[];
  diagnostics: string[];
}

// ==========================================
// 3. ADVERSE SELECTION DETECTION
// ==========================================

export interface AdverseSelectionMarkout {
  fillId: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  fillPrice: number;
  fillTimestamp: string;
  midPriceAtFill: number;

  // High-resolution post-fill mid prices
  midPrice100msLater: number;
  midPrice500msLater: number;
  midPrice1sLater: number;
  midPrice5sLater: number;

  // Price movement against fill in bps (positive = adverse / picked off)
  // For BUY: price dropped after fill. For SELL: price rose after fill.
  markout100msBps: number;
  markout500msBps: number;
  markout1sBps: number;
  markout5sBps: number;

  isAdverselySelected: boolean;
  toxicFlowSeverity: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}

export interface AdverseSelectionMetrics {
  totalFillsAnalyzed: number;
  adverseSelectionRatePct: number; // % of fills adversely selected
  avgMarkout100msBps: number;
  avgMarkout500msBps: number;
  avgMarkout1sBps: number;
  avgMarkout5sBps: number;
  overallAdverseSelectionScore: number; // 0 - 100 (higher = worse toxicity)
  toxicFlowThreshold: number; // default 35.0

  // Closed-Loop Optimizer Feedback Actions
  adaptationActive: boolean;
  orderAggressivenessReductionPct: number; // e.g. -25% offset from touch
  requiredEdgeHurdleAdjustmentBps: number; // e.g. +2.5 bps added to minEdge
  positionSizeScalingFactor: number;       // e.g. 0.75x sizing
  adaptationSummary: string;
  recentMarkouts: AdverseSelectionMarkout[];
}

// ==========================================
// 4. HIERARCHICAL PORTFOLIO-LEVEL RISK
// ==========================================

export interface HierarchicalRiskStructure {
  // Level 1: Global Risk
  global: {
    status: 'HEALTHY' | 'WARNING' | 'BREACHED';
    maxPortfolioDrawdownLimitPct: number;
    currentDrawdownPct: number;
    globalGrossExposureCapUsd: number;
    currentGlobalGrossExposureUsd: number;
    circuitBreakerActive: boolean;
    globalKillSwitchActive: boolean;
    reason?: string;
  };

  // Level 2: Account Risk
  account: {
    status: 'HEALTHY' | 'WARNING' | 'BREACHED';
    marginUtilizationPct: number;
    maxMarginUtilizationLimitPct: number;
    accountReserveFloorUsd: number;
    currentAvailableCashUsd: number;
    dailyLossCapUsd: number;
    currentDailyLossUsd: number;
    unencumberedLiquidityPct: number;
    reason?: string;
  };

  // Level 3: Strategy Risk
  strategy: {
    status: 'HEALTHY' | 'WARNING' | 'BREACHED';
    maxAllocationPerStrategyPct: number;
    championAllocationPct: number;
    canaryAllocationPct: number;
    strategyDrawdownLimitPct: number;
    currentStrategyDrawdownPct: number;
    sharpeDecayAlert: boolean;
    reason?: string;
  };

  // Level 4: Symbol Risk
  symbol: {
    status: 'HEALTHY' | 'WARNING' | 'BREACHED';
    maxSymbolConcentrationPct: number;
    symbolConcentrations: { [symbol: string]: number };
    singleAssetMaxExposureUsd: number;
    currentMaxSymbolExposureUsd: number;
    liquidityCushionRatio: number;
    reason?: string;
  };

  // Level 5: Position Risk & Correlated Exposure
  position: {
    status: 'HEALTHY' | 'WARNING' | 'BREACHED';
    inventorySkewRatio: number; // -1.0 to +1.0
    maxInventorySkewAllowed: number;
    liquidationDistancePct: number;
    minLiquidationDistanceBufferPct: number;

    // Cross-Asset Correlated Directional Exposure
    btcEthCorrelationCoefficient: number; // e.g. 0.88
    netBtcDirectionalExposureUsd: number;
    netEthDirectionalExposureUsd: number;
    totalCorrelatedDirectionalExposureUsd: number;
    maxCorrelatedExposureLimitUsd: number;
    correlatedExposureRatioPct: number;
    correlatedRiskAlert: boolean;
    reason?: string;
  };

  // Level 6: Individual Order Risk
  order: {
    status: 'HEALTHY' | 'WARNING' | 'BREACHED';
    maxSingleOrderExposureUsd: number;
    maxBookDepthConsumptionPct: number;
    maxPriceDeviationFromMidPct: number;
    minRequiredNetEdgeBps: number;
    reason?: string;
  };

  overallStatus: 'HEALTHY' | 'WARNING' | 'BREACHED';
  evaluatedAt: string;
}



