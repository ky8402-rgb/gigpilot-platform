import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Candle, Fill, Order, OrderBook, OrderBookLevel } from './types.js';
import { formatBybitError } from './bybitErrors.js';
import { withRetry, TimeoutError } from '../util/retry.js';
import { log, rid } from '../util/requestId.js';

export interface BybitBalanceItem {
  asset: string;
  free: string;
  locked: string;
}

export interface BybitAssetWithUsd {
  asset: string;
  free: number;
  locked: number;
  total: number;
  usdPrice: number;
  usdValue: number;
  allocationPct: number;
  change24hPct?: number;
}

export interface BybitAccountState {
  status: 'CONNECTED' | 'RESTRICTED' | 'DISCONNECTED' | 'ERROR';
  message: string;
  serverIp: string;
  timestamp: string;
  totalEquityUsd: number;
  availableCashUsd: number;
  lockedInOrdersUsd: number;
  spotBalances: BybitAssetWithUsd[];
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

const BYBIT_CONFIG_FILE = path.join(process.cwd(), '.bybit-quant-keys.json');

export class BybitAdapter {
  private apiKey: string = '';
  private apiSecret: string = '';
  private baseUrl: string = 'https://api.bybit.com';
  private serverIp: string = process.env.EC2_HOST && !process.env.EC2_HOST.startsWith('i-') && process.env.EC2_HOST !== '3.222.149.9' && process.env.EC2_HOST !== '65.0.73.85'
    ? process.env.EC2_HOST
    : '35.154.110.156';
  private priceCache: Map<string, { price: number; time: number }> = new Map();
  private lastAccountState: BybitAccountState | null = null;
  private lastAccountFetchTime = 0;
  private timeOffset = 0;

  constructor() {
    let savedKeys: any = {};
    if (fs.existsSync(BYBIT_CONFIG_FILE)) {
      try {
        savedKeys = JSON.parse(fs.readFileSync(BYBIT_CONFIG_FILE, 'utf-8'));
      } catch (e) {
        console.error('Error loading saved Bybit keys:', e);
      }
    }

    this.apiKey = savedKeys.apiKey || process.env.BYBIT_API_KEY || '';
    this.apiSecret = savedKeys.apiSecret || process.env.BYBIT_API_SECRET || '';
    this.baseUrl = 'https://api.bybit.com';

    this.syncServerTime().catch(() => {});
  }

  public getActiveBaseUrl(): string {
    return 'https://api.bybit.com';
  }


  public async syncServerTime(): Promise<number> {
    // Time-sync drives HMAC signatures; a wrong offset here causes 401s on every signed
    // call. Retry transient failures but DO NOT retry permanent ones (non-JSON, 4xx),
    // and surface them in the log instead of silently snapping the offset to zero —
    // the previous behaviour could leave every signed request 4xx'd for an hour.
    try {
      const res = await withRetry(
        () => fetch(`${this.getActiveBaseUrl()}/v5/market/time`),
        { op: 'bybit.syncServerTime', maxAttempts: 3, baseDelayMs: 400, timeoutMs: 4000 }
      );
      if (!res.ok) {
        log.warn(rid(undefined), 'bybit.syncServerTime.nonOk', { status: res.status });
        return this.timeOffset;
      }
      const data = (await res.json()) as any;
      const serverTime = Number(
        data?.time || (data?.result?.timeSecond ? data.result.timeSecond * 1000 : Date.now())
      );
      this.timeOffset = serverTime - Date.now();
    } catch (err) {
      log.error(rid(undefined), 'bybit.syncServerTime.failed', {
        error: err instanceof Error ? err.message : String(err),
        isTimeout: err instanceof TimeoutError
      });
      // Keep the previously-known offset rather than snapping to zero. A wrong-but-stable
      // offset is far less damaging than an unknown one — the next successful sync will
      // heal it.
    }
    return this.timeOffset;
  }

  public getSyncedTimestamp(): number {
    return Date.now() + this.timeOffset;
  }

  public updateCredentials(apiKey: string, apiSecret: string): void {
    this.apiKey = apiKey.trim();
    this.apiSecret = apiSecret.trim();
    this.baseUrl = 'https://api.bybit.com';
    this.saveConfig();
    this.lastAccountState = null;
    this.lastAccountFetchTime = 0;
    this.syncServerTime().catch(() => {});
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(
        BYBIT_CONFIG_FILE,
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
        { mode: 0o600 }
      );
    } catch (e) {
      console.error('Failed to save Bybit config:', e);
    }
  }

  public getKeyMask(): string {
    if (!this.apiKey) return 'NOT_CONFIGURED';
    if (this.apiKey.length <= 8) return '****' + this.apiKey.slice(-4);
    return this.apiKey.slice(0, 4) + '...' + this.apiKey.slice(-4);
  }

