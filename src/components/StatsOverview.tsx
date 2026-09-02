import React from 'react';
import { 
  DollarSign, 
  Target, 
  Bot, 
  CreditCard,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { AutopilotRules, ActiveContract } from '../types';

interface StatsOverviewProps {
  totalEarnings: number;
  activeContracts: ActiveContract[];
  rules: AutopilotRules;
  bidsSubmittedCount: number;
  interviewsWonCount: number;
  totalConnectsUsed: number;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({
  totalEarnings,
  activeContracts,
  rules,
  bidsSubmittedCount,
  interviewsWonCount,
  totalConnectsUsed
}) => {
  // Active in-progress contract values
  const activePipelineValue = activeContracts
    .filter(c => c.status === 'in_progress' || c.status === 'review')
    .reduce((acc, curr) => acc + (curr.totalValue - curr.amountPaid), 0);

  // Win Rate
  const winRate = bidsSubmittedCount > 0 
    ? Math.round((interviewsWonCount / bidsSubmittedCount) * 100) 
    : 0;

  // ROI on connects
  const roiPerConnect = totalConnectsUsed > 0 
    ? (totalEarnings / (totalConnectsUsed * 0.15)).toFixed(1) 
    : '0.0';

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      
      {/* Metric 1: Total Revenue Generated */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm transition-all hover:border-emerald-500/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Net Earnings</span>
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
            <DollarSign className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline space-x-2">
          <div className="font-mono text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            ${totalEarnings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          {totalEarnings > 0 && (
            <span className="flex items-center text-xs font-bold text-emerald-400">
              <ArrowUpRight className="h-3.5 w-3.5" />
              Live
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>Active Escrow: <strong className="text-slate-200">${activePipelineValue.toLocaleString()}</strong></span>
          <span className="font-mono text-emerald-400/80">{activeContracts.length} Active {activeContracts.length === 1 ? 'Contract' : 'Contracts'}</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-transparent" />
      </div>

      {/* Metric 2: Proposal & Bid Metrics */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm transition-all hover:border-cyan-500/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Proposal Win Rate</span>
          <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400 border border-cyan-500/20">
            <Target className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline space-x-2">
          <div className="font-mono text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            {winRate}%
          </div>
          <span className="text-xs font-medium text-cyan-300">
            {interviewsWonCount} Won / {bidsSubmittedCount} Sent
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>Connects Used: <strong className="text-slate-200">{totalConnectsUsed}</strong></span>
          <span className="font-mono text-cyan-400/80">ROI: {roiPerConnect}x</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-cyan-500 via-blue-400 to-transparent" />
      </div>

      {/* Metric 3: Bot Autopilot Rules */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm transition-all hover:border-amber-500/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Autonomous Filter</span>
          <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 border border-amber-500/20">
            <Bot className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline space-x-2">
          <div className="font-mono text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            {rules.bidsToday} / {rules.maxDailyBids}
          </div>
          <span className="text-xs font-medium text-amber-300">
            Bids Cap
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>Min Match: <strong className="text-slate-200">{rules.minMatchScore}%</strong></span>
          <span className="flex items-center text-emerald-400">
            <ShieldCheck className="mr-1 h-3 w-3" />
            Verified Clients
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-amber-500 via-orange-400 to-transparent" />
      </div>

      {/* Metric 4: Direct Payment Gateways */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-sm transition-all hover:border-emerald-500/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Payout Channels</span>
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
            <CreditCard className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline space-x-2">
          <div className="font-mono text-xl font-extrabold tracking-tight text-emerald-400 sm:text-2xl">
            Live &amp; Ready
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center text-slate-300">
            <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-400" />
            PayPal &amp; Bank IMPS/UPI
          </span>
          <span className="font-mono text-emerald-400">Verified</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-emerald-500 via-teal-400 to-transparent" />
      </div>

    </div>
  );
};

