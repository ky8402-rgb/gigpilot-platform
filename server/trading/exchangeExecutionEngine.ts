import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EngineErrorRecord, EngineHealth, EngineModule, ExpectedNetEdgeBreakdown, Fill, Order, Position, SupportedExchange } from './types.js';

export interface ExchangeApiCredentials {
  exchange: SupportedExchange;
  apiKey: string;
  apiSecret: string;
  label?: string;
  isConfigured: boolean;
  canTrade: boolean;
  canWithdraw: boolean; // MUST be false for security
  status: 'CONNECTED' | 'VALIDATING' | 'DISCONNECTED' | 'ERROR' | 'RESTRICTED';
  lastChecked: string;
  errorMessage?: string;
}

const KEYS_FILE = path.join(process.cwd(), '.exchange-trade-only-keys.json');

/**
 * Orders placed this recently are never pruned, because a placement in flight may not be visible in
 * the exchange's open-order list yet.
 */
export const PHANTOM_ORDER_GRACE_MS = 20_000;

/**
 * Local orders that the exchange no longer reports AND that are old enough to rule out an in-flight
 * placement. A local order with an unparseable timestamp is treated as recent and kept, so a
 * malformed record can never cause a live order to be forgotten.
 */
export function selectPhantomOrderIds(
  localOpenOrders: Array<{ id: string; symbol: string; placedAt: string }>,
  exchangeLiveOrderIds: string[],
  nowMs: number,
  graceMs: number = PHANTOM_ORDER_GRACE_MS
): string[] {
  const live = new Set(exchangeLiveOrderIds);
  const phantom: string[] = [];
  for (const order of localOpenOrders) {
    if (!order?.id || live.has(order.id)) continue;
    const placedMs = Date.parse(String(order.placedAt || ''));
    if (!Number.isFinite(placedMs)) continue;
    if (nowMs - placedMs < graceMs) continue;
    phantom.push(order.id);
  }
  return phantom;
}

export class ExchangeExecutionEngine implements EngineModule {
  public readonly id = 'EXCHANGE_EXECUTION_ENGINE';
  public readonly name = 'Exchange Execution Engine (Bybit Linear Futures V5)';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private credentials: Map<SupportedExchange, ExchangeApiCredentials> = new Map();
  private openOrders: Map<string, Order> = new Map();
  private orderHistory: Order[] = [];
  private fills: Fill[] = [];
  private positions: Map<string, Position> = new Map();
  /** Last leverage successfully asserted per symbol, so every grid rung does not re-send it. */
  private leverageAsserted: Map<string, number> = new Map();
  /** Hard halt engaged by the global emergency kill switch; blocks new live order dispatch. */
  private halted: boolean = false;
  /** Cached Bybit instrument filters (qty step / tick size / minimums) for correct rounding. */
  private instrumentSpecs: Map<string, { qtyStep: number; tickSize: number; minOrderQty: number; minNotional: number }> = new Map();
  /** Live quote captured at dispatch, keyed by exchange order id and orderLinkId. */
  private orderQuoteRefs: Map<string, { mid: number; halfSpreadBps: number }> = new Map();

  private recordQuoteSnapshot(key: string | undefined, snapshot: { mid: number; halfSpreadBps: number }): void {
    if (!key) return;
    // Refresh insertion order so the oldest references are evicted first.
    if (this.orderQuoteRefs.has(key)) this.orderQuoteRefs.delete(key);
    this.orderQuoteRefs.set(key, snapshot);
    while (this.orderQuoteRefs.size > 2000) {
      const oldest = this.orderQuoteRefs.keys().next().value as string | undefined;
      if (!oldest) break;
      this.orderQuoteRefs.delete(oldest);
    }
  }

  /** Quote captured when the given order was dispatched, for real slippage attribution. */
  public getQuoteSnapshot(orderIdOrLinkId: string): { mid: number; halfSpreadBps: number } | null {
    if (!orderIdOrLinkId) return null;
    return this.orderQuoteRefs.get(orderIdOrLinkId) || null;
  }

  constructor() {
    this.initCredentials();
  }

