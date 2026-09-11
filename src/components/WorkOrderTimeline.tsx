import React from 'react';
import { Clock, PlayCircle, ShieldCheck, CheckCircle2, Check } from 'lucide-react';

export interface WorkOrderTimelineProps {
  status?: string;
  paymentStatus?: string;
  customerConfirmed?: boolean;
  workerMarkedComplete?: boolean;
  completedAt?: string | null;
  compact?: boolean;
  className?: string;
}

export interface StageConfig {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const LIFECYCLE_STAGES: StageConfig[] = [
  {
    id: 'pending',
    label: 'Pending',
    shortLabel: 'Pending',
    description: 'Contract queued & awaiting start',
    icon: Clock,
  },
  {
    id: 'in-progress',
    label: 'In-Progress',
    shortLabel: 'In-Progress',
    description: 'Autonomous execution underway',
    icon: PlayCircle,
  },
  {
    id: 'escrow-released',
    label: 'Escrow Released',
    shortLabel: 'Escrow',
    description: 'Milestone approved & funds released',
    icon: ShieldCheck,
  },
  {
    id: 'completed',
    label: 'Completed',
    shortLabel: 'Done',
    description: 'Final deliverable confirmed',
    icon: CheckCircle2,
  },
];

export function getWorkOrderStageIndex(params: {
  status?: string;
  paymentStatus?: string;
  customerConfirmed?: boolean;
  workerMarkedComplete?: boolean;
  completedAt?: string | null;
}): number {
  const status = (params.status || '').toLowerCase().trim();
  const paymentStatus = (params.paymentStatus || '').toLowerCase().trim();

  // 1. Stage 3: Completed
  if (status === 'completed' || status === 'done' || params.completedAt) {
    return 3;
  }

  // 2. Stage 2: Escrow Released
  if (
    paymentStatus === 'released' ||
    paymentStatus === 'paid' ||
    paymentStatus === 'completed' ||
    params.customerConfirmed ||
    params.workerMarkedComplete
  ) {
    return 2;
  }

  // 3. Stage 1: In-Progress
  if (
    status === 'in-progress' ||
    status === 'inprogress' ||
    status === 'in_progress' ||
    status === 'assigned' ||
    status === 'urgent'
  ) {
    return 1;
  }

  // 4. Stage 0: Pending
  return 0;
}

export const WorkOrderTimeline: React.FC<WorkOrderTimelineProps> = ({
  status,
  paymentStatus,
  customerConfirmed,
  workerMarkedComplete,
  completedAt,
  compact = false,
  className = '',
}) => {
  const currentStageIndex = getWorkOrderStageIndex({
    status,
    paymentStatus,
    customerConfirmed,
    workerMarkedComplete,
    completedAt,
  });

  const isCompleted = currentStageIndex === 3;

  return (
    <div
      id="work-order-lifecycle-timeline"
      className={`w-full py-2 px-2.5 bg-[#0b0d15]/80 rounded-xl border border-[#2a3147]/70 ${className}`}
    >
      {/* Header Info Banner if not ultra-compact */}
      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#2a3147]/40 text-[10px]">
        <span className="font-mono text-slate-400 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
          Lifecycle Stage
        </span>
        <span
          className={`font-semibold font-mono px-2 py-0.5 rounded-full text-[10px] ${
            isCompleted
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : currentStageIndex === 2
              ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
              : currentStageIndex === 1
              ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
          }`}
        >
          {LIFECYCLE_STAGES[currentStageIndex]?.label} (Stage {currentStageIndex + 1}/4)
        </span>
      </div>

      {/* Visual Step Timeline */}
      <div className="relative flex items-center justify-between mt-1">
        {/* Continuous background progress track */}
        <div className="absolute left-3 right-3 top-3 -translate-y-1/2 h-1 bg-[#1a2133] rounded-full z-0">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${(currentStageIndex / (LIFECYCLE_STAGES.length - 1)) * 100}%`,
            }}
          />
        </div>

        {/* Timeline Steps */}
        {LIFECYCLE_STAGES.map((stage, idx) => {
          const isPassed = idx < currentStageIndex;
          const isCurrent = idx === currentStageIndex;
          const isFuture = idx > currentStageIndex;
          const IconComponent = stage.icon;

          // Step colors & state styling
          let nodeBg = 'bg-[#151a28] text-slate-500 border-slate-700';
          let textColor = 'text-slate-500';
          let ringEffect = '';

          if (isPassed) {
            nodeBg = 'bg-emerald-600 text-white border-emerald-400 shadow-sm shadow-emerald-900/50';
            textColor = 'text-emerald-400 font-medium';
          } else if (isCurrent) {
            if (isCompleted) {
              nodeBg = 'bg-emerald-500 text-white border-emerald-300 shadow-md shadow-emerald-500/30';
              textColor = 'text-emerald-300 font-bold';
              ringEffect = 'ring-2 ring-emerald-500/40';
            } else if (idx === 2) {
              nodeBg = 'bg-purple-600 text-white border-purple-400 shadow-md shadow-purple-500/30';
              textColor = 'text-purple-300 font-bold';
              ringEffect = 'ring-2 ring-purple-500/40 animate-pulse';
            } else if (idx === 1) {
              nodeBg = 'bg-blue-600 text-white border-blue-400 shadow-md shadow-blue-500/30';
              textColor = 'text-blue-300 font-bold';
              ringEffect = 'ring-2 ring-blue-500/40 animate-pulse';
            } else {
              nodeBg = 'bg-amber-600 text-white border-amber-400 shadow-md shadow-amber-500/30';
              textColor = 'text-amber-300 font-bold';
              ringEffect = 'ring-2 ring-amber-500/40';
            }
          }

          return (
            <div
              key={stage.id}
              className="relative z-10 flex flex-col items-center group cursor-default"
              style={{ width: `${100 / LIFECYCLE_STAGES.length}%` }}
              title={`${stage.label}: ${stage.description}`}
            >
              {/* Step Circle Node */}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-300 ${nodeBg} ${ringEffect}`}
              >
                {isPassed ? (
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                ) : (
                  <IconComponent className="w-3 h-3" />
                )}
              </div>

              {/* Step Label */}
              <div className="text-center mt-1 w-full px-0.5">
                <p
                  className={`text-[10px] tracking-tight leading-none whitespace-nowrap transition-colors ${textColor}`}
                >
                  {compact ? stage.shortLabel : stage.label}
                </p>
                {!compact && (
                  <p className="text-[8px] text-slate-500 line-clamp-1 mt-0.5 hidden sm:block">
                    {isPassed ? '✓ Complete' : isCurrent ? 'Active Now' : 'Upcoming'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WorkOrderTimeline;
