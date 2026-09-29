/**
 * Capital and leverage planning for autonomous grid trading.
 *
 * Why this is a separate pure module: every number here decides whether real money is
 * allowed to move, and the operator reads these figures before pressing START. Keeping the
 * arithmetic free of I/O makes it directly testable (scripts/test-capital-plan.mjs) instead
 * of only reachable through a live authenticated request.
 *
 * The rules, in order:
 *
 *  1. The account reserve is untouchable, and no more than `maxCapitalAllocationPct` of cash
 *     may ever be deployed. Allocatable = min(cash - reserve, cash * pct).
 *  2. A grid needs `levels` rungs and the exchange rejects any order below its minimum
 *     notional, so the minimum *margin* a viable grid needs is
 *     (minNotional * levels) / leverage.
 *  3. Leverage multiplies the notional a given margin controls, so it is the only lever that
 *     genuinely reduces the cash required to trade. That is precisely why its ceiling stays a
 *     configured risk limit rather than a free parameter.
 *  4. Requirements come from the LIVE exchange instrument spec, never from a fixed deposit
 *     figure, so the smallest grid that can actually trade is the one that gets offered.
 */

/** Mirrors the level bounds enforced by the /grid/configure route. */
export const HARD_MIN_GRID_LEVELS = 4;
export const HARD_MAX_GRID_LEVELS = 64;
export const DEFAULT_GRID_LEVELS = 16;

export type LeverageCeilingSource = 'CONFIG' | 'EXCHANGE' | 'CONFIG_AND_EXCHANGE';

export interface CapitalPlanInput {
  availableCashUsd: number;
  minAccountReserveUsd: number;
  maxCapitalAllocationPct: number;
  /** Live exchange minimum notional per order; 0 means "could not be resolved". */
  minNotionalUsd: number;
  /** Resolved leverage range (see resolveLeverage) — the plan sizes against `.effective`. */
  leverage: LeverageRange;
  requestedLevels?: number | null;
}

export interface LeverageRange {
  min: number;
  max: number;
  step: number;
  configuredMax: number;
  instrumentMax: number | null;
  ceilingSource: LeverageCeilingSource;
  requested: number;
  effective: number;
  /** Present only when the requested leverage was refused; the request must FAIL, not clamp. */
  rejected?: string;
}

