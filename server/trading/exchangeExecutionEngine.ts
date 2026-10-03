import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ownsBackgroundLoops, backgroundLoopsDisabledReason } from './backgroundOwnership.js';
import {
  EngineErrorRecord,
  EngineHealth,
  EngineModule,
  ExpectedNetEdgeBreakdown,
  Fill,
  Order,
  OrderStatus,
  Position,
  PositionDriftRecord,
  ReconciliationAuditEvent,
  ReconciliationAuditStatus,
  SupportedExchange
} from './types.js';

export interface ExchangeApiCredentials {
  exchange: SupportedExchange;
  apiKey: string;
  apiSecret: string;
  label?: string;
  isConfigured: boolean;
  canTrade: boolean;
  canWithdraw: boolean; // MUST be false for security
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'RESTRICTED';
  lastChecked: string;
  errorMessage?: string;
}

const KEYS_FILE = path.join(process.cwd(), '.exchange-trade-only-keys.json');

export class ExchangeExecutionEngine implements EngineModule {
  public readonly id = 'EXCHANGE_EXECUTION_ENGINE';
  public readonly name = 'Exchange Execution Engine (Bybit Perpetual Futures V5 Linear)';

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

  // Self-Healing Position & Order Reconciliation Loop State
  private reconciliationAuditHistory: ReconciliationAuditEvent[] = [];
  private lastReconciliationAudit?: ReconciliationAuditStatus;
  private lastSelfHealTimestamp?: string;
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private autoHealingEnabled: boolean = true;

