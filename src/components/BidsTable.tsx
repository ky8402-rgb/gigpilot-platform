import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BackendBidItem, BACKEND_BASE_URL, withdrawOnFreelancer, updateBidStatus, generateAIProposalBackend } from '../services/api';
import { formatPackageName } from './PackageChart';

// Conditional logic handler for withdraw destination target URL and styling
export function getWithdrawalTarget(platform?: string, jobUrl?: string) {
  const p = (platform || '').toLowerCase().trim();
  if (p.includes('upwork')) {
    return {
      url: 'https://www.upwork.com/nx/navigator/payments/withdraw',
      label: '💰 Withdraw on Upwork',
      tooltip: 'Withdraw your earned funds directly on Upwork (opens in new tab)',
      platformName: 'Upwork',
      btnClass: 'bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 border-emerald-500/40 shadow-emerald-500/20',
      icon: 'fas fa-money-bill-wave',
      isDirectWithdrawal: true,
    };
  } else if (p.includes('remote') || p.includes('remoteok')) {
    return {
      url: jobUrl || 'https://remoteok.com',
      label: '📧 Contact Client',
      tooltip: 'Contact the client directly to discuss payment',
      platformName: 'RemoteOK',
      btnClass: 'bg-orange-500/20 hover:bg-orange-500 text-orange-300 hover:text-slate-950 border-orange-500/40 shadow-orange-500/20',
      icon: 'fas fa-envelope',
      isDirectWithdrawal: false,
    };
  }
  // Default to Freelancer.com official financial withdrawal portal
  return {
    url: 'https://www.freelancer.com/payments/withdraw.php',
    label: '💰 Withdraw on Freelancer',
    tooltip: 'Withdraw your earned funds directly on Freelancer.com (opens in new tab)',
    platformName: 'Freelancer',
    btnClass: 'bg-sky-500/20 hover:bg-sky-500 text-sky-300 hover:text-slate-950 border-sky-500/40 shadow-sky-500/20',
    icon: 'fas fa-money-bill-wave',
    isDirectWithdrawal: true,
  };
}

interface BidsTableProps {
  onSelectBid?: (bid: BackendBidItem) => void;
  externalRefreshTrigger?: number;
  onBidsLoaded?: (bids: BackendBidItem[]) => void;
  onNotify?: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export interface LocalWorkTracking {
  work_status?: string;
  workStatus?: string;
  startedAt?: string | null;
  started_at?: string | null;
  estimatedDays?: number;
  estimated_days?: number;
  deadline?: string | null;
  notes?: string;
}

// Local storage key for persistent work status, deadlines & notes
const LOCAL_WORK_STORE_KEY = 'gigpilot_work_tracking_v1';

function getWorkTrackingStore(): Record<string, LocalWorkTracking> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_WORK_STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveWorkTrackingStore(store: Record<string, LocalWorkTracking>) {
  try {
    localStorage.setItem(LOCAL_WORK_STORE_KEY, JSON.stringify(store));
  } catch (err) {
    console.error('[BidsTable] Failed to save work tracking to localStorage:', err);
  }
}

const renderPlatformBadge = (platform?: string) => {
  const p = (platform || 'freelancer').toLowerCase();
  if (p.includes('freelancer')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-sky-500/15 text-sky-300 border-sky-500/30 whitespace-nowrap">
        <i className="fas fa-globe text-[10px]"></i>
        Freelancer
      </span>
    );
  } else if (p.includes('upwork')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-emerald-500/15 text-emerald-300 border-emerald-500/30 whitespace-nowrap">
        <i className="fab fa-upwork text-[10px]"></i>
        Upwork
      </span>
    );
  } else if (p.includes('remoteok') || p.includes('remote')) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-orange-500/15 text-orange-300 border-orange-500/30 whitespace-nowrap">
        <i className="fas fa-bolt text-[10px]"></i>
        RemoteOK
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border bg-slate-700/40 text-slate-300 border-slate-600/40 whitespace-nowrap">
      <i className="fas fa-briefcase text-[10px]"></i>
      {platform || 'Other'}
    </span>
  );
};

