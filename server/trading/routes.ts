import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { globalTradingStore } from './store.js';
import { generateAdaptiveGrid } from './adaptiveGridEngine.js';
import { computeAllIndicators } from './indicators.js';
import { ownerAuth } from './ownerAuth.js';
import { binanceAdapter } from './binanceAdapter.js';

export const tradingRouter = Router();

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: 'Too many authentication attempts. Please try again later.' }
});

const requireOwner = (req: Request, res: Response, next: Function) => {
  if (process.env.REQUIRE_OWNER_AUTH === 'false') return next();
  if (isOwner(req)) return next();
  return res.status(401).json({ success: false, error: 'Owner authentication required.' });
};

// 1. Master System State
tradingRouter.get('/state', requireOwner, (req: Request, res: Response) => {
  try {
    const store = globalTradingStore;
    const pairState = store.exchange.getPairState(store.activeSymbol);
    const position = store.exchange.getPosition(store.activeSymbol);
    const openOrders = store.exchange.getOpenOrders(store.activeSymbol);
    const indicators = pairState ? computeAllIndicators(pairState.candles, pairState.orderBook) : null;

    const isKillActive = store.GLOBAL_KILL_SWITCH_ACTIVE || store.killSwitch.getState().isActive;

    return res.json({
      success: true,
      activeSymbol: store.activeSymbol,
      autonomyLevel: store.autonomyLevel,
      tradingMode: store.tradingMode,
      GLOBAL_KILL_SWITCH_ACTIVE: isKillActive,
      botsDisabled: store.activeBotsDisabled || isKillActive,
      activeBotsCount: isKillActive ? 0 : (store.autonomyLevel > 0 ? 1 : 0),
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
tradingRouter.post('/pair/select', requireOwner, (req: Request, res: Response) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ success: false, error: 'Symbol required' });

  globalTradingStore.setActiveSymbol(symbol);
  res.json({ success: true, activeSymbol: globalTradingStore.activeSymbol });
});

// 5. Autonomy Level
tradingRouter.post('/autonomy', requireOwner, (req: Request, res: Response) => {
  const { level } = req.body;
  if (level === undefined || level < 0 || level > 4) {
    return res.status(400).json({ success: false, error: 'Invalid autonomy level (0-4)' });
  }

  globalTradingStore.setAutonomyLevel(level);
  res.json({ success: true, autonomyLevel: globalTradingStore.autonomyLevel });
});

// 6. Trading Mode
tradingRouter.post('/mode', requireOwner, (req: Request, res: Response) => {
  const { mode } = req.body;
  if (mode !== 'LIVE') {
    return res.status(400).json({ success: false, error: 'GigPilot is LIVE Binance Spot only; paper and simulation modes have been removed.' });
  }

  globalTradingStore.setTradingMode('LIVE');
  res.json({ success: true, tradingMode: globalTradingStore.tradingMode });
});

// 7. Global Kill Switch
tradingRouter.post('/kill-switch/trigger', requireOwner, async (req: Request, res: Response) => {
  const { reason } = req.body;
  await globalTradingStore.triggerEmergencyKillSwitch(reason || 'Manual emergency halt: Disabling all active trading bots');
  res.json({
    success: true,
    GLOBAL_KILL_SWITCH_ACTIVE: true,
    botsDisabled: true,
    autonomyLevel: globalTradingStore.autonomyLevel,
    killSwitch: globalTradingStore.killSwitch.getState()
  });
});

tradingRouter.post('/kill-switch/deactivate', requireOwner, (req: Request, res: Response) => {
  globalTradingStore.deactivateKillSwitch();
  res.json({
    success: true,
    GLOBAL_KILL_SWITCH_ACTIVE: globalTradingStore.GLOBAL_KILL_SWITCH_ACTIVE,
    botsDisabled: globalTradingStore.activeBotsDisabled,
    autonomyLevel: globalTradingStore.autonomyLevel,
    killSwitch: globalTradingStore.killSwitch.getState()
  });
});

tradingRouter.post('/kill-switch/toggle', requireOwner, async (req: Request, res: Response) => {
  const { active, reason } = req.body;
  const shouldActivate = active !== undefined ? Boolean(active) : !globalTradingStore.GLOBAL_KILL_SWITCH_ACTIVE;
  
  if (shouldActivate) {
    await globalTradingStore.triggerEmergencyKillSwitch(reason || 'Manual operator toggle: Disabling all active trading bots');
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

// 8. Configure Grid
tradingRouter.post('/grid/configure', requireOwner, async (req: Request, res: Response) => {
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

  const killActive = store.GLOBAL_KILL_SWITCH_ACTIVE || store.killSwitch.getState().isActive;
  if (killActive) {
    return res.status(403).json({ success: false, error: 'Cannot configure/execute a grid while the global kill switch is active.' });
  }
  if (store.tradingMode === 'LIVE' && store.autonomyLevel < 2) {
    return res.status(403).json({ success: false, error: 'LIVE grid execution requires autonomy level 2-4.' });
  }

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

  // Every generated grid order still passes through the independent risk gateway.
  for (const lvl of newGrid.activeLevels) {
    const validation = store.risk.validateOrder(
      {
        symbol: newGrid.symbol,
        side: lvl.side,
        price: lvl.price,
        amount: lvl.orderSize,
        isGridOrder: true
      },
      store.capital,
      store.exchange.getPositions(),
      store.exchange.getOpenOrders().length
    );

    if (validation.allowed) {
      await store.exchange.placeOrder({
        symbol: newGrid.symbol,
        side: lvl.side,
        type: 'GRID_LIMIT',
        price: lvl.price,
        amount: lvl.orderSize,
        isGridOrder: true,
        gridLevelId: lvl.id,
        strategyId: store.learningLoop.getChampion().id
      });
    }
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
tradingRouter.post('/order/place', requireOwner, async (req: Request, res: Response) => {
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

  const order = await store.exchange.placeOrder({
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
tradingRouter.post('/order/cancel', requireOwner, (req: Request, res: Response) => {
  const { orderId } = req.body;
  const order = globalTradingStore.exchange.cancelOrder(orderId);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found or already filled' });

  globalTradingStore.logAudit('OWNER', 'ORDER_CANCELLED', { orderId }, 'SUCCESS');
  res.json({ success: true, order });
});

tradingRouter.post('/order/cancel-all', requireOwner, (req: Request, res: Response) => {
  const count = globalTradingStore.exchange.cancelAllOrders();
  globalTradingStore.logAudit('OWNER', 'ALL_ORDERS_CANCELLED', { count }, 'SUCCESS');
  res.json({ success: true, cancelledCount: count });
});

// 11. Learning Loop Strategies & Promotion
tradingRouter.get('/strategies', requireOwner, (req: Request, res: Response) => {
  const store = globalTradingStore;
  res.json({
    success: true,
    champion: store.learningLoop.getChampion(),
    challengers: store.learningLoop.getChallengers(),
    history: store.learningLoop.getHistory()
  });
});

tradingRouter.post('/strategy/promote', requireOwner, (req: Request, res: Response) => {
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

tradingRouter.post('/strategy/create-variant', requireOwner, (req: Request, res: Response) => {
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
tradingRouter.post('/script/execute', requireOwner, (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ success: false, error: 'Code is required' });

  const store = globalTradingStore;
  const pairState = store.exchange.getPairState(store.activeSymbol);
  const position = store.exchange.getPosition(store.activeSymbol) || {
    symbol: store.activeSymbol,
    baseAmount: 0,
    quoteAmount: 0,
    entryPrice: 0,
    currentPrice: pairState?.currentPrice || 0,
    unrealizedPnL: 0,
    unrealizedPnLPct: 0,
    realizedPnL: 0,
    totalFeesPaid: 0,
    netPnL: 0
  };

  const result = store.scripting.executeUserScript(code, {
    symbol: store.activeSymbol,
    candles: pairState?.candles || [],
    orderBook: pairState?.orderBook || store.exchange.getPairState(store.activeSymbol)?.orderBook || {
      symbol: store.activeSymbol,
      bids: [],
      asks: [],
      spread: 0,
      spreadBps: 0,
      midPrice: 0,
      timestamp: Date.now()
    },
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

tradingRouter.post('/research/analyze', requireOwner, async (req: Request, res: Response) => {
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
tradingRouter.get('/profit-sweep', requireOwner, (req: Request, res: Response) => {
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

tradingRouter.post('/profit-sweep/wallet', requireOwner, (req: Request, res: Response) => {
  const { address, chain, label } = req.body;
  if (!address) return res.status(400).json({ success: false, error: 'Address is required' });

  const updated = globalTradingStore.sweeper.updateWallet({ address, chain, label, isWhitelisted: true });
  globalTradingStore.logAudit('OWNER', 'DESTINATION_WALLET_UPDATED', { address, chain }, 'SUCCESS');
  res.json({ success: true, wallet: updated });
});

tradingRouter.post('/profit-sweep/wallet/confirm', requireOwner, (req: Request, res: Response) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ success: false, error: 'Address is required.' });
  try {
    const wallet = globalTradingStore.sweeper.confirmWallet(String(address));
    globalTradingStore.logAudit('OWNER', 'DESTINATION_WALLET_CONFIRMED', { address }, 'SUCCESS');
    return res.json({ success: true, wallet });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message || 'Wallet confirmation failed.' });
  }
});

tradingRouter.post('/profit-sweep/execute', requireOwner, (req: Request, res: Response) => {
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

tradingRouter.post('/risk/config', requireOwner, (req: Request, res: Response) => {
  const updated = globalTradingStore.risk.updateConfig(req.body);
  globalTradingStore.logAudit('OWNER', 'RISK_RULES_UPDATED', req.body, 'SUCCESS');
  res.json({ success: true, config: updated });
});

tradingRouter.post('/risk/reset-circuit-breaker', requireOwner, (req: Request, res: Response) => {
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

tradingRouter.post('/updates/rollout', requireOwner, (req: Request, res: Response) => {
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
    // client disconnected
  });
});

// 19. Single Owner Authentication & Google Authenticator (TOTP)
function extractToken(req: Request): string | null {
  const cookieToken = (req as any).cookies?.gigpilot_owner_session;
  if (cookieToken) return String(cookieToken);

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return (req.headers['x-owner-token'] as string) || null;
}

function isOwner(req: Request): boolean {
  const token = extractToken(req);
  return token ? ownerAuth.verifyToken(token) : false;
}

tradingRouter.get('/auth/status', (req: Request, res: Response) => {
  const authenticated = isOwner(req);
  const status = ownerAuth.getStatus(authenticated);
  return res.json({
    success: true,
    isAuthenticated: authenticated,
    isConfigured: status.isConfigured,
    totpEnabled: status.totpEnabled,
    hasPassword: status.hasPassword,
    GLOBAL_KILL_SWITCH_ACTIVE: globalTradingStore.GLOBAL_KILL_SWITCH_ACTIVE,
    tradingMode: globalTradingStore.tradingMode
  });
});

tradingRouter.post('/auth/setup-init', authRateLimit, async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    const setupData = await ownerAuth.initiateTotpSetup(email);
    return res.json({
      success: true,
      ...setupData
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.post('/auth/setup-complete', authRateLimit, (req: Request, res: Response) => {
  try {
    const { password, totpCode, email } = req.body || {};
    const result = ownerAuth.completeSetup(password, totpCode, email);
    if (!result.success) {
      return res.status(400).json(result);
    }
    globalTradingStore.logAudit('OWNER', 'OWNER_ACCOUNT_SETUP_COMPLETED', { email }, 'SUCCESS');
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.post('/auth/login', authRateLimit, (req: Request, res: Response) => {
  try {
    const { email, password, totpCode, emergencyPin } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'Owner email is required.' });
    }
    const result = ownerAuth.login({ email, password, totpCode, emergencyPin });
    if (!result.success) {
      globalTradingStore.logAudit('OWNER', 'LOGIN_ATTEMPT_FAILED', { email, error: result.error }, 'REJECTED');
      return res.status(401).json(result);
    }
    globalTradingStore.logAudit('OWNER', 'OWNER_LOGIN_SUCCESSFUL', { email }, 'SUCCESS');

    if (result.token) {
      res.cookie('gigpilot_owner_session', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 12 * 60 * 60 * 1000,
        path: '/'
      });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

tradingRouter.post('/auth/logout', (req: Request, res: Response) => {
  res.clearCookie('gigpilot_owner_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });
  globalTradingStore.logAudit('OWNER', 'OWNER_LOGOUT', {}, 'SUCCESS');
  return res.json({ success: true, message: 'Logged out successfully' });
});

// 20. Real Live Exchange Assets & Spot Balances (Binance Spot)
tradingRouter.get('/assets', requireOwner, async (req: Request, res: Response) => {
  try {
    const force = req.query.refresh === 'true';
    const accountState = await binanceAdapter.getRealAccountState(force);
    
    // Sync store capital with real Binance account numbers
    if (accountState.status === 'CONNECTED') {
      globalTradingStore.capital.totalEquity = accountState.totalEquityUsd;
      globalTradingStore.capital.availableCash = accountState.availableCashUsd;
      globalTradingStore.capital.lockedInOrders = accountState.lockedInOrdersUsd;
      globalTradingStore.capital.tradingCapital = accountState.totalEquityUsd;
    }

    return res.json({
      success: true,
      assets: accountState
    });
  } catch (err: any) {
    console.error('Error in /api/trading/assets:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 21. Binance Connection Status & Dynamic API Key Management
tradingRouter.get('/binance/status', requireOwner, (req: Request, res: Response) => {
  return res.json({
    success: true,
    apiKeyConfigured: binanceAdapter.isKeyConfigured(),
    keyMask: binanceAdapter.getKeyMask(),
    serverIp: binanceAdapter.getServerIp(),
    baseUrl: binanceAdapter.getBaseUrl(),
    status: binanceAdapter.isKeyConfigured() ? 'CONFIGURED' : 'UNCONFIGURED'
  });
});

tradingRouter.get('/binance/diagnostics', requireOwner, async (req: Request, res: Response) => {
  try {
    const accountState = await binanceAdapter.getRealAccountState(true);
    const restrictions = await binanceAdapter.getApiRestrictions();
    return res.json({
      success: true,
      accountStatus: accountState.status,
      message: accountState.message,
      serverIp: accountState.serverIp,
      baseUrl: binanceAdapter.getBaseUrl(),
      keyMask: binanceAdapter.getKeyMask(),
      restrictions
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Binance diagnostics failed' });
  }
});

tradingRouter.post('/binance/update-keys', requireOwner, async (req: Request, res: Response) => {
  try {
    const { apiKey, apiSecret, baseUrl } = req.body || {};
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ success: false, error: 'Both API Key and API Secret are required.' });
    }

    binanceAdapter.updateCredentials(apiKey, apiSecret, baseUrl);
    const testState = await binanceAdapter.getRealAccountState(true);
    const restrictions = await binanceAdapter.getApiRestrictions();

    if (testState.status !== 'CONNECTED') {
      globalTradingStore.logAudit('OWNER', 'BINANCE_KEYS_VALIDATION_FAILED', {
        keyMask: binanceAdapter.getKeyMask(),
        status: testState.status,
        message: testState.message
      }, 'FAILED');
      return res.status(testState.status === 'RESTRICTED' ? 403 : 502).json({
        success: false,
        message: 'Binance credentials were saved, but the Spot account could not be read.',
        error: testState.message,
        accountState: testState,
        restrictions
      });
    }

    globalTradingStore.logAudit('OWNER', 'BINANCE_KEYS_UPDATED', {
      keyMask: binanceAdapter.getKeyMask(),
      status: testState.status
    }, 'SUCCESS');

    return res.json({
      success: true,
      message: 'Binance API credentials validated and connected to Spot.',
      accountState: testState,
      restrictions
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

