import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Candle, Fill, Order, OrderBook, OrderBookLevel } from './types.js';

export interface BinanceBalanceItem {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAssetWithUsd {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdPrice: number;
  usdValue: number;
  allocationPct: number;
  change24hPct?: number;
}

export interface BinanceAccountState {
  status: 'CONNECTED' | 'RESTRICTED' | 'DISCONNECTED' | 'ERROR';
  message: string;
  serverIp: string;
  timestamp: string;
  totalEquityUsd: number;
  availableCashUsd: number;
  lockedInOrdersUsd: number;
  spotBalances: BinanceAssetWithUsd[];
  realizedProfitUsd: number;
  unrealizedProfitUsd: number;
  todayPnLUsd: number;
  todayPnLPct: number;
  openOrdersCount: number;
  recentTrades: Fill[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType: string;
  apiKeyConfigured: boolean;
  keyMask: string;
}

const BINANCE_CONFIG_FILE = path.join(process.cwd(), '.binance-quant-keys.json');

export class BinanceAdapter {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string = 'https://api.binance.com';
  private serverIp: string = '3.222.149.9';
  private priceCache: Map<string, { price: number; time: number }> = new Map();
  private lastAccountState: BinanceAccountState | null = null;
  private lastAccountFetchTime = 0;

  constructor() {
    // Load from env or persistent config file
    let savedKeys: any = {};
    if (fs.existsSync(BINANCE_CONFIG_FILE)) {
      try {
        savedKeys = JSON.parse(fs.readFileSync(BINANCE_CONFIG_FILE, 'utf-8'));
      } catch (e) {
        console.error('Error loading saved binance keys:', e);
      }
    }

    this.apiKey = savedKeys.apiKey || process.env.BINANCE_API_KEY || '';
    this.apiSecret = savedKeys.apiSecret || process.env.BINANCE_API_SECRET || '';
    if (savedKeys.baseUrl) {
      this.baseUrl = savedKeys.baseUrl;
    }
  }

