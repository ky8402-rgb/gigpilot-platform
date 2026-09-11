import React, { useState, useRef, useEffect } from 'react';
import type { DashboardTab } from './AppSidebar';

interface AppTopbarProps {
  activeTab: DashboardTab;
  walletBalance: number;
  usdToInrRate: number;
  autopilot: boolean;
  onToggleAutopilot: () => void;
  watchdogStatus: 'idle' | 'healthy' | 'degraded' | 'restarting';
  watchdogFailures: number;
  watchdogLatencyMs: number | null;
  isBackendLoading: boolean;
  onSyncTelemetry: () => void;
  onOpenPayPalSettlement: () => void;
  onOpenBackendModal: () => void;
  onOpenCredentialsModal: () => void;
  onOpenGitHubSettings: () => void;
  onOpenAutoDeploy: () => void;
<<<<<<< HEAD
  onOpenEmailVerification: () => void;
  onOpenPasswordReset: () => void;
  onOpenPayPalConnect: () => void;
  onOpenLegal: (tab: 'terms' | 'privacy' | 'gst' | 'refunds') => void;
=======
  onOpenSelfUpdatingPipeline?: () => void;
  onOpenEmailVerification: () => void;
  onOpenPasswordReset: () => void;
  onOpenPayPalConnect: () => void;
  onOpenLegal: (tab: 'contract' | 'terms' | 'privacy' | 'gst' | 'refunds') => void;
>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
  isEmailVerified: boolean;
  paypalMeUrl: string;
  paypalMeHandle: string;
  upiId: string;
  fmt: (n: number) => string;
}

