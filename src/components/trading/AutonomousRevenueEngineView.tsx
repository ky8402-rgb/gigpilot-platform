import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Zap,
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCw,
  Sliders,
  DollarSign,
  ArrowRight,
  Flame,
  Activity,
  Cpu,
  Layers,
  Check,
  Percent,
  Compass,
  FileCode2,
  PieChart
} from 'lucide-react';
import {
  AutonomousOptimizationDecision,
  AutonomousStrategyBuild,
  RevenueAuditReport,
  CapitalAccounting,
  GridConfiguration,
  MarketRegime,
  StrategyVersion,
  StrategyAllocationDecision
} from '../../types/trading';
import { StrategyAllocatorView } from './StrategyAllocatorView';
import { fetchStrategyAllocation } from '../../services/tradingService';

interface AutonomousRevenueEngineViewProps {
  capital: CapitalAccounting;
  grid: GridConfiguration | null;
  regime: MarketRegime;
  champion: StrategyVersion;
  latestAudit: RevenueAuditReport | null;
  latestStrategyAllocation?: StrategyAllocationDecision | null;
  decisions: AutonomousOptimizationDecision[];
  builds: AutonomousStrategyBuild[];
  autoApplyEnabled: boolean;
  onTriggerAuditAndBuild: () => Promise<void>;
  onToggleAutoApply: (enabled: boolean) => Promise<void>;
  onReallocateCapital?: () => Promise<void>;
}

