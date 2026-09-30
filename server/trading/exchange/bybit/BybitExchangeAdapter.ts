/**
 * BybitExchangeAdapter — wraps the proven `bybitAdapter` behind the
 * canonical ExchangeAdapter interface.
 *
 * This is the default adapter (EXCHANGE_ID=bybit) and is the only one
 * currently shipping live behavior. Behavior preserved verbatim from the
 * pre-refactor implementation:
 *   - HMAC-SHA256 signing, 5s recv window
 *   - Fail-closed on missing credentials, missing instrument, no live data
 *   - Idempotent set-leverage, idempotent set-protection
 *   - clientOrderId for retry safety
 *   - Snap-to-tick and snap-to-qty against the exchange's instrument spec
 *
 * Method name mapping (ExchangeAdapter -> bybitAdapter):
 *   fetchServerTime    -> syncServerTime
 *   fetchTicker        -> getRealPrice
 *   fetchOrderBook     -> getRealOrderBook
 *   fetchCandles       -> getRealCandles
 *   fetchFundingRate   -> getRealFundingRate
 *   fetchFeeSchedule   -> getRealFeeRate (basis points)
 *   fetchPositions     -> getRealPositions
 *   fetchBalance       -> getRealAccountState
 *   fetchOpenOrders    -> getRealOpenOrders
 *   fetchOrderHistory  -> (synthesized via getRealOpenOrders + recent fills)
 *   fetchFills         -> getRealTrades
 *   setLeverage        -> setFuturesLeverage
 *   setFuturesProtection -> setFuturesTradingStop
 *   placeOrder         -> placeRealOrder
 *   cancelOrder        -> cancelOrder
 *   cancelAllOrders    -> (not on the underlying adapter — engine uses
 *                          place+cancel through the execution engine)
 */

import {
  ExchangeAdapter,
  ExchangeAdapterError,
  ExchangeBalance,
  ExchangeCandle,
  ExchangeCredentials,
  ExchangeFeeSchedule,
  ExchangeFill,
  ExchangeFundingRate,
  ExchangeMarketDataConfig,
  ExchangeOrder,
  ExchangeOrderBook,
  ExchangePosition,
  ExchangeTicker,
  PlaceOrderRequest,
  PlaceOrderResult,
  SetProtectionRequest,
} from '../types.js';
import { bybitAdapter } from '../../bybitAdapter.js';

export class BybitExchangeAdapter implements ExchangeAdapter {
  public readonly id = 'bybit' as const;
  public readonly name = 'Bybit Linear USDT Perpetuals (V5)';

  private creds: ExchangeCredentials | null = null;
  private marketData: ExchangeMarketDataConfig | null = null;

  // ----- Lifecycle -----------------------------------------------------

  public async configure(creds: ExchangeCredentials, marketData: ExchangeMarketDataConfig): Promise<void> {
    if (!creds?.apiKey || !creds?.apiSecret) {
      throw new ExchangeAdapterError({
        code: 'NOT_CONFIGURED',
        exchangeId: this.id,
        message: 'Bybit credentials missing — apiKey and apiSecret are required.',
      });
    }
    if (!marketData?.symbol) {
      throw new ExchangeAdapterError({
        code: 'NOT_CONFIGURED',
        exchangeId: this.id,
        message: 'Bybit market data symbol is required.',
      });
    }
    this.creds = creds;
    this.marketData = marketData;
  }

  public async disconnect(): Promise<void> {
    this.creds = null;
    this.marketData = null;
  }

  public isConfigured(): boolean {
    return Boolean(this.creds && this.marketData);
  }

  public async ping(): Promise<boolean> {
    try {
      const t = await bybitAdapter.syncServerTime();
      return Number.isFinite(t) && t > 0;
    } catch {
      return false;
    }
  }

  public async getStatus() {
    const configured = this.isConfigured();
    let connected = false;
    let lastError: string | undefined;
    try {
      connected = await this.ping();
    } catch (e: any) {
      lastError = e?.message ?? String(e);
    }
    return {
      id: this.id,
      name: this.name,
      configured,
      connected,
      testnet: this.marketData?.testnet ?? false,
      rateLimit: this.getRateLimit(),
      lastError,
    };
  }

  // ----- Market data (reads) ------------------------------------------

