import React from 'react';

export type DashboardTab =
  | 'dashboard'
  | 'income'
  | 'remoteok'
  | 'orders'
  | 'invoicing'
  | 'paypal'
  | 'bank'
  | 'analytics'
  | 'notifications'
  | 'leads'
  | 'logs'
  | 'snapshots'
  | 'health';

interface AppSidebarProps {
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  userEmail: string;
  isEmailVerified: boolean;
  activeOrdersCount: number;
  onOpenEmailVerification: () => void;
  onOpenPasswordReset: () => void;
  onOpenPayPalConnect: () => void;
  onOpenGitHubSettings: () => void;
  onOpenAutoDeploy: () => void;
  onOpenCredentialsModal: () => void;
  onOpenLegal: (tab: 'terms' | 'privacy' | 'gst' | 'refunds') => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  activeTab,
  setActiveTab,
  userEmail,
  isEmailVerified,
  activeOrdersCount,
  onOpenEmailVerification,
  onOpenPasswordReset,
  onOpenPayPalConnect,
  onOpenGitHubSettings,
  onOpenAutoDeploy,
  onOpenCredentialsModal,
  onOpenLegal,
}) => {
  return (
    <aside
      id="app-main-sidebar"
      className="hidden lg:flex w-[260px] min-w-[260px] bg-[#0c1017] border-r border-slate-800/80 flex-col h-screen sticky top-0 overflow-y-auto z-20 select-none text-slate-300"
    >
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800/70">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
            <i className="fas fa-satellite-dish text-base"></i>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight text-white font-mono truncate">
                kundanvision
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
                369
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="truncate">Freelance Autopilot</span>
            </div>
          </div>
        </div>
      </div>

      {/* User Identity Mini Card */}
      <div className="px-4 py-3 border-b border-slate-800/70">
        <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300 text-xs font-bold font-mono">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-mono text-slate-200 truncate" title={userEmail}>
                {userEmail.split('@')[0]}
              </span>
            </div>
            <span
              className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 ${
                isEmailVerified
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              }`}
            >
              {isEmailVerified ? 'Verified' : 'Pending'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <button
              onClick={onOpenEmailVerification}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700/80 text-[11px] text-slate-300 hover:text-white transition-colors flex items-center justify-center gap-1 cursor-pointer border border-slate-700/50"
              title="Identity & Email verification"
            >
              <i className="fas fa-shield-alt text-[10px] text-emerald-400"></i>
              <span>Verify</span>
            </button>
            <button
              onClick={onOpenPasswordReset}
              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700/80 text-[11px] text-slate-300 hover:text-white transition-colors flex items-center justify-center gap-1 cursor-pointer border border-slate-700/50"
              title="Password & Security"
            >
              <i className="fas fa-key text-[10px] text-blue-400"></i>
              <span>Security</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        
        {/* CORE SECTION */}
        <div>
          <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
            Core Operations
          </div>
          <div className="space-y-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-850 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-chart-pie w-4 text-center text-sm"></i>
              <span>Live Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('orders')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'orders'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-tasks w-4 text-center text-sm"></i>
              <span>Work Orders</span>
              {activeOrdersCount > 0 && (
                <span className="ml-auto bg-amber-500 text-slate-950 text-[10px] px-1.5 py-0.2 rounded-full font-bold font-mono">
                  {activeOrdersCount}
                </span>
              )}
            </button>

            <button
              id="sidebar-nav-lead-scoring"
              onClick={() => setActiveTab('leads')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'leads'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-crosshairs w-4 text-center text-sm"></i>
              <span>Scored Leads</span>
              <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                AI 500
              </span>
            </button>

            <button
              id="sidebar-nav-lead-notifications"
              onClick={() => setActiveTab('notifications')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'notifications'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-bolt w-4 text-center text-sm"></i>
              <span>Instant Alerts</span>
              <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                Radar
              </span>
            </button>

            <button
              onClick={() => setActiveTab('remoteok')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'remoteok'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-globe w-4 text-center text-sm"></i>
              <span>RemoteOK Feed</span>
              <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                Live
              </span>
            </button>
          </div>
        </div>

        {/* FINANCIAL SECTION */}
        <div>
          <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
            Financial &amp; Revenue
          </div>
          <div className="space-y-1">
            <button
              id="sidebar-nav-real-income"
              onClick={() => setActiveTab('income')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'income'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-wallet w-4 text-center text-sm text-emerald-400"></i>
              <span>Income &amp; Checkout</span>
              <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Settled
              </span>
            </button>

            <button
              onClick={() => setActiveTab('paypal')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'paypal'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fab fa-paypal w-4 text-center text-sm text-[#00cfe8]"></i>
              <span>PayPal REST API</span>
              <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#00cfe8]/10 text-[#00cfe8] border border-[#00cfe8]/20">
                v2 Live
              </span>
            </button>

            <button
              onClick={() => setActiveTab('invoicing')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'invoicing'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-file-invoice-dollar w-4 text-center text-sm"></i>
              <span>Invoicing &amp; Contracts</span>
            </button>

            <button
              id="sidebar-nav-paypal-connect"
              onClick={onOpenPayPalConnect}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 cursor-pointer"
            >
              <i className="fas fa-university w-4 text-center text-sm text-emerald-400"></i>
              <span>Bank &amp; UPI Setup</span>
              <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                INR
              </span>
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'analytics'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-chart-line w-4 text-center text-sm"></i>
              <span>Yield Analytics</span>
            </button>
          </div>
        </div>

        {/* SYSTEM & DEVOPS SECTION */}
        <div>
          <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
            System &amp; Infrastructure
          </div>
          <div className="space-y-1">
            <button
              onClick={() => setActiveTab('health')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'health'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-heartbeat w-4 text-center text-sm text-emerald-400"></i>
              <span>Health Diagnostics</span>
            </button>

            <button
              id="sidebar-nav-activity-logs"
              onClick={() => setActiveTab('logs')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'logs'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-terminal w-4 text-center text-sm text-indigo-400"></i>
              <span>Activity &amp; Webhooks</span>
            </button>

            <button
              onClick={() => setActiveTab('snapshots')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'snapshots'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
              }`}
            >
              <i className="fas fa-database w-4 text-center text-sm text-cyan-400"></i>
              <span>Database Snapshots</span>
            </button>
          </div>
        </div>

        {/* INTEGRATIONS & TOOLS */}
        <div>
          <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
            Developer Tools
          </div>
          <div className="space-y-1">
            <button
              id="sidebar-nav-github-settings"
              onClick={onOpenGitHubSettings}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <i className="fab fa-github w-4 text-center text-sm text-slate-200"></i>
                <span>GitHub SSH &amp; GitOps</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                SSH
              </span>
            </button>

            <button
              id="sidebar-nav-auto-deploy"
              onClick={onOpenAutoDeploy}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/20 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <i className="fas fa-rocket w-4 text-center text-sm text-cyan-400"></i>
                <span>Auto-Deploy Tool</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                AWS
              </span>
            </button>

            <button
              onClick={onOpenCredentialsModal}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <i className="fas fa-sliders-h w-4 text-center text-sm text-slate-400"></i>
                <span>Credentials &amp; Backup</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                JSON
              </span>
            </button>
          </div>
        </div>

      </div>

      {/* Sidebar Footer */}
      <div className="p-4 border-t border-slate-800/70 text-xs text-slate-500 space-y-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Gemini Flash Engine
          </span>
          <span className="font-mono text-emerald-400 font-semibold">99.9%</span>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-800/40">
          <button
            onClick={() => onOpenLegal('terms')}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Terms
          </button>
          <span>•</span>
          <button
            onClick={() => onOpenLegal('privacy')}
            className="hover:text-slate-300 transition-colors cursor-pointer"
          >
            Privacy
          </button>
          <span>•</span>
          <button
            onClick={() => onOpenLegal('gst')}
            className="hover:text-emerald-400 transition-colors cursor-pointer font-mono"
          >
            GST 18%
          </button>
        </div>
      </div>
    </aside>
  );
};
