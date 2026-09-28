import { DestinationWallet, EngineErrorRecord, EngineHealth, EngineModule, SweepRecord } from './types.js';
import { bybitAdapter } from './bybitAdapter.js';
import crypto from 'crypto';

export class ProfitSweepEngine implements EngineModule {
  public readonly id = 'AUTO_PROFIT_SWEEP';
  public readonly name = 'Auto Profit Sweep Subsystem (Real Bybit Withdrawal Dispatcher)';
  private enabled = true;
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs = 0;
  private lastHeartbeat = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];
  private sweepThresholdUsd = 500;
  private minSweepBufferUsd = 200;
  private autoSweepEnabled = false;
  private destinationWallet: DestinationWallet = {
    address: '',
    network: 'BSC',
    label: '',
    isWhitelisted: false,
    addedAt: '',
    lastUsedAt: ''
  };
  private sweeps: SweepRecord[] = [];
  private requestGuards = new Map<string, number>();
  /** USD reserved against withdrawals that Bybit has accepted but not yet confirmed. */
  private pendingSweepUsd = 0;
  /** Injected by the trading store so fund movement respects the global emergency halt. */
  private killSwitchGuard: (() => boolean) | null = null;

  public setKillSwitchGuard(guard: () => boolean): void {
    this.killSwitchGuard = guard;
  }

  private isKillSwitchEngaged(): boolean {
    if (this.killSwitchGuard?.()) return true;
    return (process.env.GLOBAL_KILL_SWITCH_ACTIVE || '').trim().toLowerCase() === 'true';
  }

  public getPendingSweepUsd(): number {
    return Number(this.pendingSweepUsd.toFixed(2));
  }

  /** Chain-appropriate address format validation for the supported withdrawal networks. */
  private static isValidAddressForChain(network: string, address: string): boolean {
    const chain = (network || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (['BSC', 'BEP20', 'ETH', 'ETHEREUM', 'ERC20', 'ARBITRUM', 'ARBI', 'ARB'].includes(chain)) {
      return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
    }
    if (['SOL', 'SOLANA'].includes(chain)) {
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address.trim());
    }
    return false;
  }

  public healthCheck(): EngineHealth {
    return {
      id: this.id, name: this.name, status: !this.enabled ? 'OFF' : this.status, enabled: this.enabled,
      latencyMs: this.latencyMs, lastHeartbeat: this.lastHeartbeat, errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message, errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        autoSweepEnabled: this.autoSweepEnabled, sweepThresholdUsd: this.sweepThresholdUsd,
        destinationWalletConfigured: Boolean(this.destinationWallet.address),
        destinationWalletWhitelisted: this.destinationWallet.isWhitelisted,
        realExchangeDispatch: 'BYBIT_V5_ASSET_WITHDRAW_CREATE',
        syntheticTransactions: false
      }
    };
  }

  public getErrorSurface(): EngineErrorRecord[] { return [...this.errorSurface]; }
  public getOffSwitch(): boolean { return this.enabled; }
  public setOffSwitch(enabled: boolean): void { this.enabled = enabled; this.status = enabled ? 'HEALTHY' : 'OFF'; }
  public clearErrors(): void { this.errorSurface = []; }
  private recordError(level: EngineErrorRecord['level'], message: string, details?: any): void {
    this.errorSurface.unshift({ id: `err_sweep_${Date.now()}`, timestamp: new Date().toISOString(), level, message, details });
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }
  public getDestinationWallet(): DestinationWallet { return { ...this.destinationWallet }; }
  public getSweeps(): SweepRecord[] { return [...this.sweeps]; }

  public setDestinationWallet(wallet: DestinationWallet): { success: boolean; error?: string } {
    if (!wallet?.address || wallet.address.length < 10) return { success: false, error: 'Valid destination wallet address is required.' };
    if (!wallet?.network) return { success: false, error: 'Destination chain/network is required.' };
    if (!ProfitSweepEngine.isValidAddressForChain(wallet.network, wallet.address)) {
      return { success: false, error: `Destination address is not a valid ${wallet.network} address.` };
    }
    this.destinationWallet = {
      ...wallet,
      isWhitelisted: wallet.isWhitelisted === true,
      addedAt: wallet.addedAt || new Date().toISOString(),
      lastUsedAt: wallet.lastUsedAt || ''
    };
    if (!this.destinationWallet.isWhitelisted) {
      this.recordError('WARN', 'Destination wallet saved but not marked as whitelisted; withdrawals remain blocked.');
    }
    return { success: true };
  }

  public toggleAutoSweep(enabled: boolean): boolean {
    if (enabled && (!this.destinationWallet.address || !this.destinationWallet.isWhitelisted)) {
      this.recordError('WARN', 'Automatic sweep enable rejected until a whitelisted destination is configured.');
      this.autoSweepEnabled = false;
      return false;
    }
    this.autoSweepEnabled = Boolean(enabled);
    return this.autoSweepEnabled;
  }

  public isAutoSweepEnabled(): boolean { return this.autoSweepEnabled; }
  public setSweepThreshold(usd: number): void { this.sweepThresholdUsd = Math.max(50, usd); }
  public getSweepThreshold(): number { return this.sweepThresholdUsd; }

  private chainCode(network: string): string {
    const n = network.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (n === 'BSC' || n === 'BEP20') return 'BSC';
    if (n === 'ETH' || n === 'ETHEREUM' || n === 'ERC20') return 'ETH';
    if (n === 'ARBITRUM' || n === 'ARBI' || n === 'ARB') return 'ARBI';
    if (n === 'SOL' || n === 'SOLANA') return 'SOL';
    throw new Error(`Unsupported Bybit withdrawal chain: ${network}`);
  }

  private guardKey(amountUsd: number): string {
    return `${this.destinationWallet.address}:${this.destinationWallet.network}:${amountUsd.toFixed(2)}`;
  }

  public async executeManualSweep(amountUsd: number, eligibleUsd: number, operator: 'MANUAL_OWNER' | 'AUTONOMOUS_SWEEPER' = 'MANUAL_OWNER'): Promise<{ success: boolean; sweep?: SweepRecord; error?: string }> {
    if (!this.enabled) return { success: false, error: 'AUTO_PROFIT_SWEEP_OFF.' };
    // Fund movement must be covered by the emergency halt, not only order placement.
    if (this.isKillSwitchEngaged()) {
      this.recordError('WARN', 'Sweep blocked: global emergency kill switch is engaged.');
      return { success: false, error: 'FAIL-CLOSED: Global emergency kill switch is engaged. Fund sweeps are blocked.' };
    }
    if (!this.destinationWallet.address || !this.destinationWallet.isWhitelisted) return { success: false, error: 'Whitelisted destination wallet is required.' };
    if (!ProfitSweepEngine.isValidAddressForChain(this.destinationWallet.network, this.destinationWallet.address)) {
      return { success: false, error: `Destination address is not a valid ${this.destinationWallet.network} address.` };
    }
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(eligibleUsd) || eligibleUsd <= 0) {
      return { success: false, error: 'Sweep amount and verified eligible realized profit must be positive finite values.' };
    }
    // Retain the configured reserve buffer, and subtract withdrawals already accepted by Bybit but
    // not yet confirmed: eligibility is only decremented after confirmation, so without this a
    // repeated call could re-send the same funds.
    const maxSweepableUsd = Math.max(0, eligibleUsd - this.minSweepBufferUsd - this.pendingSweepUsd);
    if (amountUsd > maxSweepableUsd) {
      return {
        success: false,
        error: `Sweep amount exceeds verified eligible realized profit net of the $${this.minSweepBufferUsd} reserve buffer and $${this.pendingSweepUsd.toFixed(2)} of in-flight withdrawals (max $${maxSweepableUsd.toFixed(2)}).`
      };
    }
    const key = this.guardKey(amountUsd);
    const last = this.requestGuards.get(key) || 0;
    if (Date.now() - last < 10000) return { success: false, error: 'Bybit chain/coin withdrawal rate guard: retry after 10 seconds.' };

    const requestId = crypto.randomUUID();
    this.pendingSweepUsd += amountUsd;
    this.requestGuards.set(key, Date.now());
    const result = await bybitAdapter.createSpotWithdrawal({
      coin: 'USDT',
      amount: Number(amountUsd.toFixed(2)),
      address: this.destinationWallet.address,
      chain: this.chainCode(this.destinationWallet.network),
      requestId,
      accountType: 'FUND'
    });
    if (!result.success) {
      // Release the reservation: nothing was dispatched, so the amount becomes sweepable again.
      this.pendingSweepUsd = Math.max(0, this.pendingSweepUsd - amountUsd);
      this.recordError('ERROR', result.error || 'Bybit withdrawal rejected.');
      return { success: false, error: result.error };
    }

    const now = new Date().toISOString();
    const sweep: SweepRecord = {
      id: result.withdrawId || requestId,
      timestamp: now,
      destinationAddress: this.destinationWallet.address,
      destinationWallet: this.destinationWallet.address,
      chain: this.chainCode(this.destinationWallet.network),
      network: this.destinationWallet.network,
      grossSweepAmount: Number(amountUsd.toFixed(2)),
      amountUsd: Number(amountUsd.toFixed(2)),
      status: 'PENDING',
      txHash: result.txId || '',
      operator
    };
    this.sweeps.unshift(sweep);
    this.destinationWallet.lastUsedAt = now;
    this.lastHeartbeat = now;
    this.status = 'HEALTHY';
    return { success: true, sweep };
  }

  public async reconcilePendingSweeps(): Promise<SweepRecord[]> {
    const pending = this.sweeps.filter(s => s.status === 'PENDING' && s.id);
    const confirmed: SweepRecord[] = [];
    for (const sweep of pending) {
      const rows = await bybitAdapter.queryWithdrawalRecords({ withdrawId: sweep.id, coin: 'USDT', limit: 20 });
      const row = rows.find(r => r.withdrawId === sweep.id);
      if (!row) continue;
      const normalized = row.status.toUpperCase();
      sweep.txHash = row.txId || sweep.txHash;
      sweep.feePaidUsd = row.fee;
      sweep.networkFeeUsd = row.fee;
      if (['SUCCESS', 'COMPLETED', 'CONFIRMED'].includes(normalized)) {
        sweep.status = 'CONFIRMED';
        sweep.netTransferredUsd = Math.max(0, row.amount - row.fee);
        sweep.netReceivedUsd = sweep.netTransferredUsd;
        // Funds left the account, so release the reservation; accounting now books it as swept.
        this.pendingSweepUsd = Math.max(0, this.pendingSweepUsd - (sweep.amountUsd || 0));
        confirmed.push({ ...sweep });
      } else if (['FAIL', 'FAILED', 'REJECTED', 'CANCELLED'].includes(normalized)) {
        sweep.status = 'FAILED';
        this.pendingSweepUsd = Math.max(0, this.pendingSweepUsd - (sweep.amountUsd || 0));
      }
    }
    return confirmed;
  }
}
