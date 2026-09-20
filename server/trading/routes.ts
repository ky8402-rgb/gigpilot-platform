import { Router, Request, Response } from 'express';
import { globalTradingStore } from './store.js';
import { generateAdaptiveGrid } from './adaptiveGridEngine.js';
import { computeAllIndicators } from './indicators.js';

export const tradingRouter = Router();

// 1. Master System State
tradingRouter.get('/state', (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const pairState = store.exchange.getPairState(store.activeSymbol);
    const position = store.exchange.getPosition(store.activeSymbol);
    const openOrders = store.exchange.getOpenOrders(store.activeSymbol);
    const indicators = pairState ? computeAllIndicators(pairState.candles, pairState.orderBook) : null;

    return res.json({
      success: true,
      activeSymbol: store.activeSymbol,
      autonomyLevel: store.autonomyLevel,
      tradingMode: store.tradingMode,
      killSwitch: store.killSwitch.getState(),
      capital: store.capital,
      currentRegime: store.currentRegime,
      activeGrid: store.activeGrid,
      position,
      allPositions: store.exchange.getPositions(),
      openOrders,
      recentFills: store.exchange.getFills().slice(0, 15),
      indicators,
      championStrategy: store.learningLoop.getChampion(),
      circuitBreakerActive: store.risk.isCircuitBreakerActive(),
      destinationWallet: store.sweeper.getWallet(),
      sweepEligibility: store.sweeper.calculateSweepEligibility(store.capital),
      serverTime: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('[Trading API Error] /state:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error in state endpoint' });
  }
});

// 2. All Pairs & Market Ticker
tradingRouter.get('/pairs', (req: Request, res: Response) => {
  try {
    const pairs = globalTradingStore.exchange.getAllPairs().map(p => ({
      symbol: p.symbol,
      price: p.currentPrice,
      open24h: p.open24h,
      high24h: p.high24h,
      low24h: p.low24h,
      volume24h: p.volume24h,
      change24hPct: Number((((p.currentPrice - p.open24h) / p.open24h) * 100).toFixed(2))
    }));
    return res.json({ success: true, pairs });
  } catch (err: any) {
    console.error('[Trading API Error] /pairs:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error in pairs endpoint' });
  }
});

// 3. Pair Details & Candlesticks
tradingRouter.get('/pair/:symbol', (req: Request, res: Response) => {
  const symbol = decodeURIComponent(req.params.symbol);
  const state = globalTradingStore.exchange.getPairState(symbol);
  if (!state) {
    return res.status(404).json({ success: false, error: 'Pair not found' });
  }

  const indicators = computeAllIndicators(state.candles, state.orderBook);

  res.json({
    success: true,
    symbol: state.symbol,
    currentPrice: state.currentPrice,
    candles: state.candles,
    orderBook: state.orderBook,
    indicators
  });
});

// 4. Select Active Pair
tradingRouter.post('/pair/select', (req: Request, res: Response) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ success: false, error: 'Symbol required' });

  globalTradingStore.setActiveSymbol(symbol);
  res.json({ success: true, activeSymbol: globalTradingStore.activeSymbol });
});

// 5. Autonomy Level
tradingRouter.post('/autonomy', (req: Request, res: Response) => {
  const { level } = req.body;
  if (level === undefined || level < 0 || level > 4) {
    return res.status(400).json({ success: false, error: 'Invalid autonomy level (0-4)' });
  }

  globalTradingStore.setAutonomyLevel(level);
  res.json({ success: true, autonomyLevel: globalTradingStore.autonomyLevel });
});

// 6. Trading Mode
tradingRouter.post('/mode', (req: Request, res: Response) => {
  const { mode } = req.body;
  if (!['SIMULATION', 'PAPER', 'LIVE'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'Invalid mode' });
  }

  globalTradingStore.setTradingMode(mode);
  res.json({ success: true, tradingMode: globalTradingStore.tradingMode });
});

// 7. Global Kill Switch
tradingRouter.post('/kill-switch/trigger', (req: Request, res: Response) => {
  const { reason } = req.body;
  globalTradingStore.triggerEmergencyKillSwitch(reason || 'Manual emergency halt from terminal');
  res.json({
    success: true,
    killSwitch: globalTradingStore.killSwitch.getState()
  });
});

