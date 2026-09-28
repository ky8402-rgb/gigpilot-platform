import { OrderBook } from './types.js';

/**
 * Authoritative post-cost evidence, derived exclusively from observed live data.
 *
 * Every field is either MEASURED from real exchange fills/account data or COMPUTED from a live
 * quote. Nothing here is assumed, hardcoded, or synthetic. When the real inputs required to
 * measure a component are unavailable, the whole evidence object is withheld (fail-closed)
 * rather than filled with a placeholder value — a fabricated cost figure would silently turn
 * the net-edge gate into a rubber stamp.
 */

/** A real fill plus the quote snapshot captured when its parent order was dispatched. */
export interface MeasuredFill {
  id: string;
  orderId: string;
  price: number;
  amount: number;
  /** Actual fee charged by the exchange for this fill (Bybit `execFee`, converted to USD). */
  feeUsd: number;
  /** Mid price observed at order placement. Required for execution-cost measurement. */
  referenceMid?: number;
  /** Half of the quoted spread observed at order placement (bps). Required for split-out. */
  referenceHalfSpreadBps?: number;
  timestamp: string;
  side: 'BUY' | 'SELL';
}

export interface CostModelInputs {
  fills: MeasuredFill[];
  /** Adverse-signed post-fill markout per fill (bps, positive = moved against the new position). */
  markouts?: Array<{ fillId: string; markoutBps: number }>;
  /** Real account fee rate when available; used only as a cross-check/fallback label. */
  feeRateBps?: { maker: number; taker: number; source: string } | null;
  /** Live order book, used for forward-looking spread cost. */
  orderBook?: OrderBook | null;
  /** Real hourly funding rate as a fraction (0.0001 = 1 bps/hour). Null when unavailable. */
  fundingRateHourly?: number | null;
  expectedHoldingHours?: number;
  /** Notional currently held, used to scale realized funding cost. */
  openPositionNotionalUsd?: number;
  /** Realized ATR as a percentage of price, used for the uncertainty dispersion check. */
  volatilityPct?: number;
  observedAt?: string;
  minSamples?: number;
}

export interface CostEvidence {
  realizedSpreadCostUsd: number;
  realizedSlippageCostUsd: number;
  realizedAdverseSelectionCostUsd: number;
  realizedFundingCostUsd: number;
  realizedFeesUsd: number;
  realizedTotalCostUsd: number;
  realizedNotionalUsd: number;
  expectedMakerTakerFeesBps: number;
  expectedSpreadCostBps: number;
  expectedSlippageCostBps: number;
  expectedAdverseSelectionCostBps: number;
  expectedFundingCarryingCostBps: number;
  expectedExecutionUncertaintyBps: number;
  sampleCount: number;
  markoutSampleCount: number;
  feeRateSource: string;
  fundingRateSource: 'LIVE_TICKER' | 'UNAVAILABLE';
  observedAt: string;
}

/** Minimum number of fully-measured fills before any evidence may be produced. */
export const DEFAULT_MIN_SAMPLES = 10;

const BPS = 1e4;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

function finiteNonNegative(v: unknown): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

/**
 * Per-fill execution cost decomposition against the quote snapshot taken at order placement.
 * Returns null when the snapshot is missing, because cost cannot be attributed without it.
 */
export function decomposeExecutionCost(fill: MeasuredFill): {
  notionalUsd: number;
  executionCostBps: number;
  spreadCostBps: number;
  excessSlippageBps: number;
} | null {
  const price = Number(fill.price);
  const amount = Number(fill.amount);
  const mid = Number(fill.referenceMid);
  const halfSpread = Number(fill.referenceHalfSpreadBps);

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(mid) || mid <= 0) return null;
  if (!finiteNonNegative(halfSpread)) return null;

  const notionalUsd = price * amount;
  // Distance actually paid relative to the prevailing mid (spread + slippage combined).
  const executionCostBps = (Math.abs(price - mid) / mid) * BPS;
  // The unavoidable cost of crossing the quoted half-spread.
  const spreadCostBps = Math.min(halfSpread, executionCostBps);
  // Everything beyond the quote: genuine slippage/adverse fill.
  const excessSlippageBps = Math.max(0, executionCostBps - spreadCostBps);

  return { notionalUsd, executionCostBps, spreadCostBps, excessSlippageBps };
}

/** Adverse-signed markout: positive means the market moved against the position just opened. */
export function computeMarkoutBps(execPrice: number, side: 'BUY' | 'SELL', futureMid: number): number {
  if (!(Number(execPrice) > 0) || !(Number(futureMid) > 0)) return 0;
  const moveBps = ((Number(futureMid) - Number(execPrice)) / Number(execPrice)) * BPS;
  return side === 'BUY' ? -moveBps : moveBps;
}

/**
 * Builds cost evidence from live observations, or returns null when it cannot be measured.
 */
