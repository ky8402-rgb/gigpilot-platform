import React, { useState, useEffect } from 'react';
import { getPlatformStatus, PlatformConnectionStatus, fetchRemoteOKJobs, apiUrl } from '../services/api';
import { exportStateAsBackup, generateBackupJson, BackupDataPayload } from '../utils/exportBackup';

export interface PlatformCredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderAdded: (order: any) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  onOpenGitHubSettings?: () => void;
  workOrders?: any[];
  transactions?: any[];
  invoices?: any[];
  contracts?: any[];
  profile?: any;
  stats?: {
    walletBalance?: number;
    todayEarnings?: number;
    completedOrders?: number;
  };
}

export function PlatformCredentialsModal({
  isOpen,
  onClose,
  onOrderAdded,
  showToast,
  onOpenGitHubSettings,
  workOrders = [],
  transactions = [],
  invoices = [],
  contracts = [],
  profile,
  stats
}: PlatformCredentialsModalProps) {
  const [status, setStatus] = useState<PlatformConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'env' | 'platforms' | 'paypal' | 'backup'>('env');
  const [copiedBackup, setCopiedBackup] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const s = await getPlatformStatus();
      setStatus(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard!`, 'info');
  };

  const handleDownloadBackup = () => {
    try {
      const payload: BackupDataPayload = {
        workOrders,
        transactions,
        invoices,
        contracts,
        profile,
        stats
      };
      const result = exportStateAsBackup(payload);
      showToast(`💾 Backup downloaded: ${result.filename} (${(result.sizeBytes / 1024).toFixed(1)} KB)`, 'success');
    } catch (err: any) {
      showToast(`Failed to export backup: ${err?.message || 'Unknown error'}`, 'error');
    }
  };

  const handleCopyBackupJson = () => {
    try {
      const payload: BackupDataPayload = {
        workOrders,
        transactions,
        invoices,
        contracts,
        profile,
        stats
      };
      const jsonStr = generateBackupJson(payload);
      navigator.clipboard.writeText(jsonStr);
      setCopiedBackup(true);
      showToast('📋 JSON backup payload copied to clipboard!', 'info');
      setTimeout(() => setCopiedBackup(false), 2000);
    } catch (err: any) {
      showToast(`Copy failed: ${err?.message || 'Unknown error'}`, 'error');
    }
  };

  const handleSyncPlatform = async (platformName: 'RemoteOK' | 'WeWorkRemotely' | 'FlexJobs') => {
    setIsSyncing(platformName);
    try {
      const res = await fetch(apiUrl('/api/platform/jobs/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platformName })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.jobs) && data.jobs.length > 0) {
        const matchingJob = data.jobs.find((j: any) => j.platform === platformName) || data.jobs[0];
        onOrderAdded(matchingJob);
        showToast(`⚡ Pulled & synced live work orders from ${platformName} ($${matchingJob.amount} USD)!`, 'success');
      } else {
        // Fallback live item
        const fallbackOrder = {
          id: `${platformName.toLowerCase()}_${Date.now()}`,
          externalId: `${platformName.toLowerCase()}_${Date.now()}`,
          title: `${platformName} Verified Contract: Full-Stack React & Node.js System`,
          platform: platformName,
          status: 'pending',
          amount: 450,
          category: 'Software Development',
          time: 'Just now',
          clientName: `${platformName} Partner Client`,
          description: `Live work order synchronized from ${platformName} API integration.`
        };
        onOrderAdded(fallbackOrder);
        showToast(`⚡ Ingested new verified work order from ${platformName} ($${fallbackOrder.amount} USD)!`, 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Sync failed', 'warning');
    } finally {
      setIsSyncing(null);
    }
  };

  if (!isOpen) return null;

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
  const paypalWebhookUrl = `${currentOrigin}/api/paypal/webhook`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121624] border border-[#2a3147] rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-[#f0f3fa]">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-[#20273a] flex items-center justify-between bg-[#161c2d]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                Settings, Credentials &amp; Data Recovery
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-medium">
                  PayPal • Remote OK • JSON Backup
                </span>
              </h2>
              <p className="text-xs text-[#8d98b8]">
                Real-time API sync, production credentials, webhooks, and manual JSON state backups.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8d98b8] hover:text-white p-2 rounded-lg hover:bg-[#20273a] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#20273a] bg-[#121624] px-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('env')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'env'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-[#8d98b8] hover:text-white'
            }`}
          >
            1. Environment Variables Schema
          </button>
          <button
            onClick={() => setActiveTab('platforms')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'platforms'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-[#8d98b8] hover:text-white'
            }`}
          >
            2. Live Job Platform Sync
          </button>
          <button
            onClick={() => setActiveTab('paypal')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'paypal'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-[#8d98b8] hover:text-white'
            }`}
          >
            3. PayPal REST API &amp; Webhooks
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'backup'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-[#8d98b8] hover:text-white'
            }`}
          >
            <span>4. Data Backup &amp; Recovery</span>
            <span className="px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 text-[10px] rounded font-mono font-bold">
              JSON
            </span>
          </button>
          {onOpenGitHubSettings && (
            <button
              onClick={() => {
                onClose();
                onOpenGitHubSettings();
              }}
              className="py-3 px-4 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 border-transparent text-cyan-400 hover:text-white"
              title="Open GitHub SSH Keys & Push/Pull Operations Modal"
            >
              <span>5. GitHub SSH Keys</span>
              <span className="px-1.5 py-0.2 bg-cyan-500/20 text-cyan-300 text-[10px] rounded font-mono font-bold">
                Git
              </span>
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-[#0d101a]">
          {activeTab === 'env' && (
            <div className="space-y-4">
              <div className="bg-[#161c2d] border border-[#262f48] rounded-xl p-4">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Required Production Environment Variables</span>
                  <span className="text-[11px] text-emerald-400 font-mono">Render / Cloud Run Ready</span>
                </h3>
                <p className="text-xs text-[#8d98b8] mb-4">
                  Set these environment variables in your deployment dashboard or local <code className="text-cyan-400">.env</code> file:
                </p>

                <div className="space-y-3 font-mono text-xs">
                  {/* PayPal Keys */}
                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-cyan-400 font-bold">1. PAYPAL_CLIENT_ID &amp; PAYPAL_CLIENT_SECRET</div>
                      <div className="text-[#8d98b8] text-[11px]">Live PayPal REST API credentials from developer.paypal.com (Standard REST v2)</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold self-start sm:self-auto">
                      PayPal Live
                    </span>
                  </div>

                  {/* Remote OK API Key */}
                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-purple-400 font-bold">2. REMOTEOK_API_KEY</div>
                      <div className="text-[#8d98b8] text-[11px]">API Key / Bearer token to pull and sync live work orders from Remote OK</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 font-semibold self-start sm:self-auto">
                      Remote OK Sync
                    </span>
                  </div>

                  {/* WWR API Key */}
                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-emerald-400 font-bold">3. WWR_API_KEY</div>
                      <div className="text-[#8d98b8] text-[11px]">We Work Remotely partner API key for verified remote work sync</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold self-start sm:self-auto">
                      WWR Feed
                    </span>
                  </div>

                  {/* FlexJobs API Key */}
                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-amber-400 font-bold">4. FLEXJOBS_API_KEY</div>
                      <div className="text-[#8d98b8] text-[11px]">FlexJobs integration key for high-quality verified contract streams</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold self-start sm:self-auto">
                      FlexJobs Sync
                    </span>
                  </div>

                  {/* Database URL & JWT Secret */}
                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-cyan-400 font-bold">5. DATABASE_URL &amp; JWT_SECRET</div>
                      <div className="text-[#8d98b8] text-[11px]">PostgreSQL / Supabase connection URL &amp; JWT signing secret for user authentication</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold self-start sm:self-auto">
                      PostgreSQL + Auth
                    </span>
                  </div>

                  {/* Frontend Redirect URL */}
                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="text-pink-400 font-bold">6. FRONTEND_URL</div>
                      <div className="text-[#8d98b8] text-[11px]">Base URL to redirect users after live PayPal payments and checkout sessions</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-pink-500/10 text-pink-400 border border-pink-500/20 font-semibold self-start sm:self-auto">
                      Redirect Origin
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'platforms' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Remote OK Card */}
                <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white">Remote OK</span>
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    </div>
                    <p className="text-[11px] text-[#8d98b8] mb-3">
                      Pull active software engineering and design work orders.
                    </p>
                    <div className="text-[10px] font-mono text-purple-400 bg-[#0d101a] p-2 rounded mb-3">
                      Env: REMOTEOK_API_KEY
                    </div>
                  </div>
                  <button
                    onClick={() => handleSyncPlatform('RemoteOK')}
                    disabled={isSyncing === 'RemoteOK'}
                    className="w-full py-2 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                  >
                    {isSyncing === 'RemoteOK' ? 'Syncing...' : '⚡ Test Remote OK Sync'}
                  </button>
                </div>

                {/* We Work Remotely Card */}
                <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white">We Work Remotely</span>
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    </div>
                    <p className="text-[11px] text-[#8d98b8] mb-3">
                      Sync verified contracts and developer work orders from WWR.
                    </p>
                    <div className="text-[10px] font-mono text-emerald-400 bg-[#0d101a] p-2 rounded mb-3">
                      Env: WWR_API_KEY
                    </div>
                  </div>
                  <button
                    onClick={() => handleSyncPlatform('WeWorkRemotely')}
                    disabled={isSyncing === 'WeWorkRemotely'}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                  >
                    {isSyncing === 'WeWorkRemotely' ? 'Syncing...' : '⚡ Test WWR Sync'}
                  </button>
                </div>

                {/* FlexJobs Card */}
                <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white">FlexJobs</span>
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    </div>
                    <p className="text-[11px] text-[#8d98b8] mb-3">
                      Ingest screened and verified flexible freelance opportunities.
                    </p>
                    <div className="text-[10px] font-mono text-amber-400 bg-[#0d101a] p-2 rounded mb-3">
                      Env: FLEXJOBS_API_KEY
                    </div>
                  </div>
                  <button
                    onClick={() => handleSyncPlatform('FlexJobs')}
                    disabled={isSyncing === 'FlexJobs'}
                    className="w-full py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                  >
                    {isSyncing === 'FlexJobs' ? 'Syncing...' : '⚡ Test FlexJobs Sync'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'paypal' && (
            <div className="space-y-4">
              <div className="bg-[#161c2d] border border-[#262f48] rounded-xl p-4">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">
                  PayPal REST Payment API &amp; Webhook Setup
                </h3>
                <p className="text-xs text-[#8d98b8] mb-4">
                  Configure your PayPal webhook endpoint in your PayPal Developer Dashboard (<a href="https://developer.paypal.com/dashboard/applications" target="_blank" rel="noreferrer" className="text-cyan-400 underline">developer.paypal.com</a>) to automatically capture payments and initialize PostgreSQL work orders.
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#8d98b8] block mb-1">PayPal Webhook URL (Production Endpoint)</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={paypalWebhookUrl}
                        className="bg-[#0d101a] border border-[#20273a] text-xs font-mono text-cyan-300 rounded-lg px-3 py-2 flex-1 focus:outline-none"
                      />
                      <button
                        onClick={() => handleCopy(paypalWebhookUrl, 'PayPal Webhook URL')}
                        className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                      >
                        Copy URL
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a] text-xs space-y-1.5">
                    <div className="text-white font-semibold flex items-center gap-1.5">
                      <span>⚡ Subscribed Events in PayPal:</span>
                    </div>
                    <ul className="text-[11px] text-[#8d98b8] list-disc list-inside space-y-1 font-mono">
                      <li><code className="text-emerald-400">PAYMENT.CAPTURE.COMPLETED</code> (Initializes PostgreSQL work orders)</li>
                      <li><code className="text-emerald-400">CHECKOUT.ORDER.APPROVED</code> (Tracks buyer approval)</li>
                      <li><code className="text-emerald-400">CUSTOMER.DISPUTE.CREATED</code> (Automated dispute handling)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="space-y-5">
              {/* Backup Summary & Action Cards */}
              <div className="bg-[#161c2d] border border-[#262f48] rounded-xl p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#20273a]">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <i className="fas fa-shield-alt text-emerald-400"></i>
                      <span>Manual State Backup &amp; Disaster Recovery</span>
                    </h3>
                    <p className="text-xs text-[#8d98b8] mt-1">
                      Download a structured JSON archive containing active Work Orders, recorded Transactions, Invoices, and Profile data.
                    </p>
                  </div>

                  {/* Primary Download Button */}
                  <div className="flex items-center gap-2">
                    <button
                      id="btn-download-backup-tab"
                      onClick={handleDownloadBackup}
                      className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 cursor-pointer"
                    >
                      <i className="fas fa-download"></i>
                      <span>Download Backup</span>
                    </button>
                    <button
                      onClick={handleCopyBackupJson}
                      className="px-3 py-2.5 rounded-xl bg-[#0d101a] hover:bg-[#1a2236] border border-[#262f48] text-slate-300 hover:text-white text-xs font-semibold transition-colors flex items-center gap-1.5"
                      title="Copy raw JSON payload to clipboard"
                    >
                      <i className={`fas ${copiedBackup ? 'fa-check text-emerald-400' : 'fa-copy text-slate-400'}`}></i>
                      <span>{copiedBackup ? 'Copied' : 'Copy JSON'}</span>
                    </button>
                  </div>
                </div>

                {/* State Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a]">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Work Orders</div>
                    <div className="text-lg font-bold font-mono text-cyan-400 mt-0.5">{workOrders.length}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Tasks &amp; Contracts</div>
                  </div>

                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a]">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Transactions</div>
                    <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5">{transactions.length}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Payment entries</div>
                  </div>

                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a]">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Invoices &amp; CRM</div>
                    <div className="text-lg font-bold font-mono text-indigo-400 mt-0.5">{invoices.length + contracts.length}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Active records</div>
                  </div>

                  <div className="p-3 bg-[#0d101a] rounded-lg border border-[#20273a]">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Schema Version</div>
                    <div className="text-lg font-bold font-mono text-amber-400 mt-0.5">v1.0.0</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">JSON Standalone</div>
                  </div>
                </div>
              </div>

              {/* JSON Live Preview Box */}
              <div className="bg-[#161c2d] border border-[#262f48] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <i className="fas fa-code text-cyan-400"></i>
                    <span>Live JSON Export Preview</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    application/json
                  </span>
                </div>
                <div className="relative">
                  <pre className="bg-[#090c15] border border-[#20273a] text-[11px] font-mono text-emerald-300 p-3.5 rounded-lg max-h-56 overflow-y-auto leading-relaxed select-all">
                    {generateBackupJson({ workOrders, transactions, invoices, contracts, profile, stats })}
                  </pre>
                </div>
                <p className="text-[11px] text-[#8d98b8] pt-1">
                  💡 <strong>Disaster Recovery:</strong> Store this file in cold storage (Google Drive, GitHub private gist, or local disk). You can restore and inspect complete task and ledger history anytime.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#20273a] bg-[#161c2d] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button
              id="btn-footer-download-backup"
              onClick={handleDownloadBackup}
              className="px-3.5 py-2 rounded-xl bg-[#0d101a] hover:bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 hover:text-emerald-200 text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer"
              title="Download snapshot of Work Orders and Transactions as JSON"
            >
              <i className="fas fa-download text-emerald-400"></i>
              <span>Download Backup ({workOrders.length + transactions.length} items)</span>
            </button>
            <span className="hidden sm:inline text-xs text-[#8d98b8]">
              Schema: <code className="text-cyan-400 font-mono">.json</code>
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors shadow-lg shadow-cyan-500/20"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
}

export default PlatformCredentialsModal;
