import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Database, 
  Globe, 
  Cpu, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  RefreshCw, 
  ExternalLink, 
  ShieldCheck, 
  Layers, 
  Wifi, 
  WifiOff, 
  Terminal, 
  Copy, 
  Check,
  Radio,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { 
  getApiBaseUrl, 
  getBackendTargetInfo, 
  setCustomBackendUrl, 
  testBackendConnection, 
  BACKEND_BASE_URL,
  BackendTargetInfo 
} from '../services/api';

interface BackendConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BackendConnectionModal: React.FC<BackendConnectionModalProps> = ({
  isOpen,
  onClose
}) => {
  const [targetInfo, setTargetInfo] = useState<BackendTargetInfo>(getBackendTargetInfo());
  const [inputUrl, setInputUrl] = useState<string>('');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    status: string;
    url: string;
    data?: any;
    error?: string;
  } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      const info = getBackendTargetInfo();
      setTargetInfo(info);
      setInputUrl(info.isCustom ? info.url : '');
      runTest(info.url);
    }
  }, [isOpen]);

  const runTest = async (urlToTest?: string) => {
    setIsTesting(true);
    try {
      const result = await testBackendConnection(urlToTest);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        status: 'error',
        url: urlToTest || getApiBaseUrl(),
        error: err.message || 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleApplyPreset = (presetUrl: string | null) => {
    setCustomBackendUrl(presetUrl);
    const updated = getBackendTargetInfo();
    setTargetInfo(updated);
    setInputUrl(presetUrl || '');
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
    runTest(updated.url);
  };

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputUrl.trim().replace(/\/+$/, '');
    if (!clean) {
      handleApplyPreset(null);
      return;
    }
    setCustomBackendUrl(clean);
    const updated = getBackendTargetInfo();
    setTargetInfo(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
    runTest(clean);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  const isConnected = testResult?.success;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        id="backend-connection-modal"
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl p-0.5 shadow-md ${
              isConnected 
                ? 'bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 text-emerald-400' 
                : 'bg-gradient-to-tr from-amber-600 to-rose-600 text-amber-300'
            }`}>
              <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-slate-950">
                {isConnected ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white sm:text-lg">
                  Frontend & Backend Architecture Gateway
                </h2>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${
                  isConnected 
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' 
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                  {isConnected ? 'Connected' : 'Connecting...'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Live link between Client Browser & REST/SSE Express Backend
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Architecture Visual Topology Card */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-cyan-400" />
                Active 3-Tier Architecture Pipeline
              </span>
              <span className="text-emerald-400 font-mono">PORT 3000 • REST / SSE</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {/* Tier 1: Frontend */}
              <div className="rounded-lg border border-slate-800/80 bg-slate-900/90 p-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-cyan-400 mb-1 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5" />
                      Frontend UI
                    </span>
                    <span className="text-[10px] bg-cyan-950/60 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-800/40">Tier 1</span>
                  </div>
                  <p className="text-slate-300 text-[11px] font-medium">AWS Amplify / Vercel / Vite</p>
                  <p className="text-slate-500 text-[10px]">React 18 SPA • Tailwind CSS</p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-800/60 text-[10px] text-slate-400 font-mono">
                  Origin: {typeof window !== 'undefined' ? window.location.host : 'localhost'}
                </div>
              </div>

              {/* Tier 2: Backend */}
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/20 p-3 flex flex-col justify-between shadow-sm">
                <div>
                  <div className="flex items-center justify-between text-emerald-400 mb-1 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5" />
                      App Runner / Server
                    </span>
                    <span className="text-[10px] bg-emerald-950/60 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-800/40">Tier 2</span>
                  </div>
                  <p className="text-slate-200 text-[11px] font-medium">Node.js 20 • Express 4</p>
                  <p className="text-emerald-500/90 text-[10px]">Self-Healing Daemon • Cron • ML</p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-emerald-900/40 text-[10px] text-emerald-300 font-mono truncate" title={targetInfo.url}>
                  {targetInfo.type.toUpperCase()} : {targetInfo.url}
                </div>
              </div>

              {/* Tier 3: Database */}
              <div className="rounded-lg border border-slate-800/80 bg-slate-900/90 p-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-indigo-400 mb-1 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5" />
                      PostgreSQL
                    </span>
                    <span className="text-[10px] bg-indigo-950/60 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-800/40">Tier 3</span>
                  </div>
                  <p className="text-slate-300 text-[11px] font-medium">Neon / Render Cloud PG</p>
                  <p className="text-slate-500 text-[10px]">users, gigs, proposals, orders</p>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-800/60 text-[10px] text-slate-400 font-mono">
                  Schema: Prisma ORM v5
                </div>
              </div>
            </div>
          </div>

          {/* Live Ping & Diagnostic State */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Radio className="h-4 w-4 text-emerald-400 animate-pulse" />
                Live Telemetry & Diagnostics
              </span>
              <button
                type="button"
                onClick={() => runTest(targetInfo.url)}
                disabled={isTesting}
                className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-medium disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                {isTesting ? 'Pinging...' : 'Re-test Ping'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg bg-slate-900/90 border border-slate-800/80 p-2.5">
                <div className="text-[10px] uppercase font-bold text-slate-400">Status</div>
                <div className={`mt-0.5 font-bold capitalize ${isConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {testResult ? testResult.status : 'Checking...'}
                </div>
              </div>

              <div className="rounded-lg bg-slate-900/90 border border-slate-800/80 p-2.5">
                <div className="text-[10px] uppercase font-bold text-slate-400">Roundtrip Latency</div>
                <div className="mt-0.5 font-mono font-bold text-cyan-300">
                  {testResult && testResult.latencyMs > 0 ? `${testResult.latencyMs} ms` : '—'}
                </div>
              </div>

              <div className="rounded-lg bg-slate-900/90 border border-slate-800/80 p-2.5">
                <div className="text-[10px] uppercase font-bold text-slate-400">Target Type</div>
                <div className="mt-0.5 font-bold uppercase text-slate-200">
                  {targetInfo.type}
                </div>
              </div>

              <div className="rounded-lg bg-slate-900/90 border border-slate-800/80 p-2.5">
                <div className="text-[10px] uppercase font-bold text-slate-400">CORS Support</div>
                <div className="mt-0.5 font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Universal
                </div>
              </div>
            </div>

            {testResult?.error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                <div>
                  <span className="font-semibold">Notice:</span> {testResult.error}
                  <p className="text-[11px] text-amber-400/80 mt-0.5">
                    If using an AWS App Runner or Render service, verify that your service has finished deploying.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Preset Backend Quick Switcher */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">
              Select or Connect Backend Target
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Option A: Same-Origin / Localhost */}
              <button
                type="button"
                onClick={() => handleApplyPreset(null)}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  !targetInfo.isCustom
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                    : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-bold text-xs flex items-center gap-1.5 text-emerald-400">
                    <Server className="h-3.5 w-3.5" />
                    Same-Origin / Local
                  </span>
                  {!targetInfo.isCustom && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </div>
                <p className="text-[11px] text-slate-400">Direct Express server or unified deployment</p>
                <code className="text-[10px] text-slate-500 mt-1 font-mono">{window.location.origin}</code>
              </button>

              {/* Option B: Render Cloud Production */}
              <button
                type="button"
                onClick={() => handleApplyPreset(BACKEND_BASE_URL)}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  targetInfo.url === BACKEND_BASE_URL
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                    : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-bold text-xs flex items-center gap-1.5 text-cyan-400">
                    <Globe className="h-3.5 w-3.5" />
                    Render Production
                  </span>
                  {targetInfo.url === BACKEND_BASE_URL && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </div>
                <p className="text-[11px] text-slate-400">Live Render Cloud Service & Postgres</p>
                <code className="text-[10px] text-slate-500 mt-1 font-mono truncate max-w-full">{BACKEND_BASE_URL}</code>
              </button>

              {/* Option C: AWS App Runner / EC2 */}
              <button
                type="button"
                onClick={() => {
                  const sample = 'https://xxxxxx.us-east-1.awsapprunner.com';
                  setInputUrl(inputUrl || sample);
                }}
                className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                  targetInfo.type === 'apprunner' || targetInfo.type === 'ec2'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                    : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-bold text-xs flex items-center gap-1.5 text-indigo-400">
                    <Cpu className="h-3.5 w-3.5" />
                    AWS App Runner / EC2
                  </span>
                  {(targetInfo.type === 'apprunner' || targetInfo.type === 'ec2') && (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Dedicated AWS container endpoint</p>
                <code className="text-[10px] text-slate-500 mt-1 font-mono">*.awsapprunner.com</code>
              </button>
            </div>
          </div>

          {/* Custom Backend URL Input Form */}
          <form onSubmit={handleSaveCustom} className="space-y-3">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Custom Backend Service URL</span>
              <span className="text-[11px] text-slate-500 font-normal">Supports AWS App Runner, EC2, Render, or Tunnel</span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://your-app-runner-service.us-east-1.awsapprunner.com"
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs font-mono text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-950/40 transition-all active:scale-95"
              >
                <Check className="h-3.5 w-3.5" />
                Connect
              </button>
            </div>
            {saveSuccess && (
              <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Backend connection updated and verified successfully!
              </p>
            )}
          </form>

        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/60 px-6 py-3.5">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Terminal className="h-3.5 w-3.5 text-slate-500" />
            <span>Health Endpoint:</span>
            <code className="font-mono text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/30">
              /api/health/ping
            </code>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-1.5 text-xs font-semibold text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
