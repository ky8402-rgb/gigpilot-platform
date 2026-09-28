import { useState } from 'react';
import { AlertTriangle, Bot, Play, ShieldCheck, Square, Wallet } from 'lucide-react';
import { MasterTradingState } from '../../types/trading';
import { startAutonomousTrading, stopAutonomousTrading } from '../../services/tradingService';
import { deriveBotStatus, money, price, type Pair } from './autonomousBotLogic';

type LiveTradingViewProps = {
  state: MasterTradingState;
  pairs: Pair[];
  pairDetails: any;
  isLiveConnected: boolean;
  isOwnerAuthenticated: boolean;
  onSelectSymbol: (symbol: string) => Promise<void>;
  onRefresh: () => Promise<void> | void;
};

/**
 * Futures-only autonomous trading surface.
 * Owner action sequence: SELECT -> ALLOCATE -> CONFIRM START.
 * Entries, strategy, leverage, TP/SL, position management, exits,
 * reconciliation, accounting and optimization remain server-owned.
 */
function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-sm font-bold ${tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-rose-400' : 'text-slate-200'}`}>
        {value}
      </div>
    </div>
  );
}

export const LiveTradingView = ({
  state, pairs, isLiveConnected, isOwnerAuthenticated, onSelectSymbol, onRefresh
}: LiveTradingViewProps) => {
  const [allocatedCapital, setAllocatedCapital] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmStart, setConfirmStart] = useState(false);

  const allocation = Number(allocatedCapital);
  const d = deriveBotStatus(state, { isLiveConnected, isOwnerAuthenticated, allocation, busy });
  const risk = state.futuresRisk;
  const position = d.position;
  const positionOpen = Boolean(position && Math.abs(position.baseAmount) > 0);
  const positionSide = positionOpen ? (position!.baseAmount > 0 ? 'LONG' : 'SHORT') : 'FLAT';

  const startBot = async () => {
    setBusy(true);
    setNotice('');
    try {
      const result = await startAutonomousTrading(d.activeSymbol, allocation);
      if (!result.success) throw new Error(result.error || 'Autonomous futures trading could not start.');
      setConfirmStart(false);
      setNotice(`Futures bot started for ${result.activeSymbol || d.activeSymbol} with ${money(result.allocatedCapitalUsd)} allocated capital.`);
      await onRefresh();
    } catch (e: any) {
      setNotice(e?.message || 'Autonomous futures trading start failed.');
    } finally {
      setBusy(false);
    }
  };

  const stopBot = async () => {
    setBusy(true);
    setNotice('');
    try {
      const result = await stopAutonomousTrading();
      if (!result.success) throw new Error(result.error || 'Autonomous futures bot stop/reconciliation failed.');
      setNotice(`Bot stopped for new entries. ${result.cancelledEntryOrders ?? 0} entry order(s) cancelled and ${result.reconciledCount ?? 0} order(s) reconciled.`);
      await onRefresh();
    } catch (e: any) {
      setNotice(e?.message || 'Autonomous futures bot stop failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!isLiveConnected) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-rose-500/30 bg-rose-950/20 p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 text-rose-300" />
        <h2 className="text-xl font-black uppercase">Futures Trading Unavailable</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300">
          Authoritative live futures state is unavailable. GigPilot will not display or invent balances, positions, prices, fills or PnL.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-400">Futures-Only Autonomous</div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-100">USDT Perpetual</h1>
            <p className="mt-1 text-xs text-slate-500">Select a futures pair, allocate capital, confirm START. The bot owns the lifecycle.</p>
          </div>
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${d.statusClass}`}>
            <Bot className="h-4 w-4" />
            <span className="font-mono text-sm font-black uppercase tracking-wider">{d.botStatus}</span>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Futures Pair" value={d.activeSymbol} />
          <Metric label="Allocated Capital" value={state.autonomousBot?.allocatedCapitalUsd ? money(state.autonomousBot.allocatedCapitalUsd) : '—'} />
          <Metric label="Leverage Limit" value={risk?.maxLeverage !== undefined ? `${risk.maxLeverage}x` : '—'} />
          <Metric label="Max Drawdown" value={risk?.maxDrawdownLimitPct !== undefined ? `${risk.maxDrawdownLimitPct}%` : '—'} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Realized Net PnL</div>
        <div className={`mt-1 font-mono text-3xl font-black ${(state.capital?.netRealizedProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {money(state.capital?.netRealizedProfit)}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Current Futures Position</div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${positionOpen ? 'border-sky-500/40 bg-sky-950/40 text-sky-300' : 'border-slate-700 bg-slate-900 text-slate-500'}`}>
            {positionSide}
          </span>
        </div>
        {positionOpen ? (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Size" value={price(Math.abs(position!.baseAmount))} />
            <Metric label="Entry" value={price(position!.entryPrice)} />
            <Metric label="Mark" value={price(position!.currentPrice)} />
            <Metric label="Unrealized PnL" value={money(position!.unrealizedPnL)} tone={(position!.unrealizedPnL ?? 0) >= 0 ? 'up' : 'down'} />
            {position!.liquidationPrice !== undefined && <Metric label="Liquidation Price" value={price(position!.liquidationPrice)} />}
            {position!.leverage !== undefined && <Metric label="Exchange Leverage" value={`${position!.leverage}x`} />}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">FLAT — the autonomous engine waits for a verified trade opportunity.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">1. Select Futures Pair</label>
            <select
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 font-mono text-sm text-slate-100 outline-none focus:border-emerald-500/60"
              value={d.activeSymbol}
              onChange={(e) => { setConfirmStart(false); void onSelectSymbol(e.target.value); }}
              disabled={busy || d.botStatus === 'RUNNING'}
            >
              {pairs.map((p) => <option key={p.symbol} value={p.symbol}>{p.symbol} Perpetual</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">2. Allocate Capital (USDT)</label>
            <div className="relative mt-2">
              <Wallet className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-10 pr-3 font-mono text-sm text-slate-100 outline-none focus:border-emerald-500/60 disabled:opacity-50"
                value={allocatedCapital}
                onChange={(e) => { setAllocatedCapital(e.target.value); setConfirmStart(false); }}
                disabled={busy || d.botStatus === 'RUNNING'}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>Available collateral: {money(state.capital?.availableCash)}</span>
              {d.overAllocated && <span className="font-bold text-rose-400">Exceeds available collateral.</span>}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs leading-5 text-slate-400">
          <div className="font-bold uppercase tracking-wider text-slate-500">Risk Guard</div>
          <div className="mt-1">
            Auto leverage ≤ {risk?.maxLeverage !== undefined ? `${risk.maxLeverage}x` : '—'} ·
            Max exposure {risk?.maxExposureUsd !== undefined ? money(risk.maxExposureUsd) : '—'} ·
            Max allocation {risk?.maxCapitalAllocationPct !== undefined ? `${risk.maxCapitalAllocationPct}%` : '—'} ·
            Net-edge gate {risk?.minimumNetEdgeBps !== undefined ? `${risk.minimumNetEdgeBps} bps` : '—'}.
          </div>
        </div>

        <div className="mt-5">
          {confirmStart ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div className="text-sm leading-6 text-slate-200">
                  <span className="font-black text-emerald-300">Confirm START.</span> GigPilot will autonomously
                  analyze the live futures market, select strategy, apply risk-bounded leverage, enter only when
                  verified net edge passes the gate, protect and manage the position, exit, reconcile, account for
                  realized net PnL, and repeat. Manual order entry is disabled.
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={startBot}
                  disabled={busy || !d.allocationValid}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black uppercase tracking-wider text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="h-4 w-4" />
                  {busy ? 'Starting…' : 'Confirm START'}
                </button>
                <button onClick={() => setConfirmStart(false)} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-bold text-slate-300">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmStart(true)}
              disabled={!d.canStart}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-black uppercase tracking-widest text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play className="h-5 w-5" />
              Confirm Start Autonomous Futures Bot
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
            {busy ? 'Stopping…' : 'STOP BOT'}
          </button>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Autonomous Decision</div>
        <p className="mt-2 text-sm leading-6 text-slate-400">{d.reason}</p>
      </section>

      {notice && <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">{notice}</div>}
    </div>
  );
};
