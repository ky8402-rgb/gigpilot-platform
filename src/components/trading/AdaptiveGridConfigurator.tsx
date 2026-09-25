import React, { useState } from 'react';
import { GridConfiguration, MarketRegime } from '../../types/trading';
import {
  Sliders,
  Sparkles,
  RefreshCw,
  TrendingUp,
  Shield,
  Layers,
  CheckCircle2,
  Scale
} from 'lucide-react';

interface AdaptiveGridConfiguratorProps {
  currentPrice: number;
  activeGrid: GridConfiguration | null;
  regime: MarketRegime;
  onApplyConfig: (config: {
    upperBoundary: number;
    lowerBoundary: number;
    levelsCount: number;
    spacingType: 'ARITHMETIC' | 'GEOMETRIC';
    totalAllocatedUsd: number;
    volatilityAdjustment: boolean;
    trendProtection: boolean;
  }) => Promise<void>;
}

export const AdaptiveGridConfigurator: React.FC<AdaptiveGridConfiguratorProps> = ({
  currentPrice,
  activeGrid,
  regime,
  onApplyConfig
}) => {
  const [upperBoundary, setUpperBoundary] = useState(
    activeGrid?.upperBoundary.toString() || (currentPrice * 1.08).toFixed(0)
  );
  const [lowerBoundary, setLowerBoundary] = useState(
    activeGrid?.lowerBoundary.toString() || (currentPrice * 0.92).toFixed(0)
  );
  const [levelsCount, setLevelsCount] = useState(
    activeGrid?.levelsCount.toString() || '20'
  );
  const [spacingType, setSpacingType] = useState<'ARITHMETIC' | 'GEOMETRIC'>(
    activeGrid?.spacingType || 'GEOMETRIC'
  );
  const [totalAllocatedUsd, setTotalAllocatedUsd] = useState(
    activeGrid?.totalAllocatedUsd.toString() || '3500'
  );
  const [volatilityAdjustment, setVolatilityAdjustment] = useState(true);
  const [trendProtection, setTrendProtection] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);

  // Auto-tune preset from Market Regime
  const handleRegimeAutoTune = () => {
    const atrFactor = regime.atr > 0 ? (regime.atr * 4) : (currentPrice * 0.06);
    let upper = currentPrice + atrFactor;
    let lower = currentPrice - atrFactor;

    if (regime.trendDirection === 'BULLISH') {
      upper = currentPrice + (atrFactor * 1.5);
      lower = currentPrice - (atrFactor * 0.7);
    } else if (regime.trendDirection === 'BEARISH') {
      upper = currentPrice + (atrFactor * 0.7);
      lower = currentPrice - (atrFactor * 1.5);
    }

    setUpperBoundary(upper.toFixed(0));
    setLowerBoundary(lower.toFixed(0));
    setLevelsCount(regime.regime === 'RANGE_BOUND_HIGH_VOL' ? '28' : '20');
    setSpacingType('GEOMETRIC');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsApplying(true);
    setSuccessNotice(false);

    try {
      await onApplyConfig({
        upperBoundary: Number(upperBoundary),
        lowerBoundary: Number(lowerBoundary),
        levelsCount: Number(levelsCount),
        spacingType,
        totalAllocatedUsd: Number(totalAllocatedUsd),
        volatilityAdjustment,
        trendProtection
      });
      setSuccessNotice(true);
      setTimeout(() => setSuccessNotice(false), 4000);
    } catch (err: any) {
      alert(`Failed to apply grid: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  const upper = Number(upperBoundary);
  const lower = Number(lowerBoundary);
  const levels = Number(levelsCount);
  const alloc = Number(totalAllocatedUsd);
  const orderSizeEst = levels > 0 ? (alloc / levels).toFixed(1) : '0';
  const widthPct = lower > 0 ? (((upper - lower) / lower) * 100).toFixed(2) : '0';
  const stepPct = levels > 1 ? (Number(widthPct) / (levels - 1)).toFixed(2) : '0';

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider">
              Adaptive Grid Tuning & Optimization
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              Dynamic boundary damper, ATR volatility scaling & trend-aware rung positioning
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRegimeAutoTune}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-800/80 text-emerald-300 text-xs font-mono font-semibold transition-all shadow"
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>Auto-Fit to Market Regime</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 font-mono text-xs">
        {/* Regime Context Banner */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-400">Current Price:</span>
            <span className="text-white font-extrabold text-sm">${currentPrice.toLocaleString()}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">Regime:</span>
            <span className="text-cyan-300 font-bold">{regime.regime.replace(/_/g, ' ')}</span>
          </div>
          <div className="text-slate-400 flex items-center gap-3">
            <span>ATR: <strong className="text-white">${regime.atr.toFixed(2)}</strong> (ADX: {regime.adx.toFixed(1)})</span>
            {regime.transition?.isTransitioning && (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold text-[10px]">
                TRANSITION: {regime.transition.phase}
              </span>
            )}
          </div>
        </div>

        {/* Transition Safeguards Banner if in transition */}
        {regime.transition?.isTransitioning && (
          <div className="bg-amber-950/40 border border-amber-500/40 rounded-lg p-3 text-xs text-amber-200 flex items-start gap-2.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping mt-1 shrink-0" />
            <div>
              <div className="font-bold text-amber-300 font-mono">
                Regime Transition Safeguards Active [{regime.transition.gridRestrictionStatus}]
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                {regime.transition.restrictionReason} Capital sizing scaled to <strong>{Math.round(regime.transition.positionSizeMultiplier * 100)}%</strong> to mitigate trend breakout inventory risk.
              </div>
            </div>
          </div>
        )}

        {/* Inventory Awareness Status & Asymmetric Allocation */}
        {activeGrid?.inventoryAwareness && (
          <div className={`border rounded-lg p-3 text-xs flex items-start gap-2.5 ${
            activeGrid.inventoryAwareness.inventorySkew > 0.2
              ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
              : activeGrid.inventoryAwareness.inventorySkew < -0.2
              ? 'bg-blue-950/30 border-blue-500/40 text-blue-200'
              : 'bg-indigo-950/30 border-indigo-500/40 text-indigo-200'
          }`}>
            <Scale className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div className="w-full">
              <div className="flex items-center justify-between font-mono font-bold">
                <span>Inventory-Aware Quoting: {activeGrid.inventoryAwareness.inventoryPosturing.replace('_', ' ')} (Skew: {activeGrid.inventoryAwareness.inventorySkew >= 0 ? `+${activeGrid.inventoryAwareness.inventorySkew}` : activeGrid.inventoryAwareness.inventorySkew})</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                  Liq Buffer: {activeGrid.inventoryAwareness.distanceFromLiquidationPct}% ({activeGrid.inventoryAwareness.liquidationRiskTier})
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 pt-2 border-t border-slate-800 text-[11px] font-mono">
                <div>
                  <span className="text-slate-400 block">BUY Budget:</span>
                  <span className="font-bold text-emerald-400">{Math.round(activeGrid.inventoryAwareness.asymmetricBudgeting.buyAllocationPct * 100)}% (${activeGrid.inventoryAwareness.asymmetricBudgeting.buyBudgetUsd})</span>
                </div>
                <div>
                  <span className="text-slate-400 block">SELL Budget:</span>
                  <span className="font-bold text-rose-400">{Math.round(activeGrid.inventoryAwareness.asymmetricBudgeting.sellAllocationPct * 100)}% (${activeGrid.inventoryAwareness.asymmetricBudgeting.sellBudgetUsd})</span>
                </div>
                <div>
                  <span className="text-slate-400 block">BUY Size Mult:</span>
                  <span className="font-bold text-white">{activeGrid.inventoryAwareness.asymmetricOrderSizing.buyOrderSizeMultiplier}x</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Req BUY Hurdle:</span>
                  <span className="font-bold text-yellow-400">{activeGrid.inventoryAwareness.asymmetricEdgeHurdles.requiredBuyEdgeHurdleBps} bps</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Boundary Parameters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-slate-300 font-semibold block mb-1.5 flex justify-between">
              <span>Upper Grid Boundary (USD)</span>
              <span className="text-amber-400 text-[11px]">
                +{(((upper - currentPrice) / currentPrice) * 100).toFixed(1)}% from mid
              </span>
            </label>
            <input
              type="number"
              step="10"
              value={upperBoundary}
              onChange={e => setUpperBoundary(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1.5 flex justify-between">
              <span>Lower Grid Boundary (USD)</span>
              <span className="text-amber-400 text-[11px]">
                {(((lower - currentPrice) / currentPrice) * 100).toFixed(1)}% from mid
              </span>
            </label>
            <input
              type="number"
              step="10"
              value={lowerBoundary}
              onChange={e => setLowerBoundary(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Levels & Capital Allocation */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-slate-300 font-semibold block mb-1.5">
              Grid Levels (Rungs)
            </label>
            <input
              type="number"
              min="4"
              max="60"
              value={levelsCount}
              onChange={e => setLevelsCount(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1.5">
              Spacing Geometry
            </label>
            <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-700">
              <button
                type="button"
                onClick={() => setSpacingType('GEOMETRIC')}
                className={`flex-1 py-1.5 rounded font-bold transition-colors ${
                  spacingType === 'GEOMETRIC' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Geometric (%)
              </button>
              <button
                type="button"
                onClick={() => setSpacingType('ARITHMETIC')}
                className={`flex-1 py-1.5 rounded font-bold transition-colors ${
                  spacingType === 'ARITHMETIC' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Arithmetic ($)
              </button>
            </div>
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1.5">
              Total Capital Allocated (USD)
            </label>
            <input
              type="number"
              step="100"
              value={totalAllocatedUsd}
              onChange={e => setTotalAllocatedUsd(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-bold text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Protection Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-lg">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={volatilityAdjustment}
              onChange={e => setVolatilityAdjustment(e.target.checked)}
              className="w-4 h-4 rounded text-cyan-600 focus:ring-0 bg-slate-900 border-slate-700"
            />
            <div>
              <span className="font-bold text-white block">ATR Volatility Dampening</span>
              <span className="text-[11px] text-slate-400 block">
                Automatically widens spacing during extreme spikes to avoid rapid fill depletion
              </span>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={trendProtection}
              onChange={e => setTrendProtection(e.target.checked)}
              className="w-4 h-4 rounded text-cyan-600 focus:ring-0 bg-slate-900 border-slate-700"
            />
            <div>
              <span className="font-bold text-white block">Trend Filter & Inventory Shield</span>
              <span className="text-[11px] text-slate-400 block">
                Suspends aggressive bottom buying during strong sustained bear trend regimes
              </span>
            </div>
          </label>
        </div>

        {/* Calculated Preview Strip */}
        <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="text-slate-400 block text-[10px]">TOTAL GRID WIDTH</span>
            <span className="font-bold text-white text-sm">{widthPct}%</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">STEP SIZE</span>
            <span className="font-bold text-amber-300 text-sm">{stepPct}% / level</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">VALUE PER ORDER</span>
            <span className="font-bold text-cyan-300 text-sm">${orderSizeEst} USD</span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px]">ACTIVE LEVELS</span>
            <span className="font-bold text-emerald-400 text-sm">{levels} rungs</span>
          </div>
        </div>

        {successNotice && (
          <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Grid reconfigured and synchronized with exchange order book successfully!</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isApplying}
          className="w-full py-3 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-emerald-600/30 transition-all font-mono"
        >
          {isApplying ? 'Synchronizing Orders...' : 'Apply & Rebalance Grid Engine'}
        </button>
      </form>
    </div>
  );
};
