import React, { useEffect, useState } from 'react';
import { BrainCircuit, RefreshCw, ShieldCheck, Zap, PieChart, Layers, ArrowRight } from 'lucide-react';
import { fetchAutonomousOptimizer, runAutonomousOptimizer } from '../../services/tradingService';

export const AutonomousProfitOptimizerView: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const refresh = async () => { try { setData(await fetchAutonomousOptimizer()); } catch {} };
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, []);
  const runNow = async () => { setRunning(true); try { await runAutonomousOptimizer(); await refresh(); } finally { setRunning(false); } };
  const decision = data?.decisions?.[0];
  const build = data?.strategyBuilds?.[0];
  const edge = data?.latestAudit?.expectedNetEdge;
  const auditReport = data?.latestAudit;
  const costEvidence = auditReport?.costEvidence;
  const allocation = data?.latestStrategyAllocation || decision?.strategyAllocation;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-indigo-700/50 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-indigo-300 font-mono text-xs font-black uppercase tracking-wider">
              <PieChart className="w-4 h-4 text-indigo-400" /> Autonomous Strategy Portfolio Allocator
            </div>
            <h2 className="mt-1 text-xl font-black text-white">Which strategy should receive capital right now?</h2>
            <p className="mt-1 text-xs text-slate-400">
              Risk-adjusted portfolio routing across Trend Grid, Mean Reversion, Momentum Breakout, and Adaptive Defensive based on out-of-sample performance, volatility, correlation, and execution quality.
            </p>
          </div>
          <button onClick={runNow} disabled={running} className="px-4 py-2 rounded-lg border border-indigo-600/50 bg-indigo-950/70 text-indigo-200 text-xs font-bold flex items-center gap-2 hover:bg-indigo-900/80 transition-all">
            <Zap className="w-3.5 h-3.5" /> {running ? 'REALLOCATING...' : 'REALLOCATE CAPITAL NOW'}
          </button>
        </div>
      </div>

      {/* Strategy Allocation Cards if available */}
      {allocation && (
        <div className="rounded-xl border border-indigo-800/40 bg-slate-950/80 p-4 font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5 mb-3 text-xs">
            <span className="text-indigo-300 font-bold flex items-center gap-1.5 uppercase">
              <Layers className="w-4 h-4" /> Capital Allocation by Strategy Archetype (Total: ${allocation.totalTradingCapitalUsd?.toLocaleString()} USDT)
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-900/60 text-indigo-300">
              Top Recipient: {allocation.topRecipientStrategyName}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(allocation.strategies || []).map((s: any) => (
              <div key={s.strategyId} className={`p-3 rounded-lg border ${s.strategyId === allocation.topRecipientStrategyId ? 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500/40' : 'bg-slate-900/70 border-slate-800'}`}>
                <div className="flex justify-between items-start">
                  <span className="text-xs font-bold text-white">{s.strategyName}</span>
                  <span className="text-xs font-black text-emerald-400">{s.targetWeightPct}%</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">${s.allocatedCapitalUsd?.toLocaleString()} USDT</div>
                <div className="mt-2 space-y-1 text-[10px] text-slate-400 border-t border-slate-800/60 pt-2">
                  <div className="flex justify-between"><span>OOS Sharpe:</span> <strong className="text-slate-200">{s.metrics?.outOfSampleSharpe}</strong></div>
                  <div className="flex justify-between"><span>Vol Penalty:</span> <strong className="text-slate-200">{(s.metrics?.volatilityRiskPenalty * 100).toFixed(0)}%</strong></div>
                  <div className="flex justify-between"><span>Correlation:</span> <strong className="text-slate-200">{s.metrics?.correlationWithPortfolio}</strong></div>
                  <div className="flex justify-between"><span>Expected Net Edge:</span> <strong className="text-cyan-300">+{s.metrics?.expectedNetEdgeBps} bps</strong></div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 p-2.5 bg-slate-900/50 rounded border border-slate-800/80 text-xs text-slate-300">
            <span className="text-indigo-400 font-bold uppercase">Rationale:</span> {allocation.riskAdjustedRationale}
          </div>
        </div>
      )}

      {edge && (
        <div className="rounded-xl border border-cyan-800/60 bg-slate-950/80 p-4 font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5 mb-3 text-xs">
            <span className="text-cyan-300 font-bold flex items-center gap-1.5 uppercase">
              <span className={`w-2 h-2 rounded-full ${edge.isTradeable ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
              Microstructure Net Edge Formula: Expected Net Edge = Gross − (Fees + Spread + Slippage + AdvSelection + Carrying + Uncertainty)
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${edge.isTradeable ? 'bg-emerald-900/60 text-emerald-300' : 'bg-rose-900/60 text-rose-300'}`}>
              {edge.isTradeable ? 'HURDLE PASSED (≥4 bps)' : 'SUB-HURDLE REJECTED'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center text-xs">
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">Gross Edge</div><div className="text-emerald-400 font-bold mt-0.5">+{edge.expectedGrossEdgeBps} bps</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">− Fees</div><div className="text-rose-400 font-bold mt-0.5">−{edge.makerTakerFeesBps} bps</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">− Spread</div><div className="text-amber-400 font-bold mt-0.5">−{edge.expectedSpreadCostBps} bps</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">− Slippage</div><div className="text-orange-400 font-bold mt-0.5">−{edge.expectedSlippageBps} bps</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">− Adverse Sel</div><div className="text-purple-400 font-bold mt-0.5">−{edge.adverseSelectionCostBps} bps</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">− Carrying</div><div className="text-indigo-400 font-bold mt-0.5">−{edge.fundingCarryingCostBps} bps</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">− Uncertainty</div><div className="text-violet-400 font-bold mt-0.5">−{edge.executionUncertaintyBps} bps</div></div>
            <div className={`p-2 rounded border ${edge.isTradeable ? 'bg-cyan-950/50 border-cyan-700/60' : 'bg-rose-950/50 border-rose-700/60'}`}><div className="text-[9px] text-cyan-300 uppercase font-bold">= Net Edge</div><div className={`font-black mt-0.5 ${edge.isTradeable ? 'text-cyan-200' : 'text-rose-300'}`}>{edge.expectedNetEdgeBps > 0 ? `+${edge.expectedNetEdgeBps}` : edge.expectedNetEdgeBps} bps</div></div>
          </div>
        </div>
      )}

      {costEvidence && (
        <div className="rounded-xl border border-amber-800/50 bg-slate-950/80 p-4 font-mono">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5 mb-3 text-xs">
            <span className="text-amber-300 font-bold flex items-center gap-1.5 uppercase">
              <ShieldCheck className="w-4 h-4" /> Measured Post-Cost Ledger — {costEvidence.sampleCount} attributed fills, {costEvidence.markoutSampleCount} markouts
            </span>
            <span className="text-[10px] text-slate-400">fee source: {costEvidence.feeRateSource} · funding: {costEvidence.fundingRateSource}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center text-xs">
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">Fees Paid</div><div className="text-rose-400 font-bold mt-0.5">${costEvidence.realizedFeesUsd?.toFixed(4)}</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">Spread Cost</div><div className="text-amber-400 font-bold mt-0.5">${costEvidence.realizedSpreadCostUsd?.toFixed(4)}</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">Slippage</div><div className="text-orange-400 font-bold mt-0.5">${costEvidence.realizedSlippageCostUsd?.toFixed(4)}</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">Adverse Sel</div><div className="text-purple-400 font-bold mt-0.5">${costEvidence.realizedAdverseSelectionCostUsd?.toFixed(4)}</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-slate-800"><div className="text-[9px] text-slate-500 uppercase">Funding</div><div className="text-indigo-400 font-bold mt-0.5">${costEvidence.realizedFundingCostUsd?.toFixed(4)}</div></div>
            <div className="bg-slate-900/80 p-2 rounded border border-amber-700/60"><div className="text-[9px] text-amber-300 uppercase font-bold">Total Cost</div><div className="text-amber-200 font-black mt-0.5">${costEvidence.realizedTotalCostUsd?.toFixed(4)}</div></div>
          </div>
          <div className="mt-3 text-[11px] text-slate-400">
            Attributed notional ${costEvidence.realizedNotionalUsd?.toLocaleString()} USDT · fee-to-profit ratio {auditReport?.feeToProfitRatioPct ?? 0}% · spread capture efficiency {auditReport?.spreadCaptureEfficiencyPct ?? 0}% · realized net after all verified costs ${auditReport?.netRealizedProfitUsd?.toFixed(4) ?? '0.0000'} USDT
          </div>
          {!costEvidence.fundingRateSource || costEvidence.fundingRateSource === 'UNAVAILABLE' ? (
            <div className="mt-2 text-[11px] text-amber-300/80">Funding carry could not be attributed (no live funding rate or no defensible holding horizon); it is reported as unavailable rather than assumed to be zero.</div>
          ) : null}
        </div>
      )}

      {(auditReport?.leaks?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-rose-800/50 bg-slate-950/80 p-4 font-mono">
          <div className="text-rose-300 font-bold text-xs uppercase mb-2">Revenue Leaks ({auditReport.leaks.length})</div>
          <div className="space-y-2">
            {auditReport.leaks.map((leak: any) => (
              <div key={leak.id} className="border border-slate-800 bg-slate-900/60 rounded p-2 text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-200 font-bold">{leak.type}</span>
                  <span className={leak.severity === 'HIGH' ? 'text-rose-300' : 'text-amber-300'}>{leak.severity}</span>
                </div>
                <div className="text-slate-400 mt-1">{leak.description}</div>
                <div className="text-slate-500 mt-1">Remediation: {leak.recommendedRemediation}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Engine</div><div className="mt-2 text-lg font-black text-white">{data?.engine?.status || 'LIVE DATA UNAVAILABLE'}</div><div className="mt-2 text-xs text-slate-400">{data?.engine?.details?.strategyBuildsCount ?? 0} autonomous builds recorded</div></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Latest Decision</div><div className="mt-2 text-lg font-black text-white">{decision?.decision || 'NO DECISION'}</div><div className="mt-2 text-xs text-slate-400">{decision ? (Math.round((decision.confidence || 0) * 100) + '% confidence · ' + (decision.applied ? 'APPLIED' : 'NOT APPLIED')) : 'Waiting for live audit'}</div></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"><div className="text-[10px] text-slate-500 font-mono uppercase">Latest AI Build</div><div className="mt-2 text-lg font-black text-white">{build?.status || 'NONE'}</div><div className="mt-2 text-xs text-slate-400">{build?.strategyName || 'No validated strategy improvement yet'}</div></div>
      </div>
      {build && <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex items-center gap-2 text-slate-200 font-bold text-sm"><ShieldCheck className="w-4 h-4 text-emerald-400" /> AI-built live strategy parameters</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-4">
          {Object.entries(build.parameters || {}).filter(([k]) => ['gridLevels','gridSpacingPct','volatilityMultiplier','trendFilterEma','rsiFilterThreshold','rebalanceIntervalSec'].includes(k)).map(([k,v]) => <div key={k} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3"><div className="text-[9px] text-slate-500 font-mono">{k}</div><div className="mt-1 text-sm font-black text-white">{String(v)}</div></div>)}
        </div>
        <p className="mt-4 text-xs text-slate-400">{build.rationale}</p>
      </div>}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex items-center gap-2 text-slate-200 font-bold text-sm"><RefreshCw className="w-4 h-4 text-sky-400" /> Recent autonomous decisions</div>
        <div className="mt-3 space-y-2 max-h-80 overflow-auto">
          {(data?.decisions || []).slice(0, 10).map((d:any) => <div key={d.id} className="flex flex-wrap justify-between gap-2 border-b border-slate-900 py-2 text-xs"><span className="font-mono text-slate-300">{d.decision}</span><span className="text-slate-500">{new Date(d.timestamp).toLocaleString()}</span><span className={d.applied ? 'text-emerald-300' : 'text-amber-300'}>{d.applied ? 'APPLIED' : 'HELD'}</span></div>)}
        </div>
      </div>
    </div>
  );
};
