import crypto from 'crypto';
import { Candle, Fill, Order, OrderBook, OrderBookLevel } from './types.js';

export interface BinanceBalanceItem {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceTransaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE' | 'FEE';
  asset: string;
  amount: number;
  valueUsd: number;
  status: string;
  timestamp: string;
  orderId?: string;
  tradeId?: string;
  txId?: string;
  symbol?: string;
  side?: 'BUY' | 'SELL';
  feeUsd?: number;
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
  withdrawableProfitUsd: number;
  initialTradingCapitalUsd: number;
  profitReserveBufferUsd: number;
  spotBalances: BinanceAssetWithUsd[];
  realizedProfitUsd: number;
  unrealizedProfitUsd: number;
  todayPnLUsd: number;
  todayPnLPct: number;
  openOrdersCount: number;
  recentTrades: Fill[];
  transactions: BinanceTransaction[];
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType: string;
  apiKeyConfigured: boolean;
  keyMask: string;
}

export class BinanceAdapter {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string = 'https://api.binance.com';
  private serverIp: string = '3.222.149.9';
  private priceCache: Map<string, { price: number; time: number }> = new Map();
  private lastAccountState: BinanceAccountState | null = null;
  private lastAccountFetchTime = 0;

  constructor() {
    // Credentials are loaded only from environment/secret injection.
    // Never persist Binance API secrets to the application filesystem.
    this.apiKey = process.env.BINANCE_API_KEY || '';
    this.apiSecret = process.env.BINANCE_API_SECRET || '';
    if (process.env.BINANCE_API_BASE_URL) this.baseUrl = process.env.BINANCE_API_BASE_URL;
  }