tradingRouter.post('/kill-switch/deactivate', (req: Request, res: Response) => {
  globalTradingStore.deactivateKillSwitch();
  res.json({
    success: true,
    killSwitch: globalTradingStore.killSwitch.getState()
  });
});

// 8. Configure Grid
tradingRouter.post('/grid/configure', (req: Request, res: Response) => {
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

  const pairState = store.exchange.getPairState(store.activeSymbol);
  if (!pairState) return res.status(400).json({ success: false, error: 'No active pair state' });

  store.exchange.cancelAllOrders(store.activeSymbol);

  const newGrid = generateAdaptiveGrid({
    symbol: store.activeSymbol,
    currentPrice: pairState.currentPrice,
    upperBoundary: Number(upperBoundary) || undefined,
    lowerBoundary: Number(lowerBoundary) || undefined,
    levelsCount: Number(levelsCount) || 20,
    spacingType: spacingType || 'GEOMETRIC',
    totalAllocatedUsd: Number(totalAllocatedUsd) || 3500,
    volatilityAdjustment: volatilityAdjustment !== false,
    trendProtection: trendProtection !== false,
    regime: store.currentRegime
  });

  store.activeGrid = newGrid;

  // Place in exchange
  for (const lvl of newGrid.activeLevels) {
    store.exchange.placeOrder({
      symbol: newGrid.symbol,
      side: lvl.side,
      type: 'GRID_LIMIT',
      price: lvl.price,
      amount: lvl.orderSize,
      isGridOrder: true,
      gridLevelId: lvl.id
    });
  }

  store.logAudit('OWNER', 'GRID_MANUALLY_CONFIGURED', {
    symbol: store.activeSymbol,
    upper: newGrid.upperBoundary,
    lower: newGrid.lowerBoundary,
    levels: newGrid.levelsCount
  }, 'SUCCESS');

  res.json({ success: true, grid: newGrid });
});

// 9. Manual Order Placement (Validated via Independent Risk Engine)
tradingRouter.post('/order/place', (req: Request, res: Response) => {
  const store = globalTradingStore;
  if (store.killSwitch.getState().isActive) {
    return res.status(403).json({ success: false, error: 'Cannot place orders: Kill Switch is ACTIVE' });
  }

  const { symbol, side, type, price, amount } = req.body;
  if (!symbol || !side || !type || !price || !amount) {
    return res.status(400).json({ success: false, error: 'Missing required order fields' });
  }

  const numPrice = Number(price);
  const numAmount = Number(amount);

  // Risk Engine Validation (Hard Constraint)
  const validation = store.risk.validateOrder(
    { symbol, side, price: numPrice, amount: numAmount },
    store.capital,
    store.exchange.getPositions(),
    store.exchange.getOpenOrders().length
  );

  if (!validation.allowed) {
    return res.status(422).json({
      success: false,
      error: `Order rejected by Risk Engine: ${validation.reason}`,
      event: validation.event
    });
  }

  const order = store.exchange.placeOrder({
    symbol,
    side,
    type,
    price: numPrice,
    amount: numAmount
  });

  store.logAudit('OWNER', 'ORDER_PLACED', { orderId: order.id, symbol, side, price: numPrice, amount: numAmount }, 'SUCCESS');

  res.json({ success: true, order });
});

// 10. Cancel Order
tradingRouter.post('/order/cancel', (req: Request, res: Response) => {
  const { orderId } = req.body;
  const order = globalTradingStore.exchange.cancelOrder(orderId);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found or already filled' });

  globalTradingStore.logAudit('OWNER', 'ORDER_CANCELLED', { orderId }, 'SUCCESS');
  res.json({ success: true, order });
});

tradingRouter.post('/order/cancel-all', (req: Request, res: Response) => {
  const count = globalTradingStore.exchange.cancelAllOrders();
  globalTradingStore.logAudit('OWNER', 'ALL_ORDERS_CANCELLED', { count }, 'SUCCESS');
  res.json({ success: true, cancelledCount: count });
});

// 11. Learning Loop Strategies & Promotion
tradingRouter.get('/strategies', (req: Request, res: Response) => {
  const store = globalTradingStore;
  res.json({
    success: true,
    champion: store.learningLoop.getChampion(),
    challengers: store.learningLoop.getChallengers(),
    history: store.learningLoop.getHistory()
  });
});

