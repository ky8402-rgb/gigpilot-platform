import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Compass,
  Gauge,
  Info,
  Layers,
  Lock,
  Play,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sliders,
  TrendingDown,
  TrendingUp,
  Zap
} from 'lucide-react';
import { MarketRegime, RegimeTransitionPhase } from '../../types/trading';

interface RegimeTransitionViewProps {
  regime: MarketRegime;
  currentPrice: number;
  symbol: string;
  onRefresh?: () => void;
}

export const RegimeTransitionView: React.FC<RegimeTransitionViewProps> = ({
  regime,
  currentPrice,
  symbol,
  onRefresh
}) => {

  const getPhaseColor = (p: RegimeTransitionPhase) => {
    switch (p) {
      case 'BREAKOUT_TESTING':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/40';
      case 'EXPANDING_VOLATILITY':
        return 'text-orange-400 bg-orange-500/10 border-orange-500/40';
      case 'BREAKOUT_CONFIRMED':
        return 'text-purple-400 bg-purple-500/10 border-purple-500/40';
      case 'BREAKOUT_REJECTED':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/40';
      case 'STABLE':
      default:
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/40';
    }
  };

  const getRestrictionColor = (status: string) => {
    switch (status) {
      case 'RESTRICTED_DOWNSIDE':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/40';
      case 'RESTRICTED_UPSIDE':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/40';
      case 'HALT_NEW_RUNGS':
        return 'text-red-400 bg-red-500/10 border-red-500/40';
      case 'WIDEN_DEFENSIVE':
        return 'text-orange-400 bg-orange-500/10 border-orange-500/40';
      default:
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    }
  };

  return (
    <div className="max-w-[1700px] mx-auto p-4 space-y-6">
      {/* 1. Header Banner & State Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-xl p-5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Regime Transition Engine
              </span>
              <span className="text-xs text-slate-400 font-mono">Explicit Microstructure State Machine</span>
            </div>
            <h1 className="text-2xl font-bold font-mono tracking-tight text-white flex items-center gap-2">
              <span>Market Regime Transition Detector</span>
              <span className={`text-xs px-2.5 py-1 rounded-md border font-mono font-semibold ${getPhaseColor(phase)}`}>
                PHASE: {phase}
              </span>
            </h1>
            <p className="text-sm text-slate-300 mt-1 max-w-3xl">
              Explicitly distinguishes between stable regimes and <strong>structural transition phases</strong> (volatility expansion, breakout testing, confirmation, or rejection). Protects grid strategies from adverse runaway trends.
            </p>
          </div>

          {/* Quick Status Gauges */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-4 py-2 text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">Current Base Regime</div>
              <div className="text-sm font-mono font-bold text-white mt-0.5">{regime.regime.replace(/_/g, ' ')}</div>
            </div>

            <div className={`rounded-lg px-4 py-2 text-center border ${isTransitioning ? 'bg-amber-950/40 border-amber-500/40' : 'bg-slate-950/70 border-slate-800'}`}>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">Transition Posture</div>
              <div className={`text-sm font-mono font-bold mt-0.5 ${isTransitioning ? 'text-amber-400 animate-pulse' : 'text-emerald-400'}`}>
                {isTransitioning ? 'TRANSITIONING' : 'STABLE EQUILIBRIUM'}
              </div>
            </div>

            <div className={`rounded-lg px-4 py-2 text-center border ${sizeMultiplier < 1.0 ? 'bg-rose-950/40 border-rose-500/40' : 'bg-slate-950/70 border-slate-800'}`}>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">Position Sizing Throttle</div>
              <div className="text-sm font-mono font-bold text-rose-300 mt-0.5">
                {Math.round(sizeMultiplier * 100)}% ({sizeMultiplier < 1.0 ? `-${Math.round((1 - sizeMultiplier) * 100)}% cut` : 'Full size'})
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Interactive Flowchart Diagram Matching User's Architecture */}
      <div className="bg-[#0B101D] border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold font-mono text-white">Regime Transition Topology & Flow State</h2>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Active Node highlighted in real-time
          </span>
        </div>

        {/* Visual Graph Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative py-4">
          {/* Node 1: Stable Regime */}
          <div className={`rounded-xl p-5 border transition-all ${
            phase === 'STABLE'
              ? 'bg-emerald-950/40 border-emerald-500 shadow-lg shadow-emerald-950/50 ring-2 ring-emerald-500/30'
              : 'bg-slate-900/50 border-slate-800 opacity-75'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold text-slate-400 uppercase">State 1: Baseline</span>
              {phase === 'STABLE' && (
                <span className="px-2 py-0.5 bg-emerald-500 text-slate-950 rounded text-[10px] font-bold font-mono">ACTIVE</span>
              )}
            </div>
            <h3 className="text-lg font-bold font-mono text-emerald-300 flex items-center gap-2">
              <Layers className="w-4 h-4" />
              <span>RANGE / TREND</span>
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              Low realized volatility, stable ATR ({metrics ? metrics.volatilityExpansionRatio : 1.0}x), baseline band width.
            </p>
            <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] font-mono text-slate-400 space-y-1">
              <div>• Position Sizing: <strong className="text-emerald-300">100%</strong></div>
              <div>• Grid Rungs: <strong className="text-slate-200">Bilateral Standard</strong></div>
              <div>• Edge: <strong className="text-emerald-400">Optimal Micro-Chop Capture</strong></div>
            </div>
          </div>

          {/* Node 2: Transition State (Middle Gateway) */}
          <div className={`rounded-xl p-5 border transition-all ${
            phase === 'BREAKOUT_TESTING' || phase === 'EXPANDING_VOLATILITY'
              ? 'bg-amber-950/50 border-amber-500 shadow-xl shadow-amber-950/60 ring-2 ring-amber-500/50'
              : 'bg-slate-900/50 border-slate-800 opacity-75'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold text-amber-400 uppercase flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" />
                <span>State 2: Volatility Surge</span>
              </span>
              {(phase === 'BREAKOUT_TESTING' || phase === 'EXPANDING_VOLATILITY') && (
                <span className="px-2 py-0.5 bg-amber-500 text-slate-950 rounded text-[10px] font-bold font-mono animate-pulse">ACTIVE TRANSITION</span>
              )}
            </div>
            <h3 className="text-lg font-bold font-mono text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>TRANSITION STATE</span>
            </h3>
            <p className="text-xs text-amber-200/90 mt-1">
              ATR expansion ({metrics?.volatilityExpansionRatio || 1.4}x), rising ADX slope (+{metrics?.adxSlope || 2.4}), testing breakout boundaries.
            </p>
            <div className="mt-4 pt-3 border-t border-amber-500/20 text-[11px] font-mono text-amber-200 space-y-1 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/30">
              <div className="flex items-center justify-between">
                <span>Position Sizing:</span>
                <strong className="text-amber-300 bg-amber-950 px-1.5 py-0.5 rounded border border-amber-500/40">40% (-60% cut)</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Grid Placement:</span>
                <strong className="text-rose-300">{restrictionStatus}</strong>
              </div>
              <div className="text-[10px] text-amber-300/80 mt-1">
                Halts/widens adverse limit rungs to avoid accumulating huge drawdown inventory into a breakout.
              </div>
            </div>
          </div>

          {/* Node 3: Fork Resolutions */}
          <div className="space-y-3">
            {/* Branch A: Breakout Confirmed -> Momentum */}
            <div className={`rounded-xl p-3.5 border transition-all ${
              phase === 'BREAKOUT_CONFIRMED'
                ? 'bg-purple-950/60 border-purple-500 shadow-lg ring-2 ring-purple-500/40'
                : 'bg-slate-900/40 border-slate-800 opacity-75'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-purple-300 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>Breakout Confirmed</span>
                </span>
                {phase === 'BREAKOUT_CONFIRMED' && (
                  <span className="px-1.5 py-0.5 bg-purple-500 text-white rounded text-[9px] font-bold font-mono">ACTIVE</span>
                )}
              </div>
              <div className="text-sm font-bold font-mono text-white mt-0.5">➔ MOMENTUM / TREND</div>
              <div className="text-[10px] text-slate-300 mt-1">
                2+ closes outside band with ADX &gt; 23. Shift capital from Mean Reversion to Trend Grid &amp; trail stops.
              </div>
            </div>

            {/* Branch B: Breakout Rejected -> Range */}
            <div className={`rounded-xl p-3.5 border transition-all ${
              phase === 'BREAKOUT_REJECTED'
                ? 'bg-cyan-950/60 border-cyan-500 shadow-lg ring-2 ring-cyan-500/40'
                : 'bg-slate-900/40 border-slate-800 opacity-75'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-bold text-cyan-300 flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>Breakout Rejected (Fakeout)</span>
                </span>
                {phase === 'BREAKOUT_REJECTED' && (
                  <span className="px-1.5 py-0.5 bg-cyan-500 text-slate-950 rounded text-[9px] font-bold font-mono">ACTIVE</span>
                )}
              </div>
              <div className="text-sm font-bold font-mono text-white mt-0.5">➔ RANGE / MEAN REVERSION</div>
              <div className="text-[10px] text-slate-300 mt-1">
                Price rejected back inside band with volume fade. Restore standard sizing &amp; harvest mean reversion.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Deep Microstructure Transition Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Volatility Expansion Ratio */}
        <div className="bg-[#0B101D] border border-slate-800 rounded-xl p-4 shadow">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>ATR Expansion Ratio</span>
            <Activity className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {metrics?.volatilityExpansionRatio || 1.0}x
            </span>
            <span className={`text-xs font-mono font-bold ${
              (metrics?.volatilityExpansionRatio || 1.0) > 1.25 ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {(metrics?.volatilityExpansionRatio || 1.0) > 1.25 ? 'Surging (+vol)' : 'Equilibrium'}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            Current ATR: <strong className="text-slate-200">${regime.atr.toFixed(2)}</strong> (baseline: ${Math.round(regime.atr / (metrics?.volatilityExpansionRatio || 1.0))})
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className={`h-full ${
                (metrics?.volatilityExpansionRatio || 1.0) > 1.25 ? 'bg-amber-400' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, ((metrics?.volatilityExpansionRatio || 1.0) / 2.0) * 100)}%` }}
            />
          </div>
        </div>

        {/* Metric 2: ADX & ADX Slope */}
        <div className="bg-[#0B101D] border border-slate-800 rounded-xl p-4 shadow">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>ADX &amp; Trend Slope</span>
            <TrendingUp className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {metrics?.adxValue?.toFixed(1) || regime.adx.toFixed(1)}
            </span>
            <span className={`text-xs font-mono font-bold ${
              (metrics?.adxSlope || 0) > 1.5 ? 'text-purple-400' : 'text-slate-400'
            }`}>
              Δ {(metrics?.adxSlope || 0) >= 0 ? `+${metrics?.adxSlope}` : metrics?.adxSlope} / 5-bars
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            Trend Strength: <strong className="text-slate-200">{regime.adx > 25 ? 'STRONG TREND' : (regime.adx > 20 ? 'EMERGING' : 'CONSOLIDATING')}</strong>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="h-full bg-indigo-500"
              style={{ width: `${Math.min(100, (regime.adx / 50) * 100)}%` }}
            />
          </div>
        </div>

        {/* Metric 3: Breakout Threshold & Distance */}
        <div className="bg-[#0B101D] border border-slate-800 rounded-xl p-4 shadow">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Breakout Boundaries</span>
            <Compass className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {metrics?.breakoutDistancePct !== undefined ? `${metrics.breakoutDistancePct}%` : '1.8%'}
            </span>
            <span className="text-xs font-mono text-slate-400">to threshold</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            Upper: <strong className="text-slate-200">${metrics?.breakoutThresholdUpper.toFixed(1) || (currentPrice * 1.025).toFixed(1)}</strong> | Lower: <strong className="text-slate-200">${metrics?.breakoutThresholdLower.toFixed(1) || (currentPrice * 0.975).toFixed(1)}</strong>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className="h-full bg-cyan-500"
              style={{ width: `${Math.max(10, 100 - (metrics?.breakoutDistancePct || 2) * 20)}%` }}
            />
          </div>
        </div>

        {/* Metric 4: Active Protection Sizing */}
        <div className="bg-[#0B101D] border border-slate-800 rounded-xl p-4 shadow">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Grid Restriction Posture</span>
            <Shield className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-rose-300">
              {restrictionStatus}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 truncate" title={transition?.restrictionReason}>
            {transition?.restrictionReason || 'Standard bilateral grid placement.'}
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 overflow-hidden">
            <div
              className={`h-full ${sizeMultiplier < 1.0 ? 'bg-rose-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.round(sizeMultiplier * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 4. Candidate Next Regimes & Trigger Probabilities */}
      <div className="bg-[#0B101D] border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold font-mono text-white">Transition Resolution Probability Forecast</h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Source: {transition?.sourceRegime || regime.regime}
          </span>
        </div>

        <div className="space-y-3">
          {(transition?.targetRegimes || []).map((target, idx) => (
            <div key={idx} className="bg-slate-900/60 border border-slate-800 rounded-lg p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center font-mono font-bold text-indigo-300 text-xs">
                  {idx + 1}
                </div>
                <div>
                  <div className="text-sm font-bold font-mono text-white flex items-center gap-2">
                    <span>{target.regime.replace(/_/g, ' ')}</span>
                    <span className="text-xs px-2 py-0.2 bg-slate-800 text-indigo-300 rounded font-mono">
                      {Math.round(target.probability * 100)}% Probability
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Trigger Condition: {target.triggerCondition}
                  </div>
                </div>
              </div>

              <div className="w-full md:w-48 bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                  style={{ width: `${Math.round(target.probability * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 6. Quantitative Engineering Rationales */}
      <div className="bg-[#0B101D] border border-slate-800 rounded-xl p-5 shadow">
        <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span>Why Transition Detection is Critical for Algorithmic Grid Systems</span>
        </h4>
        <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
          <p>
            Standard grid bots are inherently stationary: they assume asset prices oscillate forever within bounded limits. In a calm consolidation range, a grid prints consistent micro-returns.
          </p>
          <p>
            However, when volatility expands and the market transitions into a directional trend, naive grids accumulate huge one-sided inventory (e.g. buying all the way down into an unconfirmed dump, or selling all inventory prematurely into a parabolic rally).
          </p>
          <p>
            The <strong>Regime Transition Detector</strong> acts as the circuit-breaker between regimes: by cutting position sizing by 60% and freezing proximate rungs on the adverse side during <code className="text-amber-300">BREAKOUT_TESTING</code>, the portfolio remains fully protected until the market either confirms the breakout into momentum or rejects it back into oscillating equilibrium.
          </p>
        </div>
      </div>
    </div>
  );
};
