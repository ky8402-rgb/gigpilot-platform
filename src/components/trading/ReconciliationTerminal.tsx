import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Database,
  Layers,
  Clock,
  Activity,
  Flame,
  Zap,
  Scale
} from 'lucide-react';
import { PositionDriftRecord, ReconciliationAuditEvent, ReconciliationAuditStatus } from '../../types/trading';
import { fetchReconciliationStatus, triggerReconciliationAudit } from '../../services/tradingService';

export const ReconciliationTerminal: React.FC = () => {
  const [auditStatus, setAuditStatus] = useState<ReconciliationAuditStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  const loadStatus = async () => {
    try {
      const res = await fetchReconciliationStatus();
      if (res.success && res.reconciliation) {
        setAuditStatus(res.reconciliation);
      }
    } catch (err: any) {
      console.warn('[ReconciliationTerminal] Fetch error:', err?.message || err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    if (!autoRefresh) return;
    const interval = setInterval(loadStatus, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleAuditTrigger = async (autoHeal: boolean) => {
    try {
      setActionLoading(true);
      setMessage(null);
      const res = await triggerReconciliationAudit(autoHeal);
      if (res.success) {
        setAuditStatus(res.reconciliation);
        setMessage({
          type: 'success',
          text: res.message || 'Audit executed successfully.'
        });
      } else {
        setMessage({
          type: 'error',
          text: res.error || 'Failed to trigger reconciliation audit.'
        });
      }
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.message || 'Error communicating with engine'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: ReconciliationAuditStatus['status']) => {
    switch (status) {
      case 'SYNCED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            GROUND TRUTH SYNCED
          </span>
        );
      case 'SELF_HEALING':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            SELF-HEALING ACTIVE
          </span>
        );
      case 'DRIFT_DETECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" />
            DRIFT DETECTED
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <ShieldAlert className="w-3.5 h-3.5" />
            RECONCILIATION ERROR
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
            ENGINE OFF
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  Position & Order Reconciliation Engine
                </h2>
                {auditStatus && getStatusBadge(auditStatus.status)}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Continuous ground-truth verification between internal portfolio state and Bybit V5 Linear Futures
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-2 ${
                autoRefresh
                  ? 'bg-slate-800 text-slate-200 border-slate-700'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              Auto-poll (4s)
            </button>

            <button
              onClick={() => handleAuditTrigger(true)}
              disabled={actionLoading}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
              Audit & Auto-Heal Now
            </button>
          </div>
        </div>

        {message && (
          <div
            className={`mt-4 p-3 rounded-lg text-xs flex items-center gap-2 border ${
              message.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800 text-rose-300'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            )}
            <span>{message.text}</span>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Exchange Ground Truth</span>
            <Database className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold text-white">
              {auditStatus?.bybitConnected ? 'Connected' : 'Standby'}
            </span>
            <span className="text-xs text-slate-400">Bybit V5 Linear</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Perpetual Futures Category: <span className="text-slate-300 font-mono">linear</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Active Position Drifts</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-xl font-bold ${auditStatus?.activeDriftCount ? 'text-amber-400' : 'text-emerald-400'}`}>
              {auditStatus?.activeDriftCount ?? 0}
            </span>
            <span className="text-xs text-slate-400">discrepancies</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Tolerance threshold: <span className="text-slate-300 font-mono">&lt; 0.0001 / $0.10</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Auto-Healing Status</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold text-white">
              {auditStatus?.autoHealingEnabled ? 'Armed (30s)' : 'Manual Only'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Last Heal: <span className="text-slate-300">{auditStatus?.lastSelfHealTimestamp ? new Date(auditStatus.lastSelfHealTimestamp).toLocaleTimeString() : 'None required'}</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Last Audit</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold text-white">
              {auditStatus?.lastAuditTimestamp ? new Date(auditStatus.lastAuditTimestamp).toLocaleTimeString() : 'Pending'}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            State Consistency: <span className={auditStatus?.isClean ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>{auditStatus?.isClean ? '100% Invariant Compliant' : 'Drift Healing'}</span>
          </div>
        </div>
      </div>

      {/* Position Drift Matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-white">
              Position Discrepancy & Ground-Truth Matrix
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            {auditStatus?.activeDrifts?.length ? `${auditStatus.activeDrifts.length} unaligned symbol(s)` : 'All tracked positions clean'}
          </span>
        </div>

        {auditStatus?.activeDrifts && auditStatus.activeDrifts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800/50 text-slate-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Internal Portfolio Size</th>
                  <th className="p-3">Bybit Actual Size</th>
                  <th className="p-3">Drift Delta</th>
                  <th className="p-3">Estimated Drift (USD)</th>
                  <th className="p-3">Severity</th>
                  <th className="p-3">Action Taken</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {auditStatus.activeDrifts.map((drift, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30">
                    <td className="p-3 font-semibold text-white">{drift.symbol}</td>
                    <td className="p-3 font-mono">{drift.internalBaseAmount}</td>
                    <td className="p-3 font-mono text-emerald-400 font-semibold">{drift.exchangeBaseAmount}</td>
                    <td className="p-3 font-mono text-amber-400">{drift.deltaBaseAmount > 0 ? `+${drift.deltaBaseAmount}` : drift.deltaBaseAmount}</td>
                    <td className="p-3 font-mono">${drift.deltaUsd.toFixed(2)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 text-[10px] rounded font-semibold ${
                        drift.driftSeverity === 'CRITICAL'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {drift.driftSeverity}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400">{drift.actionTaken || 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center bg-slate-950/40 rounded-lg border border-slate-800/60">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
            <p className="text-sm font-medium text-slate-200">Zero Position Drift Detected</p>
            <p className="text-xs text-slate-400 mt-1">
              Internal risk inventory and order books are aligned with Bybit Linear Perpetual Futures.
            </p>
          </div>
        )}
      </div>

      {/* Reconciliation Audit Event Log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-white">
              Recent Self-Healing Reconciliation Events
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Retains last 20 automated audit records
          </span>
        </div>

        {auditStatus?.recentEvents && auditStatus.recentEvents.length > 0 ? (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {auditStatus.recentEvents.map((evt, idx) => (
              <div
                key={evt.id || idx}
                className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/80 flex items-start justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-2.5">
                  <span className={`p-1 rounded shrink-0 ${
                    evt.type === 'DRIFT_AUTO_HEALED'
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : evt.type === 'DRIFT_DETECTED'
                      ? 'bg-amber-500/20 text-amber-400'
                      : evt.type === 'ORDERS_RECONCILED'
                      ? 'bg-indigo-500/20 text-indigo-400'
                      : evt.type === 'RECONCILIATION_ERROR'
                      ? 'bg-rose-500/20 text-rose-400'
                      : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {evt.type === 'DRIFT_AUTO_HEALED' ? (
                      <RefreshCw className="w-3.5 h-3.5" />
                    ) : evt.type === 'DRIFT_DETECTED' ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                  </span>
                  <div>
                    <div className="font-semibold text-slate-200">
                      {evt.type.replace(/_/g, ' ')}
                    </div>
                    <div className="text-slate-400 mt-0.5 text-[11px]">
                      {evt.details}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 shrink-0 font-mono">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-slate-500">
            No audit events logged yet. The automated 30-second loop logs events on each audit run.
          </div>
        )}
      </div>
    </div>
  );
};
