import React, { useState } from 'react';
import { LearningDecisionStats, TradeDecision } from '../../types/trading';
import { Shield, CheckCircle2, XCircle, AlertTriangle, Activity } from 'lucide-react';
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
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<TradeDecision | null>(null);
  const stats = decisionStats;

  const handleRunEvaluation = async () => {
    setIsEvaluating(true);
    try {
      const res = await evaluateSignalDecision({ symbol: currentSymbol, side, source: 'LIVE_OPERATOR_REVIEW' });
      if (res.success && res.decision) {
        setEvaluationResult(res.decision);
        onRefresh?.();
      }
    } catch (err) {
      console.error('Live decision evaluation failed:', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3 text-white font-bold">
          <Shield className="w-4 h-4 text-cyan-400" />
          Live Decision Pipeline
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Decisions are evaluated from fresh Bybit market data only. This control never fabricates prices, depth, regime, or inventory.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setSide('BUY')} className={`px-4 py-2 rounded-lg border ${side === 'BUY' ? 'bg-emerald-900/50 border-emerald-500 text-emerald-300' : 'bg-slate-950 border-slate-700 text-slate-400'}`}>BUY</button>
          <button onClick={() => setSide('SELL')} className={`px-4 py-2 rounded-lg border ${side === 'SELL' ? 'bg-rose-900/50 border-rose-500 text-rose-300' : 'bg-slate-950 border-slate-700 text-slate-400'}`}>SELL</button>
          <button onClick={handleRunEvaluation} disabled={isEvaluating} className="px-4 py-2 rounded-lg bg-cyan-700 text-white disabled:opacity-50">
            {isEvaluating ? 'Evaluating live data…' : 'Evaluate Live Decision'}
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3"><div className="text-[10px] text-slate-500">Evaluated</div><div className="text-lg text-white font-bold">{stats.totalEvaluated}</div></div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3"><div className="text-[10px] text-slate-500">BUY</div><div className="text-lg text-emerald-300 font-bold">{stats.buyDecisions}</div></div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3"><div className="text-[10px] text-slate-500">SELL</div><div className="text-lg text-rose-300 font-bold">{stats.sellDecisions}</div></div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3"><div className="text-[10px] text-slate-500">DO NOTHING</div><div className="text-lg text-slate-200 font-bold">{stats.doNothingDecisions}</div></div>
        </div>
      )}

      {evaluationResult && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-white font-bold mb-3"><Activity className="w-4 h-4 text-cyan-400" />Live evaluation result</div>
          <div className="flex items-center gap-2 mb-3">
            {evaluationResult.finalOutcome === 'BUY' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : evaluationResult.finalOutcome === 'SELL' ? <XCircle className="w-4 h-4 text-rose-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
            <span className="text-white font-bold">{evaluationResult.outcome}</span>
            <span className="text-slate-400 text-xs">{evaluationResult.symbol}</span>
          </div>
          <div className="space-y-1 text-xs text-slate-300">
            {Object.entries(evaluationResult.gates).map(([key, gate]) => (
              <div key={key} className="flex justify-between border-b border-slate-900 py-1">
                <span>{gate.name}</span><span className={gate.passed ? 'text-emerald-300' : 'text-rose-300'}>{gate.passed ? 'PASS' : 'BLOCK'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
