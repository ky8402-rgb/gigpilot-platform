import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  Gauge,
  Radio,
  ShieldCheck,
  ShieldX,
  Target,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff
} from 'lucide-react';
import { MasterTradingState } from '../../types/trading';

interface OperatorOverviewProps {
  state: MasterTradingState;
  isLiveConnected: boolean;
  lastSyncTime?: string;
}

const money = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

const pct = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';

const bps = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)} bps` : '—';

const ageSeconds = (timestamp?: string) => {
  if (!timestamp) return Infinity;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 1000) : Infinity;
};

const statusClass = (status: string) => {
  if (status === 'HEALTHY' || status === 'PASS' || status === 'OPEN') return 'text-emerald-300';
  if (status === 'DEGRADED' || status === 'WARNING') return 'text-amber-300';
  return 'text-rose-300';
};

export const OperatorOverview: React.FC<OperatorOverviewProps> = ({
  state,
  isLiveConnected,
  lastSyncTime
}) => {
  const capital = state.capital;
  const audit = state.autonomousOptimizer?.latestAudit;
  const edge = audit?.expectedNetEdge;
  const latestDecision = state.decisionStats?.recentDecisions?.[0];
  const position = state.position;
  const positionExposure = Math.abs(position?.quoteAmount ?? 0);
  const orderExposure = (state.openOrders || []).reduce(
    (sum, order) => sum + Math.max(0, Number(order.costUsd) || Number(order.price * order.amount) || 0),
    0
  );
  const grossExposure = positionExposure + orderExposure;

  const blockers: string[] = [];
  if (!isLiveConnected) blockers.push('Backend telemetry is not connected');
  if (state.GLOBAL_KILL_SWITCH_ACTIVE || state.killSwitch?.isActive) blockers.push('Global kill switch is active');
  if (state.failClosedStatus?.failClosed) blockers.push(`Fail-closed: ${state.failClosedStatus.downEngines.join(', ')}`);
  if (state.circuitBreakerActive) blockers.push('Risk circuit breaker is active');
  if (state.autonomyLevel === 0) blockers.push('Autonomy level is 0');
  if (edge && !edge.isTradeable) blockers.push(`Net edge ${bps(edge.expectedNetEdgeBps)} is below ${bps(edge.minHurdleRateBps)} hurdle`);
  if (latestDecision?.finalOutcome === 'DO_NOTHING') {
    blockers.push(latestDecision.rejectionReason || latestDecision.rationale || 'Latest decision is DO NOTHING');
  }

  const canTrade = isLiveConnected && blockers.length === 0;
  const engineErrors = (state.engines || [])
    .flatMap(engine => (engine.errorSurface || []).map(error => ({ engine, error })))
    .slice(0, 5);

  const dataEngine = state.engines?.find(engine => engine.id === 'DATA_ENGINE');
  const dataHeartbeatAge = ageSeconds(dataEngine?.lastHeartbeat);
  const wsHealthy = Boolean(
    dataEngine &&
    dataEngine.status === 'HEALTHY' &&
    dataHeartbeatAge < 60
  );

  const Card: React.FC<{ title: string; value: React.ReactNode; detail?: React.ReactNode; icon?: React.ReactNode; tone?: string }> = ({
    title, value, detail, icon, tone = 'text-white'
  }) => (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-wider text-slate-500">
        <span>{title}</span>
        {icon}
      </div>
      <div className={`mt-1 text-lg font-black font-mono tracking-tight ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-[10px] font-mono text-slate-500 truncate">{detail}</div>}
    </div>
  );

  return (
    <section className="mb-4 rounded-2xl border border-slate-800/90 bg-[#080D17] shadow-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-300" />
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-100">Operator Control Surface</h2>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold text-cyan-300">
              BACKEND-SOURCED
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Decision, profitability, risk, execution and connectivity state from the live trading backend.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          {isLiveConnected ? (
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
              <Wifi className="h-3.5 w-3.5" /> LIVE SYNC
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-rose-300">
              <WifiOff className="h-3.5 w-3.5" /> LIVE DATA OFFLINE
            </span>
          )}
          {lastSyncTime && <span className="text-slate-600">sync {new Date(lastSyncTime).toLocaleTimeString()}</span>}
        </div>
      </div>

      {!isLiveConnected && (
        <div className="border-b border-rose-500/20 bg-rose-950/20 px-4 py-3 text-xs text-rose-200">
          <strong>LIVE DATA REQUIRED.</strong> Operator metrics are withheld until the authenticated backend responds; no local demo values are shown as production truth.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card title="Net profit" value={`$${money(capital.netRealizedProfit)}`} detail={`ROI ${pct(capital.roiPct)}`} icon={capital.netRealizedProfit >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : <TrendingDown className="h-3.5 w-3.5 text-rose-400" />} tone={capital.netRealizedProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
        <Card title="Realized PnL" value={`$${money(capital.netRealizedProfit)}`} detail={`gross $${money(capital.grossProfit)}`} tone="text-white" />
        <Card title="Fees" value={`$${money(capital.totalTradingFees)}`} detail={`slippage $${money(capital.totalSlippageCost)}`} tone="text-amber-200" />
        <Card title="Equity" value={`$${money(capital.totalEquity)}`} detail={`cash $${money(capital.availableCash)}`} tone="text-cyan-200" />
        <Card title="Drawdown" value={pct(capital.currentDrawdownPct)} detail={`max ${pct(capital.maxDrawdownPct)}`} icon={<TrendingDown className="h-3.5 w-3.5 text-amber-400" />} tone={capital.currentDrawdownPct > 0 ? 'text-amber-300' : 'text-emerald-300'} />
        <Card title="Exposure" value={`$${money(grossExposure)}`} detail={`${state.openOrders.length} orders • ${state.allPositions.length} positions`} icon={<Gauge className="h-3.5 w-3.5 text-sky-400" />} tone="text-sky-200" />
      </div>

      <div className="grid grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Profit gate / trade permission</span>
            {canTrade ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <ShieldX className="h-4 w-4 text-rose-400" />}
          </div>
          <div className={`text-sm font-black uppercase ${canTrade ? 'text-emerald-300' : 'text-rose-300'}`}>
            {canTrade ? 'TRADE PERMITTED' : 'TRADING BLOCKED'}
          </div>
          <div className="mt-2 space-y-1 text-[10px] font-mono text-slate-400">
            <div className="flex justify-between"><span>Expected net edge</span><strong className="text-white">{bps(edge?.expectedNetEdgeBps)}</strong></div>
            <div className="flex justify-between"><span>Minimum hurdle</span><strong className="text-white">{bps(edge?.minHurdleRateBps)}</strong></div>
            <div className="flex justify-between"><span>Edge status</span><strong className={statusClass(edge?.isTradeable ? 'PASS' : 'BLOCKED')}>{edge ? (edge.isTradeable ? 'PASS' : 'BLOCK') : 'NO DATA'}</strong></div>
          </div>
          {blockers.length > 0 && (
            <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-950/20 p-2 text-[10px] leading-4 text-rose-200">
              {blockers.slice(0, 3).map((reason, index) => <div key={index}>• {reason}</div>)}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Strategy & latest decision</span>
            <Target className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-sm font-black text-purple-200">{state.championStrategy?.name || 'No active strategy'}</div>
          <div className="mt-0.5 text-[10px] font-mono text-slate-500">{state.championStrategy?.version || '—'} • {state.currentRegime?.regime || 'REGIME UNKNOWN'}</div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2">
            <span className="text-[10px] text-slate-500">Latest outcome</span>
            <strong className={latestDecision?.finalOutcome === 'DO_NOTHING' ? 'text-amber-300' : 'text-emerald-300'}>
              {latestDecision?.finalOutcome || 'NO DECISION'}
            </strong>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-400">
            {latestDecision?.rationale || latestDecision?.rejectionReason || 'No recent decision rationale reported by the backend.'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Exchange / WebSocket health</span>
            <Radio className={`h-4 w-4 ${wsHealthy ? 'text-emerald-400' : 'text-rose-400'}`} />
          </div>
          <div className={`text-sm font-black ${wsHealthy ? 'text-emerald-300' : 'text-rose-300'}`}>
            {wsHealthy ? 'MARKET STREAM HEALTHY' : 'MARKET STREAM DEGRADED'}
          </div>
          <div className="mt-2 space-y-1 text-[10px] font-mono text-slate-400">
            <div className="flex justify-between"><span>Data engine</span><strong className={statusClass(dataEngine?.status || 'DOWN')}>{dataEngine?.status || 'UNKNOWN'}</strong></div>
            <div className="flex justify-between"><span>Latency</span><strong className="text-white">{dataEngine?.latencyMs ?? '—'} ms</strong></div>
            <div className="flex justify-between"><span>Heartbeat age</span><strong className="text-white">{Number.isFinite(dataHeartbeatAge) ? `${Math.round(dataHeartbeatAge)}s` : '—'}</strong></div>
            <div className="flex justify-between"><span>Trading mode</span><strong className="text-cyan-200">{state.tradingMode}</strong></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-slate-800/80 p-3 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Risk state
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div><span className="text-slate-600">Circuit breaker</span><div className={state.circuitBreakerActive ? 'text-rose-300 font-bold' : 'text-emerald-300 font-bold'}>{state.circuitBreakerActive ? 'ACTIVE' : 'CLEAR'}</div></div>
            <div><span className="text-slate-600">Autonomy</span><div className="text-white font-bold">L{state.autonomyLevel}</div></div>
            <div><span className="text-slate-600">Position PnL</span><div className="text-white">${money(position?.netPnL)}</div></div>
            <div><span className="text-slate-600">Unrealized</span><div className="text-white">${money(capital.unrealizedProfit)}</div></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <CircleOff className="h-3.5 w-3.5 text-sky-400" /> Orders & positions
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="text-lg font-black font-mono text-white">{state.openOrders.length}</div><div className="text-[9px] text-slate-600 uppercase">Open orders</div></div>
            <div><div className="text-lg font-black font-mono text-white">{state.allPositions.length}</div><div className="text-[9px] text-slate-600 uppercase">Positions</div></div>
            <div><div className="text-lg font-black font-mono text-white">{state.recentFills.length}</div><div className="text-[9px] text-slate-600 uppercase">Recent fills</div></div>
          </div>
          <div className="mt-2 text-[10px] font-mono text-slate-500">Active symbol: <span className="text-slate-200">{state.activeSymbol}</span></div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Error surface
          </div>
          {engineErrors.length === 0 ? (
            <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> No active engine errors reported</div>
          ) : (
            <div className="space-y-1.5">
              {engineErrors.map(({ engine, error }) => (
                <div key={`${engine.id}-${error.id}`} className="rounded-lg border border-rose-500/20 bg-rose-950/10 p-2">
                  <div className="text-[9px] font-bold text-rose-300">{engine.name} • {error.level}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400 truncate">{error.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {latestDecision && (
        <div className="border-t border-slate-800/80 bg-slate-950/30 px-4 py-2 text-[10px] font-mono text-slate-500">
          <span className="text-slate-600">WHY NOW:</span>{' '}
          <span className="text-slate-300">{latestDecision.rationale || latestDecision.rejectionReason || 'Decision rationale unavailable.'}</span>
          {latestDecision.rejectionGate && <span className="ml-2 text-amber-300">gate={latestDecision.rejectionGate}</span>}
        </div>
      )}
    </section>
  );
};