export const AutonomousRevenueEngineView: React.FC<AutonomousRevenueEngineViewProps> = ({
  capital,
  grid,
  regime,
  champion,
  latestAudit,
  latestStrategyAllocation,
  decisions,
  builds,
  autoApplyEnabled,
  onTriggerAuditAndBuild,
  onToggleAutoApply,
  onReallocateCapital
}) => {
  const [isAuditing, setIsAuditing] = useState(false);
  const [selectedBuild, setSelectedBuild] = useState<AutonomousStrategyBuild | null>(null);
  const [currentAllocation, setCurrentAllocation] = useState<StrategyAllocationDecision | null>(
    latestStrategyAllocation || decisions.find(d => d.strategyAllocation)?.strategyAllocation || null
  );

  useEffect(() => {
    if (latestStrategyAllocation) {
      setCurrentAllocation(latestStrategyAllocation);
    } else {
      const fromDec = decisions.find(d => d.strategyAllocation)?.strategyAllocation;
      if (fromDec) {
        setCurrentAllocation(fromDec);
      } else {
        fetchStrategyAllocation().then(res => {
          if (res?.allocation) setCurrentAllocation(res.allocation);
        }).catch(() => {});
      }
    }
  }, [latestStrategyAllocation, decisions]);

  const handleRunAudit = async () => {
    setIsAuditing(true);
    try {
      if (onReallocateCapital) {
        await onReallocateCapital();
      } else {
        await onTriggerAuditAndBuild();
      }
      const res = await fetchStrategyAllocation();
      if (res?.allocation) setCurrentAllocation(res.allocation);
    } finally {
      setIsAuditing(false);
    }
  };

  const audit = latestAudit;

  return (
    <div className="space-y-6 max-w-[1700px] mx-auto pb-12 font-sans">
      {/* 1. Autonomous Mandate Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-950/70 via-slate-900 to-indigo-950/60 border border-purple-500/30 p-6 shadow-2xl">
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-mono font-bold border border-purple-500/40">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                AUTONOMOUS AI SELF-BUILDER
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 text-xs font-mono font-medium border border-emerald-500/30">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ZERO APPROVAL REQUIRED
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 text-xs font-mono border border-amber-500/30">
                <DollarSign className="w-3 h-3" />
                OPTIMIZING STRICTLY FOR NET REVENUE
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Autonomous Revenue Audit & Self-Builder
            </h1>
            <p className="text-slate-300 text-sm leading-relaxed">
              The AI continually inspects real exchange fee drag, market volatility regime, and capital spread capture.
              It audits the live state, reaches a quantitative decision, and <strong className="text-purple-300 font-semibold">directly builds and deploys the strategy improvements itself</strong> without prompting you to choose.
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full lg:w-auto">
            {/* Auto-Deploy Mode Toggle */}
            <div className="flex items-center justify-between gap-3 bg-slate-900/90 border border-slate-700/80 rounded-xl px-4 py-2.5 shadow-inner">
              <div className="text-left">
                <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400">Execution Mode</div>
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${autoApplyEnabled ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`} />
                  {autoApplyEnabled ? 'Autonomous Auto-Deploy' : 'Manual Approval Only'}
                </div>
              </div>
              <button
                onClick={() => onToggleAutoApply(!autoApplyEnabled)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                  autoApplyEnabled
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30 hover:bg-purple-500'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {autoApplyEnabled ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>

            {/* Trigger On-Demand Audit Button */}
            <button
              onClick={handleRunAudit}
              disabled={isAuditing}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-mono font-bold text-xs tracking-wide shadow-lg shadow-purple-900/40 transition-all disabled:opacity-60 active:scale-95"
            >
              <RotateCw className={`w-4 h-4 ${isAuditing ? 'animate-spin text-white' : ''}`} />
              <span>{isAuditing ? 'AUDITING & REALLOCATING...' : 'AUDIT & REALLOCATE NOW'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* STRATEGY ALLOCATOR: WHICH STRATEGY SHOULD RECEIVE CAPITAL RIGHT NOW? */}
      <StrategyAllocatorView
        allocation={currentAllocation}
        regime={regime}
        totalTradingCapitalUsd={capital.tradingCapital || capital.totalEquity}
        onReallocateCapital={handleRunAudit}
      />

      {/* 2. Top Core Revenue Efficiency Gauges */}\n      {!audit && (\n        <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 text-xs font-mono text-amber-200">\n          <strong>LIVE AUDIT DATA UNAVAILABLE.</strong> Revenue efficiency, realized profit, fee burn, and spread-margin metrics are withheld until the backend provides a current audit. No estimated or demo values are displayed as production truth.\n        </div>\n      )}
      {audit && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gauge 1: Revenue Efficiency Score */}
        <div className="bg-[#0B0F19] border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">Revenue Efficiency</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              TARGET: NET ROI
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black font-mono text-purple-300">{audit.revenueEfficiencyScore}</span>
            <span className="text-slate-500 font-mono text-sm">/ 100</span>
          </div>
          <div className="w-full bg-slate-800/80 rounded-full h-2 mt-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-indigo-500 to-purple-400 h-2 rounded-full transition-all duration-700"
              style={{ width: `${audit.revenueEfficiencyScore}%` }}
            />
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-2 flex items-center justify-between">
            <span>Net Retention Post-Fee</span>
            <span className="text-emerald-400 font-bold">
              {audit.revenueEfficiencyScore >= 85 ? 'HIGH EFFICIENCY' : 'FEE DRAG DETECTED'}
            </span>
          </div>
        </div>

        {/* Gauge 2: Net Realized Profit (USDT) */}
        <div className="bg-[#0B0F19] border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">Net Realized Profit</span>
            <span className="p-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <DollarSign className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-3xl font-black font-mono text-emerald-400">
            ${audit.netRealizedProfitUsd.toFixed(2)}
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-3 flex items-center justify-between">
            <span>Capital Equity:</span>
            <span className="text-white font-bold">${capital.totalEquity.toFixed(2)} USDT</span>
          </div>
        </div>

        {/* Gauge 3: Exchange Fee Burn Rate */}
        <div className="bg-[#0B0F19] border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">Exchange Fee Churn</span>
            <span className="p-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Flame className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-3xl font-black font-mono text-amber-400">
            {audit ? `${audit.totalTradingFeesUsd.toFixed(2)}` : '—'}
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-3 flex items-center justify-between">
            <span>Fee / Gross Profit Ratio:</span>
            <span className={`font-bold ${audit.feeToProfitRatioPct > 20 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {audit ? `${audit.feeToProfitRatioPct.toFixed(1)}%` : '—'}
            </span>
          </div>
        </div>

        {/* Gauge 4: Effective Net Spread Margin */}
        <div className="bg-[#0B0F19] border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">Spread Margin</span>
            <span className="p-1 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <Percent className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black font-mono text-sky-400">{audit ? audit.effectiveNetMarginBps : '—'}</span>
            <span className="text-slate-500 font-mono text-xs">bps net</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 mt-3 flex items-center justify-between">
            <span>Active Grid Spacing:</span>
            <span className="text-white font-bold">{grid ? `${grid.gridSpacingPct.toFixed(2)}%` : '—'}</span>
          </div>
        </div>
      </div>

      {/* 3. Anti-Vanity Metric Filter Shield */}
      {audit && <div className="bg-slate-900/60 border border-slate-800/90 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>Anti-Vanity Metric Enforcement Active</span>
              <span className="text-[10px] text-purple-300 bg-purple-950/70 border border-purple-700/50 px-2 py-0.5 rounded">
                PURE NET PROFIT ONLY
              </span>
            </div>
            <div className="text-slate-400 text-[11px] mt-0.5">
              {audit.vanityMetricsFiltered.statement}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-slate-950/80 px-4 py-2 rounded-lg border border-slate-800 text-[11px]">
          <div>
            <span className="text-slate-500 block">Churn Ignored:</span>
            <span className="text-slate-300 font-bold">${audit.vanityMetricsFiltered.grossVolumeIgnoredUsd.toLocaleString()} vol</span>
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div>
            <span className="text-slate-500 block">Fills Ignored:</span>
            <span className="text-slate-300 font-bold">{audit.vanityMetricsFiltered.rawFillsCountIgnored} fills</span>
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div>
            <span className="text-slate-500 block">Cosmetic Win%:</span>
            <span className="text-slate-300 font-bold">{audit.vanityMetricsFiltered.cosmeticWinRateIgnoredPct}%</span>
          </div>
        </div>
      </div>

      {/* 3.5 Microstructure Expected Net Edge Equation */}
      {audit?.expectedNetEdge && (
        <div className="bg-[#0B0F19] border border-cyan-900/40 rounded-xl p-5 shadow-lg relative overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Sliders className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>Microstructure Expected Net Edge Decomposition</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                    audit.expectedNetEdge.isTradeable
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-300 border-rose-500/30 animate-pulse'
                  }`}>
                    {audit.expectedNetEdge.isTradeable ? 'PASS: POSITIVE EXPECTANCY' : 'FAIL-CLOSED: SUB-HURDLE'}
                  </span>
                </h3>
                <p className="text-slate-400 text-xs mt-0.5 font-mono">
                  Expected Gross Edge − maker/taker fees − expected spread cost − expected slippage − adverse-selection cost − funding/other carrying cost − execution uncertainty = Expected Net Edge
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Net Edge Expectancy</div>
              <div className={`text-2xl font-black font-mono ${audit.expectedNetEdge.expectedNetEdgeBps >= 4.0 ? 'text-cyan-300' : 'text-rose-400'}`}>
                {audit.expectedNetEdge.expectedNetEdgeBps > 0 ? `+${audit.expectedNetEdge.expectedNetEdgeBps}` : audit.expectedNetEdge.expectedNetEdgeBps} <span className="text-xs font-normal text-slate-400">bps</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500">Hurdle: ≥{audit.expectedNetEdge.minHurdleRateBps} bps</div>
            </div>
          </div>

          {/* Detailed Waterfall Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs font-mono">
            {/* Step 1: Gross Edge */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-emerald-400 font-bold uppercase">Expected Gross Edge</div>
              <div className="text-base font-black text-white mt-1">+{audit.expectedNetEdge.expectedGrossEdgeBps} <span className="text-[10px] text-slate-400">bps</span></div>
              <div className="text-[9px] text-slate-400 mt-0.5">Rung capture / alpha</div>
            </div>

            {/* Minus 1: Maker/Taker Fees */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-rose-400 font-bold uppercase">− Maker/Taker Fees</div>
              <div className="text-base font-black text-rose-300 mt-1">−{audit.expectedNetEdge.makerTakerFeesBps} <span className="text-[10px] text-slate-400">bps</span></div>
              <div className="text-[9px] text-slate-400 mt-0.5">Exchange fee drag</div>
            </div>

            {/* Minus 2: Spread Cost */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-amber-400 font-bold uppercase">− Spread Cost</div>
              <div className="text-base font-black text-amber-300 mt-1">−{audit.expectedNetEdge.expectedSpreadCostBps} <span className="text-[10px] text-slate-400">bps</span></div>
              <div className="text-[9px] text-slate-400 mt-0.5">Bid-ask crossing cost</div>
            </div>

            {/* Minus 3: Expected Slippage */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-orange-400 font-bold uppercase">− Expected Slippage</div>
              <div className="text-base font-black text-orange-300 mt-1">−{audit.expectedNetEdge.expectedSlippageBps} <span className="text-[10px] text-slate-400">bps</span></div>
              <div className="text-[9px] text-slate-400 mt-0.5">Order size depth impact</div>
            </div>

            {/* Minus 4: Adverse Selection */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-purple-400 font-bold uppercase">− Adverse Selection</div>
              <div className="text-base font-black text-purple-300 mt-1">−{audit.expectedNetEdge.adverseSelectionCostBps} <span className="text-[10px] text-slate-400">bps</span></div>
              <div className="text-[9px] text-slate-400 mt-0.5">Order flow toxicity</div>
            </div>

            {/* Minus 5: Carrying Cost */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-indigo-400 font-bold uppercase">− Carrying Cost</div>
              <div className="text-base font-black text-indigo-300 mt-1">−{audit.expectedNetEdge.fundingCarryingCostBps} <span className="text-[10px] text-slate-400">bps</span></div>
              <div className="text-[9px] text-slate-400 mt-0.5">Inventory holding cost</div>
            </div>

            {/* Minus 6: Execution Uncertainty */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] text-violet-400 font-bold uppercase">− Exec Uncertainty</div>
              <div className="text-base font-black text-violet-300 mt-1">−{audit.expectedNetEdge.executionUncertaintyBps} <span className="text-[10px] text-slate-400">bps</span></div>
              <div className="text-[9px] text-slate-400 mt-0.5">Latency & non-fill decay</div>
            </div>

            {/* Result: Net Edge */}
            <div className={`rounded-lg p-3 border ${audit.expectedNetEdge.isTradeable ? 'bg-cyan-950/40 border-cyan-700/60' : 'bg-rose-950/40 border-rose-700/60'}`}>
              <div className="text-[10px] text-cyan-400 font-bold uppercase">= Expected Net Edge</div>
              <div className={`text-base font-black mt-1 ${audit.expectedNetEdge.isTradeable ? 'text-cyan-200' : 'text-rose-300'}`}>
                {audit.expectedNetEdge.expectedNetEdgeBps > 0 ? `+${audit.expectedNetEdge.expectedNetEdgeBps}` : audit.expectedNetEdge.expectedNetEdgeBps} <span className="text-[10px] text-slate-400">bps</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">
                {audit.expectedNetEdge.isTradeable ? 'Trade Approved' : 'Risk Blocked'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Identified Revenue Leaks Card */}
      {audit && audit.leaks.length > 0 && (
        <div className="bg-[#0B0F19] border border-amber-900/40 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                Audited Revenue Leaks & Auto-Remediations ({audit.leaks.length})
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              Auto-Remediation: <strong className="text-purple-300">Continuous Auto-Build</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {audit.leaks.map((leak) => (
              <div
                key={leak.id}
                className="bg-slate-900/70 border border-slate-800 rounded-lg p-4 flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      {leak.type}
                    </span>
                    <span className="text-[10px] font-mono text-rose-400 font-bold">
                      -${leak.estimatedDailyDragUsd}/day
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-snug">{leak.description}</p>
                </div>
                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-[10px] font-mono text-slate-500 block mb-0.5">AUTO-FIX STRATEGY:</span>
                  <p className="text-[11px] font-mono text-purple-300 font-medium">{leak.recommendedRemediation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Main Double Columns: Autonomous Decisions Feed + Built Strategy Variants */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Autonomous Audit & Decision Feed */}
        <div className="lg:col-span-7 bg-[#0B0F19] border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                Autonomous Audit & Decision Log
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {decisions.length} Cycles Recorded
            </span>
          </div>

          <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
            {decisions.length === 0 ? (
              <div className="text-center py-12 text-slate-500 font-mono text-xs">
                No autonomous decisions recorded yet. Click &quot;Audit &amp; Build Now&quot; to run the initial revenue audit.
              </div>
            ) : (
              decisions.map((dec) => {
                const isAutoApplied = dec.applied;
                return (
                  <div
                    key={dec.id}
                    className={`rounded-xl border p-4 transition-all ${
                      isAutoApplied
                        ? 'bg-slate-900/90 border-purple-500/40 shadow-md shadow-purple-950/20'
                        : 'bg-slate-900/40 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded text-[11px] font-mono font-bold ${
                            dec.decision === 'WIDEN_GRID'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : dec.decision === 'TIGHTEN_GRID'
                              ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                              : dec.decision === 'BUILD_STRATEGY'
                              ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {dec.decision.replace(/_/g, ' ')}
                        </span>

                        <span className="text-[11px] font-mono text-slate-500">
                          Confidence: <strong className="text-white">{(dec.confidence * 100).toFixed(0)}%</strong>
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {isAutoApplied ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <Check className="w-3 h-3" /> AUTO-APPLIED TO LIVE
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                            NO MUTATION
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-slate-500">
                          {new Date(dec.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-200 font-sans leading-relaxed mb-3">
                      {dec.reason}
                    </p>

                    <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">Grid Spacing:</span>
                        {dec.previousGridSpacingPct !== undefined && dec.newGridSpacingPct !== undefined ? (
                          <div className="flex items-center gap-1.5 font-bold">
                            <span className="text-slate-400">{dec.previousGridSpacingPct.toFixed(2)}%</span>
                            <ArrowRight className="w-3 h-3 text-purple-400" />
                            <span className="text-purple-300">{dec.newGridSpacingPct.toFixed(2)}%</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">Unchanged</span>
                        )}
                      </div>

                      <div className="text-emerald-400 font-medium">
                        {dec.expectedEffect}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column (5 cols): Autonomous Built Strategies Registry */}
        <div className="lg:col-span-5 bg-[#0B0F19] border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                Autonomous Strategy Builds
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {builds.length} Builds
            </span>
          </div>

          <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
            {builds.length === 0 ? (
              <div className="text-center py-12 text-slate-500 font-mono text-xs">
                No autonomous builds registered yet. The builder will automatically produce a strategy improvement when revenue criteria are met.
              </div>
            ) : (
              builds.map((b) => {
                const isSelected = selectedBuild?.id === b.id;
                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBuild(isSelected ? null : b)}
                    className={`rounded-xl border p-4 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500/60 shadow-lg'
                        : 'bg-slate-900/60 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {b.status}
                        </span>
                        <span className="text-xs font-bold text-white font-mono">{b.strategyName}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {new Date(b.createdAt).toLocaleTimeString()}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed mb-3">
                      {b.rationale}
                    </p>

                    <div className="grid grid-cols-3 gap-2 bg-slate-950/80 rounded-lg p-2 text-center text-[10px] font-mono border border-slate-800/60">
                      <div>
                        <span className="text-slate-500 block">Spacing</span>
                        <span className="text-purple-300 font-bold">{b.parameters.gridSpacingPct}%</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Levels</span>
                        <span className="text-sky-300 font-bold">{b.parameters.gridLevels}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Vol Mult</span>
                        <span className="text-emerald-300 font-bold">{b.parameters.volatilityMultiplier}x</span>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] font-mono space-y-2 text-slate-300">
                        <div>
                          <span className="text-slate-500 block">Expected Revenue Impact:</span>
                          <span className="text-emerald-300 font-medium">{b.expectedEffect}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Trend Filter EMA:</span>
                          <span>{b.parameters.trendFilterEma}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Parent Strategy ID:</span>
                          <span className="text-slate-400">{b.parentStrategyId}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
