/**
 * ExchangeAdapter — the canonical contract any supported exchange must
 * satisfy.
 *
 * Scope: a Bybit/Binance/KuCoin/OKX adapter implements this interface,
 * and the rest of the trading engine talks to that interface, not to
 * the adapter directly. Adding a new exchange is one file. The engine
 * doesn't change.
 *
 * Design invariants:
 *
 *  1. **Fail-closed at every boundary.** A method called without
 *     configuration returns an error (or throws); it never silently
 *     fabricates a fake value.
 *  2. **Read-only by default.** Reads (tickers, candles, positions) never
 *     require risk gates — they are observational. Writes (placeOrder,
 *     cancelOrder, setLeverage, setFuturesProtection) require both
 *     `isConfigured()` and a positive `isRiskGateOpen()` so the trading
 *     engine's fail-closed defaults remain intact at the adapter boundary.
 *  3. **Symbol normalization.** Inputs may arrive as `BTCUSDT` or
 *     `BTC/USDT` — adapters MUST normalize. Outputs MUST be in the
 *     canonical `BASE/QUOTE` form so the engine can compare across
 *     exchanges.
 *  4. **No fabricated values.** Every numeric field comes from the live
 *     exchange REST/WS API. If the API is unreachable, the method
 *     surfaces an error rather than returning stale data and pretending
 *     it is fresh.
 *  5. **Rate limit awareness.** Each adapter implements `getRateLimit()`
 *     and `pauseIfNeeded()` so the engine can throttle its polling.
 *  6. **Errors are typed.** `ExchangeAdapterError` carries a `code` that
 *     the engine maps to action (`RETRY`, `FATAL`, `RATE_LIMITED`, etc.).
 */

export type ExchangeId = 'bybit' | 'binance' | 'kucoin' | 'okx' | 'mock';

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  /** Optional: API passphrase (KuCoin, OKX). Empty for exchanges that don't use one. */
  passphrase?: string;
}

export interface ExchangeMarketDataConfig {
  /** Symbol in canonical form (`BTC/USDT`) the adapter should track. */
  symbol: string;
  /** If true, requests are routed to the exchange's testnet endpoint. */
  testnet?: boolean;
}

export interface ExchangeAdapterStatus {
  id: ExchangeId;
  name: string;
  configured: boolean;
  connected: boolean;
  testnet: boolean;
  rateLimit: { requests: number; windowMs: number };
  lastError?: string;
}

/** Ticker snapshot — best bid/ask/last/volume observed from the live REST. */
export interface ExchangeTicker {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  /** 24h base-currency volume if available; 0 if the exchange doesn't expose it. */
  volume24hBase: number;
  /** 24h quote-currency turnover if available; 0 otherwise. */
  volume24hQuote: number;
  /** Wall-clock ISO timestamp when the snapshot was observed. */
  timestamp: string;
  /** Whether the data is from the live REST endpoint or, transparently, a cache. */
  source: 'live' | 'cache';
}

/** One price level in the order book. */
export interface ExchangeOrderBookLevel {
  price: number;
  size: number;
}

export interface ExchangeOrderBook {
  symbol: string;
  bids: ExchangeOrderBookLevel[];
  asks: ExchangeOrderBookLevel[];
  timestamp: string;
}

/** One OHLCV candle. `closeTime` is the inclusive end of the bar. */
export interface ExchangeCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface ExchangeFundingRate {
  symbol: string;
  /** Hourly funding rate as a fraction (e.g. 0.0001 == 1 bps/hour). */
  rate: number;
  /** Wall-clock ISO timestamp for the NEXT funding settlement. */
  nextFundingTime: string;
  /** Timestamp the snapshot was observed. */
  timestamp: string;
}

export interface ExchangeFeeSchedule {
  symbol: string;
  /** Maker fee as a fraction (e.g. 0.0002). */
  maker: number;
  /** Taker fee as a fraction (e.g. 0.00055). */
  taker: number;
  timestamp: string;
}

/** Live position, exactly as reported by the exchange. */
export interface ExchangePosition {
  symbol: string;
  side: 'long' | 'short' | 'flat';
  size: number;
  entryPrice: number;
  markPrice: number;
  /** Unrealized P&L in the QUOTE currency, NOT a fraction. */
  unrealizedPnlQuote: number;
  leverage: number;
  marginMode: 'cross' | 'isolated';
  liquidationPrice: number | null;
  timestamp: string;
}

export interface ExchangeBalance {
  /** Total equity in USDT (or quote currency after normalization). */
  totalEquityQuote: number;
  /** Free balance available to place new orders, in quote currency. */
  availableBalanceQuote: number;
  /** Margin currently locked in positions, in quote currency. */
  usedMarginQuote: number;
  unrealizedPnlQuote: number;
  timestamp: string;
}

export interface ExchangeOrder {
  id: string;
  /** Adapter-side idempotency key used on place. Echoed back here. */
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  /** Positive number for buys, negative for sells (engine convention). */
  signedQuantity: number;
  price: number | null;
  /** 0 = unfilled, otherwise matches avg fill price × matched size. */
  filledQuantity: number;
  avgFillPrice: number | null;
  status: 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected' | 'expired';
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeFill {
  id: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee: number;
  feeCurrency: string;
  /** Whether the fill was a maker or taker (drives fee schedule selection). */
  liquidity: 'maker' | 'taker';
  timestamp: string;
}

export interface PlaceOrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  price?: number;
  /** Adapter-side idempotency key. Echoed back on the order. */
  clientOrderId: string;
  leverage?: number;
  reduceOnly?: boolean;
  postOnly?: boolean;
  /** Time-in-force. Defaults to GTC for limit, IOC for market. */
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'GTX';
}

