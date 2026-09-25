import { EngineErrorRecord, EngineHealth, EngineModule, StrategyValidationResult } from './types.js';

export class StrategyValidatorEngine implements EngineModule {
  public readonly id = 'STRATEGY_IDE';
  public readonly name = 'Strategy IDE (Live Strategy Validator)';

  private enabled = true;
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs = 0;
  private lastHeartbeat = new Date().toISOString();
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
        validationEnvironment: 'AST_FILTERED_SOURCE_VALIDATION',
        bannedTokens: ['process', 'require', 'import', 'child_process', 'fs', 'eval', 'Function', 'fetch'],
        orderRouting: 'ALL_ORDERS_MUST_PASS_RISK_GATE'
      }
    };
  }

  public getErrorSurface(): EngineErrorRecord[] { return [...this.errorSurface]; }
  public getOffSwitch(): boolean { return this.enabled; }

  public setOffSwitch(enabled: boolean): void {
    this.enabled = enabled;
    this.status = enabled ? 'HEALTHY' : 'OFF';
    this.recordError('WARN', enabled
      ? 'Strategy IDE switched ON.'
      : 'Strategy IDE switched OFF. User strategy validation blocked.');
  }

  public clearErrors(): void { this.errorSurface = []; }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any): void {
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

  public validateUserScript(code: string): StrategyValidationResult {
    const startTime = Date.now();

    if (!this.enabled) {
      const error = 'STRATEGY_IDE_OFF: Strategy validation disabled by operator.';
      this.recordError('ERROR', error);
      return { success: false, output: error, ordersGenerated: [], logs: [error], executionTimeMs: 0, error };
    }

    if (!code || code.length > 50000) {
      const error = 'Invalid strategy source: code is empty or exceeds the 50,000 character limit.';
      return { success: false, output: error, ordersGenerated: [], logs: [error], executionTimeMs: Date.now() - startTime, error };
    }

    const forbiddenPatterns = [
      /\bprocess\b/, /\brequire\b/, /\bimport\b/, /\bchild_process\b/, /\bfs\b/,
      /\beval\b/, /\bFunction\b/, /\bglobal\b/, /\bwindow\b/, /\bdocument\b/,
      /\bfetch\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(code)) {
        const error = `Security Violation: Code contains restricted token: ${pattern}`;
        this.recordError('CRITICAL', error);
        return { success: false, output: error, ordersGenerated: [], logs: [error], executionTimeMs: Date.now() - startTime, error: 'Security validation failed' };
      }
    }

    if (!/\bonTick\s*\(/.test(code)) {
      const error = 'Strategy validation failed: an onTick(ctx) entrypoint is required.';
      return { success: false, output: error, ordersGenerated: [], logs: [error], executionTimeMs: Date.now() - startTime, error };
    }

    const forbiddenExecutionCalls = [/ctx\.buy\s*\(/, /ctx\.sell\s*\(/, /ctx\.place_grid\s*\(/];
    if (forbiddenExecutionCalls.some(pattern => pattern.test(code))) {
      const error = 'Strategy source contains direct order-emission calls. Live orders must be produced only by the governed autonomous strategy builder and execution engine.';
      return { success: false, output: error, ordersGenerated: [], logs: [error], executionTimeMs: Date.now() - startTime, error };
    }

    this.latencyMs = Date.now() - startTime;
    this.lastHeartbeat = new Date().toISOString();
    this.status = 'HEALTHY';

    const logs = [
      'Strategy source validated successfully.',
      'No user code was executed and no orders were generated.',
      'Live deployment remains governed by the strategy builder, exchange execution engine, and risk engine.'
    ];

    return {
      success: true,
      output: `Validated successfully in ${this.latencyMs}ms.`,
      ordersGenerated: [],
      logs,
      executionTimeMs: this.latencyMs
    };
  }
}
