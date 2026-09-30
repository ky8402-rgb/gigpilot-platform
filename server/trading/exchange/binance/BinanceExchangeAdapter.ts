/**
 * BinanceExchangeAdapter — stub implementation of ExchangeAdapter.
 *
 * STATUS: NOT_IMPLEMENTED_YET.
 *
 * This class implements the FULL ExchangeAdapter interface so the engine
 * can boot with EXCHANGE_ID=binance and the registry will type-check
 * cleanly. Every method that would actually talk to Binance throws
 * ExchangeAdapterError({ code: 'INTERNAL', retriable: false }) with a
 * TODO comment explaining the work needed.
 *
 * Why ship a stub instead of pretending to ship a full implementation?
 *   - The user requested the multi-exchange architecture. That means a
 *     pluggable adapter, not necessarily a working Binance adapter in
 *     this session.
 *   - A stub that throws clearly is strictly safer than a stub that
 *     fabricates fake balances or fake fills.
 *   - Adding a working Binance implementation later is a single-file
 *     change. The interface and registry already accept it.
 *
 * Implementation plan for Binance Linear USDT-M Futures:
 *   - REST base: https://fapi.binance.com (testnet: https://testnet.binancefuture.com)
 *   - Auth: HMAC-SHA256, header `X-MBX-APIKEY`
 *   - Endpoints:
 *       GET /fapi/v1/time
 *       GET /fapi/v1/ticker/bookTicker?symbol=BTCUSDT
 *       GET /fapi/v1/depth?symbol=BTCUSDT&limit=50
 *       GET /fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=500
 *       GET /fapi/v1/premiumIndex?symbol=BTCUSDT
 *       GET /fapi/v2/positionRisk
 *       GET /fapi/v2/account
 *       GET /fapi/v1/openOrders
 *       GET /fapi/v1/allOrders
 *       GET /fapi/v1/userTrades
 *       POST /fapi/v1/leverage
 *       POST /fapi/v1/order
 *       DELETE /fapi/v1/order
 *       DELETE /fapi/v1/allOpenOrders
 *   - Rate limit: 1200 request weight per minute per IP. Trade endpoints
 *     carry higher weights — engine must pace accordingly.
 *   - Symbol normalization: BTC/USDT -> BTCUSDT (no slash).
 *   - Notes: position side is hedged by default in hedge mode; the engine
 *     runs cross-margin. Need to call POST /fapi/v1/marginType and POST
 *     /fapi/v1/positionSide/dual before opening positions.
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
      exchangeId: 'binance',
      message: `BinanceExchangeAdapter.${method} is NOT IMPLEMENTED YET. See the file header in server/trading/exchange/binance/BinanceExchangeAdapter.ts for the implementation plan.`,
      retriable: false,
    });
  }
}

export class BinanceExchangeAdapter implements ExchangeAdapter {
  public readonly id = 'binance' as const;
  public readonly name = 'Binance USDT-M Futures (stub — not implemented)';

  private creds: ExchangeCredentials | null = null;
  private marketData: ExchangeMarketDataConfig | null = null;

  public async configure(_creds: ExchangeCredentials, marketData: ExchangeMarketDataConfig): Promise<void> {
    // Configuration is captured but not used until the adapter is wired up.
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
    // TODO: hit GET /fapi/v1/time and return true on 200.
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
    return { requests: 1200, windowMs: 60_000 };
  }

  public async pauseIfNeeded(): Promise<void> {
    // TODO: implement token-bucket tracking of X-MBX-USED-WEIGHT header.
  }
}
