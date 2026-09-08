import React, { useState, useEffect } from 'react';

interface LazyFallbackProps {
  label?: string;
  className?: string;
  variant?: 'card' | 'panel' | 'table';
}

const SYSTEM_STATUS_UPDATES = [
  'Initializing...',
  'Syncing real-time telemetry stream...',
  'Hydrating cached work pipelines...',
  'Verifying cryptographic integrity...',
  'Compiling autonomous view components...',
  'Establishing live socket synchronization...',
];

export const LazyFallback: React.FC<LazyFallbackProps> = ({
  label = 'Initializing...',
  className = '',
  variant = 'card',
}) => {
  const [statusIndex, setStatusIndex] = useState(0);
  const [progress, setProgress] = useState(24);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % SYSTEM_STATUS_UPDATES.length);
      setProgress((prev) => {
        if (prev >= 92) return 24;
        return Math.min(95, prev + 18);
      });
    }, 1400);

    return () => clearInterval(interval);
  }, []);

  const currentStatus = SYSTEM_STATUS_UPDATES[statusIndex];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label} - ${currentStatus}`}
      className={`w-full rounded-2xl bg-[#0d121f]/95 border border-[#1e293b]/80 p-5 sm:p-6 shadow-xl relative overflow-hidden transition-all duration-300 group hover:border-[#334155] ${className}`}
    >
      {/* Background Ambient Glow */}
      <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-indigo-500/5 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

      {/* Header Skeleton Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1e293b]/70">
        <div className="flex items-center gap-3">
          {/* Shimmering Icon Placeholder */}
          <div className="w-9 h-9 rounded-xl animate-shimmer border border-slate-700/50 flex items-center justify-center shrink-0">
            <i className="fas fa-microchip text-slate-500/70 text-sm animate-pulse"></i>
          </div>

          <div className="space-y-1.5 min-w-0">
            {/* Shimmering Title */}
            <div className="flex items-center gap-2">
              <div className="h-4 w-36 sm:w-48 rounded-md animate-shimmer border border-slate-700/40" />
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-mono text-indigo-300 font-semibold tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                ACTIVE
              </span>
            </div>
            {/* Shimmering Subtitle */}
            <div className="h-2.5 w-24 sm:w-32 rounded animate-shimmer" />
          </div>
        </div>

        {/* Dynamic Status & Progress Pill */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#141a29] border border-slate-800 text-[11px] font-mono text-slate-300">
            <i className="fas fa-sync-alt fa-spin text-[10px] text-cyan-400"></i>
            <span className="text-slate-400 truncate max-w-[170px] sm:max-w-[210px] font-medium">
              {label !== 'Initializing...' && label ? label : 'System Boot'}
            </span>
            <span className="text-cyan-400 font-bold ml-1">{progress}%</span>
          </div>
        </div>
      </div>

      {/* Shimmering KPI / Metric Columns */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl bg-[#111726]/70 border border-slate-800/80 p-3.5 space-y-2 relative overflow-hidden"
          >
            <div className="flex items-center justify-between">
              <div className="h-2.5 w-16 rounded animate-shimmer" />
              <div className="w-3.5 h-3.5 rounded-full animate-shimmer" />
            </div>
            <div className="h-5 w-24 rounded animate-shimmer-fast" />
            <div className="h-2 w-28 rounded animate-shimmer opacity-70" />
          </div>
        ))}
      </div>

      {/* Shimmering Data Rows Skeleton */}
      <div className="space-y-2.5 pt-1">
        <div className="h-3 w-11/12 rounded animate-shimmer" />
        <div className="h-3 w-4/5 rounded animate-shimmer opacity-90" />
        <div className="h-3 w-3/4 rounded animate-shimmer opacity-75" />
      </div>

      {/* Bottom Interactive Status Bar with Cycling Label */}
      <div className="mt-5 pt-3 border-t border-[#1e293b]/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping absolute opacity-75" />
            <span className="w-2 h-2 rounded-full bg-emerald-400 relative" />
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xs text-slate-300">
            <span className="text-emerald-400 font-bold">STATUS:</span>
            {/* Cycling status update label */}
            <span
              key={currentStatus}
              className="text-slate-200 transition-opacity duration-300 font-medium"
            >
              {currentStatus}
            </span>
          </div>
        </div>

        {/* Live Micro Progress Indicator */}
        <div className="flex items-center gap-2 w-full sm:w-44 shrink-0">
          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden relative">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-400 shrink-0">
            LOAD
          </span>
        </div>
      </div>
    </div>
  );
};

export default LazyFallback;
