import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock3, LockKeyhole, ShieldCheck, TrendingDown, TrendingUp, X } from 'lucide-react';
import { MasterTradingState, Position } from '../../types/trading';
import { fetchOrderPreview, fetchWithFailover, placeManualOrder, placeProtectiveExit } from '../../services/tradingService';

type Pair = { symbol: string; price: number; change24hPct: number };
type LiveTradingViewProps = {
  state: MasterTradingState;
  pairs: Pair[];
  pairDetails: any;
  isLiveConnected: boolean;
  isOwnerAuthenticated: boolean;
  onSelectSymbol: (symbol: string) => Promise<void>;
  onRefresh: () => Promise<void> | void;
};

const money = (n: number | undefined | null) => typeof n === 'number' && Number.isFinite(n)
  ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
  : '—';
const price = (n: number | undefined | null) => typeof n === 'number' && Number.isFinite(n)
  ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(n)
  : '—';
const pct = (n: number | undefined | null) => typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}%` : '—';

export const LiveTradingView: React.FC<LiveTradingViewProps> = ({
  state, pairs, pairDetails, isLiveConnected, isOwnerAuthenticated, onSelectSymbol, onRefresh
}) => {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [autoTrading, setAutoTrading] = useState<any>(null);
  const [confirm, setConfirm] = useState<null | { action: 'ORDER' | 'TP' | 'SL' | 'CLOSE'; title: string; body: string; run: () => Promise<void> }>(null);

  const position = ((state as any).position || null) as Position | null;
  const livePrice = typeof pairDetails?.currentPrice === 'number' && pairDetails.currentPrice > 0
    ? pairDetails.currentPrice
    : null;
  const lastSyncMs = state.serverTime ? Math.max(0, Date.now() - Date.parse(state.serverTime)) : Infinity;
  const freshness = !isLiveConnected ? 'UNAVAILABLE' : lastSyncMs > 8000 ? 'STALE' : 'LIVE';
  const activeSymbol = state.activeSymbol;
  const baseAsset = activeSymbol.replace(/[\/_-]/g, '').replace(/USDT$|USDC$|USD$/i, '') || activeSymbol;

  const canTradeReason = useMemo(() => {
    if (!isLiveConnected || !livePrice) return { ok: false, text: 'Live exchange market data is unavailable.' };
    if (!isOwnerAuthenticated) return { ok: false, text: 'Owner authentication is required before live order placement.' };
    if (state.failClosedStatus?.failClosed) return { ok: false, text: `Fail-closed: ${state.failClosedStatus.downEngines.join(', ')} is degraded.` };
    if (state.GLOBAL_KILL_SWITCH_ACTIVE || state.killSwitch?.isActive) return { ok: false, text: 'Global kill switch is engaged.' };
    if (state.circuitBreakerActive) return { ok: false, text: 'Risk circuit breaker is active.' };
    return { ok: true, text: 'Authenticated live gateway, risk engine, kill switch, and fail-closed checks are clear. The backend still performs the mandatory net-edge gate.' };
  }, [isLiveConnected, livePrice, isOwnerAuthenticated, state.failClosedStatus, state.GLOBAL_KILL_SWITCH_ACTIVE, state.killSwitch, state.circuitBreakerActive]);

  const notional = Number(amount || 0) * (orderType === 'LIMIT' ? Number(limitPrice || 0) : Number(livePrice || 0));
  const realizedNet = ((state as any).recentFills || []).reduce((sum: number, fill: any) => sum + (Number(fill.realizedPnL) || 0), 0);

  useEffect(() => {
    let cancelled = false;
    const loadAutoTradingStatus = async () => {
      if (!isOwnerAuthenticated) {
        if (!cancelled) setAutoTrading(null);
        return;
      }
      try {
        const result = await fetchWithFailover<any>('/autonomy/status');
        if (!cancelled) setAutoTrading(result);
      } catch {
        if (!cancelled) setAutoTrading(null);
      }
    };
    loadAutoTradingStatus();
    const interval = setInterval(loadAutoTradingStatus, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isOwnerAuthenticated]);

  useEffect(() => {
    setPreview(null);
    setNotice('');
  }, [activeSymbol, side, orderType]);

  const runPreview = async () => {
    setNotice('');
    setPreview(null);
    if (!canTradeReason.ok) { setNotice(canTradeReason.text); return; }
    const qty = Number(amount);
    const p = orderType === 'LIMIT' ? Number(limitPrice) : Number(livePrice);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(p) || p <= 0) { setNotice('Enter a positive amount and a valid price.'); return; }
    setBusy(true);
    try {
      const result = await fetchOrderPreview({ symbol: activeSymbol, side, type: orderType, price: p, amount: qty });
      if (!result.success) throw new Error(result.error || 'Live order preview was not accepted.');
      setPreview(result);
    } catch (e: any) {
      setNotice(e.message || 'Live order preview failed.');
    } finally { setBusy(false); }
  };

  const placeOrder = async () => {
    if (!preview) return;
    setBusy(true); setNotice('');
    try {
      const result = await placeManualOrder({ symbol: activeSymbol, side, type: orderType, price: preview.estimatedExecutionPrice, amount: Number(amount) });
      if (!result.success) throw new Error(result.error || 'Live order rejected.');
      setNotice(`Order accepted by the live backend: ${result.order?.id || 'exchange acknowledgement received'}.`);
      setConfirm(null); setPreview(null); setAmount(''); await onRefresh();
    } catch (e: any) { setNotice(e.message || 'Live order failed.'); } finally { setBusy(false); }
  };

  const protect = (kind: 'TP' | 'SL') => {
    if (!position || !livePrice) return;
    const trigger = Number(kind === 'TP' ? tpPrice : slPrice);
    const label = kind === 'TP' ? 'Take Profit' : 'Stop Loss';
    if (!Number.isFinite(trigger) || trigger <= 0) { setNotice(`Enter a valid ${label} trigger price.`); return; }
    setConfirm({
      action: kind === 'TP' ? 'TP' : 'SL',
      title: `Confirm live ${label}`,
      body: `${label} will be placed on Bybit for ${price(position.baseAmount)} ${baseAsset} at trigger ${price(trigger)}. This is a real exchange conditional order.`,
      run: async () => {
        setBusy(true); setNotice('');
        try {
          const result = await placeProtectiveExit({ symbol: activeSymbol, kind: kind === 'TP' ? 'TAKE_PROFIT' : 'STOP_LOSS', triggerPrice: trigger, amount: position.baseAmount });
          if (!result.success) throw new Error(result.error || `${label} was rejected.`);
          setNotice(`${label} accepted by Bybit: ${result.orderId || 'exchange acknowledgement received'}.`);
          setConfirm(null); await onRefresh();
        } catch (e: any) { setNotice(e.message || `${label} failed.`); } finally { setBusy(false); }
      }
    });
  };

  const closePosition = () => {
    if (!position || position.baseAmount <= 0 || !livePrice) return;
    setConfirm({
      action: 'CLOSE',
      title: 'Confirm live close',
      body: `A MARKET SELL for ${price(position.baseAmount)} ${baseAsset} will be submitted through the existing Risk Engine and Exchange Execution Engine. Final fill price and realized net result come only from the exchange/backend.`,
      run: async () => {
        setBusy(true); setNotice('');
        try {
          const result = await placeManualOrder({ symbol: activeSymbol, side: 'SELL', type: 'MARKET', price: livePrice, amount: position.baseAmount });
          if (!result.success) throw new Error(result.error || 'Close order was rejected.');
          setNotice(`Close order accepted: ${result.order?.id || 'exchange acknowledgement received'}. Waiting for authoritative fill/reconciliation data.`);
          setConfirm(null); await onRefresh();
        } catch (e: any) { setNotice(e.message || 'Close order failed.'); } finally { setBusy(false); }
      }
    });
  };

  const card = 'rounded-2xl border border-slate-800 bg-slate-950/80 shadow-xl';
  const field = 'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-sky-500';
  const statusClass = freshness === 'LIVE' ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300' : freshness === 'STALE' ? 'border-amber-500/40 bg-amber-950/30 text-amber-300' : 'border-rose-500/40 bg-rose-950/30 text-rose-300';

  if (!isLiveConnected) {
    return <div className="mx-auto max-w-5xl rounded-2xl border border-rose-500/30 bg-rose-950/20 p-8 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-300"><AlertTriangle /></div><h2 className="text-xl font-black uppercase">Live Trading Unavailable</h2><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300">No live exchange/backend state is available. Order controls, balances, prices, positions and profit are intentionally withheld.</p></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Live Trading</div><h1 className="text-2xl font-black tracking-tight">Execute → Protect → Close → Realized Net Profit</h1></div>
        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black ${statusClass}`}><span className="h-2 w-2 rounded-full bg-current" />{freshness}<span className="font-normal opacity-70">backend sync</span></div>
      </div>

      {autoTrading && (
        <section className={`rounded-2xl border p-4 sm:p-5 ${autoTrading.automaticTradingReady ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-amber-500/40 bg-amber-950/20'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Automatic Trading</div>
              <div className={`mt-1 text-xl font-black ${autoTrading.automaticTradingReady ? 'text-emerald-300' : 'text-amber-300'}`}>{autoTrading.automaticTradingReady ? 'READY' : 'BLOCKED'}</div>
              <div className="mt-1 text-sm text-slate-300">{autoTrading.activeSymbol} · Autonomy Level {autoTrading.autonomyLevel}</div>
            </div>
            <div className="text-left sm:text-right text-xs text-slate-400">
              <div>Bybit: <span className={autoTrading.bybitCanTrade ? 'text-emerald-300' : 'text-amber-300'}>{autoTrading.bybitCredentialStatus}</span></div>
              <div className="mt-1">Live market data: <span className={autoTrading.liveMarketData ? 'text-emerald-300' : 'text-amber-300'}>{autoTrading.liveMarketData ? 'LIVE' : 'UNAVAILABLE'}</span></div>
              <div className="mt-1">Candle depth: {autoTrading.candleCount}</div>
            </div>
          </div>
          {!autoTrading.automaticTradingReady && autoTrading.blockers?.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-slate-950/30 p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-200">Why automatic trading is blocked</div>
              <ul className="mt-2 space-y-1 text-xs text-slate-300">{autoTrading.blockers.map((blocker: string, index: number) => <li key={index}>• {blocker}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_.85fr]">
        <section className={`${card} p-4 sm:p-5`}>
          <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-bold uppercase text-slate-500">
            <span className="rounded-full bg-sky-500/10 px-3 py-1 text-sky-300">1. Choose Pair</span><span>→</span><span>2. Buy/Sell</span><span>→</span><span>3. Amount</span><span>→</span><span>4. Review</span><span>→</span><span>5. Place</span>
          </div>
          <select value={activeSymbol} onChange={e => onSelectSymbol(e.target.value)} className={field}>
            {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol} · {price(p.price)} · {pct(p.change24hPct)}</option>)}
          </select>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button onClick={() => setSide('BUY')} className={`rounded-2xl px-4 py-5 text-lg font-black transition ${side === 'BUY' ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-900/30' : 'border border-emerald-500/30 bg-emerald-950/20 text-emerald-300'}`}><TrendingUp className="mx-auto mb-1" />BUY</button>
            <button onClick={() => setSide('SELL')} className={`rounded-2xl px-4 py-5 text-lg font-black transition ${side === 'SELL' ? 'bg-rose-500 text-white shadow-lg shadow-rose-900/30' : 'border border-rose-500/30 bg-rose-950/20 text-rose-300'}`}><TrendingDown className="mx-auto mb-1" />SELL</button>
          </div>

          <div className="mt-4 grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-900 p-1">
            {(['MARKET','LIMIT'] as const).map(t => <button key={t} onClick={() => setOrderType(t)} className={`rounded-lg py-2 text-xs font-black ${orderType === t ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>{t}</button>)}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold uppercase text-slate-500">Amount ({baseAsset})<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.000000" className={`${field} mt-1`} /></label>
            <label className="text-xs font-bold uppercase text-slate-500">Price (USDT){orderType === 'MARKET' ? <span className="ml-1 normal-case text-sky-400">live market</span> : null}<input inputMode="decimal" value={orderType === 'MARKET' ? (livePrice ? String(livePrice) : '') : limitPrice} onChange={e => orderType === 'LIMIT' && setLimitPrice(e.target.value)} disabled={orderType === 'MARKET'} placeholder={livePrice ? String(livePrice) : 'Unavailable'} className={`${field} mt-1 disabled:opacity-50`} /></label>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Live price</span><b>{price(livePrice)}</b></div>
            <div className="mt-2 flex justify-between"><span className="text-slate-400">Estimated notional</span><b>{money(notional)}</b></div>
            <div className="mt-2 flex justify-between"><span className="text-slate-400">Estimated fee</span><b>{preview ? money(preview.estimatedFeeUsd) : 'Review required'}</b></div>
            <div className="mt-2 flex justify-between"><span className="text-slate-400">Expected net edge</span><b className={preview?.expectedNetEdge?.isTradeable ? 'text-emerald-300' : 'text-amber-300'}>{preview ? `${preview.expectedNetEdge.expectedNetEdgeBps} bps` : 'Not calculated'}</b></div>
          </div>

          <button onClick={runPreview} disabled={busy || !canTradeReason.ok} className="mt-4 w-full rounded-xl bg-sky-500 px-4 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Checking live gate…' : '4. REVIEW FEES + RISK'}</button>
          {preview && <button onClick={() => setConfirm({ action:'ORDER', title:`Confirm live ${side} ${activeSymbol}`, body:`${orderType} ${side} ${amount} ${baseAsset} at estimated ${price(preview.estimatedExecutionPrice)}. Fee estimate ${money(preview.estimatedFeeUsd)}; expected net edge ${preview.expectedNetEdge.expectedNetEdgeBps} bps. Final fill, fees and realized result come only from Bybit/backend.`, run: placeOrder })} disabled={busy || !preview.expectedNetEdge.isTradeable} className="mt-2 w-full rounded-xl bg-white px-4 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">5. PLACE LIVE ORDER</button>}
          {!canTradeReason.ok && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200"><b>Why trading is blocked:</b> {canTradeReason.text}</div>}
          {canTradeReason.ok && <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-200"><b>Why can I trade?</b> {canTradeReason.text}</div>}
          {notice && <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200">{notice}</div>}
        </section>

        <section className={`${card} p-4 sm:p-5`}>
          <div className="flex items-center justify-between"><div><div className="text-xs font-bold uppercase tracking-wider text-slate-500">6. Track Position</div><h2 className="text-lg font-black">{activeSymbol}</h2></div><CircleDollarSign className="text-sky-400" /></div>
          {position && position.baseAmount > 0 ? <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Entry" value={price(position.entryPrice)} /><Metric label="Current" value={price(livePrice)} /><Metric label="Unrealized PnL" value={money(position.unrealizedPnL)} /><Metric label="Realized PnL" value={money(position.realizedPnL)} />
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="flex justify-between text-sm"><span className="text-slate-400">Unrealized</span><b className={position.unrealizedPnL >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{money(position.unrealizedPnL)} · {pct(position.unrealizedPnLPct)}</b></div><div className="mt-2 flex justify-between text-sm"><span className="text-slate-400">Position net PnL</span><b>{money(position.netPnL)}</b></div><div className="mt-2 flex justify-between text-sm"><span className="text-slate-400">Fees paid</span><b>{money(position.totalFeesPaid)}</b></div></div>
            <div className="pt-2 text-xs font-bold uppercase text-slate-500">7. Take Profit / Stop Loss</div>
            <div className="grid gap-2 sm:grid-cols-2"><input inputMode="decimal" value={tpPrice} onChange={e=>setTpPrice(e.target.value)} placeholder="TP trigger above live price" className={field}/><button onClick={()=>protect('TP')} className="rounded-xl bg-emerald-500 px-4 py-3 font-black text-slate-950">TAKE PROFIT</button><input inputMode="decimal" value={slPrice} onChange={e=>setSlPrice(e.target.value)} placeholder="SL trigger below live price" className={field}/><button onClick={()=>protect('SL')} className="rounded-xl bg-amber-400 px-4 py-3 font-black text-slate-950">STOP LOSS</button></div>
            <button onClick={closePosition} className="mt-2 w-full rounded-xl border border-rose-500/60 bg-rose-950/30 px-4 py-3 font-black text-rose-200">8. CLOSE POSITION</button>
          </div> : <div className="mt-5 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No authoritative open position for this pair.</div>}
        </section>
      </div>

      <section className={`${card} p-4 sm:p-5`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-bold uppercase tracking-wider text-slate-500">9. Realized Net Profit</div><div className="mt-1 text-3xl font-black">{money(realizedNet)}</div></div><div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-400"><CheckCircle2 className="mr-2 inline text-emerald-400" size={15}/>Computed only from authoritative backend fills; no synthetic PnL.</div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3"><Metric label="Available cash" value={money(state.capital?.availableCash)} /><Metric label="Locked in orders" value={money(state.capital?.lockedInOrders)} /><Metric label="Eligible realized profit" value={money(state.capital?.eligibleRealizedProfit)} /></div>
      </section>

      {confirm && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 sm:items-center"><div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-lg font-black">{confirm.title}</h3><button onClick={()=>setConfirm(null)} className="rounded-lg p-2 text-slate-500 hover:text-white"><X/></button></div><p className="mt-3 text-sm leading-6 text-slate-300">{confirm.body}</p><div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200"><LockKeyhole size={16}/> Live order. Authentication, risk gates, kill switch and fail-closed protections remain authoritative.</div><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={()=>setConfirm(null)} className="rounded-xl border border-slate-700 py-3 font-bold">Cancel</button><button disabled={busy} onClick={confirm.run} className="rounded-xl bg-white py-3 font-black text-slate-950">{busy ? 'Submitting…' : 'Confirm Live Action'}</button></div></div></div>}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 truncate text-sm font-black text-white">{value}</div></div>;
