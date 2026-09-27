import React, { useMemo, useState } from 'react';
import { AlertTriangle, Bot, CircleDollarSign, ShieldCheck, Square, TrendingDown, TrendingUp } from 'lucide-react';
import { MasterTradingState, Position } from '../../types/trading';
import { startAutonomousTrading, stopAutonomousTrading } from '../../services/tradingService';

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
  const [allocatedCapital, setAllocatedCapital] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmStart, setConfirmStart] = useState(false);

  const position = ((state as any).position || null) as Position | null;
  const activeSymbol = state.activeSymbol;
  const bot = state.autonomousBot;
  const livePrice = typeof pairDetails?.currentPrice === 'number' && pairDetails.currentPrice > 0 ? pairDetails.currentPrice : null;
  const allocation = Number(allocatedCapital);
  const availableCash = state.capital?.availableCash;
  const allocationValid = Number.isFinite(allocation) && allocation > 0 && Number.isFinite(availableCash) && allocation <= availableCash;
  const failClosed = Boolean(state.failClosedStatus?.failClosed);
  const killActive = Boolean(state.GLOBAL_KILL_SWITCH_ACTIVE || state.killSwitch?.isActive);
  const blockedReason = useMemo(() => {
    if (!isLiveConnected) return 'Live backend or exchange market data is unavailable.';
    if (!isOwnerAuthenticated) return 'Owner authentication is required.';
    if (killActive && !bot?.startupSafetyLatch) return state.killSwitch?.reason || 'Global kill switch is active.';
    if (failClosed) return `FAIL-CLOSED: ${state.failClosedStatus?.downEngines?.join(', ') || 'critical engine degradation'}.`;
    if (state.circuitBreakerActive) return 'Risk circuit breaker is active.';
    if (bot?.status === 'BLOCKED') return bot.decisionReason || 'Autonomous trading is blocked by a safety gate.';
    return '';
  }, [isLiveConnected, isOwnerAuthenticated, killActive, state.killSwitch, failClosed, state.failClosedStatus, state.circuitBreakerActive, bot]);

  const botStatus = killActive ? 'BLOCKED' : (bot?.status || 'PAUSED');
  const statusClass = botStatus === 'RUNNING'
    ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
    : botStatus === 'BLOCKED'
      ? 'border-rose-500/40 bg-rose-950/30 text-rose-300'
      : 'border-amber-500/40 bg-amber-950/30 text-amber-300';

  const reason = blockedReason || bot?.decisionReason || 'No-trade decisions remain authoritative; the engine will wait until every required gate passes.';
  const currentEdge = bot?.currentNetEdgeBps;
  const hurdle = bot?.requiredNetEdgeBps;

  const startBot = async () => {
    setBusy(true);
    setNotice('');
    try {
      const result = await startAutonomousTrading(activeSymbol, allocation);
      if (!result.success) throw new Error(result.error || 'Autonomous trading could not start.');
      setConfirmStart(false);
      setNotice(`Autonomous bot started for ${result.activeSymbol || activeSymbol} with ${money(result.allocatedCapitalUsd)} allocated capital.`);
      await onRefresh();
    } catch (e: any) {
      setNotice(e?.message || 'Autonomous trading start failed.');
    } finally {
      setBusy(false);
    }
  };

  const stopBot = async () => {
    setBusy(true);
    setNotice('');
    try {
      const result = await stopAutonomousTrading();
      if (!result.success) throw new Error(result.error || 'Autonomous bot stop/reconciliation failed.');
      setNotice(`Bot paused. ${result.cancelledEntryOrders ?? 0} new entry order(s) cancelled and ${result.reconciledCount ?? 0} order(s) reconciled.`);
      await onRefresh();
    } catch (e: any) {
      setNotice(e?.message || 'Autonomous bot stop failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!isLiveConnected) {
    return (
      <div className="mx-auto max-w-4xl rounded-2xl border border-rose-500/30 bg-rose-950/20 p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 text-rose-300" />
        <h2 className="text-xl font-black uppercase">Live Trading Unavailable</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300">Authoritative live exchange state is unavailable, so GigPilot will not display or invent trading values.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Autonomous Trading</div>
          <h1 className="text-2xl font-black tracking-tight">Choose → Confirm → Bot Trades</h1>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black ${statusClass}`}>
          <Bot size={15} /> BOT: {botStatus}
        </div>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-xl sm:p-6">
        <div className="mb-5 grid grid-cols-5 gap-1 text-center text-[10px] font-black uppercase tracking-wider text-slate-500 sm:text-xs">
          {['1. Pair', '2. Capital', '3. Risk', '4. Confirm', '5. Bot Trades'].map((step) => <div key={step} className="rounded-lg bg-slate-900 px-2 py-2">{step}</div>)}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Select coin pair
            <select value={activeSymbol} onChange={e => onSelectSymbol(e.target.value)} disabled={botStatus === 'RUNNING'} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-bold text-white disabled:opacity-60">
              {pairs.map(p => <option key={p.symbol} value={p.symbol}>{p.symbol} · {price(p.price)} · {pct(p.change24hPct)}</option>)}
            </select>
          </label>

          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Choose trading capital (USDT)
            <input
              inputMode="decimal"
              value={allocatedCapital}
              onChange={e => setAllocatedCapital(e.target.value)}
              placeholder={bot?.allocatedCapitalUsd ? String(bot.allocatedCapitalUsd) : 'Enter amount'}
              disabled={botStatus === 'RUNNING'}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm font-bold text-white disabled:opacity-60"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Available cash" value={money(availableCash)} />
          <Metric label="Allocated capital" value={bot?.allocatedCapitalUsd ? money(bot.allocatedCapitalUsd) : allocationValid ? money(allocation) : '—'} />
          <Metric label="Current net edge" value={typeof currentEdge === 'number' ? `${currentEdge.toFixed(2)} bps` : '—'} />
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400"><ShieldCheck size={15} /> Review risk</div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <RiskRow label="Expected net edge gate" value={typeof currentEdge === 'number' && typeof hurdle === 'number' ? `${currentEdge.toFixed(2)} bps vs > ${hurdle.toFixed(2)} bps` : 'Verified at every candidate entry'} ok={typeof currentEdge === 'number' ? currentEdge > (hurdle ?? Infinity) : true} />
            <RiskRow label="Drawdown" value={pct(state.capital?.currentDrawdownPct)} ok={!state.capital || state.capital.currentDrawdownPct < 15} />
            <RiskRow label="Risk circuit breaker" value={state.circuitBreakerActive ? 'ACTIVE' : 'CLEAR'} ok={!state.circuitBreakerActive} />
            <RiskRow label="System fail-closed" value={failClosed ? 'ACTIVE' : 'CLEAR'} ok={!failClosed} />
            <RiskRow label="Global kill switch" value={bot?.startupSafetyLatch ? 'STARTUP SAFETY LATCH' : killActive ? 'ACTIVE' : 'CLEAR'} ok={!killActive || Boolean(bot?.startupSafetyLatch)} />
            <RiskRow label="Live market price" value={price(livePrice)} ok={Boolean(livePrice)} />
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">The backend remains authoritative: every entry must pass live-data, exchange, reconciliation, accounting, risk and strict expected-net-edge gates. Profit cannot be guaranteed.</p>
        </div>

        {botStatus !== 'RUNNING' ? (
          <>
            <button
              onClick={() => setConfirmStart(true)}
              disabled={busy || !isOwnerAuthenticated || !allocationValid || Boolean(blockedReason)}
              className="mt-4 w-full rounded-xl bg-emerald-500 px-5 py-4 text-lg font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              CONFIRM & START AUTONOMOUS BOT
            </button>
            {blockedReason && <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200"><b>Why no trade:</b> {blockedReason}</div>}
            {bot?.startupSafetyLatch && <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-950/20 p-3 text-xs text-sky-200">The startup safety latch is active by design. Your explicit confirmation may clear this startup-only latch after all live safety checks pass; emergency/risk-triggered kill states cannot be bypassed.</div>}
            {!allocationValid && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200">Enter a positive allocation no greater than the authoritative available cash balance.</div>}
          </>
        ) : (
          <button onClick={stopBot} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/70 bg-rose-950/30 px-5 py-4 text-lg font-black text-rose-200 disabled:opacity-50">
            <Square size={18} fill="currentColor" /> STOP BOT
          </button>
        )}

        {notice && <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200">{notice}</div>}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-xl sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Selected pair" value={activeSymbol} />
          <Metric label="Bot status" value={botStatus} />
          <Metric label="Entry price" value={price(position?.entryPrice)} />
          <Metric label="Current price" value={price(livePrice)} />
          <Metric label="Realized net PnL" value={money(state.capital?.netRealizedProfit)} />
          <Metric label="Unrealized PnL" value={money(position?.unrealizedPnL ?? state.capital?.unrealizedProfit)} />
          <Metric label="Fees" value={money(state.capital?.totalTradingFees)} />
          <Metric label="Current net edge" value={typeof currentEdge === 'number' ? `${currentEdge.toFixed(2)} bps` : '—'} />
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Trade / no-trade reason</div>
          <div className="mt-1 text-sm font-semibold text-slate-200">{reason}</div>
        </div>

        {position && position.baseAmount > 0 ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-sky-500/20 bg-sky-950/20 p-4">
            <CircleDollarSign className="text-sky-300" />
            <div><div className="text-xs font-bold uppercase text-slate-500">Current position</div><div className="font-black">{price(position.baseAmount)} base units · {money(position.netPnL)} net position PnL</div></div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">No authoritative open position.</div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase text-slate-500"><TrendingUp size={14} /> Autonomous cycle</div>
            <p className="mt-2 text-sm text-slate-300">Market analysis → entry gate → execution → position/grid management → exit → reconciliation → realized net PnL → repeat.</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center gap-2 text-xs font-black uppercase text-slate-500"><TrendingDown size={14} /> Fail-closed behavior</div>
            <p className="mt-2 text-sm text-slate-300">Any unhealthy critical dependency blocks new entries. STOP BOT cancels new autonomous entry orders and reconciles; it does not liquidate existing positions.</p>
          </div>
        </div>
      </section>

      {confirmStart && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
            <div className="text-xs font-black uppercase tracking-wider text-emerald-400">Explicit confirmation required</div>
            <h2 className="mt-2 text-xl font-black">Start autonomous trading?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">GigPilot will use the existing live trading engine for {activeSymbol}, with {money(allocation)} allocated capital. It will only submit entries that pass the existing risk and verified expected-net-edge gates.</p>
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200">No profit outcome can be guaranteed. Authentication, kill switch, fail-closed controls, reconciliation, accounting and withdrawal restrictions remain authoritative.</div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmStart(false)} className="rounded-xl border border-slate-700 py-3 font-bold">Cancel</button>
              <button disabled={busy} onClick={startBot} className="rounded-xl bg-emerald-500 py-3 font-black text-slate-950">{busy ? 'Starting…' : 'CONFIRM'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div className="mt-1 truncate text-sm font-black text-white">{value}</div>
  </div>
);

const RiskRow = ({ label, value, ok }: { label: string; value: string; ok: boolean }) => (
  <div className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
    <span className="text-slate-400">{label}</span>
    <span className={ok ? 'font-bold text-emerald-300' : 'font-bold text-rose-300'}>{value}</span>
  </div>
);