  public updateCredentials(apiKey: string, apiSecret: string, baseUrl?: string): void {
    this.apiKey = apiKey.trim();
    this.apiSecret = apiSecret.trim();
    if (baseUrl) this.baseUrl = baseUrl.trim();
    this.lastAccountFetchTime = 0; // Force refresh
    this.saveConfig();
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(
        BINANCE_CONFIG_FILE,
        JSON.stringify(
          {
            apiKey: this.apiKey,
            apiSecret: this.apiSecret,
            baseUrl: this.baseUrl,
            updatedAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf-8'
      );
    } catch (e) {
      console.error('Failed to save binance config:', e);
    }
  }

  public getKeyMask(): string {
    if (!this.apiKey) return 'NOT CONFIGURED';
    if (this.apiKey.length <= 8) return '****';
    return `${this.apiKey.slice(0, 6)}...${this.apiKey.slice(-4)}`;
  }

  public isKeyConfigured(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getServerIp(): string {
    return this.serverIp;
  }

  // Format pair e.g. "BTC/USDT" to "BTCUSDT"
  public normalizeSymbol(symbol: string): string {
    return symbol.replace('/', '').toUpperCase();
  }

  // Convert Binance pair e.g. "BTCUSDT" back to "BTC/USDT"
  public denormalizeSymbol(symbol: string): string {
    if (symbol.endsWith('USDT')) {
      return `${symbol.slice(0, -4)}/USDT`;
    }
    if (symbol.endsWith('FDUSD')) {
      return `${symbol.slice(0, -5)}/FDUSD`;
    }
    if (symbol.endsWith('USDC')) {
      return `${symbol.slice(0, -4)}/USDC`;
    }
    return symbol;
  }

  /**
   * Public: Real live ticker price from Binance
   */
  public async getRealPrice(symbol: string): Promise<number> {
    const norm = this.normalizeSymbol(symbol);
    const cached = this.priceCache.get(norm);
    if (cached && Date.now() - cached.time < 1500) {
      return cached.price;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/v3/ticker/price?symbol=${norm}`, {
        headers: { 'User-Agent': 'GigPilot-Quant/2.5' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { price: string };
      const price = parseFloat(data.price);
      this.priceCache.set(norm, { price, time: Date.now() });
      return price;
    } catch (e: any) {
      if (cached) return cached.price;
      return 0;
    }
  }

  /**
   * Public: Real 24h ticker statistics from Binance
   */
  public async getReal24hTicker(symbol: string): Promise<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    priceChangePct: number;
  }> {
    const norm = this.normalizeSymbol(symbol);
    try {
      const res = await fetch(`${this.baseUrl}/api/v3/ticker/24hr?symbol=${norm}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as any;
      return {
        open: parseFloat(d.openPrice || '0'),
        high: parseFloat(d.highPrice || '0'),
        low: parseFloat(d.lowPrice || '0'),
        close: parseFloat(d.lastPrice || '0'),
        volume: parseFloat(d.volume || '0'),
        priceChangePct: parseFloat(d.priceChangePercent || '0')
      };
    } catch (e) {
      return { open: 0, high: 0, low: 0, close: 0, volume: 0, priceChangePct: 0 };
    }
  }

  /**
   * Public: Real Candlesticks from Binance (1m, 5m, 1h, etc.)
   */
  public async getRealCandles(symbol: string, interval = '1m', limit = 60): Promise<Candle[]> {
    const norm = this.normalizeSymbol(symbol);
    try {
      const res = await fetch(`${this.baseUrl}/api/v3/klines?symbol=${norm}&interval=${interval}&limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any[];
      return data.map((k) => ({
        timestamp: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    } catch (err) {
      console.error(`Failed to fetch Binance candles for ${symbol}:`, err);
      return [];
    }
  }

  /**
   * Public: Real Live Order Book (Depth) from Binance
   */
  public async getRealOrderBook(symbol: string, limit = 20): Promise<OrderBook> {
    const norm = this.normalizeSymbol(symbol);
    try {
      const res = await fetch(`${this.baseUrl}/api/v3/depth?symbol=${norm}&limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { bids: [string, string][]; asks: [string, string][] };

      let cumBid = 0;
      const bids: OrderBookLevel[] = data.bids.map(([p, a]) => {
        const amt = parseFloat(a);
        cumBid += amt;
        return {
          price: parseFloat(p),
          amount: amt,
          total: Number(cumBid.toFixed(4))
        };
      });

      let cumAsk = 0;
      const asks: OrderBookLevel[] = data.asks.map(([p, a]) => {
        const amt = parseFloat(a);
        cumAsk += amt;
        return {
          price: parseFloat(p),
          amount: amt,
          total: Number(cumAsk.toFixed(4))
        };
      });

      const bestBid = bids[0]?.price || 0;
      const bestAsk = asks[0]?.price || 0;
      const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
      const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
      const spreadBps = midPrice > 0 ? (spread / midPrice) * 10000 : 0;

      return {
        symbol,
        bids,
        asks,
        spread: Number(spread.toFixed(2)),
        spreadBps: Number(spreadBps.toFixed(2)),
        midPrice: Number(midPrice.toFixed(2)),
        timestamp: Date.now()
      };
    } catch (err) {
      return {
        symbol,
        bids: [],
        asks: [],
        spread: 0,
        spreadBps: 0,
        midPrice: 0,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Helper: Sign request for Binance private endpoints
   */
  private signQuery(params: Record<string, any> = {}): { queryString: string; signature: string } {
    const timestamp = Date.now();
    const queryParts = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);

    queryParts.push(`recvWindow=60000`);
    queryParts.push(`timestamp=${timestamp}`);

    const queryString = queryParts.join('&');
    const signature = crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
    return { queryString, signature };
  }

  /**
   * Private Signed: Real Binance Spot Account balances and portfolio valuation
   */
  public async getRealAccountState(forceRefresh = false): Promise<BinanceAccountState> {
    const now = Date.now();
    if (!forceRefresh && this.lastAccountState && now - this.lastAccountFetchTime < 3000) {
      return this.lastAccountState;
    }

    if (!this.apiKey || !this.apiSecret) {
      return {
        status: 'DISCONNECTED',
        message: 'Binance API key & secret not configured. Please enter your Binance API keys.',
        serverIp: this.serverIp,
        timestamp: new Date().toISOString(),
        totalEquityUsd: 0,
        availableCashUsd: 0,
        lockedInOrdersUsd: 0,
        spotBalances: [],
        realizedProfitUsd: 0,
        unrealizedProfitUsd: 0,
        todayPnLUsd: 0,
        todayPnLPct: 0,
        openOrdersCount: 0,
        recentTrades: [],
        canTrade: false,
        canWithdraw: false,
        canDeposit: false,
        accountType: 'UNKNOWN',
        apiKeyConfigured: false,
        keyMask: 'NOT CONFIGURED'
      };
    }

    try {
      const { queryString, signature } = this.signQuery();
      const res = await fetch(`${this.baseUrl}/api/v3/account?${queryString}&signature=${signature}`, {
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'User-Agent': 'GigPilot-Quant/2.5'
        }
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data?.msg || `Binance API error HTTP ${res.status}`;
        const isRestricted = data?.code === -2015;
        const status = isRestricted ? 'RESTRICTED' : 'ERROR';
        const msg = isRestricted
          ? `Binance API Error (Code -2015): Invalid API-key, IP, or permissions. Please whitelist server IP ${this.serverIp} in your Binance API Management or toggle IP unrestricted.`
          : `Binance Account Query Failed: ${errorMsg}`;

        return {
          status,
          message: msg,
          serverIp: this.serverIp,
          timestamp: new Date().toISOString(),
          totalEquityUsd: 0,
          availableCashUsd: 0,
          lockedInOrdersUsd: 0,
          spotBalances: [],
          realizedProfitUsd: 0,
          unrealizedProfitUsd: 0,
          todayPnLUsd: 0,
          todayPnLPct: 0,
          openOrdersCount: 0,
          recentTrades: [],
          canTrade: false,
          canWithdraw: false,
          canDeposit: false,
          accountType: 'SPOT',
          apiKeyConfigured: true,
          keyMask: this.getKeyMask()
        };
      }

      // Filter non-zero balances
      const rawBalances: BinanceBalanceItem[] = data.balances || [];
      const nonZero = rawBalances.filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);

      // Fetch prices for all non-zero assets in parallel
      const priceMap: Record<string, number> = {
        USDT: 1.0,
        USD: 1.0,
        USDC: 1.0,
        FDUSD: 1.0,
        BUSD: 1.0
      };

      const cryptoAssetsToPrice = nonZero.map((b) => b.asset).filter((a) => !priceMap[a]);

      if (cryptoAssetsToPrice.length > 0) {
        try {
          const tickerRes = await fetch(`${this.baseUrl}/api/v3/ticker/price`);
          if (tickerRes.ok) {
            const allPrices = (await tickerRes.json()) as Array<{ symbol: string; price: string }>;
            for (const item of allPrices) {
              for (const asset of cryptoAssetsToPrice) {
                if (item.symbol === `${asset}USDT` || item.symbol === `${asset}FDUSD`) {
                  priceMap[asset] = parseFloat(item.price);
                }
              }
            }
          }
        } catch (err) {
          console.error('Failed to batch query asset prices from Binance:', err);
        }
      }

      let totalEquityUsd = 0;
      let availableCashUsd = 0;
      let lockedInOrdersUsd = 0;

      const spotBalances: BinanceAssetWithUsd[] = nonZero.map((b) => {
        const free = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        const total = free + locked;
        const usdPrice = priceMap[b.asset] || 0;
        const usdValue = total * usdPrice;

        totalEquityUsd += usdValue;
        if (['USDT', 'USDC', 'FDUSD', 'USD'].includes(b.asset)) {
          availableCashUsd += free * usdPrice;
        }
        lockedInOrdersUsd += locked * usdPrice;

        return {
          asset: b.asset,
          free,
          locked,
          total,
          usdPrice,
          usdValue,
          allocationPct: 0 // Will compute below
        };
      });

      // Compute allocation percentages
      spotBalances.forEach((b) => {
        b.allocationPct = totalEquityUsd > 0 ? Number(((b.usdValue / totalEquityUsd) * 100).toFixed(2)) : 0;
      });

      // Sort by USD value descending
      spotBalances.sort((a, b) => b.usdValue - a.usdValue);

      // Fetch real open orders count
      let openOrdersCount = 0;
      try {
        const openOrders = await this.getRealOpenOrders();
        openOrdersCount = openOrders.length;
      } catch {
        openOrdersCount = 0;
      }

      // Fetch real trades for P&L tracking
      let recentTrades: Fill[] = [];
      try {
        recentTrades = await this.getRealTrades('BTCUSDT', 20);
      } catch {
        recentTrades = [];
      }

      const calculatedState: BinanceAccountState = {
        status: 'CONNECTED',
        message: 'Successfully connected to Binance Spot account with live real funds.',
        serverIp: this.serverIp,
        timestamp: new Date().toISOString(),
        totalEquityUsd: Number(totalEquityUsd.toFixed(2)),
        availableCashUsd: Number(availableCashUsd.toFixed(2)),
        lockedInOrdersUsd: Number(lockedInOrdersUsd.toFixed(2)),
        spotBalances,
        realizedProfitUsd: 0,
        unrealizedProfitUsd: 0,
        todayPnLUsd: 0,
        todayPnLPct: 0,
        openOrdersCount,
        recentTrades,
        canTrade: !!data.canTrade,
        canWithdraw: !!data.canWithdraw,
        canDeposit: !!data.canDeposit,
        accountType: data.accountType || 'SPOT',
        apiKeyConfigured: true,
        keyMask: this.getKeyMask()
      };

      this.lastAccountState = calculatedState;
      this.lastAccountFetchTime = now;
      return calculatedState;
    } catch (err: any) {
      console.error('Binance account fetch error:', err);
      return {
        status: 'ERROR',
        message: `Connection Error: ${err.message || 'Unknown network error reaching Binance'}`,
        serverIp: this.serverIp,
        timestamp: new Date().toISOString(),
        totalEquityUsd: 0,
        availableCashUsd: 0,
        lockedInOrdersUsd: 0,
        spotBalances: [],
        realizedProfitUsd: 0,
        unrealizedProfitUsd: 0,
        todayPnLUsd: 0,
        todayPnLPct: 0,
        openOrdersCount: 0,
        recentTrades: [],
        canTrade: false,
        canWithdraw: false,
        canDeposit: false,
        accountType: 'SPOT',
        apiKeyConfigured: true,
        keyMask: this.getKeyMask()
      };
    }
  }

  /**
   * Private Signed: Real Open Orders from Binance
   */
  public async getRealOpenOrders(symbol?: string): Promise<Order[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const params: Record<string, any> = {};
    if (symbol) {
      params.symbol = this.normalizeSymbol(symbol);
    }

    const { queryString, signature } = this.signQuery(params);
    const res = await fetch(`${this.baseUrl}/api/v3/openOrders?${queryString}&signature=${signature}`, {
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'User-Agent': 'GigPilot-Quant/2.5'
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.msg || `HTTP ${res.status}`);
    }

    const rawList = (await res.json()) as any[];
    return rawList.map((o) => ({
      id: String(o.orderId),
      symbol: this.denormalizeSymbol(o.symbol),
      side: o.side as 'BUY' | 'SELL',
      type: o.type === 'LIMIT' ? 'LIMIT' : 'MARKET',
      price: parseFloat(o.price),
      amount: parseFloat(o.origQty),
      filledAmount: parseFloat(o.executedQty),
      remainingAmount: parseFloat(o.origQty) - parseFloat(o.executedQty),
      costUsd: parseFloat(o.cummulativeQuoteQty || '0'),
      status: o.status === 'NEW' ? 'OPEN' : o.status,
      isGridOrder: false,
      strategyId: 'LIVE-BINANCE-SPOT',
      mode: 'LIVE',
      feesPaid: 0,
      slippageBps: 0,
      latencyMs: 15,
      placedAt: new Date(o.time).toISOString()
    }));
  }

  /**
   * Private Signed: Real historical trade fills from Binance
   */
  public async getRealTrades(symbol = 'BTCUSDT', limit = 50): Promise<Fill[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const norm = this.normalizeSymbol(symbol);
    const { queryString, signature } = this.signQuery({ symbol: norm, limit });
    const res = await fetch(`${this.baseUrl}/api/v3/myTrades?${queryString}&signature=${signature}`, {
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'User-Agent': 'GigPilot-Quant/2.5'
      }
    });

    if (!res.ok) return [];
    const list = (await res.json()) as any[];
    return list.map((t) => ({
      id: String(t.id),
      orderId: String(t.orderId),
      symbol: this.denormalizeSymbol(t.symbol),
      side: t.isBuyer ? 'BUY' : 'SELL',
      price: parseFloat(t.price),
      amount: parseFloat(t.qty),
      feeUsd: parseFloat(t.commission || '0'),
      slippageBps: 0,
      realizedPnL: 0,
      timestamp: new Date(t.time).toISOString()
    }));
  }

  /**
   * Private Signed: Place real order on Binance Spot
   */
  public async placeRealOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    price?: number;
    quantity: number;
  }): Promise<{ success: boolean; orderId?: string; error?: string }> {
    if (!this.apiKey || !this.apiSecret) {
      return { success: false, error: 'Binance API credentials missing.' };
    }

    const payload: Record<string, any> = {
      symbol: this.normalizeSymbol(params.symbol),
      side: params.side,
      type: params.type,
      quantity: params.quantity
    };

    if (params.type === 'LIMIT') {
      if (!params.price) return { success: false, error: 'Price required for LIMIT orders' };
      payload.price = params.price;
      payload.timeInForce = 'GTC';
    }

    const { queryString, signature } = this.signQuery(payload);
    const res = await fetch(`${this.baseUrl}/api/v3/order?${queryString}&signature=${signature}`, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'User-Agent': 'GigPilot-Quant/2.5'
      }
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.msg || `HTTP ${res.status}` };
    }

