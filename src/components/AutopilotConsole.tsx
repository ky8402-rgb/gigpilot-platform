import React, { useState } from 'react';
import { 
  Bot, 
  Play, 
  Pause, 
  CheckCircle2, 
  Terminal, 
  Sliders, 
  ShieldAlert, 
  Zap, 
  Flame, 
  Layers, 
  Trash2, 
  Plus, 
  Radio, 
  Clock,
  Sparkles,
  RefreshCw,
  Cpu
} from 'lucide-react';
import { AutopilotRules, AutopilotLog } from '../types';

interface AutopilotConsoleProps {
  rules: AutopilotRules;
  onUpdateRules: (newRules: Partial<AutopilotRules>) => void;
  logs: AutopilotLog[];
  onClearLogs: () => void;
  onRunBotCycle: () => void;
  isBotRunning: boolean;
}

export const AutopilotConsole: React.FC<AutopilotConsoleProps> = ({
  rules,
  onUpdateRules,
  logs,
  onClearLogs,
  onRunBotCycle,
  isBotRunning
}) => {
  const [newBlacklistWord, setNewBlacklistWord] = useState('');

  const handleAddBlacklist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlacklistWord.trim()) return;
    if (!rules.blacklistKeywords.includes(newBlacklistWord.trim().toLowerCase())) {
      onUpdateRules({
        blacklistKeywords: [...rules.blacklistKeywords, newBlacklistWord.trim().toLowerCase()]
      });
    }
    setNewBlacklistWord('');
  };

  const handleRemoveBlacklist = (word: string) => {
    onUpdateRules({
      blacklistKeywords: rules.blacklistKeywords.filter(w => w !== word)
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      
      {/* Left Column: Mode Selector & Rules Config (5 cols) */}
      <div className="space-y-4 lg:col-span-5">
        
        {/* Mode Selector Box */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center">
              <Bot className="mr-2 h-4 w-4 text-emerald-400" />
              Autopilot Operating Mode
            </h3>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
              rules.mode === 'autonomous' 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : rules.mode === 'review_queue'
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'bg-slate-800 text-slate-400'
            }`}>
              {rules.mode === 'autonomous' ? 'Active Auto-Pilot' : rules.mode === 'review_queue' ? 'Queue Mode' : 'Paused'}
            </span>
          </div>

          <p className="mt-2 text-xs text-slate-400">
            Define how aggressively the AI agent scans listings, writes proposals, and submits bids on Upwork & Freelancer.
          </p>

          <div className="mt-4 space-y-2">
            
            {/* Option 1: Autonomous */}
            <button
              id="btn-mode-autonomous"
              onClick={() => onUpdateRules({ mode: 'autonomous' })}
              className={`w-full text-left rounded-xl border p-3.5 transition-all ${
                rules.mode === 'autonomous'
                  ? 'border-emerald-500/50 bg-emerald-950/30 text-white shadow-lg shadow-emerald-950/40'
                  : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 font-bold text-sm text-emerald-400">
                  <Flame className="h-4 w-4 text-emerald-400" />
                  <span>100% Autonomous Bidding</span>
                </div>
                {rules.mode === 'autonomous' && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                )}
              </div>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                Scans jobs 24/7, uses Gemini to draft tailored cover letters, and automatically submits bids if match score exceeds {rules.minMatchScore}%.
              </p>
            </button>

            {/* Option 2: Assisted Queue */}
            <button
              id="btn-mode-review"
              onClick={() => onUpdateRules({ mode: 'review_queue' })}
              className={`w-full text-left rounded-xl border p-3.5 transition-all ${
                rules.mode === 'review_queue'
                  ? 'border-amber-500/50 bg-amber-950/30 text-white shadow-lg shadow-amber-950/40'
                  : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 font-bold text-sm text-amber-400">
                  <Layers className="h-4 w-4 text-amber-400" />
                  <span>Assisted Review Queue</span>
                </div>
                {rules.mode === 'review_queue' && (
                  <CheckCircle2 className="h-4 w-4 text-amber-400" />
                )}
              </div>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                Pre-generates custom proposals and places them in a 1-click review queue before burning connects.
              </p>
            </button>

            {/* Option 3: Standby */}
            <button
              id="btn-mode-standby"
              onClick={() => onUpdateRules({ mode: 'standby' })}
              className={`w-full text-left rounded-xl border p-3.5 transition-all ${
                rules.mode === 'standby'
                  ? 'border-slate-600 bg-slate-800/80 text-white'
                  : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between font-bold text-sm text-slate-300">
                <span>Standby / Monitoring Only</span>
                {rules.mode === 'standby' && (
                  <CheckCircle2 className="h-4 w-4 text-slate-300" />
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Continues monitoring radar and notifications without drafting or bidding.
              </p>
            </button>

          </div>

          {/* Trigger Cycle Button */}
          <div className="mt-5 border-t border-slate-800 pt-4">
            <button
              onClick={onRunBotCycle}
              disabled={isBotRunning}
              className="w-full flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5 text-xs font-bold text-slate-950 shadow-md shadow-emerald-950/50 hover:from-emerald-400 hover:to-teal-400 active:scale-95 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isBotRunning ? 'animate-spin' : ''}`} />
              <span>{isBotRunning ? 'Executing Autonomous Pipeline...' : 'Run Autonomous Scan & Bid Loop Now'}</span>
            </button>
          </div>

        </div>

        {/* Autonomous Guardrails & Rules */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center">
            <Sliders className="mr-2 h-4 w-4 text-cyan-400" />
            Safety Guardrails & Thresholds
          </h3>

          <div className="mt-4 space-y-4 text-xs">
            
            {/* Min Match Score */}
            <div>
              <div className="flex justify-between font-semibold text-slate-300">
                <span>Min Match Threshold:</span>
                <span className="font-mono text-emerald-400 font-bold">{rules.minMatchScore}%</span>
              </div>
              <input
                type="range"
                min="60"
                max="95"
                step="1"
                value={rules.minMatchScore}
                onChange={(e) => onUpdateRules({ minMatchScore: Number(e.target.value) })}
                className="mt-1.5 w-full cursor-pointer accent-emerald-500"
              />
              <span className="text-[11px] text-slate-500">Auto-bid triggers only for jobs scoring above this threshold.</span>
            </div>

            {/* Min Budget Filters */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-300">Min Fixed Budget ($):</label>
                <input
                  type="number"
                  value={rules.minFixedBudget}
                  onChange={(e) => onUpdateRules({ minFixedBudget: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 p-2 font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300">Min Hourly Rate ($/hr):</label>
                <input
                  type="number"
                  value={rules.minHourlyRate}
                  onChange={(e) => onUpdateRules({ minHourlyRate: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 p-2 font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Daily Bid Cap */}
            <div>
              <div className="flex justify-between font-semibold text-slate-300">
                <span>Max Daily Proposals (Connects Cap):</span>
                <span className="font-mono text-cyan-400 font-bold">{rules.maxDailyBids} bids/day</span>
              </div>
              <input
                type="range"
                min="5"
                max="40"
                step="1"
                value={rules.maxDailyBids}
                onChange={(e) => onUpdateRules({ maxDailyBids: Number(e.target.value) })}
                className="mt-1.5 w-full cursor-pointer accent-cyan-500"
              />
            </div>

            {/* Verified Payment required */}
            <div className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
              <div>
                <div className="font-semibold text-slate-200">Require Verified Payment</div>
                <div className="text-[11px] text-slate-500">Ignore unverified clients to prevent scams</div>
              </div>
              <input
                type="checkbox"
                checked={rules.requireVerifiedPayment}
                onChange={(e) => onUpdateRules({ requireVerifiedPayment: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
              />
            </div>

            {/* Blacklist Keywords */}
            <div>
              <label className="font-semibold text-slate-300">Negative Keywords Filter:</label>
              <form onSubmit={handleAddBlacklist} className="mt-1.5 flex space-x-2">
                <input
                  type="text"
                  value={newBlacklistWord}
                  onChange={(e) => setNewBlacklistWord(e.target.value)}
                  placeholder="e.g. revshare, telegram, unpaid"
                  className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </form>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {rules.blacklistKeywords.map((word) => (
                  <span
                    key={word}
                    className="inline-flex items-center rounded-md bg-rose-950/40 border border-rose-500/30 px-2 py-0.5 text-[11px] font-medium text-rose-300"
                  >
                    {word}
                    <button
                      onClick={() => handleRemoveBlacklist(word)}
                      className="ml-1 text-rose-400 hover:text-rose-200"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

          </div>
        </div>

      </div>

      {/* Right Column: Live Autonomous Execution Terminal (7 cols) */}
      <div className="space-y-4 lg:col-span-7">
        <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-950/90 shadow-2xl backdrop-blur-md">
          
          {/* Terminal Header */}
          <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/80 px-4 py-3">
            <div className="flex items-center space-x-2">
              <div className="flex space-x-1.5">
                <div className="h-3 w-3 rounded-full bg-rose-500/80" />
                <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
              </div>
              <span className="font-mono text-xs font-bold tracking-tight text-slate-300 ml-2">
                autopilot-daemon.log
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <span className="flex items-center font-mono text-[11px] text-emerald-400">
                <span className="mr-1.5 h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                STREAMING
              </span>
              <button
                onClick={onClearLogs}
                className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                title="Clear Logs"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Terminal Console Output */}
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-2.5 max-h-[560px]">
            {logs.length === 0 ? (
              <div className="py-12 text-center text-slate-600">
                No active execution logs. Click "Run Autonomous Scan & Bid Loop Now" to trigger a cycle.
              </div>
            ) : (
              logs.map((log) => {
                let badgeColor = 'bg-slate-800 text-slate-300';
                if (log.action === 'AUTO_BID') badgeColor = 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30';
                if (log.action === 'MATCH') badgeColor = 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/30';
                if (log.action === 'AI_PROPOSAL') badgeColor = 'bg-purple-950/80 text-purple-300 border border-purple-500/30';
                if (log.action === 'EARNING_PAYOUT') badgeColor = 'bg-emerald-900 text-emerald-200 border border-emerald-400 font-bold';

                return (
                  <div
                    key={log.id}
                    className="flex flex-col rounded-lg bg-slate-900/40 p-2.5 border border-slate-800/50 hover:bg-slate-900/80 transition-colors"
                  >
                    <div className="flex items-center space-x-2 text-[11px]">
                      <span className="text-slate-500">{log.timestamp}</span>
                      
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeColor}`}>
                        {log.action}
                      </span>

                      {log.platform && (
                        <span className="text-slate-400 font-semibold">[{log.platform}]</span>
                      )}

                      {log.jobId && (
                        <span className="text-slate-500 text-[10px]">{log.jobId}</span>
                      )}
                    </div>

                    <div className="mt-1 text-slate-300">
                      {log.message}
                    </div>

                    {log.amount && (
                      <div className="mt-1 text-emerald-400 font-bold text-[11px]">
                        Transaction Impact: +${log.amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Terminal Footer Status Bar */}
          <div className="border-t border-slate-800/80 bg-slate-900/60 px-4 py-2 text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span>Daemon: Upwork/Freelancer Webhook Listener v2.8</span>
            <span>Latency: 42ms • Gemini 3.7 Flash Engine</span>
          </div>

        </div>
      </div>

    </div>
  );
};
