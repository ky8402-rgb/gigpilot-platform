import React from 'react';

interface DashboardMetricsCardsProps {
  totalBids: number;
  activeBids: number;
  wonBids: number;
  earnedAmount: number;
  winRate: number;
  fmt: (n: number) => string;
}

export const DashboardMetricsCards: React.FC<DashboardMetricsCardsProps> = ({
  totalBids,
  activeBids,
  wonBids,
  earnedAmount,
  winRate,
  fmt,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      
      {/* Card 1: Total Dispatched Bids */}
      <div
        id="stat-card-total-bids"
        className="bg-[#0f1420] border border-slate-800/90 rounded-2xl p-4 sm:p-5 hover:border-blue-500/50 transition-all shadow-md group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Total Dispatched
          </span>
          <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs group-hover:scale-105 transition-transform">
            <i className="fas fa-paper-plane"></i>
          </div>
        </div>
        <div id="total-bids" className="text-2xl sm:text-3xl font-bold font-mono text-white tracking-tight">
          {totalBids}
        </div>
        <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
          <span className="text-blue-400 font-semibold flex items-center gap-1">
            <i className="fas fa-robot text-[10px]"></i> Auto-Bid
          </span>
          <span className="text-slate-500">•</span>
          <span className="truncate">Freelancer.com</span>
        </div>
      </div>

      {/* Card 2: Active / In-Review */}
      <div
        id="stat-card-active-bids"
        className="bg-[#0f1420] border border-slate-800/90 rounded-2xl p-4 sm:p-5 hover:border-amber-500/50 transition-all shadow-md group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Active Proposals
          </span>
          <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs group-hover:scale-105 transition-transform">
            <i className="fas fa-hourglass-half"></i>
          </div>
        </div>
        <div id="active-bids" className="text-2xl sm:text-3xl font-bold font-mono text-white tracking-tight">
          {activeBids}
        </div>
        <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
          <span className="text-amber-400 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
            Live Review
          </span>
          <span className="text-slate-500">•</span>
          <span className="truncate">Pending client quote</span>
        </div>
      </div>

      {/* Card 3: Won Contracts */}
      <div
        id="stat-card-won-bids"
        className="bg-[#0f1420] border border-slate-800/90 rounded-2xl p-4 sm:p-5 hover:border-emerald-500/50 transition-all shadow-md group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Won Contracts
          </span>
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs group-hover:scale-105 transition-transform">
            <i className="fas fa-trophy"></i>
          </div>
        </div>
        <div id="won-bids" className="text-2xl sm:text-3xl font-bold font-mono text-white tracking-tight">
          {wonBids}
        </div>
        <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            <i className="fas fa-check-circle text-[10px]"></i> +{wonBids}
          </span>
          <span className="text-slate-500">•</span>
          <span className="truncate">Verified awards</span>
        </div>
      </div>

      {/* Card 4: Settled Revenue (USD) */}
      <div
        id="stat-card-earned"
        className="bg-[#0f1420] border border-slate-800/90 rounded-2xl p-4 sm:p-5 hover:border-emerald-500/50 transition-all shadow-md group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Settled Revenue
          </span>
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs group-hover:scale-105 transition-transform">
            <i className="fas fa-dollar-sign"></i>
          </div>
        </div>
        <div id="earned" className="text-2xl sm:text-3xl font-bold font-mono text-white tracking-tight flex items-baseline gap-1">
          <span>${fmt(earnedAmount)}</span>
          <span className="text-xs text-slate-400 font-normal font-sans">USD</span>
        </div>
        <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            <i className="fab fa-paypal text-[10px]"></i> PayPal
          </span>
          <span className="text-slate-500">•</span>
          <span className="truncate">Direct settlement</span>
        </div>
      </div>

      {/* Card 5: Win Conversion Rate */}
      <div
        id="stat-card-win-rate"
        className="bg-[#0f1420] border border-slate-800/90 rounded-2xl p-4 sm:p-5 hover:border-purple-500/50 transition-all shadow-md group"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">
            Win Conversion
          </span>
          <div className="w-7 h-7 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs group-hover:scale-105 transition-transform">
            <i className="fas fa-percentage"></i>
          </div>
        </div>
        <div id="win-rate" className="text-2xl sm:text-3xl font-bold font-mono text-white tracking-tight">
          {winRate}%
        </div>
        <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5">
          <span className="text-purple-400 font-semibold flex items-center gap-1">
            <i className="fas fa-chart-line text-[10px]"></i> Benchmark
          </span>
          <span className="text-slate-500">•</span>
          <span className="truncate">Auto-pitch score</span>
        </div>
      </div>

    </div>
  );
};
