import { CapitalAccounting, DestinationWallet, ProfitSweep } from './types.js';

const WHITELISTED_PAYOUT_ADDRESS = '0x178166ffac90e6d94d2c1f822c1026f87641a0ec';
const WHITELISTED_PAYOUT_CHAIN = 'bsc';

export class ProfitSweepSubsystem {
  private destinationWallet: DestinationWallet;
  private minSweepThresholdUsd: number = 50;
  private profitReserveBufferUsd: number = 200;
  private sweepsHistory: ProfitSweep[] = [];

  constructor() {
    this.destinationWallet = {
      address: process.env.DESTINATION_WALLET_ADDRESS || WHITELISTED_PAYOUT_ADDRESS,
      chain: process.env.WALLET_CHAIN || WHITELISTED_PAYOUT_CHAIN,
      label: 'BSC USDT Payout Destination',
      isWhitelisted: true,
      addedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString()
    };

    if (
      this.destinationWallet.address.toLowerCase() !== WHITELISTED_PAYOUT_ADDRESS.toLowerCase() ||
      this.destinationWallet.chain.toLowerCase() !== WHITELISTED_PAYOUT_CHAIN
    ) {
      this.destinationWallet = {
        ...this.destinationWallet,
        address: WHITELISTED_PAYOUT_ADDRESS,
        chain: WHITELISTED_PAYOUT_CHAIN,
        isWhitelisted: true,
        lastVerifiedAt: new Date().toISOString()
      };
      console.warn('[ProfitSweep] Configured payout destination was overridden by the owner-whitelisted BSC destination.');
    }
  }

  public getWallet(): DestinationWallet {
    return { ...this.destinationWallet };
  }

  public updateWallet(wallet: Partial<DestinationWallet>): DestinationWallet {
    const address = String(wallet.address || this.destinationWallet.address).trim();
    const chain = String(wallet.chain || this.destinationWallet.chain).trim().toLowerCase();

    if (address.toLowerCase() !== WHITELISTED_PAYOUT_ADDRESS.toLowerCase()) {
      throw new Error('Payout destination is restricted to the owner-whitelisted BSC address.');
    }

    if (chain !== WHITELISTED_PAYOUT_CHAIN) {
      throw new Error('This payout destination is configured for BSC only.');
    }

    this.destinationWallet = {
      ...this.destinationWallet,
      ...wallet,
      address: WHITELISTED_PAYOUT_ADDRESS,
      chain: WHITELISTED_PAYOUT_CHAIN,
      label: wallet.label || 'BSC USDT Payout Destination',
      isWhitelisted: true,
      lastVerifiedAt: new Date().toISOString()
    };
    return this.getWallet();
  }

  public confirmWallet(address: string): DestinationWallet {
    if (
      address.toLowerCase() !== WHITELISTED_PAYOUT_ADDRESS.toLowerCase() ||
      this.destinationWallet.address.toLowerCase() !== WHITELISTED_PAYOUT_ADDRESS.toLowerCase()
    ) {
      throw new Error('Wallet confirmation does not match the owner-whitelisted BSC destination address.');
    }
    this.destinationWallet.isWhitelisted = true;
    this.destinationWallet.lastVerifiedAt = new Date().toISOString();
    return this.getWallet();
  }

  public getSweepSettings() {
    return {
      destinationWallet: this.destinationWallet,
      minSweepThresholdUsd: this.minSweepThresholdUsd,
      profitReserveBufferUsd: this.profitReserveBufferUsd
    };
  }

  public updateSweepSettings(minThreshold: number, reserveBuffer: number) {
    if (minThreshold >= 10) this.minSweepThresholdUsd = minThreshold;
    if (reserveBuffer >= 0) this.profitReserveBufferUsd = reserveBuffer;
    return this.getSweepSettings();
  }

  public getSweepsHistory(): ProfitSweep[] {
    return [...this.sweepsHistory];
  }

  public calculateSweepEligibility(capital: CapitalAccounting): {
    eligibleAmount: number;
    canSweep: boolean;
    reserveRetained: number;
    reason?: string;
  } {
    // NET REALIZED PROFIT = GROSS - FEES - SLIPPAGE - FUNDING - WITHDRAWAL COSTS
    const netRealizedProfit = Math.max(0, capital.netRealizedProfit);
    const alreadySwept = capital.totalSweptProfit;
    const remainingRealizedProfit = Math.max(0, netRealizedProfit - alreadySwept);

    // Ensure reserve buffer is protected
    const eligibleAmount = Math.max(0, remainingRealizedProfit - this.profitReserveBufferUsd);

    if (eligibleAmount < this.minSweepThresholdUsd) {
      return {
        eligibleAmount,
        canSweep: false,
        reserveRetained: Math.min(remainingRealizedProfit, this.profitReserveBufferUsd),
        reason: `Eligible profit $${eligibleAmount.toFixed(2)} is below minimum sweep threshold of $${this.minSweepThresholdUsd.toFixed(2)}`
      };
    }

    if (!this.destinationWallet.isWhitelisted) {
      return {
        eligibleAmount,
        canSweep: false,
        reserveRetained: this.profitReserveBufferUsd,
        reason: 'Destination wallet address is not whitelisted'
      };
    }

    return {
      eligibleAmount: Number(eligibleAmount.toFixed(2)),
      canSweep: true,
      reserveRetained: this.profitReserveBufferUsd
    };
  }

  public executeSweep(
    amount: number,
    capital: CapitalAccounting,
    operator: 'AUTONOMOUS_SWEEPER' | 'MANUAL_OWNER' = 'MANUAL_OWNER'
  ): { success: boolean; sweep?: ProfitSweep; error?: string } {
    const eligibility = this.calculateSweepEligibility(capital);

    if (amount > eligibility.eligibleAmount) {
      return {
        success: false,
        error: `Requested sweep amount $${amount.toFixed(2)} exceeds eligible profit $${eligibility.eligibleAmount.toFixed(2)}`
      };
    }

    if (amount < this.minSweepThresholdUsd) {
      return {
        success: false,
        error: `Amount must be at least $${this.minSweepThresholdUsd.toFixed(2)}`
      };
    }

    // Safety invariant: this subsystem must never manufacture a transaction hash
    // or mark funds as transferred unless a real exchange withdrawal executor is wired in.
    if (process.env.REAL_SWEEP_EXECUTOR_ENABLED !== 'true') {
      return {
        success: false,
        error: 'Real profit-sweep executor is not configured; no funds were moved.'
      };
    }

    return {
      success: false,
      error: 'Real profit-sweep executor is intentionally unavailable in this build; no funds were moved.'
    };
  }
}
