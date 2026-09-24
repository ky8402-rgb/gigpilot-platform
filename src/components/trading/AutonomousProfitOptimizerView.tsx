import React, { useEffect, useState } from 'react';
import { BrainCircuit, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { fetchAutonomousOptimizer, runAutonomousOptimizer } from '../../services/tradingService';

export const AutonomousProfitOptimizerView: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const refresh = async () => { try { setData(await fetchAutonomousOptimizer()); } catch {} };
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, []);
  const runNow = async () => { setRunning(true); try { await runAutonomousOptimizer(); await refresh(); } finally { setRunning(false); } };
  const decision = data?.decisions?.[0];
  const build = data?.strategyBuilds?.[0];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-700/50 bg-slate-950/80 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-emerald-300 font-mono text-xs font-black uppercase tracking-wider"><BrainCircuit className="w-4 h-4" /> Autonomous Profit Intelligence</div>
            <h2 className="mt-1 text-xl font-black text-white">AI Audit → Decide → Build → Apply</h2>
            <p className="mt-1 text-xs text-slate-400">Objective: sustainable net realized profit after fees. Live production evidence only.</p>
          </div>
          <button onClick={runNow} disabled={running} className="px-3 py-2 rounded-lg border border-emerald-600/50 bg-emerald-950/60 text-emerald-300 text-xs font-bold flex items-center gap-2"><Zap className="w-3.5 h-3.5" /> {running ? 'AUDITING...' : 'AI AUDIT NOW'}</button>
        </div>
      </div>
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
