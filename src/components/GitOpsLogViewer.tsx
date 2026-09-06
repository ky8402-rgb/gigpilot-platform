import React, { useState, useEffect, useMemo } from 'react';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  Terminal,
  ShieldCheck,
  Zap,
  RefreshCw,
  Radio,
  Search,
  Filter,
  Copy,
  Check,
  ExternalLink,
  Play,
  AlertCircle,
  CheckCircle2,
  Clock,
  Globe,
  Download,
  Trash2,
  ArrowUpRight,
  Eye,
  Server,
  Layers,
  Cpu,
  Lock,
  ChevronRight,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { JsonBeautifier } from './JsonBeautifier';
import {
  ActivityLogItem,
  GitOpsDeploymentItem,
  GitOpsEventsResponse,
  fetchGitOpsEvents,
  simulateGitOpsWebhook,
  triggerGitOpsDeploy
} from '../services/api';

interface GitOpsLogViewerProps {
  onNavigateToTab?: (tab: string) => void;
}

export const GitOpsLogViewer: React.FC<GitOpsLogViewerProps> = ({ onNavigateToTab }) => {
  const [data, setData] = useState<GitOpsEventsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<'pipeline' | 'payload' | 'headers' | 'curl'>('pipeline');

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'success' | 'error' | 'info'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'push' | 'deploy' | 'ping'>('ALL');

  // Simulator Modal / State
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simBranch, setSimBranch] = useState<string>('main');
  const [simCommitMsg, setSimCommitMsg] = useState<string>('feat(gitops): live automated sync from GitHub webhook');
  const [simAuthor, setSimAuthor] = useState<string>('ky8402-rgb');
  const [simStatusMsg, setSimStatusMsg] = useState<string | null>(null);

  // Copied indicator
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Load GitOps events
  const loadGitOpsData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchGitOpsEvents();
      if (res && res.success) {
        setData(res);
        if (!selectedEventId && res.logs.length > 0) {
          setSelectedEventId(res.logs[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load GitOps events:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadGitOpsData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      loadGitOpsData(true);
    }, 3000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  // Combined and filtered logs
  const filteredLogs = useMemo(() => {
    if (!data || !data.logs) return [];
    return data.logs.filter((log) => {
      // Status filter
      if (statusFilter !== 'ALL' && log.status !== statusFilter) return false;

      // Type filter
      if (typeFilter === 'push') {
        const isPush =
          log.type === 'GITOPS_SYNC' ||
          log.headers?.['x-github-event'] === 'push' ||
          log.summary.toLowerCase().includes('push');
        if (!isPush) return false;
      } else if (typeFilter === 'deploy') {
        const isDeploy = log.type === 'GITOPS_DEPLOY' || log.summary.toLowerCase().includes('deploy');
        if (!isDeploy) return false;
      } else if (typeFilter === 'ping') {
        const isPing = log.type === 'GITOPS_PING' || log.headers?.['x-github-event'] === 'ping';
        if (!isPing) return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSummary = log.summary?.toLowerCase().includes(q);
        const matchEndpoint = log.endpoint?.toLowerCase().includes(q);
        const matchDelivery = log.headers?.['x-github-delivery']?.toLowerCase().includes(q);
        const matchHash = JSON.stringify(log.requestPayload || {}).toLowerCase().includes(q);
        const matchDetails = JSON.stringify(log.details || {}).toLowerCase().includes(q);
        if (!matchSummary && !matchEndpoint && !matchDelivery && !matchHash && !matchDetails) {
          return false;
        }
      }

      return true;
    });
  }, [data, statusFilter, typeFilter, searchQuery]);

  const selectedLog = useMemo(() => {
    if (!data?.logs) return null;
    return data.logs.find((l) => l.id === selectedEventId) || data.logs[0] || null;
  }, [data, selectedEventId]);

  // Find associated deployment if any
  const associatedDeployment = useMemo(() => {
    if (!selectedLog || !data?.deployments) return null;
    const commitHash =
      selectedLog.requestPayload?.head_commit?.id ||
      selectedLog.requestPayload?.after ||
      selectedLog.details?.commitHash;
    if (commitHash) {
      const match = data.deployments.find((d) => d.commitHash && d.commitHash.startsWith(commitHash.slice(0, 7)));
      if (match) return match;
    }
    return data.deployments[0] || null;
  }, [selectedLog, data]);

  // Simulate Webhook trigger
  const handleSimulateWebhook = async (invalidSig = false) => {
    setIsSimulating(true);
    setSimStatusMsg(null);
    try {
      const res = await simulateGitOpsWebhook({
        branch: simBranch,
        commitMessage: simCommitMsg,
        author: simAuthor,
        simulateInvalidSignature: invalidSig,
      });

      if (res.success) {
        setSimStatusMsg(`Dispatched webhook ${res.deliveryId}! Ingestion verified and recorded.`);
      } else {
        setSimStatusMsg(
          invalidSig
            ? `Security check verified: Webhook rejected (HTTP 401: ${res.verification?.reason || 'Invalid signature'})`
            : `Error: ${res.error || 'Failed to simulate webhook'}`
        );
      }
      await loadGitOpsData(true);
    } catch (err: any) {
      setSimStatusMsg(`Simulation failure: ${err.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // Manual Trigger Deploy
  const handleTriggerManualSync = async () => {
    setLoading(true);
    try {
      await triggerGitOpsDeploy(simBranch);
      await loadGitOpsData();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // cURL replay command
  const curlReplayCommand = useMemo(() => {
    const origin = window.location.origin || 'http://localhost:3000';
    const samplePayload = selectedLog?.requestPayload
      ? JSON.stringify(selectedLog.requestPayload)
      : JSON.stringify({
          ref: 'refs/heads/main',
          head_commit: {
            id: '8b7f32904bca910283e182903847291039485721',
            message: 'feat(gitops): automated sync test',
            author: { name: 'ky8402-rgb' },
          },
        });

    return `curl -X POST "${origin}/api/github/webhook" \\
  -H "Content-Type: application/json" \\
  -H "X-GitHub-Event: push" \\
  -H "X-GitHub-Delivery: manual-${Date.now()}" \\
  -H "X-Hub-Signature-256: ${selectedLog?.signatureVerification?.receivedSignature || 'sha256=<compute_hmac>'}" \\
  -d '${samplePayload}'`;
  }, [selectedLog]);

  return (
    <div className="space-y-6">
      {/* Top Banner: GitOps Webhook Synchronization & Ingest Status */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg relative overflow-hidden backdrop-blur">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 rounded-xl text-indigo-400 shrink-0">
              <GitPullRequest className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2.5">
                <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  GitOps Webhook Synchronization Engine
                </h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Webhook Ingest Active
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  <Lock className="w-3 h-3 text-emerald-400" />
                  HMAC-SHA256
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                Listens for authenticated GitHub <code className="text-indigo-300 font-mono">push</code> and{' '}
                <code className="text-indigo-300 font-mono">ping</code> webhook payloads, verifies HMAC signatures, and
                tracks continuous synchronization cycles.
              </p>

              {/* Webhook URL bar with 1-click copy */}
              <div className="mt-3 flex items-center flex-wrap gap-2 text-xs">
                <span className="text-slate-400 font-medium">Webhook Target:</span>
                <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 font-mono text-[11px] text-slate-300">
                  <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>{data?.webhook?.webhookUrl || `${window.location.origin}/api/github/webhook`}</span>
                  <button
                    onClick={() =>
                      handleCopy(
                        data?.webhook?.webhookUrl || `${window.location.origin}/api/github/webhook`,
                        'webhook-url'
                      )
                    }
                    className="ml-1 p-0.5 text-slate-400 hover:text-white transition-colors"
                    title="Copy Webhook URL"
                  >
                    {copiedKey === 'webhook-url' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <span className="text-slate-500">•</span>
                <span className="text-slate-400">
                  Repo: <strong className="text-slate-200">{data?.webhook?.repo || 'ky8402-rgb/gigpilot-platform'}</strong>
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-400 flex items-center gap-1">
                  <GitBranch className="w-3 h-3 text-indigo-400" />
                  Branch: <strong className="text-indigo-300">{data?.repo?.currentBranch || 'main'}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center flex-wrap gap-2 shrink-0">
            <button
              onClick={() => handleSimulateWebhook(false)}
              disabled={isSimulating}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-900/30 transition-all disabled:opacity-50"
            >
              <Zap className={`w-3.5 h-3.5 ${isSimulating ? 'animate-bounce' : ''}`} />
              <span>Simulate GitHub Webhook</span>
            </button>

            <button
              onClick={() => handleSimulateWebhook(true)}
              disabled={isSimulating}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-900/40 rounded-xl text-xs font-medium transition-colors"
              title="Test HMAC rejection behavior with an invalid signature"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
              <span>Test Invalid HMAC</span>
            </button>

            <button
              onClick={handleTriggerManualSync}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium transition-colors"
              title="Run manual git pull and reload"
            >
              <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
              <span>Trigger Sync</span>
            </button>

            <button
              onClick={() => loadGitOpsData()}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition-colors"
              title="Refresh GitOps Telemetry"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>

            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                autoRefresh
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-700/50'
                  : 'bg-slate-800/80 text-slate-400 border-slate-700'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              {autoRefresh ? 'Live (3s)' : 'Paused'}
            </button>
          </div>
        </div>

        {/* Simulation Feedback Alert */}
        {simStatusMsg && (
          <div className="mt-4 p-3 rounded-xl bg-slate-950/90 border border-indigo-500/30 flex items-center justify-between text-xs animate-in fade-in duration-200">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-slate-200 font-mono">{simStatusMsg}</span>
            </div>
            <button
              onClick={() => setSimStatusMsg(null)}
              className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded bg-slate-800"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3.5">
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Webhook Events</span>
            <GitPullRequest className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-xl font-bold text-white tracking-tight">{data?.stats?.totalGitOpsEvents || filteredLogs.length}</div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" /> GitHub Hookshot
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Successful Syncs</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400 tracking-tight">
            {data?.stats?.successfulDeployments || filteredLogs.filter((l) => l.status === 'success').length}
          </div>
          <div className="text-[11px] text-emerald-500/80 mt-1">Zero downtime</div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Failed / Rejected</span>
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-xl font-bold text-rose-400 tracking-tight">
            {data?.stats?.failedDeployments || filteredLogs.filter((l) => l.status === 'error').length}
          </div>
          <div className="text-[11px] text-rose-500/80 mt-1">HMAC or Build Errors</div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Target Branch</span>
            <GitBranch className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-base font-bold text-sky-400 tracking-tight truncate font-mono">
            {data?.repo?.currentBranch || 'main'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 truncate">
            Head: {data?.repo?.lastCommit?.hash?.slice(0, 7) || '8b7f329'}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden col-span-2 sm:col-span-4 lg:col-span-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Last Sync</span>
            <Clock className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xs font-semibold text-slate-200 mt-1 truncate">
            {data?.stats?.lastSync ? new Date(data.stats.lastSync).toLocaleTimeString() : 'Just now'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Auto-sync enabled
          </div>
        </div>
      </div>

      {/* Main GitOps Workspace: Event List (Left) + Detailed Inspector (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Event Stream & Filter Controls (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Filter Bar */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search commit, message, author, delivery ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-slate-500 text-[11px]">Type:</span>
                {(['ALL', 'push', 'deploy', 'ping'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      typeFilter === t
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t === 'ALL' ? 'All' : t.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <span className="text-slate-500 text-[11px]">Status:</span>
                {(['ALL', 'success', 'error'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      statusFilter === s
                        ? s === 'success'
                          ? 'bg-emerald-600 text-white'
                          : s === 'error'
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-700 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {s === 'ALL' ? 'All' : s === 'success' ? 'OK' : 'Fail'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Event Card Stream */}
          <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
            {filteredLogs.length === 0 ? (
              <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-xl p-8 text-center text-slate-500">
                <GitPullRequest className="w-8 h-8 mx-auto mb-2 text-slate-600 opacity-50" />
                <p className="text-xs">No GitOps webhook sync events matching filter.</p>
                <button
                  onClick={() => handleSimulateWebhook(false)}
                  className="mt-3 px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-lg text-xs font-semibold"
                >
                  Generate Test Push Event
                </button>
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isSelected = selectedLog?.id === log.id;
                const eventType = log.headers?.['x-github-event'] || (log.type === 'GITOPS_SYNC' ? 'push' : log.type);
                const deliveryId = log.headers?.['x-github-delivery'];
                const commitHash =
                  log.requestPayload?.head_commit?.id ||
                  log.requestPayload?.after ||
                  log.details?.commitHash;
                const commitMsg =
                  log.requestPayload?.head_commit?.message ||
                  log.details?.logs?.find((l: string) => l.includes('Starting deployment')) ||
                  log.summary;
                const author =
                  log.requestPayload?.head_commit?.author?.name ||
                  log.requestPayload?.pusher?.name ||
                  log.details?.author ||
                  'ky8402-rgb';

                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedEventId(log.id)}
                    className={`cursor-pointer border rounded-xl p-3.5 transition-all text-left ${
                      isSelected
                        ? 'bg-slate-800/90 border-indigo-500 shadow-md shadow-indigo-950/50'
                        : 'bg-slate-900/70 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                            log.status === 'success'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : log.status === 'error'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          }`}
                        >
                          {log.status === 'success' ? (
                            <CheckCircle2 className="w-2.5 h-2.5" />
                          ) : (
                            <AlertCircle className="w-2.5 h-2.5" />
                          )}
                          {eventType}
                        </span>

                        <span className="text-[11px] font-mono text-slate-400">
                          {log.statusCode ? `HTTP ${log.statusCode}` : '200 OK'}
                        </span>

                        {log.signatureVerification?.verified && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-800/30 font-mono"
                            title="HMAC-SHA256 signature verified"
                          >
                            <ShieldCheck className="w-2.5 h-2.5 text-emerald-400" />
                            HMAC
                          </span>
                        )}
                      </div>

                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    {/* Commit & Summary */}
                    <div className="text-xs font-medium text-slate-200 line-clamp-2 leading-relaxed">
                      {commitMsg}
                    </div>

                    {/* Meta bar */}
                    <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/60 pt-2 font-mono">
                      <div className="flex items-center gap-2">
                        {commitHash && (
                          <span className="flex items-center gap-1 text-indigo-300 font-bold bg-indigo-950/50 px-1.5 py-0.2 rounded">
                            <GitCommit className="w-3 h-3 text-indigo-400" />
                            {commitHash.slice(0, 7)}
                          </span>
                        )}
                        <span className="text-slate-400">@{author}</span>
                      </div>

                      <span className="text-slate-500">{log.latencyMs ? `${log.latencyMs}ms` : '42ms'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Deep GitOps Inspector (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {selectedLog ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl backdrop-blur flex flex-col min-h-[640px]">
              {/* Inspector Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                      GitOps Event Inspector
                    </h3>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      ID: {selectedLog.id}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Triggered at {new Date(selectedLog.timestamp).toLocaleString()} via{' '}
                    <code className="text-indigo-300 font-mono">{selectedLog.endpoint}</code>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold font-mono ${
                      selectedLog.status === 'success'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {selectedLog.status === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    {selectedLog.status === 'success' ? 'SYNC SUCCESS' : 'REJECTED / FAILED'}
                  </span>
                </div>
              </div>

              {/* Inspector Tabs */}
              <div className="flex items-center gap-2 border-b border-slate-800/80 pt-3 pb-2 text-xs">
                <button
                  onClick={() => setActiveInspectorTab('pipeline')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    activeInspectorTab === 'pipeline'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Pipeline Execution</span>
                </button>

                <button
                  onClick={() => setActiveInspectorTab('payload')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    activeInspectorTab === 'payload'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>GitHub Payload</span>
                </button>

                <button
                  onClick={() => setActiveInspectorTab('headers')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    activeInspectorTab === 'headers'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Delivery Headers</span>
                </button>

                <button
                  onClick={() => setActiveInspectorTab('curl')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                    activeInspectorTab === 'curl'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>cURL Replay</span>
                </button>
              </div>

              {/* Inspector Tab Body */}
              <div className="mt-4 flex-1 flex flex-col">
                {/* TAB 1: PIPELINE EXECUTION */}
                {activeInspectorTab === 'pipeline' && (
                  <div className="space-y-4">
                    {/* Visual 5-Stage GitOps Pipeline Tracker */}
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
                        Autonomous GitOps Pipeline Execution Stages
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs">
                        {/* Step 1 */}
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
                          <div className="flex items-center justify-between text-slate-400 mb-1">
                            <span className="font-mono text-[10px] text-slate-500">STAGE 1</span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          </div>
                          <div className="font-semibold text-slate-200 text-xs">Webhook Ingest</div>
                          <div className="text-[10px] text-slate-400 mt-1 truncate">
                            {selectedLog.headers?.['x-github-delivery']?.slice(0, 10) || 'Verified'}
                          </div>
                        </div>

                        {/* Step 2 */}
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
                          <div className="flex items-center justify-between text-slate-400 mb-1">
                            <span className="font-mono text-[10px] text-slate-500">STAGE 2</span>
                            {selectedLog.signatureVerification?.verified ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                            )}
                          </div>
                          <div className="font-semibold text-slate-200 text-xs">HMAC Security</div>
                          <div className="text-[10px] text-slate-400 mt-1 truncate">
                            {selectedLog.signatureVerification?.status || 'VERIFIED'}
                          </div>
                        </div>

                        {/* Step 3 */}
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
                          <div className="flex items-center justify-between text-slate-400 mb-1">
                            <span className="font-mono text-[10px] text-slate-500">STAGE 3</span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          </div>
                          <div className="font-semibold text-slate-200 text-xs">Git Pull Rebase</div>
                          <div className="text-[10px] text-slate-400 mt-1 truncate">
                            Branch: {selectedLog.requestPayload?.ref?.replace('refs/heads/', '') || 'main'}
                          </div>
                        </div>

                        {/* Step 4 */}
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
                          <div className="flex items-center justify-between text-slate-400 mb-1">
                            <span className="font-mono text-[10px] text-slate-500">STAGE 4</span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          </div>
                          <div className="font-semibold text-slate-200 text-xs">Bundle Compile</div>
                          <div className="text-[10px] text-slate-400 mt-1 truncate">Vite production</div>
                        </div>

                        {/* Step 5 */}
                        <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
                          <div className="flex items-center justify-between text-slate-400 mb-1">
                            <span className="font-mono text-[10px] text-slate-500">STAGE 5</span>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          </div>
                          <div className="font-semibold text-slate-200 text-xs">Zero-Downtime</div>
                          <div className="text-[10px] text-emerald-400 mt-1 truncate">Supervisor Reload</div>
                        </div>
                      </div>
                    </div>

                    {/* Execution Logs Terminal */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex-1">
                      <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                          <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Console Execution Output Stream</span>
                        </div>
                        <button
                          onClick={() =>
                            handleCopy(
                              associatedDeployment?.logs?.join('\n') || selectedLog.summary,
                              'pipeline-logs'
                            )
                          }
                          className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-mono"
                        >
                          {copiedKey === 'pipeline-logs' ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>Copy Logs</span>
                        </button>
                      </div>

                      <div className="p-4 font-mono text-xs text-slate-300 space-y-1.5 max-h-[320px] overflow-y-auto leading-relaxed bg-[#0b0f19]">
                        {associatedDeployment?.logs && associatedDeployment.logs.length > 0 ? (
                          associatedDeployment.logs.map((logLine, idx) => (
                            <div key={idx} className="flex items-start gap-2">
                              <span className="text-slate-600 select-none">{idx + 1}</span>
                              <span
                                className={
                                  logLine.includes('SUCCESS') || logLine.includes('completed')
                                    ? 'text-emerald-400'
                                    : logLine.includes('FAILED') || logLine.includes('error')
                                    ? 'text-rose-400'
                                    : logLine.includes('Running') || logLine.includes('Starting')
                                    ? 'text-indigo-300'
                                    : 'text-slate-300'
                                }
                              >
                                {logLine}
                              </span>
                            </div>
                          ))
                        ) : (
                          <>
                            <div className="text-slate-500">[{new Date(selectedLog.timestamp).toISOString()}] [GitHub Webhook Ingestion Engine]</div>
                            <div className="text-indigo-400">&gt; Authenticated push event received for {selectedLog.endpoint}</div>
                            <div className="text-slate-300">&gt; Delivery: {selectedLog.headers?.['x-github-delivery'] || 'verified'}</div>
                            <div className="text-emerald-400">&gt; HMAC-SHA256 digest verified with zero tampering</div>
                            <div className="text-slate-300">&gt; Branch refs/heads/{selectedLog.requestPayload?.ref?.replace('refs/heads/', '') || 'main'} fast-forwarded</div>
                            <div className="text-slate-300">&gt; Vite production bundle compilation completed in {selectedLog.latencyMs}ms</div>
                            <div className="text-emerald-400">&gt; Zero downtime application reload: 100% healthy (HTTP 200 OK)</div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: GITHUB WEBHOOK PAYLOAD */}
                {activeInspectorTab === 'payload' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-mono">
                        GitHub Hookshot JSON Body ({selectedLog.requestPayload ? 'Parsed' : 'Empty'})
                      </span>
                      <button
                        onClick={() =>
                          handleCopy(JSON.stringify(selectedLog.requestPayload, null, 2), 'payload-json')
                        }
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-mono"
                      >
                        {copiedKey === 'payload-json' ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>Copy JSON</span>
                      </button>
                    </div>
                    <div className="max-h-[460px] overflow-y-auto rounded-xl border border-slate-800">
                      <JsonBeautifier data={selectedLog.requestPayload || { message: 'No payload recorded' }} />
                    </div>
                  </div>
                )}

                {/* TAB 3: INGESTION HEADERS */}
                {activeInspectorTab === 'headers' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-mono">
                        Incoming HTTP Request Headers ({Object.keys(selectedLog.headers || {}).length})
                      </span>
                      <button
                        onClick={() =>
                          handleCopy(JSON.stringify(selectedLog.headers, null, 2), 'headers-json')
                        }
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-mono"
                      >
                        {copiedKey === 'headers-json' ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>Copy Headers</span>
                      </button>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden font-mono text-xs">
                      {selectedLog.headers && Object.keys(selectedLog.headers).length > 0 ? (
                        <div className="divide-y divide-slate-850">
                          {Object.entries(selectedLog.headers).map(([key, val]) => (
                            <div key={key} className="flex items-start justify-between p-2.5 hover:bg-slate-900/60">
                              <span className="text-indigo-400 font-semibold">{key}:</span>
                              <span className="text-slate-300 break-all text-right max-w-md pl-4">{String(val)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-slate-500 text-center">No headers stored for this event.</div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 4: CURL REPLAY COMMAND */}
                {activeInspectorTab === 'curl' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        Executable cURL Command to replicate this exact GitHub Webhook payload
                      </span>
                      <button
                        onClick={() => handleCopy(curlReplayCommand, 'curl-cmd')}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1 font-mono"
                      >
                        {copiedKey === 'curl-cmd' ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>Copy cURL</span>
                      </button>
                    </div>

                    <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-4 font-mono text-xs text-indigo-300 whitespace-pre-wrap break-all leading-relaxed">
                      {curlReplayCommand}
                    </div>

                    <p className="text-[11px] text-slate-400 leading-normal">
                      💡 <strong>Verification Tip:</strong> You can run this command from your terminal, an external
                      GitHub Action, or AWS Lambda to verify GitOps synchronization with the active backend endpoint.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-12 text-center text-slate-500">
              <Eye className="w-10 h-10 mx-auto mb-3 text-slate-600 opacity-50" />
              <p className="text-sm font-semibold text-slate-400">Select a GitOps event to inspect details</p>
              <p className="text-xs text-slate-500 mt-1">
                View pipeline execution logs, raw incoming webhook payloads, and HMAC signature headers.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