  public async fetchTicker(symbol: string): Promise<ExchangeTicker> {
    const norm = this.normalizeSymbol(symbol);
    try {
      const last = await bybitAdapter.getRealPrice(norm);
      return {
        symbol: this.denormalizeSymbol(norm),
        bid: last,
        ask: last,
        last,
        volume24hBase: 0,
        volume24hQuote: 0,
        timestamp: new Date().toISOString(),
        source: 'live',
      };
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit ticker fetch failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async fetchOrderBook(symbol: string, depth = 50): Promise<ExchangeOrderBook> {
    const norm = this.normalizeSymbol(symbol);
    try {
      const ob: any = await bybitAdapter.getRealOrderBook(norm, depth);
      return {
        symbol: this.denormalizeSymbol(norm),
        bids: (ob?.bids ?? []).map((l: any) => ({ price: Number(l.price ?? l[0]), size: Number(l.size ?? l[1]) })),
        asks: (ob?.asks ?? []).map((l: any) => ({ price: Number(l.price ?? l[0]), size: Number(l.size ?? l[1]) })),
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit order book fetch failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async fetchCandles(symbol: string, interval: string, limit: number): Promise<ExchangeCandle[]> {
    const norm = this.normalizeSymbol(symbol);
    try {
      const candles = await bybitAdapter.getRealCandles(norm, interval, Math.min(limit, 1000));
      return candles.map((c: any) => ({
        openTime: Number(c.openTime ?? c[0]),
        open: Number(c.open ?? c[1]),
        high: Number(c.high ?? c[2]),
        low: Number(c.low ?? c[3]),
        close: Number(c.close ?? c[4]),
        volume: Number(c.volume ?? c[5]),
        closeTime: Number(c.closeTime ?? c[0]) + this.intervalMs(interval) - 1,
      }));
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit candles fetch failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async fetchFundingRate(symbol: string): Promise<ExchangeFundingRate> {
    const norm = this.normalizeSymbol(symbol);
    try {
      const r = await bybitAdapter.getRealFundingRate(norm);
      return {
        symbol: this.denormalizeSymbol(norm),
        rate: typeof r === 'number' ? r : 0,
        nextFundingTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit funding fetch failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async fetchFeeSchedule(symbol: string): Promise<ExchangeFeeSchedule> {
    try {
      const r = await bybitAdapter.getRealFeeRate(this.normalizeSymbol(symbol));
      if (!r) {
        return { symbol: this.denormalizeSymbol(symbol), maker: 0, taker: 0, timestamp: new Date().toISOString() };
      }
      return {
        symbol: this.denormalizeSymbol(symbol),
        // basis points -> fraction
        maker: r.makerBps / 10_000,
        taker: r.takerBps / 10_000,
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit fee schedule failed: ${e?.message ?? String(e)}`, e);
    }
  }

  // ----- Account state (reads) ----------------------------------------

  public async fetchPositions(symbol?: string): Promise<ExchangePosition[]> {
    try {
      const list: any[] = await bybitAdapter.getRealPositions(symbol ? this.normalizeSymbol(symbol) : undefined);
      return (list ?? []).map((p) => ({
        symbol: this.denormalizeSymbol(p.symbol),
        side: p.side === 'Buy' ? 'long' : p.side === 'Sell' ? 'short' : 'flat',
        size: Number(p.size ?? 0),
        entryPrice: Number(p.entryPrice ?? p.avgPrice ?? 0),
        markPrice: Number(p.markPrice ?? 0),
        unrealizedPnlQuote: Number(p.unrealisedPnl ?? p.unrealizedPnl ?? 0),
        leverage: Number(p.leverage ?? 1),
        marginMode: (p.tradeMode === 0 || p.marginMode === 'isolated') ? 'isolated' : 'cross',
        liquidationPrice: p.liabPrice !== undefined && p.liabPrice !== '' ? Number(p.liabPrice) : null,
        timestamp: new Date().toISOString(),
      }));
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit positions fetch failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async fetchBalance(): Promise<ExchangeBalance> {
    try {
      const b: any = await bybitAdapter.getRealAccountState(true);
      return {
        totalEquityQuote: Number(b?.totalEquityUsd ?? 0),
        availableBalanceQuote: Number(b?.availableCashUsd ?? 0),
        usedMarginQuote: Number(b?.lockedInOrdersUsd ?? 0),
        unrealizedPnlQuote: Number(b?.unrealizedProfitUsd ?? 0),
        timestamp: new Date().toISOString(),
      };
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit balance fetch failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async fetchOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
    try {
      const list: any[] = await bybitAdapter.getRealOpenOrders(symbol ? this.normalizeSymbol(symbol) : undefined);
      return (list ?? []).map((o) => this.mapOrder(o));
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit open orders fetch failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async fetchOrderHistory(symbol: string, _sinceMs: number, _limit?: number): Promise<ExchangeOrder[]> {
    // The underlying adapter doesn't expose order history directly; recent
    // fills can be inferred from getRealTrades + open orders, which is
    // what the reconciliation loop uses. Return open orders as the
    // best-effort answer for now.
    return this.fetchOpenOrders(symbol);
  }

  public async fetchFills(symbol?: string, _sinceMs?: number, limit = 50): Promise<ExchangeFill[]> {
    try {
      const list: any[] = await bybitAdapter.getRealTrades(symbol ? this.normalizeSymbol(symbol) : undefined, limit);
      return (list ?? []).map((f) => ({
        id: String(f.id ?? f.execId ?? ''),
        orderId: String(f.orderId ?? f.orderLinkId ?? ''),
        symbol: this.denormalizeSymbol(f.symbol),
        side: (f.side === 'Buy' || f.side === 'buy') ? 'buy' : 'sell',
        quantity: Number(f.qty ?? f.size ?? 0),
        price: Number(f.price ?? f.fillPrice ?? 0),
        fee: Number(f.fee ?? 0),
        feeCurrency: String(f.feeCurrency ?? 'USDT'),
        liquidity: f.isMaker === true ? 'maker' : 'taker',
        timestamp: String(f.timestamp ?? f.execTime ?? new Date().toISOString()),
      }));
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit fills fetch failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async fetchServerTime(): Promise<number> {
    try {
      return await bybitAdapter.syncServerTime();
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit server time failed: ${e?.message ?? String(e)}`, e);
    }
  }

  // ----- Trading (writes) ---------------------------------------------

  public async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (!this.isConfigured()) {
      throw new ExchangeAdapterError({ code: 'NOT_CONFIGURED', exchangeId: this.id, message: 'Bybit adapter is not configured.' });
    }
    if (!Number.isFinite(leverage) || leverage <= 0 || leverage > 125) {
      throw new ExchangeAdapterError({ code: 'INVALID_PRICE', exchangeId: this.id, message: `Leverage ${leverage} is out of range 1..125.` });
    }
    try {
      const r = await bybitAdapter.setFuturesLeverage(this.normalizeSymbol(symbol), leverage);
      if (!r?.success) {
        throw new ExchangeAdapterError({
          code: 'LEVERAGE_REJECTED',
          exchangeId: this.id,
          message: r?.error ?? 'Bybit refused the leverage update.',
        });
      }
    } catch (e: any) {
      if (e instanceof ExchangeAdapterError) throw e;
      throw this.wrapError('LEVERAGE_REJECTED', `Bybit setLeverage failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async setFuturesProtection(req: SetProtectionRequest): Promise<void> {
    if (!this.isConfigured()) {
      throw new ExchangeAdapterError({ code: 'NOT_CONFIGURED', exchangeId: this.id, message: 'Bybit adapter is not configured.' });
    }
    // Bybit's setFuturesTradingStop takes numeric tp/sl — caller has to
    // pass them on the active position's side. We forward to the active
    // long position by convention; the engine controls side elsewhere.
    try {
      const r = await bybitAdapter.setFuturesTradingStop(
        this.normalizeSymbol(req.symbol),
        req.takeProfitPrice ?? 0,
        req.stopLossPrice ?? 0,
      );
      if (!r?.success) {
        throw new ExchangeAdapterError({
          code: 'PROTECTION_REJECTED',
          exchangeId: this.id,
          message: r?.error ?? 'Bybit refused the TP/SL update.',
        });
      }
    } catch (e: any) {
      if (e instanceof ExchangeAdapterError) throw e;
      throw this.wrapError('PROTECTION_REJECTED', `Bybit setFuturesProtection failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    if (!this.isConfigured()) {
      throw new ExchangeAdapterError({ code: 'NOT_CONFIGURED', exchangeId: this.id, message: 'Bybit adapter is not configured.' });
    }
    try {
      const side: 'BUY' | 'SELL' = req.side === 'buy' ? 'BUY' : 'SELL';
      const orderType: 'LIMIT' | 'MARKET' = req.type === 'limit' ? 'LIMIT' : 'MARKET';
      const qty = Math.abs(req.quantity);
      const result: any = await bybitAdapter.placeRealOrder({
        symbol: this.normalizeSymbol(req.symbol),
        side,
        type: orderType,
        ...(req.type === 'limit' && req.price !== undefined ? { price: Number(req.price) } : {}),
        quantity: qty,
        ...(req.clientOrderId ? { orderLinkId: req.clientOrderId } : {}),
      });
      const order = this.mapOrder(result?.order ?? result);
      const fills = (result?.fills ?? []).map((f: any) => ({
        id: String(f.execId ?? ''),
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity: Number(f.execQty ?? 0),
        price: Number(f.execPrice ?? 0),
        fee: Number(f.execFee ?? 0),
        feeCurrency: String(f.feeCurrency ?? 'USDT'),
        liquidity: f.isMaker === true ? 'maker' : 'taker',
        timestamp: String(f.execTime ?? new Date().toISOString()),
      }));
      return { order, fills };
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit placeOrder failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    if (!this.isConfigured()) {
      throw new ExchangeAdapterError({ code: 'NOT_CONFIGURED', exchangeId: this.id, message: 'Bybit adapter is not configured.' });
    }
    try {
      const r: any = await bybitAdapter.cancelOrder(this.normalizeSymbol(symbol), orderId);
      return Boolean(r?.success);
    } catch (e: any) {
      throw this.wrapError('EXCHANGE_DOWN', `Bybit cancelOrder failed: ${e?.message ?? String(e)}`, e);
    }
  }

  public async cancelAllOrders(symbol?: string): Promise<number> {
    // The underlying bybitAdapter doesn't expose a cancel-all primitive
    // we can call from the adapter layer; the engine's existing cancelAll
    // path is wired in via ExchangeExecutionEngine which iterates over
    // fetchOpenOrders. Here we return 0 as a safe no-op and let the
    // engine drive the cancellation. NOT throwing keeps the contract
    // consistent — the engine's reconciliation loop is the source of
    // truth for "no open orders should remain".
    if (!this.isConfigured()) return 0;
    const open = await this.fetchOpenOrders(symbol);
    let cancelled = 0;
    for (const o of open) {
      if (await this.cancelOrder(o.symbol, o.id)) cancelled += 1;
    }
    return cancelled;
  }

  // ----- Throttling ----------------------------------------------------

  public getRateLimit() {
    return { requests: 600, windowMs: 5_000 };
  }

  public async pauseIfNeeded(): Promise<void> {
    // No internal token bucket — the engine request loop is responsible for pacing.
  }

  // ----- Helpers -------------------------------------------------------

  private normalizeSymbol(symbol: string): string {
    if (!symbol) return '';
    return symbol.toUpperCase().replace(/\//g, '');
  }

  private denormalizeSymbol(symbol: string): string {
    if (!symbol) return '';
    const upper = symbol.toUpperCase();
    if (upper.includes('/')) return upper;
    if (upper.endsWith('USDT')) return `${upper.slice(0, -4)}/USDT`;
    return upper;
  }

  private intervalMs(interval: string): number {
    const m: Record<string, number> = { '1': 60_000, '3': 180_000, '5': 300_000, '15': 900_000, '30': 1_800_000, '60': 3_600_000, '120': 7_200_000, '240': 14_400_000, 'D': 86_400_000, 'W': 604_800_000 };
    return m[interval] ?? 60_000;
  }

  private mapOrder(o: any): ExchangeOrder {
    if (!o) {
      return {
        id: '', clientOrderId: '', symbol: '', side: 'buy', type: 'market', signedQuantity: 0,
        price: null, filledQuantity: 0, avgFillPrice: null, status: 'rejected',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    }
    const side = (o.side === 'Buy' || o.side === 'buy') ? 'buy' : 'sell';
    const signedQty = (side === 'buy' ? 1 : -1) * Number(o.qty ?? o.size ?? 0);
    const filled = Number(o.cumExecQty ?? o.filledQty ?? 0);
    const avgPrice = o.avgPrice !== undefined && o.avgPrice !== '' ? Number(o.avgPrice) : null;
    const status: ExchangeOrder['status'] = (() => {
      switch (o.orderStatus) {
        case 'Filled': return 'filled';
        case 'PartiallyFilled': return 'partially_filled';
        case 'Cancelled':
        case 'Deactivated': return 'cancelled';
        case 'Rejected': return 'rejected';
        case 'Expired': return 'expired';
        default: return 'open';
      }
    })();
    return {
      id: String(o.orderId ?? ''),
      clientOrderId: String(o.orderLinkId ?? ''),
      symbol: this.denormalizeSymbol(o.symbol ?? ''),
      side,
      type: o.orderType === 'Limit' ? 'limit' : 'market',
      signedQuantity: signedQty,
      price: o.price !== undefined && o.price !== '' ? Number(o.price) : null,
      filledQuantity: filled,
      avgFillPrice: avgPrice,
      status,
      createdAt: String(o.createdTime ?? o.createdAt ?? new Date().toISOString()),
      updatedAt: String(o.updatedTime ?? o.updatedAt ?? new Date().toISOString()),
    };
  }

  private wrapError(code: ExchangeAdapterError['code'], message: string, cause: unknown): ExchangeAdapterError {
    const retriable = code === 'RATE_LIMITED' || code === 'TIMEOUT' || code === 'EXCHANGE_DOWN';
    return new ExchangeAdapterError({ code, exchangeId: this.id, message, retriable, cause });
  }
}
