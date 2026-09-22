import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Power,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Key,
  ExternalLink
} from 'lucide-react';
import { EngineHealth, EngineId, ExchangeCredentialsInfo, SupportedExchange } from '../../types/trading';
import { fetchWithFailover } from '../../services/tradingService';

function formatTimestamp(rawTimestamp?: string | number | null): string {
  if (!rawTimestamp) return 'Just now';
  try {
    const d = new Date(rawTimestamp);
    if (isNaN(d.getTime())) return 'Just now';
    return d.toLocaleTimeString();
  } catch {
    return 'Just now';
  }
}

interface EngineHealthViewProps {
  onEngineToggled?: () => void;
}

export const EngineHealthView: React.FC<EngineHealthViewProps> = ({ onEngineToggled }) => {
  const [engines, setEngines] = useState<EngineHealth[]>([]);
  const [failClosed, setFailClosed] = useState<{ failClosed: boolean; downEngines: string[] }>({
    failClosed: false,
    downEngines: []
  });
  const [credentials, setCredentials] = useState<ExchangeCredentialsInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedEngineId, setSelectedEngineId] = useState<EngineId | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  // Key configuration modal state
  const [activeExchangeModal, setActiveExchangeModal] = useState<SupportedExchange | null>(null);
  const [keyInput, setKeyInput] = useState({ apiKey: '', apiSecret: '', passphrase: '' });
  const [keySaveMsg, setKeySaveMsg] = useState<{ success?: boolean; text?: string } | null>(null);

  const fetchHealthAndCreds = async () => {
    try {
      setLoading(true);
      const [hData, cData] = await Promise.all([
        fetchWithFailover<{ success: boolean; engines: EngineHealth[]; failClosed: { failClosed: boolean; downEngines: string[] } }>('/engines/health').catch(err => {
          console.warn('[EngineHealthView] Health fetch notice:', err?.message || err);
          return null;
        }),
        fetchWithFailover<{ success: boolean; credentials: ExchangeCredentialsInfo[] }>('/exchanges/credentials').catch(err => {
          console.warn('[EngineHealthView] Credentials fetch notice:', err?.message || err);
          return null;
        })
      ]);

      if (hData && hData.success) {
        setEngines(hData.engines || []);
        setFailClosed(hData.failClosed || { failClosed: false, downEngines: [] });
        if (!selectedEngineId && hData.engines?.length > 0) {
          setSelectedEngineId(hData.engines[0].id);
        }
      }

      if (cData && cData.success) {
        setCredentials(cData.credentials || []);
      }
      setApiError(null);
    } catch (e: any) {
      setApiError(e?.message || 'Failed to connect to engine monitor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealthAndCreds();
    const interval = setInterval(fetchHealthAndCreds, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleOffSwitch = async (engineId: EngineId, currentEnabled: boolean) => {
    try {
      setActionLoading(`toggle_${engineId}`);
      const data = await fetchWithFailover<{ success: boolean; error?: string }>(`/engines/${engineId}/off-switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled })
      });
      if (data.success) {
        await fetchHealthAndCreds();
        onEngineToggled?.();
      } else {
        setApiError(data.error || 'Failed to toggle engine off-switch');
      }
    } catch (e: any) {
      setApiError(e?.message || 'Failed to toggle engine');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearErrors = async (engineId: EngineId) => {
    try {
      setActionLoading(`clear_${engineId}`);
      const data = await fetchWithFailover<{ success: boolean; error?: string }>(`/engines/${engineId}/clear-errors`, {
        method: 'POST'
      });
      if (data.success) {
        await fetchHealthAndCreds();
      }
    } catch (e: any) {
      setApiError(e?.message || 'Failed to clear error surface');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeExchangeModal) return;

    try {
      setKeySaveMsg(null);
      const data = await fetchWithFailover<{ success: boolean; error?: string }>('/exchanges/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: activeExchangeModal,
          apiKey: keyInput.apiKey,
          apiSecret: keyInput.apiSecret,
          passphrase: keyInput.passphrase
        })
      });
      if (data.success) {
        setKeySaveMsg({ success: true, text: `Successfully updated ${activeExchangeModal} trade-only keys!` });
        setKeyInput({ apiKey: '', apiSecret: '', passphrase: '' });
        await fetchHealthAndCreds();
        setTimeout(() => {
          setActiveExchangeModal(null);
          setKeySaveMsg(null);
        }, 1500);
      } else {
        setKeySaveMsg({ success: false, text: data.error || 'Failed to update keys' });
      }
    } catch (err: any) {
      setKeySaveMsg({ success: false, text: err?.message || 'Failed to update keys' });
    }
  };

  const selectedEngine = engines.find(e => e.id === selectedEngineId) || engines[0];

  const getStatusBadge = (status: EngineHealth['status'], enabled: boolean) => {
    if (!enabled || status === 'OFF') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
          <Power className="w-3 h-3 text-zinc-400" /> OFF-SWITCH ENGAGED
        </span>
      );
    }
    if (status === 'HEALTHY') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/80">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> OPERATIONAL
        </span>
      );
    }
    if (status === 'DEGRADED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-amber-950/60 text-amber-400 border border-amber-800/80">
          <AlertTriangle className="w-3 h-3 text-amber-400" /> DEGRADED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-rose-950/60 text-rose-400 border border-rose-800/80">
        <AlertTriangle className="w-3 h-3 text-rose-400" /> OFFLINE / DOWN
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Fail-Closed System Alert Banner */}
      {failClosed.failClosed ? (
        <div className="bg-rose-950/50 border-2 border-rose-600/80 rounded-xl p-5 flex items-start gap-4 shadow-lg shadow-rose-950/20">
          <ShieldAlert className="w-8 h-8 text-rose-400 shrink-0 mt-0.5 animate-pulse" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-rose-200 uppercase tracking-wide">
                System Fail-Closed Posture Active
              </h3>
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-900 text-rose-200 border border-rose-700">
                TRADING HALTED
              </span>
            </div>
            <p className="text-sm text-rose-300 leading-relaxed">
              In accordance with strict live-only design rules, order execution is blocked because one or more core subsystems are disabled or degraded:
            </p>
            <ul className="list-disc list-inside text-xs text-rose-200 font-mono mt-2 space-y-1">
              {failClosed.downEngines.map((eng, idx) => (
                <li key={idx} className="font-semibold">{eng}</li>
              ))}
            </ul>
            <p className="text-xs text-rose-400/90 mt-2">
              Zero synthetic fallback permitted. Restore module health or disengage the individual off-switches below to resume live routing.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900/60 border border-emerald-900/40 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-950/80 border border-emerald-800/80 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-100">Zero Synthetic Data Policy Enforced</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                  ALL ENGINES VERIFIED LIVE
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Every engine operates with strict live WS/REST streams, independent error logging, and atomic fail-closed gates.
              </p>
            </div>
          </div>
          <button
            onClick={fetchHealthAndCreds}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 flex items-center gap-1.5 transition-colors border border-zinc-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      )}

      {apiError && (
        <div className="bg-amber-950/40 border border-amber-800/80 rounded-lg p-3 text-xs text-amber-300">
          {apiError}
        </div>
      )}

      {/* Main Grid: Engines Left, Error Surface & Detail Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: All 10 Modular Engines List */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between pb-1">
            <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-400" /> Subsystem Registry ({engines.length})
            </h2>
            <span className="text-xs text-zinc-500 font-mono">100% Real Live Streams</span>
          </div>

          <div className="space-y-2.5">
            {engines.map((eng) => {
              const isSelected = selectedEngineId === eng.id;
              const isOff = !eng.enabled || eng.status === 'OFF';
              const hasErrors = eng.errorCount > 0;

              return (
                <div
                  key={eng.id}
                  onClick={() => setSelectedEngineId(eng.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-800/90 border-sky-500/70 shadow-md shadow-sky-950/20'
                      : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-100">{eng.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                        <span className="text-zinc-500">{eng.id}</span>
                        <span>•</span>
                        <span>{eng.latencyMs >= 0 ? `${eng.latencyMs}ms` : 'N/A'}</span>
                        <span>•</span>
                        <span className={hasErrors ? 'text-amber-400 font-semibold' : 'text-zinc-500'}>
                          {eng.errorCount} error{eng.errorCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      {getStatusBadge(eng.status, eng.enabled)}
                      <button
                        title={isOff ? 'Enable Engine' : 'Engage Off-Switch (Fail-Closed)'}
                        disabled={actionLoading === `toggle_${eng.id}`}
                        onClick={() => handleToggleOffSwitch(eng.id, eng.enabled)}
                        className={`p-1.5 rounded-lg border text-xs font-semibold transition-all ${
                          isOff
                            ? 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-emerald-950 hover:text-emerald-300 hover:border-emerald-700'
                            : 'bg-rose-950/40 text-rose-300 border-rose-900/60 hover:bg-rose-900/60 hover:text-white'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Engine Diagnostic Surface */}
        <div className="lg:col-span-7 space-y-5">
          {selectedEngine ? (
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 space-y-5">
              <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-zinc-100">{selectedEngine.name}</h3>
                    {getStatusBadge(selectedEngine.status, selectedEngine.enabled)}
                  </div>
                  <p className="text-xs text-zinc-400 font-mono mt-1">
                    ENGINE_ID: <span className="text-sky-400">{selectedEngine.id}</span> | Heartbeat:{' '}
                    <span className="text-zinc-300">
                      {formatTimestamp(selectedEngine.lastHeartbeat)}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleOffSwitch(selectedEngine.id, selectedEngine.enabled)}
                    disabled={actionLoading === `toggle_${selectedEngine.id}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                      selectedEngine.enabled
                        ? 'bg-rose-950/60 text-rose-300 border-rose-800 hover:bg-rose-900 hover:text-white'
                        : 'bg-emerald-950/60 text-emerald-300 border-emerald-800 hover:bg-emerald-900 hover:text-white'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {selectedEngine.enabled ? 'Engage Off-Switch' : 'Restore Engine'}
                  </button>
                </div>
              </div>

              {/* Engine Telemetry Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-lg p-3">
                  <span className="text-xs text-zinc-500 font-mono">INSPECTION STATUS</span>
                  <div className="text-base font-bold text-zinc-200 mt-0.5">
                    {selectedEngine.status}
                  </div>
                </div>
                <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-lg p-3">
                  <span className="text-xs text-zinc-500 font-mono">LATENCY (ROUNDTRIP)</span>
                  <div className="text-base font-bold text-zinc-200 mt-0.5">
                    {selectedEngine.latencyMs >= 0 ? `${selectedEngine.latencyMs} ms` : 'Offline'}
                  </div>
                </div>
                <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-lg p-3">
                  <span className="text-xs text-zinc-500 font-mono">UNRESOLVED ERRORS</span>
                  <div className={`text-base font-bold mt-0.5 ${selectedEngine.errorCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {selectedEngine.errorCount}
                  </div>
                </div>
              </div>

              {/* Module Metadata / Config Details */}
              {selectedEngine.details && Object.keys(selectedEngine.details).length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Internal Subsystem Metadata
                  </span>
                  <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-3 text-xs font-mono text-zinc-300 grid grid-cols-2 gap-2">
                    {Object.entries(selectedEngine.details).map(([k, v]) => (
                      <div key={k} className="flex flex-col">
                        <span className="text-zinc-500 text-[11px]">{k}</span>
                        <span className="text-zinc-200 font-medium truncate">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Error Surface Panel */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-amber-400" /> Error Surface & Audit History
                  </span>
                  {selectedEngine.errorSurface.length > 0 && (
                    <button
                      onClick={() => handleClearErrors(selectedEngine.id)}
                      disabled={actionLoading === `clear_${selectedEngine.id}`}
                      className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Clear Error Surface
                    </button>
                  )}
                </div>

                {selectedEngine.errorSurface.length === 0 ? (
                  <div className="bg-zinc-950/40 border border-zinc-800/60 rounded-lg p-6 text-center text-zinc-500 text-xs">
                    No errors logged. All internal invariants, fail-closed guards, and real-time feeds are operational.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {selectedEngine.errorSurface.map((err) => {
                      const isCrit = err.level === 'CRITICAL';
                      const isErr = err.level === 'ERROR';
                      return (
                        <div
                          key={err.id}
                          className={`p-3 rounded-lg border text-xs font-mono space-y-1 ${
                            isCrit
                              ? 'bg-rose-950/30 border-rose-800/80 text-rose-300'
                              : isErr
                              ? 'bg-amber-950/30 border-amber-800/80 text-amber-300'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isCrit
                                  ? 'bg-rose-900 text-rose-200'
                                  : isErr
                                  ? 'bg-amber-900 text-amber-200'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {err.level}
                            </span>
                            <span className="text-[11px] text-zinc-500">
                              {formatTimestamp(err.timestamp)}
                            </span>
                          </div>
                          <p className="font-semibold text-zinc-200">{err.message}</p>
                          {err.details && (
                            <pre className="text-[10px] text-zinc-400 bg-zinc-900/80 p-2 rounded overflow-x-auto">
                              {JSON.stringify(err.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 text-sm">
              Select an engine on the left to view real-time diagnostics and error surfaces.
            </div>
          )}

          {/* Multi-Exchange Credentials Card */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
                  Live Exchange API Keys (Trade-Only)
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                WITHDRAWALS STRICTLY BLOCKED
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Execution engine connects exclusively using trade-only credentials. Any key with withdrawal permissions is rejected by policy.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['BINANCE', 'BYBIT', 'KUCOIN'] as SupportedExchange[]).map((ex) => {
                const cred = credentials.find(c => c.exchange === ex);
                const isConfigured = cred?.configured;

                return (
                  <div
                    key={ex}
                    className="p-3.5 rounded-lg border bg-zinc-950/60 border-zinc-800 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-zinc-200">{ex}</span>
                        {isConfigured ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                            CONFIGURED
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-500 border border-zinc-700">
                            NOT SET
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-500 font-mono mt-1">
                        {isConfigured ? cred?.apiKeyMask : 'No active keys'}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setActiveExchangeModal(ex);
                        setKeyInput({ apiKey: '', apiSecret: '', passphrase: '' });
                        setKeySaveMsg(null);
                      }}
                      className="w-full py-1.5 px-2.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Key className="w-3 h-3" /> {isConfigured ? 'Update Keys' : 'Configure Keys'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Key Config Modal */}
      {activeExchangeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-400" /> Configure {activeExchangeModal} Keys
              </h3>
              <button
                onClick={() => setActiveExchangeModal(null)}
                className="text-zinc-400 hover:text-zinc-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-amber-950/40 border border-amber-800/80 rounded-lg p-3 text-xs text-amber-300 leading-relaxed">
              <Shield className="w-4 h-4 text-amber-400 inline mr-1.5 mb-0.5" />
              <strong>Strict Security Mandate:</strong> Only supply API keys with Spot / Trade permissions enabled. Do NOT enable withdrawal permissions.
            </div>

            <form onSubmit={handleSaveKeys} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">API Key</label>
                <input
                  type="text"
                  required
                  placeholder="Paste exchange API key"
                  value={keyInput.apiKey}
                  onChange={e => setKeyInput({ ...keyInput, apiKey: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">API Secret</label>
                <input
                  type="password"
                  required
                  placeholder="Paste exchange API secret"
                  value={keyInput.apiSecret}
                  onChange={e => setKeyInput({ ...keyInput, apiSecret: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500"
                />
              </div>

              {activeExchangeModal === 'KUCOIN' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">API Passphrase</label>
                  <input
                    type="password"
                    placeholder="KuCoin API Passphrase"
                    value={keyInput.passphrase}
                    onChange={e => setKeyInput({ ...keyInput, passphrase: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500"
                  />
                </div>
              )}

              {keySaveMsg && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-medium ${
                    keySaveMsg.success ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {keySaveMsg.text}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveExchangeModal(null)}
                  className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  Save & Validate Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
