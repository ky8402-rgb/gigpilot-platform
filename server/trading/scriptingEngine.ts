import { EngineErrorRecord, EngineHealth, EngineModule, StrategyValidationResult } from './types.js';

export class StrategyValidatorEngine implements EngineModule {
  public readonly id = 'STRATEGY_IDE';
  public readonly name = 'Strategy IDE (Live Source Validator)';

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
        validationOnly: true,
        execution: 'DISABLED',
        orderRouting: 'Only the live strategy builder may submit orders through the risk and exchange execution gates.'
      }
    };
  }

  public getErrorSurface(): EngineErrorRecord[] { return [...this.errorSurface]; }
  public getOffSwitch(): boolean { return this.enabled; }

  public setOffSwitch(enabled: boolean): void {
    this.enabled = enabled;
    this.status = enabled ? 'HEALTHY' : 'OFF';
    this.recordError('WARN', enabled ? 'Strategy source validation enabled.' : 'Strategy source validation switched OFF.');
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
    const start = Date.now();
    const logs: string[] = [];
    if (!this.enabled) {
      return { success: false, logs: ['Strategy source validation is disabled.'], error: 'STRATEGY_IDE_OFF', validationTimeMs: Date.now() - start, executable: false };
    }

    const source = code.trim();
    if (source.length < 20) {
      return { success: false, logs: ['Source is too short.'], error: 'Strategy source is too short.', validationTimeMs: Date.now() - start, executable: false };
    }
    if (source.length > 100_000) {
      return { success: false, logs: ['Source exceeds the maximum allowed size.'], error: 'Strategy source exceeds 100,000 characters.', validationTimeMs: Date.now() - start, executable: false };
    }

    const forbidden = [
      /\bprocess\b/i, /\brequire\s*\(/i, /\bimport\b/i, /\bexport\b/i,
      /child_process/i, /\bfs\b/i, /\beval\s*\(/i, /\bFunction\s*\(/i,
      /\bglobalThis?\b/i, /\bwindow\b/i, /\bdocument\b/i, /\bfetch\s*\(/i,
      /XMLHttpRequest/i, /WebSocket/i, /\bctx\s*\.\s*(buy|sell|place_grid)\s*\(/i
    ];
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        const error = `Forbidden executable capability detected: ${pattern}`;
        this.recordError('WARN', error);
        return { success: false, logs, error, validationTimeMs: Date.now() - start, executable: false };
      }
    }

    if (!/function\s+onTick\s*\(/.test(source)) {
      return { success: false, logs, error: 'Strategy must define onTick(ctx).', validationTimeMs: Date.now() - start, executable: false };
    }

    logs.push('Syntax contract accepted: onTick(ctx) is present.');
    logs.push('Live market context is required at deployment time.');
    logs.push('Order-emission APIs are unavailable to user source.');
    logs.push('Validated source remains non-executable; deployment still requires strategy promotion and risk/exchange gates.');
    this.lastHeartbeat = new Date().toISOString();
    this.latencyMs = Date.now() - start;
    return { success: true, logs, validationTimeMs: this.latencyMs, executable: false };
  }
}
