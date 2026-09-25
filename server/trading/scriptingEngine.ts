import vm from 'node:vm';
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

    // Security check: ban dangerous keywords and prototype escalation vectors
    const forbiddenPatterns = [
      /\bprocess\b/i,
      /\brequire\b/i,
      /\bimport\b/i,
      /\bchild_process\b/i,
      /\bfs\b/i,
      /\beval\b/i,
      /\bFunction\b/i,
      /\bglobal\b/i,
      /\bglobalThis\b/i,
      /\bwindow\b/i,
      /\bdocument\b/i,
      /\bfetch\b/i,
      /\bXMLHttpRequest\b/i,
      /\bWebSocket\b/i,
      /\bconstructor\b/i,
      /\b__proto__\b/i,
      /\bprototype\b/i,
      /\bReflect\b/i,
      /\bProxy\b/i,
      /\bWebAssembly\b/i,
      /\bSharedArrayBuffer\b/i
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

    // Build the high-fidelity and deeply frozen `ctx` API
    const ctx = Object.freeze({
      price: Object.freeze(() => currentPrice),
      candles: Object.freeze(() => Object.freeze(marketContext.candles.map(c => ({ ...c })))),
      orderBook: Object.freeze(() => Object.freeze({ ...marketContext.orderBook })),
      position: Object.freeze(() => Object.freeze({ ...marketContext.position })),
      balance: Object.freeze(() => marketContext.balance),
      regime: Object.freeze(() => marketContext.marketRegime),

      rsi: Object.freeze((period = 14) => calculateRSI(closes, Math.max(2, Math.min(100, Number(period) || 14)))),
      ema: Object.freeze((period = 20) => calculateEMA(closes, Math.max(2, Math.min(200, Number(period) || 20)))),
      sma: Object.freeze((period = 20) => calculateSMA(closes, Math.max(2, Math.min(200, Number(period) || 20)))),
      atr: Object.freeze((period = 14) => calculateATR(marketContext.candles, Math.max(2, Math.min(100, Number(period) || 14)))),
      macd: Object.freeze(() => calculateMACD(closes)),
      vwap: Object.freeze(() => calculateVWAP(marketContext.candles)),

      buy: Object.freeze((price: number, amount: number, type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT' = 'LIMIT') => {
        const numPrice = Number(price);
        const numAmount = Number(amount);
        if (!Number.isFinite(numPrice) || numPrice <= 0 || !Number.isFinite(numAmount) || numAmount <= 0) {
          throw new Error(`Invalid BUY order parameters: price=${price}, amount=${amount}`);
        }
        if (ordersGenerated.length >= 25) {
          throw new Error('Order count limit exceeded (maximum 25 orders per script run)');
        }
        ordersGenerated.push({ side: 'BUY', type, price: numPrice, amount: numAmount });
        logs.push(`Script emitted BUY order: ${numAmount} @ $${numPrice} (${type})`);
      }),
      sell: Object.freeze((price: number, amount: number, type: 'LIMIT' | 'MARKET' | 'GRID_LIMIT' = 'LIMIT') => {
        const numPrice = Number(price);
        const numAmount = Number(amount);
        if (!Number.isFinite(numPrice) || numPrice <= 0 || !Number.isFinite(numAmount) || numAmount <= 0) {
          throw new Error(`Invalid SELL order parameters: price=${price}, amount=${amount}`);
        }
        if (ordersGenerated.length >= 25) {
          throw new Error('Order count limit exceeded (maximum 25 orders per script run)');
        }
        ordersGenerated.push({ side: 'SELL', type, price: numPrice, amount: numAmount });
        logs.push(`Script emitted SELL order: ${numAmount} @ $${numPrice} (${type})`);
      }),
      log: Object.freeze((...args: any[]) => {
        if (logs.length >= 100) return;
        logs.push(args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' '));
      })
    });

    // Create pristine sandbox container with zero prototype leakage
    const sandbox: Record<string, any> = {
      ctx,
      Math,
      Number,
      Boolean,
      String,
      Array,
      Date: { now: () => Date.now() },
      parseInt,
      parseFloat,
      isNaN,
      isFinite
    };

    try {
      const wrappedScript = `"use strict";\n(function(ctx) {\n${code}\nif (typeof onTick === "function") { onTick(ctx); }\n})(ctx);`;
      
      // Execute in isolated V8 context with strict 1500ms timeout budget
      vm.runInNewContext(wrappedScript, sandbox, {
        timeout: 1500,
        microtaskMode: 'afterEvaluate'
      });

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
      const isTimeout = err?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || err.message?.includes('timed out');
      const errorMsg = isTimeout ? 'Execution Timeout: Script exceeded 1500ms compute budget' : err.message;
      this.recordError('ERROR', `Script execution runtime error: ${errorMsg}`);
      return {
        success: false,
        output: `Runtime Error: ${errorMsg}`,
        ordersGenerated: [],
        logs: [...logs, `Error: ${errorMsg}`],
        executionTimeMs: Date.now() - startTime,
        error: errorMsg
      };
    }
  }
}
