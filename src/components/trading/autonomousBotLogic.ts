import { MasterTradingState, Position } from '../../types/trading';

/**
 * Pure derivation logic for the ONE-ACTION autonomous trading view.
 * All values originate from the live authoritative /state endpoint.
 * No fabricated defaults: unavailable data renders as '—' downstream.
 */

export type Pair = { symbol: string; price: number; change24hPct: number };

export const money = (n: number | undefined | null) =>
  typeof n === 'number' && Number.isFinite(n)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
    : '—';

export const price = (n: number | undefined | null) =>
  typeof n === 'number' && Number.isFinite(n)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(n)
    : '—';

export interface BotStatus {
  botStatus: 'RUNNING' | 'PAUSED' | 'BLOCKED';
  statusClass: string;
  blockedReason: string;
  reason: string;
  position: Position | null;
  activeSymbol: string;
  allocationValid: boolean;
  overAllocated: boolean;
  canStart: boolean;
}

export function deriveBotStatus(
  state: MasterTradingState,
  opts: {
    isLiveConnected: boolean;
    isOwnerAuthenticated: boolean;
    allocation: number;
    busy: boolean;
  }
): BotStatus {
  const position = ((state as any).position || null) as Position | null;
  const bot = state.autonomousBot;
  const activeSymbol = state.activeSymbol;
  const availableCash = state.capital?.availableCash;

  const allocation = opts.allocation;
  const allocationValid =
    Number.isFinite(allocation) && allocation > 0 &&
    Number.isFinite(availableCash) && allocation <= availableCash;
  const overAllocated =
    allocation > 0 && Number.isFinite(availableCash) && allocation > availableCash;

  const failClosed = Boolean(state.failClosedStatus?.failClosed);
  const killActive = Boolean(state.GLOBAL_KILL_SWITCH_ACTIVE || state.killSwitch?.isActive);

  // Fail-closed start blocker: every gate must pass before START is allowed.
  let blockedReason = '';
  if (!opts.isLiveConnected) blockedReason = 'Live backend or exchange market data is unavailable.';
  else if (!opts.isOwnerAuthenticated) blockedReason = 'Owner authentication is required.';
  else if (killActive && !bot?.startupSafetyLatch)
    blockedReason = state.killSwitch?.reason || 'Global kill switch is active.';
  else if (failClosed)
    blockedReason = `FAIL-CLOSED: ${state.failClosedStatus?.downEngines?.join(', ') || 'critical engine degradation'}.`;
  else if (state.circuitBreakerActive) blockedReason = 'Risk circuit breaker is active.';
  else if (bot?.status === 'BLOCKED')
    blockedReason = bot.decisionReason || 'Autonomous trading is blocked by a safety gate.';

  const botStatus = (killActive ? 'BLOCKED' : bot?.status || 'PAUSED') as
    | 'RUNNING'
    | 'PAUSED'
    | 'BLOCKED';

  const statusClass =
    botStatus === 'RUNNING'
      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
      : botStatus === 'BLOCKED'
        ? 'border-rose-500/40 bg-rose-950/30 text-rose-300'
        : 'border-amber-500/40 bg-amber-950/30 text-amber-300';

  const reason =
    blockedReason || bot?.decisionReason ||
    'No-trade decisions remain authoritative; the engine waits until every required gate passes.';

  const canStart =
    !blockedReason && !opts.busy && opts.isOwnerAuthenticated &&
    allocationValid && botStatus !== 'RUNNING';

  return {
    botStatus, statusClass, blockedReason, reason, position, activeSymbol,
    allocationValid, overAllocated, canStart
  };
}
