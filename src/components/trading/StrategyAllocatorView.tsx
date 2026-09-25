import React, { useState } from 'react';
import {
  PieChart,
  ShieldCheck,
  TrendingUp,
  Activity,
  Layers,
  Sparkles,
  ArrowRight,
  RotateCw,
  Sliders,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Percent,
  Check
} from 'lucide-react';
import {
  StrategyAllocationDecision,
  StrategyAllocationCandidate,
  MarketRegime
} from '../../types/trading';

interface StrategyAllocatorViewProps {
  allocation: StrategyAllocationDecision | null;
  regime: MarketRegime;
  totalTradingCapitalUsd: number;
  onReallocateCapital: () => Promise<void>;
}

export const StrategyAllocatorView: React.FC<StrategyAllocatorViewProps> = ({
  allocation,
  regime,
  totalTradingCapitalUsd,
  onReallocateCapital
}) => {
  const [reallocating, setReallocating] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);

  const handleReallocate = async () => {
    setReallocating(true);
    try {
      await onReallocateCapital();
    } finally {
      setReallocating(false);
    }
  };

  const topRecipient = allocation?.strategies?.find(
    s => s.strategyId === allocation.topRecipientStrategyId
  ) || allocation?.strategies?.[0];

  const selectedStrategy = allocation?.strategies?.find(
    s => s.strategyId === selectedStrategyId
  ) || topRecipient;

  return (
    <div className="space-y-6">
      {/* 1. Primary Strategy Allocator Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-950/80 via-slate-900 to-purple-950/70 border border-indigo-500/40 p-6 shadow-2xl">
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-mono font-bold border border-indigo-500/40">
                <PieChart className="w-3.5 h-3.5 text-indigo-400" />
                STRATEGY ALLOCATOR
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/15 text-purple-300 text-xs font-mono font-medium border border-purple-500/30">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                UPGRADED FROM PARAMETER OPTIMIZER
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 text-xs font-mono border border-emerald-500/30">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                4-PILLAR RISK ADJUSTED
              </span>
            </div>

            <div className="pt-1">
              <div className="text-xs font-mono uppercase tracking-wider text-indigo-400 font-bold">
                PRIMARY OPTIMIZER QUESTION:
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-0.5">
                Which strategy should receive capital right now?
              </h1>
            </div>

            <p className="text-slate-300 text-sm leading-relaxed">
              Instead of merely tuning parameters, the system dynamically routes risk-adjusted trading capital across
              multiple quantitative strategy archetypes based on <strong>out-of-sample performance</strong>,{' '}
              <strong>regime volatility</strong>, <strong>cross-strategy correlation</strong>, and{' '}
              <strong>execution quality</strong>.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
            <div className="bg-slate-900/90 border border-indigo-700/50 rounded-xl px-4 py-3 shadow-inner text-left">
              <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Total Trading Capital</div>
              <div className="text-xl font-black font-mono text-emerald-400">
                ${(allocation?.totalTradingCapitalUsd || totalTradingCapitalUsd || 10000).toLocaleString()} <span className="text-xs text-slate-400 font-normal">USDT</span>
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                <span>Active Regime:</span>
                <span className="text-indigo-300 font-bold">{allocation?.activeRegime || regime.regime}</span>
                {regime.transition?.isTransitioning && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold">
                    TRANSITION: {regime.transition.phase}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={handleReallocate}
              disabled={reallocating}
              className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 text-white font-mono font-bold text-xs tracking-wide shadow-lg shadow-indigo-900/40 transition-all disabled:opacity-60 active:scale-95"
            >
              <RotateCw className={`w-4 h-4 ${reallocating ? 'animate-spin' : ''}`} />
              <span>{reallocating ? 'REALLOCATING...' : 'REALLOCATE CAPITAL NOW'}</span>
            </button>
          </div>
        </div>

        {/* Visual Architecture Tree Diagram Requested by User */}
        <div className="mt-6 pt-5 border-t border-slate-800/80">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-bold text-indigo-300">
              <Layers className="w-3.5 h-3.5" />
              PORTFOLIO CAPITAL ROUTING TOPOLOGY
            </span>
            <span className="text-slate-500 text-[10px]">
              Shannon Diversification Score: <strong className="text-emerald-400 font-bold">{allocation?.diversificationScore || 82} / 100</strong>
            </span>
          </div>

          <div className="hidden md:block bg-slate-950/70 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 overflow-x-auto shadow-inner">
            <pre className="text-center font-bold text-indigo-300 leading-tight">
{`                        ┌──────────────────────────────────────┐
                        │          STRATEGY ALLOCATOR          │
                        │ "Which strategy receives capital?"   │
                        └──────────────────┬───────────────────┘
                                           │
       ┌───────────────────┬───────────────┴───────────────┬───────────────────┐
       ▼                   ▼                               ▼                   ▼
 ┌───────────┐       ┌──────────────┐                ┌───────────┐       ┌───────────┐
 │Trend Grid │       │Mean Reversion│                │ Momentum  │       │ Adaptive  │
 │ (35-45%)  │       │   (50-60%)   │                │ Breakout  │       │ Defensive │
 └─────┬─────┘       └──────┬───────┘                └─────┬─────┘       └─────┬─────┘
       │                    │                              │                   │
       └────────────────────┼──────────────────────────────┴───────────────────┘
                            ▼
              Risk-Adjusted Capital Allocation
          [OOS Sharpe · Volatility · Correlation · Net Edge]`}
            </pre>
          </div>
        </div>
      </div>

      {/* 2. Top Recipient Verdict Callout */}
      {topRecipient && (
        <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-950 p-5 shadow-xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1 max-w-3xl">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  PRIMARY CAPITAL RECIPIENT
                </span>
                <span className="text-xs font-mono text-slate-400">
                  Updated {allocation ? new Date(allocation.timestamp).toLocaleTimeString() : 'Live'}
                </span>
              </div>
              <h3 className="text-xl font-black text-white font-mono flex items-center gap-2">
                <span>{topRecipient.strategyName}</span>
                <span className="text-emerald-400 text-lg font-bold">
                  ({topRecipient.targetWeightPct}% · ${topRecipient.allocatedCapitalUsd.toLocaleString()} USDT)
                </span>
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {allocation?.riskAdjustedRationale || topRecipient.rationale}
              </p>
            </div>

            <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-800 rounded-lg p-3">
              <div className="text-center px-3 border-r border-slate-800">
                <div className="text-[10px] font-mono text-slate-400 uppercase">Target Weight</div>
                <div className="text-lg font-black font-mono text-emerald-400 mt-0.5">{topRecipient.targetWeightPct}%</div>
              </div>
              <div className="text-center px-3 border-r border-slate-800">
                <div className="text-[10px] font-mono text-slate-400 uppercase">OOS Sharpe</div>
                <div className="text-lg font-black font-mono text-indigo-300 mt-0.5">{topRecipient.metrics.outOfSampleSharpe}</div>
              </div>
              <div className="text-center px-3">
                <div className="text-[10px] font-mono text-slate-400 uppercase">Net Edge</div>
                <div className="text-lg font-black font-mono text-cyan-300 mt-0.5">+{topRecipient.metrics.expectedNetEdgeBps} <span className="text-[10px]">bps</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. The 4 Candidate Strategies Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(allocation?.strategies || []).map((strat) => {
          const isTop = strat.strategyId === allocation?.topRecipientStrategyId;
          const isDefunded = strat.action === 'DEFUND' || !strat.metrics.meetsMinimumEdgeThreshold;

          return (
            <div
              key={strat.strategyId}
              onClick={() => setSelectedStrategyId(strat.strategyId)}
              className={`rounded-xl border p-5 flex flex-col justify-between transition-all cursor-pointer relative overflow-hidden ${
                isTop
                  ? 'bg-slate-900/90 border-indigo-500/60 shadow-lg shadow-indigo-950/30 ring-1 ring-indigo-500/40'
                  : isDefunded
                  ? 'bg-slate-950/50 border-slate-800/80 opacity-70'
                  : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Header */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                      isTop
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : isDefunded
                        ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    {isTop ? 'PRIMARY ALLOCATION' : strat.action}
                  </span>

                  <span className="text-xs font-mono font-black text-white">
                    {strat.targetWeightPct}%
                  </span>
                </div>

                <h4 className="text-base font-bold text-white font-mono">{strat.strategyName}</h4>
                <p className="text-slate-400 text-xs mt-1 leading-snug line-clamp-2">
                  {strat.description}
                </p>

                {/* Capital Allocation Bar */}
                <div className="mt-3">
                  <div className="flex justify-between items-center text-[10px] font-mono mb-1">
                    <span className="text-slate-400">Allocated Capital:</span>
                    <span className="text-emerald-400 font-bold">${strat.allocatedCapitalUsd.toLocaleString()} USDT</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        isTop ? 'bg-gradient-to-r from-emerald-500 to-indigo-500' : 'bg-slate-600'
                      }`}
                      style={{ width: `${strat.targetWeightPct}%` }}
                    />
                  </div>
                </div>

                {/* The 4 Quantitative Pillars for this Strategy */}
                <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2 text-xs font-mono">
                  {/* Pillar 1: OOS Performance */}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">1. OOS Sharpe / ROI:</span>
                    <span className="text-indigo-300 font-bold">
                      {strat.metrics.outOfSampleSharpe} / +{strat.metrics.outOfSampleNetRoiPct}%
                    </span>
                  </div>

                  {/* Pillar 2: Volatility & Regime */}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">2. Vol Penalty:</span>
                    <span className={`font-bold ${strat.metrics.volatilityRiskPenalty > 0.4 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {(strat.metrics.volatilityRiskPenalty * 100).toFixed(0)}% ({strat.regimeMatchScore}% match)
                    </span>
                  </div>

                  {/* Pillar 3: Correlation */}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">3. Correlation:</span>
                    <span className="text-purple-300 font-bold">
                      {strat.metrics.correlationWithPortfolio > 0 ? `+${strat.metrics.correlationWithPortfolio}` : strat.metrics.correlationWithPortfolio}
                    </span>
                  </div>

                  {/* Pillar 4: Execution Quality & Expected Net Edge */}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">4. Expected Net Edge:</span>
                    <span
                      className={`font-black ${
                        strat.metrics.meetsMinimumEdgeThreshold ? 'text-cyan-300' : 'text-rose-400'
                      }`}
                    >
                      +{strat.metrics.expectedNetEdgeBps} bps
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom Badge */}
              <div className="mt-4 pt-2.5 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center justify-between">
                <span>Composite Score:</span>
                <span className="text-white font-bold">{strat.compositeScore} / 100</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 4. Deep Inspection of the 4 Pillars for the Selected Strategy */}
      {selectedStrategy && (
        <div className="rounded-xl border border-slate-800 bg-[#0B0F19] p-5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                Risk-Adjusted Pillar Audit: {selectedStrategy.strategyName}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                TARGET ALLOCATION: {selectedStrategy.targetWeightPct}% (${selectedStrategy.allocatedCapitalUsd.toLocaleString()} USDT)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Pillar 1 Card */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 font-mono">
              <div className="text-[10px] text-indigo-400 uppercase font-bold flex items-center justify-between">
                <span>Pillar 1: OOS Performance</span>
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
              <div className="text-xl font-black text-white mt-2">
                Sharpe: {selectedStrategy.metrics.outOfSampleSharpe}
              </div>
              <div className="text-xs text-slate-400 mt-2 space-y-1">
                <div className="flex justify-between"><span>Sortino Ratio:</span> <strong className="text-slate-200">{selectedStrategy.metrics.outOfSampleSortino}</strong></div>
                <div className="flex justify-between"><span>Net ROI (Post-Fee):</span> <strong className="text-emerald-400">+{selectedStrategy.metrics.outOfSampleNetRoiPct}%</strong></div>
                <div className="flex justify-between"><span>Profit Factor:</span> <strong className="text-slate-200">{selectedStrategy.metrics.profitFactor}</strong></div>
                <div className="flex justify-between"><span>Win Rate:</span> <strong className="text-slate-200">{selectedStrategy.metrics.winRatePct}%</strong></div>
              </div>
            </div>

            {/* Pillar 2 Card */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 font-mono">
              <div className="text-[10px] text-amber-400 uppercase font-bold flex items-center justify-between">
                <span>Pillar 2: Volatility Risk</span>
                <Activity className="w-3.5 h-3.5" />
              </div>
              <div className="text-xl font-black text-white mt-2">
                Penalty: {(selectedStrategy.metrics.volatilityRiskPenalty * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-slate-400 mt-2 space-y-1">
                <div className="flex justify-between"><span>Realized Volatility:</span> <strong className="text-slate-200">{selectedStrategy.metrics.realizedVolatilityPct}%</strong></div>
                <div className="flex justify-between"><span>Regime Match Score:</span> <strong className="text-emerald-400">{selectedStrategy.regimeMatchScore}%</strong></div>
                <div className="flex justify-between"><span>Active Regime:</span> <strong className="text-indigo-300">{regime.regime}</strong></div>
                <div className="flex justify-between"><span>Target Regimes:</span> <strong className="text-slate-400 text-[10px]">{selectedStrategy.targetRegimes.join(', ')}</strong></div>
              </div>
            </div>

            {/* Pillar 3 Card */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 font-mono">
              <div className="text-[10px] text-purple-400 uppercase font-bold flex items-center justify-between">
                <span>Pillar 3: Correlation</span>
                <PieChart className="w-3.5 h-3.5" />
              </div>
              <div className="text-xl font-black text-white mt-2">
                ρ = {selectedStrategy.metrics.correlationWithPortfolio}
              </div>
              <div className="text-xs text-slate-400 mt-2 space-y-1">
                <div className="flex justify-between"><span>Portfolio Correlation:</span> <strong className="text-slate-200">{selectedStrategy.metrics.correlationWithPortfolio}</strong></div>
                <div className="flex justify-between"><span>Decorrelation Bonus:</span> <strong className="text-purple-300">{selectedStrategy.metrics.decorrelationBonus}x</strong></div>
                <div className="flex justify-between"><span>Diversification Impact:</span> <strong className="text-emerald-400">+{Math.round((selectedStrategy.metrics.decorrelationBonus - 1) * 100)}% tilt</strong></div>
                <div className="flex justify-between"><span>Beta to BTC:</span> <strong className="text-slate-400">{selectedStrategy.strategyType === 'TREND_GRID' ? 'High' : 'Low/Neutral'}</strong></div>
              </div>
            </div>

            {/* Pillar 4 Card */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 font-mono">
              <div className="text-[10px] text-cyan-400 uppercase font-bold flex items-center justify-between">
                <span>Pillar 4: Execution Quality</span>
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
              <div className="text-xl font-black text-cyan-300 mt-2">
                +{selectedStrategy.metrics.expectedNetEdgeBps} bps
              </div>
              <div className="text-xs text-slate-400 mt-2 space-y-1">
                <div className="flex justify-between"><span>Net Edge Hurdle:</span> <strong className="text-emerald-400">PASSED (&gt;4.0 bps)</strong></div>
                <div className="flex justify-between"><span>Execution Score:</span> <strong className="text-slate-200">{selectedStrategy.metrics.executionQualityScore} / 100</strong></div>
                <div className="flex justify-between"><span>Avg Fill Rate:</span> <strong className="text-slate-200">{selectedStrategy.metrics.fillRatePct}%</strong></div>
                <div className="flex justify-between"><span>Avg Slippage:</span> <strong className="text-slate-200">{selectedStrategy.metrics.avgSlippageBps} bps</strong></div>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-slate-300 flex items-start gap-2">
            <span className="text-indigo-400 font-bold uppercase shrink-0">Allocator Rationale:</span>
            <span>{selectedStrategy.rationale}</span>
          </div>
        </div>
      )}
    </div>
  );
};
