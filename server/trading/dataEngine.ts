import { Candle, EngineErrorRecord, EngineHealth, EngineModule, OrderBook, OrderBookLevel } from './types.js';

export interface LivePairMarketData {
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
  source: 'BYBIT_LIVE' | 'UNAVAILABLE';
}

export class DataEngine implements EngineModule {
  public readonly id = 'DATA_ENGINE';
  public readonly name = 'Data Engine (Live WS & Public Feeds)';

  private enabled: boolean = true; // Off-switch: true = ON, false = OFF
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;

  private marketData: Map<string, LivePairMarketData> = new Map();
  private tickCallbacks: Array<(symbol: string, price: number, data: LivePairMarketData) => void> = [];

  private trackedSymbols = [
    'BTC/USDT',
    'ETH/USDT',
    'SOL/USDT',
    'BNB/USDT',
    'AVAX/USDT',
    'DOGE/USDT',
    'XRP/USDT'
  ];

  // Official public endpoints for Bybit V5 live market data (NO synthetic data allowed)
  private bybitEndpoints = [
    'https://api.bybit.com',
    'https://api-testnet.bybit.com'
  ];

  constructor() {
    this.startLiveIngestion();
  }

  public healthCheck(): EngineHealth {
    return {
      id: this.id,
      name: this.name,
      status: !this.enabled ? 'OFF' : this.status,
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message,
      errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        trackedPairsCount: this.trackedSymbols.length,
        liveFeedsActive: Array.from(this.marketData.keys()).length,
        source: 'EXCHANGE_LIVE_PUBLIC_MIRRORS',
        isFailClosed: true
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
      this.recordError('WARN', 'Data Engine switched OFF by operator. Live WebSocket ingestion stopped. Downstream engines will fail closed.');
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Data Engine switched ON. Resuming live feed ingestion.');
      this.startLiveIngestion();
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_data_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

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

  public toExchangeSymbol(sym: string): string {
    return sym.replace(/[\/\-_]/g, '').toUpperCase();
  }

  public registerTickCallback(cb: (symbol: string, price: number, data: LivePairMarketData) => void) {
    this.tickCallbacks.push(cb);
  }

  public getPairData(symbol: string): LivePairMarketData | undefined {
    if (!this.enabled) return undefined;
    const norm = this.normalizeSymbol(symbol);
    return this.marketData.get(norm) || this.marketData.get(symbol);
  }

  public getAllPairs(): LivePairMarketData[] {
    if (!this.enabled) return [];
    return Array.from(this.marketData.values());
  }

  private startLiveIngestion() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    // Initial fetch immediately
    this.fetchLiveTick().catch(err => {
      this.recordError('ERROR', `Initial live market ingestion failed: ${err.message}`);
    });
    // Continuous live poll every 2.5 seconds
    this.pollInterval = setInterval(() => {
      if (this.enabled) {
        this.fetchLiveTick().catch(() => {});
      }
    }, 2500);
  }

  /**
   * Fetch live data strictly from real exchange endpoints without any synthetic fallback
   */
  private async fetchLiveTick(): Promise<void> {
    if (this.isPolling || !this.enabled) return;
    this.isPolling = true;
    const start = Date.now();

    try {
      let anySuccess = false;

      // 1. Fetch 24h tickers from Bybit V5 public endpoints
      let tickerMap: Record<string, { price: number; open: number; high: number; low: number; volume: number; changePct: number }> = {};
      let tickerFetchSuccess = false;

      for (const endpoint of this.bybitEndpoints) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          const res = await fetch(`${endpoint}/v5/market/tickers?category=spot`, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
          });
          clearTimeout(timer);
          if (res.ok) {
            const bybitJson = (await res.json()) as any;
            if (bybitJson?.result?.list && Array.isArray(bybitJson.result.list)) {
              for (const item of bybitJson.result.list) {
                tickerMap[item.symbol] = {
                  price: parseFloat(item.lastPrice) || 0,
                  open: parseFloat(item.prevPrice24h) || 0,
                  high: parseFloat(item.highPrice24h) || 0,
                  low: parseFloat(item.lowPrice24h) || 0,
                  volume: parseFloat(item.volume24h) || 0,
                  changePct: parseFloat(item.price24hPcnt) * 100 || 0
                };
              }
              tickerFetchSuccess = true;
              break;
            }
          }
        } catch {
          // Try next endpoint
        }
      }

