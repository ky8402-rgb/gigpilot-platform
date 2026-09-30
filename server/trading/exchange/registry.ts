/**
 * ExchangeRegistry — selects the active ExchangeAdapter based on
 * EXCHANGE_ID env var.
 *
 * Default: 'bybit' (preserves the prior live behavior).
 *
 * Unknown IDs fail-closed at boot. Switching exchanges is one env-var
 * change at deploy time, plus the matching API-key credentials in the
 * secrets store. The engine code does not change.
 *
 * Adding a new exchange is a three-step process:
 *   1) Implement ExchangeAdapter in server/trading/exchange/<name>/.
 *   2) Register the implementation here under the matching id.
 *   3) Operator sets EXCHANGE_ID=<name> on the next deploy.
 */

import { ExchangeAdapter, ExchangeId } from './types.js';
import { BybitExchangeAdapter } from './bybit/BybitExchangeAdapter.js';
import { BinanceExchangeAdapter } from './binance/BinanceExchangeAdapter.js';
import { KuCoinExchangeAdapter } from './kucoin/KuCoinExchangeAdapter.js';
import { OkxExchangeAdapter } from './okx/OkxExchangeAdapter.js';

export interface ExchangeRegistryOptions {
  /** Override the env-var lookup. Used by tests. */
  exchangeId?: string;
}

export function selectExchangeAdapter(opts: ExchangeRegistryOptions = {}): ExchangeAdapter {
  const id = (opts.exchangeId ?? process.env.EXCHANGE_ID ?? 'bybit').trim().toLowerCase() as ExchangeId;
  switch (id) {
    case 'bybit': return new BybitExchangeAdapter();
    case 'binance': return new BinanceExchangeAdapter();
    case 'kucoin': return new KuCoinExchangeAdapter();
    case 'okx': return new OkxExchangeAdapter();
    default:
      throw new Error(
        `Unknown EXCHANGE_ID=${id}. Supported: 'bybit', 'binance', 'kucoin', 'okx'. ` +
          `To add a new exchange, implement ExchangeAdapter in server/trading/exchange/<name>/ ` +
          `and register it in server/trading/exchange/registry.ts.`,
      );
  }
}

/** Lists the registered exchange IDs, used by /api/trading/exchanges. */
export function listSupportedExchanges(): Array<{ id: ExchangeId; name: string }> {
  return [
    { id: 'bybit', name: new BybitExchangeAdapter().name },
    { id: 'binance', name: new BinanceExchangeAdapter().name },
    { id: 'kucoin', name: new KuCoinExchangeAdapter().name },
    { id: 'okx', name: new OkxExchangeAdapter().name },
  ];
}
