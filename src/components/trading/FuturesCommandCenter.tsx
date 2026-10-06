import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchFuturesUniverse,
  fetchGigPilotState,
  fetchRuntimeCredentialStatus,
  armLive,
  disarmLive,
  ControlPlaneReason,
  FuturesUniverseMarket
} from '../../services/tradingService';
import { ApiSecretModal } from './ApiSecretModal';

type Candle = { t: number; o: number; h: number; l: number; c: number };

const fmt = (n: number | null | undefined, d = 2) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: d });
const pct = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n, 2)}%`;

const reasonText = (r: { reasons?: ControlPlaneReason[]; error?: string }) =>
  (r.reasons || []).map((x) => x.message || x.detail || x.code).filter(Boolean).join(' ') || r.error || '';

export const FuturesCommandCenter: React.FC = () => {
  const [markets, setMarkets] = useState<FuturesUniverseMarket[]>([]);
  const [query, setQuery] = useState('');
  const [exchange, setExchange] = useState<'ALL' | 'BYBIT'>('ALL');
  const [selected, setSelected] = useState<FuturesUniverseMarket | null>(null);
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [secretSubmitting, setSecretSubmitting] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);
  const [secretReasons, setSecretReasons] = useState<ControlPlaneReason[]>([]);

  const refresh = async () => {
    // `Promise.all` was the wrong combinator here. The market universe and the engine state are
    // INDEPENDENT sources, but a single rejected promise blanked BOTH: an authenticated-owner
    // problem on /gigpilot/state also erased the live Bybit market list, so the page rendered as
    // "everything is down" when only one half had failed. allSettled keeps each half truthful.
    const [universeRes, stateRes] = await Promise.allSettled([fetchFuturesUniverse(), fetchGigPilotState()]);

    if (universeRes.status === 'fulfilled') {
      setMarkets(universeRes.value);
      const list = universeRes.value;
      setSelected(prev => list.find(x => x.exchange === prev?.exchange && x.symbol === prev?.symbol) || list[0] || null);
    }

    if (stateRes.status === 'fulfilled') {
      setState(stateRes.value);
      setError('');
    } else {
      const e: any = stateRes.reason;
      setState(null);
      if (e?.status === 401) {
        // Not an outage. The owner session is missing, expired, or was signed with a secret the
        // engine no longer holds (the signing secret was rotated). Saying "ENGINE UNREACHABLE" here
        // sent the operator hunting for a dead engine that was in fact healthy.
        setError('OWNER SESSION REQUIRED — the engine refused this session. Sign in again to load live state.');
      } else if (e?.data?.error === 'ENGINE_AUTH_MISMATCH') {
        setError('ENGINE AUTH MISMATCH — the dashboard and the engine are not sharing a signing secret. This is a deployment fault, not an outage.');
      } else {
        setError(e?.message || 'Live trading telemetry unavailable.');
      }
    }

    setLoading(false);
  };

  useEffect(() => { refresh(); const id = window.setInterval(refresh, 5000); return () => clearInterval(id); }, []);

  useEffect(() => {
    if (!selected) return;
    // Candles are rendered only from authoritative backend state when available.
    const raw = state?.markets?.find((m: any) => m.symbol === selected.symbol)?.candles || [];
    setCandles(Array.isArray(raw) ? raw.map((x: any) => ({ t: Number(x.t), o: Number(x.o), h: Number(x.h), l: Number(x.l), c: Number(x.c) })).filter((x: Candle) => [x.o,x.h,x.l,x.c].every(Number.isFinite)).slice(-60) : []);
  }, [selected, state]);

  const filtered = useMemo(() => markets.filter(m =>
    (exchange === 'ALL' || m.exchange === exchange) &&
    m.symbol.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 150), [markets, query, exchange]);

  const doArm = async () => {
    setAction('ARMING'); setError(''); setNotice('');
    try {
      // Toggling to LIVE ARMED always consults the runtime credential policy FIRST. If the
      // deployment requires a hand-entered secret we must prompt — entry is per-session by design,
      // so we never skip the prompt based on a "already loaded" signal.
      const creds = await fetchRuntimeCredentialStatus();
      if (creds.requireRuntimeSecret) {
        setSecretError(null); setSecretReasons([]);
        setShowSecretModal(true);
        return;
      }
      const r = await armLive();
      if (!r.success || !r.armed) throw new Error(reasonText(r) || 'ARM blocked.');
      setNotice('Engine ARMED for this session.');
      await refresh();
    } catch (e: any) { setError(e?.message || 'ARM blocked.'); } finally { setAction(''); }
  };

  const submitApiSecret = async (apiSecret: string) => {
    setSecretSubmitting(true); setSecretError(null); setSecretReasons([]);
    try {
      const r = await armLive(apiSecret);
      if (r.success && r.armed) {
        setShowSecretModal(false);
        setNotice('Engine ARMED for this session — the runtime API secret is held in engine memory only.');
        await refresh();
      } else {
        setSecretError(r.error || 'ARM blocked.');
        setSecretReasons(r.reasons || []);
      }
    } catch (e: any) {
      setSecretError(e?.message || 'ARM request failed.');
    } finally {
      setSecretSubmitting(false);
    }
  };

  const doDisarm = async () => {
    setAction('DISARMING'); setError(''); setNotice('');
    try {
      const r = await disarmLive();
      if (!r.success || r.armed !== false) throw new Error(r.error || 'DISARM not verified.');
      setNotice(r.runtimeSecretCleared === false ? 'Engine DISARMED into safe standby.' : 'Engine DISARMED into safe standby — runtime API secret cleared from engine memory.');
      await refresh();
    }
    catch (e: any) { setError(e?.message || 'DISARM not verified.'); } finally { setAction(''); }
  };

  return <div className="min-h-full bg-[#070b12] text-slate-100 p-4 md:p-6 space-y-4">
    <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
      <div><div className="text-[11px] tracking-[.22em] text-cyan-400 uppercase">GigPilot / Futures Command</div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Autonomous USDT Perpetuals</h1>
        <p className="text-xs text-slate-500 mt-1">Live Bybit discovery · fail-closed execution · exchange-verified state</p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${state?.armed ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : 'bg-slate-900 text-slate-400 border-slate-700'}`}>{state?.armed ? 'ARMED' : 'DISARMED · SAFE STANDBY'}</span>
        <button disabled={!!action || state?.armed} onClick={doArm} className="px-4 py-2 rounded-lg bg-emerald-600 disabled:opacity-40 text-sm font-semibold">START AUTONOMY</button>
        <button disabled={!!action || !state?.armed} onClick={doDisarm} className="px-4 py-2 rounded-lg border border-rose-800 bg-rose-950/50 text-rose-300 disabled:opacity-40 text-sm font-semibold">STOP</button>
      </div>
    </header>

    {error && <div className="rounded-lg border border-rose-900 bg-rose-950/30 p-3 text-sm text-rose-300">{error}</div>}
    {notice && <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300">{notice}</div>}

    <section className="grid grid-cols-2 lg:grid-cols-6 gap-3">
      {[
        ['Eligible USDT', state?.equity], ['Realized PnL', state?.realized_today], ['Daily PnL', state?.daily_pnl],
        ['Gross Exposure', state?.gross_notional], ['Margin Ratio', state?.margin_ratio != null ? state.margin_ratio * 100 : null],
        ['Net-edge hurdle', state?.hurdle_bps]
      ].map(([k,v]) => <div key={String(k)} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div><div className="text-lg font-mono mt-1">{v == null ? '—' : k === 'Margin Ratio' ? `${fmt(Number(v),2)}%` : k === 'Net-edge hurdle' ? `${fmt(Number(v),2)} bps` : fmt(Number(v))}</div></div>)}
    </section>

    <section className="grid xl:grid-cols-[300px_1fr_340px] gap-4">
      <aside className="rounded-xl border border-slate-800 bg-slate-950/80 overflow-hidden">
        <div className="p-3 border-b border-slate-800"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search coin / symbol…" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm outline-none"/>
          <div className="flex gap-1 mt-2">{(['ALL','BYBIT'] as const).map(x => <button key={x} onClick={() => setExchange(x)} className={`px-2 py-1 rounded text-[10px] ${exchange===x?'bg-cyan-500/20 text-cyan-300':'text-slate-500'}`}>{x}</button>)}</div></div>
        <div className="max-h-[620px] overflow-auto">{filtered.map(m => <button key={m.exchange+m.symbol} onClick={() => setSelected(m)} className={`w-full text-left px-3 py-2.5 border-b border-slate-900 hover:bg-slate-900 ${selected?.exchange===m.exchange&&selected?.symbol===m.symbol?'bg-slate-900':''}`}>
          <div className="flex justify-between"><span className="font-mono text-sm">{m.symbol}</span><span className="text-[10px] text-slate-500">{m.exchange}</span></div>
          <div className="flex justify-between text-xs mt-1"><span>{fmt(m.price, m.price < 1 ? 6 : 2)}</span><span className={m.change24hPct>=0?'text-emerald-400':'text-rose-400'}>{pct(m.change24hPct)}</span></div>
          <div className="text-[10px] text-slate-600 mt-1">Spread {fmt(m.spreadBps,2)} bps · Liq {fmt(m.liquidityScore,0)}</div>
        </button>)}</div>
      </aside>

      <main className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
        <div className="flex items-start justify-between mb-4"><div><div className="text-xs text-slate-500">{selected?.exchange || '—'} / PERPETUAL</div><div className="text-xl font-mono">{selected?.symbol || 'Select a market'}</div></div><div className="text-right"><div className="text-xl font-mono">{fmt(selected?.price, selected && selected.price < 1 ? 6 : 2)}</div><div className={selected && selected.change24hPct>=0?'text-emerald-400 text-xs':'text-rose-400 text-xs'}>{selected ? pct(selected.change24hPct) : '—'}</div></div></div>
        <div className="h-[360px] rounded-lg border border-slate-900 bg-[#05080d] relative overflow-hidden">
          {candles.length ? <svg viewBox="0 0 1000 420" preserveAspectRatio="none" className="w-full h-full">{candles.map((c,i) => { const hi=Math.max(...candles.map(x=>x.h)), lo=Math.min(...candles.map(x=>x.l)), y=(v:number)=>410-(v-lo)/Math.max(hi-lo,1e-12)*390; const x=10+i*980/Math.max(candles.length-1,1); const up=c.c>=c.o; return <g key={c.t||i} opacity=".95"><line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={up?'#34d399':'#fb7185'}/><rect x={x-3} y={Math.min(y(c.o),y(c.c))} width="6" height={Math.max(1,Math.abs(y(c.c)-y(c.o)))} fill={up?'#34d399':'#fb7185'}/></g>})}</svg> : <div className="absolute inset-0 grid place-items-center text-xs text-slate-600">Live candles unavailable — chart intentionally blank.</div>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">{[['Bid',selected?.bid],['Ask',selected?.ask],['Spread',selected?.spreadBps != null ? selected.spreadBps + ' bps' : null],['Funding',selected?.fundingRate != null ? (selected.fundingRate*100).toFixed(4)+'%' : null]].map(([k,v])=><div key={String(k)} className="bg-slate-900/70 rounded-lg p-2"><div className="text-[10px] text-slate-500">{k}</div><div className="font-mono text-sm mt-1">{typeof v==='number'?fmt(v, v<1?6:2):v||'—'}</div></div>)}</div>
      </main>

      <aside className="space-y-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4"><div className="text-xs uppercase tracking-wider text-slate-500">Execution Gate</div><div className={selected?.eligible?'text-emerald-300':'text-amber-300'}>{selected?.eligible?'ELIGIBLE':'BLOCKED / OBSERVE'}</div><div className="text-xs text-slate-500 mt-2">{selected?.reasons?.join(' · ') || 'No local quote violations detected.'}</div></div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4"><div className="text-xs uppercase tracking-wider text-slate-500 mb-3">Open Positions</div>{(state?.positions || []).length ? state.positions.map((p:any)=><div key={p.symbol} className="py-2 border-b border-slate-900"><div className="flex justify-between font-mono text-sm"><span>{p.symbol}</span><span>{p.side}</span></div><div className="text-xs text-slate-500">Qty {p.qty} · Entry {fmt(p.entry)} · uPnL {fmt(p.upnl)}</div></div>) : <div className="text-xs text-slate-600">No exchange-verified open positions.</div>}</div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4"><div className="text-xs uppercase tracking-wider text-slate-500 mb-3">System Health</div>{(state?.engines || []).slice(0,8).map((e:any)=><div key={e.id||e.name} className="flex justify-between text-xs py-1"><span>{e.name||e.id}</span><span className={/healthy|up|running/i.test(String(e.status))?'text-emerald-400':'text-amber-400'}>{e.status}</span></div>)}<div className="mt-3 text-xs">{state?.failClosedStatus?.failClosed ? '⛔ FAIL-CLOSED' : '✓ Safety boundary operational'}</div></div>
      </aside>
    </section>

    {showSecretModal && (
      <ApiSecretModal
        isOpen
        submitting={secretSubmitting}
        error={secretError}
        reasons={secretReasons}
        onCancel={() => { setShowSecretModal(false); setSecretError(null); setSecretReasons([]); }}
        onSubmit={submitApiSecret}
      />
    )}
  </div>;
};
