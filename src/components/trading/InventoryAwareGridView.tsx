import React from 'react';
import {
  Scale,
  Shield,
  ShieldAlert,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
  Sliders,
  Sparkles,
  RefreshCw,
  Info,
  Layers,
  Percent,
  Gauge,
  Activity,
  Zap,
  Lock,
  DollarSign
} from 'lucide-react';
import { GridConfiguration, InventoryAwarenessMetrics, MarketRegime } from '../../types/trading';

interface InventoryAwareGridViewProps {
  /** Optional so a missing label degrades instead of throwing — same class as the crash that took
   * the terminal down on `activeSymbol.replace(...)`. */
  activeSymbol?: string;
  currentPrice: number;
  marketRegime: MarketRegime;
  activeGrid: GridConfiguration | null;
  onRefresh?: () => void;
}

export const InventoryAwareGridView: React.FC<InventoryAwareGridViewProps> = ({
  activeSymbol,
  currentPrice,
  marketRegime,
  activeGrid,
  onRefresh}) => {

  const metrics: InventoryAwarenessMetrics | undefined = activeGrid?.inventoryAwareness;

  const baseAsset = (activeSymbol || 'BTC/USDT').split('/')[0] || 'BTC';
  // Fallback defaults if metrics not yet computed
  const currentBaseRatio = metrics?.currentBaseRatio ?? 0;
  const inventorySkew = metrics?.inventorySkew ?? 0;
  const inventoryPosturing = metrics?.inventoryPosturing ?? 'UNKNOWN';
  const buyAllocPct = metrics?.asymmetricBudgeting.buyAllocationPct ?? 0;
  const sellAllocPct = metrics?.asymmetricBudgeting.sellAllocationPct ?? 0;
  const buyMultiplier = metrics?.asymmetricOrderSizing.buyOrderSizeMultiplier ?? 0;
  const sellMultiplier = metrics?.asymmetricOrderSizing.sellOrderSizeMultiplier ?? 0;
  const buyHurdleBps = metrics?.asymmetricEdgeHurdles.requiredBuyEdgeHurdleBps ?? 0;
  const sellHurdleBps = metrics?.asymmetricEdgeHurdles.requiredSellEdgeHurdleBps ?? 0;
  const resPrice = metrics?.asymmetricSpacing.reservationPrice || currentPrice;
  const resShiftBps = metrics?.asymmetricSpacing.reservationPriceShiftBps || 0;
  const distLiqPct = metrics?.distanceFromLiquidationPct ?? 0;
  const liqTier = metrics?.liquidationRiskTier || 'UNKNOWN';


  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Equation Overview */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-xl p-5 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 uppercase tracking-wide flex items-center gap-1">
                <Scale className="w-3 h-3 text-indigo-400" />
                Inventory-Aware Grid Architecture
              </span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase border ${
                inventoryPosturing === 'HEAVILY_LONG'
                  ? 'bg-amber-950/60 text-amber-300 border-amber-500/50'
                  : inventoryPosturing === 'HEAVILY_SHORT'
                  ? 'bg-blue-950/60 text-blue-300 border-blue-500/50'
                  : 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50'
              }`}>
                Posture: {inventoryPosturing.replace('_', ' ')}
              </span>
              {liqTier === 'CRITICAL' && (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-500/60 animate-pulse">
                  CRITICAL LIQUIDATION RISK
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              Multi-Variable Asymmetric Quoting Engine
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Dynamically maps market volatility, trend momentum, current base inventory skew, distance from liquidation,
              and order book liquidity depth into asymmetric grid spacing, skewed order sizing, capital side bias, and inventory-adjusted edge hurdle rates.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Metrics
            </button>
          </div>
        </div>

        {/* The Equation Visualizer */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-2 text-center text-xs font-mono">
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-2">
            <span className="text-[10px] text-slate-400 block uppercase">1. Mid Price</span>
            <span className="font-bold text-white text-sm">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-2">
            <span className="text-[10px] text-slate-400 block uppercase">2. Volatility (ATR)</span>
            <span className="font-bold text-amber-300 text-sm">{marketRegime.atr?.toFixed(1) || '380.0'} USD</span>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-2">
            <span className="text-[10px] text-slate-400 block uppercase">3. Trend (ADX)</span>
            <span className="font-bold text-cyan-300 text-sm">{marketRegime.adx?.toFixed(1) || '18.5'} ({marketRegime.trendDirection})</span>
          </div>
          <div className={`border rounded-lg p-2 ${
            inventorySkew > 0.2 ? 'bg-amber-950/40 border-amber-500/40' : inventorySkew < -0.2 ? 'bg-blue-950/40 border-blue-500/40' : 'bg-slate-800/50 border-slate-700/60'
          }`}>
            <span className="text-[10px] text-slate-400 block uppercase">4. Inventory Skew</span>
            <span className="font-bold text-white text-sm">
              {inventorySkew >= 0 ? `+${inventorySkew}` : inventorySkew} ({Math.round(currentBaseRatio * 100)}% {baseAsset})
            </span>
          </div>
          <div className={`border rounded-lg p-2 ${
            liqTier === 'CRITICAL' ? 'bg-rose-950/50 border-rose-500/50 text-rose-300' : 'bg-slate-800/50 border-slate-700/60 text-emerald-300'
          }`}>
            <span className="text-[10px] text-slate-400 block uppercase">5. Dist. Liquidation</span>
            <span className="font-bold text-sm">{distLiqPct}% ({liqTier})</span>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-2">
            <span className="text-[10px] text-slate-400 block uppercase">6. Order-Book Depth</span>
            <span className="font-bold text-purple-300 text-sm">${Math.round((metrics?.bidDepthUsd || 125000) / 1000)}k / ${Math.round((metrics?.askDepthUsd || 118000) / 1000)}k</span>
          </div>
          <div className="bg-indigo-950/60 border border-indigo-500/50 rounded-lg p-2 flex flex-col justify-center">
            <span className="text-[10px] text-indigo-300 font-bold block uppercase">Output Bias</span>
            <span className="font-bold text-white text-sm">{metrics?.sideBias || 'SELL_HEAVY'}</span>
          </div>
        </div>
      </div>

      {/* 2. Core Operational Pillars: 4 Detailed Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pillar A: Avellaneda-Stoikov Spacing */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
            <span className="flex items-center gap-1 text-slate-300 font-bold">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              Asymmetric Spacing
            </span>
            <span className="text-slate-500">Reservation Shift</span>
          </div>
          <div className="space-y-2 mt-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Reservation Price:</span>
              <span className="font-bold text-white">${resPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Price Shift:</span>
              <span className={`font-bold ${resShiftBps > 0 ? 'text-amber-400' : resShiftBps < 0 ? 'text-blue-400' : 'text-slate-400'}`}>
                {resShiftBps > 0 ? `-${resShiftBps} bps` : `${Math.abs(resShiftBps)} bps`}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
              <span className="text-emerald-400">BUY Spacing:</span>
              <span className="font-bold text-emerald-300">{metrics?.asymmetricSpacing.buySpacingPct || 0.85}%</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-rose-400">SELL Spacing:</span>
              <span className="font-bold text-rose-300">{metrics?.asymmetricSpacing.sellSpacingPct || 0.35}%</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 italic">
            {inventorySkew > 0
              ? 'Quotes shifted downward. Sells tightened to accelerate offloading; buys widened to demand steep discount.'
              : 'Quotes shifted upward to favor accumulating base asset.'}
          </p>
        </div>

        {/* Pillar B: Capital Allocation Split */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
            <span className="flex items-center gap-1 text-slate-300 font-bold">
              <Percent className="w-3.5 h-3.5 text-amber-400" />
              Capital Allocation
            </span>
            <span className="text-slate-500">Side Budget</span>
          </div>
          <div className="space-y-2 mt-3">
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-emerald-400">BUY Allocation:</span>
                <span className="font-bold text-white">{Math.round(buyAllocPct * 100)}% (${metrics?.asymmetricBudgeting.buyBudgetUsd || 525})</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${buyAllocPct * 100}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-rose-400">SELL Allocation:</span>
                <span className="font-bold text-white">{Math.round(sellAllocPct * 100)}% (${metrics?.asymmetricBudgeting.sellBudgetUsd || 2975})</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-rose-500 h-full rounded-full" style={{ width: `${sellAllocPct * 100}%` }} />
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 italic">
            {inventorySkew > 0
              ? `Heavy long posture throttles new BUY capital by ${Math.round((0.5 - buyAllocPct) * 200)}% to protect cash reserves.`
              : 'Short posture scales up BUY capital allocation to replenish base inventory.'}
          </p>
        </div>

        {/* Pillar C: Asymmetric Order Sizing */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
            <span className="flex items-center gap-1 text-slate-300 font-bold">
              <Scale className="w-3.5 h-3.5 text-cyan-400" />
              Order Sizing Multipliers
            </span>
            <span className="text-slate-500">Per Rung</span>
          </div>
          <div className="space-y-2 mt-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">BUY Order Multiplier:</span>
              <span className={`font-bold text-xs px-2 py-0.5 rounded ${
                buyMultiplier < 1 ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30' : 'bg-slate-800 text-slate-200'
              }`}>
                {buyMultiplier}x ({buyMultiplier < 1 ? `-${Math.round((1 - buyMultiplier) * 100)}%` : `+${Math.round((buyMultiplier - 1) * 100)}%`})
              </span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">SELL Order Multiplier:</span>
              <span className={`font-bold text-xs px-2 py-0.5 rounded ${
                sellMultiplier > 1 ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-200'
              }`}>
                {sellMultiplier}x ({sellMultiplier > 1 ? `+${Math.round((sellMultiplier - 1) * 100)}%` : `-${Math.round((1 - sellMultiplier) * 100)}%`})
              </span>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Net Exposure Ratio:</span>
              <span className="font-bold text-indigo-300 font-mono">
                {(sellMultiplier / Math.max(0.1, buyMultiplier)).toFixed(2)}x SELL bias
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 italic">
            Each sell rung places larger volume to rapidly shed inventory when filled.
          </p>
        </div>

        {/* Pillar D: Inventory-Adjusted Edge Hurdles */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
            <span className="flex items-center gap-1 text-slate-300 font-bold">
              <Zap className="w-3.5 h-3.5 text-yellow-400" />
              Required Edge Hurdles
            </span>
            <span className="text-slate-500">Min Edge (bps)</span>
          </div>
          <div className="space-y-2 mt-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Base Net Edge Hurdle:</span>
              <span className="font-bold text-slate-300">4.0 bps</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-emerald-400 font-bold">Required BUY Hurdle:</span>
              <span className={`font-bold text-xs px-2 py-0.5 rounded font-mono ${
                buyHurdleBps > 6.0 ? 'bg-rose-950/70 text-rose-300 border border-rose-500/40' : 'bg-slate-800 text-slate-200'
              }`}>
                {buyHurdleBps} bps
              </span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-rose-400 font-bold">Required SELL Hurdle:</span>
              <span className="font-bold text-xs px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 font-mono">
                {sellHurdleBps} bps
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 italic">
            {inventorySkew > 0
              ? 'Conceptual requirement enforced: increased required edge for additional BUYs; lowered hurdle for SELLs.'
              : 'Symmetric or inverse hurdle thresholds applied.'}
          </p>
        </div>
      </div>

      {/* 4. Active Safeguards & Microstructure Enforcement Log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
          <ShieldCheckIcon className="w-4 h-4 text-emerald-400" />
          Active Algorithmic Safeguards & Microstructure Directives
        </h3>
        <div className="space-y-2">
          {metrics?.activeSafeguards && metrics.activeSafeguards.length > 0 ? (
            metrics.activeSafeguards.map((safeguard, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-lg flex items-start gap-2.5 text-xs font-mono"
              >
                <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <span className="text-slate-300 leading-relaxed">{safeguard}</span>
              </div>
            ))
          ) : (
            <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-lg text-xs font-mono text-slate-400">
              Inventory balanced. Standard bilateral quoting and expected net edge hurdles engaged.
            </div>
          )}
        </div>
      </div>

      {/* 5. Asymmetric Grid Level Rungs Matrix */}
      {activeGrid && activeGrid.activeLevels && activeGrid.activeLevels.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Active Inventory-Aware Grid Level Matrix ({activeGrid.activeLevels.length} Levels)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Each rung incorporates individual size multipliers and inventory-adjusted required edge hurdles.
              </p>
            </div>
            <div className="text-xs font-mono text-slate-400">
              Allocation: <span className="text-white font-bold">${activeGrid.totalAllocatedUsd} USDT</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                  <th className="py-2.5 px-3">Level</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3 text-right">Price (USDT)</th>
                  <th className="py-2.5 px-3 text-right">Distance to Mid</th>
                  <th className="py-2.5 px-3 text-right">Order Size ({baseAsset})</th>
                  <th className="py-2.5 px-3 text-right">Size Multiplier</th>
                  <th className="py-2.5 px-3 text-right">Value (USDT)</th>
                  <th className="py-2.5 px-3 text-right">Req. Edge Hurdle</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {activeGrid.activeLevels.map((lvl) => {
                  const distFromMidPct = Number(
                    (((lvl.price - currentPrice) / currentPrice) * 100).toFixed(2)
                  );
                  const isBuy = lvl.side === 'BUY';
                  return (
                    <tr key={lvl.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-3 text-slate-400">#{lvl.index}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          isBuy ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60' : 'bg-rose-950 text-rose-400 border border-rose-800/60'
                        }`}>
                          {lvl.side}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-white">
                        ${lvl.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-bold ${distFromMidPct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {distFromMidPct >= 0 ? `+${distFromMidPct}%` : `${distFromMidPct}%`}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-200">
                        {lvl.orderSize}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {lvl.orderSizeMultiplier ? `${lvl.orderSizeMultiplier}x` : '1.0x'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-white">
                        ${lvl.valueUsd}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-yellow-400">
                        {lvl.requiredEdgeHurdleBps ? `${lvl.requiredEdgeHurdleBps} bps` : '4.0 bps'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                          {lvl.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

function ShieldCheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
