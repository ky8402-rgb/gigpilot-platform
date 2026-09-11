import React from 'react';
import type { DashboardTab } from './AppSidebar';

interface AppMobileNavProps {
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  walletBalance: number;
  userEmail: string;
  isEmailVerified: boolean;
  activeOrdersCount: number;
  onOpenEmailVerification: () => void;
  onOpenPasswordReset: () => void;
  onOpenPayPalConnect: () => void;
  onOpenPayPalSettlement: () => void;
  onOpenGitHubSettings: () => void;
  onOpenAutoDeploy: () => void;
  onOpenCredentialsModal: () => void;
  onOpenLegal: (tab: 'terms' | 'privacy' | 'gst' | 'refunds') => void;
  fmt: (n: number) => string;
}

export const AppMobileNav: React.FC<AppMobileNavProps> = ({
  activeTab,
  setActiveTab,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  walletBalance,
  userEmail,
  isEmailVerified,
  activeOrdersCount,
  onOpenEmailVerification,
  onOpenPasswordReset,
  onOpenPayPalConnect,
  onOpenPayPalSettlement,
  onOpenGitHubSettings,
  onOpenAutoDeploy,
  onOpenCredentialsModal,
  onOpenLegal,
  fmt,
}) => {
  return (
    <>
      {/* Mobile Top Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between border-b border-slate-800 bg-[#0c1017]/95 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 text-slate-300 hover:text-white rounded-xl bg-slate-900 border border-slate-800 cursor-pointer"
            aria-label="Open Navigation Menu"
          >
            <i className="fas fa-bars text-sm"></i>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
              <i className="fas fa-satellite-dish"></i>
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight font-mono text-white block leading-tight">
                kundanvision369
              </span>
              <span className="text-[9px] text-slate-400 block font-sans">Autopilot Engine</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Balance Pill */}
          <button
            onClick={onOpenPayPalSettlement}
            className="bg-slate-900 px-2.5 py-1 rounded-xl border border-slate-800 flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
          >
            <span className="text-emerald-400 font-bold">$</span>
            <span className="font-mono text-white">${fmt(walletBalance)}</span>
          </button>

          {/* Verification Status Pill */}
          <button
            onClick={onOpenEmailVerification}
            className={`p-1.5 rounded-xl text-xs flex items-center cursor-pointer ${
              isEmailVerified
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse'
            }`}
            title={isEmailVerified ? 'Email Verified' : 'Verify Email'}
          >
            <i className={`fas ${isEmailVerified ? 'fa-shield-alt' : 'fa-envelope'} text-xs`}></i>
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />

          {/* Drawer Content */}
          <div className="relative w-4/5 max-w-xs bg-[#0c1017] border-r border-slate-800 p-5 flex flex-col h-full overflow-y-auto z-10 shadow-2xl space-y-4">
            
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  <i className="fas fa-satellite-dish"></i>
                </div>
                <div>
                  <span className="font-bold text-sm text-white font-mono block">kundanvision369</span>
                  <span className="text-[10px] text-slate-400 block">Freelance Autopilot</span>
                </div>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-900 border border-slate-800 cursor-pointer"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            {/* Account Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 truncate max-w-[140px] font-mono">
                  {userEmail}
                </span>
                <span
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    isEmailVerified
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {isEmailVerified ? 'VERIFIED' : 'PENDING'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onOpenEmailVerification();
                  }}
                  className="rounded-lg bg-slate-800 p-1.5 text-center text-emerald-300 border border-slate-700 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <i className="fas fa-shield-alt text-[10px]"></i>
                  <span>Verify</span>
                </button>
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onOpenPasswordReset();
                  }}
                  className="rounded-lg bg-slate-800 p-1.5 text-center text-blue-300 border border-slate-700 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <i className="fas fa-key text-[10px]"></i>
                  <span>Security</span>
                </button>
              </div>
            </div>

            {/* Nav Items Group */}
            <div className="space-y-1 overflow-y-auto flex-1">
              {([
                { tab: 'dashboard' as const, label: 'Live Dashboard', icon: 'fa-chart-pie', badge: undefined },
                { tab: 'orders' as const, label: 'Work Orders', icon: 'fa-tasks', badge: activeOrdersCount > 0 ? String(activeOrdersCount) : undefined },
                { tab: 'leads' as const, label: 'Scored Leads', icon: 'fa-crosshairs', badge: 'AI 500' },
                { tab: 'notifications' as const, label: 'Instant Alerts', icon: 'fa-bolt', badge: 'Radar' },
                { tab: 'remoteok' as const, label: 'RemoteOK Feed', icon: 'fa-globe', badge: 'Live' },
                { tab: 'income' as const, label: 'Income & Checkout', icon: 'fa-wallet', badge: 'Earn' },
                { tab: 'paypal' as const, label: 'PayPal REST Terminal', icon: 'fab fa-paypal', badge: 'v2' },
                { tab: 'invoicing' as const, label: 'Invoicing & Contracts', icon: 'fa-file-invoice-dollar', badge: undefined },
                { tab: 'analytics' as const, label: 'Yield Analytics', icon: 'fa-chart-line', badge: undefined },
                { tab: 'health' as const, label: 'System Diagnostics', icon: 'fa-heartbeat', badge: 'DevOps' },
                { tab: 'logs' as const, label: 'Activity Logs', icon: 'fa-terminal', badge: 'Debug' },
                { tab: 'snapshots' as const, label: 'Database Snapshots', icon: 'fa-database', badge: undefined },
              ]).map((item) => (
                <button
                  key={item.tab}
                  onClick={() => {
                    setActiveTab(item.tab);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    activeTab === item.tab
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  <i className={`fas ${item.icon} w-4 text-center`}></i>
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Quick Gateways in Drawer */}
            <div className="pt-2 border-t border-slate-800 space-y-1.5">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenPayPalSettlement();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 cursor-pointer shadow-sm"
              >
                <i className="fab fa-paypal text-cyan-300"></i>
                <span>PayPal Settlement Hub</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenPayPalConnect();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-400 bg-slate-900 border border-slate-800 cursor-pointer"
              >
                <i className="fas fa-university"></i>
                <span>Bank &amp; UPI Setup</span>
              </button>

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenGitHubSettings();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-900 border border-slate-800 cursor-pointer"
              >
                <i className="fab fa-github"></i>
                <span>GitHub SSH &amp; GitOps</span>
              </button>
            </div>

            {/* Legal Links */}
            <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500 flex justify-around">
              <button onClick={() => { setIsMobileMenuOpen(false); onOpenLegal('terms'); }} className="hover:text-slate-300">Terms</button>
              <span>•</span>
              <button onClick={() => { setIsMobileMenuOpen(false); onOpenLegal('privacy'); }} className="hover:text-slate-300">Privacy</button>
              <span>•</span>
              <button onClick={() => { setIsMobileMenuOpen(false); onOpenLegal('gst'); }} className="hover:text-emerald-400">GST 18%</button>
            </div>

          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0c1017]/95 backdrop-blur-lg border-t border-slate-800 px-3 py-2 flex items-center justify-around shadow-2xl">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-[10px] font-semibold transition-all ${
            activeTab === 'dashboard' ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <i className="fas fa-chart-pie text-sm"></i>
          <span>Dashboard</span>
        </button>

        <button
          onClick={() => setActiveTab('orders')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-[10px] font-semibold relative transition-all ${
            activeTab === 'orders' ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <i className="fas fa-tasks text-sm"></i>
          <span>Orders</span>
          {activeOrdersCount > 0 && (
            <span className="absolute -top-1 right-2 w-2 h-2 rounded-full bg-amber-500"></span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('leads')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-[10px] font-semibold transition-all ${
            activeTab === 'leads' ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <i className="fas fa-crosshairs text-sm"></i>
          <span>Leads</span>
        </button>

        <button
          onClick={() => setActiveTab('income')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-[10px] font-semibold transition-all ${
            activeTab === 'income' ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <i className="fas fa-wallet text-sm"></i>
          <span>Income</span>
        </button>

        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-[10px] font-semibold text-slate-400 hover:text-slate-200"
        >
          <i className="fas fa-bars text-sm"></i>
          <span>More</span>
        </button>
      </nav>
    </>
  );
};