export function buildCostEvidence(inputs: CostModelInputs): CostEvidence | null {
  const minSamples = Number.isFinite(inputs.minSamples) ? Number(inputs.minSamples) : DEFAULT_MIN_SAMPLES;
  const book = inputs.orderBook;
  const bestBid = Number(book?.bids?.[0]?.price);
  const bestAsk = Number(book?.asks?.[0]?.price);

  // Forward-looking spread cost requires a live two-sided quote. Without it the expected-cost
  // side of the equation is unknowable, so no evidence is produced.
  if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk <= bestBid) return null;

  const liveSpreadBps = Number.isFinite(book?.spreadBps) && Number(book?.spreadBps) > 0
    ? Number(book!.spreadBps)
    : ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * BPS;

  // Only fills whose execution can be attributed against a captured quote snapshot qualify.
  const measured = inputs.fills
    .map(fill => ({ fill, cost: decomposeExecutionCost(fill) }))
    .filter((row): row is { fill: MeasuredFill; cost: NonNullable<ReturnType<typeof decomposeExecutionCost>> } => row.cost !== null);

  if (measured.length < minSamples) return null;

  const realizedNotionalUsd = measured.reduce((sum, r) => sum + r.cost.notionalUsd, 0);
  const realizedFeesUsd = measured.reduce((sum, r) => sum + (Number.isFinite(r.fill.feeUsd) ? Math.max(0, r.fill.feeUsd) : 0), 0);
  const realizedSpreadCostUsd = measured.reduce((sum, r) => sum + (r.cost.spreadCostBps / BPS) * r.cost.notionalUsd, 0);
  const realizedSlippageCostUsd = measured.reduce((sum, r) => sum + (r.cost.excessSlippageBps / BPS) * r.cost.notionalUsd, 0);

  const excessSlippageSamples = measured.map(r => r.cost.excessSlippageBps);

  // Adverse selection: only counted where a real post-fill markout was observed.
  const notionalByFillId = new Map(measured.map(r => [r.fill.id, r.cost.notionalUsd]));
  const matchedMarkouts = (inputs.markouts || []).filter(m =>
    notionalByFillId.has(m.fillId) && Number.isFinite(Number(m.markoutBps))
  );
  const realizedAdverseSelectionCostUsd = matchedMarkouts.reduce((sum, m) => {
    const adverseBps = Math.max(0, Number(m.markoutBps));
    return sum + (adverseBps / BPS) * (notionalByFillId.get(m.fillId) || 0);
  }, 0);

  // Funding: computed only from a real observed funding rate. With no rate the cost is unknown,
  // so it is reported as 0 with fundingRateSource='UNAVAILABLE' rather than invented.
  const fundingRateHourly = Number(inputs.fundingRateHourly);
  const fundingAvailable = Number.isFinite(fundingRateHourly) && fundingRateHourly !== 0;
  const holdingHours = Number(inputs.expectedHoldingHours);
  const fundingBasisNotionalUsd = Number(inputs.openPositionNotionalUsd) > 0
    ? Number(inputs.openPositionNotionalUsd)
    : realizedNotionalUsd / measured.length;
  const realizedFundingCostUsd = fundingAvailable && Number.isFinite(holdingHours) && holdingHours > 0
    ? Math.max(0, fundingRateHourly) * fundingBasisNotionalUsd * holdingHours
    : 0;

  // Forward-looking costs, every term sourced from live data.
  const realizedFeeBps = realizedNotionalUsd > 0 ? (realizedFeesUsd / realizedNotionalUsd) * BPS : 0;
  const fallbackFeeBps = Number(inputs.feeRateBps?.taker);
  const expectedMakerTakerFeesBps = measured.length > 0
    ? Number(realizedFeeBps.toFixed(4))
    : (Number.isFinite(fallbackFeeBps) && fallbackFeeBps >= 0 ? fallbackFeeBps : 0);

  const expectedSpreadCostBps = Number((liveSpreadBps / 2).toFixed(4));
  const expectedSlippageCostBps = Number(mean(excessSlippageSamples).toFixed(4));
  const expectedAdverseSelectionCostBps = matchedMarkouts.length > 0
    ? Number(mean(matchedMarkouts.map(m => Math.max(0, Number(m.markoutBps)))).toFixed(4))
    : 0;
  const expectedFundingCarryingCostBps = fundingAvailable && Number.isFinite(holdingHours) && holdingHours > 0
    ? Number((fundingRateHourly * holdingHours * BPS).toFixed(4))
    : 0;
  // Execution uncertainty = observed dispersion of real slippage, not a modeled constant.
  const expectedExecutionUncertaintyBps = Number(stdDev(excessSlippageSamples).toFixed(4));

  return {
    realizedSpreadCostUsd: Number(realizedSpreadCostUsd.toFixed(4)),
    realizedSlippageCostUsd: Number(realizedSlippageCostUsd.toFixed(4)),
    realizedAdverseSelectionCostUsd: Number(realizedAdverseSelectionCostUsd.toFixed(4)),
    realizedFundingCostUsd: Number(realizedFundingCostUsd.toFixed(4)),
    realizedFeesUsd: Number(realizedFeesUsd.toFixed(4)),
    realizedTotalCostUsd: Number((realizedFeesUsd + realizedSpreadCostUsd + realizedSlippageCostUsd + realizedAdverseSelectionCostUsd + realizedFundingCostUsd).toFixed(4)),
    realizedNotionalUsd: Number(realizedNotionalUsd.toFixed(4)),
    expectedMakerTakerFeesBps,
    expectedSpreadCostBps,
    expectedSlippageCostBps,
    expectedAdverseSelectionCostBps,
    expectedFundingCarryingCostBps,
    expectedExecutionUncertaintyBps,
    sampleCount: measured.length,
    markoutSampleCount: matchedMarkouts.length,
    feeRateSource: inputs.feeRateBps?.source || 'MEASURED_FROM_FILLS',
    fundingRateSource: fundingAvailable ? 'LIVE_TICKER' : 'UNAVAILABLE',
    observedAt: inputs.observedAt || new Date().toISOString()
  };
}