tradingRouter.post('/strategy/promote', (req: Request, res: Response) => {
  const { challengerId } = req.body;
  const result = globalTradingStore.learningLoop.evaluatePromotion(challengerId);

  globalTradingStore.logAudit(
    'OWNER',
    'STRATEGY_PROMOTION_EVALUATION',
    { challengerId, promoted: result.promoted, reason: result.reason },
    result.promoted ? 'SUCCESS' : 'REJECTED'
  );

  res.json({ success: result.promoted, ...result });
});

tradingRouter.post('/strategy/create-variant', (req: Request, res: Response) => {
  const { baseStrategyId, name, reasonForChange, parameters, expectedEffect } = req.body;
  const newVariant = globalTradingStore.learningLoop.createChallengerVariant(
    baseStrategyId,
    {
      name: name || 'Adaptive Volatility Variant',
      reasonForChange: reasonForChange || 'Auto-generated optimization candidate',
      parameters: parameters || {},
      expectedEffect: expectedEffect || 'Testing higher Sharpe parameter perturbation'
    }
  );

  res.json({ success: true, challenger: newVariant });
});

// 12. Sandboxed In-App Scripting Execution
tradingRouter.post('/script/execute', (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ success: false, error: 'Code is required' });

  const store = globalTradingStore;
  const pairState = store.exchange.getPairState(store.activeSymbol);
  const position = store.exchange.getPosition(store.activeSymbol) || {
    symbol: store.activeSymbol,
    baseAmount: 0,
    quoteAmount: 10000,
    entryPrice: 0,
    currentPrice: pairState?.currentPrice || 65000,
    unrealizedPnL: 0,
    unrealizedPnLPct: 0,
    realizedPnL: 0,
    totalFeesPaid: 0,
    netPnL: 0
  };

  const result = store.scripting.executeUserScript(code, {
    symbol: store.activeSymbol,
    candles: pairState?.candles || [],
    orderBook: pairState?.orderBook || store.exchange.generateRealisticOrderBook(store.activeSymbol, 65000),
    position,
    balance: store.capital.availableCash,
    marketRegime: store.currentRegime.regime
  });

  // If script generated orders and kill switch is not active, apply them
  if (result.success && !store.killSwitch.getState().isActive && result.ordersGenerated.length > 0) {
    for (const ord of result.ordersGenerated) {
      const v = store.risk.validateOrder(
        { symbol: store.activeSymbol, side: ord.side, price: ord.price, amount: ord.amount },
        store.capital,
        store.exchange.getPositions(),
        store.exchange.getOpenOrders().length
      );
      if (v.allowed) {
        store.exchange.placeOrder({
          symbol: store.activeSymbol,
          side: ord.side,
          type: ord.type,
          price: ord.price,
          amount: ord.amount,
          strategyId: 'CUSTOM-SCRIPT-IDE'
        });
      } else {
        result.logs.push(`[RiskEngine Rejected] ${v.reason}`);
      }
    }
  }

  res.json({ success: result.success, result });
});

// 13. Autonomous Web Research
tradingRouter.get('/research', (req: Request, res: Response) => {
  res.json({
    success: true,
    items: globalTradingStore.research.getResearchFeed()
  });
});

