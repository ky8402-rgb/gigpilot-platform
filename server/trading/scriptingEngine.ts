import { Candle, OrderBook, Position, ScriptExecutionResult } from './types.js';
import { calculateRSI, calculateEMA, calculateSMA, calculateATR, calculateMACD, calculateVWAP } from './indicators.js';

type MetricName = 'PRICE' | 'VOLUME' | 'RSI' | 'EMA' | 'SMA' | 'ATR' | 'VWAP' | 'SPREAD' | 'BALANCE' | 'PNL';

const MAX_SCRIPT_LINES = 100;
const MAX_ORDERS = 100;
const MAX_GRID_LEVELS = 50;

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

    if (typeof code !== 'string' || !code.trim()) {
      return this.failure(startTime, 'Script is empty.');
    }

    const lines = code
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > MAX_SCRIPT_LINES) {
      return this.failure(startTime, `Script exceeds the ${MAX_SCRIPT_LINES}-line limit.`);
    }

    const currentPrice = marketContext.candles[marketContext.candles.length - 1]?.close;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return this.failure(startTime, 'No valid live market price is available for script evaluation.');
    }

    const closes = marketContext.candles.map(c => c.close).filter(Number.isFinite);
    const values: Record<MetricName, number> = {
      PRICE: currentPrice,
      VOLUME: marketContext.candles[marketContext.candles.length - 1]?.volume || 0,
      RSI: calculateRSI(closes, 14),
      EMA: calculateEMA(closes, 21),
      SMA: calculateSMA(closes, 20),
      ATR: calculateATR(marketContext.candles, 14),
      VWAP: calculateVWAP(marketContext.candles),
      SPREAD: marketContext.orderBook.spread || 0,
      BALANCE: marketContext.balance,
      PNL: marketContext.position.unrealizedPnL + marketContext.position.realizedPnL
    };

    const metricValue = (metric: string): number | null => {
      const normalized = metric.toUpperCase();
      const match = normalized.match(/^(PRICE|VOLUME|RSI|EMA|SMA|ATR|VWAP|SPREAD|BALANCE|PNL)(?:\((\d+)\))?$/);
      if (!match) return null;
      const name = match[1] as MetricName;
      const period = match[2] ? Number(match[2]) : undefined;
      if (!period || name === 'PRICE' || name === 'VOLUME' || name === 'RSI' || name === 'ATR' || name === 'VWAP' || name === 'SPREAD' || name === 'BALANCE' || name === 'PNL') {
        return values[name];
      }
      return name === 'EMA' ? calculateEMA(closes, period) : calculateSMA(closes, period);
    };

    const conditionPasses = (expression: string): boolean => {
      const match = expression.trim().match(/^([A-Z]+(?:\(\d+\))?)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)$/i);
      if (!match) {
        if (/^REGIME\s*==\s*"[^"]+"$/i.test(expression.trim())) {
          const expected = expression.trim().match(/"([^"]+)"/)?.[1] || '';
          return marketContext.marketRegime.toUpperCase() === expected.toUpperCase();
        }
        throw new Error(`Unsupported condition: ${expression}`);
      }
      const left = metricValue(match[1]);
      const right = Number(match[3]);
      if (left === null || !Number.isFinite(left) || !Number.isFinite(right)) {
        throw new Error(`Invalid condition value: ${expression}`);
      }
      switch (match[2]) {
        case '>': return left > right;
        case '<': return left < right;
        case '>=': return left >= right;
        case '<=': return left <= right;
        case '==': return left === right;
        case '!=': return left !== right;
        default: return false;
      }
    };

    const addOrder = (
      side: 'BUY' | 'SELL',
      amount: number,
      price: number,
      type: 'LIMIT' | 'MARKET',
      label: string
    ) => {
      if (ordersGenerated.length >= MAX_ORDERS) throw new Error(`Script exceeded the ${MAX_ORDERS}-order limit.`);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid order amount in ${label}.`);
      if (!Number.isFinite(price) || price <= 0) throw new Error(`Invalid order price in ${label}.`);
      if (amount * price > 1_000_000) throw new Error(`Order value exceeds the $1,000,000 script safety ceiling in ${label}.`);
      ordersGenerated.push({ side, type, price: Number(price.toFixed(8)), amount: Number(amount.toFixed(8)) });
      logs.push(`[${side}] ${amount} @ $${price} (${type})`);
    };

    const executeCommand = (command: string) => {
      const normalized = command.trim();
      if (/^LOG\s+/i.test(normalized)) {
        logs.push(normalized.replace(/^LOG\s+/i, '').slice(0, 500));
        return;
      }

      const grid = normalized.match(/^GRID\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+)\s+(\d+(?:\.\d+)?)$/i);
      if (grid) {
        const lower = Number(grid[1]);
        const upper = Number(grid[2]);
        const levels = Number(grid[3]);
        const orderSizeUsd = Number(grid[4]);
        if (lower <= 0 || upper <= lower || levels < 2 || levels > MAX_GRID_LEVELS || orderSizeUsd <= 0) {
          throw new Error('Invalid GRID parameters.');
        }
        const step = (upper - lower) / (levels - 1);
        for (let i = 0; i < levels; i++) {
          const price = lower + i * step;
          const side = price < currentPrice ? 'BUY' : 'SELL';
          addOrder(side, orderSizeUsd / price, price, 'GRID_LIMIT', normalized);
        }
        return;
      }

      const order = normalized.match(/^(BUY|SELL)\s+(?:(BTC\/USDT|ETH\/USDT|SOL\/USDT|BNB\/USDT|AVAX\/USDT)\s+)?(\d+(?:\.\d+)?)(?:\s+AT\s+(\d+(?:\.\d+)?))?(?:\s+(MARKET|LIMIT))?$/i);
      if (!order) throw new Error(`Unsupported command: ${normalized}`);

      const side = order[1].toUpperCase() as 'BUY' | 'SELL';
      const symbol = (order[2] || marketContext.symbol).toUpperCase();
      if (symbol !== marketContext.symbol.toUpperCase()) {
        throw new Error(`Script symbol ${symbol} does not match active symbol ${marketContext.symbol}.`);
      }
      const amount = Number(order[3]);
      const requestedPrice = order[4] ? Number(order[4]) : currentPrice;
      const type = (order[5] || 'LIMIT').toUpperCase() as 'LIMIT' | 'MARKET';
      addOrder(side, amount, requestedPrice, type, normalized);
    };

    try {
      for (const line of lines) {
        const conditional = line.match(/^IF\s+(.+?)\s+THEN\s+(.+)$/i);
        if (conditional) {
          if (conditionPasses(conditional[1])) executeCommand(conditional[2]);
        } else {
          executeCommand(line);
        }
      }

      return {
        success: true,
        output: `Validated DSL successfully. Generated ${ordersGenerated.length} order instructions.`,
        ordersGenerated,
        logs,
        executionTimeMs: Date.now() - startTime
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Script validation error: ${err.message}`,
        ordersGenerated: [],
        logs: [...logs, `[ERROR] ${err.message}`],
        executionTimeMs: Date.now() - startTime,
        error: err.message
      };
    }
  }

  private failure(startTime: number, error: string): ScriptExecutionResult {
    return {
      success: false,
      output: `Script rejected: ${error}`,
      ordersGenerated: [],
      logs: [`[REJECTED] ${error}`],
      executionTimeMs: Date.now() - startTime,
      error
    };
  }
}
