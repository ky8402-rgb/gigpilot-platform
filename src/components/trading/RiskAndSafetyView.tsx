import React, { useState } from 'react';
import { RiskEvent, RiskRuleConfig } from '../../types/trading';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Lock,
  Sliders,
  SlidersHorizontal,
  Flame
} from 'lucide-react';
import {
  resetCircuitBreaker,
  updateRiskConfig
} from '../../services/tradingService';

interface RiskAndSafetyViewProps {
  config: RiskRuleConfig;
  circuitBreakerActive: boolean;
  events: RiskEvent[];
  onRefreshState: () => void;
}

export const RiskAndSafetyView: React.FC<RiskAndSafetyViewProps> = ({
  config,
  circuitBreakerActive,
  events,
  onRefreshState
}) => {
  const [maxAllocation, setMaxAllocation] = useState(config.maxPositionSizePct.toString());
  const [maxDailyLoss, setMaxDailyLoss] = useState(config.maxDailyLossPct.toString());
  const [maxDrawdown, setMaxDrawdown] = useState(config.maxDrawdownLimitPct.toString());
  const [maxOrders, setMaxOrders] = useState(config.maxOpenOrders.toString());
  const [maxSlippage, setMaxSlippage] = useState(config.maxSlippageBps.toString());
  const [minEdgeThreshold, setMinEdgeThreshold] = useState((config.minimum_edge_threshold ?? config.minExpectedNetEdgeBps ?? 4.0).toString());
  const [autoKillDrawdown, setAutoKillDrawdown] = useState(config.autoKillSwitchTriggerDrawdownPct.toString());
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [statusNotification, setStatusNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusNotification(null);
    try {
      await updateRiskConfig({
        maxPositionSizePct: Number(maxAllocation),
        maxDailyLossPct: Number(maxDailyLoss),
        maxDrawdownLimitPct: Number(maxDrawdown),
        maxOpenOrders: Number(maxOrders),
        maxSlippageBps: Number(maxSlippage),
        minExpectedNetEdgeBps: Number(minEdgeThreshold),
        minimum_edge_threshold: Number(minEdgeThreshold),
        autoKillSwitchTriggerDrawdownPct: Number(autoKillDrawdown)
      });
      setStatusNotification({ type: 'success', message: 'Risk parameters successfully updated and enforced across all engines.' });
      onRefreshState();
    } catch (err: any) {
      setStatusNotification({ type: 'error', message: `Error updating risk rules: ${err.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetCircuitBreaker = async () => {
    setIsResetting(true);
    setStatusNotification(null);
    try {
      await resetCircuitBreaker();
      setStatusNotification({ type: 'success', message: 'Circuit breaker successfully unlatched.' });
      onRefreshState();
    } catch (err: any) {
      setStatusNotification({ type: 'error', message: `Error resetting circuit breaker: ${err.message}` });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto font-mono text-xs">
      {statusNotification && (
        <div className={`p-3 rounded-lg border text-xs font-semibold flex items-center justify-between ${
          statusNotification.type === 'success'
            ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
            : 'bg-rose-950/80 border-rose-700 text-rose-300'
        }`}>
          <span>{statusNotification.message}</span>
          <button onClick={() => setStatusNotification(null)} className="text-slate-400 hover:text-white ml-2 text-xs">✕</button>
        </div>
      )}
      {/* 1. Circuit Breaker Latch Status */}
      <div className={`p-5 rounded-xl border shadow-xl flex flex-wrap items-center justify-between gap-4 ${
        circuitBreakerActive
          ? 'bg-rose-950/70 border-rose-600 text-rose-200'
          : 'bg-slate-900/80 border-slate-800 text-slate-200'
      }`}>
        <div className="flex items-center gap-3">
          {circuitBreakerActive ? (
            <div className="w-10 h-10 rounded-lg bg-rose-900 flex items-center justify-center text-rose-200 animate-pulse">
              <ShieldAlert className="w-6 h-6" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
          )}
          <div>
            <h3 className="font-extrabold text-sm uppercase tracking-wider text-white">
              {circuitBreakerActive ? 'CIRCUIT BREAKER ENGAGED — TRADING SUSPENDED' : 'INDEPENDENT RISK ENGINE ACTIVE'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {circuitBreakerActive
                ? 'A critical risk threshold was triggered. Order generation is blocked until owner manual verification.'
                : 'All orders and strategy actions are subject to strict mathematical safety veto constraints.'}
            </p>
          </div>
        </div>

        {circuitBreakerActive && (
          <button
            onClick={handleResetCircuitBreaker}
            disabled={isResetting}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-extrabold uppercase tracking-wider font-mono shadow-lg transition-all"
          >
            {isResetting ? 'Resetting...' : 'Manual Circuit Breaker Reset'}
          </button>
        )}
      </div>

      {/* 2. Hard Constraints Form */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4 mb-4">
          <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Hard Safety Thresholds (Immutable Veto Authority)
          </h3>
        </div>

        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-slate-400 block mb-1">Max Capital Allocation Per Pair (%)</label>
              <input
                type="number"
                step="1"
                value={maxAllocation}
                onChange={e => setMaxAllocation(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Max Daily Loss Limit (%)</label>
              <input
                type="number"
                step="0.5"
                value={maxDailyLoss}
                onChange={e => setMaxDailyLoss(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Max Peak-to-Trough Drawdown (%)</label>
              <input
                type="number"
                step="0.5"
                value={maxDrawdown}
                onChange={e => setMaxDrawdown(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Auto Kill Switch Trigger Drawdown (%)</label>
              <input
                type="number"
                step="0.5"
                value={autoKillDrawdown}
                onChange={e => setAutoKillDrawdown(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Max Open Order Count</label>
              <input
                type="number"
                value={maxOrders}
                onChange={e => setMaxOrders(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Max Tolerable Slippage (Basis Points)</label>
              <input
                type="number"
                value={maxSlippage}
                onChange={e => setMaxSlippage(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
              />
            </div>

            <div className="col-span-1 sm:col-span-2 lg:col-span-3 bg-cyan-950/30 border border-cyan-800/60 rounded-lg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <label className="text-cyan-300 font-bold block uppercase tracking-wide">
                  Minimum Edge Threshold (Basis Points) — Invariant: Expected Net Edge &gt; minimum_edge_threshold
                </label>
                <span className="text-[10px] text-cyan-400 font-bold bg-cyan-900/60 px-2 py-0.5 rounded border border-cyan-700/50">
                  FAIL-CLOSED PRE-TRADE GATE
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step="0.1"
                  value={minEdgeThreshold}
                  onChange={e => setMinEdgeThreshold(e.target.value)}
                  className="w-36 bg-slate-950 border border-cyan-700 rounded px-3 py-2 text-cyan-200 font-black text-sm"
                />
                <p className="text-[11px] text-slate-300 leading-snug">
                  Orders are strictly permitted to execute <strong>ONLY</strong> when: <code className="text-cyan-300">Expected Net Edge &gt; minimum_edge_threshold</code>. Formula: <span className="text-slate-400">Expected Gross Edge − maker/taker fees − expected spread cost − expected slippage − adverse-selection cost − funding/carrying cost − execution uncertainty</span>.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <span className="text-[10px] text-slate-500">
              Strategy logic or autonomous agents CANNOT override these values.
            </span>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-extrabold uppercase tracking-wider font-mono shadow"
            >
              {isSaving ? 'Updating...' : 'Save & Enforce Hard Rules'}
            </button>
          </div>
        </form>
      </div>

      {/* 3. Risk Events Stream */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <Flame className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Risk Interceptions & Veto Events Trail
          </h3>
        </div>

        {events.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            No risk violations recorded. Risk engine is operating within safe operational boundaries.
          </div>
        ) : (
          <div className="space-y-2">
            {events.map(ev => (
              <div
                key={ev.id}
                className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-bold">
                      {ev.severity}
                    </span>
                    <span className="font-bold text-white">{ev.ruleViolated}</span>
                    <span className="text-slate-500 text-[10px]">· {new Date(ev.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{ev.reason}</p>
                </div>
                <div className="text-[11px] text-cyan-300 font-semibold">
                  Action: {ev.actionTaken}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
