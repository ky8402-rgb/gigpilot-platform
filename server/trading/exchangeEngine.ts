import { Candle, Fill, Order, OrderBook, OrderBookLevel, Position, TradingMode } from './types.js';
import { binanceAdapter, FALLBACK_BASELINE_PRICES } from './binanceAdapter.js';

export interface ExchangePairState {
  symbol: string;
  currentPrice: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  priceChangePct: number;
  candles: Candle[];
  orderBook: OrderBook;
  lastUpdated: string;
}

export class ExchangeEngine {
  private pairs: Map<string, ExchangePairState> = new Map();
  private openOrders: Map<string, Order> = new Map();
  private orderHistory: Order[] = [];
  private fillsHistory: Fill[] = [];
  private positions: Map<string, Position> = new Map();
  private mode: TradingMode = 'LIVE';
  private tickInterval: NodeJS.Timeout | null = null;
  private onTickCallbacks: Array<(symbol: string, price: number) => void> = [];
  private isUpdating = false;

  private trackedSymbols = [
    'BTC/USDT',
    'ETH/USDT',
    'SOL/USDT',
    'LUNA/USDT',
    'BNB/USDT',
    'AVAX/USDT',
    'DOGE/USDT',
    'XRP/USDT'
  ];

  constructor() {
    this.initRealPairs();
    this.startLiveExchangePoller();
  }

  // Normalize any variation of a trading pair ("BTC-USDT", "BTCUSDT", "btc/usdt") to standard "BTC/USDT"
  public normalizeSymbol(sym: string): string {
    if (!sym) return 'BTC/USDT';
    let s = decodeURIComponent(sym).trim().toUpperCase();
    s = s.replace(/[-_]/g, '/');
    if (!s.includes('/')) {
      if (s.endsWith('USDT')) s = `${s.slice(0, -4)}/USDT`;
      else if (s.endsWith('USD')) s = `${s.slice(0, -3)}/USDT`;
      else if (s.endsWith('USDC')) s = `${s.slice(0, -4)}/USDC`;
      else s = `${s}/USDT`;
    }
    return s;
  }

  private async initRealPairs() {
    for (const symbol of this.trackedSymbols) {
      const norm = symbol.replace(/[\/\-_]/g, '').toUpperCase();
      const fb = FALLBACK_BASELINE_PRICES[norm] || FALLBACK_BASELINE_PRICES['BTCUSDT'];
      const price = fb.price;

      // Seed initial candles so UI charts render immediately on startup
      const initialCandles: Candle[] = [];
      const now = Date.now();
      let cClose = price * 0.995;
      for (let i = 30; i >= 0; i--) {
        const timeMs = now - i * 60000;
        const wave = Math.sin(i * 0.4) * 0.002;
        const open = Number(cClose.toFixed(4));
        const close = Number((cClose * (1 + wave)).toFixed(4));
        const high = Number((Math.max(open, close) * 1.002).toFixed(4));
        const low = Number((Math.min(open, close) * 0.998).toFixed(4));
        cClose = close;
        initialCandles.push({
          timestamp: timeMs,
          open,
          high,
          low,
          close,
          volume: Number((100 + i * 5).toFixed(2))
        });
      }

      // Seed initial order book
      const bids: OrderBookLevel[] = [];
      const asks: OrderBookLevel[] = [];
      let cumB = 0;
      let cumA = 0;
      for (let i = 1; i <= 10; i++) {
        const bidP = Number((price * (1 - i * 0.0008)).toFixed(4));
        const askP = Number((price * (1 + i * 0.0008)).toFixed(4));
        const bAmt = Number((Math.random() * 2 + 0.5).toFixed(4));
        const aAmt = Number((Math.random() * 2 + 0.5).toFixed(4));
        cumB += bAmt;
        cumA += aAmt;
        bids.push({ price: bidP, amount: bAmt, total: Number(cumB.toFixed(4)) });
        asks.push({ price: askP, amount: aAmt, total: Number(cumA.toFixed(4)) });
      }

      this.pairs.set(symbol, {
        symbol,
        currentPrice: price,
        open24h: fb.open24h,
        high24h: fb.high24h,
        low24h: fb.low24h,
        volume24h: fb.volume,
        priceChangePct: fb.change24hPct,
        candles: initialCandles,
        orderBook: {
          symbol,
          bids,
          asks,
          spread: Number((price * 0.0016).toFixed(4)),
          spreadBps: 16,
          midPrice: price,
          timestamp: Date.now()
        },
        lastUpdated: new Date().toISOString()
      });

      this.positions.set(symbol, {
        symbol,
        baseAmount: 0,
        quoteAmount: 0,
        entryPrice: 0,
        currentPrice: price,
        unrealizedPnL: 0,
        unrealizedPnLPct: 0,
        realizedPnL: 0,
        totalFeesPaid: 0,
        netPnL: 0
      });
    }

    // Immediate background fetch from Binance public mirrors
    this.refreshLiveMarketData().catch(err => {
      console.warn('[ExchangeEngine] Initial live market fetch warning:', err.message);
    });
  }

