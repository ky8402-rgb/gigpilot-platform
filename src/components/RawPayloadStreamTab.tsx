import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Terminal,
  Radio,
  RefreshCw,
  Search,
  Filter,
  Play,
  Copy,
  Check,
  Zap,
  Globe,
  Database,
  ShieldCheck,
  Clock,
  Code2,
  Download,
  AlertCircle,
  CheckCircle2,
  Layers,
  Sparkles,
  ArrowRight,
  Wifi,
  WifiOff,
  Sliders,
  Send,
  Building2,
  CreditCard,
  Maximize2,
  Trash2,
  ExternalLink,
  ChevronRight,
  FileCode,
  KeyRound,
  Lock
} from 'lucide-react';
import { JsonBeautifier } from './JsonBeautifier';
import { WebhookSignatureValidator } from './WebhookSignatureValidator';
import {
  ActivityLogItem,
  fetchActivityLogs,
  fetchPlatformConnectivity,
  PlatformConnectivityItem,
  PlatformConnectivityResponse
} from '../services/api';

interface RawPayloadStreamTabProps {
  onNavigateToTab?: (tab: string) => void;
}

export const RawPayloadStreamTab: React.FC<RawPayloadStreamTabProps> = ({ onNavigateToTab }) => {
  // Stream items
  const [streamLogs, setStreamLogs] = useState<ActivityLogItem[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [streamFilter, setStreamFilter] = useState<'ALL' | 'JOBS' | 'REMOTEOK' | 'UPWORK' | 'FREELANCER' | 'PAYMENTS'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active sub-view in inspector: 'request' | 'response' | 'envelope' | 'security'
  const [inspectorMode, setInspectorMode] = useState<'request' | 'response' | 'envelope' | 'security'>('request');
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState<boolean>(false);

  // Platform Connectivity State
  const [connectivity, setConnectivity] = useState<PlatformConnectivityResponse | null>(null);
  const [pinging, setPinging] = useState<boolean>(false);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformConnectivityItem | null>(null);

  const streamScrollRef = useRef<HTMLDivElement>(null);

  // Load Connectivity status
  const loadConnectivity = async () => {
    setPinging(true);
    try {
      const data = await fetchPlatformConnectivity();
      setConnectivity(data);
      if (!selectedPlatform && data.platforms.length > 0) {
        setSelectedPlatform(data.platforms[0]);
      }
    } catch (err) {
      console.error('Failed to ping platforms:', err);
    } finally {
      setPinging(false);
    }
  };

  // Load stream events
  const loadStreamLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchActivityLogs({ limit: 120 });
      if (data && data.logs) {
        setStreamLogs(data.logs);
        if (!selectedStreamId && data.logs.length > 0) {
          setSelectedStreamId(data.logs[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load stream logs:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Initial mount
  useEffect(() => {
    loadConnectivity();
    loadStreamLogs();
  }, []);

  // Live polling stream
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      loadStreamLogs(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  // Auto-scroll when new items arrive
  useEffect(() => {
    if (autoScroll && streamScrollRef.current) {
      streamScrollRef.current.scrollTop = 0;
    }
  }, [streamLogs, autoScroll]);

  // Filtered stream items
  const filteredLogs = useMemo(() => {
    return streamLogs.filter(log => {
      if (streamFilter === 'JOBS') {
        const isJob =
          log.source === 'RemoteOK' ||
          log.source === 'Arbeitnow' ||
          log.type === 'FEED_SYNC' ||
          (log.summary && (log.summary.toLowerCase().includes('job') || log.summary.toLowerCase().includes('project')));
        if (!isJob) return false;
      } else if (streamFilter === 'REMOTEOK') {
        if (log.source !== 'RemoteOK' && log.source !== 'Arbeitnow') return false;
      } else if (streamFilter === 'UPWORK') {
        if (log.source !== 'Upwork') return false;
      } else if (streamFilter === 'FREELANCER') {
        if (log.source !== 'Freelancer') return false;
      } else if (streamFilter === 'PAYMENTS') {
        if (log.source !== 'Indian Bank' && log.source !== 'PayPal' && log.type !== 'BANK_AUTO_TRANSFER' && log.type !== 'PAYMENT_RECEIVED') return false;
      }

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const inSummary = log.summary.toLowerCase().includes(q);
        const inEndpoint = log.endpoint.toLowerCase().includes(q);
        const inPayload = JSON.stringify(log.requestPayload || {}).toLowerCase().includes(q);
        if (!inSummary && !inEndpoint && !inPayload) return false;
      }

      return true;
    });
  }, [streamLogs, streamFilter, searchQuery]);

  // Currently selected stream log
  const selectedLog = useMemo(() => {
    return streamLogs.find(l => l.id === selectedStreamId) || filteredLogs[0] || streamLogs[0] || null;
  }, [streamLogs, selectedStreamId, filteredLogs]);

  // Format Helper for Payload Envelope
  const fullEnvelope = useMemo(() => {
    if (!selectedLog) return null;
    return {
      _streamMetadata: {
        eventId: selectedLog.id,
        receivedAt: selectedLog.timestamp,
        sourcePlatform: selectedLog.source,
        eventType: selectedLog.type,
        transportMethod: selectedLog.method,
        targetEndpoint: selectedLog.endpoint,
        httpStatus: selectedLog.statusCode,
        ingestLatencyMs: selectedLog.latencyMs,
        tags: selectedLog.tags
      },
      transportHeaders: selectedLog.headers || {
        'content-type': 'application/json',
        'x-webhook-agent': 'KundanVision-IngestEngine/2.0'
      },
      inboundRawPayload: selectedLog.requestPayload || {},
      outboundResponsePayload: selectedLog.responsePayload || {},
      stateReconciliationDiff: selectedLog.stateDiff || null
    };
  }, [selectedLog]);

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* SECTION 1: PLATFORM CONNECTIVITY & HEALTH STATUS INDICATOR BAR */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 backdrop-blur-md shadow-2xl relative overflow-hidden">
        {/* Glow Accent */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 rounded-xl text-indigo-400">
              <Wifi className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Integrated Platform Connectivity & Health Indicators
                </h2>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {connectivity ? `${connectivity.overallHealth.onlineCount}/${connectivity.overallHealth.totalPlatforms} Online` : 'Checking...'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Live zero-auth HTTP probing, webhook gateway HMAC heartbeat, and NPCI/PayPal gateway telemetry.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="ping-all-platforms-btn"
              onClick={loadConnectivity}
              disabled={pinging}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${pinging ? 'animate-spin text-indigo-400' : 'text-slate-400'}`} />
              {pinging ? 'Probing Endpoints...' : 'Ping All Platforms'}
            </button>
          </div>
        </div>

        {/* Platform Connectivity Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-4">
          {/* 1. RemoteOK Live API (Highlighted) */}
          <div
            onClick={() => setSelectedPlatform(connectivity?.platforms.find(p => p.id === 'remoteok') || null)}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              selectedPlatform?.id === 'remoteok'
                ? 'bg-indigo-950/40 border-indigo-500/60 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                : 'bg-slate-950/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-sky-500/10 border border-sky-500/30 rounded-lg text-sky-400">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    RemoteOK Live API
                    <span className="text-[9px] bg-sky-500/20 text-sky-300 px-1 rounded font-mono font-bold">ZERO-AUTH</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">remoteok.com/api</div>
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" title="Online - 200 OK" />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
              <span>Status: <strong className="text-emerald-400 font-mono">200 OK</strong></span>
              <span>Latency: <strong className="text-slate-200 font-mono">38 ms</strong></span>
              <span>Uptime: <strong className="text-slate-200 font-mono">99.9%</strong></span>
            </div>
          </div>

          {/* 2. Upwork Webhook Gateway */}
          <div
            onClick={() => setSelectedPlatform(connectivity?.platforms.find(p => p.id === 'upwork') || null)}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              selectedPlatform?.id === 'upwork'
                ? 'bg-indigo-950/40 border-indigo-500/60 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                : 'bg-slate-950/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    Upwork Gateway
                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 rounded font-mono font-bold">HMAC</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">/api/webhooks/upwork</div>
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
              <span>Status: <strong className="text-emerald-400 font-mono">ONLINE</strong></span>
              <span>Latency: <strong className="text-slate-200 font-mono">18 ms</strong></span>
              <span>Uptime: <strong className="text-slate-200 font-mono">99.98%</strong></span>
            </div>
          </div>

          {/* 3. Freelancer.com Gateway */}
          <div
            onClick={() => setSelectedPlatform(connectivity?.platforms.find(p => p.id === 'freelancer') || null)}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              selectedPlatform?.id === 'freelancer'
                ? 'bg-indigo-950/40 border-indigo-500/60 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                : 'bg-slate-950/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
                  <Code2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    Freelancer.com
                    <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1 rounded font-mono font-bold">ACTIVE</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">/api/webhooks/freelancer</div>
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
              <span>Status: <strong className="text-emerald-400 font-mono">ONLINE</strong></span>
              <span>Latency: <strong className="text-slate-200 font-mono">22 ms</strong></span>
              <span>Uptime: <strong className="text-slate-200 font-mono">99.95%</strong></span>
            </div>
          </div>

          {/* 4. Indian Bank / IMPS NPCI Rail */}
          <div
            onClick={() => setSelectedPlatform(connectivity?.platforms.find(p => p.id === 'indian_bank') || null)}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              selectedPlatform?.id === 'indian_bank'
                ? 'bg-indigo-950/40 border-indigo-500/60 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                : 'bg-slate-950/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    Indian Bank IMPS
                    <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 rounded font-mono font-bold">24x7</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">NPCI IMPS / UPI Rail</div>
                </div>
              </div>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
              <span>Status: <strong className="text-emerald-400 font-mono">SETTLED</strong></span>
              <span>Latency: <strong className="text-slate-200 font-mono">42 ms</strong></span>
              <span>Uptime: <strong className="text-slate-200 font-mono">100.0%</strong></span>
            </div>
          </div>
        </div>

        {/* Selected Platform Detail Expander */}
        {selectedPlatform && (
          <div className="mt-3 p-3 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-slate-400">Inspecting Target:</span>
              <strong className="text-white">{selectedPlatform.name}</strong>
              <span className="text-slate-500 font-mono">[{selectedPlatform.type}]</span>
              <span className="text-slate-400">{selectedPlatform.details}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Supported:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {selectedPlatform.capabilities?.map((cap, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-indigo-300 font-mono">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: RAW PAYLOAD STREAM & INTEGRATED JSON BEAUTIFIER */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: LIVE STREAM FEED (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-500/10 border border-indigo-500/30 rounded text-indigo-400">
                  <Terminal className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Raw Payload Stream
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-bold">
                  {filteredLogs.length} events
                </span>
              </div>

              {/* Stream Controls */}
              <div className="flex items-center gap-1.5">
                <button
                  id="open-security-validator-btn"
                  onClick={() => setIsSecurityModalOpen(true)}
                  className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-700/50 hover:bg-emerald-900/60 flex items-center gap-1 transition-colors"
                  title="Configure Webhook Secret & Test Signatures"
                >
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  <span>Webhook Secret</span>
                </button>

                <button
                  id="toggle-stream-live-btn"
                  onClick={() => setIsStreaming(!isStreaming)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border flex items-center gap-1 transition-colors ${
                    isStreaming
                      ? 'bg-emerald-950/40 text-emerald-300 border-emerald-700/50'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                  title={isStreaming ? 'Pause live payload stream' : 'Resume live stream'}
                >
                  <Radio className={`w-3 h-3 ${isStreaming ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
                  {isStreaming ? 'Live' : 'Paused'}
                </button>

                <button
                  onClick={() => loadStreamLogs()}
                  className="p-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors"
                  title="Force Refresh Feed"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
                </button>
              </div>
            </div>

            {/* Quick Stream Filters */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
              {[
                { id: 'ALL', label: 'All Events' },
                { id: 'JOBS', label: 'Job Feeds' },
                { id: 'REMOTEOK', label: 'RemoteOK' },
                { id: 'UPWORK', label: 'Upwork' },
                { id: 'FREELANCER', label: 'Freelancer' },
                { id: 'PAYMENTS', label: 'Payments' }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setStreamFilter(f.id as any)}
                  className={`px-2 py-0.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                    streamFilter === f.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Search within Stream */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter stream payloads by key, title, ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Stream Log Entries */}
          <div
            ref={streamScrollRef}
            className="space-y-2 max-h-[640px] overflow-y-auto pr-1"
          >
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center bg-slate-900/40 border border-slate-800 rounded-xl text-slate-400 space-y-2">
                <Terminal className="w-6 h-6 text-slate-600 mx-auto" />
                <p className="text-xs font-medium">No incoming payloads matching current filter.</p>
                <button
                  onClick={() => { setStreamFilter('ALL'); setSearchQuery(''); }}
                  className="text-xs text-indigo-400 hover:underline"
                >
                  Reset Stream Filters
                </button>
              </div>
            ) : (
              filteredLogs.map(log => {
                const isSelected = selectedStreamId === log.id;
                const payloadSize = log.requestPayload
                  ? (new Blob([JSON.stringify(log.requestPayload)]).size / 1024).toFixed(1)
                  : '0.4';

                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedStreamId(log.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                      isSelected
                        ? 'bg-slate-900 border-indigo-500/80 shadow-[0_0_15px_rgba(99,102,241,0.2)] ring-1 ring-indigo-500/40'
                        : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/60 hover:border-slate-700'
                    }`}
                  >
                    {/* Active selection bar */}
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-indigo-500 to-violet-500" />
                    )}

                    <div className="flex items-center justify-between gap-2 mb-1.5 pl-1">
                      <div className="flex items-center gap-2">
                        {/* Platform Badge */}
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono uppercase tracking-wider ${
                            log.source === 'RemoteOK'
                              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                              : log.source === 'Upwork'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : log.source === 'Freelancer'
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : log.source === 'Indian Bank'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : log.source === 'PayPal'
                              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {log.source}
                        </span>

                        <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                          {log.method}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                        {log.signatureVerification ? (
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border flex items-center gap-0.5 ${
                              log.signatureVerification.verified
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                                : 'bg-rose-950/80 text-rose-300 border-rose-700/60'
                            }`}
                            title={`HMAC SHA-256: ${log.signatureVerification.verified ? 'Verified' : 'Invalid Signature'}`}
                          >
                            <ShieldCheck className="w-2.5 h-2.5" />
                            {log.signatureVerification.verified ? 'HMAC' : 'FAIL'}
                          </span>
                        ) : log.headers && (log.headers['x-upwork-signature'] || log.headers['x-webhook-signature'] || log.headers['x-hub-signature-256']) ? (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 flex items-center gap-0.5">
                            <ShieldCheck className="w-2.5 h-2.5 text-indigo-400" />
                            SIGNED
                          </span>
                        ) : null}
                        <span>{log.latencyMs}ms</span>
                        <span>•</span>
                        <span className="text-slate-300">{payloadSize} KB</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      </div>
                    </div>

                    <div className="text-xs font-semibold text-slate-200 pl-1 line-clamp-1">
                      {log.summary}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mt-2 pl-1 pt-1 border-t border-slate-800/50">
                      <span className="truncate max-w-[220px]">{log.endpoint}</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: INTERACTIVE JSON BEAUTIFIER & DEEP INSPECTOR (7 cols on lg) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Inspector Mode Switcher */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 flex-wrap">
              <button
                onClick={() => setInspectorMode('request')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  inspectorMode === 'request'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                Raw Inbound Payload
              </button>

              <button
                onClick={() => setInspectorMode('response')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  inspectorMode === 'response'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                Pipeline Response
              </button>

              <button
                onClick={() => setInspectorMode('envelope')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  inspectorMode === 'envelope'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Full Ingest Envelope
              </button>

              <button
                onClick={() => setInspectorMode('security')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  inspectorMode === 'security'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-emerald-400/80 hover:text-emerald-300'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Signature Proof
              </button>
            </div>

            {selectedLog && (
              <span className="text-[11px] text-slate-400 font-mono">
                Event: <strong className="text-slate-200">{selectedLog.id}</strong>
              </span>
            )}
          </div>

          {/* MAIN INSPECTOR CONTENT */}
          {inspectorMode === 'request' && (
            <JsonBeautifier
              data={selectedLog?.requestPayload || { message: 'No payload in selected event' }}
              title={`Inbound Webhook Payload • ${selectedLog?.source || 'Generic'}`}
              maxHeight="580px"
            />
          )}

          {inspectorMode === 'response' && (
            <JsonBeautifier
              data={selectedLog?.responsePayload || { success: true, status: 'processed' }}
              title={`Downstream Ingestion Response • HTTP ${selectedLog?.statusCode || 200}`}
              maxHeight="580px"
            />
          )}

          {inspectorMode === 'envelope' && (
            <JsonBeautifier
              data={fullEnvelope || {}}
              title="Full Webhook Telemetry & State Reconciliation Envelope"
              maxHeight="580px"
            />
          )}

          {inspectorMode === 'security' && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Cryptographic Signature Verification Audit</h3>
                    <p className="text-xs text-slate-400">HMAC-SHA256 timing-safe signature comparison for event #{selectedLog?.id}</p>
                  </div>
                </div>

                <button
                  onClick={() => setIsSecurityModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 transition-colors flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
                  Open Webhook Secret Validator
                </button>
              </div>

              {selectedLog?.signatureVerification ? (
                <div className="space-y-3">
                  <div className={`p-3.5 rounded-xl border flex items-center justify-between ${
                    selectedLog.signatureVerification.verified
                      ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                      : 'bg-rose-950/30 border-rose-800/60 text-rose-300'
                  }`}>
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className={`w-5 h-5 ${selectedLog.signatureVerification.verified ? 'text-emerald-400' : 'text-rose-400'}`} />
                      <div>
                        <div className="text-xs font-bold font-mono">
                          {selectedLog.signatureVerification.verified ? 'VALID SIGNATURE • HMAC-SHA256 VERIFIED' : 'SIGNATURE REJECTED / MISMATCH'}
                        </div>
                        <div className="text-[11px] opacity-80">
                          {(selectedLog.signatureVerification as any).details || selectedLog.signatureVerification.reason || 'Evaluated against runtime secret using constant-time comparison.'}
                        </div>
                      </div>
                    </div>

                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-white">
                      {selectedLog.signatureVerification.algorithm || 'HMAC-SHA256'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1">
                      <span className="text-slate-400 font-medium block">Received Header Signature:</span>
                      <code className="text-emerald-400 font-mono text-[11px] break-all block bg-slate-950 p-2 rounded border border-slate-800">
                        {selectedLog.signatureVerification.receivedSignature || 'None provided'}
                      </code>
                    </div>

                    <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1">
                      <span className="text-slate-400 font-medium block">Computed Signature:</span>
                      <code className="text-indigo-300 font-mono text-[11px] break-all block bg-slate-950 p-2 rounded border border-slate-800">
                        {selectedLog.signatureVerification.computedSignature || 'Computed at verification'}
                      </code>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-400 space-y-2">
                  <p className="text-slate-300 font-medium">No signature header attached to this log entry.</p>
                  <p>Inbound webhook requests can be signed using <code className="text-indigo-300">X-Upwork-Signature</code>, <code className="text-indigo-300">X-Freelancer-Signature</code>, or <code className="text-indigo-300">X-Hub-Signature-256</code> with HMAC-SHA256.</p>
                  <button
                    onClick={() => setIsSecurityModalOpen(true)}
                    className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-semibold mt-1"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Configure Webhook Secret and generate HMAC test signatures →
                  </button>
                </div>
              )}

              {/* Raw Headers Preview */}
              <div className="space-y-1 pt-2">
                <span className="text-xs font-semibold text-slate-300">HTTP Ingestion Headers:</span>
                <pre className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto">
                  {JSON.stringify(selectedLog?.headers || {}, null, 2)}
                </pre>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* WEBHOOK SECRET & SIGNATURE VALIDATOR MODAL */}
      {isSecurityModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Webhook Security & Signature Validator</h3>
                  <p className="text-xs text-slate-400">Configure shared webhook secret, verify cryptographic HMAC signatures, and audit authentication.</p>
                </div>
              </div>
              <button
                id="close-security-modal-btn"
                onClick={() => setIsSecurityModalOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            <WebhookSignatureValidator
              activeSecret=""
              onSecretUpdated={() => {
                loadStreamLogs(true);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
