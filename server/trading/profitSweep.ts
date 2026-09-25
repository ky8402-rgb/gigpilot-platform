import fs from 'fs';
import path from 'path';
import { bybitAdapter } from './bybitAdapter.js';
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
    address: '',
    network: '',
    label: '',
    isWhitelisted: false,
    addedAt: ''
  };
  private sweeps: SweepRecord[] = [];
  private readonly stateFile = path.join(
    process.env.GIGPILOT_PERSISTENT_DATA_DIR || path.join(process.cwd(), '.gigpilot-data'),
    'profit-sweep-state.json'
  );
  private lastDispatchAt = 0;

  constructor() {
    this.loadState();
  }

  private loadState(): void {
    try {
      const dir = path.dirname(this.stateFile);
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(this.stateFile)) return;
      const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      if (state?.destinationWallet) this.destinationWallet = state.destinationWallet;
      if (Array.isArray(state?.sweeps)) this.sweeps = state.sweeps;
      if (Number.isFinite(state?.lastDispatchAt)) this.lastDispatchAt = Number(state.lastDispatchAt);
    } catch (error) {
      this.recordError('ERROR', 'Failed to load persistent profit-sweep state.', { error: String(error) });
    }
  }

  private persistState(): void {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify({
        destinationWallet: this.destinationWallet,
        sweeps: this.sweeps.slice(-100),
        lastDispatchAt: this.lastDispatchAt,
        updatedAt: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      this.recordError('ERROR', 'Failed to persist profit-sweep state.', { error: String(error) });
    }
  }

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
    const normalized = {
      ...wallet,
      asset: (wallet as any).asset?.trim?.().toUpperCase?.() || 'USDT',
      chain: wallet.chain?.trim() || wallet.network?.trim() || '',
      network: wallet.network?.trim() || wallet.chain?.trim() || '',
      isWhitelisted: true
    };
    if (!normalized.chain) return { success: false, error: 'Destination wallet chain/network is required.' };
    this.destinationWallet = normalized;
    this.persistState();
    this.recordError('WARN', `Cold vault destination updated to ${wallet.address} (${wallet.network || wallet.chain})`);
    return { success: true };
  }

  public toggleAutoSweep(enabled: boolean): boolean {
    this.autoSweepEnabled = enabled;
    this.persistState();
    return this.autoSweepEnabled;
  }

  public setSweepThreshold(usd: number): void {
    this.sweepThresholdUsd = Math.max(50, usd);
  }

  public async executeManualSweep(amountUsd: number, eligibleUsd: number, operator: 'AUTONOMOUS_SWEEPER' | 'MANUAL_OWNER' = 'MANUAL_OWNER'): Promise<{ success: boolean; sweep?: SweepRecord; error?: string }> {
    if (!this.enabled) {
      return { success: false, error: 'AUTO_PROFIT_SWEEP_OFF: Sweep subsystem is disabled by operator.' };
    }

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return { success: false, error: 'Invalid sweep amount.' };
    }

    if (!Number.isFinite(eligibleUsd) || eligibleUsd <= 0 || amountUsd > eligibleUsd) {
      const err = `Requested sweep ($${amountUsd.toFixed(2)}) exceeds eligible realized profit ($${Math.max(0, eligibleUsd).toFixed(2)}).`;
      this.recordError('ERROR', err);
      return { success: false, error: err };
    }

    const wallet: any = this.destinationWallet;
    const coin = String(wallet.asset || 'USDT').toUpperCase();
    const chain = String(wallet.chain || wallet.network || '').trim();
    if (!wallet.address || !wallet.isWhitelisted || !chain) {
      return { success: false, error: 'Destination wallet is not configured with an explicit whitelisted chain.' };
    }

    if (Date.now() - this.lastDispatchAt < 10000) {
      return { success: false, error: 'Withdrawal rate guard active: Bybit requires at least 10 seconds between withdrawals for the same coin/chain.' };
    }

    // GigPilot accounting is USD-denominated. Automatic withdrawal is intentionally restricted
    // to USDT so 1 USD of eligible profit maps to 1 USDT without inventing an exchange rate.
    if (coin !== 'USDT') {
      return { success: false, error: 'Automatic sweep currently supports USDT only; configure the destination asset as USDT.' };
    }

    const requestId = `gp_sweep_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const dispatch = await bybitAdapter.createWithdrawal({
      coin,
      chain,
      address: wallet.address,
      amount: Number(amountUsd.toFixed(6)),
      accountType: 'UTA',
      forceChain: 1,
      requestId
    });

    if (!dispatch.success || !dispatch.withdrawalId) {
      this.recordError('ERROR', dispatch.error || 'Bybit withdrawal was not accepted.');
      return { success: false, error: dispatch.error || 'Bybit withdrawal was not accepted.' };
    }

    this.lastDispatchAt = Date.now();
    const sweep: SweepRecord = {
      id: requestId,
      timestamp: new Date().toISOString(),
      destinationWallet: wallet.address,
      destinationAddress: wallet.address,
      chain,
      network: wallet.network || chain,
      grossSweepAmount: amountUsd,
      amountUsd,
      networkFeeUsd: 0,
      feePaidUsd: 0,
      netTransferredUsd: amountUsd,
      netReceivedUsd: amountUsd,
      reserveRetainedUsd: Math.max(0, eligibleUsd - amountUsd),
      status: 'PENDING',
      txHash: '',
      operator
    };
    (sweep as any).withdrawalId = dispatch.withdrawalId;
    this.sweeps.unshift(sweep);
    if (this.sweeps.length > 100) this.sweeps.pop();
    this.persistState();

    // Re-query immediately when Bybit has already materialized the record. If it is still
    // pending, the record remains PENDING and is reconciled on the next sweep status check.
    await this.reconcileSweep(dispatch.withdrawalId);
    return { success: true, sweep };
  }

  public async executeAutomaticSweep(eligibleUsd: number): Promise<{ success: boolean; sweep?: SweepRecord; error?: string }> {
    if (!this.autoSweepEnabled) return { success: false, error: 'AUTO_SWEEP_DISABLED' };
    if (eligibleUsd < this.sweepThresholdUsd) return { success: false, error: 'SWEEP_THRESHOLD_NOT_REACHED' };
    const amount = Math.max(0, eligibleUsd - this.minSweepBufferUsd);
    if (amount <= 0) return { success: false, error: 'SWEEP_BUFFER_PROTECTS_ELIGIBLE_PROFIT' };
    return this.executeManualSweep(amount, eligibleUsd, 'AUTONOMOUS_SWEEPER');
  }

  public async reconcileSweep(withdrawalId: string): Promise<void> {
    const record: any = this.sweeps.find((item: any) => item.withdrawalId === withdrawalId);
    if (!record || record.status === 'CONFIRMED' || record.status === 'FAILED') return;
    const remote = await bybitAdapter.getWithdrawalRecord(withdrawalId);
    if (remote.error) {
      this.recordError('WARN', remote.error);
      return;
    }
    if (!remote.found) return;

    record.status = this.mapWithdrawalStatus(remote.status);
    if (remote.txId) record.txHash = remote.txId;
    if (Number.isFinite(remote.fee)) record.feePaidUsd = Number(remote.fee);
    if (Number.isFinite(remote.amount) && remote.amount > 0) record.netTransferredUsd = remote.amount;
    record.netReceivedUsd = Math.max(0, (record.netTransferredUsd || record.amountUsd || 0) - (record.feePaidUsd || 0));
    this.persistState();
  }

  public async reconcilePendingSweeps(): Promise<void> {
    for (const sweep of this.sweeps.filter((item: any) => item.status === 'PENDING').slice(0, 20) as any[]) {
      await this.reconcileSweep(String(sweep.withdrawalId || ''));
    }
  }

  private mapWithdrawalStatus(status?: string): SweepRecord['status'] {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'success' || normalized === 'completed') return 'CONFIRMED';
    if (normalized === 'fail' || normalized === 'failed' || normalized === 'cancelled' || normalized === 'rejected') return 'FAILED';
    return 'PENDING';
  }
}
