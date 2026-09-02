import React from 'react';
import { 
  Bot, 
  Sparkles, 
  Zap, 
  Briefcase, 
  Cpu, 
  Settings, 
  RefreshCw, 
  CheckCircle2, 
  PauseCircle, 
  ShieldCheck,
  TrendingUp,
  DollarSign
} from 'lucide-react';
import { AutopilotRules } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  rules: AutopilotRules;
  totalEarnings: number;
  connectsBalance: number;
  onTriggerScan: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  isScanning: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  rules,
  totalEarnings,
  connectsBalance,
  onTriggerScan,
  onOpenSettings,
  onOpenProfile,
  isScanning
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* Left: Brand Identity & Status */}
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 p-0.5 shadow-lg shadow-emerald-950/40">
            <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-slate-950">
              <Bot className="h-5 w-5 text-emerald-400" />
            </div>
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold tracking-tight text-white sm:text-lg">Freelance AutoPilot</span>
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                v2.8 AI Autonomous
              </span>
            </div>
            
            <div className="flex items-center space-x-2 text-xs">
              {rules.mode === 'autonomous' ? (
                <span className="flex items-center font-medium text-emerald-400">
                  <span className="mr-1.5 h-2 w-2 animate-ping rounded-full bg-emerald-400" />
                  <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-500" />
                  Autonomous Bot Active
                </span>
              ) : rules.mode === 'review_queue' ? (
                <span className="flex items-center font-medium text-amber-400">
                  <span className="mr-1.5 h-2 w-2 rounded-full bg-amber-500" />
                  Assisted Review Queue
                </span>
              ) : (
                <span className="flex items-center font-medium text-slate-400">
                  <PauseCircle className="mr-1 h-3 w-3" />
                  Bot Standby
                </span>
              )}
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">Target: ${rules.minHourlyRate}/hr+</span>
            </div>
          </div>
        </div>

        {/* Center: Navigation Tabs */}
        <nav className="hidden lg:flex items-center space-x-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
          <button
            id="nav-jobs-radar"
            onClick={() => setActiveTab('jobs')}
            className={`flex items-center space-x-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'jobs'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Jobs Radar</span>
          </button>

          <button
            id="nav-autopilot-engine"
            onClick={() => setActiveTab('autopilot')}
            className={`flex items-center space-x-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'autopilot'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            <span>Auto-Bidding Engine</span>
          </button>

          <button
            id="nav-contracts"
            onClick={() => setActiveTab('contracts')}
            className={`flex items-center space-x-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'contracts'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Briefcase className="h-3.5 w-3.5" />
            <span>Contracts & CRM</span>
          </button>

          <button
            id="nav-passive-yield"
            onClick={() => setActiveTab('nodes')}
            className={`flex items-center space-x-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'nodes'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>Passive Yield Nodes</span>
          </button>

          <button
            id="nav-ai-advisor"
            onClick={() => setActiveTab('advisor')}
            className={`flex items-center space-x-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'advisor'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI Strategist</span>
          </button>
        </nav>

        {/* Right: Live Ticker, Scan button & Settings */}
        <div className="flex items-center space-x-3">
          
          {/* Real-time Earnings Vault */}
          <div className="hidden sm:flex flex-col items-end rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Total Revenue</span>
            <div className="flex items-center space-x-1 font-mono font-bold text-emerald-400">
              <DollarSign className="h-3.5 w-3.5" />
              <span>{totalEarnings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          {/* Connects Pool */}
          <div className="hidden md:flex flex-col items-end rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Connects Pool</span>
            <div className="flex items-center space-x-1 font-mono text-xs font-semibold text-cyan-300">
              <Zap className="h-3 w-3 fill-cyan-300" />
              <span>{connectsBalance} left</span>
            </div>
          </div>

          {/* Manual Instant Scan Button */}
          <button
            id="btn-trigger-scan"
            onClick={onTriggerScan}
            disabled={isScanning}
            className="flex items-center space-x-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 transition-all hover:bg-emerald-500/20 active:scale-95 disabled:opacity-50"
            title="Scan Upwork & Freelancer now"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">{isScanning ? 'Scanning...' : 'Scan Jobs'}</span>
          </button>

          {/* Profile & Settings Buttons */}
          <button
            id="btn-open-settings"
            onClick={onOpenSettings}
            className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-all"
            title="Autopilot Rules & API Settings"
          >
            <Settings className="h-4 w-4" />
          </button>

          <button
            id="btn-open-profile"
            onClick={onOpenProfile}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-950/60 text-xs font-bold text-emerald-300 hover:border-emerald-400 transition-all"
            title="Freelancer Profile"
          >
            JH
          </button>
        </div>

      </div>

      {/* Mobile Tab bar */}
      <div className="flex lg:hidden overflow-x-auto border-t border-slate-800/80 bg-slate-950 px-2 py-1.5 space-x-1">
        <button
          onClick={() => setActiveTab('jobs')}
          className={`flex whitespace-nowrap items-center space-x-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
            activeTab === 'jobs' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'
          }`}
        >
          <Zap className="h-3 w-3" />
          <span>Radar</span>
        </button>
        <button
          onClick={() => setActiveTab('autopilot')}
          className={`flex whitespace-nowrap items-center space-x-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
            activeTab === 'autopilot' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'
          }`}
        >
          <Bot className="h-3 w-3" />
          <span>Auto-Bidding</span>
        </button>
        <button
          onClick={() => setActiveTab('contracts')}
          className={`flex whitespace-nowrap items-center space-x-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
            activeTab === 'contracts' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'
          }`}
        >
          <Briefcase className="h-3 w-3" />
          <span>Contracts</span>
        </button>
        <button
          onClick={() => setActiveTab('nodes')}
          className={`flex whitespace-nowrap items-center space-x-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
            activeTab === 'nodes' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'
          }`}
        >
          <Cpu className="h-3 w-3" />
          <span>Yield Nodes</span>
        </button>
        <button
          onClick={() => setActiveTab('advisor')}
          className={`flex whitespace-nowrap items-center space-x-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
            activeTab === 'advisor' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'
          }`}
        >
          <Sparkles className="h-3 w-3" />
          <span>AI Strategist</span>
        </button>
      </div>
    </header>
  );
};