tradingRouter.post('/research/analyze', async (req: Request, res: Response) => {
  const { title, content, source } = req.body;
  if (!title || !content) {
    return res.status(400).json({ success: false, error: 'Title and content required' });
  }

  try {
    const item = await globalTradingStore.research.analyzeNewIntelligence(
      title,
      content,
      source || 'External RSS / Web Feed'
    );
    res.json({ success: true, item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Wallet Profit Sweep Subsystem
tradingRouter.get('/profit-sweep', (req: Request, res: Response) => {
  const store = globalTradingStore;
  const settings = store.sweeper.getSweepSettings();
  const eligibility = store.sweeper.calculateSweepEligibility(store.capital);
  const history = store.sweeper.getSweepsHistory();

  res.json({
    success: true,
    ...settings,
    eligibility,
    history
  });
});

tradingRouter.post('/profit-sweep/wallet', (req: Request, res: Response) => {
  const { address, chain, label } = req.body;
  if (!address) return res.status(400).json({ success: false, error: 'Address is required' });

  const updated = globalTradingStore.sweeper.updateWallet({ address, chain, label, isWhitelisted: true });
  globalTradingStore.logAudit('OWNER', 'DESTINATION_WALLET_UPDATED', { address, chain }, 'SUCCESS');
  res.json({ success: true, wallet: updated });
});

tradingRouter.post('/profit-sweep/execute', (req: Request, res: Response) => {
  const store = globalTradingStore;
  if (store.killSwitch.getState().isActive) {
    return res.status(403).json({ success: false, error: 'Cannot execute profit sweep: Kill switch is ACTIVE' });
  }

  const { amount } = req.body;
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid sweep amount' });
  }

  const result = store.sweeper.executeSweep(numAmount, store.capital, 'MANUAL_OWNER');
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }

  // Deduct from available withdrawable profit & update swept total
  store.capital.totalSweptProfit += numAmount;
  store.capital.withdrawableProfit = Math.max(0, store.capital.withdrawableProfit - numAmount);
  store.capital.availableCash = Math.max(0, store.capital.availableCash - numAmount);
  store.capital.totalEquity = Math.max(0, store.capital.totalEquity - numAmount);

  store.logAudit('SWEEP_DAEMON', 'PROFIT_SWEPT_TO_WALLET', {
    amount: numAmount,
    txHash: result.sweep?.txHash,
    wallet: result.sweep?.destinationWallet
  }, 'SUCCESS');

  res.json({ success: true, sweep: result.sweep, updatedCapital: store.capital });
});

// 15. Risk Engine Config & Events
tradingRouter.get('/risk', (req: Request, res: Response) => {
  const store = globalTradingStore;
  res.json({
    success: true,
    config: store.risk.getConfig(),
    circuitBreakerActive: store.risk.isCircuitBreakerActive(),
    events: store.risk.getRiskEvents()
  });
});

tradingRouter.post('/risk/config', (req: Request, res: Response) => {
  const updated = globalTradingStore.risk.updateConfig(req.body);
  globalTradingStore.logAudit('OWNER', 'RISK_RULES_UPDATED', req.body, 'SUCCESS');
  res.json({ success: true, config: updated });
});

tradingRouter.post('/risk/reset-circuit-breaker', (req: Request, res: Response) => {
  globalTradingStore.risk.resetCircuitBreaker();
  globalTradingStore.logAudit('OWNER', 'CIRCUIT_BREAKER_RESET', {}, 'SUCCESS');
  res.json({ success: true, circuitBreakerActive: false });
});

// 16. Self-Updating & Canary Rollouts
tradingRouter.get('/updates', (req: Request, res: Response) => {
  res.json({
    success: true,
    updates: globalTradingStore.updater.getUpdatesHistory()
  });
});

tradingRouter.post('/updates/rollout', (req: Request, res: Response) => {
  const { version, notes } = req.body;
  const update = globalTradingStore.updater.triggerCanaryRollout(
    version || `v2.${Math.floor(Date.now() / 1000000)}`,
    notes || 'Canary testing automated boundary damper'
  );
  globalTradingStore.logAudit('OWNER', 'CANARY_ROLLOUT_TRIGGERED', { version: update.version }, 'SUCCESS');
  res.json({ success: true, update });
});

// 17. Audit Logs
tradingRouter.get('/audit-logs', (req: Request, res: Response) => {
  res.json({
    success: true,
    logs: globalTradingStore.auditLogs
  });
});

// 18. Server-Sent Events (SSE) Live Feed
tradingRouter.get('/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const sendTick = (symbol: string, price: number) => {
    if (symbol === globalTradingStore.activeSymbol) {
      const data = JSON.stringify({
        type: 'TICK',
        symbol,
        price,
        regime: globalTradingStore.currentRegime.regime,
        unrealizedProfit: globalTradingStore.capital.unrealizedProfit,
        totalEquity: globalTradingStore.capital.totalEquity,
        timestamp: Date.now()
      });
      res.write(`data: ${data}\n\n`);
    }
  };

  globalTradingStore.exchange.registerTickCallback(sendTick);

  req.on('close', () => {
    // Client disconnected
  });
});
