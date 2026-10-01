import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Candle, Fill, Order, OrderBook, OrderBookLevel, Position } from './types.js';
import { formatBybitError } from './bybitErrors.js';

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
  positions?: Position[];
  category?: 'linear';
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
    try {
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/market/time`);
      if (res.ok) {
        const data = (await res.json()) as any;
        const serverTime = Number(data?.time || (data?.result?.timeSecond ? data.result.timeSecond * 1000 : Date.now()));
        this.timeOffset = serverTime - Date.now();
      }
    } catch {
      this.timeOffset = 0;
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
        )
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
   * Safe Secret Masking Helper: Ensures no API key, secret, or HMAC signature ever leaks into error logs
   */
  public sanitizeSecrets(text: string): string {
    if (!text) return '';
    let sanitized = String(text);
    if (this.apiSecret) {
      sanitized = sanitized.split(this.apiSecret).join('[REDACTED_SECRET]');
    }
    if (this.apiKey) {
      sanitized = sanitized.split(this.apiKey).join(this.getKeyMask());
    }
    sanitized = sanitized.replace(/[a-f0-9]{64}/gi, '[SIGNATURE_REDACTED]');
    return sanitized;
  }

  /**
   * Robust Signed Request Dispatcher with Exponential Backoff Retries & Secret Scrubbing
   */
  public async fetchSignedWithRetry<T = any>(
    method: 'GET' | 'POST',
    endpoint: string,
    payload: Record<string, any>,
    options?: {
      maxRetries?: number;
      baseDelayMs?: number;
      timeoutMs?: number;
      label?: string;
    }
  ): Promise<{
    ok: boolean;
    status: number;
    retCode: number;
    retMsg: string;
    result?: T;
    raw?: any;
    attempts: number;
  }> {
    if (!this.apiKey || !this.apiSecret) {
      return {
        ok: false,
        status: 401,
        retCode: 10003,
        retMsg: 'Bybit credentials missing or unconfigured.',
        attempts: 0
      };
    }

    const maxRetries = options?.maxRetries ?? 3;
    const baseDelayMs = options?.baseDelayMs ?? 250;
    const timeoutMs = options?.timeoutMs ?? 5000;

    let lastError: any = null;
    let attempts = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      attempts = attempt;
      try {
        let url = `${this.getActiveBaseUrl()}${endpoint}`;
        let fetchOptions: RequestInit;

        if (method === 'GET') {
          const { headers, queryString } = this.signGet(payload);
          if (queryString) url += `?${queryString}`;
          fetchOptions = {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(timeoutMs)
          };
        } else {
          const { headers, bodyStr } = this.signPost(payload);
          fetchOptions = {
            method: 'POST',
            headers,
            body: bodyStr,
            signal: AbortSignal.timeout(timeoutMs)
          };
        }

        const res = await fetch(url, fetchOptions);
        const json = await res.json().catch(() => null);

        const retCode = Number(json?.retCode ?? (res.ok ? 0 : -1));
        const rawRetMsg = String(json?.retMsg || `HTTP ${res.status}`);
        const retMsg = this.sanitizeSecrets(rawRetMsg);

        // Check Bybit Success
        if (res.ok && retCode === 0) {
          return {
            ok: true,
            status: res.status,
            retCode: 0,
            retMsg: 'OK',
            result: json?.result as T,
            raw: json,
            attempts
          };
        }

        // Retryable error check:
        // HTTP 429 (Rate limit) or 5xx (Gateway/server error) or Bybit transient codes:
        // 10006: Too many visits
        // 10018: Rate limit reached
        // 10016: Server error
        const isRateLimit = res.status === 429 || retCode === 10006 || retCode === 10018;
        const isServerError = res.status >= 500 || retCode === 10016;
        const isRetryable = isRateLimit || isServerError;

        if (!isRetryable || attempt === maxRetries) {
          const errorMsg = formatBybitError(retCode, retMsg);
          return {
            ok: false,
            status: res.status,
            retCode,
            retMsg: this.sanitizeSecrets(errorMsg),
            raw: json,
            attempts
          };
        }

        // Exponential backoff with jitter
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 50);
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (err: any) {
        lastError = err;
        if (attempt === maxRetries) break;
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const sanitizedErrMsg = this.sanitizeSecrets(lastError?.message || 'Network dispatch timeout / failure');
    return {
      ok: false,
      status: 504,
      retCode: -1,
      retMsg: sanitizedErrMsg,
      attempts
    };
  }

  /**
   * Public: Real live ticker price from Bybit V5 Perpetual Futures (Linear)
   */
  public async getRealPrice(symbol = 'BTCUSDT'): Promise<number> {
    const raw = this.normalizeSymbol(symbol);
    const cached = this.priceCache.get(raw);
    if (cached && Date.now() - cached.time < 2000) {
      return cached.price;
    }

    try {
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/market/tickers?category=linear&symbol=${raw}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const item = json?.result?.list?.[0];
        const p = parseFloat(item?.lastPrice);
        if (p > 0) {
          this.priceCache.set(raw, { price: p, time: Date.now() });
          return p;
        }
      }
    } catch {
      // ignore
    }

    return cached?.price || 0;
  }

  /**
   * Public: Real authoritative Bybit V5 Perpetual Futures funding rate & next funding time
   */
  public async getRealFuturesFundingRate(symbol = 'BTCUSDT'): Promise<{
    symbol: string;
    fundingRateBps: number;
    fundingRateRaw: string;
    nextFundingTime: number;
    markPrice: number;
    indexPrice: number;
  }> {
    const raw = this.normalizeSymbol(symbol);
    try {
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/market/tickers?category=linear&symbol=${raw}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        const item = json?.result?.list?.[0];
        if (item) {
          const rawRate = item.fundingRate ? String(item.fundingRate) : '0';
          const fundingRateBps = Number((parseFloat(rawRate) * 10000).toFixed(4));
          const nextFundingTime = Number(item.nextFundingTime) || 0;
          const markPrice = parseFloat(item.markPrice) || 0;
          const indexPrice = parseFloat(item.indexPrice) || 0;
          return {
            symbol: this.denormalizeSymbol(raw),
            fundingRateBps,
            fundingRateRaw: rawRate,
            nextFundingTime,
            markPrice,
            indexPrice
          };
        }
      }
    } catch {
      // ignore
    }
    return {
      symbol: this.denormalizeSymbol(raw),
      fundingRateBps: 0,
      fundingRateRaw: '0',
      nextFundingTime: 0,
      markPrice: 0,
      indexPrice: 0
    };
  }

  /**
   * Public: Real 24h ticker statistics from Bybit V5 Perpetual Futures (Linear)
   */
  public async getReal24hStats(symbol = 'BTCUSDT'): Promise<{
    symbol: string;
    price: number;
    open24h: number;
    high24h: number;
    low24h: number;
    volume: number;
    change24hPct: number;
    fundingRateBps?: number;
    markPrice?: number;
  }> {
    const raw = this.normalizeSymbol(symbol);
    try {
      const res = await fetch(`${this.getActiveBaseUrl()}/v5/market/tickers?category=linear&symbol=${raw}`, {
        headers: { 'Accept': 'application/json' }
      });
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
          const fundingRateBps = item.fundingRate != null ? Number((parseFloat(item.fundingRate) * 10000).toFixed(4)) : undefined;
          const markPrice = item.markPrice != null ? parseFloat(item.markPrice) : undefined;
          return { symbol: this.denormalizeSymbol(raw), price, open24h, high24h, low24h, volume, change24hPct, fundingRateBps, markPrice };
        }
      }
    } catch {
      // ignore
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
   * Public: Real Candlesticks from Bybit V5 Perpetual Futures (Linear)
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
   * Public: Real Order Book (Depth) from Bybit V5 Perpetual Futures (Linear)
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

  /**
   * Private Signed: Real Bybit Spot Account balances and portfolio valuation
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
        accountType: 'SPOT / UTA',
        apiKeyConfigured: false,
        keyMask: 'NOT_CONFIGURED',
      };
    }

    try {
      // 1. Query Bybit V5 wallet balance (UNIFIED accountType first, fall back to SPOT if non-UTA)
      let queryType = 'UNIFIED';
      let callRes = await this.fetchSignedWithRetry<any>('GET', '/v5/account/wallet-balance', { accountType: queryType }, {
        label: 'getRealAccountState UNIFIED',
        maxRetries: 2
      });

      // If UNIFIED fails or returns empty, try SPOT
      if (!callRes.ok || !callRes.result?.list?.length) {
        queryType = 'SPOT';
        callRes = await this.fetchSignedWithRetry<any>('GET', '/v5/account/wallet-balance', { accountType: queryType }, {
          label: 'getRealAccountState SPOT',
          maxRetries: 2
        });
      }

      if (!callRes.ok || !callRes.result?.list?.length) {
        const retMsg = callRes.retMsg || 'Unable to retrieve wallet balance';
        const isIpError = callRes.retCode === 10003 || callRes.retCode === 10004 || callRes.retCode === 10005;
        const msg = isIpError
          ? `Bybit API Auth/IP Error (Code ${callRes.retCode}): ${retMsg}. Verify IP whitelist (${this.serverIp}) or API key permissions.`
          : `Bybit Account Query Failed: ${retMsg} (Code: ${callRes.retCode})`;

        return {
          status: isIpError ? 'RESTRICTED' : 'ERROR',
          message: this.sanitizeSecrets(msg),
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

      const accountData = callRes.result.list[0];
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

      // Fetch live linear futures positions
      let positions: Position[] = [];
      try {
        positions = await this.getRealPositions();
      } catch {
        // ignore
      }

      const unrealizedProfitUsd = Number(positions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0).toFixed(2));
      const realizedProfitUsd = Number(positions.reduce((sum, p) => sum + (p.realizedPnL || 0), 0).toFixed(2));

      const state: BybitAccountState = {
        status: 'CONNECTED',
        message: 'Connected to Bybit Live Perpetual Futures (Linear V5). Real-time contracts & balances synchronized.',
        serverIp: this.serverIp,
        timestamp: new Date().toISOString(),
        totalEquityUsd: Number(totalEquityUsd.toFixed(2)),
        availableCashUsd: Number(availableCashUsd.toFixed(2)),
        lockedInOrdersUsd: Number(lockedInOrdersUsd.toFixed(2)),
        spotBalances,
        positions,
        category: 'linear',
        realizedProfitUsd,
        unrealizedProfitUsd,
        todayPnLUsd: Number((realizedProfitUsd + unrealizedProfitUsd).toFixed(2)),
        todayPnLPct: totalEquityUsd > 0 ? Number((((realizedProfitUsd + unrealizedProfitUsd) / totalEquityUsd) * 100).toFixed(2)) : 0,
        openOrdersCount,
        recentTrades,
        canTrade: true,
        canWithdraw: false,
        canDeposit: true,
        accountType: 'FUTURES / UTA (category: linear)',
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
        positions: [],
        category: 'linear',
        realizedProfitUsd: 0,
        unrealizedProfitUsd: 0,
        todayPnLUsd: 0,
        todayPnLPct: 0,
        openOrdersCount: 0,
        recentTrades: [],
        canTrade: false,
        canWithdraw: false,
        canDeposit: false,
        accountType: 'FUTURES / UTA (category: linear)',
        apiKeyConfigured: true,
        keyMask: this.getKeyMask(),
      };
    }
  }

  /**
   * Private Signed: Real Bybit V5 Linear Perpetual Futures Positions
   */
  public async getRealPositions(symbol?: string): Promise<Position[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const params: Record<string, any> = { category: 'linear', settleCoin: 'USDT' };
    if (symbol) {
      params.symbol = this.normalizeSymbol(symbol);
    }

    try {
      const callRes = await this.fetchSignedWithRetry<any>('GET', '/v5/position/list', params, { label: 'getRealPositions' });
      if (!callRes.ok || !callRes.result) return [];

      const rawList = callRes.result?.list || [];
      const activePositions = rawList.filter((p: any) => parseFloat(p.size || '0') > 0);
      return activePositions.map((p: any) => {
        const size = parseFloat(p.size || '0');
        const entryPrice = parseFloat(p.avgPrice || p.entryPrice || '0');
        const markPrice = parseFloat(p.markPrice || '0');
        const unrealizedPnL = parseFloat(p.unrealisedPnl || '0');
        const cumRealisedPnl = parseFloat(p.cumRealisedPnl || '0');
        const liqPrice = parseFloat(p.liqPrice || '0') || undefined;
        const leverage = parseFloat(p.leverage || '1');
        const notional = parseFloat(p.positionValue || '0') || (size * (markPrice || entryPrice));
        const side = p.side === 'Buy' ? 'Buy' : (p.side === 'Sell' ? 'Sell' : 'None');

        return {
          symbol: this.denormalizeSymbol(p.symbol),
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
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Private Signed: Real Open Orders from Bybit Perpetual Futures (Linear)
   */
  public async getRealOpenOrders(symbol?: string): Promise<Order[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const params: Record<string, any> = { category: 'linear' };
    if (symbol) {
      params.symbol = this.normalizeSymbol(symbol);
    }

    const callRes = await this.fetchSignedWithRetry<any>('GET', '/v5/order/realtime', params, { label: 'getRealOpenOrders' });
    if (!callRes.ok || !callRes.result) {
      throw new Error(callRes.retMsg || `HTTP ${callRes.status}`);
    }

    const rawList = callRes.result?.list || [];

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
      strategyId: 'LIVE-BYBIT-FUTURES-LINEAR',
      mode: 'LIVE',
      feesPaid: parseFloat(o.cumExecFee || '0'),
      slippageBps: 0,
      latencyMs: 20,
      placedAt: new Date(Number(o.createdTime)).toISOString()
    }));
  }

  /**
   * Private Signed: Real trade execution history from Bybit Perpetual Futures (Linear)
   */
  public async getRealTrades(symbol?: string, limit = 50): Promise<Fill[]> {
    if (!this.apiKey || !this.apiSecret) return [];

    const params: Record<string, any> = { category: 'linear', limit };
    if (symbol) params.symbol = this.normalizeSymbol(symbol);

    const callRes = await this.fetchSignedWithRetry<any>('GET', '/v5/execution/list', params, { label: 'getRealTrades' });
    if (!callRes.ok || !callRes.result) return [];

    const list = callRes.result?.list || [];

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
        realizedPnL: parseFloat(t.execPnl || '0') || 0,
        timestamp: new Date(Number(t.execTime)).toISOString()
      };
    }));
  }

  /**
   * Symbol precision and step rules for Bybit Linear Futures
   */
  public getSymbolRules(symbol: string): { priceDecimals: number; qtyDecimals: number; minNotional: number } {
    const norm = this.normalizeSymbol(symbol);
    if (norm.startsWith('BTC')) return { priceDecimals: 2, qtyDecimals: 3, minNotional: 5.0 };
    if (norm.startsWith('ETH')) return { priceDecimals: 2, qtyDecimals: 2, minNotional: 5.0 };
    if (norm.startsWith('SOL')) return { priceDecimals: 2, qtyDecimals: 2, minNotional: 5.0 };
    if (norm.startsWith('BNB')) return { priceDecimals: 2, qtyDecimals: 2, minNotional: 5.0 };
    if (norm.startsWith('AVAX')) return { priceDecimals: 2, qtyDecimals: 1, minNotional: 5.0 };
    return { priceDecimals: 2, qtyDecimals: 2, minNotional: 5.0 };
  }

  /**
   * Private Signed: Place real linear futures order on Bybit
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
      orderLinkId,
      positionIdx: 0 // One-way mode standard in Bybit Linear Futures
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
      const callRes = await this.fetchSignedWithRetry<any>('POST', '/v5/order/create', payload, {
        maxRetries: 2,
        label: 'placeRealOrder'
      });

      if (!callRes.ok || !callRes.result) {
        return { success: false, error: callRes.retMsg, raw: callRes.raw };
      }

      return {
        success: true,
        orderId: callRes.result?.orderId || callRes.result?.orderLinkId,
        orderLinkId: callRes.result?.orderLinkId || orderLinkId,
        raw: callRes.result
      };
    } catch (e: any) {
      return { success: false, error: `Bybit Order Dispatch Failed: ${this.sanitizeSecrets(e.message)}` };
    }
  }

  /**
   * Private Signed: Cancel single linear futures order on Bybit
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

      const callRes = await this.fetchSignedWithRetry<any>('POST', '/v5/order/cancel', payload, {
        maxRetries: 2,
        label: 'cancelOrder'
      });

      if (!callRes.ok) {
        return { success: false, error: callRes.retMsg };
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: this.sanitizeSecrets(e.message) };
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
      const callRes = await this.fetchSignedWithRetry<any>('POST', '/v5/asset/withdraw/create', body, {
        maxRetries: 1, // withdrawals fail-closed without ambiguous repeat
        label: 'createSpotWithdrawal'
      });

      if (!callRes.ok || !callRes.result) {
        return { success: false, error: callRes.retMsg };
      }
      return {
        success: true,
        withdrawId: callRes.result?.id || callRes.result?.withdrawId,
        txId: callRes.result?.txID
      };
    } catch (err: any) {
      return { success: false, error: this.sanitizeSecrets(err.message || 'Bybit withdrawal request failed.') };
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
      const callRes = await this.fetchSignedWithRetry<any>('GET', '/v5/asset/withdraw/query-record', query, {
        label: 'queryWithdrawalRecords'
      });
      if (!callRes.ok || !callRes.result) return [];
      const rows = Array.isArray(callRes.result.rows) ? callRes.result.rows : (callRes.result.list || []);
      return rows.map((row: any) => ({
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
