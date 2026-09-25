import React, { useState } from 'react';
import {
  LearningDecisionStats,
  TradeDecision,
  TradeDecisionOutcome
} from '../../types/trading';
import {
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  RotateCcw,
  Sparkles,
  Layers,
  ArrowDown,
  DollarSign,
  PieChart,
  Activity,
  Zap,
  Clock,
  ChevronDown,
  ChevronUp,
  Scale,
  Percent,
  TrendingDown,
  Info
} from 'lucide-react';
import { evaluateSignalDecision } from '../../services/tradingService';

interface DecisionPipelineVisualizerProps {
  decisionStats?: LearningDecisionStats;
  currentSymbol?: string;
  onRefresh?: () => void;
}

export const DecisionPipelineVisualizer: React.FC<DecisionPipelineVisualizerProps> = ({
  decisionStats,
  currentSymbol = 'BTC/USDT',
  onRefresh
}) => {
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<TradeDecision | null>(null);

  // Simulation Form State
  const [simSide, setSimSide] = useState<'BUY' | 'SELL'>('BUY');
  const [simPrice, setSimPrice] = useState<number>(83200);
  const [simAmount, setSimAmount] = useState<number>(0.0035);
  const [simRegime, setSimRegime] = useState<string>('RANGING_SIDEWAYS');
  const [simEdgeBps, setSimEdgeBps] = useState<number>(5.2);
  const [simDepthUsd, setSimDepthUsd] = useState<number>(140000);
  const [simBaseRatio, setSimBaseRatio] = useState<number>(0.55);
  const [simLiqDistPct, setSimLiqDistPct] = useState<number>(35.0);

  const stats: LearningDecisionStats = decisionStats || {
    totalEvaluated: 148,
    buyDecisions: 26,
    sellDecisions: 22,
    doNothingDecisions: 100,
    doNothingRatioPct: 67.6,
    buyRatioPct: 17.6,
    sellRatioPct: 14.8,
    totalCapitalPreservedUsd: 2185.50,
    totalFeesAvoidedUsd: 364.20,
    avoidedDrawdownPct: 3.8,
    gateRejectionBreakdown: {
      regimeUnsuitable: 38,
      negativeEdge: 31,
      insufficientLiquidity: 16,
      inventorySaturated: 11,
      portfolioRiskBreach: 4
    },
    recentDecisions: []
  };

  const handleRunEvaluation = async () => {
    setIsEvaluating(true);
    try {
      const res = await evaluateSignalDecision({
        symbol: currentSymbol,
        side: simSide,
        price: simPrice,
        amount: simAmount,
        simulatedRegime: simRegime,
        simulatedEdgeBps: simEdgeBps,
        simulatedDepthUsd: simDepthUsd,
        simulatedBaseRatio: simBaseRatio,
        simulatedLiquidationDistancePct: simLiqDistPct
      });
      if (res.success && res.decision) {
        setEvaluationResult(res.decision);
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      console.error('Failed to evaluate signal decision:', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  const applyPresetScenario = (scenario: string) => {
    switch (scenario) {
      case 'CLEARED_BUY':
        setSimSide('BUY');
        setSimRegime('RANGING_SIDEWAYS');
        setSimEdgeBps(6.5);
        setSimDepthUsd(160000);
        setSimBaseRatio(0.48);
        setSimLiqDistPct(42.0);
        break;
      case 'REGIME_KNIFE':
        setSimSide('BUY');
        setSimRegime('BEAR_TREND_STRONG');
        setSimEdgeBps(7.0);
        setSimDepthUsd(150000);
        setSimBaseRatio(0.50);
        setSimLiqDistPct(35.0);
        break;
      case 'NEGATIVE_EDGE':
        setSimSide('BUY');
        setSimRegime('RANGING_SIDEWAYS');
        setSimEdgeBps(1.8); // Fails 4.0 bps hurdle
        setSimDepthUsd(140000);
        setSimBaseRatio(0.50);
        setSimLiqDistPct(35.0);
        break;
      case 'THIN_BOOK':
        setSimSide('BUY');
        setSimRegime('RANGING_SIDEWAYS');
        setSimEdgeBps(5.5);
        setSimDepthUsd(450); // Order exceeds 35% of depth
        setSimBaseRatio(0.50);
        setSimLiqDistPct(35.0);
        break;
      case 'INVENTORY_SATURATED':
        setSimSide('BUY');
        setSimRegime('RANGING_SIDEWAYS');
        setSimEdgeBps(5.8);
        setSimDepthUsd(150000);
        setSimBaseRatio(0.82); // Saturated (> 75%)
        setSimLiqDistPct(28.0);
        break;
      case 'RISK_LIQUIDATION':
        setSimSide('BUY');
        setSimRegime('RANGING_SIDEWAYS');
        setSimEdgeBps(5.8);
        setSimDepthUsd(150000);
        setSimBaseRatio(0.50);
        setSimLiqDistPct(8.5); // Critical buffer (< 12%)
        break;
    }
  };

  const getOutcomeBadge = (outcome: TradeDecisionOutcome) => {
    switch (outcome) {
      case 'BUY':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            BUY (TRADE)
          </span>
        );
      case 'SELL':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>
            SELL (TRADE)
          </span>
        );
      case 'DO_NOTHING':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shadow-sm shadow-indigo-500/10">
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            DO NOTHING (OPTIMIZED)
          </span>
        );
    }
  };

  const activeDecisionForTree = evaluationResult || stats.recentDecisions?.[0];

  return (
    <div className="space-y-6">
      {/* Top Banner: Core Architecture Principle */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-xl p-5 shadow-lg relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-bold tracking-wide uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Core Architecture Specification
              </span>
              <span className="text-xs text-slate-400">3-Outcome Decision Model</span>
            </div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Scale className="w-5 h-5 text-indigo-400" />
              Outcome Model: <span className="text-emerald-400">BUY</span> / <span className="text-rose-400">SELL</span> / <span className="text-indigo-400">DO NOTHING</span>
            </h2>
            <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
              A profitable automated system does not need to trade continuously. &ldquo;DO NOTHING&rdquo; is a legitimate optimized action that prevents churn, protects cash buffers, avoids fee drag, and locks out adverse selection when edge or regime alignment is insufficient.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 rounded-lg p-2 self-stretch lg:self-auto justify-around">
            <div className="text-center px-3 border-r border-slate-800">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Buy Signals</div>
              <div className="text-sm font-bold text-emerald-400 mt-0.5">{stats.buyRatioPct}%</div>
            </div>
            <div className="text-center px-3 border-r border-slate-800">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Sell Signals</div>
              <div className="text-sm font-bold text-rose-400 mt-0.5">{stats.sellRatioPct}%</div>
            </div>
            <div className="text-center px-3">
              <div className="text-[10px] uppercase font-semibold text-indigo-300">Do Nothing</div>
              <div className="text-sm font-bold text-indigo-400 mt-0.5">{stats.doNothingRatioPct}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Metric Cards: Capital & Discipline Alpha */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Prudent Pass Rate</span>
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-indigo-300">
            {stats.doNothingRatioPct}%
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {stats.doNothingDecisions} of {stats.totalEvaluated} trades prudently held
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Capital Preserved</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400">
            +${stats.totalCapitalPreservedUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Avoided adverse slippage & drift
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Fee Drag Avoided</span>
            <Percent className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-bold text-cyan-400">
            +${stats.totalFeesAvoidedUsd.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Eliminated uncompensated exchange fees
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Drawdown Prevented</span>
            <TrendingDown className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-purple-400">
            ~{stats.avoidedDrawdownPct}%
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            By avoiding hostile regimes & traps
          </div>
        </div>
      </div>

      {/* The 5-Gate Sequential Decision Tree Structure */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              5-Gate Sequential Decision Tree
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Candidate signals must pass all five sequential gates. If any answer is &ldquo;no&rdquo;, the system executes &ldquo;DO NOTHING&rdquo;.
            </p>
          </div>
          {activeDecisionForTree && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Latest Tree Result:</span>
              {getOutcomeBadge(activeDecisionForTree.finalOutcome)}
            </div>
          )}
        </div>

        {/* Visual Pipeline Nodes */}
        <div className="space-y-3">
          {/* Signal Source Root Node */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-indigo-500/20 text-indigo-300 flex items-center justify-center font-bold text-xs">
                SIG
              </div>
              <div>
                <div className="text-xs font-bold text-slate-200">
                  Candidate Signal Inflow: {activeDecisionForTree?.candidateSignal?.side || 'BUY'} @ ${activeDecisionForTree?.candidateSignal?.price?.toLocaleString() || '83,200'}
                </div>
                <div className="text-[11px] text-slate-400">
                  Source: {activeDecisionForTree?.candidateSignal?.source || 'GRID_RUNG'} &bull; Symbol: {currentSymbol}
                </div>
              </div>
            </div>
            <span className="text-xs text-slate-400 px-2.5 py-1 rounded bg-slate-900 border border-slate-800">
              Initial Trigger
            </span>
          </div>

          <div className="flex justify-center -my-1">
            <ArrowDown className="w-4 h-4 text-slate-600" />
          </div>

          {/* Gate 1: Is regime suitable? */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            activeDecisionForTree?.gates?.regime?.passed
              ? 'bg-emerald-950/20 border-emerald-500/30'
              : 'bg-rose-950/20 border-rose-500/40'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeDecisionForTree?.gates?.regime?.passed
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/20 text-rose-400'
                }`}>
                  1
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Is regime suitable?</span>
                    <span className="text-[10px] text-slate-400">(ADX, Trend Direction, Transition Restrictions)</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    {activeDecisionForTree?.gates?.regime?.reason || 'Verified: Market regime aligns with order side without falling knife or breakout resistance.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeDecisionForTree?.gates?.regime?.passed ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" /> YES
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <XCircle className="w-3.5 h-3.5" /> NO &rarr; DO NOTHING
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-center -my-1">
            <ArrowDown className="w-4 h-4 text-slate-600" />
          </div>

          {/* Gate 2: Is expected edge > costs? */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            !activeDecisionForTree?.gates?.regime?.passed
              ? 'bg-slate-950/40 border-slate-850 opacity-60'
              : activeDecisionForTree?.gates?.edge?.passed
                ? 'bg-emerald-950/20 border-emerald-500/30'
                : 'bg-rose-950/20 border-rose-500/40'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeDecisionForTree?.gates?.edge?.passed
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/20 text-rose-400'
                }`}>
                  2
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Is expected edge &gt; costs?</span>
                    <span className="text-[10px] text-slate-400">(Alpha &gt; Fees + Spread + Slippage + Hurdle)</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    {activeDecisionForTree?.gates?.edge?.reason || 'Verified: Microstructure edge exceeds hurdle rate after all friction.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeDecisionForTree?.gates?.edge?.passed ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" /> YES
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <XCircle className="w-3.5 h-3.5" /> NO &rarr; DO NOTHING
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-center -my-1">
            <ArrowDown className="w-4 h-4 text-slate-600" />
          </div>

          {/* Gate 3: Is liquidity sufficient? */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            !activeDecisionForTree?.gates?.edge?.passed
              ? 'bg-slate-950/40 border-slate-850 opacity-60'
              : activeDecisionForTree?.gates?.liquidity?.passed
                ? 'bg-emerald-950/20 border-emerald-500/30'
                : 'bg-rose-950/20 border-rose-500/40'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeDecisionForTree?.gates?.liquidity?.passed
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/20 text-rose-400'
                }`}>
                  3
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Is liquidity sufficient?</span>
                    <span className="text-[10px] text-slate-400">(Order Size &le; 35% Top-of-Book Depth & Spread &le; 25 bps)</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    {activeDecisionForTree?.gates?.liquidity?.reason || 'Verified: Deep order book liquidity ensures low market impact.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeDecisionForTree?.gates?.liquidity?.passed ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" /> YES
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <XCircle className="w-3.5 h-3.5" /> NO &rarr; DO NOTHING
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-center -my-1">
            <ArrowDown className="w-4 h-4 text-slate-600" />
          </div>

          {/* Gate 4: Is inventory acceptable? */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            !activeDecisionForTree?.gates?.liquidity?.passed
              ? 'bg-slate-950/40 border-slate-850 opacity-60'
              : activeDecisionForTree?.gates?.inventory?.passed
                ? 'bg-emerald-950/20 border-emerald-500/30'
                : 'bg-rose-950/20 border-rose-500/40'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeDecisionForTree?.gates?.inventory?.passed
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/20 text-rose-400'
                }`}>
                  4
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Is inventory acceptable?</span>
                    <span className="text-[10px] text-slate-400">(Inventory Skew &le; 0.50 & Liquidation Buffer &gt; 12%)</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    {activeDecisionForTree?.gates?.inventory?.reason || 'Verified: Inventory posture balanced, sufficient distance to liquidation.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeDecisionForTree?.gates?.inventory?.passed ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" /> YES
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <XCircle className="w-3.5 h-3.5" /> NO &rarr; DO NOTHING
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-center -my-1">
            <ArrowDown className="w-4 h-4 text-slate-600" />
          </div>

          {/* Gate 5: Is portfolio risk acceptable? */}
          <div className={`p-3.5 rounded-lg border transition-all ${
            !activeDecisionForTree?.gates?.inventory?.passed
              ? 'bg-slate-950/40 border-slate-850 opacity-60'
              : activeDecisionForTree?.gates?.risk?.passed
                ? 'bg-emerald-950/20 border-emerald-500/30'
                : 'bg-rose-950/20 border-rose-500/40'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  activeDecisionForTree?.gates?.risk?.passed
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/20 text-rose-400'
                }`}>
                  5
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">Is portfolio risk acceptable?</span>
                    <span className="text-[10px] text-slate-400">(Drawdown &lt; 15%, Circuit Breaker Inactive, Safe Margin)</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    {activeDecisionForTree?.gates?.risk?.reason || 'Verified: Portfolio drawdown and cash reserve within strict limits.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {activeDecisionForTree?.gates?.risk?.passed ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" /> YES
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    <XCircle className="w-3.5 h-3.5" /> NO &rarr; DO NOTHING
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-center -my-1">
            <ArrowDown className="w-4 h-4 text-slate-600" />
          </div>

          {/* Terminal Decision Outcome */}
          <div className={`p-4 rounded-xl border text-center transition-all ${
            activeDecisionForTree?.finalOutcome === 'DO_NOTHING'
              ? 'bg-indigo-950/30 border-indigo-500/30 text-indigo-300'
              : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
          }`}>
            <div className="text-xs uppercase font-bold tracking-wider text-slate-400 mb-1">
              Final System Execution
            </div>
            <div className="text-base font-extrabold flex items-center justify-center gap-2">
              {activeDecisionForTree?.finalOutcome === 'DO_NOTHING' ? (
                <>
                  <Shield className="w-5 h-5 text-indigo-400" />
                  <span>NO TRADE &mdash; DO NOTHING (Legitimate Optimized Action)</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span>TRADE &mdash; {activeDecisionForTree?.finalOutcome} LIMIT ORDER DISPATCHED</span>
                </>
              )}
            </div>
            <div className="text-xs text-slate-300 mt-1 max-w-2xl mx-auto">
              {activeDecisionForTree?.rationale}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Signal Tester & Scenario Sandbox */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Interactive 5-Gate Signal Sandbox
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Simulate candidate signals against live or stressed conditions to observe automated 3-way outcome resolution.
            </p>
          </div>
          <button
            onClick={handleRunEvaluation}
            disabled={isEvaluating}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all disabled:opacity-50 shadow-md shadow-indigo-600/20"
          >
            <Play className="w-3.5 h-3.5" />
            {isEvaluating ? 'Evaluating Gates...' : 'Test Signal Through 5 Gates'}
          </button>
        </div>

        {/* Quick Test Scenarios */}
        <div>
          <div className="text-xs font-semibold text-slate-400 mb-2">Preset Stress Scenarios:</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <button
              type="button"
              onClick={() => applyPresetScenario('CLEARED_BUY')}
              className="px-2.5 py-1.5 rounded text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition-all"
            >
              <div className="font-bold text-emerald-400 text-[11px]">&bull; High Edge Range</div>
              <div className="text-[10px] text-slate-400">All 5 Gates Pass &rarr; BUY</div>
            </button>
            <button
              type="button"
              onClick={() => applyPresetScenario('REGIME_KNIFE')}
              className="px-2.5 py-1.5 rounded text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition-all"
            >
              <div className="font-bold text-rose-400 text-[11px]">&bull; Severe Bear Trend</div>
              <div className="text-[10px] text-slate-400">Gate 1 Rejects &rarr; DO NOTHING</div>
            </button>
            <button
              type="button"
              onClick={() => applyPresetScenario('NEGATIVE_EDGE')}
              className="px-2.5 py-1.5 rounded text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition-all"
            >
              <div className="font-bold text-amber-400 text-[11px]">&bull; High Fee Churn</div>
              <div className="text-[10px] text-slate-400">Gate 2 Rejects &rarr; DO NOTHING</div>
            </button>
            <button
              type="button"
              onClick={() => applyPresetScenario('THIN_BOOK')}
              className="px-2.5 py-1.5 rounded text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition-all"
            >
              <div className="font-bold text-orange-400 text-[11px]">&bull; Thin Liquidity</div>
              <div className="text-[10px] text-slate-400">Gate 3 Rejects &rarr; DO NOTHING</div>
            </button>
            <button
              type="button"
              onClick={() => applyPresetScenario('INVENTORY_SATURATED')}
              className="px-2.5 py-1.5 rounded text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition-all"
            >
              <div className="font-bold text-purple-400 text-[11px]">&bull; Long Overhang</div>
              <div className="text-[10px] text-slate-400">Gate 4 Rejects &rarr; DO NOTHING</div>
            </button>
            <button
              type="button"
              onClick={() => applyPresetScenario('RISK_LIQUIDATION')}
              className="px-2.5 py-1.5 rounded text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-slate-200 transition-all"
            >
              <div className="font-bold text-red-400 text-[11px]">&bull; Low Liq Buffer</div>
              <div className="text-[10px] text-slate-400">Gate 5 Rejects &rarr; DO NOTHING</div>
            </button>
          </div>
        </div>

        {/* Form Inputs Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Signal Side</label>
            <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setSimSide('BUY')}
                className={`py-1 text-xs font-bold rounded ${
                  simSide === 'BUY' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                BUY
              </button>
              <button
                type="button"
                onClick={() => setSimSide('SELL')}
                className={`py-1 text-xs font-bold rounded ${
                  simSide === 'SELL' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                SELL
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Regime Type</label>
            <select
              value={simRegime}
              onChange={(e) => setSimRegime(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
            >
              <option value="RANGING_SIDEWAYS">RANGING_SIDEWAYS</option>
              <option value="BEAR_TREND_STRONG">BEAR_TREND_STRONG</option>
              <option value="BULL_TREND_STRONG">BULL_TREND_STRONG</option>
              <option value="VOLATILE_EXPANDING">VOLATILE_EXPANDING</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Expected Edge (bps)</label>
            <input
              type="number"
              step="0.5"
              value={simEdgeBps}
              onChange={(e) => setSimEdgeBps(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Inventory Base Ratio (%)</label>
            <input
              type="number"
              step="5"
              value={Math.round(simBaseRatio * 100)}
              onChange={(e) => setSimBaseRatio((parseFloat(e.target.value) || 50) / 100)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
            />
          </div>
        </div>
      </div>

      {/* Gate Rejection Breakdown */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <PieChart className="w-4 h-4 text-cyan-400" />
          DO NOTHING Gate Rejection Distribution
        </h3>
        <p className="text-xs text-slate-400">
          Where bad trades were stopped before execution, protecting portfolio capital:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 pt-1">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <div className="text-[10px] text-slate-400 font-semibold uppercase">Gate 1: Regime</div>
            <div className="text-lg font-bold text-slate-200 mt-0.5">
              {stats.gateRejectionBreakdown.regimeUnsuitable}
            </div>
            <div className="text-[11px] text-slate-400">Counter-trend or knife stops</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <div className="text-[10px] text-slate-400 font-semibold uppercase">Gate 2: Cost Hurdle</div>
            <div className="text-lg font-bold text-slate-200 mt-0.5">
              {stats.gateRejectionBreakdown.negativeEdge}
            </div>
            <div className="text-[11px] text-slate-400">Fees/spread exceed alpha</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <div className="text-[10px] text-slate-400 font-semibold uppercase">Gate 3: Liquidity</div>
            <div className="text-lg font-bold text-slate-200 mt-0.5">
              {stats.gateRejectionBreakdown.insufficientLiquidity}
            </div>
            <div className="text-[11px] text-slate-400">Thin book & blown spread</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <div className="text-[10px] text-slate-400 font-semibold uppercase">Gate 4: Inventory</div>
            <div className="text-lg font-bold text-slate-200 mt-0.5">
              {stats.gateRejectionBreakdown.inventorySaturated}
            </div>
            <div className="text-[11px] text-slate-400">Long/short saturation</div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
            <div className="text-[10px] text-slate-400 font-semibold uppercase">Gate 5: Portfolio Risk</div>
            <div className="text-lg font-bold text-slate-200 mt-0.5">
              {stats.gateRejectionBreakdown.portfolioRiskBreach}
            </div>
            <div className="text-[11px] text-slate-400">Drawdown limit / cash reserve</div>
          </div>
        </div>
      </div>

      {/* Recent 3-Way Decisions Audit Stream */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Recent Decisions & Audit Trail</h3>
          </div>
          <span className="text-xs text-slate-400">
            {stats.recentDecisions.length} recorded events
          </span>
        </div>

        <div className="space-y-2">
          {stats.recentDecisions.map((dec) => {
            const isExpanded = expandedDecisionId === dec.id;
            return (
              <div
                key={dec.id}
                className="bg-slate-950/60 border border-slate-800 hover:border-slate-700 rounded-lg p-3 transition-all"
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedDecisionId(isExpanded ? null : dec.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-400">
                      {new Date(dec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="text-xs font-bold text-white">
                      {dec.symbol}
                    </span>
                    <span className="text-xs text-slate-400">
                      {dec.candidateSignal.side} @ ${dec.candidateSignal.price.toLocaleString()}
                    </span>
                    {getOutcomeBadge(dec.finalOutcome)}
                    {dec.rejectionGate && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/20">
                        Gate: {dec.rejectionGate}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {dec.capitalPreservedUsd ? (
                      <span className="text-xs font-semibold text-emerald-400">
                        +${dec.capitalPreservedUsd.toFixed(2)} preserved
                      </span>
                    ) : null}
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-850 space-y-2 text-xs">
                    <div className="text-slate-300">
                      <span className="font-semibold text-slate-400">Rationale: </span>
                      {dec.rationale}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1">
                      {Object.entries(dec.gates).map(([key, gate]) => (
                        <div
                          key={key}
                          className={`p-2 rounded border text-[11px] ${
                            gate.passed
                              ? 'bg-emerald-950/20 border-emerald-500/20 text-emerald-300'
                              : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                          }`}
                        >
                          <div className="font-bold flex items-center justify-between">
                            <span className="capitalize">{key}</span>
                            {gate.passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">
                            {gate.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
