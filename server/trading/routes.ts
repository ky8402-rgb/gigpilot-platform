import { Router, Request, Response } from 'express';
import { globalTradingStore } from './store.js';
import { ownerAuth } from './ownerAuth.js';
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
      circuitBreakerActive: store.risk.isCircuitBreakerActive(),
      destinationWallet: store.sweeper.getDestinationWallet(),
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
tradingRouter.post('/engines/:id/off-switch', (req: Request, res: Response) => {
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
tradingRouter.post('/engines/:id/clear-errors', (req: Request, res: Response) => {
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

tradingRouter.post('/exchanges/keys', (req: Request, res: Response) => {
  try {
    const { exchange, apiKey, apiSecret } = req.body || {};
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
      details: { exchange, environment: 'BYBIT_LIVE_PRODUCTION' }
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
tradingRouter.post('/pair/select', async (req: Request, res: Response) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ success: false, error: 'Symbol required' });

  await globalTradingStore.setActiveSymbol(symbol);
  res.json({ success: true, activeSymbol: globalTradingStore.activeSymbol });
});

// 9. Autonomy Level
tradingRouter.post('/autonomy', (req: Request, res: Response) => {
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

tradingRouter.post('/kill-switch/deactivate', (req: Request, res: Response) => {
  globalTradingStore.deactivateKillSwitch();
  res.json({
    success: true,
    GLOBAL_KILL_SWITCH_ACTIVE: false,
    botsDisabled: false,
    autonomyLevel: globalTradingStore.autonomyLevel,
    killSwitch: globalTradingStore.killSwitch.getState()
  });
});

tradingRouter.post('/kill-switch/toggle', (req: Request, res: Response) => {
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
tradingRouter.post('/grid/configure', async (req: Request, res: Response) => {
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
    regime: store.currentRegime
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
tradingRouter.post('/order/place', async (req: Request, res: Response) => {
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

  // 1. Risk Engine Pre-Trade Gate
  const validation = store.risk.validateOrder(
    { symbol: norm, side, price: numPrice, amount: numAmount },
    store.capital,
    store.exchangeExec.getPositions(),
    store.exchangeExec.getOpenOrders().length,
    liveData?.currentPrice
  );

  if (!validation.allowed) {
    return res.status(422).json({
      success: false,
      error: `Order rejected by Risk Engine: ${validation.reason}`,
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
    exchange: targetExchange
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
tradingRouter.post('/order/cancel', async (req: Request, res: Response) => {
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

tradingRouter.post('/order/cancel-all', async (req: Request, res: Response) => {
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

tradingRouter.post('/strategy/promote', (req: Request, res: Response) => {
  const { challengerId, reason, stability } = req.body;
  if (!challengerId) return res.status(400).json({ success: false, error: 'challengerId is required' });

  // Parameter stability is a hard promotion criterion. The optimizer must demonstrate
  // that nearby parameter values remain profitable rather than promoting a single historical peak.
  if (stability?.parameter && Number.isFinite(Number(stability.baselineValue)) && Array.isArray(stability.samples)) {
    const assessment = globalTradingStore.learningLoop.assessParameterStability(
      challengerId,
      String(stability.parameter),
      Number(stability.baselineValue),
      stability.samples
    );
    if (!assessment.stable) {
      return res.status(422).json({
        success: false,
        error: assessment.reason || 'Parameter stability validation failed',
        parameterStability: assessment.report
      });
    }
  } else {
    return res.status(422).json({
      success: false,
      error: 'Promotion requires parameter stability evidence: parameter, baselineValue, and at least 3 nearby samples.'
    });
  }

  const promoted = globalTradingStore.learningLoop.promoteChallenger(challengerId, reason);
  if (!promoted) {
    return res.status(400).json({ success: false, error: 'Challenger not found, optimizer offline, or promotion criteria failed' });
  }

  globalTradingStore.monitor.logAudit({
    category: 'CONFIG_CHANGE',
    action: `Strategy promoted: ${promoted.id}`,
    details: {
      promotedId: promoted.id,
      reason,
      promotionScore: promoted.promotionScore,
      parameterStability: promoted.parameterStability
    }
  });

  res.json({ success: true, champion: promoted });
});

// 15. Strategy IDE Live Source Validation
tradingRouter.post('/script/validate', (req: Request, res: Response) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, error: 'Strategy source is required' });
  const result = globalTradingStore.scripting.validateUserScript(String(code));
  return res.status(result.success ? 200 : 422).json(result);
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
    totalSweptUsd: store.capital.totalSweptProfit,
    autoSweepEnabled: store.sweeper.isAutoSweepEnabled(),
    sweepEngine: store.sweeper.healthCheck()
  });
});

tradingRouter.post('/sweep/auto', (req: Request, res: Response) => {
  const enabled = Boolean(req.body?.enabled);
  const store = globalTradingStore;
  const value = store.sweeper.toggleAutoSweep(enabled);
  return res.json({
    success: true,
    autoSweepEnabled: value,
    message: value
      ? 'Automatic live Bybit profit withdrawal enabled for the persisted whitelisted destination.'
      : 'Automatic profit withdrawal disabled.'
  });
});

tradingRouter.post('/sweep/wallet', (req: Request, res: Response) => {
  const { wallet } = req.body;
  if (!wallet) return res.status(400).json({ success: false, error: 'Wallet payload required' });
  const result = globalTradingStore.sweeper.setDestinationWallet(wallet);
  res.json(result);
});

tradingRouter.post('/sweep/execute', async (req: Request, res: Response) => {
  const { amountUsd } = req.body;
  const numAmount = Number(amountUsd);
  if (!numAmount || numAmount <= 0) return res.status(400).json({ success: false, error: 'Valid amount required' });

  const store = globalTradingStore;
  const result = await store.sweeper.executeManualSweep(numAmount, store.capital.eligibleRealizedProfit);
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

tradingRouter.post('/risk/circuit-breaker/reset', (req: Request, res: Response) => {
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
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return (req.query.token as string) || (req.headers['x-owner-token'] as string) || null;
}

function isOwner(req: Request): boolean {
  const token = extractToken(req);
  return token ? ownerAuth.verifyToken(token) : false;
}

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


// 22. Autonomous Revenue Optimization — live state audit and decisioning
tradingRouter.get('/optimizer', (req: Request, res: Response) => {
  try {
    const optimizer = globalTradingStore.profitOptimizer;
    return res.json({
      success: true,
      objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
      autonomousDecisioning: true,
      decisions: optimizer.getDecisions(),
      strategyBuilds: optimizer.getStrategyBuilds(),
      engine: optimizer.healthCheck()
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Optimizer telemetry unavailable.' });
  }
});

tradingRouter.post('/optimizer/run', async (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const livePair = store.dataEngine.getPairData(store.activeSymbol);
    const systemHealthy = !store.monitor.isSystemFailClosed().failClosed
      && !store.GLOBAL_KILL_SWITCH_ACTIVE
      && store.autonomyLevel >= 2
      && Boolean(livePair?.currentPrice && livePair.currentPrice > 0);

    if (!systemHealthy) {
      return res.status(409).json({
        success: false,
        error: 'Optimizer is fail-closed: live market/account state is not eligible for autonomous optimization.',
        decision: store.profitOptimizer.getDecisions()[0] || null
      });
    }

    const decision = await store.profitOptimizer.auditAndOptimize({
      capital: store.capital,
      grid: store.activeGrid,
      regime: store.currentRegime,
      research: store.research.getResearchItems(),
      champion: store.learningLoop.getChampionStrategy(),
      systemHealthy
    });

    return res.json({ success: true, objective: 'NET_REALIZED_PROFIT_AFTER_FEES', decision });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Autonomous optimizer failed closed.' });
  }
});
