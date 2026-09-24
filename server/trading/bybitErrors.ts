/**
 * Canonical Bybit V5 Error Mapping and Human-Readable Explanations
 * Maps Bybit V5 retCode to clear operator guidance, actionable steps, and categories.
 * Strict fail-closed design: Never hides raw error codes or messages.
 */

export interface BybitErrorDetail {
  code: number;
  category: 'AUTHENTICATION' | 'RATE_LIMIT' | 'INSUFFICIENT_FUNDS' | 'PRECISION_OR_SIZE' | 'ORDER_NOT_FOUND' | 'POSITION' | 'NETWORK' | 'SYSTEM';
  friendlyMessage: string;
  recommendedAction: string;
}

export const BYBIT_ERROR_MAP: Record<number, BybitErrorDetail> = {
  // Authentication & API Keys
  10001: {
    code: 10001,
    category: 'AUTHENTICATION',
    friendlyMessage: 'Invalid request parameter or bad request format',
    recommendedAction: 'Verify order parameters (symbol, price, qty, side) are valid.'
  },
  10002: {
    code: 10002,
    category: 'NETWORK',
    friendlyMessage: 'Request timestamp is outside Bybit recvWindow (Clock drift)',
    recommendedAction: 'Re-sync system clock with Bybit server time (/v5/market/time).'
  },
  10003: {
    code: 10003,
    category: 'AUTHENTICATION',
    friendlyMessage: 'Bybit API key is invalid or does not exist',
    recommendedAction: 'Check your API Key in Settings or .bybit-quant-keys.json.'
  },
  10004: {
    code: 10004,
    category: 'AUTHENTICATION',
    friendlyMessage: 'Invalid HMAC-SHA256 signature',
    recommendedAction: 'Verify your Bybit API Secret key is correct and not truncated.'
  },
  10005: {
    code: 10005,
    category: 'AUTHENTICATION',
    friendlyMessage: 'Permission denied for this Bybit API key',
    recommendedAction: 'Ensure API Key has "Spot Trade" permissions enabled in Bybit dashboard.'
  },
  10006: {
    code: 10006,
    category: 'RATE_LIMIT',
    friendlyMessage: 'Bybit API rate limit exceeded (Too many requests)',
    recommendedAction: 'Back off request rate; system circuit breaker active.'
  },
  10007: {
    code: 10007,
    category: 'AUTHENTICATION',
    friendlyMessage: 'API Key not bound to current server IP',
    recommendedAction: 'Whistlist the server IP in Bybit API Key management or use unrestricted IP.'
  },
  10008: {
    code: 10008,
    category: 'AUTHENTICATION',
    friendlyMessage: 'Bybit account is banned or suspended',
    recommendedAction: 'Contact Bybit support or check account KYC status.'
  },
  10009: {
    code: 10009,
    category: 'AUTHENTICATION',
    friendlyMessage: 'Bybit IP rate limit triggered',
    recommendedAction: 'Pause automated requests for 60 seconds.'
  },
  10010: {
    code: 10010,
    category: 'AUTHENTICATION',
    friendlyMessage: 'Unmatched IP address for API key',
    recommendedAction: 'Verify that the server IP is included in your Bybit API key IP whitelist.'
  },

  // Spot Order Execution & Balance Errors
  170001: {
    code: 170001,
    category: 'INSUFFICIENT_FUNDS',
    friendlyMessage: 'Insufficient available balance on Bybit Spot account',
    recommendedAction: 'Deposit or free up USDT/base asset balance before placing order.'
  },
  170002: {
    code: 170002,
    category: 'PRECISION_OR_SIZE',
    friendlyMessage: 'Order amount or value is below the minimum limit ($5 USD)',
    recommendedAction: 'Increase order quantity to meet the minimum notional requirement.'
  },
  170007: {
    code: 170007,
    category: 'PRECISION_OR_SIZE',
    friendlyMessage: 'Price precision exceeds the allowed step size for this pair',
    recommendedAction: 'Adjust price decimals according to pair specifications.'
  },
  170008: {
    code: 170008,
    category: 'PRECISION_OR_SIZE',
    friendlyMessage: 'Quantity precision exceeds the allowed step size for this pair',
    recommendedAction: 'Adjust quantity decimals according to pair specifications.'
  },
  170131: {
    code: 170131,
    category: 'INSUFFICIENT_FUNDS',
    friendlyMessage: 'Insufficient balance to cover order and exchange trading fees',
    recommendedAction: 'Reduce order size slightly or deposit additional funds.'
  },
  170140: {
    code: 170140,
    category: 'ORDER_NOT_FOUND',
    friendlyMessage: 'Order does not exist or has already been filled/cancelled',
    recommendedAction: 'Refresh orders list from Bybit.'
  },
  170141: {
    code: 170141,
    category: 'ORDER_NOT_FOUND',
    friendlyMessage: 'Order is already completely filled or cancelled',
    recommendedAction: 'No further action required; order is inactive.'
  },
  170142: {
    code: 170142,
    category: 'ORDER_NOT_FOUND',
    friendlyMessage: 'Duplicate orderLinkId / idempotency key conflict',
    recommendedAction: 'Order already received by Bybit; checking existing order status.'
  },
  170143: {
    code: 170143,
    category: 'ORDER_NOT_FOUND',
    friendlyMessage: 'Order cannot be cancelled in its current state',
    recommendedAction: 'Verify order state on exchange.'
  },
  170144: {
    code: 170144,
    category: 'ORDER_NOT_FOUND',
    friendlyMessage: 'Order has already been cancelled',
    recommendedAction: 'Order already cancelled.'
  },
  170159: {
    code: 170159,
    category: 'PRECISION_OR_SIZE',
    friendlyMessage: 'Order price is outside acceptable band (+/- 10% of market mid)',
    recommendedAction: 'Adjust limit order price closer to current market price.'
  },
  170160: {
    code: 170160,
    category: 'PRECISION_OR_SIZE',
    friendlyMessage: 'Order quantity is below the minimum order size',
    recommendedAction: 'Increase order quantity.'
  },
  170193: {
    code: 170193,
    category: 'PRECISION_OR_SIZE',
    friendlyMessage: 'Order price exceeds highest/lowest allowed limit',
    recommendedAction: 'Check market bounds and adjust order price.'
  },
  170194: {
    code: 170194,
    category: 'PRECISION_OR_SIZE',
    friendlyMessage: 'Order price is not aligned with tick size',
    recommendedAction: 'Round price to the nearest tick size.'
  },
  170210: {
    code: 170210,
    category: 'SYSTEM',
    friendlyMessage: 'Trading pair is currently suspended for trading or maintenance',
    recommendedAction: 'Check Bybit announcements for market maintenance schedules.'
  }
};

/**
 * Format a Bybit API error into a friendly operator string while preserving
 * exact retCode and retMsg for rigorous live transparency.
 */
export function formatBybitError(retCode?: number, retMsg?: string): string {
  if (!retCode && !retMsg) {
    return 'Unknown Bybit Exchange Error';
  }

  const code = Number(retCode || 0);
  const detail = BYBIT_ERROR_MAP[code];

  if (detail) {
    return `[Bybit ${code}] ${detail.friendlyMessage} (Action: ${detail.recommendedAction}) [Raw: ${retMsg || 'None'}]`;
  }

  return `[Bybit ${code || 'Error'}] ${retMsg || 'Exchange call rejected'}`;
}
