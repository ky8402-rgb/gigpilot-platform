import React, { useState } from 'react';
import { StrategyVersion } from '../../types/trading';
import {
  Trophy,
  Swords,
  TrendingUp,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
  XCircle,
  PlusCircle,
  Sparkles,
  GitCommit,
  ArrowRight
} from 'lucide-react';

interface LearningLoopViewProps {
  champion: StrategyVersion;
  challengers: StrategyVersion[];
  history: StrategyVersion[];
  onPromoteChallenger: (id: string) => Promise<{ success: boolean; reason: string }>;
  onCreateVariant: (params: {
    baseStrategyId: string;
    name: string;
    reasonForChange: string;
    parameters: Partial<StrategyVersion['parameters']>;
    expectedEffect: string;
  }) => Promise<void>;
}

export const LearningLoopView: React.FC<LearningLoopViewProps> = ({
  champion,
  challengers,
  history,
  onPromoteChallenger,
  onCreateVariant
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [variantName, setVariantName] = useState('Adaptive High-Vol Challenger');
  const [variantReason, setVariantReason] = useState('Testing tighter 0.8% geometric step with ATR dampening');
  const [variantExpected, setVariantExpected] = useState('Aiming for +15% trade frequency and Sharpe > 2.7');
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [evalMessage, setEvalMessage] = useState<{ id: string; success: boolean; reason: string } | null>(null);

  const handleEvaluate = async (challengerId: string) => {
    setEvaluatingId(challengerId);
    setEvalMessage(null);
    try {
      const res = await onPromoteChallenger(challengerId);
      setEvalMessage({ id: challengerId, success: res.success, reason: res.reason });
    } catch (err: any) {
      setEvalMessage({ id: challengerId, success: false, reason: err.message });
    } finally {
      setEvaluatingId(null);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onCreateVariant({
        baseStrategyId: champion.id,
        name: variantName,
        reasonForChange: variantReason,
        parameters: {
          gridSpacingPct: 0.8,
          gridLevels: 24,
          volatilityMultiplier: 1.6
        },
        expectedEffect: variantExpected
      });
      setShowCreateModal(false);
    } catch (err: any) {
      alert(`Error creating strategy variant: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto font-mono text-xs">
      {/* 1. Champion Strategy Card */}
      <div className="bg-slate-900/90 border border-emerald-500/40 rounded-xl p-5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-950 border border-emerald-700 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/20">
              <Trophy className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold text-white">{champion.name}</span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-[10px]">
                  CHAMPION · {champion.version}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Primary active strategy routing live/paper capital · ID: {champion.id}
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-bold transition-all shadow"
          >
            <PlusCircle className="w-3.5 h-3.5 text-cyan-400" />
            <span>Generate Challenger Variant</span>
          </button>
        </div>

        {/* Champion Key Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
            <span className="text-slate-500 block text-[10px]">NET PROFIT</span>
            <span className="text-sm font-extrabold text-emerald-400">
              +${champion.liveTradingResults.netProfit.toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-400 block">ROI: +{champion.liveTradingResults.roiPct}%</span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
            <span className="text-slate-500 block text-[10px]">SHARPE RATIO</span>
            <span className="text-sm font-extrabold text-white">
              {champion.liveTradingResults.sharpeRatio}
            </span>
            <span className="text-[10px] text-purple-300 block">Sortino: {champion.liveTradingResults.sortinoRatio}</span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
            <span className="text-slate-500 block text-[10px]">MAX DRAWDOWN</span>
            <span className="text-sm font-extrabold text-cyan-300">
              {champion.liveTradingResults.maxDrawdownPct}%
            </span>
            <span className="text-[10px] text-slate-400 block">Peak-to-trough</span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
            <span className="text-slate-500 block text-[10px]">WIN RATE</span>
            <span className="text-sm font-extrabold text-amber-300">
              {champion.liveTradingResults.winRatePct}%
            </span>
            <span className="text-[10px] text-slate-400 block">PF: {champion.liveTradingResults.profitFactor}x</span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
            <span className="text-slate-500 block text-[10px]">FILL RATE</span>
            <span className="text-sm font-extrabold text-white">
              {champion.liveTradingResults.orderFillRatePct}%
            </span>
            <span className="text-[10px] text-slate-400 block">{champion.liveTradingResults.tradesCount} trades</span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-2.5">
            <span className="text-slate-500 block text-[10px]">VALIDATION SCORE</span>
            <span className="text-sm font-extrabold text-emerald-300">
              {(champion.validationScore * 100).toFixed(0)}/100
            </span>
            <span className="text-[10px] text-slate-400 block">Out-of-sample</span>
          </div>
        </div>

        {/* Champion Hyperparameters */}
        <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/60 flex flex-wrap items-center gap-4 text-[11px] text-slate-300">
          <div>Levels: <strong className="text-white">{champion.parameters.gridLevels}</strong></div>
          <div>Spacing: <strong className="text-white">{champion.parameters.gridSpacingPct}% ({champion.parameters.spacingType})</strong></div>
          <div>Vol Multiplier: <strong className="text-white">{champion.parameters.volatilityMultiplier}x</strong></div>
          <div>Trend Filter EMA: <strong className="text-white">{champion.parameters.trendFilterEma}</strong></div>
          <div>Stop Loss: <strong className="text-rose-400">{champion.parameters.stopLossPct}%</strong></div>
          <div>Take Profit: <strong className="text-emerald-400">{champion.parameters.takeProfitPct}%</strong></div>
        </div>
      </div>

      {/* 2. Challenger Candidates Arena */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400">
            <Swords className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Challenger Arena & Parallel Paper Evaluation
            </h3>
            <p className="text-[11px] text-slate-400">
              Strategies paper-trading concurrently; gate checks enforce higher Sharpe and lower drawdown before promotion
            </p>
          </div>
        </div>

        {challengers.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-mono text-xs">
            No active challengers competing in the arena. Create a variant or allow the autonomous research agent to spawn candidates.
          </div>
        ) : (
          <div className="space-y-4">
            {challengers.map(c => {
              const sharpeDiff = c.liveTradingResults.sharpeRatio - champion.liveTradingResults.sharpeRatio;
              const ddDiff = c.liveTradingResults.maxDrawdownPct - champion.liveTradingResults.maxDrawdownPct;
              const profitDiff = c.liveTradingResults.netProfit - champion.liveTradingResults.netProfit;

              return (
                <div
                  key={c.id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-all"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-white">{c.name}</span>
                        <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30 text-[10px]">
                          CHALLENGER · {c.version}
                        </span>
                        <span className="text-slate-500 text-[11px]">Parent: {c.parentVersionId}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {c.reasonForChange}
                      </p>
                    </div>

                    <button
                      onClick={() => handleEvaluate(c.id)}
                      disabled={evaluatingId === c.id}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider shadow shadow-emerald-600/20 transition-all"
                    >
                      {evaluatingId === c.id ? 'Evaluating Gate Check...' : 'Evaluate for Promotion'}
                    </button>
                  </div>

                  {/* Comparison Stats vs Champion */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 mb-3 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[10px]">NET PROFIT VS CHAMPION</span>
                      <span className={`font-bold ${profitDiff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${c.liveTradingResults.netProfit.toLocaleString()} ({profitDiff >= 0 ? '+' : ''}${profitDiff.toFixed(0)})
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[10px]">SHARPE RATIO</span>
                      <span className={`font-bold ${sharpeDiff > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                        {c.liveTradingResults.sharpeRatio} ({sharpeDiff > 0 ? `+${sharpeDiff.toFixed(2)}` : sharpeDiff.toFixed(2)})
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[10px]">MAX DRAWDOWN</span>
                      <span className={`font-bold ${ddDiff < 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {c.liveTradingResults.maxDrawdownPct}% ({ddDiff < 0 ? `${ddDiff.toFixed(1)}%` : `+${ddDiff.toFixed(1)}%`})
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[10px]">WIN RATE / TRADES</span>
                      <span className="font-bold text-amber-300">
                        {c.liveTradingResults.winRatePct}% ({c.liveTradingResults.tradesCount} trades)
                      </span>
                    </div>
                  </div>

                  {evalMessage && evalMessage.id === c.id && (
                    <div className={`p-2.5 rounded text-xs flex items-center gap-2 mb-2 ${
                      evalMessage.success ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                    }`}>
                      {evalMessage.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                      <span>{evalMessage.reason}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>Expected: {c.expectedEffect}</span>
                    <span>Validation Score: {(c.validationScore * 100).toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Strategy Lineage & Version History */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2.5 mb-4">
          <GitCommit className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Reversible Strategy Lineage & Rollback Points
          </h3>
        </div>

        <div className="divide-y divide-slate-800/80">
          {history.map(s => (
            <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  s.status === 'CHAMPION' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-800 text-slate-400'
                }`}>
                  {s.status}
                </span>
                <span className="font-bold text-white">{s.name} ({s.version})</span>
                <span className="text-slate-500 text-[11px] hidden sm:inline">{s.reasonForChange}</span>
              </div>
              <div className="text-right text-slate-400 text-[11px]">
                ROI: <strong className="text-emerald-400">+{s.liveTradingResults.roiPct}%</strong> | Sharpe: {s.liveTradingResults.sharpeRatio}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Variant Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl text-slate-100">
            <h3 className="font-extrabold text-base text-white mb-2">Create Challenger Strategy Variant</h3>
            <p className="text-xs text-slate-400 mb-4">
              Spawn a perturbation candidate from current Champion ({champion.name}) for parallel live-evidence validation.
            </p>

            <form onSubmit={handleCreateSubmit} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Variant Name</label>
                <input
                  type="text"
                  value={variantName}
                  onChange={e => setVariantName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Reason For Modification</label>
                <input
                  type="text"
                  value={variantReason}
                  onChange={e => setVariantReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Expected Effect</label>
                <input
                  type="text"
                  value={variantExpected}
                  onChange={e => setVariantExpected(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold uppercase tracking-wider"
                >
                  Spawn Challenger
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
