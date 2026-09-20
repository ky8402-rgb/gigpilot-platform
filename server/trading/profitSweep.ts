import { CapitalAccounting, DestinationWallet, ProfitSweep } from './types.js';
import crypto from 'crypto';

export class ProfitSweepSubsystem {
  private destinationWallet: DestinationWallet;
  private minSweepThresholdUsd: number = 50;
  private profitReserveBufferUsd: number = 200;
  private sweepsHistory: ProfitSweep[] = [];

  constructor() {
    this.destinationWallet = {
      address: process.env.DESTINATION_WALLET_ADDRESS || '0x71C3F90076a0F6722dD581C8390b1F6D829bC39E',
      chain: process.env.WALLET_CHAIN || 'ethereum',
      label: 'Cold Storage Vault (Owner Primary)',
      isWhitelisted: true,
      addedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString()
    };
  }

  public getWallet(): DestinationWallet {
    return { ...this.destinationWallet };
  }

  public updateWallet(wallet: Partial<DestinationWallet>): DestinationWallet {
    this.destinationWallet = {
      ...this.destinationWallet,
      ...wallet,
      lastVerifiedAt: new Date().toISOString()
    };
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

    const networkFeeUsd = this.destinationWallet.chain === 'solana' ? 0.05 : 2.50;
    const netTransferred = amount - networkFeeUsd;

    const txHash = '0x' + crypto.randomBytes(32).toString('hex');
    const auditSignature = crypto
      .createHmac('sha256', 'quant_audit_secret')
      .update(`${txHash}:${amount}:${this.destinationWallet.address}:${Date.now()}`)
      .digest('hex');

    const sweep: ProfitSweep = {
      id: `swp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      destinationWallet: this.destinationWallet.address,
      chain: this.destinationWallet.chain,
      grossSweepAmount: Number(amount.toFixed(2)),
      networkFeeUsd,
      netTransferredUsd: Number(netTransferred.toFixed(2)),
      reserveRetainedUsd: eligibility.reserveRetained,
      status: 'CONFIRMED',
      txHash,
      auditSignature,
      operator
    };

    this.sweepsHistory.unshift(sweep);
    if (this.sweepsHistory.length > 100) this.sweepsHistory.pop();

    return { success: true, sweep };
  }
}