  public hasCredentials(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  public normalizeSymbol(sym: string): string {
    let s = (sym || 'BTC/USDT').replace(/[\/\-_]/g, '').toUpperCase();
    if (!s.endsWith('USDT') && !s.endsWith('USDC') && !s.endsWith('USD')) {
      s += 'USDT';
    }
    return s;
  }

  public denormalizeSymbol(sym: string): string {
    const raw = sym.toUpperCase();
    if (raw.endsWith('USDT')) return `${raw.slice(0, -4)}/USDT`;
    if (raw.endsWith('USDC')) return `${raw.slice(0, -4)}/USDC`;
    if (raw.endsWith('USD')) return `${raw.slice(0, -3)}/USD`;
    return raw;
  }

  private signGet(params: Record<string, any>): { headers: Record<string, string>; queryString: string } {
    const timestamp = this.getSyncedTimestamp().toString();
    const recvWindow = '5000';
    const keys = Object.keys(params).sort();
    const queryString = keys.map(k => `${k}=${params[k]}`).join('&');
    const signPayload = `${timestamp}${this.apiKey}${recvWindow}${queryString}`;
    const signature = crypto.createHmac('sha256', this.apiSecret).update(signPayload).digest('hex');

    return {
      headers: {
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Accept': 'application/json'
      },
      queryString
    };
  }

  private signPost(body: Record<string, any>): { headers: Record<string, string>; bodyStr: string } {
    const timestamp = this.getSyncedTimestamp().toString();
    const recvWindow = '5000';
    const bodyStr = JSON.stringify(body);
    const signPayload = `${timestamp}${this.apiKey}${recvWindow}${bodyStr}`;
    const signature = crypto.createHmac('sha256', this.apiSecret).update(signPayload).digest('hex');

    return {
      headers: {
        'X-BAPI-API-KEY': this.apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      bodyStr
    };
  }

  /**
   * Public: Real live ticker price from Bybit V5 Linear Futures
   */
  public async getRealPrice(symbol = 'BTCUSDT'): Promise<number> {
    const raw = this.normalizeSymbol(symbol);
    const cached = this.priceCache.get(raw);
    if (cached && Date.now() - cached.time < 2000) {
      return cached.price;
    }

    try {
      const res = await withRetry(
        () => fetch(`${this.getActiveBaseUrl()}/v5/market/tickers?category=linear&symbol=${raw}`, {
          headers: { 'Accept': 'application/json' }
        }),
        { op: 'bybit.getRealPrice', maxAttempts: 3, baseDelayMs: 200, timeoutMs: 4000 }
      );
      if (res.ok) {
        const json = (await res.json()) as any;
        const item = json?.result?.list?.[0];
        const p = parseFloat(item?.lastPrice);
        if (p > 0) {
          this.priceCache.set(raw, { price: p, time: Date.now() });
          return p;
        }
      } else {
        log.warn(rid(undefined), 'bybit.getRealPrice.nonOk', { symbol: raw, status: res.status });
      }
    } catch (err) {
      log.warn(rid(undefined), 'bybit.getRealPrice.failed', {
        symbol: raw,
        error: err instanceof Error ? err.message : String(err),
        isTimeout: err instanceof TimeoutError
      });
    }

    // Always serve the cache rather than 0 — a stale-but-real price is more honest
    // than no price, and the readiness probe already gates trades on candle freshness.
    return cached?.price || 0;
  }

  /**
   * Public: Real 24h ticker statistics from Bybit V5 Linear Futures
   */
  public async getReal24hStats(symbol = 'BTCUSDT'): Promise<{
    symbol: string;
    price: number;
    open24h: number;
    high24h: number;
    low24h: number;
    volume: number;
    change24hPct: number;
  }> {
    const raw = this.normalizeSymbol(symbol);
    try {
      const res = await withRetry(
        () => fetch(`${this.getActiveBaseUrl()}/v5/market/tickers?category=linear&symbol=${raw}`, {
          headers: { 'Accept': 'application/json' }
        }),
        { op: 'bybit.getReal24hStats', maxAttempts: 3, baseDelayMs: 200, timeoutMs: 4000 }
      );
      if (res.ok) {
        const json = (await res.json()) as any;
        const item = json?.result?.list?.[0];
        if (item) {
          const price = parseFloat(item.lastPrice) || 0;
          const open24h = parseFloat(item.prevPrice24h) || 0;
          const high24h = parseFloat(item.highPrice24h) || 0;
          const low24h = parseFloat(item.lowPrice24h) || 0;
          const volume = parseFloat(item.volume24h) || 0;
          const change24hPct = parseFloat(item.price24hPcnt) * 100 || 0;
          return { symbol: this.denormalizeSymbol(raw), price, open24h, high24h, low24h, volume, change24hPct };
        }
      } else {
        log.warn(rid(undefined), 'bybit.getReal24hStats.nonOk', { symbol: raw, status: res.status });
      }
    } catch (err) {
      log.warn(rid(undefined), 'bybit.getReal24hStats.failed', {
        symbol: raw,
        error: err instanceof Error ? err.message : String(err),
        isTimeout: err instanceof TimeoutError
      });
    }

    return {
      symbol: this.denormalizeSymbol(raw),
      price: 0,
      open24h: 0,
      high24h: 0,
      low24h: 0,
      volume: 0,
      change24hPct: 0
    };
  }

  /**
   * Public: Real Candlesticks from Bybit V5 Linear Futures
   */
  public async getRealCandles(symbol = 'BTCUSDT', interval = '1m', limit = 50): Promise<Candle[]> {
    const raw = this.normalizeSymbol(symbol);
    let intervalParam = '1';
    if (interval === '3m') intervalParam = '3';
    else if (interval === '5m') intervalParam = '5';
    else if (interval === '15m') intervalParam = '15';
    else if (interval === '30m') intervalParam = '30';
    else if (interval === '1h') intervalParam = '60';
    else if (interval === '4h') intervalParam = '240';
    else if (interval === '1d') intervalParam = 'D';

    try {
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/market/kline?category=linear&symbol=${raw}&interval=${intervalParam}&limit=${limit}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const list = json?.result?.list;
        if (Array.isArray(list) && list.length > 0) {
          // Bybit returns newest first, reverse for chronological ascending
          return list.slice().reverse().map((k: any[]) => ({
            timestamp: Number(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
          }));
        }
      }
    } catch {
      // ignore
    }

    return [];
  }

  /**
   * Public: Real Order Book (Depth) from Bybit V5 Linear Futures
   */
  public async getRealOrderBook(symbol = 'BTCUSDT', limit = 15): Promise<OrderBook> {
    const raw = this.normalizeSymbol(symbol);
    const denorm = this.denormalizeSymbol(raw);

    try {
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/market/orderbook?category=linear&symbol=${raw}&limit=${limit}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const result = json?.result;
        if (result && (Array.isArray(result.b) || Array.isArray(result.a))) {
          let cumB = 0;
          let cumA = 0;
          const bids: OrderBookLevel[] = (result.b || []).map((b: any[]) => {
            const price = parseFloat(b[0]);
            const amount = parseFloat(b[1]);
            cumB += amount;
            return { price, amount, total: Number(cumB.toFixed(4)) };
          });
          const asks: OrderBookLevel[] = (result.a || []).map((a: any[]) => {
            const price = parseFloat(a[0]);
            const amount = parseFloat(a[1]);
            cumA += amount;
            return { price, amount, total: Number(cumA.toFixed(4)) };
          });

          const bestBid = bids[0]?.price || 0;
          const bestAsk = asks[0]?.price || 0;
          const spread = bestAsk > bestBid ? Number((bestAsk - bestBid).toFixed(4)) : 0;
          const midPrice = bestAsk && bestBid ? Number(((bestAsk + bestBid) / 2).toFixed(2)) : bestBid || bestAsk;
          const spreadBps = midPrice > 0 ? Number(((spread / midPrice) * 10000).toFixed(2)) : 0;

          return {
            symbol: denorm,
            bids,
            asks,
            spread,
            spreadBps,
            midPrice,
            timestamp: Number(result.ts || Date.now())
          };
        }
      }
    } catch {
      // ignore
    }

    return {
      symbol: denorm,
      bids: [],
      asks: [],
      spread: 0,
      spreadBps: 0,
      midPrice: 0,
      timestamp: Date.now()
    };
  }

  /** Set native TP/SL on a Bybit linear futures position. */
  public async setFuturesTradingStop(symbol: string, takeProfit: number, stopLoss: number, positionIdx?: number): Promise<{ success: boolean; error?: string }> {
    if (!this.apiKey || !this.apiSecret) return { success: false, error: 'Bybit credentials are not configured.' };
    if (!Number.isFinite(takeProfit) || takeProfit <= 0 || !Number.isFinite(stopLoss) || stopLoss <= 0) return { success: false, error: 'Futures TP/SL prices must be positive live values.' };
    const payload: Record<string, any> = { category: 'linear', symbol: this.normalizeSymbol(symbol), tpslMode: 'Full', takeProfit: String(takeProfit), stopLoss: String(stopLoss), tpTriggerBy: 'MarkPrice', slTriggerBy: 'MarkPrice' };
    // Hedge-mode accounts address protection per leg (1 = long, 2 = short). Omitting positionIdx on
    // such an account either rejects the request or applies it to the wrong leg.
    if (Number.isFinite(positionIdx) && Number(positionIdx) !== 0) payload.positionIdx = Number(positionIdx);
    const { headers, bodyStr } = this.signPost(payload);
    const res = await fetch(this.getActiveBaseUrl() + '/v5/position/trading-stop', { method: 'POST', headers, body: bodyStr });
    const json = await res.json() as any;
    if (!res.ok || json?.retCode !== 0) return { success: false, error: json?.retMsg || ('Bybit futures TP/SL update failed: HTTP ' + res.status) };
    return { success: true };
  }

  /**
   * Private Signed: Real Bybit Linear Futures Account balances and portfolio valuation
   * Supports both Unified Trading Account (UTA) and classic Spot wallets
   */
  public async getRealAccountState(forceRefresh = false): Promise<BybitAccountState> {
    if (!forceRefresh && this.lastAccountState && Date.now() - this.lastAccountFetchTime < 6000) {
      return this.lastAccountState;
    }

    if (!this.apiKey || !this.apiSecret) {
      return {
        status: 'DISCONNECTED',
        message: 'Bybit trade-only API key & secret not configured. Please enter your Bybit keys in the panel.',
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
        accountType: 'LINEAR FUTURES / UTA',
        apiKeyConfigured: false,
        keyMask: 'NOT_CONFIGURED',
      };
    }

    try {
      // 1. Query Bybit V5 wallet balance (UNIFIED accountType first, fall back to SPOT if non-UTA)
      let walletList: any[] = [];
      let queryType = 'UNIFIED';
      let signed = this.signGet({ accountType: queryType });
      let res = await fetch(`${this.getActiveBaseUrl()}/v5/account/wallet-balance?${signed.queryString}`, {
        headers: signed.headers
      });

      let json = (await res.json()) as any;

      // If UNIFIED fails or empty, try SPOT
      if (!res.ok || json.retCode !== 0 || !json?.result?.list?.length) {
        queryType = 'SPOT';
        signed = this.signGet({ accountType: queryType });
        res = await fetch(`${this.getActiveBaseUrl()}/v5/account/wallet-balance?${signed.queryString}`, {
          headers: signed.headers
        });
        json = (await res.json()) as any;
      }

      if (!res.ok || json.retCode !== 0) {
        const retMsg = json?.retMsg || `Bybit HTTP ${res.status}`;
        const isIpError = json?.retCode === 10003 || json?.retCode === 10004 || json?.retCode === 10005;
        const msg = isIpError
          ? `Bybit API Auth/IP Error (Code ${json.retCode}): ${retMsg}. Verify IP whitelist (${this.serverIp}) or API key permissions.`
          : `Bybit Account Query Failed: ${retMsg} (Code: ${json?.retCode})`;

        return {
          status: isIpError ? 'RESTRICTED' : 'ERROR',
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
          accountType: queryType,
          apiKeyConfigured: true,
          keyMask: this.getKeyMask(),
        };
      }

      const accountData = json.result.list[0];
      const coinList: any[] = accountData.coin || [];

      let totalEquityUsd = parseFloat(accountData.totalEquity || accountData.totalWalletBalance || '0');
      let availableCashUsd = 0;
      let lockedInOrdersUsd = 0;

      const spotBalances: BybitAssetWithUsd[] = [];

      for (const c of coinList) {
        const free = parseFloat(c.walletBalance || c.free || '0');
        const locked = parseFloat(c.locked || '0');
        const total = free + locked;
        if (total <= 0) continue;

        let usdPrice = parseFloat(c.usdValue || '0');
        let itemUsdVal = usdPrice;

        if (c.coin === 'USDT' || c.coin === 'USDC' || c.coin === 'USD') {
          usdPrice = 1.0;
          itemUsdVal = total;
          availableCashUsd += free;
          lockedInOrdersUsd += locked;
        } else {
          if (itemUsdVal <= 0) {
            const p = await this.getRealPrice(`${c.coin}USDT`);
            usdPrice = p;
            itemUsdVal = total * p;
          }
        }

        spotBalances.push({
          asset: c.coin,
          free,
          locked,
          total,
          usdPrice,
          usdValue: Number(itemUsdVal.toFixed(2)),
          allocationPct: 0
        });
      }

      if (totalEquityUsd <= 0) {
        totalEquityUsd = spotBalances.reduce((sum, b) => sum + b.usdValue, 0);
      }

      // Calculate allocation percentages
      for (const b of spotBalances) {
        b.allocationPct = totalEquityUsd > 0 ? Number(((b.usdValue / totalEquityUsd) * 100).toFixed(2)) : 0;
      }

      spotBalances.sort((a, b) => b.usdValue - a.usdValue);

      // Fetch open orders
      let openOrdersCount = 0;
      try {
        const orders = await this.getRealOpenOrders();
        openOrdersCount = orders.length;
      } catch {
        // ignore
      }

      // Fetch recent trade fills
      let recentTrades: Fill[] = [];
      try {
        recentTrades = await this.getRealTrades(undefined, 50);
      } catch {
        // ignore
      }

      const state: BybitAccountState = {
        status: 'CONNECTED',
        message: 'Connected to Bybit Live Linear Futures/UTA. Real-time balances synchronized.',
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
        canTrade: true,
        canWithdraw: false,
        canDeposit: true,
        accountType: queryType,
        apiKeyConfigured: true,
        keyMask: this.getKeyMask(),
      };

      this.lastAccountState = state;
      this.lastAccountFetchTime = Date.now();
      return state;
    } catch (e: any) {
      return {
        status: 'ERROR',
        message: `Bybit Connection Exception: ${e.message}`,
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
        accountType: 'LINEAR FUTURES / UTA',
        apiKeyConfigured: true,
        keyMask: this.getKeyMask(),
      };
    }
  }

  /**
   * Private Signed: Real Open Orders from Bybit
   */
  public async getRealOpenOrders(symbol?: string): Promise<Order[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const params: Record<string, any> = { category: 'linear' };
    if (symbol) {
      params.symbol = this.normalizeSymbol(symbol);
    }

    const { headers, queryString } = this.signGet(params);
    const res = await fetch(`${this.getActiveBaseUrl()}/v5/order/realtime?${queryString}`, {
      headers
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.retMsg || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as any;
    const rawList = json?.result?.list || [];

    return rawList.map((o: any) => ({
      id: String(o.orderId),
      symbol: this.denormalizeSymbol(o.symbol),
      side: o.side.toUpperCase() as 'BUY' | 'SELL',
      type: o.orderType.toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET',
      price: parseFloat(o.price || '0'),
      amount: parseFloat(o.qty || '0'),
      filledAmount: parseFloat(o.cumExecQty || '0'),
      remainingAmount: parseFloat(o.leavesQty || o.qty || '0'),
      costUsd: parseFloat(o.cumExecValue || '0'),
      status: o.orderStatus === 'New' || o.orderStatus === 'PartiallyFilled' ? 'OPEN' : o.orderStatus,
      isGridOrder: false,
      strategyId: 'LIVE-BYBIT-SPOT',
      mode: 'LIVE',
      feesPaid: parseFloat(o.cumExecFee || '0'),
      slippageBps: 0,
      latencyMs: 20,
      placedAt: new Date(Number(o.createdTime)).toISOString()
    }));
  }

  /**
   * Private Signed: Real trade execution history from Bybit
   */
  public async getRealTrades(symbol?: string, limit = 50): Promise<Fill[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const params: Record<string, any> = { category: 'linear', limit };
    if (symbol) params.symbol = this.normalizeSymbol(symbol);
    const { headers, queryString } = this.signGet(params);
    const res = await fetch(`${this.getActiveBaseUrl()}/v5/execution/list?${queryString}`, {
      headers
    });

    if (!res.ok) return [];
    const json = (await res.json()) as any;
    const list = json?.result?.list || [];

    return Promise.all(list.map(async (t: any) => {
      const feeAmount = Math.max(0, parseFloat(t.execFee || '0') || 0);
      const feeCurrency = String(t.feeCurrency || '').toUpperCase();
      let feeUsd = feeAmount;
      if (feeCurrency && !['USD', 'USDT', 'USDC'].includes(feeCurrency) && feeAmount > 0) {
        const feePrice = await this.getRealPrice(`${feeCurrency}USDT`);
        feeUsd = feePrice > 0 ? feeAmount * feePrice : 0;
      }

      return {
        id: String(t.execId),
        orderId: String(t.orderId),
        symbol: this.denormalizeSymbol(t.symbol),
        side: t.side.toUpperCase() as 'BUY' | 'SELL',
        price: parseFloat(t.execPrice || '0'),
        amount: parseFloat(t.execQty || '0'),
        feeUsd,
        slippageBps: 0,
        realizedPnL: 0,
        timestamp: new Date(Number(t.execTime)).toISOString()
      };
    }));
  }

  /**
   * Private Signed: the account's ACTUAL maker/taker fee rates for a linear symbol.
   * Used in place of the hardcoded assumption so the net-edge gate prices real fees.
   */
  public async getRealFeeRate(symbol?: string): Promise<{ makerBps: number; takerBps: number; source: string } | null> {
    if (!this.apiKey || !this.apiSecret) return null;
    try {
      const params: Record<string, any> = { category: 'linear' };
      if (symbol) params.symbol = this.normalizeSymbol(symbol);
      const { headers, queryString } = this.signGet(params);
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/account/fee-rate?${queryString}`, { headers });
      if (!res.ok) return null;
      const json = await res.json() as any;
      if (json?.retCode !== 0) return null;
      const row = json?.result?.list?.[0];
      const maker = Number(row?.makerFeeRate);
      const taker = Number(row?.takerFeeRate);
      if (!Number.isFinite(maker) || !Number.isFinite(taker)) return null;
      return { makerBps: maker * 1e4, takerBps: taker * 1e4, source: 'BYBIT_ACCOUNT_FEE_RATE' };
    } catch {
      return null;
    }
  }

  /**
   * Public: current funding rate for a linear perpetual, converted to an HOURLY fraction.
   * Replaces the synthetic funding constant previously used in the cost equation.
   */
  public async getRealFundingRate(symbol: string): Promise<number | null> {
    const raw = this.normalizeSymbol(symbol);
    try {
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/market/tickers?category=linear&symbol=${raw}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return null;
      const json = await res.json() as any;
      const item = json?.result?.list?.[0];
      const rate = Number(item?.fundingRate);
      if (!Number.isFinite(rate)) return null;
      // Bybit quotes the rate per funding interval (8h on linear); normalise to per-hour.
      const intervalHours = Number(item?.fundingIntervalHour) > 0 ? Number(item.fundingIntervalHour) : 8;
      return rate / intervalHours;
    } catch {
      return null;
    }
  }

  /**
   * Private Signed: funding actually settled on futures positions since a timestamp, summed from
   * the account transaction log. This is the authoritative funding cost — the rate x horizon figure
   * used for forward-looking decisions is only an estimate.
   */
  public async getRealFundingSummary(sinceMs: number): Promise<{ netFundingUsd: number; fundingPaidUsd: number; fundingReceivedUsd: number; entries: number; source: string } | null> {
    if (!this.apiKey || !this.apiSecret) return null;
    try {
      const params: Record<string, any> = {
        accountType: 'UNIFIED',
        category: 'linear',
        type: 'SETTLEMENT',
        startTime: Math.max(0, Math.floor(sinceMs)),
        limit: 100
      };
      const { headers, queryString } = this.signGet(params);
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/account/transaction-log?${queryString}`, { headers });
      if (!res.ok) return null;
      const json = await res.json() as any;
      if (json?.retCode !== 0) return null;
      const list = json?.result?.list;
      if (!Array.isArray(list)) return null;

      // Gross paid and received are tracked separately: netting them would understate the cost of
      // funding when a window happens to contain both payments and receipts.
      let fundingPaidUsd = 0;
      let fundingReceivedUsd = 0;
      for (const row of list) {
        const cashFlow = Number(row?.cashFlow);
        if (!Number.isFinite(cashFlow)) continue;
        if (cashFlow < 0) fundingPaidUsd += Math.abs(cashFlow);
        else fundingReceivedUsd += cashFlow;
      }
      return {
        netFundingUsd: Number((fundingReceivedUsd - fundingPaidUsd).toFixed(6)),
        fundingPaidUsd: Number(fundingPaidUsd.toFixed(6)),
        fundingReceivedUsd: Number(fundingReceivedUsd.toFixed(6)),
        entries: list.length,
        source: 'BYBIT_TRANSACTION_LOG'
      };
    } catch {
      return null;
    }
  }

  /** Set the exchange leverage for a linear USDT perpetual before any autonomous entry. */
  public async setFuturesLeverage(symbol: string, leverage: number): Promise<{ success: boolean; error?: string }> {
    if (!this.apiKey || !this.apiSecret) return { success: false, error: 'Bybit credentials are not configured.' };
    if (!Number.isFinite(leverage) || leverage < 1) return { success: false, error: 'Futures leverage must be at least 1x.' };
    const payload = { category: 'linear', symbol: this.normalizeSymbol(symbol), buyLeverage: String(leverage), sellLeverage: String(leverage) };
    const { headers, bodyStr } = this.signPost(payload);
    const res = await fetch(this.getActiveBaseUrl() + '/v5/position/set-leverage', { method: 'POST', headers, body: bodyStr });
    const json = await res.json() as any;
    if (!res.ok || json?.retCode !== 0) return { success: false, error: json?.retMsg || ('Bybit leverage update failed: HTTP ' + res.status) };
    return { success: true };
  }

  /**
   * Private Signed: Real Bybit linear futures positions.
   * Position size is signed: positive=LONG, negative=SHORT.
   */
  public async getRealPositions(symbol?: string): Promise<Array<{
    symbol: string;
    baseAmount: number;
    quoteAmount: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnL: number;
    unrealizedPnLPct: number;
    realizedPnL: number;
    totalFeesPaid: number;
    netPnL: number;
    liquidationPrice?: number;
    leverage?: number;
  }>> {
    if (!this.apiKey || !this.apiSecret) return [];
    const params: Record<string, any> = { category: 'linear', settleCoin: 'USDT' };
    if (symbol) params.symbol = this.normalizeSymbol(symbol);
    const { headers, queryString } = this.signGet(params);
    const res = await fetch(this.getActiveBaseUrl() + '/v5/position/list?' + queryString, { headers });
    const json = await res.json() as any;
    if (!res.ok || json?.retCode !== 0) {
      throw new Error(json?.retMsg || ('Bybit position query failed: HTTP ' + res.status));
    }
    return (json?.result?.list || []).map((p: any) => {
      const size = Number(p.size || 0);
      const entryPrice = Number(p.avgPrice || p.entryPrice || 0);
      const markPrice = Number(p.markPrice || 0);
      const unrealizedPnL = Number(p.unrealisedPnl || p.unrealizedPnl || 0);
      const realizedPnL = Number(p.curRealisedPnl || p.cumRealisedPnl || 0);
      const positionValue = Number(p.positionValue || (size * markPrice) || 0);
      const signedSize = String(p.side || '').toUpperCase() === 'SHORT' ? -size : size;
      const cost = Math.abs(positionValue);
      const unrealizedPnLPct = cost > 0 ? (unrealizedPnL / cost) * 100 : 0;
      return {
        symbol: this.denormalizeSymbol(String(p.symbol || '')),
        baseAmount: signedSize,
        quoteAmount: positionValue,
        entryPrice,
        currentPrice: markPrice,
        unrealizedPnL,
        unrealizedPnLPct,
        realizedPnL,
        totalFeesPaid: 0,
        netPnL: unrealizedPnL + realizedPnL,
        liquidationPrice: Number(p.liqPrice || 0) || undefined,
        leverage: Number(p.leverage || 0) || undefined,
        // Read back so protection can be verified instead of blindly re-sent every cycle, and so
        // hedge-mode accounts can address the correct position leg (positionIdx 1=long, 2=short).
        takeProfit: Number(p.takeProfit || 0) || undefined,
        stopLoss: Number(p.stopLoss || 0) || undefined,
        positionIdx: Number.isFinite(Number(p.positionIdx)) ? Number(p.positionIdx) : undefined
      };
    }).filter((p: any) => Math.abs(p.baseAmount) > 0);
  }

  /**
   * Symbol precision and step rules for Bybit Linear Futures
   */
  public getSymbolRules(symbol: string): { priceDecimals: number; qtyDecimals: number; minNotional: number } {
    const norm = this.normalizeSymbol(symbol);
    if (norm.startsWith('BTC')) return { priceDecimals: 2, qtyDecimals: 5, minNotional: 5.0 };
    if (norm.startsWith('ETH')) return { priceDecimals: 2, qtyDecimals: 4, minNotional: 5.0 };
    if (norm.startsWith('SOL')) return { priceDecimals: 2, qtyDecimals: 3, minNotional: 5.0 };
    if (norm.startsWith('BNB')) return { priceDecimals: 2, qtyDecimals: 3, minNotional: 5.0 };
    if (norm.startsWith('AVAX')) return { priceDecimals: 2, qtyDecimals: 2, minNotional: 5.0 };
    return { priceDecimals: 2, qtyDecimals: 4, minNotional: 5.0 };
  }

  /**
   * Private Signed: Place real spot order on Bybit
   */
  public async placeRealOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    price?: number;
    quantity: number;
    orderLinkId?: string;
  }): Promise<{ success: boolean; orderId?: string; orderLinkId?: string; error?: string; raw?: any }> {
    if (!this.apiKey || !this.apiSecret) {
      return { success: false, error: 'Bybit API credentials missing. Please configure your API key & secret.' };
    }

    const rules = this.getSymbolRules(params.symbol);
    const formattedQty = Number(params.quantity.toFixed(rules.qtyDecimals));
    if (formattedQty <= 0) {
      return {
        success: false,
        error: `Order quantity (${params.quantity}) must be at least ${Math.pow(10, -rules.qtyDecimals)} for ${params.symbol}`
      };
    }

    // Client-side unique idempotency key (prevents double execution on network retry)
    const orderLinkId = params.orderLinkId || `gp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const payload: Record<string, any> = {
      category: 'linear',
      symbol: this.normalizeSymbol(params.symbol),
      side: params.side === 'BUY' ? 'Buy' : 'Sell',
      orderType: params.type === 'MARKET' ? 'Market' : 'Limit',
      qty: formattedQty.toString(),
      orderLinkId
    };

    if (params.type === 'LIMIT') {
      if (!params.price || params.price <= 0) {
        return { success: false, error: 'Valid price is required for LIMIT orders' };
      }
      const formattedPrice = Number(params.price.toFixed(rules.priceDecimals));
      payload.price = formattedPrice.toString();
      payload.timeInForce = 'GTC';

      const notional = formattedPrice * formattedQty;
      if (notional < rules.minNotional) {
        return {
          success: false,
          error: `Order value ($${notional.toFixed(2)}) is below Bybit minimum notional of $${rules.minNotional.toFixed(2)} USD`
        };
      }
    }

    try {
      const { headers, bodyStr } = this.signPost(payload);
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/order/create`, {
        method: 'POST',
        headers,
        body: bodyStr
      });

