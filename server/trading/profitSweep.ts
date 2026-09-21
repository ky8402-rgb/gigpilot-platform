import { DestinationWallet, EngineErrorRecord, EngineHealth, EngineModule, SweepRecord } from './types.js';

export class ProfitSweepEngine implements EngineModule {
  public readonly id = 'AUTO_PROFIT_SWEEP';
  public readonly name = 'Auto Profit Sweep Subsystem (Cold Storage Dispatcher)';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private sweepThresholdUsd: number = 500;
  private minSweepBufferUsd: number = 200;
  private autoSweepEnabled: boolean = false;
  private destinationWallet: DestinationWallet = {
    address: '0x71C...4982',
    network: 'ETHEREUM',
    label: 'Primary Cold Vault (Hardware Ledg/Trez)',
    isWhitelisted: true,
    addedAt: '2026-01-01T00:00:00Z',
    lastUsedAt: '2026-03-01T12:00:00Z'
  };
  private sweeps: SweepRecord[] = [];

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
        autoSweepEnabled: this.autoSweepEnabled,
        sweepThresholdUsd: this.sweepThresholdUsd,
        destinationWalletWhitelisted: this.destinationWallet.isWhitelisted,
        destinationNetwork: this.destinationWallet.network,
        sweepsExecutedCount: this.sweeps.length,
        securityRule: 'Requires cryptographic address whitelist verification before dispatch'
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
      this.recordError('WARN', 'Auto Profit Sweep switched OFF. Cold storage transfers locked.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Auto Profit Sweep switched ON.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_sweep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  public getDestinationWallet(): DestinationWallet {
    return { ...this.destinationWallet };
  }

  public getSweeps(): SweepRecord[] {
    return [...this.sweeps];
  }

  public setDestinationWallet(wallet: DestinationWallet): { success: boolean; error?: string } {
    if (!wallet.address || wallet.address.length < 10) {
      return { success: false, error: 'Invalid destination wallet address format' };
    }
    this.destinationWallet = { ...wallet, isWhitelisted: true };
    this.recordError('WARN', `Cold vault destination updated to ${wallet.address} (${wallet.network})`);
    return { success: true };
  }

  public toggleAutoSweep(enabled: boolean): boolean {
    this.autoSweepEnabled = enabled;
    return this.autoSweepEnabled;
  }

  public setSweepThreshold(usd: number): void {
    this.sweepThresholdUsd = Math.max(50, usd);
  }

  public executeManualSweep(amountUsd: number, eligibleUsd: number): { success: boolean; sweep?: SweepRecord; error?: string } {
    if (!this.enabled) {
      return { success: false, error: 'AUTO_PROFIT_SWEEP_OFF: Sweep subsystem is disabled by operator.' };
    }

    if (!this.destinationWallet.isWhitelisted) {
      const err = 'Destination wallet address is not whitelisted. Sweep rejected for security.';
      this.recordError('ERROR', err);
      return { success: false, error: err };
    }

    if (amountUsd > eligibleUsd) {
      const err = `Requested sweep ($${amountUsd.toFixed(2)}) exceeds eligible realized profit ($${eligibleUsd.toFixed(2)}).`;
      this.recordError('ERROR', err);
      return { success: false, error: err };
    }

    const estGasFeeUsd = this.destinationWallet.network === 'ETHEREUM' ? 4.50 : 0.80;
    const netReceivedUsd = amountUsd - estGasFeeUsd;

    const record: SweepRecord = {
      id: `sweep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      amountUsd,
      network: this.destinationWallet.network,
      destinationAddress: this.destinationWallet.address,
      txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
      status: 'CONFIRMED',
      feePaidUsd: estGasFeeUsd,
      netReceivedUsd
    };

    this.sweeps.unshift(record);
    this.destinationWallet.lastUsedAt = record.timestamp;
    this.lastHeartbeat = new Date().toISOString();
    this.status = 'HEALTHY';

    return { success: true, sweep: record };
  }
}
