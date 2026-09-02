import React, { useState, useEffect, useRef } from 'react';
import type { WorkOrder } from '../../App';
import type { FreelanceJob } from '../../types';
import { WorkOrderTimeline } from '../WorkOrderTimeline';

interface WorkOrdersViewProps {
  workOrders: WorkOrder[];
  isSyncingRemoteOK: boolean;
  onSyncRemoteOK: () => void;
  onExploreRemoteOK: () => void;
  onNewCustomOrder: () => void;
  onOpenSettings: () => void;
  onAcceptOrder: (id: number | string) => void;
  onCompleteOrder: (id: number | string) => void;
  onSaveCustomAmount: (id: number | string, amount: number) => void;
  onOpenProposalStudio: (job: FreelanceJob) => void;
  onOpenAnalysisModal: (job: FreelanceJob) => void;
  toFreelanceJob: (order: WorkOrder) => FreelanceJob;
  fmt: (n: number) => string;
}

/**
 * Format remaining milliseconds into human-readable DDd HHh MMm SSs
 */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (days > 0) {
    return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export const WorkOrdersView: React.FC<WorkOrdersViewProps> = ({
  workOrders,
  isSyncingRemoteOK,
  onSyncRemoteOK,
  onExploreRemoteOK,
  onNewCustomOrder,
  onOpenSettings,
  onAcceptOrder,
  onCompleteOrder,
  onSaveCustomAmount,
  onOpenProposalStudio,
  onOpenAnalysisModal,
  toFreelanceJob,
  fmt,
}) => {
  const [editingOrderId, setEditingOrderId] = useState<string | number | null>(null);
  const [editingAmountValue, setEditingAmountValue] = useState<string>('');
  const [now, setNow] = useState<number>(Date.now());
  const [pollingActive, setPollingActive] = useState<boolean>(true);

  const onSyncRemoteOKRef = useRef(onSyncRemoteOK);
  useEffect(() => {
    onSyncRemoteOKRef.current = onSyncRemoteOK;
  }, [onSyncRemoteOK]);

  // 1. Ticking timer every 1000ms for continuous real-time countdown updates
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Poll work orders status every 5000ms from backend
  useEffect(() => {
    if (!pollingActive) return;
    const pollInterval = setInterval(() => {
      onSyncRemoteOKRef.current?.();
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [pollingActive]);

  const handleSaveAmount = (orderId: string | number) => {
    const val = parseFloat(editingAmountValue);
    if (!isNaN(val) && val >= 0) {
      onSaveCustomAmount(orderId, val);
      setEditingOrderId(null);
      setEditingAmountValue('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-[#161b2b] rounded-2xl border border-[#2a3147] p-6 shadow-lg">
        <div className="flex flex-wrap items-center justify-between pb-4 border-b border-[#2a3147] mb-5 gap-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <i className="fas fa-clipboard-list text-[#4f7cff]"></i>
              Live Work Orders &amp; Pipeline
            </h3>
            <p className="text-xs text-[#9aa2bf] mt-0.5">
              Real-time contract ingestion from RemoteOK and public remote streams (Zero API keys required)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={onExploreRemoteOK}
              className="bg-[#1e1730] hover:bg-[#281e42] border border-purple-500/40 text-purple-300 px-3.5 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <i className="fas fa-globe text-[11px] text-purple-400"></i>
              <span>+ Explore RemoteOK Feed</span>
            </button>

            <button
              onClick={onSyncRemoteOK}
              disabled={isSyncingRemoteOK}
              className="bg-[#161b2b] hover:bg-[#1e2438] border border-[#2a3147] hover:border-purple-500/50 text-white px-3.5 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-60"
            >
              <i className={`fas fa-sync-alt text-[11px] ${isSyncingRemoteOK ? 'animate-spin text-purple-300' : 'text-purple-400'}`}></i>
              <span>{isSyncingRemoteOK ? 'Syncing...' : 'Sync Feed'}</span>
            </button>

            <button
              onClick={onNewCustomOrder}
              className="bg-[#4f7cff] hover:bg-[#3d6bf0] text-white px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <i className="fas fa-plus text-[11px]"></i>
              <span>+ Custom Order</span>
            </button>
          </div>
        </div>

        {/* Status Banner */}
        <div className="mb-4 p-3 rounded-xl bg-[#0d101a] border border-[#20273a] flex flex-wrap items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-3 text-[#9aa2bf] flex-wrap">
            <span className="flex items-center gap-1.5 text-purple-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
              RemoteOK Public Feed: Connected (Zero-Auth)
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              PayPal Instant Escrow: Ready (USD)
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5 text-cyan-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
              Bank Settlement: Ready (Direct)
            </span>
          </div>
          <button
            onClick={onOpenSettings}
            className="text-xs text-purple-400 hover:underline font-medium cursor-pointer"
          >
            Stream Architecture Info →
          </button>
        </div>

        <div className="space-y-3">
          {workOrders.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              <i className="fas fa-folder-open text-2xl mb-2 text-slate-500 block"></i>
              No active work orders. Click "+ Explore RemoteOK Feed" to ingest jobs.
            </div>
          ) : (
            workOrders.map((order, idx) => {
              const deadlineMs = order.completion_deadline ? new Date(order.completion_deadline).getTime() : 0;
              const timeRemainingMs = deadlineMs > 0 ? Math.max(0, deadlineMs - now) : 0;
              const isOverdue = deadlineMs > 0 && deadlineMs <= now && order.status !== 'completed';
              const isCompleted = order.status === 'completed';

              return (
                <div
                  key={`wo-all-${order.id || idx}-${idx}`}
                  className={`flex flex-wrap items-center justify-between p-4 bg-[#11141f] rounded-xl border ${
                    isCompleted
                      ? 'border-emerald-500/30 bg-[#0d141e]/50'
                      : isOverdue
                      ? 'border-amber-500/40 bg-[#191310]/50'
                      : order.platform === 'RemoteOK'
                      ? 'border-purple-500/40 hover:border-purple-400'
                      : 'border-[#2a3147] hover:border-[#4f7cff]'
                  } transition-all gap-4`}
                >
                  <div className="space-y-1.5 max-w-xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-white">{order.title}</span>
                      
                      {/* Platform Badge */}
                      <span className={`text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded-full border ${
                        order.platform === 'RemoteOK'
                          ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                          : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                      }`}>
                        {order.platform || 'RemoteOK'}
                      </span>

                      {/* Status Badge */}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isCompleted
                          ? 'bg-[#2ecc71]/15 text-[#2ecc71] border border-[#2ecc71]/30'
                          : order.status === 'in-progress'
                          ? 'bg-[#4f7cff]/15 text-[#4f7cff] border border-[#4f7cff]/30'
                          : order.status === 'urgent'
                          ? 'bg-[#e74c3c]/15 text-[#e74c3c] border border-[#e74c3c]/30'
                          : 'bg-[#f39c12]/15 text-[#f39c12] border border-[#f39c12]/30'
                      }`}>
                        {isCompleted ? '✓ Completed' : order.status}
                      </span>

                      {/* Real-Time Live Countdown or Completed Stamp */}
                      {isCompleted ? (
                        <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <i className="fas fa-check-circle text-[10px]"></i>
                          {order.completed_at ? `Done at ${new Date(order.completed_at).toLocaleTimeString()}` : 'Auto-Completed'}
                        </span>
                      ) : deadlineMs > 0 ? (
                        isOverdue ? (
                          <span className="text-[11px] font-mono text-amber-300 bg-amber-950/60 border border-amber-500/40 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                            <i className="fas fa-exclamation-triangle text-[10px]"></i>
                            Overdue (Auto-completing...)
                          </span>
                        ) : (
                          <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                            timeRemainingMs < 3600000
                              ? 'bg-rose-950/50 text-rose-300 border-rose-500/40'
                              : 'bg-blue-950/50 text-blue-300 border-blue-500/30'
                          }`}>
                            <i className="far fa-clock text-[10px] animate-spin-slow"></i>
                            {formatCountdown(timeRemainingMs)} left
                          </span>
                        )
                      ) : null}

                      {order.location && (
                        <span className="text-[10px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700">
                          <i className="fas fa-map-marker-alt text-[9px] mr-1 text-slate-400"></i>
                          {order.location}
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-[#9aa2bf] flex flex-wrap items-center gap-3">
                      <span><i className="fas fa-building mr-1 text-[10px] text-slate-500"></i>{order.category}</span>
                      <span><i className="far fa-clock mr-1 text-[10px] text-slate-500"></i>{order.time}</span>
                      {order.worker_email && (
                        <span><i className="fas fa-user-cog mr-1 text-[10px] text-blue-400"></i>Worker: {order.worker_email}</span>
                      )}
                      {order.clientName && (
                        <span><i className="fas fa-user-check mr-1 text-[10px] text-emerald-400"></i>{order.clientName}</span>
                      )}
                      {((order as any).external_project_url || (order as any).external_id || order.url) ? (
                        <a
                          href={(order as any).external_project_url || ((order as any).external_id ? `https://www.freelancer.com/projects/${(order as any).external_id}` : order.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300 hover:underline inline-flex items-center gap-1 font-medium"
                        >
                          <i className="fas fa-external-link-alt text-[10px]"></i>
                          {(order as any).external_id ? `Project #${(order as any).external_id}` : 'View Job Post'}
                        </a>
                      ) : (
                        <span className="text-slate-500 inline-flex items-center gap-1 text-[11px]">
                          <i className="fas fa-link-slash text-[9px]"></i> Link Not Available
                        </span>
                      )}
                    </div>

                    {order.description && (
                      <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed bg-[#0b0d15]/50 p-2 rounded-lg border border-[#1e2538]">
                        {order.description.replace(/<[^>]*>?/gm, '').slice(0, 160)}...
                      </p>
                    )}

                    {order.tags && order.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {order.tags.slice(0, 5).map((t, ti) => (
                          <span key={ti} className="text-[10px] bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700 font-mono">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {editingOrderId === order.id ? (
                      <div className="flex items-center gap-1.5 bg-[#0b0d15] p-1.5 rounded-lg border border-[#4f7cff]">
                        <input
                          type="number"
                          autoFocus
                          value={editingAmountValue}
                          onChange={(e) => setEditingAmountValue(e.target.value)}
                          placeholder="USDT"
                          className="w-20 bg-transparent text-xs font-mono text-white px-2 py-0.5 focus:outline-none"
                        />
                        <button
                          onClick={() => handleSaveAmount(order.id)}
                          className="text-[#2ecc71] hover:text-emerald-300 p-1 text-xs cursor-pointer"
                          title="Save Amount"
                        >
                          <i className="fas fa-check"></i>
                        </button>
                        <button
                          onClick={() => setEditingOrderId(null)}
                          className="text-slate-400 hover:text-white p-1 text-xs cursor-pointer"
                          title="Cancel"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={`font-mono font-bold text-base ${order.amount === 0 ? 'text-[#f39c12]' : 'text-[#2ecc71]'}`}>
                          {order.amount === 0 ? 'Quote / Rate Pending' : `${fmt(order.amount)} USDT`}
                        </span>
                        <button
                          onClick={() => {
                            setEditingOrderId(order.id);
                            setEditingAmountValue(order.amount ? String(order.amount) : '350');
                          }}
                          className="text-xs text-[#5d6788] hover:text-[#4f7cff] p-1 cursor-pointer"
                          title="Set / Edit Contract Quote"
                        >
                          <i className="fas fa-edit"></i>
                        </button>
                      </div>
                    )}
                    
                    {/* Interactive AI Tools */}
                    <button
                      onClick={() => {
                        const freelanceJob = toFreelanceJob(order);
                        onOpenProposalStudio(freelanceJob);
                      }}
                      className="bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                      title="Generate client proposal with Gemini 3.7 Flash"
                    >
                      <i className="fas fa-magic text-[10px]"></i>
                      <span className="hidden sm:inline">AI Pitch</span>
                    </button>

                    <button
                      onClick={() => {
                        const freelanceJob = toFreelanceJob(order);
                        onOpenAnalysisModal(freelanceJob);
                      }}
                      className="bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer"
                      title="Audit client risk and profit margin"
                    >
                      <i className="fas fa-shield-alt text-[10px]"></i>
                      <span className="hidden sm:inline">Audit</span>
                    </button>

                    {order.status === 'pending' && (
                      <button
                        onClick={() => onAcceptOrder(order.id)}
                        className="bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 border border-blue-500/30 cursor-pointer"
                      >
                        <i className="fas fa-play text-[10px]"></i> Accept Contract
                      </button>
                    )}

                    {(order.status === 'in-progress' || order.status === 'urgent') && (
                      <button
                        onClick={() => onCompleteOrder(order.id)}
                        className="bg-[#2ecc71]/20 hover:bg-[#2ecc71] text-[#2ecc71] hover:text-slate-950 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 border border-[#2ecc71]/30 cursor-pointer"
                      >
                        <i className="fas fa-check text-[10px]"></i> Complete &amp; Release
                      </button>
                    )}

                    {isCompleted && (
                      <span className="text-xs text-[#2ecc71] font-medium flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1.5 rounded-full">
                        <i className="fas fa-check-circle text-[#2ecc71]"></i> Completed &amp; Paid
                      </span>
                    )}
                  </div>

                  {/* Visual Lifecycle Timeline: Pending -> In-Progress -> Escrow Released -> Completed */}
                  <div className="w-full pt-2">
                    <WorkOrderTimeline
                      status={order.status}
                      paymentStatus={(order as any).payment_status}
                      customerConfirmed={(order as any).customer_confirmed}
                      workerMarkedComplete={(order as any).worker_marked_complete}
                      completedAt={order.completed_at}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkOrdersView;
