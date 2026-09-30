/**
 * OkxExchangeAdapter — stub implementation of ExchangeAdapter.
 *
 * STATUS: NOT_IMPLEMENTED_YET.
 *
 * Included so the operator has a single concrete example of how to wire a
 * new exchange into the architecture, and so the registry can validate the
 * full set of provider IDs at boot. Same contract as the Bybit adapter,
 * no behavior — every method throws ExchangeAdapterError.
 *
 * Implementation plan for OKX V5 USDT-Margined Swaps (linear futures):
 *   - REST base: https://www.okx.com (demo: https://www.okx.com via x-simulated-trading: 1)
 *   - Auth: HMAC-SHA256 + API passphrase (yes, OKX requires it too).
 *           Headers: OK-ACCESS-KEY, OK-ACCESS-SIGN, OK-ACCESS-TIMESTAMP,
 *           OK-ACCESS-PASSPHRASE.
 *   - Endpoints (selected):
 *       GET /api/v5/public/time
 *       GET /api/v5/market/ticker?instId=BTC-USDT-SWAP
 *       GET /api/v5/market/books?instId=BTC-USDT-SWAP&sz=50
 *       GET /api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1m&limit=300
 *       GET /api/v5/public/funding-rate?instId=BTC-USDT-SWAP
 *       GET /api/v5/account/positions?instType=SWAP
 *       GET /api/v5/account/balance
 *       GET /api/v5/trade/orders-pending
 *       GET /api/v5/trade/orders-history
 *       GET /api/v5/trade/fills
 *       POST /api/v5/account/set-leverage
 *       POST /api/v5/trade/order (algo orders for TP/SL use
 *             POST /api/v5/trade/order-algo with ordType=conditional)
 *       POST /api/v5/trade/cancel-order
 *       POST /api/v5/trade/cancel-batch-orders
 *   - Rate limit: 20 req/2s per endpoint, 480 req/min per UID.
 *   - Symbol normalization: BTC/USDT -> BTC-USDT-SWAP.
 *   - Notes: OKX TP/SL are algo orders with their own IDs that must be
 *     tracked separately from the entry order.
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
      exchangeId: 'okx',
      message: `OkxExchangeAdapter.${method} is NOT IMPLEMENTED YET. See the file header in server/trading/exchange/okx/OkxExchangeAdapter.ts for the implementation plan.`,
      retriable: false,
    });
  }
}

export class OkxExchangeAdapter implements ExchangeAdapter {
  public readonly id = 'okx' as const;
  public readonly name = 'OKX USDT-Margined Swaps (stub — not implemented)';

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
    return { requests: 20, windowMs: 2_000 };
  }

  public async pauseIfNeeded(): Promise<void> {
    // TODO: track per-UID and per-endpoint quotas.
  }
}