      if (!tickerFetchSuccess) {
        this.status = 'DOWN';
        this.recordError('CRITICAL', 'Live Bybit V5 market feeds are unreachable. Live trading paused (FAIL-CLOSED).');
        return;
      }

      // 2. Fetch candles and depth for tracked symbols from Bybit V5
      for (const sym of this.trackedSymbols) {
        const raw = this.toExchangeSymbol(sym);
        const ticker = tickerMap[raw];
        if (!ticker || ticker.price <= 0) continue;

        anySuccess = true;

        // Fetch real order book depth from Bybit V5
        let bids: OrderBookLevel[] = [];
        let asks: OrderBookLevel[] = [];
        let spread = 0;
        let spreadBps = 0;

        try {
          const depthRes = await fetch(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${raw}&limit=15`, {
            headers: { 'Accept': 'application/json' }
          });
          if (depthRes.ok) {
            const depthJson = (await depthRes.json()) as any;
            const resData = depthJson?.result;
            if (resData && (Array.isArray(resData.b) || Array.isArray(resData.a))) {
              let cumB = 0;
              let cumA = 0;
              bids = (resData.b || []).map((b: any[]) => {
                const p = parseFloat(b[0]);
                const a = parseFloat(b[1]);
                cumB += a;
                return { price: p, amount: a, total: Number(cumB.toFixed(4)) };
              });
              asks = (resData.a || []).map((a: any[]) => {
                const p = parseFloat(a[0]);
                const aAmt = parseFloat(a[1]);
                cumA += aAmt;
                return { price: p, amount: aAmt, total: Number(cumA.toFixed(4)) };
              });

              if (bids.length > 0 && asks.length > 0) {
                spread = Number((asks[0].price - bids[0].price).toFixed(6));
                spreadBps = Number(((spread / ticker.price) * 10000).toFixed(1));
              }
            }
          }
        } catch {
          // Depth network timeout
        }

        // Fetch real klines (1m, limit 30) from Bybit V5
        let candles: Candle[] = [];
        const existing = this.marketData.get(sym);
        if (existing && existing.candles && existing.candles.length > 0) {
          candles = existing.candles;
        }

        try {
          const klineRes = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${raw}&interval=1&limit=30`, {
            headers: { 'Accept': 'application/json' }
          });
          if (klineRes.ok) {
            const klineJson = (await klineRes.json()) as any;
            const list = klineJson?.result?.list;
            if (Array.isArray(list) && list.length > 0) {
              candles = list.slice().reverse().map((k: any[]) => ({
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
          // Fall back to existing cached real candles if available
        }

        const currentPrice = ticker.price;
        const liveData: LivePairMarketData = {
          symbol: sym,
          currentPrice,
          open24h: ticker.open,
          high24h: ticker.high,
          low24h: ticker.low,
          volume24h: ticker.volume,
          priceChangePct: ticker.changePct,
          candles,
          orderBook: {
            symbol: sym,
            bids,
            asks,
            spread,
            spreadBps,
            midPrice: currentPrice,
            timestamp: Date.now()
          },
          lastUpdated: new Date().toISOString(),
          source: 'BYBIT_LIVE'
        };

        this.marketData.set(sym, liveData);

        // Emit tick to callbacks
        for (const cb of this.tickCallbacks) {
          try {
            cb(sym, currentPrice, liveData);
          } catch {}
        }
      }

      this.latencyMs = Date.now() - start;
      this.lastHeartbeat = new Date().toISOString();
      this.status = anySuccess ? 'HEALTHY' : 'DEGRADED';
    } catch (err: any) {
      this.status = 'DOWN';
      this.recordError('CRITICAL', `Data Engine ingestion fatal error: ${err.message}`);
    } finally {
      this.isPolling = false;
    }
  }

  public destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
