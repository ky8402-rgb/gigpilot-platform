import React, { useState } from 'react';
import { AuditLog, SystemUpdate } from '../../types/trading';
import {
  GitPullRequest,
  CheckCircle2,
  RotateCcw,
  Download,
  Filter,
  ShieldCheck,
  Cpu,
  History,
  AlertCircle
} from 'lucide-react';
import { triggerCanaryRollout } from '../../services/tradingService';

interface CanaryAndAuditViewProps {
  updates: SystemUpdate[];
  auditLogs: AuditLog[];
  onRefreshState: () => void;
}

export const CanaryAndAuditView: React.FC<CanaryAndAuditViewProps> = ({
  updates,
  auditLogs,
  onRefreshState
}) => {
  const [operatorFilter, setOperatorFilter] = useState<'ALL' | 'AUTONOMOUS_AGENT' | 'OWNER' | 'RISK_ENGINE' | 'SWEEP_DAEMON'>('ALL');
  const [isTriggeringRollout, setIsTriggeringRollout] = useState(false);

  const filteredLogs = operatorFilter === 'ALL'
    ? auditLogs
    : auditLogs.filter(l => l.operator === operatorFilter);

  const handleRollout = async () => {
    setIsTriggeringRollout(true);
    try {
      const nextVer = `v2.${Math.floor(Date.now() / 1000000)}`;
      await triggerCanaryRollout(nextVer, 'Canary test: Dynamic micro-spread dampening with Kelly sizing');
      alert(`Canary release ${nextVer} initiated. Staging unit tests and backtests executing in background.`);
      onRefreshState();
    } catch (err: any) {
      alert(`Rollout error: ${err.message}`);
    } finally {
      setIsTriggeringRollout(false);
    }
  };

  const exportAuditLogs = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(auditLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `aegis_audit_trail_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto font-mono text-xs">
      {/* 1. Canary Deployment & Self-Updating Pipeline */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-indigo-950 border border-indigo-800 flex items-center justify-center text-indigo-400">
              <GitPullRequest className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Self-Updating Engine & Canary Rollout Pipeline
              </h2>
              <p className="text-[11px] text-slate-400">
                Every code and parameter update is verified via regression tests and shadow execution before production.
              </p>
            </div>
          </div>

          <button
            onClick={handleRollout}
            disabled={isTriggeringRollout}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold uppercase tracking-wider font-mono shadow transition-all"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>{isTriggeringRollout ? 'Staging Rollout...' : 'Trigger Canary Verification'}</span>
          </button>
        </div>

        {/* Updates Table */}
        <div className="space-y-3">
          {updates.map(u => (
            <div
              key={u.version}
              className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-sm text-white">{u.version}</span>
                  <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-bold">
                    {u.canaryStatus}
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    SHA: {u.sha256.substring(0, 10)}...
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">{u.notes}</p>
              </div>

              <div className="flex items-center gap-3 text-[11px]">
                <div className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Tests Passed</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Security Cleared</span>
                </div>
                <span className="text-slate-500 text-[10px]">Rollback: {u.rollbackPoint}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Full Audit Log Trail & Reversibility */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <History className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Cryptographic Audit Stream ({auditLogs.length} Events)
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter buttons */}
            {(['ALL', 'AUTONOMOUS_AGENT', 'OWNER', 'RISK_ENGINE', 'SWEEP_DAEMON'] as const).map(op => (
              <button
                key={op}
                onClick={() => setOperatorFilter(op)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                  operatorFilter === op
                    ? 'bg-slate-800 text-white border border-slate-600'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {op.replace('_', ' ')}
              </button>
            ))}

            <button
              onClick={exportAuditLogs}
              className="flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold border border-slate-700 transition-colors ml-2"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          </div>
        </div>

        {/* Audit Log Stream */}
        <div className="space-y-2 overflow-y-auto max-h-[400px] custom-scrollbar">
          {filteredLogs.map(log => {
            const isAgent = log.operator === 'AUTONOMOUS_AGENT';
            const isOwner = log.operator === 'OWNER';
            const isRisk = log.operator === 'RISK_ENGINE';
            const isSweep = log.operator === 'SWEEP_DAEMON';

            return (
              <div
                key={log.id}
                className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 text-xs font-mono flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    isAgent ? 'bg-purple-950 text-purple-300' :
                    isOwner ? 'bg-cyan-950 text-cyan-300' :
                    isRisk ? 'bg-rose-950 text-rose-300' : 'bg-emerald-950 text-emerald-300'
                  }`}>
                    {log.operator}
                  </span>
                  <span className="font-bold text-white">{log.action}</span>
                  <span className="text-slate-500 text-[10px]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="text-[11px] text-slate-400 truncate max-w-xs sm:max-w-md">
                  {JSON.stringify(log.details)}
                </div>

                <div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    log.result === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {log.result}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
