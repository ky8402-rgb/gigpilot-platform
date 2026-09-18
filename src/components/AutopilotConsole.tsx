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
  Cpu,
  ShieldCheck,
  Ban,
  Building,
  Briefcase,
  Users,
  Search,
  Check,
  AlertOctagon
} from 'lucide-react';
import { AutopilotRules, AutopilotLog } from '../types';
import { 
  HARD_EXCLUDE_CATEGORIES, 
  ALL_HARD_EXCLUDE_KEYWORDS, 
  checkHardExcludeFilter,
  HardExcludeCheckResult
} from '../utils/autoBidFilters';

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
  const [testJobText, setTestJobText] = useState('');
  const [testResult, setTestResult] = useState<HardExcludeCheckResult | null>(null);

  const handleTestFilter = (textToTest?: string) => {
    const text = textToTest !== undefined ? textToTest : testJobText;
    if (!text.trim()) {
      setTestResult(null);
      return;
    }
    const result = checkHardExcludeFilter(text);
    setTestResult(result);
  };

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
    <div className="space-y-6">
      
      {/* ========================================================================= */}
      {/* 1. HARD EXCLUDE FILTERS (NEVER BID) - USER DIRECTIVE SPECIFICATION */}
      {/* ========================================================================= */}
      <div className="rounded-3xl border border-rose-500/30 bg-gradient-to-br from-slate-950 via-slate-900 to-rose-950/20 p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-rose-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-800/80 relative z-10">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 px-3 py-1 text-xs font-mono font-extrabold uppercase tracking-wider text-rose-300 border border-rose-500/30">
                <Ban className="h-3.5 w-3.5 text-rose-400" />
                Rule 1: Hard Exclude Filters (Never Bid)
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-mono font-bold text-emerald-400 border border-emerald-500/30">
                <ShieldCheck className="h-3.5 w-3.5" />
                Live Enforcement Active
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Total Keywords: {ALL_HARD_EXCLUDE_KEYWORDS.length}
              </span>
            </div>
            <h2 className="text-lg font-bold text-white mt-2 flex items-center gap-2">
              <span>Zero-Tolerance Autonomous Skip Policy</span>
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-3xl leading-relaxed">
              Your app instantly skips any job containing words from these 3 categories. If any of these appear in the title, description, or requirements &rarr; <strong className="text-rose-400 font-bold uppercase tracking-wide">skip job</strong>. Protects connects and focuses exclusively on profitable, async freelance contracts.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-2.5 text-center">
              <div className="text-[10px] uppercase font-mono text-rose-300 font-bold">Never Bid Policy</div>
              <div className="text-xs font-bold text-white mt-0.5 flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                Instant Skip Active
              </div>
            </div>
          </div>
        </div>

        {/* 3 Categories Display */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 relative z-10">
          
          {/* Category 1: Physical / On-site */}
          <div className="rounded-2xl border border-rose-500/30 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center text-xs font-bold border border-rose-500/30">
                  <Building className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Physical / On-site</h4>
                  <span className="text-[10px] text-slate-400">17 Forbidden Terms</span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 font-bold">
                Auto-Skip
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Filter out physical location, commuting, warehouse, or manual labor jobs.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {HARD_EXCLUDE_CATEGORIES.physical_onsite.keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-rose-950/60 border border-rose-500/30 text-rose-300 font-mono text-[11px] font-semibold"
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>

          {/* Category 2: Office / Hiring / Employment */}
          <div className="rounded-2xl border border-amber-500/30 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold border border-amber-500/30">
                  <Briefcase className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Office / Hiring / Employment</h4>
                  <span className="text-[10px] text-slate-400">14 Forbidden Terms</span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-bold">
                Auto-Skip
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Filter out traditional W2/payroll employment, 9-5 fixed schedules, and corporate HR hiring.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {HARD_EXCLUDE_CATEGORIES.office_hiring_employment.keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-950/60 border border-amber-500/30 text-amber-300 font-mono text-[11px] font-semibold"
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>

          {/* Category 3: Human-dependent */}
          <div className="rounded-2xl border border-sky-500/30 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center text-xs font-bold border border-sky-500/30">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">Human-dependent</h4>
                  <span className="text-[10px] text-slate-400">11 Forbidden Terms</span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 font-bold">
                Auto-Skip
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Filter out mandatory Zoom video calls, daily standups, interviews, and cumbersome legal signing.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {HARD_EXCLUDE_CATEGORIES.human_dependent.keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-sky-950/60 border border-sky-500/30 text-sky-300 font-mono text-[11px] font-semibold"
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>

        </div>

        {/* Interactive Filter Testing Sandbox */}
        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/90 p-4 relative z-10 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-emerald-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Interactive Hard Exclude Test Sandbox
              </h4>
            </div>
            <span className="text-[11px] text-slate-400">
              Type or paste job text to verify instant skip behavior in real-time
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex gap-2">
              <input
                type="text"
                id="input-test-job-text"
                value={testJobText}
                onChange={(e) => {
                  setTestJobText(e.target.value);
                  handleTestFilter(e.target.value);
                }}
                placeholder="e.g. 'Looking for full-time React developer for on-site role with daily standup'..."
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900/90 px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-rose-500 focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => handleTestFilter()}
                className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-bold text-white transition-colors cursor-pointer border border-slate-700 shrink-0"
              >
                Test Filter
              </button>
            </div>

            {/* Quick Preset Test Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-slate-500 font-mono uppercase">Quick Presets:</span>
              <button
                type="button"
                onClick={() => {
                  const s = 'On-site React Engineer needed for office branch repair';
                  setTestJobText(s);
                  handleTestFilter(s);
                }}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition-colors"
              >
                Physical (on-site)
              </button>
              <button
                type="button"
                onClick={() => {
                  const s = 'Full-time employee hiring with 9-5 fixed hours and salary payroll';
                  setTestJobText(s);
                  handleTestFilter(s);
                }}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition-colors"
              >
                Hiring (full-time)
              </button>
              <button
                type="button"
                onClick={() => {
                  const s = 'Backend engineer required for daily standup and weekly Zoom video call';
                  setTestJobText(s);
                  handleTestFilter(s);
                }}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 transition-colors"
              >
                Human-dependent (Zoom)
              </button>
              <button
                type="button"
                onClick={() => {
                  const s = 'Async TypeScript & Node.js REST API microservice with Docker container';
                  setTestJobText(s);
                  handleTestFilter(s);
                }}
                className="px-2 py-0.5 rounded bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-500/30 text-[11px] text-emerald-300 transition-colors font-semibold"
              >
                Clean Job (Safe to Bid)
              </button>
            </div>

            {/* Live Filter Result Box */}
            {testResult && (
              <div className={`p-3 rounded-xl border transition-all text-xs font-mono flex items-start gap-2.5 ${
                testResult.shouldSkip
                  ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                  : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              }`}>
                {testResult.shouldSkip ? (
                  <>
                    <AlertOctagon className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold flex items-center gap-2">
                        <span className="text-rose-400 uppercase tracking-wide">🚫 INSTANT SKIP TRIGGERED</span>
                        <span className="px-2 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[10px] border border-rose-500/30">
                          Matched: "{testResult.matchedKeyword}" &bull; {testResult.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-rose-300/80 mt-1">
                        {testResult.reason} &bull; Autopilot daemon will immediately discard this contract without burning connects or submitting proposals.
                      </p>
                      {testResult.matchedTextSnippet && (
                        <div className="mt-1.5 p-1.5 rounded bg-slate-950/80 border border-rose-900/50 text-[11px] text-rose-400">
                          Detected in snippet: <span className="font-semibold">{testResult.matchedTextSnippet}</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-emerald-400 uppercase tracking-wide flex items-center gap-2">
                        <span>✅ CLEAN CONTRACT &bull; ZERO EXCLUSIONS MATCHED</span>
                      </div>
                      <p className="text-[11px] text-emerald-300/80 mt-0.5">
                        This job is fully compatible with autonomous bidding. If match score exceeds {rules.minMatchScore}%, Gemini proposal will be generated and dispatched.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2-COLUMN MAIN BODY: OPERATING MODES & LIVE TERMINAL LOGS */}
      {/* ========================================================================= */}
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
                className="w-full flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-2.5 text-xs font-bold text-slate-950 shadow-md shadow-emerald-950/50 hover:from-emerald-400 hover:to-teal-400 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
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

              {/* Additional Custom Blacklist Keywords */}
              <div>
                <label className="font-semibold text-slate-300">Additional Custom Negative Keywords:</label>
                <form onSubmit={handleAddBlacklist} className="mt-1.5 flex space-x-2">
                  <input
                    type="text"
                    value={newBlacklistWord}
                    onChange={(e) => setNewBlacklistWord(e.target.value)}
                    placeholder="e.g. revshare, crypto, unverified"
                    className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
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
                        className="ml-1 text-rose-400 hover:text-rose-200 cursor-pointer"
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
                  LIVE HARD EXCLUDE ACTIVE
                </span>
                <button
                  onClick={onClearLogs}
                  className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300 cursor-pointer"
                  title="Clear Logs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Terminal Console Output */}
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-2.5 max-h-[640px]">
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
                  if (log.action === 'SKIP' || log.action === 'HARD_EXCLUDE' as any) badgeColor = 'bg-rose-950/90 text-rose-300 border border-rose-500/40 font-bold';

                  return (
                    <div
                      key={log.id}
                      className={`flex flex-col rounded-lg p-2.5 border transition-colors ${
                        log.action === 'SKIP' || log.action === 'HARD_EXCLUDE' as any
                          ? 'bg-rose-950/20 border-rose-500/20 hover:bg-rose-950/30'
                          : 'bg-slate-900/40 border-slate-800/50 hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="flex items-center space-x-2 text-[11px]">
                        <span className="text-slate-500">{log.timestamp}</span>
                        
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeColor}`}>
                          {log.action === 'SKIP' ? '🚫 SKIPPED (HARD EXCLUDE)' : log.action}
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
              <span>Daemon: Upwork/Freelancer Autonomous Radar v3.2</span>
              <span>42 Hard Exclude Words Enforced</span>
            </div>

          </div>
        </div>

      </div>

    </div>
  );
};

