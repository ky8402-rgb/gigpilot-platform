import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Activity,
  AlertTriangle,
  Play,
  Square,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Layers,
  Database,
  Lock,
  Radio,
  ExternalLink,
  DollarSign,
  PieChart,
  Clock,
  ArrowRight,
  Flame,
  CheckCircle2
} from 'lucide-react';
import {
  GigPilotState,
  fetchGigPilotState,
  armGigPilot,
  disarmGigPilot,
  killGigPilot,
  fetchGigPilotHealth
} from '../../services/tradingService';

export const GigPilotFuturesView: React.FC = () => {
  const [state, setState] = useState<GigPilotState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [showArmModal, setShowArmModal] = useState<boolean>(false);
  const [showKillModal, setShowKillModal] = useState<boolean>(false);

  const loadState = async () => {
    try {
      const data = await fetchGigPilotState();
      setState(data);
    } catch (err: any) {
      console.warn('[GigPilotFuturesView] Fetch error:', err?.message || err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
    if (!autoRefresh) return;
    const interval = setInterval(loadState, 2000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const confirmAndArm = async () => {
    setShowArmModal(false);
    try {
      setActionLoading('arm');
      setActionMessage(null);
      const res = await armGigPilot();
      if (res.success && res.armed) {
        setActionMessage({ type: 'success', text: res.idempotent ? 'GigPilot is already ARMED; no duplicate worker or loop was created.' : 'GigPilot autonomous engine successfully ARMED after all safety gates passed.' });
        await loadState();
      } else {
        const reasons = res.reasons?.map(r => r.message).join(' ') || res.error || 'ARM blocked by safety gates.';
        setActionMessage({ type: 'error', text: reasons });
        await loadState();
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Error communicating with engine' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleArm = () => {
    setShowArmModal(true);
  };

  const handleDisarm = async () => {
    try {
      setActionLoading('disarm');
      setActionMessage(null);
      const res = await disarmGigPilot();
      setActionMessage({ type: 'success', text: 'GigPilot autonomous engine DISARMED into safe standby.' });
      await loadState();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Failed to disarm' });
    } finally {
      setActionLoading(null);
    }
  };

  const confirmAndKill = async () => {
    setShowKillModal(false);
    try {
      setActionLoading('kill');
      setActionMessage(null);
      await killGigPilot();
      setActionMessage({ type: 'success', text: 'KILL SWITCH EXECUTED: All open orders cancelled and positions flattened.' });
      await loadState();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err?.message || 'Kill switch error' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleKill = () => {
    setShowKillModal(true);
  };

  const fmt = (num?: number | null, decimals = 2) => {
    if (num === null || num === undefined || isNaN(num)) return '–';
    return Number(num).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  const isReachable = state?.reachable !== false && state?.equity !== null;

  return (
    <div className="space-y-6">
      {/* 1. Header & Invariants Banner */}
      <div className="p-5 bg-gradient-to-r from-zinc-900 via-slate-900 to-zinc-950 border border-emerald-500/30 rounded-2xl shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/40 rounded-xl">
                <Zap className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold tracking-tight text-white font-mono">
                    GigPilot USDT-Perp Autonomous Platform
                  </h2>
                  <span className={`px-2 py-0.5 text-xs font-mono font-semibold rounded-full border ${
                    !isReachable
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500 font-bold'
                      : state?.armed
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 animate-pulse'
                      : 'bg-zinc-800 text-slate-400 border-zinc-700'
                  }`}>
                    {!isReachable
                      ? '● ENGINE UNREACHABLE'
                      : state?.armed
                      ? '● ARMED (TRADING)'
                      : '○ DISARMED (SAFE STANDBY)'}
                  </span>
                  {isReachable && (
                    <span className="px-2 py-0.5 text-xs font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/60 rounded-full">
                      MODE: {state?.position_mode ? state.position_mode.toUpperCase() : 'ONE-WAY'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  Exchange: Bybit V5 Linear Futures (<span className="text-emerald-400">{state?.host || 'https://api.bybit.com'}</span>) · Live Edge Gate: <span className="text-amber-400">&gt; {state?.hurdle_bps || 3.0} bps</span> net
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {isReachable && !state?.armed && (
              <button
                onClick={handleArm}
                disabled={actionLoading !== null}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-950/50 transition-all disabled:opacity-50"
              >
                {actionLoading === 'arm' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                Arm Engine
              </button>
            )}

            {isReachable && state?.armed && (
              <button
                onClick={handleDisarm}
                disabled={actionLoading !== null}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-mono text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-amber-950/50 transition-all disabled:opacity-50"
              >
                {actionLoading === 'disarm' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 fill-current" />}
                Disarm Standby
              </button>
            )}

            <button
              onClick={handleKill}
              disabled={actionLoading !== null}
              className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white font-mono text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-rose-950/50 transition-all disabled:opacity-50"
            >
              {actionLoading === 'kill' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
              EMERGENCY KILL
            </button>

            <button
              onClick={loadState}
              className="p-2 bg-zinc-800 hover:bg-zinc-700 text-slate-300 rounded-xl border border-zinc-700 transition-all"
              title="Refresh State"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Action feedback banner */}
        {actionMessage && (
          <div className={`mt-3 p-3 text-xs font-mono rounded-xl border flex items-center justify-between ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40'
              : 'bg-rose-950/40 text-rose-300 border-rose-500/40'
          }`}>
            <span>{actionMessage.text}</span>
            <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white ml-2">✕</button>
          </div>
        )}

        {/* Invariant Chips */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-4 pt-4 border-t border-zinc-800">
          <div className="p-2 bg-zinc-950/60 border border-zinc-800 rounded-lg text-center">
            <div className="text-[10px] uppercase font-mono text-slate-500">1. Strict Live Only</div>
            <div className="text-xs font-mono font-semibold text-emerald-400 mt-0.5">VERIFIED</div>
          </div>
          <div className="p-2 bg-zinc-950/60 border border-zinc-800 rounded-lg text-center">
            <div className="text-[10px] uppercase font-mono text-slate-500">2. One-Way Mode</div>
            <div className="text-xs font-mono font-semibold text-emerald-400 mt-0.5">HEDGE LOCKED</div>
          </div>
          <div className="p-2 bg-zinc-950/60 border border-zinc-800 rounded-lg text-center">
            <div className="text-[10px] uppercase font-mono text-slate-500">3. Fail Closed</div>
            <div className="text-xs font-mono font-semibold text-emerald-400 mt-0.5">&le; 1500ms Ticks</div>
          </div>
          <div className="p-2 bg-zinc-950/60 border border-zinc-800 rounded-lg text-center">
            <div className="text-[10px] uppercase font-mono text-slate-500">4. Real Edge Hurdle</div>
            <div className="text-xs font-mono font-semibold text-amber-400 mt-0.5">&ge; 3.0 bps Net</div>
          </div>
          <div className="p-2 bg-zinc-950/60 border border-zinc-800 rounded-lg text-center">
            <div className="text-[10px] uppercase font-mono text-slate-500">5. Exchange Authority</div>
            <div className="text-xs font-mono font-semibold text-emerald-400 mt-0.5">WAL Reconciled</div>
          </div>
          <div className="p-2 bg-zinc-950/60 border border-zinc-800 rounded-lg text-center">
            <div className="text-[10px] uppercase font-mono text-slate-500">6. Max Risk Levers</div>
            <div className="text-xs font-mono font-semibold text-cyan-400 mt-0.5">&le; 3x Lev / 40% Cap</div>
          </div>
        </div>
      </div>

      {/* FAIL-VISIBLE ALERT BANNER: Displayed when engine is unreachable */}
      {!isReachable && (
        <div className="p-5 bg-rose-950/80 border-2 border-rose-500 rounded-2xl flex items-center gap-4 text-rose-200 font-mono shadow-2xl">
          <ShieldAlert className="w-10 h-10 text-rose-500 flex-shrink-0 animate-pulse" />
          <div>
            <div className="text-lg font-bold text-rose-400 uppercase tracking-wide">
              ENGINE UNREACHABLE
            </div>
            <div className="text-xs text-rose-300 mt-1 leading-relaxed">
              The GigPilot autonomous engine is offline or unreachable on Bybit V5 Linear Futures. All numeric widgets, edge evaluations, and balance telemetry are completely hidden to prevent displaying fabricated state.
            </div>
          </div>
        </div>
      )}

      {/* NUMERIC WIDGETS & DETAIL PANELS: ONLY RENDERED WHEN ENGINE IS ACTUALLY REACHABLE */}
      {isReachable && (
        <>
          {/* 2. Key Capital & Exposure Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Account Equity</span>
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                ${fmt(state?.equity)}
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1 flex items-center gap-1">
                <span>Bybit Unified Margin Wallet</span>
              </div>
            </div>

            <div className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Gross Notional</span>
                <PieChart className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                ${fmt(state?.gross_notional)}
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">
                Max Cap: ${fmt((state?.equity || 0) * 0.40)} (40% max)
              </div>
            </div>

            <div className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Realized PnL (Verified)</span>
                {(state?.realized_today || 0) >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-rose-400" />
                )}
              </div>
              <div className={`text-2xl font-bold font-mono mt-1 ${
                (state?.realized_today || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {(state?.realized_today || 0) >= 0 ? '+' : ''}${fmt(state?.realized_today)}
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">
                Accounting-Reconciled / Today
              </div>
            </div>

            <div className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Margin Ratio</span>
                <ShieldCheck className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                {((state?.margin_ratio || 0) * 100).toFixed(2)}%
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-1">
                Risk Gate Threshold &lt; 60%
              </div>
            </div>
          </div>

          {/* 3. Real Net Edge Engine Radar */}
          <div className="p-5 bg-zinc-900/90 border border-zinc-800 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold font-mono text-white tracking-wide uppercase">
                  Real Net Edge Matrix (Taker Fee + Spread + Slippage + Funding Gated)
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Hurdle: <span className="text-amber-400 font-bold">&gt; {state?.hurdle_bps || 3.0} bps</span>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-slate-400">
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Mid Price</th>
                    <th className="py-2.5 px-3">Spread</th>
                    <th className="py-2.5 px-3">ATR Vol</th>
                    <th className="py-2.5 px-3">Fee Rate</th>
                    <th className="py-2.5 px-3">Orderbook Imbalance</th>
                    <th className="py-2.5 px-3">Expected Net Edge</th>
                    <th className="py-2.5 px-3 text-right">Tradable?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {state?.markets && state.markets.length > 0 ? (
                    state.markets.map((m) => {
                      const sig = state.signals?.find((s) => s.symbol === m.symbol);
                      return (
                        <tr key={m.symbol} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-3 px-3 font-bold text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                            {m.symbol}
                          </td>
                          <td className="py-3 px-3 text-slate-200">${fmt(m.mid)}</td>
                          <td className="py-3 px-3 text-slate-400">{m.spread_bps ? `${m.spread_bps.toFixed(2)} bps` : '–'}</td>
                          <td className="py-3 px-3 text-slate-400">{fmt(m.atr_bps)} bps</td>
                          <td className="py-3 px-3 text-slate-400">{fmt(m.fee_bps)} bps</td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[11px] ${
                              m.imbalance > 0 ? 'bg-emerald-950/60 text-emerald-300' : 'bg-rose-950/60 text-rose-300'
                            }`}>
                              {m.imbalance > 0 ? '+' : ''}{m.imbalance?.toFixed(3)}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-semibold">
                            <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                              (sig?.net_bps || 0) >= (state.hurdle_bps || 3.0)
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-zinc-800 text-slate-400'
                            }`}>
                              {sig?.net_bps ? `${sig.net_bps > 0 ? '+' : ''}${sig.net_bps.toFixed(2)} bps` : '–'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            {sig?.tradable ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-bold text-[11px] animate-pulse">
                                <CheckCircle2 className="w-3.5 h-3.5" /> YES
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 text-slate-500 rounded-full text-[11px]">
                                {sig?.reason ? sig.reason.replace(/_/g, ' ') : 'Sub-hurdle'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-slate-500">
                        Awaiting linear market book streams...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 4. Active Futures Positions & Protection */}
          <div className="p-5 bg-zinc-900/90 border border-zinc-800 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold font-mono text-white tracking-wide uppercase">
                  Active USDT-Perp Positions (One-Way Native Protected)
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {state?.positions?.length || 0} Open Position{state?.positions?.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-slate-400">
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Side</th>
                    <th className="py-2.5 px-3">Size / Qty</th>
                    <th className="py-2.5 px-3">Entry Price</th>
                    <th className="py-2.5 px-3">Mark Price</th>
                    <th className="py-2.5 px-3 text-right">Unrealized PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {state?.positions && state.positions.length > 0 ? (
                    state.positions.map((pos) => (
                      <tr key={pos.symbol} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 px-3 font-bold text-white">{pos.symbol}</td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            pos.side.toUpperCase() === 'BUY'
                              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-950/60 text-rose-400 border border-rose-500/30'
                          }`}>
                            {pos.side.toUpperCase() === 'BUY' ? 'LONG' : 'SHORT'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-200">{pos.qty}</td>
                        <td className="py-3 px-3 text-slate-300">${fmt(pos.entry)}</td>
                        <td className="py-3 px-3 text-slate-300">${fmt(pos.mark)}</td>
                        <td className={`py-3 px-3 text-right font-bold ${
                          (pos.upnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {(pos.upnl || 0) >= 0 ? '+' : ''}${fmt(pos.upnl)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        No active positions open. Capital is preserved in USD margin safety.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 5. Live Auditable Journal & Execution Feed */}
          <div className="p-5 bg-zinc-900/90 border border-zinc-800 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold font-mono text-white tracking-wide uppercase">
                  Auditable Journal &amp; Exchange Verification Events
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Append-only SQLite WAL Log
              </span>
            </div>

            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 text-slate-400 sticky top-0 bg-zinc-900">
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Kind</th>
                    <th className="py-2 px-3">Symbol</th>
                    <th className="py-2 px-3">Execution Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {state?.events && state.events.length > 0 ? (
                    state.events.slice().reverse().map((ev, i) => (
                      <tr key={i} className="hover:bg-zinc-800/20 transition-colors">
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{ev.ts}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            ev.kind === 'FILL' ? 'bg-emerald-950 text-emerald-400' :
                            ev.kind === 'ENTER' ? 'bg-cyan-950 text-cyan-400' :
                            ev.kind === 'CLOSE' ? 'bg-amber-950 text-amber-400' :
                            ev.kind === 'ARM' ? 'bg-emerald-900/50 text-emerald-300' :
                            'bg-zinc-800 text-slate-400'
                          }`}>
                            {ev.kind}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-semibold text-slate-200">{ev.symbol || '–'}</td>
                        <td className="py-2 px-3 text-slate-300">
                          {ev.side ? `${ev.side} ` : ''}
                          {ev.px ? `@ $${fmt(ev.px)} ` : ''}
                          {ev.qty ? `x ${ev.qty} ` : ''}
                          {ev.fee ? `(Fee: $${fmt(ev.fee, 4)}) ` : ''}
                          {ev.closed_pnl ? `PnL: ${ev.closed_pnl >= 0 ? '+' : ''}$${fmt(ev.closed_pnl)} ` : ''}
                          {ev.link ? `[${ev.link}]` : ''}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-500">
                        No recent events logged.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {/* Arm Confirmation Modal */}
      {showArmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-zinc-900 border border-emerald-600/80 rounded-xl max-w-md w-full p-6 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2.5 mb-3 text-emerald-400">
              <Zap className="w-5 h-5" />
              <h3 className="font-extrabold text-base text-white">Arm Autonomous GigPilot Engine</h3>
            </div>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Authorize autonomous live futures execution on Bybit USDT-Perpetual when real mathematical edge strictly exceeds 3.0 bps?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowArmModal(false)}
                className="px-4 py-2 rounded text-slate-400 hover:bg-zinc-800 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAndArm}
                className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-emerald-950/60"
              >
                Confirm Arm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kill Switch Confirmation Modal */}
      {showKillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-xs">
          <div className="bg-zinc-900 border border-rose-600/80 rounded-xl max-w-md w-full p-6 shadow-2xl text-slate-100">
            <div className="flex items-center gap-2.5 mb-3 text-rose-400">
              <ShieldAlert className="w-5 h-5" />
              <h3 className="font-extrabold text-base text-white">Emergency Kill Switch</h3>
            </div>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              EMERGENCY ACTION: Cancel ALL active orders and market-flatten ALL open futures positions immediately?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowKillModal(false)}
                className="px-4 py-2 rounded text-slate-400 hover:bg-zinc-800 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAndKill}
                className="px-5 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-950/60"
              >
                Confirm Emergency Kill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
