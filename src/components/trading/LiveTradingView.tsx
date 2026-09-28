import { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Play,
  ShieldCheck,
  Square,
  Wallet
} from 'lucide-react';
import { MasterTradingState } from '../../types/trading';
import { startAutonomousTrading, stopAutonomousTrading } from '../../services/tradingService';
import { deriveBotStatus, money, price, type Pair } from './autonomousBotLogic';

/**
 * ONE-ACTION AUTONOMOUS TRADING VIEW
 * Owner does exactly: 1) select coin pair, 2) allocate capital, 3) confirm START.
 * The full lifecycle (scan -> strategy -> entry -> orders -> TP/SL -> manage ->
 * exit -> reinvest/compound -> reconcile -> fees -> realized net PnL -> optimize)
 * runs autonomously in the fail-closed server engine. No manual trading workflow.
 * UI surface: Coin Pair, Capital Allocation, START, Live/Paused/Blocked status,
 * Realized Net PnL, Current Position, STOP BOT. Nothing else.
 * Non-negotiables: never fabricate profit (all numbers from live /state, else '—'),
 * START disabled fail-closed on kill switch / degradation / circuit breaker /
 * missing auth; allocation can never exceed available cash.
 */

type LiveTradingViewProps = {
  state: MasterTradingState;
  pairs: Pair[];
  pairDetails: any;
  isLiveConnected: boolean;
  isOwnerAuthenticated: boolean;
  onSelectSymbol: (symbol: string) => Promise<void>;
  onRefresh: () => Promise<void> | void;
};

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div
        className={`mt-0.5 font-mono text-sm font-bold ${
          tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-rose-400' : 'text-slate-200'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export const LiveTradingView = ({
  state, pairs, pairDetails, isLiveConnected, isOwnerAuthenticated, onSelectSymbol, onRefresh
}: LiveTradingViewProps) => {
  const [allocatedCapital, setAllocatedCapital] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmStart, setConfirmStart] = useState(false);

  const allocation = Number(allocatedCapital);
  const d = deriveBotStatus(state, { isLiveConnected, isOwnerAuthenticated, allocation, busy });
  const bot = state.autonomousBot;
  const livePrice =
    typeof pairDetails?.currentPrice === 'number' && pairDetails.currentPrice > 0
      ? pairDetails.currentPrice : null;
  const availableCash = state.capital?.availableCash;
  const position = d.position;

  const startBot = async () => {
    setBusy(true); setNotice('');
    try {
      const result = await startAutonomousTrading(d.activeSymbol, allocation);
      if (!result.success) throw new Error(result.error || 'Autonomous trading could not start.');
      setConfirmStart(false);
      setNotice(`Autonomous bot started for ${result.activeSymbol || d.activeSymbol} with ${money(result.allocatedCapitalUsd)} allocated capital.`);
      await onRefresh();
    } catch (e: any) {
      setNotice(e?.message || 'Autonomous trading start failed.');
    } finally {
      setBusy(false);
    }
  };

  const stopBot = async () => {
    setBusy(true); setNotice('');
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

  // FAIL-CLOSED RENDER: never display invented trading values when the live
  // backend or exchange feed is unreachable.
  if (!isLiveConnected) {
    return (
      <div className="mx-auto max-w-4xl rounded-2xl border border-rose-500/30 bg-rose-950/20 p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 text-rose-300" />
        <h2 className="text-xl font-black uppercase">Live Trading Unavailable</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300">
          Authoritative live exchange state is unavailable, so GigPilot will not display or invent trading values.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            One-Action Autonomous Trading
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-100">
            {d.activeSymbol}
            {livePrice !== null && (
              <span className="ml-2 font-mono text-sm font-semibold text-slate-400">{price(livePrice)}</span>
            )}
          </h1>
        </div>
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${d.statusClass}`}>
          <Bot className="h-4 w-4" />
          <span className="font-mono text-sm font-black uppercase tracking-wider">{d.botStatus}</span>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Realized Net PnL</div>
            <div className={`mt-1 font-mono text-3xl font-black ${
              (state.capital?.netRealizedProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {money(state.capital?.netRealizedProfit)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Fees Paid</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-300">
              {money(state.capital?.totalTradingFees)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Current Position</div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
            position && position.baseAmount > 0
              ? 'border-sky-500/40 bg-sky-950/40 text-sky-300'
              : 'border-slate-700 bg-slate-900 text-slate-500'
          }`}>
            {position && position.baseAmount > 0 ? 'OPEN' : 'FLAT'}
          </span>
        </div>
        {position && position.baseAmount > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Size" value={price(position.baseAmount)} />
            <Metric label="Entry" value={price(position.entryPrice)} />
            <Metric label="Mark" value={price(position.currentPrice)} />
            <Metric label="Unrealized" value={money(position.unrealizedPnL)}
              tone={(position.unrealizedPnL ?? 0) >= 0 ? 'up' : 'down'} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            No open position. The engine enters only when the verified net edge passes the profit gate.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">1. Coin Pair</label>
            <select
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-sm text-slate-100 outline-none focus:border-emerald-500/60"
              value={d.activeSymbol}
              onChange={(e) => {
                setConfirmStart(false);
                void onSelectSymbol(e.target.value);
              }}
              disabled={busy || d.botStatus === 'RUNNING'}
            >
              {pairs.map((p) => (
                <option key={p.symbol} value={p.symbol}>{p.symbol}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500">2. Capital Allocation (USD)</label>
            <div className="relative mt-2">
              <Wallet className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-3 font-mono text-sm text-slate-100 outline-none focus:border-emerald-500/60 disabled:opacity-50"
                value={allocatedCapital}
                onChange={(e) => {
                  setAllocatedCapital(e.target.value);
                  setConfirmStart(false);
                }}
                disabled={busy || d.botStatus === 'RUNNING'}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Available: {money(availableCash)}</span>
              {d.overAllocated && (
                <span className="font-bold text-rose-400">Exceeds available cash — allocation capped fail-closed.</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5">
          {confirmStart ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div className="text-sm leading-5 text-slate-200">
                  <span className="font-black text-emerald-300">Confirm start.</span> GigPilot will
                  autonomously scan, select strategy, enter, place TP/SL, manage, exit and compound on{' '}
                  <span className="font-mono font-bold">{d.activeSymbol}</span> with{' '}
                  <span className="font-mono font-bold">{money(allocation)}</span>. It trades only when
                  the verified net edge passes the profit gate and automatically does nothing when
                  conditions are unfavorable.
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={startBot}
                  disabled={busy || !d.allocationValid}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black uppercase tracking-wider text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="h-4 w-4" />
                  {busy ? 'Starting…' : 'Confirm START'}
                </button>
                <button
                  onClick={() => setConfirmStart(false)}
                  className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-300 transition hover:border-slate-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmStart(true)}
              disabled={!d.canStart}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black uppercase tracking-widest text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play className="h-5 w-5" />
              Start Autonomous Trading
            </button>
          )}
        </div>

        {d.botStatus === 'RUNNING' && (
          <button
            onClick={stopBot}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-600/50 bg-rose-950/30 px-4 py-3 text-sm font-black uppercase tracking-widest text-rose-300 transition hover:bg-rose-950/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Square className="h-5 w-5" />
            {busy ? 'Stopping…' : 'Stop Bot'}
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Engine Decision</span>
          {typeof bot?.currentNetEdgeBps === 'number' && (
            <span className="font-mono text-xs text-slate-400">
              Edge {bot.currentNetEdgeBps.toFixed(1)} bps / gate {bot.requiredNetEdgeBps?.toFixed(1) ?? '—'} bps
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-400">{d.reason}</p>
      </section>

      {notice && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
          {notice}
        </div>
      )}
    </div>
  );
};
