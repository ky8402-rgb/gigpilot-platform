import { Candle, Fill, Order, OrderBook, OrderBookLevel, Position, TradingMode } from './types.js';

export interface ExchangePairState {
  symbol: string;
  currentPrice: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  candles: Candle[];
  orderBook: OrderBook;
}

export class ExchangeEngine {
  private pairs: Map<string, ExchangePairState> = new Map();
  private openOrders: Map<string, Order> = new Map();
  private orderHistory: Order[] = [];
  private fillsHistory: Fill[] = [];
  private positions: Map<string, Position> = new Map();
  private mode: TradingMode = 'PAPER';
  private tickInterval: NodeJS.Timeout | null = null;
  private onTickCallbacks: Array<(symbol: string, price: number) => void> = [];

  constructor() {
    this.initializePairs();
    this.startSimulationTicker();
  }

  private initializePairs() {
    const pairConfigs = [
      { symbol: 'BTC/USDT', basePrice: 66850, baseVol: 1420 },
      { symbol: 'ETH/USDT', basePrice: 3480, baseVol: 8500 },
      { symbol: 'SOL/USDT', basePrice: 158.40, baseVol: 45000 },
      { symbol: 'BNB/USDT', basePrice: 585.20, baseVol: 6200 },
      { symbol: 'AVAX/USDT', basePrice: 28.60, baseVol: 78000 }
    ];

    for (const cfg of pairConfigs) {
      const now = Date.now();
      const candles: Candle[] = [];
      let lastPrice = cfg.basePrice;

      // Seed 60 historical 1-minute candles
      for (let i = 60; i >= 0; i--) {
        const time = now - (i * 60000);
        const delta = (Math.random() - 0.495) * (lastPrice * 0.0035);
        const open = lastPrice;
        const close = Number((open + delta).toFixed(2));
        const high = Number((Math.max(open, close) + Math.random() * (open * 0.002)).toFixed(2));
        const low = Number((Math.min(open, close) - Math.random() * (open * 0.002)).toFixed(2));
        const volume = Number((cfg.baseVol * (0.6 + Math.random() * 0.8)).toFixed(2));
        
        candles.push({ timestamp: time, open, high, low, close, volume });
        lastPrice = close;
      }

      const currentPrice = candles[candles.length - 1].close;
      const orderBook = this.generateRealisticOrderBook(cfg.symbol, currentPrice);

      this.pairs.set(cfg.symbol, {
        symbol: cfg.symbol,
        currentPrice,
        open24h: candles[0].open,
        high24h: Math.max(...candles.map(c => c.high)),
        low24h: Math.min(...candles.map(c => c.low)),
        volume24h: candles.reduce((sum, c) => sum + c.volume, 0),
        candles,
        orderBook
      });

      // Initialize default position
      this.positions.set(cfg.symbol, {
        symbol: cfg.symbol,
        baseAmount: cfg.symbol === 'BTC/USDT' ? 0.045 : 0,
        quoteAmount: 10000,
        entryPrice: cfg.basePrice,
        currentPrice,
        unrealizedPnL: 0,
        unrealizedPnLPct: 0,
        realizedPnL: 0,
        totalFeesPaid: 0,
        netPnL: 0
      });
    }
  }

  public generateRealisticOrderBook(symbol: string, midPrice: number): OrderBook {
    const spreadPct = 0.0003 + (Math.random() * 0.0002); // 3 to 5 bps
    const halfSpread = midPrice * (spreadPct / 2);
    const bestBid = Number((midPrice - halfSpread).toFixed(2));
    const bestAsk = Number((midPrice + halfSpread).toFixed(2));
    const spread = Number((bestAsk - bestBid).toFixed(2));
    const spreadBps = Number(((spread / midPrice) * 10000).toFixed(2));

    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];
    let cumBid = 0;
    let cumAsk = 0;

    for (let i = 0; i < 15; i++) {
      const bidPrice = Number((bestBid * (1 - (i * 0.0006))).toFixed(2));
      const bidAmt = Number((Math.random() * 1.5 + 0.2).toFixed(4));
      cumBid += bidAmt;
      bids.push({ price: bidPrice, amount: bidAmt, total: Number(cumBid.toFixed(4)) });

      const askPrice = Number((bestAsk * (1 + (i * 0.0006))).toFixed(2));
      const askAmt = Number((Math.random() * 1.5 + 0.2).toFixed(4));
      cumAsk += askAmt;
      asks.push({ price: askPrice, amount: askAmt, total: Number(cumAsk.toFixed(4)) });
    }