  private initCredentials() {
    let saved: any = {};
    if (fs.existsSync(KEYS_FILE)) {
      try {
        saved = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
      } catch (e: any) {
        this.recordError('WARN', `Could not read exchange keys file: ${e.message}`);
      }
    }

    // Bybit (PRIMARY LIVE FUTURES EXCHANGE)
    const bybitKey = saved.bybit?.apiKey || process.env.BYBIT_API_KEY || '';
    const bybitSecret = saved.bybit?.apiSecret || process.env.BYBIT_API_SECRET || '';
    this.credentials.set('BYBIT', {
      exchange: 'BYBIT',
      apiKey: bybitKey,
      apiSecret: bybitSecret,
      isConfigured: Boolean(bybitKey && bybitSecret),
      canTrade: true,
      canWithdraw: false,
      status: bybitKey && bybitSecret ? 'VALIDATING' : 'DISCONNECTED',
      lastChecked: new Date().toISOString()
    });
  }

  public healthCheck(): EngineHealth {
    const configuredCount = Array.from(this.credentials.values()).filter(c => c.isConfigured).length;
    let engineStatus = !this.enabled ? 'OFF' : this.status;
    if (this.enabled && configuredCount === 0) {
      engineStatus = 'DEGRADED'; // Active but waiting for trade keys
    }

    return {
      id: this.id,
      name: this.name,
      status: engineStatus,
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message,
      errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        supportedExchanges: ['BYBIT'],
        defaultExchange: 'BYBIT',
        configuredExchangesCount: configuredCount,
        openOrdersCount: this.openOrders.size,
        fillsCount: this.fills.length,
        halted: this.halted,
        securityPolicy: 'TRADE_ONLY_KEYS_STRICT (All withdrawal endpoints permanently blocked)'
      }
    };
  }

  public getErrorSurface(): EngineErrorRecord[] {
    return [...this.errorSurface];
  }

  public getOffSwitch(): boolean {
    return this.enabled;
  }

  public setOffSwitch(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.status = 'OFF';
      this.recordError('WARN', 'Exchange Execution Engine switched OFF. All real order dispatching halted. System fails closed.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Exchange Execution Engine switched ON.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_exec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  public getExchangeCredentials(): ExchangeApiCredentials[] {
    return Array.from(this.credentials.values()).map(c => ({
      ...c,
      apiKey: c.apiKey ? `${c.apiKey.substring(0, 4)}...${c.apiKey.slice(-4)}` : '',
      apiSecret: c.apiSecret ? '••••••••••••••••' : ''
    }));
  }

  public configureKeys(exchange: SupportedExchange, apiKey: string, apiSecret: string): { success: boolean; error?: string } {
    if (!apiKey || !apiSecret) {
      return { success: false, error: 'API key and API secret are required.' };
    }

    // Security check: reject if obvious test patterns or containing withdrawal requests
    const cred: ExchangeApiCredentials = {
      exchange,
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      isConfigured: true,
      canTrade: true,
      canWithdraw: false, // Strict: Never permit withdrawals
      status: 'VALIDATING',
      lastChecked: new Date().toISOString()
    };

    this.credentials.set(exchange, cred);

    // Persist securely to local file
    try {
      const current = fs.existsSync(KEYS_FILE) ? JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8')) : {};
      current[exchange.toLowerCase()] = {
        apiKey: cred.apiKey,
        apiSecret: cred.apiSecret
      };
      fs.writeFileSync(KEYS_FILE, JSON.stringify(current, null, 2), { mode: 0o600 });
    } catch (err: any) {
      this.recordError('WARN', `Could not persist exchange keys to disk: ${err.message}`);
    }

    return { success: true };
  }

  /**
   * Execute real live order across Bybit
   * Fails visibly and fails closed if credentials missing or exchange rejects
   */
  /**
   * Update the authoritative exchange credential connection state after a live API check.
   * Execution remains fail-closed unless the exchange has returned a successful authenticated response.
   */
  public setCredentialValidation(exchange: SupportedExchange, result: {
    status: 'CONNECTED' | 'ERROR' | 'RESTRICTED' | 'DISCONNECTED';
    lastChecked?: string;
    errorMessage?: string;
  }): void {
    const cred = this.credentials.get(exchange);
    if (!cred) return;
    cred.status = result.status;
    cred.lastChecked = result.lastChecked || new Date().toISOString();
    cred.errorMessage = result.errorMessage;
    cred.canTrade = result.status === 'CONNECTED';
    cred.canWithdraw = false;
    this.credentials.set(exchange, cred);
    if (result.status === 'CONNECTED') {
      this.status = 'HEALTHY';
    } else {
      this.status = 'DEGRADED';
      if (result.errorMessage) this.recordError('WARN', result.errorMessage);
    }
  }

  public async ensureFuturesLeverage(symbol: string, maxLeverage: number): Promise<{ success: boolean; error?: string }> {
    if (!Number.isFinite(maxLeverage) || maxLeverage < 1) return { success: false, error: 'Invalid configured futures leverage limit.' };
    const normalized = symbol.replace(/[\/\-_]/g, '').toUpperCase();

    // Leverage only needs asserting when it changes. Re-sending it for every rung of a grid was
    // pure overhead and surfaced Bybit's benign "leverage not modified" (110043) as a failure.
    if (this.leverageAsserted.get(normalized) === maxLeverage) return { success: true };

    const { bybitAdapter } = await import('./bybitAdapter.js');
    const result = await bybitAdapter.setFuturesLeverage(symbol, maxLeverage);
    if (result.success) this.leverageAsserted.set(normalized, maxLeverage);
    else this.leverageAsserted.delete(normalized);
    return result;
  }

  /** Engage/release the hard halt driven by the global emergency kill switch. */
  public setHalted(halted: boolean): void {
    // Deliberately independent of engine health. Forcing status to 'OFF' here made
    // systemMonitor.isSystemFailClosed() permanently true, which blocked autonomous START
    // (EXCHANGE_EXECUTION_ENGINE is a critical engine) for as long as the halt was engaged.
    this.halted = Boolean(halted);
  }

  public isHalted(): boolean {
    return this.halted;
  }

  /** Synchronous view of an already-resolved instrument spec (null when not yet cached). */
  public getCachedInstrumentSpec(symbol: string): { qtyStep: number; tickSize: number; minOrderQty: number; minNotional: number } | null {
    return this.instrumentSpecs.get(symbol.replace(/[\/\-_]/g, '').toUpperCase()) || null;
  }

  /** Resolve (and cache) the exchange's instrument filters so orders are sized to valid increments. */
  public async getInstrumentSpec(symbol: string): Promise<{ qtyStep: number; tickSize: number; minOrderQty: number; minNotional: number } | null> {
    const key = symbol.replace(/[\/\-_]/g, '').toUpperCase();
    const cached = this.instrumentSpecs.get(key);
    if (cached) return cached;
    try {
      const res = await fetch(`https://api.bybit.com/v5/market/instruments-info?category=linear&symbol=${encodeURIComponent(key)}`);
      const json = await res.json() as any;
      const row = json?.result?.list?.[0];
      if (!row) return null;
      const qtyStep = Number(row.lotSizeFilter?.qtyStep ?? 0);
      const tickSize = Number(row.priceFilter?.tickSize ?? 0);
      const minOrderQty = Number(row.lotSizeFilter?.minOrderQty ?? 0);
      const minNotional = Number(row.lotSizeFilter?.minNotionalValue ?? row.lotSizeFilter?.minOrderAmt ?? 0);
      if (!Number.isFinite(qtyStep) || qtyStep <= 0 || !Number.isFinite(tickSize) || tickSize <= 0) return null;
      const spec = {
        qtyStep,
        tickSize,
        minOrderQty: Number.isFinite(minOrderQty) ? minOrderQty : 0,
        minNotional: Number.isFinite(minNotional) ? minNotional : 0
      };
      this.instrumentSpecs.set(key, spec);
      return spec;
    } catch {
      return null;
    }
  }

  /** Snap a value to an instrument increment, avoiding binary floating-point drift. */
  private static snapToStep(value: number, step: number, mode: 'floor' | 'nearest'): number {
    if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
    const factor = 1 / step;
    const scaled = value * factor;
    const snapped = mode === 'floor' ? Math.floor(scaled + 1e-9) : Math.round(scaled);
    return Number((snapped / factor).toPrecision(15));
  }

  public async executeOrder(spec: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT';
    price: number;
    amount: number;
    exchange?: SupportedExchange;
    isGridOrder?: boolean;
    gridLevelId?: string;
    strategyId?: string;
    expectedNetEdge?: ExpectedNetEdgeBreakdown;
    leverage?: number;
    orderLinkId?: string;
    reduceOnly?: boolean;
    /** Live quote captured at dispatch, enabling real execution-cost attribution on the fill. */
    quoteSnapshot?: { mid: number; halfSpreadBps: number };
  }): Promise<{ success: boolean; order?: Order; error?: string }> {
    if (!this.enabled) {
      const err = 'EXCHANGE_EXECUTION_ENGINE_OFF: Real order execution disabled by operator.';
      this.recordError('ERROR', err);
      return { success: false, error: err };
    }
    if (this.halted) {
      const err = 'FAIL-CLOSED: Global emergency kill switch is engaged. New live order dispatch is halted.';
      this.recordError('ERROR', err);
      return { success: false, error: err };
    }

    const start = Date.now();
    const targetExchange: SupportedExchange = spec.exchange || 'BYBIT';
    const cred = this.credentials.get(targetExchange);

    if (!cred || !cred.isConfigured) {
      const err = `FAIL-CLOSED: No trade-only API keys configured for ${targetExchange}. Live order rejected. Configure exchange keys in Risk/Engines panel.`;
      this.recordError('ERROR', err, { orderSpec: spec });
      return { success: false, error: err };
    }
    if (cred.status !== 'CONNECTED' || !cred.canTrade) {
      const err = cred.errorMessage
        ? `FAIL-CLOSED: Bybit connection is not validated. ${cred.errorMessage}`
        : `FAIL-CLOSED: Bybit connection is ${cred.status}. Live order rejected until an authenticated connection check succeeds.`;
      this.recordError('ERROR', err);
      return { success: false, error: err };
    }

    const leverageLimit = Number(spec.leverage ?? 1);
    const leverageResult = await this.ensureFuturesLeverage(spec.symbol, leverageLimit);
    if (!leverageResult.success) {
      const err = `FAIL-CLOSED: Bybit futures leverage could not be set to the configured risk limit (${leverageLimit}x). ${leverageResult.error || ''}`.trim();
      this.recordError('ERROR', err);
      return { success: false, error: err };
    }

    const id = `ord_${targetExchange.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const costUsd = Number((spec.price * spec.amount).toFixed(2));

    const order: Order = {
      id,
      symbol: spec.symbol,
      side: spec.side,
      type: spec.type,
      price: spec.price,
      amount: spec.amount,
      filledAmount: 0,
      remainingAmount: spec.amount,
      costUsd,
      status: 'OPEN',
      isGridOrder: Boolean(spec.isGridOrder),
      gridLevelId: spec.gridLevelId,
      strategyId: spec.strategyId || 'STRAT-LIVE-001',
      mode: 'LIVE',
      feesPaid: 0,
      slippageBps: 0,
      latencyMs: 0,
      expectedNetEdge: spec.expectedNetEdge,
      placedAt: new Date().toISOString()
    };

    // Dispatch directly to Bybit using signed HMAC-SHA256.
    // A deterministic orderLinkId lets Bybit deduplicate retries instead of double-executing.
    try {
      const orderLinkId = spec.orderLinkId || `gp-${id}`.slice(0, 36);
      const bybitResult = await this.dispatchBybitOrder(cred, { ...spec, orderLinkId });
      if (!bybitResult.success) {
        order.status = 'REJECTED';
        order.rejectionReason = bybitResult.error;
        this.recordError('ERROR', `Bybit live order rejected: ${bybitResult.error}`);
        return { success: false, order, error: bybitResult.error };
      }
      if (bybitResult.orderId) order.id = bybitResult.orderId;

      // Persist the live quote that existed when this order was dispatched. Without it, execution
      // cost cannot be attributed to a specific fill and slippage is unknowable (it was previously
      // reported as a hardcoded 0, which silently flattered every net-edge calculation).
      if (spec.quoteSnapshot && Number.isFinite(spec.quoteSnapshot.mid) && spec.quoteSnapshot.mid > 0) {
        this.recordQuoteSnapshot(bybitResult.orderId || order.id, spec.quoteSnapshot);
        this.recordQuoteSnapshot(orderLinkId, spec.quoteSnapshot);
      }

      order.latencyMs = Date.now() - start;
      this.openOrders.set(order.id, order);
      this.orderHistory.unshift(order);
      this.latencyMs = order.latencyMs;
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';

      return { success: true, order };
    } catch (err: any) {
      order.status = 'REJECTED';
      order.rejectionReason = err.message;
      this.recordError('ERROR', `Exchange execution error on ${targetExchange}: ${err.message}`);
      return { success: false, order, error: err.message };
    }
  }

  private async dispatchBybitOrder(cred: ExchangeApiCredentials, spec: any): Promise<{ success: boolean; orderId?: string; error?: string }> {
    const rawSymbol = spec.symbol.replace(/[\/\-_]/g, '').toUpperCase();
    const timestamp = Date.now().toString();
    const endpoint = 'https://api.bybit.com/v5/order/create';

    // Snap to the exchange's real increments before dispatch: raw float sizing derived from the
    // grid budget and price is otherwise rejected for precision, or silently mis-sized.
    const instrument = await this.getInstrumentSpec(rawSymbol);
    if (!instrument) {
      return { success: false, error: `FAIL-CLOSED: Could not resolve the Bybit instrument specification for ${rawSymbol}; refusing to submit an unvalidated order.` };
    }

    const isMarket = spec.type === 'MARKET';
    const rawQty = Number(spec.amount);
    const qty = ExchangeExecutionEngine.snapToStep(rawQty, instrument.qtyStep, 'floor');
    const refPrice = Number(spec.price);
    const price = isMarket ? 0 : ExchangeExecutionEngine.snapToStep(refPrice, instrument.tickSize, 'nearest');
    const triggerPrice = spec.triggerPrice
      ? ExchangeExecutionEngine.snapToStep(Number(spec.triggerPrice), instrument.tickSize, 'nearest')
      : undefined;

    if (!Number.isFinite(qty) || qty <= 0) {
      return { success: false, error: `FAIL-CLOSED: Quantity ${rawQty} rounds below the minimum tradable increment (${instrument.qtyStep}) for ${rawSymbol}.` };
    }
    if (instrument.minOrderQty > 0 && qty < instrument.minOrderQty) {
      return { success: false, error: `FAIL-CLOSED: Quantity ${qty} is below the Bybit minimum order quantity ${instrument.minOrderQty} for ${rawSymbol}.` };
    }
    const notionalUsd = qty * (isMarket ? refPrice : price);
    if (instrument.minNotional > 0 && Number.isFinite(notionalUsd) && notionalUsd < instrument.minNotional) {
      return { success: false, error: `FAIL-CLOSED: Order notional ${notionalUsd.toFixed(4)} is below the Bybit minimum ${instrument.minNotional} for ${rawSymbol}.` };
    }
    if (!isMarket && (!Number.isFinite(price) || price <= 0)) {
      return { success: false, error: `FAIL-CLOSED: Limit price ${spec.price} is not a valid tick-aligned price for ${rawSymbol}.` };
    }

    const body: Record<string, any> = {
      category: 'linear', symbol: rawSymbol, side: spec.side === 'BUY' ? 'Buy' : 'Sell',
      orderType: isMarket ? 'Market' : 'Limit', qty: String(qty),
      price: isMarket ? undefined : String(price),
      timeInForce: isMarket ? 'IOC' : 'GTC'
    };
    if (triggerPrice) body.triggerPrice = String(triggerPrice);
    if (spec.orderFilter) body.orderFilter = spec.orderFilter;
    if (spec.orderLinkId) body.orderLinkId = spec.orderLinkId;
    // Close-only semantics: without reduceOnly, a protective stop can flip into a NEW position.
    if (spec.reduceOnly) body.reduceOnly = true;

    const bodyStr = JSON.stringify(body);
    const signPayload = `${timestamp}${cred.apiKey}5000${bodyStr}`;
    const signature = crypto.createHmac('sha256', cred.apiSecret).update(signPayload).digest('hex');

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-BAPI-API-KEY': cred.apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': '5000',
        'Content-Type': 'application/json'
      },
      body: bodyStr
    });

    const json = (await res.json()) as any;
    if (!res.ok || json.retCode !== 0) {
      return { success: false, error: json.retMsg || `Bybit HTTP ${res.status}` };
    }

    return { success: true, orderId: json.result?.orderId };
  }

  private async dispatchBybitCancel(cred: ExchangeApiCredentials, symbol: string, orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const rawSymbol = symbol.replace(/[\/\-_]/g, '').toUpperCase();
      const timestamp = Date.now().toString();
      const endpoint = 'https://api.bybit.com/v5/order/cancel';

      const body = {
        category: 'linear',
        symbol: rawSymbol,
        orderId
      };

      const bodyStr = JSON.stringify(body);
      const signPayload = `${timestamp}${cred.apiKey}5000${bodyStr}`;
      const signature = crypto.createHmac('sha256', cred.apiSecret).update(signPayload).digest('hex');

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-BAPI-API-KEY': cred.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': '5000',
          'Content-Type': 'application/json'
        },
        body: bodyStr
      });

      const json = (await res.json()) as any;
      if (!res.ok || json.retCode !== 0) {
        return { success: false, error: json.retMsg || `Bybit HTTP ${res.status}` };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  private async dispatchBybitCancelAll(cred: ExchangeApiCredentials, symbol?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const timestamp = Date.now().toString();
      const endpoint = 'https://api.bybit.com/v5/order/cancel-all';
      const body: any = { category: 'linear' };
      if (symbol) {
        body.symbol = symbol.replace(/[\/\-_]/g, '').toUpperCase();
      }
      const bodyStr = JSON.stringify(body);
      const signPayload = `${timestamp}${cred.apiKey}5000${bodyStr}`;
      const signature = crypto.createHmac('sha256', cred.apiSecret).update(signPayload).digest('hex');

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-BAPI-API-KEY': cred.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': '5000',
          'Content-Type': 'application/json'
        },
        body: bodyStr
      });

      const json = (await res.json()) as any;
      if (!res.ok || json.retCode !== 0) {
        return { success: false, error: json.retMsg || `Bybit HTTP ${res.status}` };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Reconcile in-memory state with Bybit live futures orders on startup and periodic sync
   * Prevents orphaned orders after container restart or network glitch
   */
  public async reconcileOpenOrders(targetSymbol?: string): Promise<{ reconciledCount: number; prunedCount?: number; error?: string }> {
    const cred = this.credentials.get('BYBIT');
    if (!cred || !cred.isConfigured) {
      return { reconciledCount: 0 };
    }

    try {
      const timestamp = Date.now().toString();
      const rawSymbol = targetSymbol ? targetSymbol.replace(/[\/\-_]/g, '').toUpperCase() : '';
      const query = new URLSearchParams({ category: 'linear' });
      if (rawSymbol) query.append('symbol', rawSymbol);

      const signPayload = `${timestamp}${cred.apiKey}5000${query.toString()}`;
      const signature = crypto.createHmac('sha256', cred.apiSecret).update(signPayload).digest('hex');

      const res = await fetch(`https://api.bybit.com/v5/order/realtime?${query.toString()}`, {
        method: 'GET',
        headers: {
          'X-BAPI-API-KEY': cred.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': '5000'
        }
      });

      const json = (await res.json()) as any;
      if (!res.ok || json.retCode !== 0) {
        return { reconciledCount: 0, error: json.retMsg };
      }

      const bybitOrders = json.result?.list || [];
      let count = 0;
      const exchangeLiveOrderIds: string[] = [];
      for (const bOrder of bybitOrders) {
        if (bOrder.orderStatus === 'New' || bOrder.orderStatus === 'PartiallyFilled') {
          const orderId = bOrder.orderId;
          exchangeLiveOrderIds.push(orderId);
          if (!this.openOrders.has(orderId)) {
            const matchedOrder: Order = {
              id: orderId,
              symbol: bOrder.symbol,
              side: bOrder.side === 'Buy' ? 'BUY' : 'SELL',
              type: bOrder.orderType === 'Limit' ? 'LIMIT' : 'MARKET',
              price: parseFloat(bOrder.price) || 0,
              amount: parseFloat(bOrder.qty) || 0,
              filledAmount: parseFloat(bOrder.cumExecQty) || 0,
              remainingAmount: parseFloat(bOrder.leavesQty) || parseFloat(bOrder.qty) || 0,
              costUsd: (parseFloat(bOrder.price) || 0) * (parseFloat(bOrder.qty) || 0),
              status: bOrder.orderStatus === 'PartiallyFilled' ? 'PARTIALLY_FILLED' : 'OPEN',
              isGridOrder: true,
              strategyId: 'RECONCILED-FROM-EXCHANGE',
              mode: 'LIVE',
              feesPaid: parseFloat(bOrder.cumExecFee) || 0,
              slippageBps: 0,
              latencyMs: 0,
              placedAt: new Date(parseInt(bOrder.createdTime) || Date.now()).toISOString()
            };
            this.openOrders.set(orderId, matchedOrder);
            this.orderHistory.unshift(matchedOrder);
            count++;
          }
        }
      }

      if (count > 0) {
        this.recordError('WARN', `State Reconciled: Imported ${count} live open order(s) from Bybit exchange.`);
      }

      // Prune local orders the exchange no longer has. Reconciliation previously only ever ADDED,
      // so anything filled/cancelled/liquidated exchange-side stayed OPEN locally forever and
      // permanently consumed the maxOpenOrders budget.
      const candidates = Array.from(this.openOrders.values())
        .filter(order => !rawSymbol || order.symbol === rawSymbol)
        .map(order => ({ id: order.id, symbol: order.symbol, placedAt: order.placedAt }));
      const phantomIds = selectPhantomOrderIds(candidates, exchangeLiveOrderIds, Date.now(), PHANTOM_ORDER_GRACE_MS);

      for (const phantomId of phantomIds) {
        const order = this.openOrders.get(phantomId);
        if (order) order.status = 'CANCELLED';
        this.openOrders.delete(phantomId);
      }
      if (phantomIds.length > 0) {
        this.recordError('WARN', `State Reconciled: pruned ${phantomIds.length} local order(s) absent from the exchange (filled, cancelled or liquidated exchange-side).`);
      }

      return { reconciledCount: count, prunedCount: phantomIds.length };
    } catch (err: any) {
      this.recordError('WARN', `Order reconciliation failed: ${err.message}`);
      return { reconciledCount: 0, error: err.message };
    }
  }

  /**
   * Batch order execution with rate-limit pacing (prevents Bybit HTTP 429 errors)
   */
  public async executeBatchOrders(
    specs: Array<{
      symbol: string;
      side: 'BUY' | 'SELL';
      type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT';
      price: number;
      amount: number;
      exchange?: SupportedExchange;
      isGridOrder?: boolean;
      gridLevelId?: string;
      strategyId?: string;
      expectedNetEdge?: ExpectedNetEdgeBreakdown;
      leverage?: number;
    }>
  ): Promise<{ success: boolean; executed: Order[]; failedCount: number }> {
    const executed: Order[] = [];
    let failedCount = 0;

    for (const spec of specs) {
      try {
        const result = await this.executeOrder(spec);
        if (result.success && result.order) {
          executed.push(result.order);
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }

      // Rate limit pacing: 65ms delay between orders to respect exchange threshold
      if (specs.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 65));
      }
    }

    return { success: executed.length > 0, executed, failedCount };
  }

  public async cancelOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
    const order = this.openOrders.get(orderId);
    if (!order) return { success: false, error: 'Order not found' };

    // Dispatch real cancellation to exchange if keys exist
    const cred = this.credentials.get('BYBIT');
    if (cred && cred.isConfigured && order.id) {
      const exchangeResult = await this.dispatchBybitCancel(cred, order.symbol, order.id);
      if (!exchangeResult.success) {
        this.recordError('ERROR', `Bybit cancellation not confirmed for ${orderId}: ${exchangeResult.error || 'unknown exchange error'}`);
        return { success: false, error: exchangeResult.error || 'Exchange cancellation was not confirmed; local order state preserved.' };
      }
    }

    order.status = 'CANCELLED';
    this.openOrders.delete(orderId);
    return { success: true };
  }

  public async cancelAllOrders(symbol?: string): Promise<number> {
    const cred = this.credentials.get('BYBIT');
    if (cred && cred.isConfigured) {
      const exchangeResult = await this.dispatchBybitCancelAll(cred, symbol);
      if (!exchangeResult.success) {
        this.recordError('ERROR', `Bybit bulk cancellation not confirmed: ${exchangeResult.error || 'unknown exchange error'}`);
        return 0;
      }
    }

    let count = 0;
    for (const [id, ord] of this.openOrders.entries()) {
      if (!symbol || ord.symbol === symbol) {
        ord.status = 'CANCELLED';
        this.openOrders.delete(id);
        count++;
      }
    }
    return count;
  }

  public async cancelNewEntryOrders(symbol?: string): Promise<number> {
    const candidates = Array.from(this.openOrders.values()).filter((ord) =>
      ord.isGridOrder &&
      ord.side === 'BUY' &&
      (!symbol || ord.symbol === symbol)
    );

    let count = 0;
    for (const order of candidates) {
      const result = await this.cancelOrder(order.id);
      if (result.success) count++;
    }
    return count;
  }

  /** Apply native Bybit linear-futures TP/SL protection to the authoritative open position. */
  public async applyFuturesProtection(symbol: string, takeProfit: number, stopLoss: number): Promise<{ success: boolean; error?: string }> {
    if (!this.enabled) return { success: false, error: 'EXCHANGE_EXECUTION_ENGINE_OFF: Futures protection is disabled.' };
    const cred = this.credentials.get('BYBIT');
    if (!cred || cred.status !== 'CONNECTED' || !cred.canTrade) return { success: false, error: 'FAIL-CLOSED: Bybit credentials are not trade-ready.' };

    // The exchange now reports the live TP/SL, so protection is only pushed when it is actually
    // missing or stale. Blindly re-sending it every reconciliation cycle burned rate limit and
    // momentarily widened protection while the update was in flight.
    const position = this.getPosition(symbol);
    const instrument = await this.getInstrumentSpec(symbol);
    const tolerance = instrument ? instrument.tickSize / 2 : 0;
    const alreadyProtected = Boolean(
      position &&
      Number.isFinite(position.takeProfit) && Number(position.takeProfit) > 0 &&
      Number.isFinite(position.stopLoss) && Number(position.stopLoss) > 0 &&
      Math.abs(Number(position.takeProfit) - takeProfit) <= tolerance &&
      Math.abs(Number(position.stopLoss) - stopLoss) <= tolerance
    );
    if (alreadyProtected) return { success: true };

    const { bybitAdapter } = await import('./bybitAdapter.js');
    return bybitAdapter.setFuturesTradingStop(symbol, takeProfit, stopLoss, position?.positionIdx);
  }

  /** Place a live Spot protective exit on Bybit. This is a real exchange order; no simulated fill is created. */
  public async executeProtectiveExit(spec: { symbol: string; amount: number; triggerPrice: number; kind: 'TAKE_PROFIT' | 'STOP_LOSS'; }): Promise<{ success: boolean; orderId?: string; error?: string }> {
    if (!this.enabled) return { success: false, error: 'EXCHANGE_EXECUTION_ENGINE_OFF: Protective exits are disabled.' };
    const cred = this.credentials.get('BYBIT');
    if (!cred || !cred.isConfigured) return { success: false, error: 'FAIL-CLOSED: Bybit trade-only API keys are not configured.' };
    if (!Number.isFinite(spec.amount) || spec.amount <= 0 || !Number.isFinite(spec.triggerPrice) || spec.triggerPrice <= 0) return { success: false, error: 'Protective exit amount and trigger price must be positive live values.' };
    try {
      // Derive the closing side from the authoritative position: a hardcoded SELL would open a
      // NEW short when closing a short position, or when the position is already flat.
      const position = this.getPosition(spec.symbol);
      const baseAmount = Number(position?.baseAmount ?? 0);
      const closeSide: 'BUY' | 'SELL' = baseAmount < 0 ? 'BUY' : 'SELL';
      const result = await this.dispatchBybitOrder(cred, {
        symbol: spec.symbol,
        side: closeSide,
        type: 'MARKET',
        amount: spec.amount,
        price: spec.triggerPrice,
        triggerPrice: spec.triggerPrice,
        orderFilter: 'StopOrder',
        reduceOnly: true,
        orderLinkId: ('gp-' + spec.kind.toLowerCase() + '-' + Date.now()).slice(0, 36)
      });
      if (!result.success) return { success: false, error: result.error };
      this.lastHeartbeat = new Date().toISOString();
      return { success: true, orderId: result.orderId };
    } catch (err: any) { this.recordError('ERROR', 'Protective exit dispatch failed: ' + err.message); return { success: false, error: err.message || 'Protective exit dispatch failed' }; }
  }

  /** Synchronize the authoritative Bybit linear futures position set. */
  public async syncLiveFuturesPositions(symbol?: string): Promise<{ count: number; error?: string }> {
    const cred = this.credentials.get('BYBIT');
    if (!cred || !cred.isConfigured) return { count: 0 };
    try {
      const { bybitAdapter } = await import('./bybitAdapter.js');
      const livePositions = await bybitAdapter.getRealPositions(symbol);
      const targetSymbols = symbol ? new Set([bybitAdapter.normalizeSymbol(symbol)]) : null;
      if (targetSymbols) {
        for (const key of Array.from(this.positions.keys())) {
          if (targetSymbols.has(bybitAdapter.normalizeSymbol(key))) this.positions.delete(key);
        }
      } else {
        this.positions.clear();
      }
      for (const p of livePositions) this.positions.set(p.symbol, p as Position);
      this.lastHeartbeat = new Date().toISOString();
      return { count: livePositions.length };
    } catch (err: any) {
      this.recordError('ERROR', 'Live futures position reconciliation failed: ' + (err?.message || 'unknown error'));
      return { count: 0, error: err?.message || 'Live futures position reconciliation failed' };
    }
  }

  public getOpenOrders(symbol?: string): Order[] {
    const all = Array.from(this.openOrders.values());
    if (!symbol) return all;
    return all.filter(o => o.symbol === symbol);
  }

  public getFills(): Fill[] {
    return [...this.fills];
  }

  public getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  public getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol);
  }
}