      const json = (await res.json()) as any;

      if (!res.ok || json.retCode !== 0) {
        const errorMsg = formatBybitError(json?.retCode, json?.retMsg || `HTTP ${res.status}`);
        return { success: false, error: errorMsg, raw: json };
      }

      return {
        success: true,
        orderId: json.result?.orderId || json.result?.orderLinkId,
        orderLinkId: json.result?.orderLinkId || orderLinkId,
        raw: json.result
      };
    } catch (e: any) {
      return { success: false, error: `Bybit Order Dispatch Failed: ${e.message}` };
    }
  }

  /**
   * Private Signed: Cancel single order on Bybit
   */
  public async cancelOrder(symbol: string, orderId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.apiKey || !this.apiSecret) {
      return { success: false, error: 'Bybit API credentials missing.' };
    }

    try {
      const payload: Record<string, any> = {
        category: 'linear',
        symbol: this.normalizeSymbol(symbol)
      };
      if (orderId.startsWith('gp_')) {
        payload.orderLinkId = orderId;
      } else {
        payload.orderId = orderId;
      }

      const { headers, bodyStr } = this.signPost(payload);
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/order/cancel`, {
        method: 'POST',
        headers,
        body: bodyStr
      });

      const json = (await res.json()) as any;
      if (!res.ok || json.retCode !== 0) {
        return { success: false, error: formatBybitError(json?.retCode, json?.retMsg || `HTTP ${res.status}`) };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
  public async createSpotWithdrawal(params: {
    coin: string;
    amount: number;
    address: string;
    chain: string;
    requestId: string;
    accountType?: 'FUND' | 'UTA' | 'EARN';
  }): Promise<{ success: boolean; withdrawId?: string; txId?: string; error?: string }> {
    if (!this.hasCredentials()) return { success: false, error: 'Bybit credentials are not configured.' };
    if (!Number.isFinite(params.amount) || params.amount <= 0) return { success: false, error: 'Withdrawal amount must be positive.' };
    if (!params.address || !params.chain || !params.coin || !params.requestId) return { success: false, error: 'Withdrawal coin, chain, address and requestId are required.' };

    const body = {
      coin: params.coin.toUpperCase(),
      chain: params.chain.toUpperCase(),
      address: params.address,
      amount: String(params.amount),
      timestamp: this.getSyncedTimestamp(),
      accountType: params.accountType || 'FUND',
      requestId: params.requestId
    };
    try {
      const signed = this.signPost(body);
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/asset/withdraw/create`, {
        method: 'POST',
        headers: signed.headers,
        body: signed.bodyStr
      });
      const json = await res.json() as any;
      if (!res.ok || json?.retCode !== 0) {
        return { success: false, error: formatBybitError(Number(json?.retCode), json?.retMsg || `HTTP ${res.status}`) };
      }
      return {
        success: true,
        withdrawId: json?.result?.id || json?.result?.withdrawId,
        txId: json?.result?.txID
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Bybit withdrawal request failed.' };
    }
  }

  public async queryWithdrawalRecords(params: { withdrawId?: string; coin?: string; limit?: number }): Promise<Array<{
    withdrawId: string;
    txId: string;
    status: string;
    amount: number;
    fee: number;
    address: string;
    coin: string;
    chain: string;
  }>> {
    if (!this.hasCredentials()) return [];
    const query: Record<string, any> = { accountType: 'FUND', limit: params.limit || 50 };
    if (params.withdrawId) query.withdrawId = params.withdrawId;
    if (params.coin) query.coin = params.coin.toUpperCase();
    try {
      const signed = this.signGet(query);
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/asset/withdraw/query-record?${signed.queryString}`, {
        headers: signed.headers
      });
      const json = await res.json() as any;
      if (!res.ok || json?.retCode !== 0) return [];
      return (json?.result?.rows || []).map((row: any) => ({
        withdrawId: String(row.withdrawId || row.id || ''),
        txId: String(row.txID || ''),
        status: String(row.status || ''),
        amount: Number(row.amount || 0),
        fee: Number(row.withdrawFee || row.fee || 0),
        address: String(row.address || ''),
        coin: String(row.coin || ''),
        chain: String(row.chain || '')
      }));
    } catch {
      return [];
    }
  }

}

export const bybitAdapter = new BybitAdapter();