export interface PlaceOrderResult {
  order: ExchangeOrder;
  fills: ExchangeFill[];
}

export interface SetProtectionRequest {
  symbol: string;
  side: 'long' | 'short' | 'both';
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
}

/** Typed error so the engine can route to RETRY / FATAL / RATE_LIMITED / etc. */
export type ExchangeErrorCode =
  | 'NOT_CONFIGURED'
  | 'NOT_CONNECTED'
  | 'INSTRUMENT_NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_QTY'
  | 'INVALID_PRICE'
  | 'RATE_LIMITED'
  | 'EXCHANGE_DOWN'
  | 'UNAUTHORIZED'
  | 'LEVERAGE_REJECTED'
  | 'PROTECTION_REJECTED'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'INTERNAL';

export class ExchangeAdapterError extends Error {
  public readonly code: ExchangeErrorCode;
  public readonly exchangeId: ExchangeId;
  public readonly statusCode?: number;
  public readonly retriable: boolean;

  constructor(args: {
    code: ExchangeErrorCode;
    exchangeId: ExchangeId;
    message: string;
    statusCode?: number;
    retriable?: boolean;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = 'ExchangeAdapterError';
    this.code = args.code;
    this.exchangeId = args.exchangeId;
    this.statusCode = args.statusCode;
    this.retriable = Boolean(args.retriable);
  }
}

/**
 * The contract every exchange adapter implements.
 *
 * The trading engine holds ONE active adapter (selected via the registry).
 * Calling `placeOrder` on an unconfigured adapter MUST return/throw
 * ExchangeAdapterError({ code: 'NOT_CONFIGURED' }). The engine treats this
 * as fail-closed and refuses to retry.
 */
export interface ExchangeAdapter {
  readonly id: ExchangeId;
  readonly name: string;

  // ----- Lifecycle -----------------------------------------------------

  /** Idempotent. Loads env-supplied credentials into the adapter. */
  configure(creds: ExchangeCredentials, marketData: ExchangeMarketDataConfig): Promise<void>;

  /** Idempotent. Tears down any persistent connections. */
  disconnect(): Promise<void>;

  /** Returns true iff `configure()` succeeded. */
  isConfigured(): boolean;

  /** Liveness check — true if the adapter can talk to the exchange right now. */
  ping(): Promise<boolean>;

  /** Snapshot of adapter state for /api/trading/exchanges. */
  getStatus(): Promise<ExchangeAdapterStatus>;

  // ----- Market data (reads) ------------------------------------------

  /** Best bid/ask + last trade + 24h volume. Throws on failure. */
  fetchTicker(symbol: string): Promise<ExchangeTicker>;

  /** Top-N bids and asks. Throws on failure. */
  fetchOrderBook(symbol: string, depth?: number): Promise<ExchangeOrderBook>;

  /** OHLCV history. `limit` is exchange-defined; adapter clamps it. */
  fetchCandles(symbol: string, interval: string, limit: number): Promise<ExchangeCandle[]>;

  /** Funding rate + next settlement time. Throws if symbol is not a perpetual. */
  fetchFundingRate(symbol: string): Promise<ExchangeFundingRate>;

  /** Maker/taker fee for the symbol. Throws on failure. */
  fetchFeeSchedule(symbol: string): Promise<ExchangeFeeSchedule>;

  // ----- Account state (reads) ----------------------------------------

  /** All open positions. Empty array is a valid response. */
  fetchPositions(symbol?: string): Promise<ExchangePosition[]>;

  /** Account equity, free balance, used margin, unrealized P&L. */
  fetchBalance(): Promise<ExchangeBalance>;

  /** Live open orders. Empty array is a valid response. */
  fetchOpenOrders(symbol?: string): Promise<ExchangeOrder[]>;

  /** Order history (filled/cancelled) since `sinceMs` (unix epoch). */
  fetchOrderHistory(symbol: string, sinceMs: number, limit?: number): Promise<ExchangeOrder[]>;

  /** Fills for the account (or a specific orderId). */
  fetchFills(symbol?: string, sinceMs?: number, limit?: number): Promise<ExchangeFill[]>;

  /** Server-side epoch milliseconds — used for clock-skew detection. */
  fetchServerTime(): Promise<number>;

  // ----- Trading (writes — fail-closed by default) ---------------------

  /** Synchronizes leverage to `leverage` on the symbol. Idempotent. */
  setLeverage(symbol: string, leverage: number): Promise<void>;

  /** Applies a TP/SL to an open position. Idempotent — repeated calls with
   *  identical inputs MUST NOT return an error. */
  setFuturesProtection(req: SetProtectionRequest): Promise<void>;

  /** Places a single order. */
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;

  /** Cancels a single order by id. */
  cancelOrder(symbol: string, orderId: string): Promise<boolean>;

  /** Cancels all open orders on a symbol. Returns the count cancelled. */
  cancelAllOrders(symbol?: string): Promise<number>;

  // ----- Throttling ----------------------------------------------------

  /** Per-adapter request quota. Used by the engine to pace its polling. */
  getRateLimit(): { requests: number; windowMs: number };

  /** No-op unless the adapter has its own internal token bucket. */
  pauseIfNeeded(): Promise<void>;
}
