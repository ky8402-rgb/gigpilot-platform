import { Candle, OrderBook, Position, ScriptExecutionResult } from './types.js';
import { calculateRSI, calculateEMA, calculateSMA, calculateATR, calculateMACD, calculateVWAP } from './indicators.js';

export class ScriptingSandboxEngine {
  public executeUserScript(
    code: string,
    marketContext: {
      symbol: string;
      candles: Candle[];
      orderBook: OrderBook;
      position: Position;
      balance: number;
      marketRegime: string;
    }
  ): ScriptExecutionResult {
    const startTime = Date.now();
    const logs: string[] = [];
    const ordersGenerated: Array<{
      side: 'BUY' | 'SELL';
      type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT';
      price: number;
      amount: number;
    }> = [];

    // Security check: ban forbidden keywords
    const forbiddenPatterns = [
      /\bprocess\b/,
      /\brequire\b/,
      /\bimport\b/,
      /\bchild_process\b/,
      /\bfs\b/,
      /\beval\b/,
      /\bFunction\b/,
      /\bglobal\b/,
      /\bwindow\b/,
      /\bdocument\b/,
      /\bfetch\b/,
      /\bXMLHttpRequest\b/,
      /\bWebSocket\b/
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(code)) {
        return {
          success: false,
          output: `Security Violation: Code contains restricted token: ${pattern}`,
          ordersGenerated: [],
          logs: [`Blocked dangerous call matching ${pattern}`],
          executionTimeMs: Date.now() - startTime,
          error: 'Security Sandbox Exception'
        };
      }
    }

    const currentPrice = marketContext.candles[marketContext.candles.length - 1]?.close || 65000;
    const closes = marketContext.candles.map(c => c.close);

    // Build the high-fidelity `ctx` API specified in prompt section 10
    const ctx = {
      price: () => currentPrice,
      volume: () => marketContext.candles[marketContext.candles.length - 1]?.volume || 0,
      ohlcv: () => [...marketContext.candles],
      rsi: (period = 14) => calculateRSI(closes, period),
      macd: () => calculateMACD(closes),
      ema: (period = 21) => calculateEMA(closes, period),
      sma: (period = 20) => calculateSMA(closes, period),
      atr: (period = 14) => calculateATR(marketContext.candles, period),
      vwap: () => calculateVWAP(marketContext.candles),
      order_book: () => marketContext.orderBook,
      spread: () => marketContext.orderBook.spread,
      position: () => ({ ...marketContext.position }),
      balance: () => marketContext.balance,
      pnl: () => marketContext.position.unrealizedPnL + marketContext.position.realizedPnL,
      market_regime: () => marketContext.marketRegime,

      // Order generation primitives
      buy: (symbol: string, amount: number, price?: number, type: 'LIMIT' | 'MARKET' = 'LIMIT') => {
        ordersGenerated.push({
          side: 'BUY',
          type,
          price: price || currentPrice,
          amount
        });
        logs.push(`[ctx.buy] BUY order created: ${amount} ${symbol} @ $${price || currentPrice}`);
      },

      sell: (symbol: string, amount: number, price?: number, type: 'LIMIT' | 'MARKET' = 'LIMIT') => {
        ordersGenerated.push({
          side: 'SELL',
          type,
          price: price || currentPrice,
          amount
        });
        logs.push(`[ctx.sell] SELL order created: ${amount} ${symbol} @ $${price || currentPrice}`);
      },

      place_grid: (spec: { upper: number; lower: number; levels: number; orderSizeUsd: number }) => {
        const step = (spec.upper - spec.lower) / (spec.levels - 1);
        for (let i = 0; i < spec.levels; i++) {
          const p = spec.lower + (i * step);
          const side = p < currentPrice ? 'BUY' : 'SELL';
          const amt = Number((spec.orderSizeUsd / p).toFixed(6));
          ordersGenerated.push({
            side,
            type: 'GRID_LIMIT',
            price: Number(p.toFixed(2)),
            amount: amt
          });
        }
        logs.push(`[ctx.place_grid] Placed ${spec.levels} grid levels between $${spec.lower} and $${spec.upper}`);
      },

      log: (...args: any[]) => {
        logs.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      }
    };

    try {
      // Execute within isolated scope passing only safe context
      const userFunction = new Function('ctx', 'console', `
        "use strict";
        const log = ctx.log;
        ${code}
      `);

      userFunction(ctx, { log: ctx.log, warn: ctx.log, error: ctx.log });

      return {
        success: true,
        output: `Executed successfully. Generated ${ordersGenerated.length} order instructions.`,
        ordersGenerated,
        logs,
        executionTimeMs: Date.now() - startTime
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Script runtime error: ${err.message}`,
        ordersGenerated: [],
        logs: [...logs, `[ERROR] ${err.message}`],
        executionTimeMs: Date.now() - startTime,
        error: err.message
      };
    }
  }
}