const renderStatusBadge = (status?: string) => {
  const s = (status || 'pending').toLowerCase().trim();
  let badgeStyle = 'bg-slate-800/80 text-slate-300 border-slate-700';
  let dotColor = 'bg-slate-400';

  if (s === 'pending' || s === 'queued' || s === 'submitted') {
    badgeStyle = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    dotColor = 'bg-amber-400';
  } else if (s === 'viewed' || s === 'opened') {
    badgeStyle = 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    dotColor = 'bg-blue-400';
  } else if (s === 'interviewing' || s === 'active' || s === 'shortlisted') {
    badgeStyle = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    dotColor = 'bg-emerald-400';
  } else if (s === 'won' || s === 'awarded' || s === 'accepted') {
    badgeStyle = 'bg-emerald-500/25 text-emerald-300 border-emerald-400 shadow-sm shadow-emerald-500/20';
    dotColor = 'bg-emerald-300 animate-pulse';
  } else if (s === 'lost' || s === 'rejected' || s === 'declined') {
    badgeStyle = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    dotColor = 'bg-rose-400';
  } else if (s === 'expired' || s === 'closed') {
    badgeStyle = 'bg-slate-600/20 text-slate-400 border-slate-600/30';
    dotColor = 'bg-slate-400';
  } else if (s === 'archived') {
    badgeStyle = 'bg-slate-800/60 text-slate-500 border-slate-800';
    dotColor = 'bg-slate-600';
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${badgeStyle}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}></span>
      {status || 'pending'}
    </span>
  );
};

const renderCountdown = (deadline?: string | null, now: number = Date.now()) => {
  if (!deadline) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800/60 text-slate-400 border border-slate-700/50">
        <i className="far fa-clock text-[10px] opacity-60"></i>
        <span>Not set</span>
      </span>
    );
  }

  const deadlineMs = new Date(deadline).getTime();
  if (isNaN(deadlineMs)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800/60 text-slate-400 border border-slate-700/50">
        <i className="far fa-clock text-[10px] opacity-60"></i>
        <span>Not set</span>
      </span>
    );
  }

  const diff = deadlineMs - now;
  const oneHour = 1000 * 60 * 60;
  const oneDay = 24 * oneHour;

  if (diff < 0) {
    const overdueDays = Math.max(1, Math.floor(Math.abs(diff) / oneDay));
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm shadow-rose-500/10 whitespace-nowrap">
        <i className="fas fa-triangle-exclamation text-rose-400 text-[10px]"></i>
        <span>⚠️ Overdue by {overdueDays} {overdueDays === 1 ? 'day' : 'days'}</span>
      </span>
    );
  }

  if (diff <= oneDay) {
    const hoursLeft = Math.max(1, Math.floor(diff / oneHour));
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/10 whitespace-nowrap">
        <i className="fas fa-clock text-amber-400 text-[10px]"></i>
        <span>{hoursLeft} {hoursLeft === 1 ? 'hour' : 'hours'} left</span>
      </span>
    );
  }

  const daysLeft = Math.ceil(diff / oneDay);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/10 whitespace-nowrap">
      <i className="fas fa-hourglass-half text-emerald-400 text-[10px]"></i>
      <span>{daysLeft} {daysLeft === 1 ? 'day' : 'days'} left</span>
    </span>
  );
};

const getWorkStatusColor = (status: string) => {
  switch (status) {
    case 'Paid':
      return 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40';
    case 'Delivered':
      return 'text-sky-300 border-sky-500/40 bg-sky-950/40';
    case 'Completed':
      return 'text-indigo-300 border-indigo-500/40 bg-indigo-950/40';
    case 'In Progress':
      return 'text-amber-300 border-amber-500/40 bg-amber-950/40';
    default:
      return 'text-slate-300 border-slate-700 bg-[#0f172a]';
  }
};

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
};

// Memoized Table Row Component for Extreme Rendering Speed
interface BidRowItemProps {
  bid: BackendBidItem;
  index: number;
  nowTime: number;
  savedTrack: LocalWorkTracking;
  onSelectBid?: (bid: BackendBidItem) => void;
  onWorkStatusChange: (bidId: string, status: string) => void;
  onDeadlineChange: (bidId: string, rawDate: string) => void;
  onNoteChange: (bidId: string, noteText: string) => void;
  onNoteBlur: (bidId: string) => void;
  onWithdrawClick: (e: React.MouseEvent, bid: BackendBidItem) => void;
  onGenerateAIPitch: (bid: BackendBidItem) => void;
}

