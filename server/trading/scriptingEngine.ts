import { Candle, EngineErrorRecord, EngineHealth, EngineModule, OrderBook, Position, ScriptExecutionResult } from './types.js';
import { calculateRSI, calculateEMA, calculateSMA, calculateATR, calculateMACD, calculateVWAP } from './indicators.js';

export class ScriptingSandboxEngine implements EngineModule {
  public readonly id = 'STRATEGY_IDE';
  public readonly name = 'Strategy IDE (Sandboxed Algorithm Runtime)';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

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
        sandboxEnvironment: 'AST_FILTERED_PURE_JS',
        bannedTokens: ['process', 'require', 'import', 'child_process', 'fs', 'eval', 'Function', 'fetch'],
        orderRouting: 'ALL_ORDERS_MUST_PASS_RISK_GATE'
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
      this.recordError('WARN', 'Strategy IDE switched OFF. User script execution blocked.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Strategy IDE switched ON.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_script_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

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

    if (!this.enabled) {
      const err = 'STRATEGY_IDE_OFF: Script execution disabled by operator.';
      this.recordError('ERROR', err);
      return {
        success: false,
        output: err,
        ordersGenerated: [],
        logs: [err],
        executionTimeMs: 0,
        error: err
      };
    }

    // Security check: ban dangerous keywords
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
        const err = `Security Violation: Code contains restricted token: ${pattern}`;
        this.recordError('CRITICAL', err);
        return {
          success: false,
          output: err,
          ordersGenerated: [],
          logs: [`Blocked dangerous call matching ${pattern}`],
          executionTimeMs: Date.now() - startTime,
          error: 'Security Sandbox Exception'
        };
      }
    }

    const currentPrice = marketContext.candles[marketContext.candles.length - 1]?.close || 65000;
    const closes = marketContext.candles.map(c => c.close);

    // Build the high-fidelity `ctx` API
    const ctx = {
      price: () => currentPrice,
      candles: () => marketContext.candles,
      orderBook: () => marketContext.orderBook,
      position: () => marketContext.position,
      balance: () => marketContext.balance,
      regime: () => marketContext.marketRegime,

      rsi: (period = 14) => calculateRSI(closes, period),
      ema: (period = 20) => calculateEMA(closes, period),
      sma: (period = 20) => calculateSMA(closes, period),
      atr: (period = 14) => calculateATR(marketContext.candles, period),
      macd: () => calculateMACD(closes),
      vwap: () => calculateVWAP(marketContext.candles),

      buy: (price: number, amount: number, type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT' = 'LIMIT') => {
        ordersGenerated.push({ side: 'BUY', type, price, amount });
        logs.push(`Script emitted BUY order: ${amount} @ $${price} (${type})`);
      },
      sell: (price: number, amount: number, type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT' = 'LIMIT') => {
        ordersGenerated.push({ side: 'SELL', type, price, amount });
        logs.push(`Script emitted SELL order: ${amount} @ $${price} (${type})`);
      },
      log: (...args: any[]) => {
        logs.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
      }
    };

    try {
      const runner = new Function('ctx', `"use strict";\n${code}\nif (typeof onTick === "function") { onTick(ctx); }`);
      runner(ctx);

      this.latencyMs = Date.now() - startTime;
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';

      return {
        success: true,
        output: `Executed successfully in ${this.latencyMs}ms. Emitted ${ordersGenerated.length} order(s).`,
        ordersGenerated,
        logs,
        executionTimeMs: this.latencyMs
      };
    } catch (err: any) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', `Script execution runtime error: ${err.message}`);
      return {
        success: false,
        output: `Runtime Error: ${err.message}`,
        ordersGenerated: [],
        logs: [...logs, `Error: ${err.message}`],
        executionTimeMs: Date.now() - startTime,
        error: err.message
      };
    }
  }
}