  constructor() {
    this.initCredentials();
    // Auto-start only in the process that owns background work. Ungated, a second process that
    // merely imports the store would run a duplicate reconciliation loop against the same live
    // account and could drive the same fail-closed/kill-switch state from stale local state.
    // See backgroundOwnership.ts. Operator toggles (setOffSwitch) are intentionally unaffected.
    if (ownsBackgroundLoops()) {
      this.startReconciliationLoop();
    } else {
      console.log(`[ExchangeExecutionEngine] Reconciliation loop NOT started: ${backgroundLoopsDisabledReason()}.`);
    }
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

    // Bybit (PRIMARY LIVE PERPETUAL FUTURES EXCHANGE - CATEGORY LINEAR)
    const bybitKey = saved.bybit?.apiKey || process.env.BYBIT_API_KEY || '';
    const bybitSecret = saved.bybit?.apiSecret || process.env.BYBIT_API_SECRET || '';
    this.credentials.set('BYBIT', {
      exchange: 'BYBIT',
      apiKey: bybitKey,
      apiSecret: bybitSecret,
      isConfigured: Boolean(bybitKey && bybitSecret),
      canTrade: true,
      canWithdraw: false,
      status: bybitKey && bybitSecret ? 'CONNECTED' : 'DISCONNECTED',
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
      this.stopReconciliationLoop();
      this.recordError('WARN', 'Exchange Execution Engine switched OFF. All real order dispatching halted. System fails closed.');
    } else {
      this.status = 'HEALTHY';
      this.startReconciliationLoop();
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
      status: 'CONNECTED',
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

    this.recordError('WARN', `Trade-only API keys configured for ${exchange}. Validating connection...`);
    return { success: true };
  }

  /**
   * Execute real live order across Bybit
   * Fails visibly and fails closed if credentials missing or exchange rejects
   */
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
  }): Promise<{ success: boolean; order?: Order; error?: string }> {
    if (!this.enabled) {
      const err = 'EXCHANGE_EXECUTION_ENGINE_OFF: Real order execution disabled by operator.';
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

    const id = `ord_${targetExchange.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    // Idempotency key, created BEFORE submission and persisted on the order, so that a submission
    // whose response was lost can be looked up on the exchange instead of being re-sent.
    const clientOrderId = `gp_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const costUsd = Number((spec.price * spec.amount).toFixed(2));

    const order: Order = {
      id,
      clientOrderId,
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

    // Dispatch directly to Bybit using signed HMAC-SHA256
    try {
      const bybitResult = await this.dispatchBybitOrder(cred, spec, clientOrderId);
      if (!bybitResult.success) {
        // Distinguish a definitive refusal from an unknown outcome.
        //
        // A network failure or timeout may still have created the order on the exchange. Recording
        // that as REJECTED is a false negative: the platform would believe nothing exists while a
        // live position does, and any retry would double it. Unknown outcomes are therefore kept
        // visible (in open orders + history) as UNKNOWN so reconciliation resolves them against the
        // exchange before any resubmission is considered.
        if (bybitResult.indeterminate) {
          order.status = 'UNKNOWN';
          order.rejectionReason = bybitResult.error;
          this.openOrders.set(order.id, order);
          this.orderHistory.unshift(order);
          this.recordError(
            'ERROR',
            `Order outcome UNKNOWN (clientOrderId=${clientOrderId}): ${bybitResult.error}. ` +
            'Do NOT resubmit; the idempotency key makes a retry safe only once this is reconciled.'
          );
          return { success: false, order, error: bybitResult.error };
        }
        order.status = 'REJECTED';
        order.rejectionReason = bybitResult.error;
        this.recordError('ERROR', `Bybit live order rejected (clientOrderId=${clientOrderId}): ${bybitResult.error}`);
        return { success: false, order, error: bybitResult.error };
      }
      if (bybitResult.orderId) order.id = bybitResult.orderId;

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

  /**
   * Read a JSON response defensively.
   *
   * A bare `await res.json()` throws "Unexpected end of JSON input" whenever the body is empty or
   * not JSON — a proxy 502 page, a truncated response, a rate-limit page. That message tells an
   * operator nothing about what happened, and it is precisely what filled this engine's error
   * surface with 18 unhelpful "Order reconciliation failed: Unexpected end of JSON input" entries
   * while the real cause (a rejected API key) was elsewhere.
   */
  private async readJson(res: any): Promise<{ ok: boolean; json: any; error?: string }> {
    let text = '';
    try {
      text = await res.text();
    } catch (err: any) {
      return { ok: false, json: null, error: `could not read response body (${err?.message || err})` };
    }
    if (!text || !text.trim()) {
      return { ok: false, json: null, error: `HTTP ${res.status} returned an EMPTY body where JSON was expected` };
    }
    try {
      return { ok: true, json: JSON.parse(text) };
    } catch {
      return { ok: false, json: null, error: `HTTP ${res.status} returned a non-JSON body: ${text.slice(0, 120)}` };
    }
  }

  private async dispatchBybitOrder(
    cred: ExchangeApiCredentials,
    spec: any,
    orderLinkId: string
  ): Promise<{ success: boolean; orderId?: string; error?: string; indeterminate?: boolean }> {
    const rawSymbol = spec.symbol.replace(/[\/\-_]/g, '').toUpperCase();
    const timestamp = Date.now().toString();
    const endpoint = 'https://api.bybit.com/v5/order/create';

    const body = {
      category: 'linear',
      symbol: rawSymbol,
      side: spec.side === 'BUY' ? 'Buy' : 'Sell',
      orderType: spec.type === 'MARKET' ? 'Market' : 'Limit',
      qty: spec.amount.toString(),
      price: spec.type === 'LIMIT' ? spec.price.toString() : undefined,
      timeInForce: 'GTC',
      // Client-side idempotency key. Bybit rejects a second create carrying the same orderLinkId,
      // so this is what makes a retry after a lost response safe instead of silently doubling the
      // position. It was missing entirely from this path (the bybitAdapter path already had it).
      orderLinkId,
      positionIdx: 0 // One-way mode in Bybit Linear Futures
    };

    const bodyStr = JSON.stringify(body);
    const signPayload = `${timestamp}${cred.apiKey}5000${bodyStr}`;
    const signature = crypto.createHmac('sha256', cred.apiSecret).update(signPayload).digest('hex');

    // Bounded submission: an unbounded fetch can hang the execution path indefinitely, and a hung
    // submission is indistinguishable from a lost one.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let res: any;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-BAPI-API-KEY': cred.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': '5000',
          'Content-Type': 'application/json'
        },
        body: bodyStr,
        signal: controller.signal
      });
    } catch (netErr: any) {
      // No response at all => INDETERMINATE, never "rejected". The order may have been accepted;
      // reporting rejection here is exactly what permits a duplicate submission.
      const reason = netErr?.name === 'AbortError'
        ? 'submission timed out after 10000ms'
        : (netErr?.message || 'network error');
      return {
        success: false,
        indeterminate: true,
        error: `Indeterminate submission outcome (${reason}); order may exist on the exchange`
      };
    } finally {
      clearTimeout(timer);
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      return {
        success: false,
        indeterminate: true,
        error: `Indeterminate submission outcome (HTTP ${res.status}, unparseable body); order may exist on the exchange`
      };
    }

    if (!res.ok) {
      // A transport-level failure (5xx / gateway): the body cannot be trusted to say whether the
      // order was created, so this is indeterminate rather than rejected.
      return {
        success: false,
        indeterminate: true,
        error: `Indeterminate submission outcome (HTTP ${res.status}); order may exist on the exchange`
      };
    }

    if (json.retCode !== 0) {
      // Bybit answered with a real error code on a 200 => a definitive refusal.
      return { success: false, error: json.retMsg || `Bybit retCode ${json.retCode}` };
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

      const parsed = await this.readJson(res);
      if (!parsed.ok) {
        return { success: false, error: parsed.error };
      }
      const json = parsed.json as any;
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

      const parsed = await this.readJson(res);
      if (!parsed.ok) {
        return { success: false, error: parsed.error };
      }
      const json = parsed.json as any;
      if (!res.ok || json.retCode !== 0) {
        return { success: false, error: json.retMsg || `Bybit HTTP ${res.status}` };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Reconcile in-memory state with Bybit live perpetual futures orders on startup and periodic sync
   * Prevents orphaned orders after container restart or network glitch
   */
  /**
   * Resolve orders whose submission outcome is UNKNOWN by asking Bybit directly, keyed by the
   * clientOrderId (Bybit `orderLinkId`).
   *
   * Without this, an indeterminate submission is a permanent blind spot: the platform can neither
   * safely retry (the order might exist) nor safely ignore it (the order might exist). This is the
   * ONLY code permitted to close out an UNKNOWN order, and it closes one out only with evidence:
   *   - found in Bybit order history -> adopt the exchange's real status/id/fill
   *   - absent from order history    -> a VERIFIED absence, so it was never created
   */
  public async resolveUnknownOrders(maxPerPass: number = 20): Promise<{ resolved: number; errors: number }> {
    const unknown = this.orderHistory.filter((o) => o.status === 'UNKNOWN').slice(0, maxPerPass);
    if (unknown.length === 0) return { resolved: 0, errors: 0 };

    const cred = this.credentials.get('BYBIT');
    if (!cred || !cred.isConfigured) return { resolved: 0, errors: 0 };

    let resolved = 0;
    let errors = 0;

    for (const order of unknown) {
      const key = order.clientOrderId;
      if (!key) {
        errors++;
        continue;
      }
      try {
        const timestamp = Date.now().toString();
        const query = new URLSearchParams({ category: 'linear', orderLinkId: key });
        const signPayload = `${timestamp}${cred.apiKey}5000${query.toString()}`;
        const signature = crypto.createHmac('sha256', cred.apiSecret).update(signPayload).digest('hex');

        const res = await fetch(`https://api.bybit.com/v5/order/history?${query.toString()}`, {
          method: 'GET',
          headers: {
            'X-BAPI-API-KEY': cred.apiKey,
            'X-BAPI-SIGN': signature,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': '5000'
          }
        });
        const parsed = await this.readJson(res);
        if (!parsed.ok) {
          errors++;
          this.recordError('WARN', `Could not resolve UNKNOWN order ${key}: ${parsed.error}`);
          continue;
        }
        const json: any = parsed.json;
        if (!res.ok || json.retCode !== 0) {
          errors++;
          continue;
        }

        const list: any[] = json.result?.list || [];
        if (list.length === 0) {
          // Verified absence — the submission never created an order.
          order.status = 'REJECTED';
          order.rejectionReason = 'Confirmed absent from Bybit order history; the submission did not create an order.';
          this.openOrders.delete(order.id);
          resolved++;
          this.recordError('WARN', `Resolved UNKNOWN order ${key}: verified absent from Bybit (no order was created).`);
          continue;
        }

        const b = list[0];
        const mapped: OrderStatus =
          b.orderStatus === 'Filled' ? 'FILLED'
          : b.orderStatus === 'PartiallyFilled' ? 'PARTIALLY_FILLED'
          : b.orderStatus === 'Cancelled' ? 'CANCELLED'
          : b.orderStatus === 'Rejected' ? 'REJECTED'
          : b.orderStatus === 'New' ? 'OPEN'
          : 'UNKNOWN';

        this.openOrders.delete(order.id);
        order.id = b.orderId || order.id;
        order.status = mapped;
        order.filledAmount = parseFloat(b.cumExecQty) || order.filledAmount;
        order.remainingAmount = Number.isFinite(parseFloat(b.leavesQty)) ? parseFloat(b.leavesQty) : order.remainingAmount;
        order.feesPaid = parseFloat(b.cumExecFee) || order.feesPaid;
        order.rejectionReason = mapped === 'REJECTED' ? (b.cancelType || 'Rejected by exchange') : undefined;

        // Only still-live states belong in open orders.
        if (mapped === 'OPEN' || mapped === 'PARTIALLY_FILLED') this.openOrders.set(order.id, order);
        resolved++;
        this.recordError('WARN', `Resolved UNKNOWN order ${key}: Bybit reports ${b.orderStatus} (orderId ${b.orderId}).`);
      } catch (err: any) {
        errors++;
        this.recordError('WARN', `Could not resolve UNKNOWN order ${key}: ${err?.message || err}`);
      }
    }

    return { resolved, errors };
  }

  public async reconcileOpenOrders(targetSymbol?: string): Promise<{ reconciledCount: number; error?: string }> {
    const cred = this.credentials.get('BYBIT');
    if (!cred || !cred.isConfigured) {
      return { reconciledCount: 0 };
    }

    // Resolve indeterminate submissions FIRST, so the rest of reconciliation proceeds from a state
    // where every order's existence is actually known.
    await this.resolveUnknownOrders().catch((err: any) => {
      this.recordError('WARN', `UNKNOWN-order resolution failed: ${err?.message || err}`);
    });

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

      const parsed = await this.readJson(res);
      if (!parsed.ok) {
        return { reconciledCount: 0, error: parsed.error };
      }
      const json = parsed.json as any;
      if (!res.ok || json.retCode !== 0) {
        return { reconciledCount: 0, error: json.retMsg };
      }

      const bybitOrders = json.result?.list || [];
      let count = 0;
      for (const bOrder of bybitOrders) {
        if (bOrder.orderStatus === 'New' || bOrder.orderStatus === 'PartiallyFilled') {
          const orderId = bOrder.orderId;
          if (!this.openOrders.has(orderId)) {
            const matchedOrder: Order = {
              id: orderId,
              // Carry the exchange's orderLinkId back onto the local record, so a locally-known
              // order and an exchange order can be correlated by the SAME idempotency key.
              clientOrderId: bOrder.orderLinkId,
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

      return { reconciledCount: count };
    } catch (err: any) {
      this.recordError('WARN', `Order reconciliation failed: ${err.message}`);
      return { reconciledCount: 0, error: err.message };
    }
  }

  /**
   * Reconcile in-memory state with Bybit live linear futures positions
   */
  public async reconcilePositions(targetSymbol?: string): Promise<{ activePositionsCount: number; error?: string }> {
    const cred = this.credentials.get('BYBIT');
    if (!cred || !cred.isConfigured) {
      return { activePositionsCount: 0 };
    }

    try {
      const timestamp = Date.now().toString();
      const rawSymbol = targetSymbol ? targetSymbol.replace(/[\/\-_]/g, '').toUpperCase() : '';
      const query = new URLSearchParams({ category: 'linear', settleCoin: 'USDT' });
      if (rawSymbol) query.append('symbol', rawSymbol);

      const signPayload = `${timestamp}${cred.apiKey}5000${query.toString()}`;
      const signature = crypto.createHmac('sha256', cred.apiSecret).update(signPayload).digest('hex');

      const res = await fetch(`https://api.bybit.com/v5/position/list?${query.toString()}`, {
        method: 'GET',
        headers: {
          'X-BAPI-API-KEY': cred.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': '5000'
        }
      });

      const parsed = await this.readJson(res);
      if (!parsed.ok) {
        return { activePositionsCount: 0, error: parsed.error };
      }
      const json = parsed.json as any;
      if (!res.ok || json.retCode !== 0) {
        return { activePositionsCount: 0, error: json.retMsg };
      }

      const rawPositions = json.result?.list || [];
      const activePositions = rawPositions.filter((p: any) => parseFloat(p.size || '0') > 0);

      this.positions.clear();
      for (const p of activePositions) {
        const size = parseFloat(p.size || '0');
        const entryPrice = parseFloat(p.avgPrice || p.entryPrice || '0');
        const markPrice = parseFloat(p.markPrice || '0');
        const unrealizedPnL = parseFloat(p.unrealisedPnl || '0');
        const cumRealisedPnl = parseFloat(p.cumRealisedPnl || '0');
        const liqPrice = parseFloat(p.liqPrice || '0') || undefined;
        const leverage = parseFloat(p.leverage || '1');
        const notional = parseFloat(p.positionValue || '0') || (size * (markPrice || entryPrice));
        const side = p.side === 'Buy' ? 'Buy' : (p.side === 'Sell' ? 'Sell' : 'None');

        const normSym = p.symbol.endsWith('USDT') ? `${p.symbol.slice(0, -4)}/USDT` : p.symbol;
        this.positions.set(normSym, {
          symbol: normSym,
          baseAmount: size,
          quoteAmount: notional,
          entryPrice,
          currentPrice: markPrice || entryPrice,
          unrealizedPnL,
          unrealizedPnLPct: notional > 0 ? Number(((unrealizedPnL / (notional / leverage)) * 100).toFixed(2)) : 0,
          realizedPnL: cumRealisedPnl,
          totalFeesPaid: 0,
          netPnL: unrealizedPnL + cumRealisedPnl,
          liquidationPrice: liqPrice,
          currentPositionCostUsd: notional / leverage,
          leverage,
          side,
          markPrice
        });
      }

      return { activePositionsCount: activePositions.length };
    } catch (err: any) {
      this.recordError('WARN', `Positions reconciliation failed: ${err.message}`);
      return { activePositionsCount: 0, error: err.message };
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

  // ==========================================
  // SELF-HEALING RECONCILIATION ENGINE
  // ==========================================

  public startReconciliationLoop(intervalMs: number = 30000): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }

    this.reconciliationTimer = setInterval(() => {
      const cred = this.credentials.get('BYBIT');
      if (this.enabled && cred && cred.isConfigured) {
        this.performAutomatedReconciliationAudit(this.autoHealingEnabled).catch(err => {
          this.recordError('WARN', `Background reconciliation loop error: ${err?.message || err}`);
        });
      }
    }, intervalMs);
  }

  public stopReconciliationLoop(): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }

  public setAutoHealingEnabled(enabled: boolean): void {
    this.autoHealingEnabled = enabled;
  }

  private recordReconciliationEvent(evt: ReconciliationAuditEvent): void {
    this.reconciliationAuditHistory.unshift(evt);
    if (this.reconciliationAuditHistory.length > 50) {
      this.reconciliationAuditHistory.pop();
    }
  }

  public getReconciliationStatus(): ReconciliationAuditStatus {
    const cred = this.credentials.get('BYBIT');
    if (this.lastReconciliationAudit) {
      return this.lastReconciliationAudit;
    }
    return {
      status: this.enabled ? 'SYNCED' : 'OFF',
      lastAuditTimestamp: new Date().toISOString(),
      activeDriftCount: 0,
      isClean: true,
      activeDrifts: [],
      recentEvents: this.reconciliationAuditHistory.slice(0, 15),
      autoHealingEnabled: this.autoHealingEnabled,
      reconciliationIntervalSeconds: 30,
      bybitConnected: Boolean(cred?.isConfigured)
    };
  }

  /**
   * Automated Position & Order Reconciliation Audit & Self-Healing
   * Compares internal portfolio state against Bybit V5 Linear ground truth.
   * Auto-heals position drift and cancels orphaned orders if autoHeal is true.
   */
  public async performAutomatedReconciliationAudit(autoHeal: boolean = true): Promise<ReconciliationAuditStatus> {
    const cred = this.credentials.get('BYBIT');
    const nowIso = new Date().toISOString();

    if (!this.enabled) {
      return {
        status: 'OFF',
        lastAuditTimestamp: nowIso,
        activeDriftCount: 0,
        isClean: true,
        activeDrifts: [],
        recentEvents: this.reconciliationAuditHistory.slice(0, 15),
        autoHealingEnabled: this.autoHealingEnabled,
        reconciliationIntervalSeconds: 30,
        bybitConnected: Boolean(cred?.isConfigured)
      };
    }

    if (!cred || !cred.isConfigured) {
      const status: ReconciliationAuditStatus = {
        status: 'SYNCED',
        lastAuditTimestamp: nowIso,
        activeDriftCount: 0,
        isClean: true,
        activeDrifts: [],
        recentEvents: this.reconciliationAuditHistory.slice(0, 15),
        autoHealingEnabled: this.autoHealingEnabled,
        reconciliationIntervalSeconds: 30,
        bybitConnected: false
      };
      this.lastReconciliationAudit = status;
      return status;
    }

    try {
      // 1. Reconcile open orders first
      const orderRec = await this.reconcileOpenOrders();

      // 2. Snapshot current in-memory positions before query
      const internalPositionsSnapshot = new Map(this.positions);

      // 3. Query Bybit linear positions directly
      const timestamp = Date.now().toString();
      const query = new URLSearchParams({ category: 'linear', settleCoin: 'USDT' });
      const signPayload = `${timestamp}${cred.apiKey}5000${query.toString()}`;
      const signature = crypto.createHmac('sha256', cred.apiSecret).update(signPayload).digest('hex');

      const res = await fetch(`https://api.bybit.com/v5/position/list?${query.toString()}`, {
        method: 'GET',
        headers: {
          'X-BAPI-API-KEY': cred.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': '5000'
        },
        signal: AbortSignal.timeout(5000)
      });

      const parsed = await this.readJson(res);
      // A non-JSON body becomes a structured request error here rather than throwing
      // "Unexpected end of JSON input" out of a reconciliation path.
      const json: any = parsed.ok
        ? parsed.json
        : { retCode: -1, retMsg: parsed.error || 'unparseable response body' };
      if (!res.ok || json.retCode !== 0) {
        const errorMsg = json.retMsg || `Bybit HTTP ${res.status}`;
        this.recordReconciliationEvent({
          id: `rec_err_${Date.now()}`,
          timestamp: nowIso,
          type: 'RECONCILIATION_ERROR',
          details: `Reconciliation audit query failed: ${errorMsg}`
        });
        const errStatus: ReconciliationAuditStatus = {
          status: 'ERROR',
          lastAuditTimestamp: nowIso,
          activeDriftCount: 0,
          isClean: false,
          activeDrifts: [],
          recentEvents: this.reconciliationAuditHistory.slice(0, 15),
          autoHealingEnabled: this.autoHealingEnabled,
          reconciliationIntervalSeconds: 30,
          bybitConnected: true
        };
        this.lastReconciliationAudit = errStatus;
        return errStatus;
      }

      const rawPositions = json.result?.list || [];
      const exchangeActivePositions = new Map<string, Position>();

      for (const p of rawPositions) {
        const size = parseFloat(p.size || '0');
        if (size <= 0) continue;

        const entryPrice = parseFloat(p.avgPrice || p.entryPrice || '0');
        const markPrice = parseFloat(p.markPrice || '0');
        const unrealizedPnL = parseFloat(p.unrealisedPnl || '0');
        const cumRealisedPnl = parseFloat(p.cumRealisedPnl || '0');
        const liqPrice = parseFloat(p.liqPrice || '0') || undefined;
        const leverage = parseFloat(p.leverage || '1');
        const notional = parseFloat(p.positionValue || '0') || (size * (markPrice || entryPrice));
        const side = p.side === 'Buy' ? 'Buy' : (p.side === 'Sell' ? 'Sell' : 'None');
        const normSym = p.symbol.endsWith('USDT') ? `${p.symbol.slice(0, -4)}/USDT` : p.symbol;

        exchangeActivePositions.set(normSym, {
          symbol: normSym,
          baseAmount: size,
          quoteAmount: notional,
          entryPrice,
          currentPrice: markPrice || entryPrice,
          unrealizedPnL,
          unrealizedPnLPct: notional > 0 ? Number(((unrealizedPnL / (notional / leverage)) * 100).toFixed(2)) : 0,
          realizedPnL: cumRealisedPnl,
          totalFeesPaid: 0,
          netPnL: unrealizedPnL + cumRealisedPnl,
          liquidationPrice: liqPrice,
          currentPositionCostUsd: notional / leverage,
          leverage,
          side,
          markPrice
        });
      }

      // 4. Compare all symbols across internal vs exchange
      const allSymbols = new Set<string>([
        ...Array.from(internalPositionsSnapshot.keys()),
        ...Array.from(exchangeActivePositions.keys())
      ]);

      const drifts: PositionDriftRecord[] = [];

      for (const sym of allSymbols) {
        const internalPos = internalPositionsSnapshot.get(sym);
        const exchangePos = exchangeActivePositions.get(sym);

        const internalSize = internalPos ? internalPos.baseAmount : 0;
        const exchangeSize = exchangePos ? exchangePos.baseAmount : 0;
        const markPrice = exchangePos?.markPrice || internalPos?.markPrice || internalPos?.currentPrice || 1;

        const deltaBase = Number((exchangeSize - internalSize).toFixed(6));
        const deltaUsd = Number((Math.abs(deltaBase) * markPrice).toFixed(2));

        // Epsilon threshold: 0.0001 base units or $0.10 USD
        const isClean = Math.abs(deltaBase) < 0.0001 || deltaUsd < 0.10;
        let severity: PositionDriftRecord['driftSeverity'] = 'NONE';

        if (!isClean) {
          if (deltaUsd > 50 || (internalSize > 0 && Math.abs(deltaBase / internalSize) > 0.20)) {
            severity = 'CRITICAL';
          } else {
            severity = 'MINOR';
          }

          drifts.push({
            symbol: sym,
            internalBaseAmount: internalSize,
            exchangeBaseAmount: exchangeSize,
            deltaBaseAmount: deltaBase,
            deltaUsd,
            driftSeverity: severity,
            isClean: false,
            timestamp: nowIso,
            actionTaken: autoHeal ? 'SYNCHRONIZED_TO_EXCHANGE' : 'DETECTED_PENDING_ACTION'
          });
        }
      }

      const hasDrift = drifts.length > 0;
      let finalStatus: ReconciliationAuditStatus['status'] = hasDrift
        ? (autoHeal ? 'SELF_HEALING' : 'DRIFT_DETECTED')
        : 'SYNCED';

      if (hasDrift) {
        if (autoHeal) {
          // Self-heal: update positions directly to match exchange truth
          this.positions = exchangeActivePositions;
          this.lastSelfHealTimestamp = nowIso;

          this.recordReconciliationEvent({
            id: `rec_heal_${Date.now()}`,
            timestamp: nowIso,
            type: 'DRIFT_AUTO_HEALED',
            details: `Auto-healed ${drifts.length} drifted position(s). Synchronized internal state to live Bybit linear reality.`,
            drifts
          });

          this.recordError('WARN', `Self-Healing Reconciliation: Corrected ${drifts.length} position drift(s). Live Bybit linear ground truth restored.`);
          finalStatus = 'SYNCED';
        } else {
          this.recordReconciliationEvent({
            id: `rec_drift_${Date.now()}`,
            timestamp: nowIso,
            type: 'DRIFT_DETECTED',
            details: `Detected ${drifts.length} position discrepancy between internal portfolio and Bybit exchange.`,
            drifts
          });
        }
      } else {
        // Update positions to exchange positions to keep markPrice & unrealized PnL fresh
        this.positions = exchangeActivePositions;
        if (orderRec.reconciledCount > 0) {
          this.recordReconciliationEvent({
            id: `rec_orders_${Date.now()}`,
            timestamp: nowIso,
            type: 'ORDERS_RECONCILED',
            details: `Imported ${orderRec.reconciledCount} missing open order(s) from Bybit.`,
            reconciledOrdersCount: orderRec.reconciledCount
          });
        }
      }

      const auditStatus: ReconciliationAuditStatus = {
        status: finalStatus,
        lastAuditTimestamp: nowIso,
        lastSelfHealTimestamp: this.lastSelfHealTimestamp,
        activeDriftCount: drifts.length,
        isClean: !hasDrift,
        activeDrifts: drifts,
        recentEvents: this.reconciliationAuditHistory.slice(0, 20),
        autoHealingEnabled: this.autoHealingEnabled,
        reconciliationIntervalSeconds: 30,
        bybitConnected: true
      };

      this.lastReconciliationAudit = auditStatus;
      return auditStatus;
    } catch (err: any) {
      this.recordReconciliationEvent({
        id: `rec_err_${Date.now()}`,
        timestamp: nowIso,
        type: 'RECONCILIATION_ERROR',
        details: `Reconciliation audit exception: ${err.message}`
      });
      const errStatus: ReconciliationAuditStatus = {
        status: 'ERROR',
        lastAuditTimestamp: nowIso,
        activeDriftCount: 0,
        isClean: false,
        activeDrifts: [],
        recentEvents: this.reconciliationAuditHistory.slice(0, 15),
        autoHealingEnabled: this.autoHealingEnabled,
        reconciliationIntervalSeconds: 30,
        bybitConnected: Boolean(cred?.isConfigured)
      };
      this.lastReconciliationAudit = errStatus;
      return errStatus;
    }
  }
}
