import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart,
  ShieldCheck,
  ArrowUpRight,
  Percent,
  Layers,
  Award,
  Wallet
} from 'lucide-react';
import { CapitalAccounting } from '../../types/trading';

interface CapitalMetricsBarProps {
  capital: CapitalAccounting;
  onOpenSweepModal?: () => void;
}

export const CapitalMetricsBar: React.FC<CapitalMetricsBarProps> = ({
  capital,
  onOpenSweepModal
}) => {
  const isProfitPositive = capital.netRealizedProfit >= 0;
  const isUnrealizedPositive = capital.unrealizedProfit >= 0;

  return (
    <div className="bg-[#0B0F19]/90 border-b border-slate-800/80 px-4 py-2.5">
      <div className="max-w-[1700px] mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {/* 1. Total Equity */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
            <span>TOTAL EQUITY</span>
            <DollarSign className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-base font-extrabold font-mono text-white tracking-tight">
            ${capital.totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 mt-0.5">
            <ArrowUpRight className="w-3 h-3" />
            <span>ROI: +{capital.roiPct}%</span>
          </div>
        </div>

        {/* 2. Net Realized Profit (Net of all fees) */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
            <span>NET REALIZED P&L</span>
            {isProfitPositive ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            )}
          </div>
          <div className={`text-base font-extrabold font-mono tracking-tight ${
            isProfitPositive ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {isProfitPositive ? '+' : ''}${capital.netRealizedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">
            Net after fees & slippage
          </div>
        </div>

        {/* 3. Unrealized PnL */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
            <span>UNREALIZED P&L</span>
            <Percent className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className={`text-base font-extrabold font-mono tracking-tight ${
            isUnrealizedPositive ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {isUnrealizedPositive ? '+' : ''}${capital.unrealizedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            Open Grid Inventory
          </div>
        </div>

        {/* 4. Active Trading Capital */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
            <span>TRADING CAPITAL</span>
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-base font-extrabold font-mono text-cyan-300 tracking-tight">
            ${capital.tradingCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            Cash: ${capital.availableCash.toFixed(0)}
          </div>
        </div>

        {/* 5. Withdrawable Profit & Swept */}
        <div className="bg-slate-900/60 border border-emerald-900/40 bg-emerald-950/10 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-emerald-400 mb-1">
            <span>WITHDRAWABLE PROFIT</span>
            <Wallet className="w-3.5 h-3.5 text-emerald-400 cursor-pointer" onClick={onOpenSweepModal} />
          </div>
          <div className="text-base font-extrabold font-mono text-emerald-300 tracking-tight">
            ${capital.withdrawableProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex justify-between">
            <span>Swept: ${capital.totalSweptProfit.toFixed(0)}</span>
            <span className="text-amber-300">Reserve: ${capital.profitReserve.toFixed(0)}</span>
          </div>
        </div>

        {/* 6. Win Rate & Profit Factor */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
            <span>WIN RATE</span>
            <Award className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-base font-extrabold font-mono text-amber-300 tracking-tight">
            {capital.winRatePct}%
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            PF: <strong className="text-white">{capital.profitFactor}x</strong> ({capital.winningTrades}W / {capital.losingTrades}L)
          </div>
        </div>

        {/* 7. Sharpe & Sortino */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
            <span>SHARPE / SORTINO</span>
            <PieChart className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-base font-extrabold font-mono text-purple-300 tracking-tight">
            {capital.sharpeRatio} / {capital.sortinoRatio}
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
            Ann: +{capital.annualizedReturnPct}%
          </div>
        </div>

        {/* 8. Total Trading Fees & Drawdown */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
            <span>MAX DRAWDOWN</span>
            <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-base font-extrabold font-mono text-slate-200 tracking-tight">
            {capital.maxDrawdownPct}%
          </div>
          <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">
            Fees: -${capital.totalTradingFees.toFixed(1)} USD
          </div>
        </div>
      </div>
    </div>
  );
};
