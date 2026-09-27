import { Router, Request, Response } from 'express';
import { globalTradingStore } from './store.js';
import { ownerAuth, requireOwnerAuth, isOwner, extractToken } from './ownerAuth.js';
import { bybitAdapter } from './bybitAdapter.js';
import { EngineId, SupportedExchange } from './types.js';

export const tradingRouter = Router();

// 1. Master System State
tradingRouter.get('/state', requireOwnerAuth, (req: Request, res: Response) => {
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
tradingRouter.get('/exchanges/credentials', requireOwnerAuth, (req: Request, res: Response) => {
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
    if (isTestnet === true) return res.status(400).json({ success: false, error: 'Bybit testnet is disabled. GigPilot is live-production only.' });
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
    bybitAdapter.updateCredentials(apiKey, apiSecret);

    globalTradingStore.monitor.logAudit({
      category: 'CONFIG_CHANGE',
      action: `Updated Trade-Only API Keys for ${exchange}`,
      details: { exchange, environment: 'BYBIT_LIVE' }
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

// Live order preview: authoritative backend market data and the same net-edge model used by the execution gate.
tradingRouter.post('/order/preview', requireOwnerAuth, (req: Request, res: Response) => {
  const store = globalTradingStore;
  const { symbol, side, type, price, amount } = req.body || {};
  if (side !== 'BUY' && side !== 'SELL') return res.status(400).json({ success: false, error: 'side must be BUY or SELL' });
  if (type !== 'MARKET' && type !== 'LIMIT') return res.status(400).json({ success: false, error: 'type must be MARKET or LIMIT' });
  const norm = store.dataEngine.normalizeSymbol(String(symbol || store.activeSymbol));
  const liveData = store.dataEngine.getPairData(norm);
  const livePrice = liveData?.currentPrice;
  const numPrice = type === 'MARKET' ? Number(livePrice) : Number(price);
  const numAmount = Number(amount);
  if (!liveData || !Number.isFinite(livePrice) || livePrice <= 0 || !liveData.orderBook?.bids?.length || !liveData.orderBook?.asks?.length) {
    return res.status(503).json({ success: false, error: 'Live market data is unavailable or stale.' });
  }
  if (!Number.isFinite(numPrice) || numPrice <= 0 || !Number.isFinite(numAmount) || numAmount <= 0) return res.status(400).json({ success: false, error: 'Positive price and amount are required.' });
  const edge = store.quantEngine.computeExpectedNetEdge({ symbol: norm, side, price: numPrice, amount: numAmount, orderType: type, orderBook: liveData.orderBook, candles: liveData.candles, gridSpacingPct: store.activeGrid?.gridSpacingPct, regime: store.currentRegime });
  const feeUsd = Number(((numPrice * numAmount) * (edge.makerTakerFeesBps / 10000)).toFixed(4));
  return res.json({ success: true, symbol: norm, currentPrice: livePrice, estimatedExecutionPrice: numPrice, estimatedFeeUsd: feeUsd, expectedNetEdge: edge, serverTime: new Date().toISOString() });
});

// Live Spot protective exit. This is a risk-reducing exchange order, but remains fail-closed on gateway/engine degradation.
tradingRouter.post('/position/protection', requireOwnerAuth, async (req: Request, res: Response) => {
  const store = globalTradingStore;
  if (store.GLOBAL_KILL_SWITCH_ACTIVE || store.killSwitch.getState().isActive) return res.status(403).json({ success: false, error: 'Cannot place protective exits while the GLOBAL KILL SWITCH is engaged.' });
  const failStatus = store.monitor.isSystemFailClosed();
  if (failStatus.failClosed) return res.status(503).json({ success: false, error: 'FAIL-CLOSED: Protective exits are blocked while critical engines are degraded: ' + failStatus.downEngines.join(', ') });
  const { symbol, kind, triggerPrice, amount } = req.body || {};
  if (kind !== 'TAKE_PROFIT' && kind !== 'STOP_LOSS') return res.status(400).json({ success: false, error: 'kind must be TAKE_PROFIT or STOP_LOSS' });
  const norm = store.dataEngine.normalizeSymbol(String(symbol || store.activeSymbol));
  const liveData = store.dataEngine.getPairData(norm);
  const position = store.exchangeExec.getPosition(norm);
  const trigger = Number(triggerPrice);
  const qty = Number(amount ?? position?.baseAmount ?? 0);
  if (!liveData?.currentPrice || !position || position.baseAmount <= 0) return res.status(422).json({ success: false, error: 'No authoritative live position is available to protect.' });
  if (!Number.isFinite(trigger) || trigger <= 0 || !Number.isFinite(qty) || qty <= 0 || qty > position.baseAmount) return res.status(400).json({ success: false, error: 'Protective trigger and quantity must be valid and no larger than the live position.' });
  if (kind === 'TAKE_PROFIT' && trigger <= liveData.currentPrice) return res.status(422).json({ success: false, error: 'Take-profit trigger must be above the live spot price for a long spot position.' });
  if (kind === 'STOP_LOSS' && trigger >= liveData.currentPrice) return res.status(422).json({ success: false, error: 'Stop-loss trigger must be below the live spot price for a long spot position.' });
  const result = await store.exchangeExec.executeProtectiveExit({ symbol: norm, amount: qty, triggerPrice: trigger, kind });
  if (!result.success) return res.status(400).json(result);
  store.monitor.logAudit({ category: 'ORDER_EXECUTION', action: 'Live protective exit placed on BYBIT', details: { symbol: norm, kind, triggerPrice: trigger, amount: qty, orderId: result.orderId } });
  return res.json({ success: true, orderId: result.orderId, symbol: norm, kind, triggerPrice: trigger, amount: qty, serverTime: new Date().toISOString() });
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

tradingRouter.post('/decisions/evaluate', requireOwnerAuth, (req: Request, res: Response) => {
  const store = globalTradingStore;
  const { symbol = store.activeSymbol, side, price, amount, source = 'LIVE_SIGNAL' } = req.body || {};

  if (side !== 'BUY' && side !== 'SELL') {
    return res.status(400).json({ success: false, error: 'side must be BUY or SELL' });
  }

  const livePair = store.dataEngine.getPairData(symbol);
  if (!livePair || livePair.currentPrice <= 0 || !livePair.orderBook || livePair.orderBook.bids.length === 0 || livePair.orderBook.asks.length === 0) {
    return res.status(503).json({ success: false, error: 'Live market data is unavailable or stale; decision evaluation is fail-closed.' });
  }

  const curPrice = price !== undefined ? Number(price) : livePair.currentPrice;
  const liveGridLevel = store.activeGrid?.activeLevels.find(level => level.side === side && level.orderSize > 0);
  const curAmount = amount !== undefined ? Number(amount) : (liveGridLevel?.orderSize || 0);
  if (!Number.isFinite(curPrice) || curPrice <= 0 || !Number.isFinite(curAmount) || curAmount <= 0) {
    return res.status(400).json({ success: false, error: 'A positive live price and amount are required.' });
  }

  const qResult = store.quantEngine.computeSignals(symbol, livePair.candles, livePair.orderBook);
  if (!qResult.regime || qResult.regime.regime === 'UNKNOWN') {
    return res.status(503).json({ success: false, error: 'Insufficient live market evidence for a trading decision.' });
  }

  const expectedNetEdge = store.quantEngine.computeExpectedNetEdge({
    symbol,
    side,
    price: curPrice,
    amount: curAmount,
    orderType: 'LIMIT',
    orderBook: livePair.orderBook,
    candles: livePair.candles,
    gridSpacingPct: store.activeGrid?.gridSpacingPct,
    regime: qResult.regime
  });

  const inventory = store.activeGrid?.inventoryAwareness;
  const decision = store.learningLoop.evaluateAndLogDecision({
    symbol,
    side,
    price: curPrice,
    amount: curAmount,
    source,
    confidence: qResult.regime.confidence,
    regime: qResult.regime as any,
    orderBook: livePair.orderBook,
    candles: livePair.candles,
    positions: store.exchangeExec.getPositions(),
    capital: store.capital,
    inventory,
    expectedNetEdge,
    riskConfig: store.risk.getConfig(),
    circuitBreakerActive: store.risk.isCircuitBreakerActive(),
    failClosed: store.monitor.isSystemFailClosed().failClosed
  });

  return res.json({ success: true, decision, stats: store.learningLoop.getDecisionStats() });
});

// 15. Strategy IDE Live Source Validator
tradingRouter.post('/script/validate', requireOwnerAuth, (req: Request, res: Response) => {
  const { code } = req.body || {};
  if (typeof code !== 'string' || code.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Strategy source code is required.' });
  }
  const result = globalTradingStore.scripting.validateUserScript(code);
  return res.status(result.success ? 200 : 422).json({ success: result.success, result });
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
tradingRouter.get('/sweep/info', requireOwnerAuth, async (req: Request, res: Response) => {
  const store = globalTradingStore;
  const confirmed = await store.sweeper.reconcilePendingSweeps();
  for (const sweep of confirmed) store.profitAccounting.recordSweepExecuted(sweep.amountUsd || sweep.grossSweepAmount || 0, sweep.feePaidUsd || sweep.networkFeeUsd || 0);
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

tradingRouter.post('/sweep/execute', requireOwnerAuth, async (req: Request, res: Response) => {
  const { amountUsd } = req.body;
  const numAmount = Number(amountUsd);
  if (!numAmount || numAmount <= 0) return res.status(400).json({ success: false, error: 'Valid amount required' });

  const store = globalTradingStore;
  const result = await store.sweeper.executeManualSweep(numAmount, store.capital.eligibleRealizedProfit, 'MANUAL_OWNER');
  if (!result.success) {
    return res.status(422).json(result);
  }

  // Capital is deducted only after Bybit confirms the withdrawal.

  store.monitor.logAudit({
    category: 'PROFIT_SWEEP',
    action: `Cold storage sweep of $${numAmount.toFixed(2)} executed`,
    details: { txHash: result.sweep?.txHash, address: result.sweep?.destinationAddress }
  });

  res.json(result);
});
tradingRouter.post('/sweep/auto', requireOwnerAuth, async (req: Request, res: Response) => {
  const store = globalTradingStore;
  const enabled = Boolean(req.body?.enabled);
  const result = store.sweeper.toggleAutoSweep(enabled);
  if (enabled && !result) return res.status(422).json({ success: false, autoSweepEnabled: false, error: 'Whitelisted destination wallet is required before automatic sweep can be enabled.' });
  return res.json({ success: true, autoSweepEnabled: result });
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
tradingRouter.get('/audit-logs', requireOwnerAuth, (req: Request, res: Response) => {
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
tradingRouter.get('/assets', requireOwnerAuth, async (req: Request, res: Response) => {
  try {
    const force = req.query.refresh === 'true';
    const accountState = await bybitAdapter.getRealAccountState(force);
    if (accountState.status === 'CONNECTED') {
      globalTradingStore.profitAccounting.syncFromRealAccount({
        totalEquityUsd: accountState.totalEquityUsd,
        availableCashUsd: accountState.availableCashUsd,
        lockedInOrdersUsd: accountState.lockedInOrdersUsd
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
        edge: store.profitOptimizer.getLatestAudit()?.expectedNetEdge,
        champion: store.learningLoop.getChampionStrategy(),
        gridCapitalUsd: store.activeGrid?.totalAllocatedUsd || 0
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

// 31. Inventory-Aware Grid Metrics & Multi-Variable Equation Read
tradingRouter.get('/inventory-awareness', async (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const symbol = store.activeSymbol;
    const liveData = store.dataEngine.getPairData(symbol);
    if (!liveData || liveData.currentPrice <= 0 || !liveData.orderBook?.bids?.length || !liveData.orderBook?.asks?.length) {
      return res.status(503).json({ success: false, error: 'Live market data is unavailable; inventory metrics are fail-closed.' });
    }
    const currentPrice = liveData.currentPrice;

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