export const AppTopbar: React.FC<AppTopbarProps> = ({
  activeTab,
  walletBalance,
  usdToInrRate,
  autopilot,
  onToggleAutopilot,
  watchdogStatus,
  watchdogFailures,
  watchdogLatencyMs,
  isBackendLoading,
  onSyncTelemetry,
  onOpenPayPalSettlement,
  onOpenBackendModal,
  onOpenCredentialsModal,
  onOpenGitHubSettings,
  onOpenAutoDeploy,
<<<<<<< HEAD
=======
  onOpenSelfUpdatingPipeline,
>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
  onOpenEmailVerification,
  onOpenPasswordReset,
  onOpenPayPalConnect,
  onOpenLegal,
  isEmailVerified,
  paypalMeUrl,
  paypalMeHandle,
  upiId,
  fmt,
}) => {
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close tools dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsToolsMenuOpen(false);
      }
    }
    if (isToolsMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isToolsMenuOpen]);

  // Tab Title & Subtitle helper
  const getTabDetails = () => {
    switch (activeTab) {
      case 'dashboard':
        return { category: 'Executive', title: 'Telemetry & Revenue Hub', desc: 'Real-time multi-platform proposals and live income telemetry' };
      case 'orders':
        return { category: 'Operations', title: 'Work Orders Pipeline', desc: 'Automated milestone delivery, escrow and job fulfillment' };
      case 'leads':
        return { category: 'AI Intelligence', title: 'Scored Freelance Leads', desc: '500+ Gemini-matched opportunities scored by win likelihood' };
      case 'notifications':
        return { category: 'Radar', title: 'Instant Lead Alerts', desc: 'Sub-second webhook and push notification dispatch' };
      case 'remoteok':
        return { category: 'Public Stream', title: 'RemoteOK Live Feed', desc: 'Real-time unauthenticated remote gig indexing stream' };
      case 'income':
        return { category: 'Finance', title: 'Real Income & Checkout', desc: 'Monetize freelance skills with PayPal REST and UPI payment flows' };
      case 'paypal':
        return { category: 'Finance', title: 'PayPal REST Terminal', desc: 'Global currency settlement, virtual terminal, and QR checkout' };
      case 'invoicing':
        return { category: 'Contracts', title: 'Invoicing & Escrow Hub', desc: 'Milestone tracking and automated client invoice generator' };
      case 'analytics':
        return { category: 'Insights', title: 'Performance Analytics', desc: 'Conversion benchmarks, win velocity, and revenue yield' };
      case 'health':
        return { category: 'DevOps', title: 'System Diagnostics & Health', desc: 'Continuous telemetry, queue monitoring, and failover engine' };
      case 'logs':
        return { category: 'Diagnostics', title: 'Activity Logs & Debugger', desc: 'Raw webhook payload stream and execution event traces' };
      case 'snapshots':
        return { category: 'Database', title: 'Snapshots & Disaster Recovery', desc: 'Automated PostgreSQL database backups with SHA-256 verification' };
      default:
        return { category: 'Dashboard', title: 'Freelance Autopilot', desc: 'Autonomous execution engine' };
    }
  };

  const tabInfo = getTabDetails();
  const inrBalance = Math.round(walletBalance * usdToInrRate).toLocaleString('en-IN');

  return (
    <header className="mb-6 pb-4 border-b border-slate-800/80 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        
        {/* Left: Context Breadcrumb & Title */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mb-1">
            <span className="text-blue-400 font-semibold">{tabInfo.category}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-300 font-medium">{tabInfo.title}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-1"></span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans truncate">
            {tabInfo.title}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">
            {tabInfo.desc}
          </p>
        </div>

        {/* Right: High-Utility Widget & Control Bar */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          
          {/* Multi-Currency Balance Pill */}
          <button
            onClick={onOpenPayPalSettlement}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-850 px-3.5 py-1.5 rounded-xl border border-slate-800 hover:border-blue-500/50 transition-all cursor-pointer shadow-sm group"
            title="Click to view PayPal Live Balance & Settlement Hub"
          >
            <div className="w-6 h-6 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs font-bold">
              $
            </div>
            <div className="text-left">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono font-bold text-sm text-white group-hover:text-blue-400 transition-colors">
                  ${fmt(walletBalance)}
                </span>
                <span className="text-[10px] text-slate-500 uppercase font-mono">USD</span>
                <span className="text-slate-700">|</span>
                <span className="font-mono text-xs text-emerald-400 font-semibold">
                  ₹{inrBalance}
                </span>
              </div>
            </div>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5"></span>
          </button>

          {/* Autopilot Segmented Switch */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 pl-2 pr-1 flex items-center gap-1.5">
              <i className="fas fa-robot text-blue-400 text-xs"></i>
              <span className="hidden sm:inline">Autopilot</span>
            </span>
            <button
              onClick={onToggleAutopilot}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono transition-all cursor-pointer flex items-center gap-1.5 ${
                autopilot
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-rose-600/20 text-rose-400 border border-rose-500/30'
              }`}
              title={autopilot ? 'Autopilot is currently ACTIVE' : 'Autopilot is currently STANDBY'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${autopilot ? 'bg-white animate-pulse' : 'bg-rose-400'}`}></span>
              <span>{autopilot ? 'ACTIVE' : 'OFF'}</span>
            </button>
          </div>

          {/* Mode: LIVE Indicator */}
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-950/30 text-emerald-300 text-xs font-mono font-bold shadow-sm shadow-emerald-950/50"
            title="Operating in LIVE mode. Connected to live AWS EC2 backend. Zero simulation, zero mocks."
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>MODE: LIVE</span>
          </div>

          {/* Watchdog Latency / Health Indicator */}
          <div
            className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all ${
              watchdogStatus === 'healthy'
                ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                : watchdogStatus === 'restarting'
                ? 'border-amber-500/40 bg-amber-950/20 text-amber-300 animate-pulse'
                : watchdogStatus === 'degraded'
                ? 'border-rose-500/30 bg-rose-950/20 text-rose-300'
                : 'border-slate-800 bg-slate-900 text-slate-400'
            }`}
            title={`Watchdog status: ${watchdogStatus}. Latency: ${watchdogLatencyMs ? `${watchdogLatencyMs}ms` : 'healthy'}.`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                watchdogStatus === 'healthy'
                  ? 'bg-emerald-400'
                  : watchdogStatus === 'restarting'
                  ? 'bg-amber-400 animate-ping'
                  : watchdogStatus === 'degraded'
                  ? 'bg-rose-400'
                  : 'bg-slate-400'
              }`}
            />
            <span className="font-semibold">{watchdogStatus === 'restarting' ? 'Restarting' : 'Connected'}</span>
            {watchdogLatencyMs !== null && watchdogStatus === 'healthy' && (
              <span className="text-[10px] text-emerald-400/80">{watchdogLatencyMs}ms</span>
            )}
          </div>

          {/* Telemetry Refresh Button */}
          <button
            id="topbar-btn-refresh-telemetry"
            onClick={onSyncTelemetry}
            disabled={isBackendLoading}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 transition-all cursor-pointer disabled:opacity-50"
            title="Sync latest live backend telemetry"
          >
            <i className={`fas fa-sync-alt text-xs ${isBackendLoading ? 'animate-spin text-blue-400' : ''}`}></i>
          </button>

          {/* Primary Action: PayPal Settlement Hub */}
          <button
            id="topbar-btn-paypal-settlement"
            onClick={onOpenPayPalSettlement}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-3.5 py-1.5 rounded-xl text-xs shadow-md shadow-blue-500/20 transition-all cursor-pointer"
            title="Open PayPal Live Balance & Settlement Hub"
          >
            <i className="fab fa-paypal text-cyan-300 text-xs"></i>
            <span>Settlement Hub</span>
          </button>

          {/* Consolidated Tools & Gateways Popover Menu */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsToolsMenuOpen(!isToolsMenuOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                isToolsMenuOpen
                  ? 'bg-slate-800 text-white border-slate-600'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-800'
              }`}
              title="Quick Tools, DevOps & System Gateways"
            >
              <i className="fas fa-layer-group text-slate-400 text-xs"></i>
              <span className="hidden sm:inline">Tools</span>
              <i className={`fas fa-chevron-down text-[9px] text-slate-400 transition-transform ${isToolsMenuOpen ? 'rotate-180' : ''}`}></i>
            </button>

            {isToolsMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-[#0e131d] border border-slate-800 rounded-2xl shadow-2xl p-2 z-50 text-slate-200 animate-fadeIn space-y-1">
                <div className="px-3 py-2 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center justify-between">
                  <span>DevOps &amp; Infrastructure</span>
                  <span className="text-emerald-400">Online</span>
                </div>

                {/* Gateway */}
                <button
                  id="topbar-btn-backend-gateway"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenBackendModal();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs">
                    <i className="fas fa-network-wired"></i>
                  </div>
                  <div>
                    <div className="font-semibold text-white">Backend Architecture Gateway</div>
                    <div className="text-[10px] text-slate-400">AWS EC2, Docker &amp; Health API</div>
                  </div>
                </button>

                {/* GitHub SSH */}
                <button
                  id="topbar-btn-github-settings"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenGitHubSettings();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-lg bg-slate-800 text-slate-200 flex items-center justify-center text-xs">
                    <i className="fab fa-github"></i>
                  </div>
                  <div>
                    <div className="font-semibold text-white">GitHub SSH &amp; GitOps</div>
                    <div className="text-[10px] text-slate-400">SSH keys &amp; remote origin sync</div>
                  </div>
                </button>

                {/* Auto Deploy */}
                <button
                  id="topbar-btn-auto-deploy"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenAutoDeploy();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-lg bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-xs">
                    <i className="fas fa-rocket"></i>
                  </div>
                  <div>
                    <div className="font-semibold text-white">Auto-Deploy Pipeline</div>
                    <div className="text-[10px] text-slate-400">EC2 &amp; AWS Amplify CI/CD</div>
                  </div>
                </button>

<<<<<<< HEAD
=======
                {/* Self-Updating Pipeline */}
                <button
                  id="topbar-btn-self-updating"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenSelfUpdatingPipeline?.();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs hover:bg-emerald-950/40 transition-colors text-left cursor-pointer group"
                >
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs group-hover:scale-110 transition-transform">
                    <i className="fas fa-brain"></i>
                  </div>
                  <div>
                    <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <span>Self-Updating Engine</span>
                      <span className="text-[9px] px-1 py-0.2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded font-mono">LOOP</span>
                    </div>
                    <div className="text-[10px] text-slate-400">Prompt 1 ➔ Prompt 2 ➔ Sandbox ➔ Live</div>
                  </div>
                </button>

>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
                {/* Credentials & Backup */}
                <button
                  id="topbar-btn-settings-backup"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenCredentialsModal();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs">
                    <i className="fas fa-sliders-h"></i>
                  </div>
                  <div>
                    <div className="font-semibold text-white">Credentials &amp; Backup</div>
                    <div className="text-[10px] text-slate-400">Export JSON state &amp; webhook tokens</div>
                  </div>
                </button>

                <div className="border-t border-slate-800 my-1 pt-1"></div>

                {/* Email Verification */}
                <button
                  id="topbar-btn-verify-email"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenEmailVerification();
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fas ${isEmailVerified ? 'fa-shield-alt text-emerald-400' : 'fa-envelope text-amber-400'} text-xs`}></i>
                    <span>Email Verification</span>
                  </div>
                  <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                    isEmailVerified ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-300'
                  }`}>
                    {isEmailVerified ? 'VERIFIED' : 'PENDING'}
                  </span>
                </button>

                {/* Password & Security */}
                <button
                  id="topbar-btn-password-reset"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenPasswordReset();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                >
                  <i className="fas fa-key text-blue-400 text-xs"></i>
                  <span>Password &amp; Security</span>
                </button>

                {/* Bank & PayPal Setup */}
                <button
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenPayPalConnect();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer"
                >
                  <i className="fas fa-university text-emerald-400 text-xs"></i>
                  <span>Indian Bank &amp; UPI Setup</span>
                </button>

<<<<<<< HEAD
=======
                {/* Contract Agreement */}
                <button
                  id="topbar-btn-contract-agreement"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenLegal('contract');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer text-slate-300 hover:text-white"
                >
                  <i className="fas fa-file-signature text-xs text-emerald-400"></i>
                  <span className="font-semibold text-emerald-300">Contract Agreement (MSA)</span>
                </button>

>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
                {/* Legal / ToS */}
                <button
                  id="topbar-btn-legal-compliance"
                  onClick={() => {
                    setIsToolsMenuOpen(false);
                    onOpenLegal('terms');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs hover:bg-slate-800/80 transition-colors text-left cursor-pointer text-slate-400 hover:text-slate-200"
                >
<<<<<<< HEAD
                  <i className="fas fa-file-contract text-xs"></i>
=======
                  <i className="fas fa-balance-scale text-xs"></i>
>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
                  <span>Terms, Privacy &amp; GST</span>
                </button>
              </div>
            )}
          </div>

        </div>

      </div>
    </header>
  );
};
