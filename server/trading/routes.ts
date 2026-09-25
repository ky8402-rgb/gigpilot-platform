import { Router, Request, Response } from 'express';
import { globalTradingStore } from './store.js';
import { ownerAuth, requireOwnerAuth, isOwner, extractToken } from './ownerAuth.js';
import { bybitAdapter } from './bybitAdapter.js';
import { EngineId, SupportedExchange } from './types.js';

export const tradingRouter = Router();

// 1. Master System State
tradingRouter.get('/state', (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const livePair = store.dataEngine.getPairData(store.activeSymbol);
    const position = store.exchangeExec.getPosition(store.activeSymbol);
    const openOrders = store.exchangeExec.getOpenOrders(store.activeSymbol);
    const qResult = livePair ? store.quantEngine.computeSignals(store.activeSymbol, livePair.candles, livePair.orderBook) : { indicators: null, regime: null };

    const isKillActive = store.GLOBAL_KILL_SWITCH_ACTIVE || store.killSwitch.getState().isActive;
    const failClosedStatus = store.monitor.isSystemFailClosed();
    const engines = store.monitor.getAllEngineHealth();

    return res.json({
      success: true,
      activeSymbol: store.activeSymbol,
      autonomyLevel: store.autonomyLevel,
      tradingMode: store.tradingMode,
      GLOBAL_KILL_SWITCH_ACTIVE: isKillActive,
      botsDisabled: store.activeBotsDisabled || isKillActive,
      activeBotsCount: isKillActive ? 0 : (store.autonomyLevel > 0 ? 1 : 0),
      killSwitch: store.killSwitch.getState(),
      failClosedStatus,
      engines,
      capital: store.capital,
      currentRegime: qResult.regime || store.currentRegime,
      activeGrid: store.activeGrid,
      position,
      allPositions: store.exchangeExec.getPositions(),
      openOrders,
      recentFills: store.exchangeExec.getFills().slice(0, 15),
      indicators: qResult.indicators,
      championStrategy: store.learningLoop.getChampionStrategy(),
      decisionStats: store.learningLoop.getDecisionStats(),
      circuitBreakerActive: store.risk.isCircuitBreakerActive(),
      destinationWallet: store.sweeper.getDestinationWallet(),
      autonomousOptimizer: {
        enabled: store.profitOptimizer.getOffSwitch(),
        autoApplyEnabled: store.profitOptimizer.isAutoApplyEnabled(),
        latestAudit: store.profitOptimizer.getLatestAudit(),
        latestStrategyAllocation: store.profitOptimizer.getLatestStrategyAllocation(),
        decisions: store.profitOptimizer.getDecisions().slice(0, 20),
        builds: store.profitOptimizer.getStrategyBuilds().slice(0, 15)
      },
      serverTime: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('[Trading API Error] /state:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error in state endpoint' });
  }
});