  public async refreshLiveMarketData(): Promise<void> {
    if (this.isUpdating) return;
    this.isUpdating = true;

    try {
      for (const symbol of this.trackedSymbols) {
        // 1. Fetch real 24h ticker & price from Binance
        const ticker = await binanceAdapter.getReal24hTicker(symbol);
        const price = ticker.close > 0 ? ticker.close : await binanceAdapter.getRealPrice(symbol);

        // 2. Fetch real live candles (1-minute)
        const candles = await binanceAdapter.getRealCandles(symbol, '1m', 60);

        // 3. Fetch real live order book
        const orderBook = await binanceAdapter.getRealOrderBook(symbol, 15);

        const currentPrice = price > 0 ? price : (candles[candles.length - 1]?.close || 0);

        const state: ExchangePairState = {
          symbol,
          currentPrice,
          open24h: ticker.open,
          high24h: ticker.high,
          low24h: ticker.low,
          volume24h: ticker.volume,
          priceChangePct: ticker.priceChangePct,
          candles,
          orderBook,
          lastUpdated: new Date().toISOString()
        };

        this.pairs.set(symbol, state);

        // Update position mark-to-market
        const pos = this.positions.get(symbol);
        if (pos) {
          pos.currentPrice = currentPrice;
          if (pos.baseAmount > 0 && pos.entryPrice > 0) {
            pos.unrealizedPnL = Number(((currentPrice - pos.entryPrice) * pos.baseAmount).toFixed(2));
            pos.unrealizedPnLPct = Number((((currentPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2));
            pos.netPnL = Number((pos.realizedPnL + pos.unrealizedPnL - pos.totalFeesPaid).toFixed(2));
          }
        }

        // Notify callbacks
        for (const cb of this.onTickCallbacks) {
          try {
            cb(symbol, currentPrice);
          } catch (_) {}
        }
      }

      // Sync real positions and open orders from Binance account if keys configured
      if (binanceAdapter.isKeyConfigured()) {
        try {
          const acct = await binanceAdapter.getRealAccountState();
          if (acct.status === 'CONNECTED') {
            for (const b of acct.spotBalances) {
              const pair = `${b.asset}/USDT`;
              if (this.positions.has(pair)) {
                const p = this.positions.get(pair)!;
                p.baseAmount = b.total;
                p.quoteAmount = acct.availableCashUsd;
              }
            }

            // Sync real fills from Binance
            if (acct.recentTrades && acct.recentTrades.length > 0) {
              this.fillsHistory = acct.recentTrades;
            }
          }
        } catch (e) {
          // Account restricted or error, market data continues
        }
      }
    } catch (err) {
      console.error('Error refreshing real Binance market data:', err);
    } finally {
      this.isUpdating = false;
    }
  }

  private startLiveExchangePoller() {
    // Poll real Binance Spot ticker & order book every 4 seconds
    this.tickInterval = setInterval(() => {
      this.refreshLiveMarketData().catch(() => {});
    }, 4000);
  }

  public registerTickCallback(cb: (symbol: string, price: number) => void) {
    this.onTickCallbacks.push(cb);
  }

  public getPairState(symbol: string): ExchangePairState | undefined {
    const norm = this.normalizeSymbol(symbol);
    return this.pairs.get(norm) || this.pairs.get(symbol);
  }

  public getAllPairs(): ExchangePairState[] {
    return Array.from(this.pairs.values());
  }

  public getOpenOrders(symbol?: string): Order[] {
    const list = Array.from(this.openOrders.values());
    if (!symbol) return list;
    const norm = this.normalizeSymbol(symbol);
    return list.filter((o) => o.symbol === norm || o.symbol === symbol);
  }

  public getFills(): Fill[] {
    return [...this.fillsHistory];
  }

  public getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  public getPosition(symbol: string): Position | undefined {
    const norm = this.normalizeSymbol(symbol);
    return this.positions.get(norm) || this.positions.get(symbol);
  }

  public setMode(mode: TradingMode) {
    this.mode = mode;
  }

  public getMode(): TradingMode {
    return this.mode;
  }

  public async placeOrder(orderSpec: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT';
    price: number;
    amount: number;
    isGridOrder?: boolean;
    gridLevelId?: string;
    strategyId?: string;
  }): Promise<Order> {
    const id = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const costUsd = Number((orderSpec.price * orderSpec.amount).toFixed(2));

    const order: Order = {
      id,
      symbol: orderSpec.symbol,
      side: orderSpec.side,
      type: orderSpec.type,
      price: orderSpec.price,
      amount: orderSpec.amount,
      filledAmount: 0,
      remainingAmount: orderSpec.amount,
      costUsd,
      status: 'OPEN',
      isGridOrder: Boolean(orderSpec.isGridOrder),
      gridLevelId: orderSpec.gridLevelId,
      strategyId: orderSpec.strategyId || 'STRAT-GRID-001',
      mode: this.mode,
      feesPaid: 0,
      slippageBps: 0,
      latencyMs: 18,
      placedAt: new Date().toISOString()
    };

    // If Binance account is configured and mode is LIVE, dispatch to Binance
    if (this.mode === 'LIVE' && binanceAdapter.isKeyConfigured()) {
      try {
        const binanceRes = await binanceAdapter.placeRealOrder({
          symbol: orderSpec.symbol,
          side: orderSpec.side,
          type: orderSpec.type === 'MARKET' ? 'MARKET' : 'LIMIT',
          price: orderSpec.price,
          quantity: orderSpec.amount
        });

        if (binanceRes.success && binanceRes.orderId) {
          order.id = binanceRes.orderId;
        } else {
          order.status = 'REJECTED';
          order.rejectionReason = binanceRes.error || 'Binance order placement rejected';
        }
      } catch (err: any) {
        order.status = 'REJECTED';
        order.rejectionReason = err.message || 'Failed to place order on Binance';
      }
    }

    if (order.status === 'OPEN') {
      this.openOrders.set(order.id, order);
    }
    this.orderHistory.unshift(order);
    return order;
  }

  public async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.openOrders.get(orderId);
    if (!order) return false;

    if (this.mode === 'LIVE' && binanceAdapter.isKeyConfigured()) {
      try {
        await binanceAdapter.cancelRealOrder(order.symbol, orderId);
      } catch (e) {
        console.error('Error cancelling order on Binance:', e);
      }
    }

    order.status = 'CANCELLED';
    this.openOrders.delete(orderId);
    return true;
  }

  public async cancelAllOrders(symbol?: string): Promise<number> {
    let count = 0;
    const targets = Array.from(this.openOrders.values()).filter((o) => !symbol || o.symbol === symbol);

    if (symbol && this.mode === 'LIVE' && binanceAdapter.isKeyConfigured()) {
      try {
        await binanceAdapter.cancelAllRealOrders(symbol);
      } catch (e) {
        console.error(`Error bulk cancelling orders on Binance for ${symbol}:`, e);
      }
    }

    for (const ord of targets) {
      ord.status = 'CANCELLED';
      this.openOrders.delete(ord.id);
      count++;
    }
    return count;
  }

  public destroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
}