export interface CapitalPlanResult {
  availableCashUsd: number;
  minAccountReserveUsd: number;
  maxCapitalAllocationPct: number;
  maxAllocatableUsd: number;
  leverage: LeverageRange;
  minimumViableLevels: number;
  requestedLevels: number;
  effectiveLevels: number;
  maxAffordableLevels: number;
  perRungUsd: number;
  exchangeMinNotionalUsd: number;
  minRequiredForGridUsd: number;
  /** Exact account cash needed for the smallest viable grid; null when it cannot be derived. */
  requiredMinCashUsd: number | null;
  shortfallUsd: number | null;
  canTrade: boolean;
  /** Why trading is impossible right now. Empty when canTrade is true. */
  reason: string;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Cash that may be deployed: everything above the reserve, capped by the allocation limit. */
export function computeMaxAllocatableUsd(
  availableCashUsd: number,
  minAccountReserveUsd: number,
  maxCapitalAllocationPct: number,
): number {
  const cash = Number.isFinite(availableCashUsd) ? Math.max(0, availableCashUsd) : 0;
  const byReserve = cash - minAccountReserveUsd;
  const byPct = cash * (maxCapitalAllocationPct / 100);
  return Math.max(0, Math.min(byReserve, byPct));
}

/** Margin (not notional) needed to fund `levels` rungs above the exchange minimum. */
export function computeMinMarginForGridUsd(
  minNotionalUsd: number,
  levels: number,
  leverage: number,
): number {
  if (!isPositiveNumber(minNotionalUsd) || !isPositiveNumber(levels) || !isPositiveNumber(leverage)) {
    return 0;
  }
  return (minNotionalUsd * levels) / leverage;
}

/** How many rungs a given allocatable margin can actually fund at this leverage. */
export function computeMaxAffordableLevels(
  maxAllocatableUsd: number,
  minNotionalUsd: number,
  leverage: number,
): number {
  if (!isPositiveNumber(maxAllocatableUsd) || !isPositiveNumber(minNotionalUsd)) return 0;
  const controllableNotional = maxAllocatableUsd * Math.max(1, leverage);
  return Math.floor(controllableNotional / minNotionalUsd);
}

/**
 * Smallest account cash for which allocation >= `needUsd`.
 *
 * Allocation is a minimum of two linear terms, so the requirement is the point where BOTH
 * clear: cash >= reserve + need, and cash >= need / (pct/100). Solving for the smaller of the
 * two would understate the deposit and leave the operator blocked after funding exactly that.
 */
export function computeRequiredMinCashUsd(
  minAccountReserveUsd: number,
  maxCapitalAllocationPct: number,
  needUsd: number,
): number | null {
  if (!isPositiveNumber(needUsd)) return null;
  const reserveFloor = minAccountReserveUsd + needUsd;
  const pct = maxCapitalAllocationPct / 100;
  const pctFloor = isPositiveNumber(pct) ? needUsd / pct : Number.POSITIVE_INFINITY;
  return Math.max(reserveFloor, pctFloor);
}

/**
 * Resolve the leverage the engine will actually run at.
 *
 * The ceiling is the LOWER of the configured risk limit and the exchange's own limit; a
 * request above it is REJECTED rather than silently clamped, because quietly trading at a
 * different leverage than the operator selected is exactly the kind of surprise a risk
 * control exists to prevent.
 */
export function resolveLeverage(
  requested: number | null | undefined,
  configuredMaxLeverage: number,
  instrumentMaxLeverage: number | null,
  instrumentLeverageStep: number | null,
): LeverageRange {
  const configuredMax = isPositiveNumber(configuredMaxLeverage) ? configuredMaxLeverage : 1;
  const instrumentMax = isPositiveNumber(instrumentMaxLeverage) ? instrumentMaxLeverage : null;
  const ceiling = instrumentMax === null ? configuredMax : Math.min(configuredMax, instrumentMax);
  const ceilingSource: LeverageCeilingSource =
    instrumentMax === null ? 'CONFIG' : configuredMax <= instrumentMax ? 'CONFIG_AND_EXCHANGE' : 'EXCHANGE';
  const step = isPositiveNumber(instrumentLeverageStep) ? instrumentLeverageStep : 1;
  const min = 1;
  const max = Math.max(min, ceiling);

  const wanted = isPositiveNumber(requested) ? requested : min;
  const base: LeverageRange = {
    min,
    max,
    step,
    configuredMax,
    instrumentMax,
    ceilingSource,
    requested: wanted,
    effective: neededLeverage(wanted, min, max),
  };

  if (wanted < min) {
    return { ...base, effective: min, rejected: `Leverage ${wanted}x is below the minimum of ${min}x.` };
  }
  if (wanted > max) {
    return {
      ...base,
      effective: max,
      rejected: `Leverage ${wanted}x exceeds the backend-enforced safe ceiling of ${max}x (configured risk limit ${configuredMax}x${instrumentMax === null ? '' : `, exchange limit ${instrumentMax}x`}). The request was refused rather than silently reduced.`,
    };
  }
  if (step > 1 && Math.abs(wanted / step - Math.round(wanted / step)) > 1e-9) {
    return {
      ...base,
      effective: max,
      rejected: `Leverage ${wanted}x is not a multiple of the exchange step ${step}x.`,
    };
  }
  return base;
}

function neededLeverage(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function buildCapitalPlan(input: CapitalPlanInput): CapitalPlanResult {
  const {
    availableCashUsd,
    minAccountReserveUsd,
    maxCapitalAllocationPct,
    minNotionalUsd,
    leverage,
    requestedLevels,
  } = input;

  const requested = Number.isInteger(requestedLevels)
    ? Math.min(HARD_MAX_GRID_LEVELS, Math.max(HARD_MIN_GRID_LEVELS, requestedLevels as number))
    : DEFAULT_GRID_LEVELS;

  const maxAllocatableUsd = computeMaxAllocatableUsd(
    availableCashUsd,
    minAccountReserveUsd,
    maxCapitalAllocationPct,
  );
  const effectiveLeverage = leverage.effective;
  const minimumViableLevels = HARD_MIN_GRID_LEVELS;
  const minRequiredForGridUsd = computeMinMarginForGridUsd(
    minNotionalUsd,
    minimumViableLevels,
    effectiveLeverage,
  );
  const maxAffordableLevels = computeMaxAffordableLevels(
    maxAllocatableUsd,
    minNotionalUsd,
    effectiveLeverage,
  );
  const effectiveLevels = Math.max(
    minimumViableLevels,
    Math.min(requested, maxAffordableLevels > 0 ? maxAffordableLevels : requested),
  );
  const perRungUsd = isPositiveNumber(minNotionalUsd) ? minNotionalUsd : 0;

  const requiredMinCashUsd = computeRequiredMinCashUsd(
    minAccountReserveUsd,
    maxCapitalAllocationPct,
    minRequiredForGridUsd,
  );
  const shortfallUsd =
    requiredMinCashUsd === null ? null : Math.max(0, Number((requiredMinCashUsd - availableCashUsd).toFixed(4)));

  // Fail closed when the exchange spec could not be resolved: an order sized against an
  // unknown minimum is refused downstream anyway, so claiming "tradeable" here would be a lie.
  if (!isPositiveNumber(minNotionalUsd)) {
    return {
      availableCashUsd,
      minAccountReserveUsd,
      maxCapitalAllocationPct,
      maxAllocatableUsd,
      leverage,
      minimumViableLevels,
      requestedLevels: requested,
      effectiveLevels,
      maxAffordableLevels,
      perRungUsd,
      exchangeMinNotionalUsd: 0,
      minRequiredForGridUsd: 0,
      requiredMinCashUsd: null,
      shortfallUsd: null,
      canTrade: false,
      reason: 'The exchange minimum notional for this symbol could not be resolved, so no allocation can be validated.',
    };
  }

  if (maxAllocatableUsd <= 0) {
    return {
      ...{
        availableCashUsd,
        minAccountReserveUsd,
        maxCapitalAllocationPct,
        maxAllocatableUsd,
        leverage,
        minimumViableLevels,
        requestedLevels: requested,
        effectiveLevels,
        maxAffordableLevels,
        perRungUsd,
        exchangeMinNotionalUsd: minNotionalUsd,
        minRequiredForGridUsd,
        requiredMinCashUsd,
        shortfallUsd,
      },
      canTrade: false,
      reason:
        `Available cash ${availableCashUsd.toFixed(2)} USDT does not clear the ${minAccountReserveUsd} USDT reserve, ` +
        `so nothing is deployable. ${requiredMinCashUsd === null ? '' : `The smallest viable ${minimumViableLevels}-rung grid at ${effectiveLeverage}x needs ${requiredMinCashUsd.toFixed(2)} USDT.`}`.trim(),
    };
  }

  if (maxAllocatableUsd + 1e-9 < minRequiredForGridUsd) {
    return {
      availableCashUsd,
      minAccountReserveUsd,
      maxCapitalAllocationPct,
      maxAllocatableUsd,
      leverage,
      minimumViableLevels,
      requestedLevels: requested,
      effectiveLevels,
      maxAffordableLevels,
      perRungUsd,
      exchangeMinNotionalUsd: minNotionalUsd,
      minRequiredForGridUsd,
      requiredMinCashUsd,
      shortfallUsd,
      canTrade: false,
      reason:
        `Allocatable ${maxAllocatableUsd.toFixed(2)} USDT funds ${maxAffordableLevels} rung(s), below the ${minimumViableLevels}-rung ` +
        `minimum for a valid grid. ${requiredMinCashUsd === null ? '' : `Requires ${requiredMinCashUsd.toFixed(2)} USDT in the account ` +
        `(${shortfallUsd?.toFixed(2)} USDT short) at ${effectiveLeverage}x, or more leverage within the safe range.`}`.trim(),
    };
  }

  return {
    availableCashUsd,
    minAccountReserveUsd,
    maxCapitalAllocationPct,
    maxAllocatableUsd,
    leverage,
    minimumViableLevels,
    requestedLevels: requested,
    effectiveLevels,
    maxAffordableLevels,
    perRungUsd,
    exchangeMinNotionalUsd: minNotionalUsd,
    minRequiredForGridUsd,
    requiredMinCashUsd,
    shortfallUsd: 0,
    canTrade: true,
    reason: '',
  };
}
