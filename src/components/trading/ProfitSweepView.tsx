import React, { useState } from 'react';
import {
  CapitalAccounting,
  DestinationWallet,
  ProfitSweep
} from '../../types/trading';
import {
  Wallet,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  History,
  Lock,
  Zap,
  AlertCircle
} from 'lucide-react';
import {
  executeProfitSweep,
  updateDestinationWallet
} from '../../services/tradingService';

interface ProfitSweepViewProps {
  capital: CapitalAccounting;
  destinationWallet: DestinationWallet;
  sweepEligibility: {
    eligibleAmount: number;
    canSweep: boolean;
    reserveRetained: number;
    reason?: string;
  };
  sweepsHistory: ProfitSweep[];
  onRefreshState: () => void;
}

export const ProfitSweepView: React.FC<ProfitSweepViewProps> = ({
  capital,
  destinationWallet,
  sweepEligibility,
  sweepsHistory = [],
  onRefreshState
}) => {
  const [walletAddress, setWalletAddress] = useState(destinationWallet?.address || '');
  const [walletChain, setWalletChain] = useState(destinationWallet?.chain || 'BSC');
  const [walletLabel, setWalletLabel] = useState(destinationWallet?.label || '');
  const [sweepAmount, setSweepAmount] = useState(
    typeof sweepEligibility?.eligibleAmount === 'number' && sweepEligibility.eligibleAmount > 0
      ? sweepEligibility.eligibleAmount.toFixed(2)
      : '500.00'
  );
  const [isUpdatingWallet, setIsUpdatingWallet] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [walletNotice, setWalletNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sweepSuccessMessage, setSweepSuccessMessage] = useState<string | null>(null);
  const [sweepErrorMessage, setSweepErrorMessage] = useState<string | null>(null);

  const handleUpdateWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingWallet(true);
    setWalletNotice(null);
    try {
      await updateDestinationWallet({
        address: walletAddress,
        chain: walletChain,
        label: walletLabel
      });
      setWalletNotice({ type: 'success', text: 'Whitelisted payout destination wallet updated successfully!' });
      onRefreshState();
    } catch (err: any) {
      setWalletNotice({ type: 'error', text: `Failed to update wallet: ${err.message || 'Unknown error'}` });
    } finally {
      setIsUpdatingWallet(false);
    }
  };

  const handleExecuteSweep = async () => {
    setIsSweeping(true);
    setSweepSuccessMessage(null);
    setSweepErrorMessage(null);

    try {
      const res = await executeProfitSweep(Number(sweepAmount));
      if (!res.success) {
        setSweepErrorMessage(res.error || 'Failed to execute profit sweep');
      } else {
        const destStr = typeof destinationWallet?.address === 'string' && destinationWallet.address.length > 0
          ? `${destinationWallet.address.substring(0, 10)}...`
          : 'vault';
        const txStr = typeof res.sweep?.txHash === 'string' && res.sweep.txHash.length > 0
          ? ` (Tx: ${res.sweep.txHash.substring(0, 16)}...)`
          : '';
        setSweepSuccessMessage(
          `Successfully swept $${Number(sweepAmount).toLocaleString()} USD to ${destStr}${txStr}`
        );
        onRefreshState();
      }
    } catch (err: any) {
      setSweepErrorMessage(err.message);
    } finally {
      setIsSweeping(false);
    }
  };

  const safeCapital = capital || {
    initialCapital: 0,
    netRealizedProfit: 0,
    profitReserve: 0,
    totalSweptProfit: 0
  };

  const safeEligibility = sweepEligibility || {
    eligibleAmount: 0,
    canSweep: false,
    reserveRetained: 0
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto font-mono text-xs">
      {/* 1. Header & Strict Capital Safeguards Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4 mb-4">
          <div className="w-9 h-9 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Automated Wallet Profit Sweep Subsystem
            </h2>
            <p className="text-[11px] text-slate-400">
              Never lets trading profits sit idle on exchanges. Only realized net profit is swept to your whitelisted private cold vault.
            </p>
          </div>
        </div>

        {/* Capital Flow Segregation Breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
            <span className="text-slate-500 block text-[10px]">INITIAL CAPITAL (PROTECTED)</span>
            <span className="text-sm font-bold text-white">
              ${safeCapital.initialCapital.toLocaleString()}
            </span>
            <span className="text-[10px] text-emerald-400 block mt-0.5">Never sweepable</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
            <span className="text-slate-500 block text-[10px]">NET REALIZED PROFIT</span>
            <span className="text-sm font-bold text-emerald-400">
              +${safeCapital.netRealizedProfit.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Net after all fees</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
            <span className="text-slate-500 block text-[10px]">PROFIT RESERVE BUFFER</span>
            <span className="text-sm font-bold text-amber-300">
              ${safeCapital.profitReserve.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Retained liquidity buffer</span>
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-emerald-900/60 bg-emerald-950/20">
            <span className="text-emerald-400 block text-[10px]">ELIGIBLE FOR SWEEP</span>
            <span className="text-sm font-extrabold text-emerald-300">
              ${safeEligibility.eligibleAmount.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-300 block mt-0.5">
              Swept to date: ${safeCapital.totalSweptProfit.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Sweep Execution Box */}
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4">
          <h3 className="font-bold text-white text-xs mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span>Execute On-Demand Profit Sweep to Whitelisted Vault</span>
          </h3>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-slate-400 block mb-1 text-[11px]">Sweep Amount (USD)</label>
              <input
                type="number"
                step="10"
                value={sweepAmount}
                onChange={e => setSweepAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-end pt-5">
              <button
                onClick={handleExecuteSweep}
                disabled={isSweeping || !sweepEligibility.canSweep}
                className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50 font-mono"
              >
                {isSweeping ? 'Sweeping to Vault...' : 'Sweep Realized Profit Now'}
              </button>
            </div>
          </div>

          {sweepSuccessMessage && (
            <div className="mt-3 p-3 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{sweepSuccessMessage}</span>
            </div>
          )}

          {sweepErrorMessage && (
            <div className="mt-3 p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{sweepErrorMessage}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Destination Wallet Whitelist Config */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2.5 mb-4">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Whitelisted Payout Destination Wallet
          </h3>
        </div>

        <form onSubmit={handleUpdateWallet} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-slate-400 block mb-1">Vault Public Address (0x... / bc1...)</label>
              <input
                type="text"
                value={walletAddress}
                onChange={e => setWalletAddress(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Blockchain Network</label>
              <select
                value={walletChain}
                onChange={e => setWalletChain(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
              >
                <option value="BSC">BSC (BNB Smart Chain - BEP-20 USDT)</option>
                <option value="Ethereum (ERC-20 USDT/USDC)">Ethereum (ERC-20 USDT/USDC)</option>
                <option value="Arbitrum One (Low Fee)">Arbitrum One (Low Fee)</option>
                <option value="Solana (SPL USDC)">Solana (SPL USDC)</option>
                <option value="Bitcoin Native (bc1...)">Bitcoin Native (bc1...)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[10px] text-slate-500">
              Security: Whitelist latch prevents routing funds to unapproved addresses.
            </span>
            <button
              type="submit"
              disabled={isUpdatingWallet}
              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold transition-colors"
            >
              {isUpdatingWallet ? 'Saving...' : 'Update Whitelisted Address'}
            </button>
          </div>
        </form>
      </div>

      {/* 3. Historical Sweeps Ledger */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Profit Sweep Payout Ledger & Blockchain Receipts
          </h3>
        </div>

        {sweepsHistory.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            No profit sweeps recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Date / Time</th>
                  <th className="py-2.5 px-3">Destination Wallet</th>
                  <th className="py-2.5 px-3">Network</th>
                  <th className="py-2.5 px-3">Gross Sweep</th>
                  <th className="py-2.5 px-3">Tx Hash</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {sweepsHistory.map(s => (
                  <tr key={s.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-3 text-slate-400">
                      {new Date(s.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300 font-bold">
                      {typeof s.destinationWallet === 'string' && s.destinationWallet.length >= 14
                        ? `${s.destinationWallet.substring(0, 8)}...${s.destinationWallet.slice(-6)}`
                        : (s.destinationWallet || 'N/A')}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">{s.chain || 'N/A'}</td>
                    <td className="py-2.5 px-3 text-emerald-400 font-extrabold">
                      ${(s.grossSweepAmount ?? 0).toLocaleString()} USD
                    </td>
                    <td className="py-2.5 px-3 text-cyan-400 flex items-center gap-1 font-mono">
                      <span>{typeof s.txHash === 'string' && s.txHash.length > 0 ? `${s.txHash.substring(0, 12)}...` : 'N/A'}</span>
                      <ExternalLink className="w-3 h-3 opacity-70" />
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold">
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