    return {
      symbol,
      bids,
      asks,
      spread,
      spreadBps,
      midPrice,
      timestamp: Date.now()
    };
  }

  private startSimulationTicker() {
    this.tickInterval = setInterval(() => {
      for (const [symbol, state] of this.pairs.entries()) {
        // Random walk step with realistic momentum
        const pctDelta = (Math.random() - 0.498) * 0.0018; // ~0.18% max step
        const newPrice = Number((state.currentPrice * (1 + pctDelta)).toFixed(2));
        state.currentPrice = newPrice;

        // Update latest candle
        const now = Date.now();
        const latestCandle = state.candles[state.candles.length - 1];
        if (now - latestCandle.timestamp > 60000) {
          // New 1-min candle
          state.candles.push({
            timestamp: now,
            open: newPrice,
            high: newPrice,
            low: newPrice,
            close: newPrice,
            volume: Number((Math.random() * 25).toFixed(2))
          });
          if (state.candles.length > 200) state.candles.shift();
        } else {
          latestCandle.close = newPrice;
          if (newPrice > latestCandle.high) latestCandle.high = newPrice;
          if (newPrice < latestCandle.low) latestCandle.low = newPrice;
          latestCandle.volume += Number((Math.random() * 0.8).toFixed(2));
        }

        // Refresh order book
        state.orderBook = this.generateRealisticOrderBook(symbol, newPrice);

        // Check and match open grid/limit orders
        this.matchOpenOrders(symbol, newPrice);

        // Update mark-to-market position
        const pos = this.positions.get(symbol);
        if (pos) {
          pos.currentPrice = newPrice;
          if (pos.baseAmount > 0) {
            pos.unrealizedPnL = Number(((newPrice - pos.entryPrice) * pos.baseAmount).toFixed(2));
            pos.unrealizedPnLPct = pos.entryPrice > 0 ? Number((((newPrice - pos.entryPrice) / pos.entryPrice) * 100).toFixed(2)) : 0;
            pos.netPnL = Number((pos.realizedPnL + pos.unrealizedPnL - pos.totalFeesPaid).toFixed(2));
          }
        }

        // Notify callbacks
        for (const cb of this.onTickCallbacks) {
          try { cb(symbol, newPrice); } catch (_) {}
        }
      }
    }, 2000);
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
    return symbol ? list.filter(o => o.symbol === symbol) : list;
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

  public placeOrder(orderSpec: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT';
    price: number;
    amount: number;
    isGridOrder?: boolean;
    gridLevelId?: string;
    strategyId?: string;
  }): Order {
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
      latencyMs: Math.floor(12 + Math.random() * 28), // 12-40ms simulated latency
      placedAt: new Date().toISOString()
    };

    if (orderSpec.type === 'MARKET') {
      // Execute immediately with realistic slippage
      this.executeFill(order, order.price, true);
    } else {
      this.openOrders.set(order.id, order);
    }

    return order;
  }

  public cancelOrder(orderId: string): Order | null {
    const order = this.openOrders.get(orderId);
    if (!order) return null;
    order.status = 'CANCELLED';
    this.openOrders.delete(orderId);
    this.orderHistory.unshift(order);
    return order;
  }

  public cancelAllOrders(symbol?: string): number {
    let count = 0;
    for (const [id, order] of this.openOrders.entries()) {
      if (!symbol || order.symbol === symbol) {
        order.status = 'CANCELLED';
        this.openOrders.delete(id);
        this.orderHistory.unshift(order);
        count++;
      }
    }
    return count;
  }

  private matchOpenOrders(symbol: string, currentPrice: number) {
    for (const [id, order] of this.openOrders.entries()) {
      if (order.symbol !== symbol) continue;

      let isFilled = false;
      if (order.side === 'BUY' && currentPrice <= order.price) {
        isFilled = true;
      } else if (order.side === 'SELL' && currentPrice >= order.price) {
        isFilled = true;
      }

      if (isFilled) {
        this.executeFill(order, order.price, false);
        this.openOrders.delete(id);
      }
    }
  }

  private executeFill(order: Order, matchPrice: number, isTaker: boolean) {
    const feeRate = isTaker ? 0.001 : 0.0006; // 0.1% taker / 0.06% maker (VIP tier)
    const slippageBps = isTaker ? Math.floor(Math.random() * 6 + 1) : 0;
    const slippageMult = order.side === 'BUY' ? (1 + slippageBps / 10000) : (1 - slippageBps / 10000);
    const executionPrice = Number((matchPrice * slippageMult).toFixed(2));
    const feeUsd = Number((executionPrice * order.amount * feeRate).toFixed(4));

    order.filledAmount = order.amount;
    order.remainingAmount = 0;
    order.status = 'FILLED';
    order.feesPaid = feeUsd;
    order.slippageBps = slippageBps;
    order.filledAt = new Date().toISOString();

    const pos = this.positions.get(order.symbol);
    let realizedPnL = 0;

    if (pos) {
      pos.totalFeesPaid += feeUsd;
      if (order.side === 'BUY') {
        // Average up/down entry price
        const totalCost = (pos.baseAmount * pos.entryPrice) + (order.amount * executionPrice);
        pos.baseAmount += order.amount;
        pos.entryPrice = pos.baseAmount > 0 ? Number((totalCost / pos.baseAmount).toFixed(2)) : executionPrice;
      } else {
        // Realize profit on sell
        const profit = (executionPrice - pos.entryPrice) * Math.min(pos.baseAmount, order.amount);
        realizedPnL = Number((profit - feeUsd).toFixed(2));
        pos.realizedPnL += realizedPnL;
        pos.baseAmount = Math.max(0, pos.baseAmount - order.amount);
        pos.netPnL = Number((pos.realizedPnL + pos.unrealizedPnL - pos.totalFeesPaid).toFixed(2));
      }
    }

    const fill: Fill = {
      id: `fill_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      price: executionPrice,
      amount: order.amount,
      feeUsd,
      slippageBps,
      realizedPnL,
      timestamp: new Date().toISOString()
    };

    this.fillsHistory.unshift(fill);
    if (this.fillsHistory.length > 200) this.fillsHistory.pop();

    this.orderHistory.unshift(order);
    if (this.orderHistory.length > 200) this.orderHistory.pop();

    return fill;
  }
}