    return { success: true, orderId: String(data.orderId) };
  }

  /**
   * Private Signed: Cancel real order on Binance Spot
   */
  public async cancelRealOrder(symbol: string, orderId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.apiKey || !this.apiSecret) {
      return { success: false, error: 'Binance API credentials missing.' };
    }

    const { queryString, signature } = this.signQuery({
      symbol: this.normalizeSymbol(symbol),
      orderId
    });

    const res = await fetch(`${this.baseUrl}/api/v3/order?${queryString}&signature=${signature}`, {
      method: 'DELETE',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'User-Agent': 'GigPilot-Quant/2.5'
      }
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.msg || `HTTP ${res.status}` };
    }

    return { success: true };
  }

  /**
   * Private Signed: Cancel all open orders for a symbol on Binance
   */
  public async cancelAllRealOrders(symbol: string): Promise<{ success: boolean; cancelledCount: number; error?: string }> {
    if (!this.apiKey || !this.apiSecret) {
      return { success: false, cancelledCount: 0, error: 'Binance API credentials missing.' };
    }

    const { queryString, signature } = this.signQuery({
      symbol: this.normalizeSymbol(symbol)
    });

    const res = await fetch(`${this.baseUrl}/api/v3/openOrders?${queryString}&signature=${signature}`, {
      method: 'DELETE',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'User-Agent': 'GigPilot-Quant/2.5'
      }
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, cancelledCount: 0, error: data.msg || `HTTP ${res.status}` };
    }

    const count = Array.isArray(data) ? data.length : 0;
    return { success: true, cancelledCount: count };
  }
}

export const binanceAdapter = new BinanceAdapter();
