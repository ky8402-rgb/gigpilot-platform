import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  Terminal,
  Radio,
  RefreshCw,
  Search,
  Filter,
  Play,
  Copy,
  Check,
  ArrowDownLeft,
  ArrowUpRight,
  Database,
  ShieldCheck,
  Clock,
  Zap,
  Globe,
  Code2,
  Trash2,
  Download,
  CheckCircle2,
  AlertCircle,
  Layers,
  Sparkles,
  ExternalLink,
  Send,
  Building2,
  CreditCard,
  ChevronRight,
  Maximize2,
  Wifi,
  ListFilter,
  KeyRound,
  Lock
} from 'lucide-react';
import { JsonBeautifier } from './JsonBeautifier';
import { RawPayloadStreamTab } from './RawPayloadStreamTab';
import { WebhookSignatureValidator } from './WebhookSignatureValidator';
import {
  ActivityLogItem,
  fetchActivityLogs,
  clearActivityLogs
} from '../services/api';

interface ActivityLogsViewProps {
  onNavigateToTab?: (tab: string) => void;
}

export const ActivityLogsView: React.FC<ActivityLogsViewProps> = ({ onNavigateToTab }) => {
  // Primary subtab within Activity Logs
  const [activeSubTab, setActiveSubTab] = useState<'stream' | 'explorer' | 'security'>('stream');

  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    webhooks: 0,
    feedSyncs: 0,
    mutations: 0,
    errors: 0,
    avgLatencyMs: 45,
    lastEventTime: new Date().toISOString()
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'payload' | 'diff' | 'headers' | 'curl' | 'security'>('payload');

  // Filter States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Copied indicator
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Fetch logs function
  const loadLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchActivityLogs({
        source: sourceFilter,
        type: typeFilter,
        status: statusFilter,
        search: searchQuery,
        limit: 150
      });
      if (res && res.logs) {
        setLogs(res.logs);
        if (res.stats) setStats(res.stats);
        if (!selectedLogId && res.logs.length > 0) {
          setSelectedLogId(res.logs[0].id);
        }
      }
    } catch (e) {
      console.error('Error fetching logs:', e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Initial load and auto-refresh interval
  useEffect(() => {
    loadLogs();
  }, [sourceFilter, typeFilter, statusFilter, searchQuery]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadLogs(true);
    }, 3500);
    return () => clearInterval(interval);
  }, [autoRefresh, sourceFilter, typeFilter, statusFilter, searchQuery]);

  const selectedLog = useMemo(() => {
    return logs.find(l => l.id === selectedLogId) || logs[0] || null;
  }, [logs, selectedLogId]);

  // Clear Logs
  const handleClear = async () => {
    if (window.confirm('Clear all logged activity events from memory?')) {
      await clearActivityLogs();
      await loadLogs();
      setSelectedLogId(null);
    }
  };

  // Export JSON Bundle
  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `kundanvision-activity-logs-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Generate curl command for selected log
  const curlCommand = useMemo(() => {
    if (!selectedLog) return '';
    const host = window.location.origin || 'http://localhost:3000';
    const bodyStr = selectedLog.requestPayload ? JSON.stringify(selectedLog.requestPayload) : '';
    let cmd = `curl -X ${selectedLog.method} "${host}${selectedLog.endpoint}" \\\n`;
    cmd += `  -H "Content-Type: application/json" \\\n`;
    if (selectedLog.headers?.['x-upwork-event']) {
      cmd += `  -H "x-upwork-event: ${selectedLog.headers['x-upwork-event']}" \\\n`;
    }
    if (selectedLog.headers?.['x-freelancer-event']) {
      cmd += `  -H "x-freelancer-event: ${selectedLog.headers['x-freelancer-event']}" \\\n`;
    }
    if (bodyStr) {
      cmd += `  -d '${bodyStr}'`;
    }
    return cmd;
  }, [selectedLog]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-16">
      {/* Top Telemetry Bar */}
      <div className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-20 px-4 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  Activity Logs & Webhook Debugger
                </h1>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Sync
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Real-time payload inspection, webhook ingestion telemetry, and app state reconciliation.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center flex-wrap gap-2">
            <button
              id="webhook-security-btn"
              onClick={() => setActiveSubTab('security')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                activeSubTab === 'security'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                  : 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50 hover:bg-emerald-900/60'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Webhook Secret & Validator
            </button>

            <button
              id="toggle-autorefresh-btn"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                autoRefresh
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-700/50'
                  : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              {autoRefresh ? 'Streaming (3s)' : 'Stream Paused'}
            </button>

            <button
              id="manual-refresh-btn"
              onClick={() => loadLogs()}
              disabled={loading}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
              title="Refresh Logs"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>

            <button
              id="export-logs-btn"
              onClick={handleExportJSON}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
              title="Export as JSON"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              id="clear-logs-btn"
              onClick={handleClear}
              className="p-1.5 text-rose-400 hover:text-rose-300 bg-rose-950/20 hover:bg-rose-900/40 rounded-lg border border-rose-800/30 transition-colors"
              title="Clear Logs Buffer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Navigation: Raw Payload Stream vs Event Explorer vs Webhook Security */}
      <div className="border-b border-slate-800 bg-slate-950/90 px-4 lg:px-8 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              id="subtab-raw-payload-stream"
              onClick={() => setActiveSubTab('stream')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeSubTab === 'stream'
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-900/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${activeSubTab === 'stream' ? 'animate-pulse text-emerald-300' : 'text-slate-400'}`} />
              <span>Raw Payload Stream</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-200 font-bold">
                LIVE
              </span>
            </button>

            <button
              id="subtab-event-explorer"
              onClick={() => setActiveSubTab('explorer')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeSubTab === 'explorer'
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-900/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Deep Event Explorer & Diffs</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                {logs.length}
              </span>
            </button>

            <button
              id="subtab-webhook-security"
              onClick={() => setActiveSubTab('security')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeSubTab === 'security'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-900/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <ShieldCheck className={`w-3.5 h-3.5 ${activeSubTab === 'security' ? 'text-white' : 'text-emerald-400'}`} />
              <span>Webhook Secret & Validator</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                HMAC
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              RemoteOK & Platforms: <strong className="text-emerald-400 font-semibold">Online (200 OK)</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 pt-6 space-y-6">
        {/* SUBTAB 1: RAW PAYLOAD STREAM */}
        {activeSubTab === 'stream' && (
          <RawPayloadStreamTab onNavigateToTab={onNavigateToTab} />
        )}

        {/* SUBTAB 3: WEBHOOK SECRET & SIGNATURE VALIDATOR */}
        {activeSubTab === 'security' && (
          <div className="space-y-4">
            <WebhookSignatureValidator
              activeSecret=""
              onSecretUpdated={() => loadLogs(true)}
            />
          </div>
        )}

        {/* SUBTAB 2: DEEP EVENT EXPLORER & STATE DIFFS */}
        {activeSubTab === 'explorer' && (
          <>
        {/* KPI Telemetry Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Total Ingested</span>
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-xl font-bold text-white tracking-tight">{stats.total}</div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" /> Ring buffer active
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Webhooks (Upwork/FL)</span>
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-emerald-400 tracking-tight">{stats.webhooks}</div>
            <div className="text-[11px] text-emerald-500/80 mt-1">100% Ingest Rate</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Job Feed Syncs</span>
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="text-xl font-bold text-cyan-400 tracking-tight">{stats.feedSyncs}</div>
            <div className="text-[11px] text-slate-500 mt-1">RemoteOK & Arbeitnow</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>State Mutations</span>
              <Database className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-amber-400 tracking-tight">{stats.mutations}</div>
            <div className="text-[11px] text-slate-500 mt-1">Orders & Auto-Settlements</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 relative overflow-hidden col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Avg Latency</span>
              <Clock className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <div className="text-xl font-bold text-violet-400 tracking-tight">{stats.avgLatencyMs} ms</div>
            <div className="text-[11px] text-slate-500 mt-1">Sub-100ms pipeline</div>
          </div>
        </div>

        {/* Filters & Search Toolbar */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="search-logs-input"
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search raw payloads, endpoint, summary, headers, or state diff..."
                className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Source Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 text-xs">
              <span className="text-slate-500 text-[11px] font-medium mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3" /> Source:
              </span>
              {['ALL', 'Upwork', 'Freelancer', 'RemoteOK', 'Indian Bank', 'PayPal', 'PostgreSQL Backup'].map(src => (
                <button
                  key={src}
                  onClick={() => setSourceFilter(src)}
                  className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap font-medium ${
                    sourceFilter === src
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>
          </div>

          {/* Sub Filters for Type & Status */}
          <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-800/60 text-xs text-slate-400 gap-2">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-[11px]">Type:</span>
              {[
                { label: 'All Types', value: 'ALL' },
                { label: 'Webhooks', value: 'WEBHOOK_INCOMING' },
                { label: 'Feed Syncs', value: 'FEED_SYNC' },
                { label: 'Order State Sync', value: 'ORDER_STATE_SYNC' },
                { label: 'Auto-Transfers', value: 'BANK_AUTO_TRANSFER' },
                { label: 'DB Snapshots', value: 'DATABASE_SNAPSHOT_CREATED' },
                { label: 'Disaster Recovery', value: 'DISASTER_RECOVERY_RESTORED' }
              ].map(t => (
                <button
                  key={t.value}
                  onClick={() => setTypeFilter(t.value)}
                  className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                    typeFilter === t.value
                      ? 'bg-slate-700 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-[11px]">Status:</span>
              {[
                { label: 'All', value: 'ALL' },
                { label: 'Success (200)', value: 'success' },
                { label: 'Errors', value: 'error' }
              ].map(s => (
                <button
                  key={s.value}
                  onClick={() => setStatusFilter(s.value)}
                  className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                    statusFilter === s.value
                      ? 'bg-slate-700 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Master-Detail Split Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Event Stream List (5 cols on lg) */}
          <div className="lg:col-span-5 space-y-2 max-h-[720px] overflow-y-auto pr-1">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1 pb-1">
              <span>Event Stream ({logs.length} events)</span>
              <span className="text-[11px] text-slate-500">Click to inspect payload</span>
            </div>

            {logs.length === 0 ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center text-slate-400 space-y-3">
                <Terminal className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-sm font-medium">No logged events match current filter.</p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSourceFilter('ALL');
                    setTypeFilter('ALL');
                    setStatusFilter('ALL');
                  }}
                  className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded-lg border border-slate-700"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              logs.map(log => {
                const isSelected = log.id === selectedLog?.id;
                const isWebhook = log.type === 'WEBHOOK_INCOMING';
                const isBank = log.type === 'BANK_AUTO_TRANSFER';
                const isError = log.status === 'error' || log.statusCode >= 400;

                return (
                  <div
                    key={log.id}
                    id={`log-row-${log.id}`}
                    onClick={() => setSelectedLogId(log.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                      isSelected
                        ? 'bg-slate-900 border-indigo-500 shadow-md shadow-indigo-950/40 ring-1 ring-indigo-500/50'
                        : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        {/* Method Pill */}
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                            log.method === 'POST'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                              : log.method === 'GET'
                              ? 'bg-sky-950 text-sky-300 border border-sky-800/40'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {log.method}
                        </span>

                        {/* Source Badge */}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            log.source === 'Upwork'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : log.source === 'Freelancer'
                              ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                              : log.source === 'Indian Bank'
                              ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                              : log.source === 'RemoteOK'
                              ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                              : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                          }`}
                        >
                          {log.source}
                        </span>

                        {/* Status Code */}
                        <span
                          className={`text-[10px] font-mono font-medium ${
                            isError ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {log.statusCode}
                        </span>
                      </div>

                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>

                    {/* Summary */}
                    <div className="text-xs text-slate-200 font-medium line-clamp-2 leading-relaxed">
                      {log.summary}
                    </div>

                    {/* Endpoint & State Diff Footer */}
                    <div className="mt-2 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                      <code className="text-slate-400 font-mono text-[10px] truncate max-w-[200px]">
                        {log.endpoint}
                      </code>

                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-slate-500">{log.latencyMs}ms</span>
                        {log.stateDiff && (
                          <span className="px-1.5 py-0.2 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/40 text-[9px] font-medium">
                            State: {log.stateDiff.action}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Column: Deep Inspector Panel (7 cols on lg) */}
          <div className="lg:col-span-7 sticky top-20 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            {selectedLog ? (
              <div>
                {/* Inspector Header */}
                <div className="bg-slate-950/70 border-b border-slate-800 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                            selectedLog.method === 'POST'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-sky-950 text-sky-300 border border-sky-800'
                          }`}
                        >
                          {selectedLog.method}
                        </span>
                        <code className="text-xs font-mono font-bold text-white">{selectedLog.endpoint}</code>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-mono font-semibold ${
                            selectedLog.statusCode < 400
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {selectedLog.statusCode} OK
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{selectedLog.summary}</p>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center">
                      <button
                        id="copy-event-id-btn"
                        onClick={() => handleCopyText(selectedLog.id, selectedLog.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 border border-slate-700"
                        title="Copy Event ID"
                      >
                        {copiedId === selectedLog.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span className="text-[10px]">{selectedLog.id.slice(0, 12)}...</span>
                      </button>
                    </div>
                  </div>

                  {/* Inspector Tabs */}
                  <div className="flex items-center gap-2 mt-4 border-t border-slate-800/80 pt-3 text-xs">
                    {[
                      { id: 'payload', label: 'Request Payload' },
                      { id: 'diff', label: 'Response & App State Diff' },
                      { id: 'headers', label: 'HTTP Headers' },
                      { id: 'curl', label: 'cURL Replay' }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setInspectorTab(tab.id as any)}
                        className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                          inspectorTab === tab.id
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Inspector Body Content */}
                <div className="p-4 bg-slate-950/40">
                  {/* TAB 1: REQUEST PAYLOAD */}
                  {inspectorTab === 'payload' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <Code2 className="w-3.5 h-3.5 text-indigo-400" /> Raw Ingested Webhook / API Payload
                        </span>
                        <button
                          onClick={() => handleCopyText(JSON.stringify(selectedLog.requestPayload, null, 2), 'payload-json')}
                          className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                        >
                          {copiedId === 'payload-json' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          Copy JSON
                        </button>
                      </div>

                      <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-emerald-300/90 overflow-x-auto max-h-[460px] leading-relaxed select-all">
                        {selectedLog.requestPayload
                          ? JSON.stringify(selectedLog.requestPayload, null, 2)
                          : '// No request body payload sent with this request'}
                      </pre>
                    </div>
                  )}

                  {/* TAB 2: RESPONSE & APP STATE DIFF */}
                  {inspectorTab === 'diff' && (
                    <div className="space-y-4">
                      {/* State Diff Card */}
                      {selectedLog.stateDiff && (
                        <div className="bg-indigo-950/30 border border-indigo-800/40 rounded-xl p-3.5 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-indigo-300 flex items-center gap-1.5">
                              <Database className="w-3.5 h-3.5 text-indigo-400" /> App State Mutation Triggered
                            </span>
                            <span className="px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-200 font-mono text-[10px]">
                              {selectedLog.stateDiff.action}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{selectedLog.stateDiff.details}</p>
                          <div className="flex flex-wrap gap-2 text-[11px] font-mono text-indigo-200/90 pt-1">
                            {selectedLog.stateDiff.amountUsd && (
                              <span className="px-2 py-0.5 rounded bg-slate-900/80 border border-slate-800">
                                Payout USD: ${selectedLog.stateDiff.amountUsd.toFixed(2)}
                              </span>
                            )}
                            {selectedLog.stateDiff.amountInr && (
                              <span className="px-2 py-0.5 rounded bg-slate-900/80 border border-slate-800 text-teal-300">
                                Bank INR: ₹{selectedLog.stateDiff.amountInr.toLocaleString('en-IN')}
                              </span>
                            )}
                            {selectedLog.stateDiff.entityId && (
                              <span className="px-2 py-0.5 rounded bg-slate-900/80 border border-slate-800 text-slate-400">
                                Entity ID: {selectedLog.stateDiff.entityId}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Server Response Payload */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" /> Server JSON Response
                          </span>
                          <button
                            onClick={() => handleCopyText(JSON.stringify(selectedLog.responsePayload, null, 2), 'response-json')}
                            className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 font-medium"
                          >
                            {copiedId === 'response-json' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            Copy Response
                          </button>
                        </div>

                        <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-cyan-300/90 overflow-x-auto max-h-[350px] leading-relaxed select-all">
                          {selectedLog.responsePayload
                            ? JSON.stringify(selectedLog.responsePayload, null, 2)
                            : '// No JSON response payload'}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: HTTP HEADERS & METADATA */}
                  {inspectorTab === 'headers' && (
                    <div className="space-y-3">
                      <span className="text-xs font-semibold text-slate-300">HTTP Headers & Transport Context</span>
                      <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                        <table className="w-full text-left text-xs font-mono">
                          <thead>
                            <tr className="bg-slate-900/90 border-b border-slate-800 text-slate-400">
                              <th className="p-2.5 font-medium">Header Name</th>
                              <th className="p-2.5 font-medium">Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {selectedLog.headers && Object.keys(selectedLog.headers).length > 0 ? (
                              Object.entries(selectedLog.headers).map(([key, val]) => (
                                <tr key={key} className="hover:bg-slate-900/40">
                                  <td className="p-2.5 text-indigo-400 font-medium">{key}</td>
                                  <td className="p-2.5 text-slate-300 break-all">{val}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={2} className="p-3 text-center text-slate-500">
                                  No custom headers recorded for this event.
                                </td>
                              </tr>
                            )}
                            <tr className="hover:bg-slate-900/40">
                              <td className="p-2.5 text-slate-500 font-medium">timestamp</td>
                              <td className="p-2.5 text-slate-400">{selectedLog.timestamp}</td>
                            </tr>
                            <tr className="hover:bg-slate-900/40">
                              <td className="p-2.5 text-slate-500 font-medium">latency</td>
                              <td className="p-2.5 text-slate-400">{selectedLog.latencyMs} milliseconds</td>
                            </tr>
                            <tr className="hover:bg-slate-900/40">
                              <td className="p-2.5 text-slate-500 font-medium">tags</td>
                              <td className="p-2.5 text-indigo-300">{selectedLog.tags.join(', ')}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* TAB 4: CURL REPRODUCTION */}
                  {inspectorTab === 'curl' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-violet-400" /> CLI Terminal / Postman Replay
                        </span>
                        <button
                          onClick={() => handleCopyText(curlCommand, 'curl-cmd')}
                          className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 font-medium"
                        >
                          {copiedId === 'curl-cmd' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          Copy cURL
                        </button>
                      </div>

                      <pre className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-violet-300/90 overflow-x-auto max-h-[300px] leading-relaxed select-all">
                        {curlCommand}
                      </pre>

                      <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-400 space-y-1">
                        <p className="font-semibold text-slate-300">💡 Testing with external Webhook Dispatchers:</p>
                        <p>You can paste this cURL directly into your terminal or configure it in Upwork/Freelancer Webhook developer dashboards to send live real-time webhooks to this endpoint.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-slate-500 space-y-2">
                <Terminal className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-sm">Select an event from the left stream to inspect full payload</p>
              </div>
            )}
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
};
export default ActivityLogsView;