// 2. Modular Engine Health Check (All 10 Subsystems)
tradingRouter.get('/engines/health', (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const engines = store.monitor.getAllEngineHealth();
    const failClosed = store.monitor.isSystemFailClosed();
    return res.json({
      success: true,
      failClosed,
      engines,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Engine Off-Switch Toggle
tradingRouter.post('/engines/:id/off-switch', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const engineId = req.params.id as EngineId;
    const { enabled } = req.body;
    if (enabled === undefined) {
      return res.status(400).json({ success: false, error: 'Field "enabled" (boolean) is required.' });
    }

    const result = globalTradingStore.monitor.setEngineOffSwitch(engineId, Boolean(enabled));
    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json({
      success: true,
      engineHealth: result.engineHealth,
      failClosed: globalTradingStore.monitor.isSystemFailClosed()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Engine Error Surface Clear
tradingRouter.post('/engines/:id/clear-errors', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const engineId = req.params.id as EngineId;
    const result = globalTradingStore.monitor.clearEngineErrors(engineId);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Exchange Credentials Management (Trade-Only Keys for Bybit)
tradingRouter.get('/exchanges/credentials', (req: Request, res: Response) => {
  try {
    const creds = globalTradingStore.exchangeExec.getExchangeCredentials();
    return res.json({
      success: true,
      credentials: creds,
      securityPolicy: 'TRADE_ONLY_KEYS_STRICT (Withdrawal permissions blocked)'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.post('/exchanges/keys', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const { exchange, apiKey, apiSecret, isTestnet } = req.body || {};
    if (!exchange || exchange !== 'BYBIT') {
      return res.status(400).json({ success: false, error: 'Valid exchange (BYBIT) is required.' });
    }
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ success: false, error: 'Both apiKey and apiSecret are required.' });
    }

    const result = globalTradingStore.exchangeExec.configureKeys('BYBIT', apiKey, apiSecret);
    if (!result.success) {
      return res.status(400).json(result);
    }

    // Update bybitAdapter
    bybitAdapter.updateCredentials(apiKey, apiSecret, undefined, isTestnet);

    globalTradingStore.monitor.logAudit({
      category: 'CONFIG_CHANGE',
      action: `Updated Trade-Only API Keys for ${exchange}`,
      details: { exchange, isTestnet }
    });

    return res.json({
      success: true,
      message: `Trade-only keys for ${exchange} configured successfully.`,
      credentials: globalTradingStore.exchangeExec.getExchangeCredentials()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. All Pairs & Market Ticker
tradingRouter.get('/pairs', (req: Request, res: Response) => {
  try {
    const pairs = globalTradingStore.dataEngine.getAllPairs().map(p => ({
      symbol: p.symbol,
      price: p.currentPrice,
      open24h: p.open24h,
      high24h: p.high24h,
      low24h: p.low24h,
      volume24h: p.volume24h,
      change24hPct: p.priceChangePct
    }));
    return res.json({ success: true, pairs });
  } catch (err: any) {
    console.error('[Trading API Error] /pairs:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error in pairs endpoint' });
  }
});

// 7. Pair Details & Candlesticks
tradingRouter.get(['/pair/:symbol', '/pair/:base/:quote'], (req: Request, res: Response) => {
  const rawSymbol = req.params.quote ? `${req.params.base}/${req.params.quote}` : (req.params.symbol || '');
  const norm = globalTradingStore.dataEngine.normalizeSymbol(rawSymbol);
  const liveData = globalTradingStore.dataEngine.getPairData(norm);
  if (!liveData) {
    return res.status(404).json({ success: false, error: `Pair ${norm} not found or Data Engine offline` });
  }

  const qResult = globalTradingStore.quantEngine.computeSignals(norm, liveData.candles, liveData.orderBook);

  res.json({
    success: true,
    symbol: liveData.symbol,
    currentPrice: liveData.currentPrice,
    open24h: liveData.open24h,
    high24h: liveData.high24h,
    low24h: liveData.low24h,
    volume24h: liveData.volume24h,
    priceChangePct: liveData.priceChangePct,
    candles: liveData.candles,
    orderBook: liveData.orderBook,
    indicators: qResult.indicators,
    regime: qResult.regime,
    source: liveData.source
  });
});

// 8. Select Active Pair
tradingRouter.post('/pair/select', (req: Request, res: Response) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ success: false, error: 'Symbol required' });

  globalTradingStore.setActiveSymbol(symbol);
  res.json({ success: true, activeSymbol: globalTradingStore.activeSymbol });
});

// 9. Autonomy Level
tradingRouter.post('/autonomy', requireOwnerAuth, (req: Request, res: Response) => {
  const { level } = req.body;
  if (level === undefined || level < 0 || level > 4) {
    return res.status(400).json({ success: false, error: 'Invalid autonomy level (0-4)' });
  }

  try {
    globalTradingStore.setAutonomyLevel(level);
    res.json({ success: true, autonomyLevel: globalTradingStore.autonomyLevel });
  } catch (err: any) {
    res.status(403).json({ success: false, error: err.message });
  }
});

// 10. Global Kill Switch
tradingRouter.post('/kill-switch/trigger', (req: Request, res: Response) => {
  const { reason } = req.body;
  globalTradingStore.triggerEmergencyKillSwitch(reason || 'Manual emergency halt: Disabling all active trading bots');
  res.json({
    success: true,
    GLOBAL_KILL_SWITCH_ACTIVE: true,
    botsDisabled: true,
    autonomyLevel: globalTradingStore.autonomyLevel,
    killSwitch: globalTradingStore.killSwitch.getState()
  });
});

tradingRouter.post('/kill-switch/deactivate', requireOwnerAuth, (req: Request, res: Response) => {
  globalTradingStore.deactivateKillSwitch();
  res.json({
    success: true,
    GLOBAL_KILL_SWITCH_ACTIVE: false,
    botsDisabled: false,
    autonomyLevel: globalTradingStore.autonomyLevel,
    killSwitch: globalTradingStore.killSwitch.getState()
  });
});

tradingRouter.post('/kill-switch/toggle', requireOwnerAuth, (req: Request, res: Response) => {
  const { active, reason } = req.body;
  const shouldActivate = active !== undefined ? Boolean(active) : !globalTradingStore.GLOBAL_KILL_SWITCH_ACTIVE;

  if (shouldActivate) {
    globalTradingStore.triggerEmergencyKillSwitch(reason || 'Manual operator toggle: Disabling all active trading bots');
  } else {
    globalTradingStore.deactivateKillSwitch();
  }

  res.json({
    success: true,
    GLOBAL_KILL_SWITCH_ACTIVE: globalTradingStore.GLOBAL_KILL_SWITCH_ACTIVE,
    botsDisabled: globalTradingStore.activeBotsDisabled,
    autonomyLevel: globalTradingStore.autonomyLevel,
    killSwitch: globalTradingStore.killSwitch.getState()
  });
});

// 11. Configure Grid
tradingRouter.post('/grid/configure', requireOwnerAuth, async (req: Request, res: Response) => {
  const store = globalTradingStore;
  const {
    upperBoundary,
    lowerBoundary,
    levelsCount,
    spacingType,
    totalAllocatedUsd,
    volatilityAdjustment,
    trendProtection
  } = req.body;

  const liveData = store.dataEngine.getPairData(store.activeSymbol);
  if (!liveData) return res.status(400).json({ success: false, error: 'No active pair live data from Data Engine' });

  await store.exchangeExec.cancelAllOrders(store.activeSymbol);

  const newGridRes = store.gridEngine.generateGrid({
    symbol: store.activeSymbol,
    currentPrice: liveData.currentPrice,
    levelsCount: Number(levelsCount) || 16,
    spacingType: spacingType || 'GEOMETRIC',
    totalAllocatedUsd: Number(totalAllocatedUsd) || 3500,
    volatilityAdjustment: volatilityAdjustment !== false,
    trendProtection: trendProtection !== false,
    regime: store.currentRegime,
    positions: store.exchangeExec.getPositions(),
    orderBook: liveData.orderBook,
    candles: liveData.candles,
    totalEquityUsd: store.capital.totalEquity || store.capital.tradingCapital
  });

  if (!newGridRes.grid) {
    return res.status(422).json({ success: false, error: newGridRes.error || 'Failed to generate grid' });
  }

  store.activeGrid = newGridRes.grid;
  if (!store.GLOBAL_KILL_SWITCH_ACTIVE && store.autonomyLevel >= 2) {
    store.placeGridOrdersInExchange(store.activeGrid, liveData.currentPrice);
  }

  store.monitor.logAudit({
    category: 'CONFIG_CHANGE',
    action: `Grid manually configured for ${store.activeSymbol}`,
    details: {
      upper: store.activeGrid.upperBoundary,
      lower: store.activeGrid.lowerBoundary,
      levels: store.activeGrid.levelsCount
    }
  });

  res.json({ success: true, grid: store.activeGrid });
});

// 12. Manual Live Order Placement (Validated via Independent Risk Engine)
tradingRouter.post('/order/place', requireOwnerAuth, async (req: Request, res: Response) => {
  const store = globalTradingStore;
  if (store.GLOBAL_KILL_SWITCH_ACTIVE || store.killSwitch.getState().isActive) {
    return res.status(403).json({ success: false, error: 'Cannot place orders: GLOBAL KILL SWITCH is engaged' });
  }

  // Fail closed check
  const failStatus = store.monitor.isSystemFailClosed();
  if (failStatus.failClosed) {
    return res.status(503).json({
      success: false,
      error: `FAIL-CLOSED: Trading is blocked because critical engine(s) are degraded or offline: ${failStatus.downEngines.join(', ')}`
    });
  }

  const { symbol, side, type, price, amount, exchange } = req.body;
  if (!symbol || !side || !type || !price || !amount) {
    return res.status(400).json({ success: false, error: 'Missing required order fields (symbol, side, type, price, amount)' });
  }

  const numPrice = Number(price);
  const numAmount = Number(amount);
  const norm = store.dataEngine.normalizeSymbol(symbol);
  const liveData = store.dataEngine.getPairData(norm);

  // Compute Expected Net Edge Breakdown
  const expectedNetEdge = store.quantEngine.computeExpectedNetEdge({
    symbol: norm,
    side,
    price: numPrice,
    amount: numAmount,
    orderType: type,
    orderBook: liveData?.orderBook,
    candles: liveData?.candles,
    gridSpacingPct: store.activeGrid?.gridSpacingPct,
    regime: store.currentRegime
  });

  // 1. Risk Engine Pre-Trade Gate: Enforces Expected Net Edge > minimum_edge_threshold
  const validation = store.risk.validateOrder(
    { symbol: norm, side, price: numPrice, amount: numAmount },
    store.capital,
    store.exchangeExec.getPositions(),
    store.exchangeExec.getOpenOrders().length,
    liveData?.currentPrice,
    expectedNetEdge
  );

  if (!validation.allowed) {
    return res.status(422).json({
      success: false,
      error: `Order rejected by Risk Engine: ${validation.reason}`,
      expectedNetEdge,
      event: validation.event
    });
  }

  // 2. Exchange Execution Engine
  const targetExchange = exchange || 'BYBIT';
  const execResult = await store.exchangeExec.executeOrder({
    symbol: norm,
    side,
    type,
    price: numPrice,
    amount: numAmount,
    exchange: targetExchange,
    expectedNetEdge
  });

  if (!execResult.success) {
    store.monitor.logAudit({
      category: 'SECURITY_ALERT',
      action: 'Order Rejected by Exchange Execution Engine',
      details: { symbol: norm, side, price: numPrice, amount: numAmount, error: execResult.error }
    });
    return res.status(400).json({
      success: false,
      error: execResult.error,
      order: execResult.order
    });
  }

  store.monitor.logAudit({
    category: 'ORDER_EXECUTION',
    action: `Live order placed on ${targetExchange}`,
    details: { orderId: execResult.order?.id, symbol: norm, side, price: numPrice, amount: numAmount }
  });

  res.json({ success: true, order: execResult.order });
});

// 13. Cancel Order
tradingRouter.post('/order/cancel', requireOwnerAuth, async (req: Request, res: Response) => {
  const { orderId } = req.body;
  const result = await globalTradingStore.exchangeExec.cancelOrder(orderId);
  if (!result.success) return res.status(404).json(result);

  globalTradingStore.monitor.logAudit({
    category: 'ORDER_EXECUTION',
    action: `Order cancelled: ${orderId}`,
    details: { orderId }
  });
  res.json({ success: true, orderId });
});

tradingRouter.post('/order/cancel-all', requireOwnerAuth, async (req: Request, res: Response) => {
  const { symbol } = req.body;
  const count = await globalTradingStore.exchangeExec.cancelAllOrders(symbol);
  globalTradingStore.monitor.logAudit({
    category: 'ORDER_EXECUTION',
    action: `Cancelled ${count} open order(s)`,
    details: { count, symbol }
  });
  res.json({ success: true, cancelledCount: count });
});

// 14. Self-Learn Optimizer (Champion / Challenger)
tradingRouter.get('/strategies', (req: Request, res: Response) => {
  const store = globalTradingStore;
  res.json({
    success: true,
    champion: store.learningLoop.getChampionStrategy(),
    challengers: store.learningLoop.getChallengerStrategies(),
    history: store.learningLoop.getStrategyHistory()
  });
});

tradingRouter.post('/strategy/promote', requireOwnerAuth, (req: Request, res: Response) => {
  const { challengerId, reason, forceOverride } = req.body;
  const result = globalTradingStore.learningLoop.promoteChallenger(challengerId, reason, forceOverride);
  if (!result.success || !result.champion) {
    return res.status(400).json({
      success: false,
      error: result.reason || 'Challenger not found or optimizer offline',
      tenureStatus: result.tenureStatus,
      code: result.code
    });
  }

  globalTradingStore.monitor.logAudit({
    category: 'CONFIG_CHANGE',
    action: `Strategy promoted: ${result.champion.id}`,
    details: { promotedId: result.champion.id, reason }
  });

  res.json({ success: true, champion: result.champion, tenureStatus: result.tenureStatus });
});

// 14B. 3-Way Trade Decision Architecture (BUY / SELL / DO NOTHING)
// DO NOTHING is a legitimate optimized action: profitable automated systems trade selectively
tradingRouter.get('/decisions', (req: Request, res: Response) => {
  const store = globalTradingStore;
  res.json({
    success: true,
    stats: store.learningLoop.getDecisionStats()
  });
});

tradingRouter.post('/decisions/evaluate', (req: Request, res: Response) => {
  const store = globalTradingStore;
  const {
    symbol = store.activeSymbol,
    side = 'BUY',
    price,
    amount,
    source = 'MANUAL_TESTER',
    simulatedRegime,
    simulatedEdgeBps,
    simulatedDepthUsd,
    simulatedBaseRatio,
    simulatedLiquidationDistancePct
  } = req.body;

  const livePair = store.dataEngine.getPairData(symbol);
  const curPrice = price ? Number(price) : (livePair?.currentPrice || 83000);
  const curAmount = amount ? Number(amount) : 0.0035;

  const regime = simulatedRegime ? {
    symbol,
    type: simulatedRegime,
    confidence: 0.85,
    adx: 24.5,
    trendDirection: side === 'BUY' ? 'BULLISH' : 'BEARISH',
    volatilityAnnualizedPct: 48.5,
    timestamp: new Date().toISOString(),
    gridRecommendation: {
      spacingMultiplier: 1.0,
      volatilityScaling: true,
      trendFilterEnabled: true
    }
  } : (store.currentRegime || {
    symbol,
    type: 'RANGING_SIDEWAYS',
    confidence: 0.80,
    adx: 18.0,
    trendDirection: 'NEUTRAL',
    volatilityAnnualizedPct: 42.0,
    timestamp: new Date().toISOString(),
    gridRecommendation: {
      spacingMultiplier: 1.0,
      volatilityScaling: true,
      trendFilterEnabled: true
    }
  });

  const orderBook = livePair?.orderBook ? { ...livePair.orderBook } : undefined;
  if (orderBook && simulatedDepthUsd && orderBook.asks && orderBook.bids) {
    const depthNum = Number(simulatedDepthUsd);
    const simulatedAmt = depthNum / (curPrice * 2);
    // Scale depth for simulation
    orderBook.asks = [{ price: curPrice * 1.0005, amount: simulatedAmt, total: simulatedAmt * curPrice * 1.0005 }];
    orderBook.bids = [{ price: curPrice * 0.9995, amount: simulatedAmt, total: simulatedAmt * curPrice * 0.9995 }];
  }

  const inventory = store.activeGrid?.inventoryAwareness ? { ...store.activeGrid.inventoryAwareness } : undefined;
  if (inventory) {
    if (simulatedBaseRatio !== undefined) {
      inventory.currentBaseRatio = Number(simulatedBaseRatio);
      inventory.inventorySkew = Number(((inventory.currentBaseRatio - inventory.targetBaseRatio) / 0.50).toFixed(2));
      inventory.inventoryPosturing = inventory.inventorySkew > 0.4 ? 'HEAVILY_LONG' : inventory.inventorySkew > 0.15 ? 'MODERATELY_LONG' : inventory.inventorySkew < -0.4 ? 'HEAVILY_SHORT' : inventory.inventorySkew < -0.15 ? 'MODERATELY_SHORT' : 'BALANCED';
    }
    if (simulatedLiquidationDistancePct !== undefined) {
      inventory.distanceFromLiquidationPct = Number(simulatedLiquidationDistancePct);
      inventory.liquidationRiskTier = inventory.distanceFromLiquidationPct < 12 ? 'CRITICAL' : inventory.distanceFromLiquidationPct < 22 ? 'ELEVATED' : 'SAFE';
    }
  }

  const expectedNetEdge = simulatedEdgeBps !== undefined ? {
    expectedGrossEdgeBps: Number(simulatedEdgeBps) + 7.5,
    makerTakerFeesBps: 6.0,
    expectedSpreadCostBps: 1.5,
    expectedSlippageBps: 0.8,
    adverseSelectionCostBps: 1.2,
    fundingCarryingCostBps: 0.2,
    executionUncertaintyBps: 0.8,
    expectedNetEdgeBps: Number(simulatedEdgeBps),
    isTradeable: Number(simulatedEdgeBps) >= 4.0,
    minHurdleRateBps: 4.0,
    edgeFormula: 'Gross - (Fees + Spread + Slippage + AdverseSelection + CarryingCost + ExecutionUncertainty)',
    timestamp: new Date().toISOString()
  } : undefined;

  const decision = store.learningLoop.evaluateAndLogDecision({
    symbol,
    side: side as 'BUY' | 'SELL',
    price: curPrice,
    amount: curAmount,
    source,
    confidence: regime.confidence,
    regime: regime as any,
    orderBook,
    candles: livePair?.candles,
    positions: store.exchangeExec.getPositions(),
    capital: store.capital,
    inventory,
    expectedNetEdge,
    riskConfig: store.risk.getConfig(),
    circuitBreakerActive: store.risk.isCircuitBreakerActive(),
    failClosed: store.monitor.isSystemFailClosed().failClosed
  });

  res.json({
    success: true,
    decision,
    stats: store.learningLoop.getDecisionStats()
  });
});

// 15. Strategy IDE Sandbox Execution
tradingRouter.post('/script/execute', requireOwnerAuth, (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ success: false, error: 'Code is required' });

  const store = globalTradingStore;
  const liveData = store.dataEngine.getPairData(store.activeSymbol);
  const position = store.exchangeExec.getPosition(store.activeSymbol) || {
    symbol: store.activeSymbol,
    baseAmount: 0,
    quoteAmount: store.capital.availableCash,
    entryPrice: 0,
    currentPrice: liveData?.currentPrice || 0,
    unrealizedPnL: 0,
    unrealizedPnLPct: 0,
    realizedPnL: 0,
    totalFeesPaid: 0,
    netPnL: 0,
    liquidationPrice: 0,
    marginUsed: 0
  };

  const result = store.scripting.executeUserScript(code, {
    symbol: store.activeSymbol,
    candles: liveData?.candles || [],
    orderBook: liveData?.orderBook || { symbol: store.activeSymbol, bids: [], asks: [], spread: 0, spreadBps: 0, midPrice: 0, timestamp: Date.now() },
    position,
    balance: store.capital.availableCash,
    marketRegime: store.currentRegime.regime
  });

  res.json(result);
});

// 16. AI Research Agent
tradingRouter.get('/research', (req: Request, res: Response) => {
  res.json({
    success: true,
    items: globalTradingStore.research.getResearchItems()
  });
});

tradingRouter.post('/research/analyze', async (req: Request, res: Response) => {
  const store = globalTradingStore;
  const liveData = store.dataEngine.getPairData(store.activeSymbol);
  if (!liveData) return res.status(400).json({ success: false, error: 'No live market data for research analysis' });

  const result = await store.research.evaluateLiveMarketIntelligence(
    store.activeSymbol,
    liveData.currentPrice,
    liveData.priceChangePct
  );

  res.json(result);
});

// 17. Profit Sweep Subsystem
tradingRouter.get('/sweep/info', (req: Request, res: Response) => {
  const store = globalTradingStore;
  res.json({
    success: true,
    destinationWallet: store.sweeper.getDestinationWallet(),
    sweeps: store.sweeper.getSweeps(),
    eligibleProfitUsd: store.capital.eligibleRealizedProfit,
    totalSweptUsd: store.capital.totalSweptProfit
  });
});

tradingRouter.post('/sweep/wallet', requireOwnerAuth, (req: Request, res: Response) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ success: false, error: 'Wallet payload required' });
  const result = globalTradingStore.sweeper.setDestinationWallet(wallet);
  res.json(result);
});

tradingRouter.post('/sweep/execute', requireOwnerAuth, (req: Request, res: Response) => {
  const { amountUsd } = req.body;
  const numAmount = Number(amountUsd);
  if (!numAmount || numAmount <= 0) return res.status(400).json({ success: false, error: 'Valid amount required' });

  const store = globalTradingStore;
  const result = store.sweeper.executeManualSweep(numAmount, store.capital.eligibleRealizedProfit);
  if (!result.success) {
    return res.status(422).json(result);
  }

  // Deduct swept profit from accounting
  store.profitAccounting.recordSweepExecuted(numAmount);

  store.monitor.logAudit({
    category: 'PROFIT_SWEEP',
    action: `Cold storage sweep of $${numAmount.toFixed(2)} executed`,
    details: { txHash: result.sweep?.txHash, address: result.sweep?.destinationAddress }
  });

  res.json(result);
});

// 18. Risk Configuration & Circuit Breaker
tradingRouter.get('/risk', (req: Request, res: Response) => {
  res.json({
    success: true,
    config: globalTradingStore.risk.getConfig(),
    riskEvents: globalTradingStore.risk.getRiskEvents(),
    circuitBreakerActive: globalTradingStore.risk.isCircuitBreakerActive()
  });
});

tradingRouter.post('/risk/circuit-breaker/reset', requireOwnerAuth, (req: Request, res: Response) => {
  globalTradingStore.risk.resetCircuitBreaker();
  res.json({ success: true, circuitBreakerActive: false });
});

// 19. Audit Logs & System Updates
tradingRouter.get('/audit-logs', (req: Request, res: Response) => {
  res.json({
    success: true,
    logs: globalTradingStore.monitor.getAuditLogs()
  });
});

tradingRouter.get('/updates', (req: Request, res: Response) => {
  res.json({
    success: true,
    updates: globalTradingStore.monitor.getSystemUpdates()
  });
});

// 20. Single Owner Authentication & Google Authenticator (TOTP)
function parseBody(req: Request): any {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

tradingRouter.all(['/auth/status', '/auth/status/', '/status', '/status/'], (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  const authenticated = isOwner(req);
  return res.json({
    success: true,
    ...ownerAuth.getStatus(authenticated),
    GLOBAL_KILL_SWITCH_ACTIVE: globalTradingStore.GLOBAL_KILL_SWITCH_ACTIVE,
    tradingMode: globalTradingStore.tradingMode
  });
});

tradingRouter.all(['/auth/setup-init', '/auth/setup-init/', '/setup-init', '/setup-init/'], async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed. POST is required.' });
  }
  try {
    const { email } = parseBody(req);
    const setupData = await ownerAuth.initiateTotpSetup(email);
    return res.json({ success: true, ...setupData });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to initialize TOTP setup' });
  }
});

tradingRouter.all(['/auth/setup-complete', '/auth/setup-complete/', '/setup-complete', '/setup-complete/'], (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed. POST is required.' });
  }
  try {
    const { password, totpCode, email } = parseBody(req);
    const result = ownerAuth.completeSetup(password, totpCode, email);
    if (!result.success) return res.status(400).json(result);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Failed to complete setup' });
  }
});

tradingRouter.all(['/auth/login', '/auth/login/', '/login', '/login/'], (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed. POST is required for authentication.' });
  }
  try {
    const { email, password, totpCode, emergencyPin } = parseBody(req);
    if (!email) {
      return res.status(400).json({ success: false, error: 'Owner email is required.' });
    }
    const result = ownerAuth.login({ email, password, totpCode, emergencyPin });
    if (!result.success) {
      return res.status(401).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Internal authentication error' });
  }
});

tradingRouter.all(['/auth/logout', '/auth/logout/', '/logout', '/logout/'], (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  return res.json({ success: true, message: 'Logged out successfully' });
});

// 21. Real Live Exchange Assets & Spot Balances
tradingRouter.get('/assets', async (req: Request, res: Response) => {
  try {
    const force = req.query.refresh === 'true';
    const accountState = await bybitAdapter.getRealAccountState(force);
    if (accountState.status === 'CONNECTED') {
      globalTradingStore.profitAccounting.syncFromRealAccount({
        totalEquityUsd: accountState.totalEquityUsd,
        availableCashUsd: accountState.availableCashUsd,
        lockedInOrdersUsd: accountState.lockedInOrdersUsd,
        recentTradesCount: accountState.recentTrades?.length || 0
      });
    }

    return res.json({ success: true, assets: accountState });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 22. Autonomous Revenue Optimizer & Strategy Allocator
tradingRouter.get('/autonomous-optimizer/status', (_req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    return res.json({
      success: true,
      health: store.profitOptimizer.healthCheck(),
      autoApplyEnabled: store.profitOptimizer.isAutoApplyEnabled(),
      latestAudit: store.profitOptimizer.getLatestAudit(),
      latestStrategyAllocation: store.profitOptimizer.getLatestStrategyAllocation(),
      decisions: store.profitOptimizer.getDecisions(),
      builds: store.profitOptimizer.getStrategyBuilds(),
      championStrategy: store.learningLoop.getChampionStrategy()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.get('/strategy-allocator/current', (_req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const allocation = store.profitOptimizer.getLatestStrategyAllocation();
    return res.json({
      success: true,
      allocation: allocation || store.profitOptimizer.computeStrategyAllocations({
        capital: store.capital,
        regime: store.currentRegime,
        midPrice: store.dataEngine.getPairData(store.activeSymbol)?.currentPrice,
        edge: store.profitOptimizer.getLatestAudit()?.expectedNetEdge
      })
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.post('/strategy-allocator/reallocate', requireOwnerAuth, async (_req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const decision = await store.runAutonomousProfitOptimizationCycle(true);
    return res.json({
      success: true,
      decision,
      allocation: store.profitOptimizer.getLatestStrategyAllocation(),
      activeGridCapitalUsd: store.activeGrid?.totalAllocatedUsd
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.post('/autonomous-optimizer/run', requireOwnerAuth, async (_req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const decision = await store.runAutonomousProfitOptimizationCycle(true);
    return res.json({
      success: true,
      decision,
      latestAudit: store.profitOptimizer.getLatestAudit(),
      latestStrategyAllocation: store.profitOptimizer.getLatestStrategyAllocation(),
      builds: store.profitOptimizer.getStrategyBuilds(),
      championStrategy: store.learningLoop.getChampionStrategy()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.post('/autonomous-optimizer/toggle', requireOwnerAuth, (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const { enabled } = parseBody(req);
    if (typeof enabled === 'boolean') {
      store.profitOptimizer.setAutoApplyEnabled(enabled);
    } else {
      store.profitOptimizer.setAutoApplyEnabled(!store.profitOptimizer.isAutoApplyEnabled());
    }
    return res.json({
      success: true,
      autoApplyEnabled: store.profitOptimizer.isAutoApplyEnabled()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 23. Quantitative Microstructure Expected Net Edge Decomposition
tradingRouter.get('/quant/edge-breakdown', (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const symbol = (req.query.symbol as string) || store.activeSymbol || 'BTCUSDT';
    const pairData = store.dataEngine.getPairData(symbol);
    const spacing = store.activeGrid?.gridSpacingPct ?? 0.45;
    const edge = store.quantEngine.computeExpectedNetEdge({
      symbol,
      price: pairData?.currentPrice || 65000,
      orderBook: pairData?.orderBook,
      candles: pairData?.candles,
      gridSpacingPct: spacing,
      regime: store.currentRegime
    });

    return res.json({
      success: true,
      symbol,
      edge,
      formulaExplanation: {
        formula: 'Expected Gross Edge − maker/taker fees − expected spread cost − expected slippage − adverse-selection cost − funding/other carrying cost − execution uncertainty = Expected Net Edge',
        hurdleRateBps: edge.minHurdleRateBps,
        verdict: edge.isTradeable ? 'POSITIVE_EV_TRADEABLE' : 'SUB_HURDLE_REJECTED'
      }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 24. Explicit Regime Transition Detector & Protections
tradingRouter.get('/regime-transition', (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const symbol = store.activeSymbol;
    const pairData = store.dataEngine.getPairData(symbol);
    const qResult = pairData ? store.quantEngine.computeSignals(symbol, pairData.candles, pairData.orderBook) : { indicators: null, regime: null };
    const currentRegime = qResult.regime || store.currentRegime;

    return res.json({
      success: true,
      symbol,
      currentRegime: currentRegime.regime,
      transition: currentRegime.transition,
      activeGridProtection: {
        activeGridAllocatedUsd: store.activeGrid?.totalAllocatedUsd,
        effectiveAllocatedUsd: store.activeGrid
          ? Math.round(store.activeGrid.totalAllocatedUsd * (currentRegime.transition?.positionSizeMultiplier || 1.0))
          : 0,
        positionSizeMultiplier: currentRegime.transition?.positionSizeMultiplier || 1.0,
        gridRestrictionStatus: currentRegime.transition?.gridRestrictionStatus || 'NORMAL',
        restrictionReason: currentRegime.transition?.restrictionReason
      },
      indicators: qResult.indicators
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.post('/regime-transition/simulate', (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const { phase = 'BREAKOUT_TESTING', breakoutSide = 'BULLISH' } = req.body;
    const symbol = store.activeSymbol;
    const pairData = store.dataEngine.getPairData(symbol);
    const currentPrice = pairData?.currentPrice || 65000;

    let positionSizeMultiplier = 1.0;
    let gridRestrictionStatus: any = 'NORMAL';
    let restrictionReason = 'Microstructure stable. Full 100% position sizing and bilateral grid rungs permitted.';
    let actionGuidance = 'Maintain balanced geometric grid with mean-reversion rebalancing.';
    let tentativeTargetRegime: any = undefined;
    let resolution: any = undefined;

    if (phase === 'BREAKOUT_TESTING') {
      positionSizeMultiplier = 0.40;
      gridRestrictionStatus = breakoutSide === 'BULLISH' ? 'RESTRICTED_UPSIDE' : 'RESTRICTED_DOWNSIDE';
      restrictionReason = `${breakoutSide} breakout testing at $${(currentPrice * (breakoutSide === 'BULLISH' ? 1.03 : 0.97)).toFixed(2)} (ATR surge 1.48x). Restricting ${breakoutSide === 'BULLISH' ? 'sell' : 'buy'} limit rungs.`;
      actionGuidance = `Cut position size to 40%. Widen ${breakoutSide === 'BULLISH' ? 'upper exit' : 'lower entry'} rungs by 2x. Hold inventory until breakout confirmation or rejection.`;
      tentativeTargetRegime = breakoutSide === 'BULLISH' ? 'BULL_TREND_STRONG' : 'BEAR_TREND_STRONG';
      resolution = 'PENDING';
    } else if (phase === 'EXPANDING_VOLATILITY') {
      positionSizeMultiplier = 0.50;
      gridRestrictionStatus = 'WIDEN_DEFENSIVE';
      restrictionReason = `Volatility expanding (ATR ratio 1.35x, ADX slope +2.4). Throttling capital allocation to 50%.`;
      actionGuidance = `Widen rung spacing defensively by 1.5x. Halt aggressive ladder rebalancing.`;
      tentativeTargetRegime = 'BREAKOUT_VOLATILITY';
      resolution = 'PENDING';
    } else if (phase === 'BREAKOUT_CONFIRMED') {
      positionSizeMultiplier = 0.60;
      gridRestrictionStatus = breakoutSide === 'BULLISH' ? 'RESTRICTED_UPSIDE' : 'RESTRICTED_DOWNSIDE';
      tentativeTargetRegime = breakoutSide === 'BULLISH' ? 'BULL_TREND_STRONG' : 'BEAR_TREND_STRONG';
      restrictionReason = `Breakout confirmed into ${tentativeTargetRegime}. Shift away from bilateral grid into directional momentum trailing mode.`;
      actionGuidance = `Reallocate capital from Mean Reversion to Trend Grid / Momentum Breakout. Trail stops on breakout side.`;
      resolution = 'BREAKOUT_CONFIRMED';
    } else if (phase === 'BREAKOUT_REJECTED') {
      positionSizeMultiplier = 0.85;
      gridRestrictionStatus = 'NORMAL';
      tentativeTargetRegime = 'RANGE_BOUND_LOW_VOL';
      restrictionReason = `Breakout rejected (fakeout detected). Mean reversion resumed back inside Bollinger bounds.`;
      actionGuidance = `Restore standard grid placement. Harvest mean reversion back to mid-price.`;
      resolution = 'BREAKOUT_REJECTED';
    }

    const transitionState = {
      isTransitioning: phase !== 'STABLE',
      phase,
      sourceRegime: store.currentRegime.regime,
      targetRegimes: [
        {
          regime: breakoutSide === 'BEARISH' ? 'BEAR_TREND_STRONG' : 'BULL_TREND_STRONG',
          probability: phase === 'BREAKOUT_CONFIRMED' ? 0.88 : (phase === 'BREAKOUT_REJECTED' ? 0.12 : 0.65),
          triggerCondition: 'Breakout sustained with ADX > 24 and 2+ consecutive closes outside boundary.'
        },
        {
          regime: 'RANGE_BOUND_HIGH_VOL',
          probability: phase === 'BREAKOUT_CONFIRMED' ? 0.12 : (phase === 'BREAKOUT_REJECTED' ? 0.88 : 0.35),
          triggerCondition: 'Breakout rejected back inside band with volume contraction & mean reversion.'
        }
      ],
      tentativeTargetRegime,
      resolution,
      confidence: 0.88,
      transitionStartTime: new Date().toISOString(),
      timeInTransitionSeconds: phase !== 'STABLE' ? 180 : 0,
      metrics: {
        volatilityExpansionRatio: phase === 'STABLE' ? 1.02 : 1.48,
        adxSlope: phase === 'STABLE' ? 0.2 : (phase === 'BREAKOUT_REJECTED' ? -1.8 : 3.8),
        adxValue: phase === 'BREAKOUT_CONFIRMED' ? 28.5 : 22.4,
        bbBandwidthExpansionPct: phase === 'STABLE' ? 3.5 : 44.2,
        breakoutThresholdUpper: Number((currentPrice * 1.025).toFixed(2)),
        breakoutThresholdLower: Number((currentPrice * 0.975).toFixed(2)),
        breakoutDistancePct: phase === 'BREAKOUT_TESTING' ? 0.15 : 2.5,
        breakoutSide: breakoutSide as any,
        volumeSurgeRatio: phase === 'STABLE' ? 0.95 : 1.85,
        confirmationBarsCount: phase === 'BREAKOUT_CONFIRMED' ? 3 : 1
      },
      positionSizeMultiplier,
      gridRestrictionStatus,
      restrictionReason,
      actionGuidance
    };

    store.currentRegime.transition = transitionState as any;
    if (phase === 'BREAKOUT_CONFIRMED' && tentativeTargetRegime) {
      store.currentRegime.regime = tentativeTargetRegime;
    }

    // Regenerate active grid with transition constraints if grid exists
    if (store.activeGrid) {
      const regenerated = store.gridEngine.generateGrid({
        symbol,
        currentPrice,
        totalAllocatedUsd: store.activeGrid.totalAllocatedUsd,
        levelsCount: store.activeGrid.levelsCount,
        spacingType: store.activeGrid.spacingType,
        volatilityAdjustment: true,
        trendProtection: true,
        regime: store.currentRegime
      });
      if (regenerated.grid) {
        store.activeGrid = regenerated.grid;
      }
    }

    store.monitor.logAudit({
      category: 'REGIME_TRANSITION_RESTRICTION',
      action: `Regime Transition Updated: Phase=${phase}, Multiplier=${positionSizeMultiplier * 100}%, Restriction=${gridRestrictionStatus}`,
      details: { symbol, phase, restrictionReason, actionGuidance }
    });

    return res.json({
      success: true,
      phase,
      currentRegime: store.currentRegime,
      activeGrid: store.activeGrid
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 31. Inventory-Aware Grid Metrics & Multi-Variable Equation Read
tradingRouter.get('/inventory-awareness', async (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const symbol = store.activeSymbol;
    const liveData = store.dataEngine.getPairData(symbol);
    const currentPrice = liveData?.currentPrice || 66850;

    const inventoryMetrics = store.gridEngine.computeInventoryAwareness({
      symbol,
      currentPrice,
      totalAllocatedUsd: store.activeGrid?.totalAllocatedUsd || 3500,
      regime: store.currentRegime,
      positions: store.exchangeExec.getPositions(),
      orderBook: liveData?.orderBook,
      candles: liveData?.candles,
      totalEquityUsd: store.capital.totalEquity || store.capital.tradingCapital
    });

    return res.json({
      success: true,
      symbol,
      currentPrice,
      metrics: inventoryMetrics,
      activeGrid: store.activeGrid
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 32. Simulate Inventory Skew & Distance from Liquidation
tradingRouter.post('/inventory-awareness/simulate', async (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const symbol = store.activeSymbol;
    const liveData = store.dataEngine.getPairData(symbol);
    const currentPrice = liveData?.currentPrice || 66850;

    const {
      simulatedBaseRatio, // e.g. 0.85 (heavily long) or 0.15 (heavily short)
      simulatedLiquidationDistancePct, // e.g. 8.5% (critical) or 35% (safe)
      customTargetRatio = 0.50
    } = req.body;

    const newGridRes = store.gridEngine.generateGrid({
      symbol,
      currentPrice,
      totalAllocatedUsd: store.activeGrid?.totalAllocatedUsd || 3500,
      levelsCount: store.activeGrid?.levelsCount || 16,
      spacingType: store.activeGrid?.spacingType || 'GEOMETRIC',
      volatilityAdjustment: true,
      trendProtection: true,
      regime: store.currentRegime,
      positions: store.exchangeExec.getPositions(),
      orderBook: liveData?.orderBook,
      candles: liveData?.candles,
      totalEquityUsd: store.capital.totalEquity || store.capital.tradingCapital,
      customTargetRatio,
      simulatedBaseRatio,
      simulatedLiquidationDistancePct
    });

    if (newGridRes.grid) {
      store.activeGrid = newGridRes.grid;
    }

    store.monitor.logAudit({
      category: 'INVENTORY_SKEW_ADJUSTMENT',
      action: `Simulated Inventory Skew: BaseRatio=${simulatedBaseRatio !== undefined ? `${Math.round(simulatedBaseRatio * 100)}%` : 'live'}, DistLiq=${simulatedLiquidationDistancePct ?? 'live'}%`,
      details: {
        skew: newGridRes.grid?.inventoryAwareness?.inventorySkew,
        posture: newGridRes.grid?.inventoryAwareness?.inventoryPosturing,
        buyAlloc: newGridRes.grid?.inventoryAwareness?.asymmetricBudgeting.buyAllocationPct,
        sellAlloc: newGridRes.grid?.inventoryAwareness?.asymmetricBudgeting.sellAllocationPct,
        buyHurdle: newGridRes.grid?.inventoryAwareness?.asymmetricEdgeHurdles.requiredBuyEdgeHurdleBps
      }
    });

    return res.json({
      success: true,
      grid: store.activeGrid,
      metrics: store.activeGrid?.inventoryAwareness
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

