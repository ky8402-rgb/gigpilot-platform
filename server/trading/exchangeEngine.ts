import { Candle, Fill, Order, OrderBook, Position, TradingMode } from './types.js';
import { binanceAdapter } from './binanceAdapter.js';

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

  private trackedSymbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'AVAX/USDT'];

  constructor() {
    this.initRealPairs();
    this.startLiveExchangePoller();
  }

  private async initRealPairs() {
    for (const symbol of this.trackedSymbols) {
      this.pairs.set(symbol, {
        symbol,
        currentPrice: 0,
        open24h: 0,
        high24h: 0,
        low24h: 0,
        volume24h: 0,
        priceChangePct: 0,
        candles: [],
        orderBook: {
          symbol,
          bids: [],
          asks: [],
          spread: 0,
          spreadBps: 0,
          midPrice: 0,
          timestamp: Date.now()
        },
        lastUpdated: new Date().toISOString()
      });

      this.positions.set(symbol, {
        symbol,
        baseAmount: 0,
        quoteAmount: 0,
        entryPrice: 0,
        currentPrice: 0,
        unrealizedPnL: 0,
        unrealizedPnLPct: 0,
        realizedPnL: 0,
        totalFeesPaid: 0,
        netPnL: 0
      });
    }

    // Initial immediate fetch from Binance
    await this.refreshLiveMarketData();
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

            // Sync real Binance open orders into the engine so the terminal never
            // reports an empty local order book when orders exist at Binance.
            const liveOrders = await binanceAdapter.getRealOpenOrders();
            this.openOrders.clear();
            for (const liveOrder of liveOrders) {
              this.openOrders.set(liveOrder.id, liveOrder);
            }

            // Sync real fills from Binance.
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
    return this.pairs.get(symbol);
  }

  public getAllPairs(): ExchangePairState[] {
    return Array.from(this.pairs.values());
  }

  public getOpenOrders(symbol?: string): Order[] {
    const list = Array.from(this.openOrders.values());
    return symbol ? list.filter((o) => o.symbol === symbol) : list;
  }

  public getFills(): Fill[] {
    return [...this.fillsHistory];
  }

  public getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  public getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol);
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

    // LIVE mode is fail-closed: never create a local OPEN order when the real exchange is unavailable.
    if (this.mode === 'LIVE' && !binanceAdapter.isKeyConfigured()) {
      order.status = 'REJECTED';
      order.rejectionReason = 'LIVE trading requires configured Binance Spot API credentials.';
      this.orderHistory.unshift(order);
      return order;
    }

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