  public updateCredentials(apiKey: string, apiSecret: string, baseUrl?: string): void {
    this.apiKey = apiKey.trim();
    this.apiSecret = apiSecret.trim();
    if (baseUrl) this.baseUrl = baseUrl.trim();
    this.lastAccountFetchTime = 0; // Force refresh
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

  private getInitialTradingCapitalUsd(): number {
    const n = Number(process.env.INITIAL_TRADING_CAPITAL_USD);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private getProfitReserveBufferUsd(): number {
    const n = Number(process.env.PROFIT_RESERVE_BUFFER_USD);
    return Number.isFinite(n) && n >= 0 ? n : 0;
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
        withdrawableProfitUsd: 0,
        initialTradingCapitalUsd: this.getInitialTradingCapitalUsd(),
        profitReserveBufferUsd: this.getProfitReserveBufferUsd(),
        spotBalances: [],
        realizedProfitUsd: 0,
        unrealizedProfitUsd: 0,
        todayPnLUsd: 0,
        todayPnLPct: 0,
        openOrdersCount: 0,
        recentTrades: [],
        transactions: [],
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
          withdrawableProfitUsd: 0,
          initialTradingCapitalUsd: this.getInitialTradingCapitalUsd(),
          profitReserveBufferUsd: this.getProfitReserveBufferUsd(),
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
      const changeMap: Record<string, number> = {};
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
          const tickerRes = await fetch(`${this.baseUrl}/api/v3/ticker/24hr`);
          if (tickerRes.ok) {
            const allPrices = (await tickerRes.json()) as Array<{ symbol: string; price: string; lastPrice?: string; priceChangePercent?: string }>;
            for (const item of allPrices) {
              for (const asset of cryptoAssetsToPrice) {
                if (item.symbol === `${asset}USDT` || item.symbol === `${asset}FDUSD`) {
                  priceMap[asset] = parseFloat(item.lastPrice || item.price);
                  if (item.priceChangePercent != null) changeMap[asset] = parseFloat(item.priceChangePercent);
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
          allocationPct: 0,
          change24hPct: changeMap[b.asset] ?? 0
        };
      });

      const initialTradingCapitalUsd = this.getInitialTradingCapitalUsd();
      const profitReserveBufferUsd = this.getProfitReserveBufferUsd();
      const withdrawableProfitUsd = initialTradingCapitalUsd > 0
        ? Math.max(0, totalEquityUsd - initialTradingCapitalUsd - profitReserveBufferUsd)
        : 0;

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
        withdrawableProfitUsd: Number(withdrawableProfitUsd.toFixed(2)),
        initialTradingCapitalUsd,
        profitReserveBufferUsd,
        availableCashUsd: Number(availableCashUsd.toFixed(2)),
        lockedInOrdersUsd: Number(lockedInOrdersUsd.toFixed(2)),
        spotBalances,
        realizedProfitUsd: 0,
        unrealizedProfitUsd: 0,
        todayPnLUsd: 0,
        todayPnLPct: 0,
        openOrdersCount,
        recentTrades,
        transactions: await this.getTransactionHistory(spotBalances),
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
        withdrawableProfitUsd: 0,
        initialTradingCapitalUsd: this.getInitialTradingCapitalUsd(),
        profitReserveBufferUsd: this.getProfitReserveBufferUsd(),
        spotBalances: [],
        realizedProfitUsd: 0,
        unrealizedProfitUsd: 0,
        todayPnLUsd: 0,
        todayPnLPct: 0,
        openOrdersCount: 0,
        recentTrades: [],
        transactions: [],
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
  public async getTransactionHistory(assets: BinanceAssetWithUsd[] = []): Promise<BinanceTransaction[]> {
    if (!this.apiKey || !this.apiSecret) return [];
    const transactions: BinanceTransaction[] = [];
    const now = Date.now();
    const startTime = now - 30 * 24 * 60 * 60 * 1000;

    const signedGet = async (pathName: string, params: Record<string, any> = {}) => {
      const { queryString, signature } = this.signQuery(params);
      const res = await fetch(`${this.baseUrl}${pathName}?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': this.apiKey, 'User-Agent': 'GigPilot-Quant/2.5' }
      });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    };

    try {
      const deposits = await signedGet('/sapi/v1/capital/deposit/hisrec', { startTime, limit: 100 });
      if (Array.isArray(deposits)) for (const d of deposits) {
        transactions.push({
          id: `deposit:${d.id || d.txId || d.insertTime}`,
          type: 'DEPOSIT',
          asset: String(d.coin || ''),
          amount: Number(d.amount || 0),
          valueUsd: Number(d.amount || 0),
          status: String(d.status ?? 'UNKNOWN'),
          timestamp: new Date(Number(d.insertTime || d.completeTime || now)).toISOString(),
          txId: d.txId ? String(d.txId) : undefined
        });
      }
    } catch {}

    try {
      const withdrawals = await signedGet('/sapi/v1/capital/withdraw/history', { startTime, limit: 100 });
      if (Array.isArray(withdrawals)) for (const w of withdrawals) {
        transactions.push({
          id: `withdrawal:${w.id || w.txId || w.applyTime}`,
          type: 'WITHDRAWAL',
          asset: String(w.coin || ''),
          amount: Number(w.amount || 0),
          valueUsd: Number(w.amount || 0),
          status: String(w.status ?? 'UNKNOWN'),
          timestamp: new Date(w.applyTime || now).toISOString(),
          txId: w.txId ? String(w.txId) : undefined
        });
      }
    } catch {}

    const symbols = assets
      .filter(a => a.usdValue > 0 && !['USDT','USDC','FDUSD','USD','BUSD'].includes(a.asset))
      .slice(0, 12)
      .map(a => `${a.asset}USDT`);

    const tradeResults = await Promise.all(symbols.map(async (symbol) => {
      try {
        const list = await signedGet('/api/v3/myTrades', { symbol, startTime, limit: 100 });
        return Array.isArray(list) ? list : [];
      } catch { return []; }
    }));

    for (const list of tradeResults) for (const t of list) {
      const price = Number(t.price || 0);
      const qty = Number(t.qty || 0);
      transactions.push({
        id: `trade:${t.id}`,
        type: 'TRADE',
        asset: String(t.commissionAsset || ''),
        amount: qty,
        valueUsd: price * qty,
        status: 'FILLED',
        timestamp: new Date(Number(t.time || now)).toISOString(),
        orderId: String(t.orderId),
        tradeId: String(t.id),
        symbol: this.denormalizeSymbol(String(t.symbol || '')),
        side: t.isBuyer ? 'BUY' : 'SELL',
        feeUsd: Number(t.commission || 0)
      });
    }

    return transactions
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 200);
  }

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
   * Private Signed: Withdraw USDT from Binance Spot to the owner wallet.
   * Disabled unless ENABLE_REAL_WITHDRAWALS=true and the API key has withdrawal permission.
   */
  public async withdrawUSDT(params: {
    amount: number;
    address: string;
    network: 'ETH' | 'MATIC' | 'SOL';
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    if (process.env.ENABLE_REAL_WITHDRAWALS !== 'true') {
      return { success: false, error: 'Real withdrawals are disabled. Set ENABLE_REAL_WITHDRAWALS=true to explicitly enable them.' };
    }
    if (!this.apiKey || !this.apiSecret) {
      return { success: false, error: 'Binance API credentials missing.' };
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return { success: false, error: 'Withdrawal amount must be a positive finite number.' };
    }
    if (params.network === 'SOL' && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(params.address)) {
      return { success: false, error: 'Invalid Solana destination address.' };
    }
    if (params.network !== 'SOL' && !/^0x[a-fA-F0-9]{40}$/.test(params.address)) {
      return { success: false, error: 'Invalid EVM destination address.' };
    }

    const { queryString, signature } = this.signQuery({
      coin: 'USDT',
      address: params.address,
      amount: params.amount.toFixed(6),
      network: params.network
    });

    const res = await fetch(`${this.baseUrl}/sapi/v1/capital/withdraw/apply?${queryString}&signature=${signature}`, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'User-Agent': 'GigPilot-Quant/2.5'
      }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      return { success: false, error: data.msg || `HTTP ${res.status}` };
    }

    return { success: true, id: String(data.id) };
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