const BidRowItem = React.memo<BidRowItemProps>(({
  bid,
  index,
  nowTime,
  savedTrack,
  onSelectBid,
  onWorkStatusChange,
  onDeadlineChange,
  onNoteChange,
  onNoteBlur,
  onWithdrawClick,
  onGenerateAIPitch,
}) => {
  const bidId = String(bid.id || `bid-${index}`);
  const title = bid.job_title || 'Freelance Proposal';
  const company = bid.company || bid.client_name || 'Verified Client';
  const pkg = formatPackageName(bid.package);
  const amount = Number(bid.bid_amount || 0);
  const isWon = ['won', 'awarded', 'accepted'].includes((bid.status || '').toLowerCase());

  const currentWorkStatus = savedTrack.work_status || (isWon ? 'In Progress' : 'Not Started');
  const currentNotes = savedTrack.notes || '';
  const jobUrl = bid.job_url || (bid.id ? `https://freelancer.com/projects/${bid.id}` : '#');

  let currentDeadline = savedTrack.deadline ?? (bid.deadline || (bid as any).deadline);
  if (!currentDeadline && currentWorkStatus === 'In Progress') {
    const startStr = savedTrack.startedAt || savedTrack.started_at || bid.startedAt || (bid as any).started_at || bid.submitted_at;
    const startMs = startStr ? new Date(startStr).getTime() : Date.now();
    const days = savedTrack.estimatedDays ?? (bid.estimatedDays || (bid as any).estimated_days || 7);
    currentDeadline = new Date(startMs + days * 24 * 60 * 60 * 1000).toISOString();
  }

  return (
    <tr
      onClick={() => onSelectBid && onSelectBid(bid)}
      className="hover:bg-[#161e31]/80 transition-colors group cursor-pointer"
    >
      {/* Job Title */}
      <td className="py-3 px-3.5 font-medium text-white max-w-[220px]">
        <div className="truncate font-semibold group-hover:text-emerald-300 transition-colors" title={title}>
          {title}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {bid.job_url && (
            <a
              href={bid.job_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] text-indigo-400 hover:underline inline-flex items-center gap-1"
            >
              <span>Listing</span>
              <i className="fas fa-external-link-alt text-[8px]"></i>
            </a>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onGenerateAIPitch(bid);
            }}
            className="text-[10px] text-amber-400 hover:text-amber-300 inline-flex items-center gap-1 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 hover:bg-amber-500/20"
            title="Generate AI Proposal with Gemini 3.7 Flash"
          >
            <i className="fas fa-bolt text-[9px]"></i>
            <span>AI Pitch</span>
          </button>
        </div>
      </td>

      {/* Company */}
      <td className="py-3 px-3.5 text-slate-300 max-w-[140px]">
        <span className="inline-flex items-center gap-1.5 truncate">
          <i className="far fa-building text-slate-500 text-[10px]"></i>
          <span className="truncate">{company}</span>
        </span>
      </td>

      {/* Platform Column */}
      <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
        {renderPlatformBadge(bid.platform)}
      </td>

      {/* Package */}
      <td className="py-3 px-3.5 text-indigo-300 font-medium font-mono text-[11.5px] whitespace-nowrap">
        {pkg}
      </td>

      {/* Amount */}
      <td className="py-3 px-3.5 font-mono font-bold text-emerald-400 text-sm whitespace-nowrap">
        ${isNaN(amount) ? '0.00' : amount.toFixed(2)}
      </td>

      {/* Bid Status */}
      <td className="py-3 px-3.5 whitespace-nowrap">
        {renderStatusBadge(bid.status)}
      </td>

      {/* Work Status Dropdown */}
      <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
        <select
          value={currentWorkStatus}
          onChange={(e) => onWorkStatusChange(bidId, e.target.value)}
          className={`text-xs font-semibold px-2 py-1 rounded-lg border outline-none cursor-pointer transition-all ${getWorkStatusColor(
            currentWorkStatus
          )}`}
        >
          <option value="Not Started" className="bg-[#0f172a] text-slate-300">Not Started</option>
          <option value="In Progress" className="bg-[#0f172a] text-amber-300">In Progress</option>
          <option value="Completed" className="bg-[#0f172a] text-indigo-300">Completed</option>
          <option value="Delivered" className="bg-[#0f172a] text-sky-300">Delivered</option>
          <option value="Paid" className="bg-[#0f172a] text-emerald-300">Paid</option>
        </select>
      </td>

      {/* Time Remaining & Manual Deadline Adjuster */}
      <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-start gap-1 min-w-[140px]">
          {renderCountdown(currentDeadline, nowTime)}
          <div className="flex items-center gap-1 mt-0.5 text-[10.5px]">
            <span className="text-[10px] text-slate-500 font-medium">Due:</span>
            <input
              type="date"
              value={currentDeadline ? currentDeadline.split('T')[0] : ''}
              onChange={(e) => onDeadlineChange(bidId, e.target.value)}
              title="Set or adjust deadline manually"
              className="bg-[#0f172a] hover:bg-[#161e31] focus:bg-[#161e31] border border-[#1e293b] focus:border-emerald-500 rounded px-1.5 py-0.5 text-[10px] text-slate-300 font-mono outline-none cursor-pointer"
            />
            {currentDeadline && (
              <button
                type="button"
                onClick={() => onDeadlineChange(bidId, '')}
                className="text-slate-500 hover:text-rose-400 p-0.5 text-[10px] transition-colors"
                title="Clear deadline"
              >
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>
        </div>
      </td>

      {/* Notes Field */}
      <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder="Add notes..."
            value={currentNotes}
            onChange={(e) => onNoteChange(bidId, e.target.value)}
            onBlur={() => onNoteBlur(bidId)}
            className="w-32 hover:w-44 focus:w-48 bg-[#0f172a] border border-[#1e293b] focus:border-emerald-500 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 transition-all outline-none"
          />
        </div>
      </td>

      {/* Action Column */}
      <td className="py-3 px-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <a
            href={jobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg bg-[#161e31] hover:bg-[#1e293b] text-slate-300 hover:text-white border border-[#1e293b] text-[11px] font-semibold transition-all inline-flex items-center gap-1"
            title="Open job listing in new tab"
          >
            <i className="fas fa-arrow-up-right-from-square text-[10px]"></i>
            <span className="hidden sm:inline">Job</span>
          </a>

          {/* Withdraw or Contact Client button for won bids */}
          {isWon && (() => {
            const withdrawTarget = getWithdrawalTarget(bid.platform, jobUrl);
            return (
              <a
                href={withdrawTarget.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => onWithdrawClick(e, bid)}
                className={`py-1 px-2.5 rounded-lg border text-[11px] font-bold transition-all inline-flex items-center gap-1 cursor-pointer shadow-sm no-underline ${withdrawTarget.btnClass}`}
                title={withdrawTarget.tooltip}
              >
                <i className={`${withdrawTarget.icon} text-[10px]`}></i>
                <span>{withdrawTarget.label}</span>
              </a>
            );
          })()}
        </div>
      </td>

      {/* Submitted Date */}
      <td className="py-3 px-3.5 text-slate-400 text-[11.5px] font-mono whitespace-nowrap">
        {formatDateTime(bid.submitted_at)}
      </td>
    </tr>
  );
});

export const BidsTable: React.FC<BidsTableProps> = ({
  onSelectBid,
  externalRefreshTrigger,
  onBidsLoaded,
  onNotify,
}) => {
  const [bids, setBids] = useState<BackendBidItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [nowTime, setNowTime] = useState<number>(Date.now());
  const [workTracking, setWorkTracking] = useState<Record<string, LocalWorkTracking>>(getWorkTrackingStore());

  // Virtualization / Windowing pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Quick AI Proposal Modal State
  const [aiProposalModal, setAiProposalModal] = useState<{
    isOpen: boolean;
    jobTitle: string;
    clientName: string;
    proposalText: string;
    loading: boolean;
    copied: boolean;
  }>({
    isOpen: false,
    jobTitle: '',
    clientName: '',
    proposalText: '',
    loading: false,
    copied: false,
  });

  // Keep stable ref for onBidsLoaded callback to prevent re-fetch loop
  const onBidsLoadedRef = useRef(onBidsLoaded);
  useEffect(() => {
    onBidsLoadedRef.current = onBidsLoaded;
  }, [onBidsLoaded]);

  // Real-time 60-second ticker for accurate countdown tracking
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  const fetchBids = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let response = await fetch(`${BACKEND_BASE_URL}/api/bids?limit=100`);
      if (!response.ok && response.status === 404) {
        response = await fetch(`/api/bids?limit=100`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch bids from ${BACKEND_BASE_URL}`);
      }
      const data = await response.json();
      const rawList: BackendBidItem[] = Array.isArray(data) ? data : (data.bids || []);
      setBids(rawList);
      setLastUpdated(new Date());
      if (onBidsLoadedRef.current) onBidsLoadedRef.current(rawList);
    } catch (err: any) {
      console.warn('[BidsTable] Backend fetch failed, trying local fallback:', err);
      try {
        const localRes = await fetch(`/api/freelancer/bids?limit=100`);
        if (localRes.ok) {
          const localData = await localRes.json();
          const list: BackendBidItem[] = Array.isArray(localData) ? localData : (localData.bids || []);
          if (list.length > 0) {
            setBids(list);
            setLastUpdated(new Date());
            if (onBidsLoadedRef.current) onBidsLoadedRef.current(list);
            setLoading(false);
            return;
          }
        }
      } catch {}
      setError(err?.message || 'Failed to load bids. Backend may be starting up.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and external refresh
  useEffect(() => {
    fetchBids();
  }, [fetchBids, externalRefreshTrigger]);

  // Handle work status change
  const handleWorkStatusChange = useCallback((bidId: string, newStatus: string) => {
    setWorkTracking((prev) => {
      const currentTrack = prev[bidId] || {};
      let startedAt = currentTrack.startedAt || currentTrack.started_at;
      let deadline = currentTrack.deadline;
      const estimatedDays = currentTrack.estimatedDays ?? currentTrack.estimated_days ?? 7;

      if (newStatus === 'In Progress') {
        if (!startedAt) {
          startedAt = new Date().toISOString();
        }
        if (!deadline) {
          const startMs = new Date(startedAt).getTime();
          deadline = new Date(startMs + estimatedDays * 24 * 60 * 60 * 1000).toISOString();
        }
      }

      const updated: Record<string, LocalWorkTracking> = {
        ...prev,
        [bidId]: {
          ...currentTrack,
          work_status: newStatus,
          workStatus: newStatus,
          startedAt,
          started_at: startedAt,
          estimatedDays,
          deadline,
        },
      };

      saveWorkTrackingStore(updated);
      return updated;
    });

    if (onNotify) {
      onNotify(`Work status updated to "${newStatus}"`, 'success');
    }

    updateBidStatus(bidId, {
      workStatus: newStatus,
    }).catch((err) => {
      console.warn('[BidsTable] Backend sync notice:', err);
    });
  }, [onNotify]);

  // Handle manual deadline adjustment
  const handleDeadlineChange = useCallback((bidId: string, rawDateString: string) => {
    const newDeadline = rawDateString ? new Date(rawDateString + 'T23:59:59').toISOString() : null;

    setWorkTracking((prev) => {
      const currentTrack = prev[bidId] || {};
      const updated: Record<string, LocalWorkTracking> = {
        ...prev,
        [bidId]: {
          ...currentTrack,
          deadline: newDeadline,
        },
      };
      saveWorkTrackingStore(updated);
      return updated;
    });

    if (onNotify) {
      onNotify(rawDateString ? `Deadline set to ${rawDateString}` : `Deadline cleared`, 'success');
    }

    updateBidStatus(bidId, {
      deadline: newDeadline,
    }).catch((err) => {
      console.warn('[BidsTable] Backend sync notice for deadline:', err);
    });
  }, [onNotify]);

  // Handle notes change
  const handleNoteChange = useCallback((bidId: string, noteText: string) => {
    setWorkTracking((prev) => {
      const updated = {
        ...prev,
        [bidId]: {
          ...(prev[bidId] || {}),
          notes: noteText,
        },
      };
      saveWorkTrackingStore(updated);
      return updated;
    });
  }, []);

  const handleNoteBlur = useCallback((bidId: string) => {
    const note = workTracking[bidId]?.notes?.trim();
    if (note && onNotify) {
      onNotify(`Saved notes for bid #${bidId}`, 'success');
    }
    if (workTracking[bidId]) {
      updateBidStatus(bidId, {
        notes: workTracking[bidId]?.notes,
      }).catch(() => {});
    }
  }, [workTracking, onNotify]);

  const handleWithdrawClick = useCallback((e: React.MouseEvent, bid: BackendBidItem) => {
    e.stopPropagation();
    const target = getWithdrawalTarget(bid.platform);
    const amount = Number(bid.bid_amount || 0);
    const extractedBidId = String(bid.id || (bid as any).job_id || 'bid_won');

    if (onNotify) {
      if (target.isDirectWithdrawal) {
        onNotify(`Initiating ${target.platformName} withdrawal for Bid #${extractedBidId} ($${amount.toFixed(2)} USD)... Opening portal.`, 'info');
      } else {
        onNotify(`Opening ${target.platformName} job. Contact the client directly to discuss payment.`, 'info');
      }
    }

    if (bid.id) {
      setWorkTracking((prev) => {
        const updated = {
          ...prev,
          [bid.id]: {
            ...(prev[bid.id] || {}),
            work_status: 'Paid',
            workStatus: 'Paid',
          },
        };
        saveWorkTrackingStore(updated);
        return updated;
      });
    }

    withdrawOnFreelancer(extractedBidId, amount, bid.platform || 'freelancer')
      .then((result) => {
        if (result.success && onNotify) {
          onNotify(result.message || `Withdrawal registered for Bid #${extractedBidId} ($${amount.toFixed(2)} USD).`, 'success');
        }
      })
      .catch((err: any) => {
        if (onNotify) {
          onNotify(`Withdrawal notice: ${err?.message || 'Check connection'}`, 'warning');
        }
      });
  }, [onNotify]);

  // Instant AI Pitch Generator handler with Gemini 3.7 Flash
  const handleGenerateAIPitch = useCallback(async (bid: BackendBidItem) => {
    setAiProposalModal({
      isOpen: true,
      jobTitle: bid.job_title || 'Freelance Project',
      clientName: bid.client_name || bid.company || 'Client',
      proposalText: '',
      loading: true,
      copied: false,
    });

    try {
      const res = await generateAIProposalBackend({
        jobTitle: bid.job_title || 'Full-Stack Software Engineering',
        jobDescription: bid.cover_letter || bid.notes || 'Full-stack engineering scope, APIs, and scalable web solutions.',
        clientName: bid.client_name || bid.company || 'Client',
        budget: Number(bid.bid_amount || 499),
        skills: ['React', 'TypeScript', 'Node.js', 'PostgreSQL', 'APIs'],
        platform: bid.platform || 'Freelancer',
      });

      setAiProposalModal((prev) => ({
        ...prev,
        proposalText: res.proposal || 'Proposal generated successfully.',
        loading: false,
      }));
    } catch (err: any) {
      setAiProposalModal((prev) => ({
        ...prev,
        proposalText: `Hello ${bid.client_name || 'there'},\n\nI reviewed your project "${bid.job_title || 'requirements'}" and would love to assist. With senior full-stack and automation expertise, I can deliver a clean, well-tested solution within deadline.\n\nKey deliverables:\n• Architecture & Setup\n• End-to-End Implementation\n• Milestone Verification\n\nLooking forward to collaborating!`,
        loading: false,
      }));
    }
  }, []);

  // Filtered & Search memoization
  const filteredBids = useMemo(() => {
    return bids.filter((bid) => {
      const matchesStatus = filterStatus === 'all' || (bid.status || 'pending').toLowerCase() === filterStatus.toLowerCase();
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch = !query ||
        (bid.job_title && bid.job_title.toLowerCase().includes(query)) ||
        (bid.company && bid.company.toLowerCase().includes(query)) ||
        (bid.client_name && bid.client_name.toLowerCase().includes(query)) ||
        (bid.package && bid.package.toLowerCase().includes(query)) ||
        (bid.platform && bid.platform.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [bids, filterStatus, searchQuery]);

  // Windowed / Paginated Slice
  const totalPages = Math.ceil(filteredBids.length / pageSize) || 1;
  const paginatedBids = useMemo(() => {
    if (pageSize >= 1000) return filteredBids;
    const startIndex = (currentPage - 1) * pageSize;
    return filteredBids.slice(startIndex, startIndex + pageSize);
  }, [filteredBids, currentPage, pageSize]);

  return (
    <div id="bids-table-section" className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1e293b]/80 mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-sm font-bold border border-emerald-500/25">
              <i className="fas fa-list-check"></i>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Recent Auto-Dispatched Bids &amp; Work Orders
            </h3>
            <span className="bg-[#161e31] text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-mono font-bold border border-[#1e293b]">
              {bids.length} Total
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Live auto-proposals submitted to Freelancer.com, Upwork, and remote client networks with instant work status tracking.
          </p>
        </div>

        {/* Actions & Refresh */}
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[11px] text-slate-500 font-mono hidden md:inline">
              Updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            id="refresh-bids-btn"
            onClick={fetchBids}
            disabled={loading}
            className="bg-[#161e31] hover:bg-[#1e293b] text-slate-200 hover:text-white px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#1e293b] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh bids from backend"
          >
            <i className={`fas fa-sync-alt text-[11px] ${loading ? 'fa-spin text-emerald-400' : ''}`}></i>
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Filter / Search Bar & Virtualization Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {['all', 'pending', 'viewed', 'interviewing', 'won', 'lost'].map((statusKey) => (
            <button
              key={statusKey}
              onClick={() => {
                setFilterStatus(statusKey);
                setCurrentPage(1);
              }}
              className={`text-xs px-3 py-1.5 rounded-lg font-bold capitalize transition-all whitespace-nowrap cursor-pointer ${
                filterStatus === statusKey
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'bg-[#161e31] text-slate-400 hover:text-slate-200 hover:bg-[#1e293b] border border-[#1e293b]'
              }`}
            >
              {statusKey}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Page size dropdown */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Show:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-[#161e31] text-slate-200 text-xs rounded-lg px-2 py-1 border border-[#1e293b] outline-none cursor-pointer"
            >
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={500}>All</option>
            </select>
          </div>

          <div className="relative min-w-[200px]">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
            <input
              type="text"
              placeholder="Search bids..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-[#161e31] text-slate-200 placeholder-slate-500 text-xs rounded-xl pl-8 pr-3 py-1.5 border border-[#1e293b] focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <i className="fas fa-exclamation-circle text-rose-400"></i>
            <span>{error}</span>
          </div>
          <button
            onClick={fetchBids}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-3 py-1 rounded-lg text-[11px] cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Bids Table */}
      <div className="overflow-x-auto rounded-xl border border-[#1e293b]/70">
        <table id="bids-table" className="w-full text-left text-xs text-slate-300">
          <thead className="bg-[#0a0e1a]/80 text-[11px] uppercase tracking-wider text-slate-400 border-b border-[#1e293b]">
            <tr>
              <th className="py-3 px-3.5 font-bold">Job Title</th>
              <th className="py-3 px-3.5 font-bold">Company</th>
              <th className="py-3 px-3.5 font-bold">Platform</th>
              <th className="py-3 px-3.5 font-bold">Package</th>
              <th className="py-3 px-3.5 font-bold">Amount</th>
              <th className="py-3 px-3.5 font-bold">Bid Status</th>
              <th className="py-3 px-3.5 font-bold">Work Status</th>
              <th className="py-3 px-3.5 font-bold text-center">Time Remaining</th>
              <th className="py-3 px-3.5 font-bold">Notes</th>
              <th className="py-3 px-3.5 font-bold">Action</th>
              <th className="py-3 px-3.5 font-bold">Submitted Date</th>
            </tr>
          </thead>
          <tbody id="bids-table-body" className="divide-y divide-[#1e293b]/60">
            {loading && bids.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-10 text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <i className="fas fa-circle-notch fa-spin text-emerald-400 text-xl"></i>
                    <span className="text-xs">Fetching latest bids from {BACKEND_BASE_URL}...</span>
                  </div>
                </td>
              </tr>
            ) : filteredBids.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-10 text-slate-500 text-xs">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <i className="fas fa-robot text-slate-600 text-2xl mb-1"></i>
                    <p className="font-semibold text-slate-400">No bids match current filter.</p>
                    <p className="text-[11px] text-slate-500">The auto-bidding daemon is scanning live marketplace feeds.</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedBids.map((bid, index) => {
                const bidId = String(bid.id || `bid-${index}`);
                return (
                  <BidRowItem
                    key={bidId}
                    bid={bid}
                    index={index}
                    nowTime={nowTime}
                    savedTrack={workTracking[bidId] || {}}
                    onSelectBid={onSelectBid}
                    onWorkStatusChange={handleWorkStatusChange}
                    onDeadlineChange={handleDeadlineChange}
                    onNoteChange={handleNoteChange}
                    onNoteBlur={handleNoteBlur}
                    onWithdrawClick={handleWithdrawClick}
                    onGenerateAIPitch={handleGenerateAIPitch}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {filteredBids.length > pageSize && (
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-[#1e293b]/60 text-xs text-slate-400">
          <div>
            Showing <span className="font-semibold text-white">{(currentPage - 1) * pageSize + 1}</span> to{' '}
            <span className="font-semibold text-white">{Math.min(currentPage * pageSize, filteredBids.length)}</span> of{' '}
            <span className="font-semibold text-white">{filteredBids.length}</span> bids
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2.5 py-1 rounded bg-[#161e31] hover:bg-[#1e293b] disabled:opacity-40 text-slate-300 font-semibold border border-[#1e293b] cursor-pointer"
            >
              <i className="fas fa-chevron-left text-[10px]"></i>
            </button>
            <span className="px-2 font-mono text-slate-300">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1 rounded bg-[#161e31] hover:bg-[#1e293b] disabled:opacity-40 text-slate-300 font-semibold border border-[#1e293b] cursor-pointer"
            >
              <i className="fas fa-chevron-right text-[10px]"></i>
            </button>
          </div>
        </div>
      )}

      {/* Quick AI Pitch Generator Popover/Modal */}
      {aiProposalModal.isOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#131826] border border-[#2a3449] rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#2a3449]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs">
                  <i className="fas fa-bolt"></i>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">AI Pitch Studio (Gemini 3.7 Flash)</h4>
                  <p className="text-[11px] text-slate-400 truncate max-w-sm">{aiProposalModal.jobTitle}</p>
                </div>
              </div>
              <button
                onClick={() => setAiProposalModal((prev) => ({ ...prev, isOpen: false }))}
                className="text-slate-400 hover:text-white p-1"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            {aiProposalModal.loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3">
                <i className="fas fa-circle-notch fa-spin text-amber-400 text-2xl"></i>
                <span className="text-xs text-slate-300">Generating hyper-converting proposal with Gemini 3.7 Flash...</span>
              </div>
            ) : (
              <>
                <textarea
                  value={aiProposalModal.proposalText}
                  onChange={(e) => setAiProposalModal((prev) => ({ ...prev, proposalText: e.target.value }))}
                  rows={9}
                  className="w-full bg-[#0a0e1a] border border-[#2a3449] focus:border-amber-500 rounded-xl p-3.5 text-xs text-slate-200 font-sans leading-relaxed outline-none resize-none"
                />

                <div className="flex items-center justify-between pt-2">
                  <span className="text-[11px] text-slate-400">
                    <i className="fas fa-sparkles text-amber-400 mr-1"></i>
                    Tailored for {aiProposalModal.clientName}
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(aiProposalModal.proposalText);
                        setAiProposalModal((prev) => ({ ...prev, copied: true }));
                        if (onNotify) onNotify('📋 Proposal copied to clipboard!', 'success');
                        setTimeout(() => setAiProposalModal((prev) => ({ ...prev, copied: false })), 2000);
                      }}
                      className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-amber-600/20"
                    >
                      <i className={`fas ${aiProposalModal.copied ? 'fa-check' : 'fa-copy'}`}></i>
                      <span>{aiProposalModal.copied ? 'Copied!' : 'Copy Proposal'}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};


