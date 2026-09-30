/**
 * KuCoinExchangeAdapter — stub implementation of ExchangeAdapter.
 *
 * STATUS: NOT_IMPLEMENTED_YET.
 *
 * Same rationale as BinanceExchangeAdapter: the architecture is what ships
 * today, the working adapter is a separate change once the operator supplies
 * KuCoin credentials and tests against the sandbox.
 *
 * Implementation plan for KuCoin Futures:
 *   - REST base: https://api-futures.kucoin.com (sandbox: https://api-sandbox-futures.kucoin.com)
 *   - Auth: HMAC-SHA256 + API passphrase. Header `KC-API-KEY`,
 *           `KC-API-SIGN`, `KC-API-TIMESTAMP`, `KC-API-PASSPHRASE`,
 *           `KC-API-KEY-VERSION=2`.
 *   - WebSocket: requires a POST /api/v1/bullet-private to obtain a
 *           token, then connect to the returned endpoint. Different from
 *           Bybit/Binance which use a static endpoint.
 *   - Endpoints:
 *       GET /api/v1/timestamp
 *       GET /api/v1/ticker?symbol=BTCUSDT
 *       GET /api/v1/level2/depth50?symbol=BTCUSDT
 *       GET /api/v1/kline/query?symbol=BTCUSDT&granularity=1
 *       GET /api/v1/funding-rate/{symbol}/current
 *       GET /api/v1/positions
 *       GET /api/v1/account-overview
 *       GET /api/v1/orders?status=active
 *       GET /api/v1/orders?status=done
 *       GET /api/v1/fills
 *       POST /api/v1/position/leverage
 *       POST /api/v1/stopOrders (KuCoin-native TP/SL as separate orders)
 *       POST /api/v1/orders
 *       DELETE /api/v1/orders/{orderId}
 *       DELETE /api/v1/orders
 *   - Rate limit: 30 req/s per endpoint category. Burst handled by HTTP
 *     429 + Retry-After.
 *   - Symbol normalization: BTC/USDT -> BTCUSDT (no slash).
 *   - Notes: KuCoin models TP/SL as separate "stop orders" rather than
 *     position-attached protection. The engine must reconcile them
 *     separately in the periodic reconciliation pass.
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

class NotImplemented extends ExchangeAdapterError {
  constructor(method: string) {
    super({
      code: 'INTERNAL',
      exchangeId: 'kucoin',
      message: `KuCoinExchangeAdapter.${method} is NOT IMPLEMENTED YET. See the file header in server/trading/exchange/kucoin/KuCoinExchangeAdapter.ts for the implementation plan.`,
      retriable: false,
    });
  }
}

export class KuCoinExchangeAdapter implements ExchangeAdapter {
  public readonly id = 'kucoin' as const;
  public readonly name = 'KuCoin Futures (stub — not implemented)';

  private creds: ExchangeCredentials | null = null;
  private marketData: ExchangeMarketDataConfig | null = null;

  public async configure(_creds: ExchangeCredentials, marketData: ExchangeMarketDataConfig): Promise<void> {
    this.creds = _creds;
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
    throw new NotImplemented('ping');
  }

  public async getStatus() {
    return {
      id: this.id,
      name: this.name,
      configured: this.isConfigured(),
      connected: false,
      testnet: this.marketData?.testnet ?? false,
      rateLimit: this.getRateLimit(),
      lastError: 'not implemented yet',
    };
  }

  public async fetchTicker(_symbol: string): Promise<ExchangeTicker> { throw new NotImplemented('fetchTicker'); }
  public async fetchOrderBook(_symbol: string, _depth?: number): Promise<ExchangeOrderBook> { throw new NotImplemented('fetchOrderBook'); }
  public async fetchCandles(_symbol: string, _interval: string, _limit: number): Promise<ExchangeCandle[]> { throw new NotImplemented('fetchCandles'); }
  public async fetchFundingRate(_symbol: string): Promise<ExchangeFundingRate> { throw new NotImplemented('fetchFundingRate'); }
  public async fetchFeeSchedule(_symbol: string): Promise<ExchangeFeeSchedule> { throw new NotImplemented('fetchFeeSchedule'); }
  public async fetchPositions(_symbol?: string): Promise<ExchangePosition[]> { throw new NotImplemented('fetchPositions'); }
  public async fetchBalance(): Promise<ExchangeBalance> { throw new NotImplemented('fetchBalance'); }
  public async fetchOpenOrders(_symbol?: string): Promise<ExchangeOrder[]> { throw new NotImplemented('fetchOpenOrders'); }
  public async fetchOrderHistory(_symbol: string, _sinceMs: number, _limit?: number): Promise<ExchangeOrder[]> { throw new NotImplemented('fetchOrderHistory'); }
  public async fetchFills(_symbol?: string, _sinceMs?: number, _limit?: number): Promise<ExchangeFill[]> { throw new NotImplemented('fetchFills'); }
  public async fetchServerTime(): Promise<number> { throw new NotImplemented('fetchServerTime'); }

  public async setLeverage(_symbol: string, _leverage: number): Promise<void> { throw new NotImplemented('setLeverage'); }
  public async setFuturesProtection(_req: SetProtectionRequest): Promise<void> { throw new NotImplemented('setFuturesProtection'); }
  public async placeOrder(_req: PlaceOrderRequest): Promise<PlaceOrderResult> { throw new NotImplemented('placeOrder'); }
  public async cancelOrder(_symbol: string, _orderId: string): Promise<boolean> { throw new NotImplemented('cancelOrder'); }
  public async cancelAllOrders(_symbol?: string): Promise<number> { throw new NotImplemented('cancelAllOrders'); }

  public getRateLimit() {
    return { requests: 30, windowMs: 1_000 };
  }

  public async pauseIfNeeded(): Promise<void> {
    // TODO: track the 429 Retry-After headers and back off accordingly.
  }
}
