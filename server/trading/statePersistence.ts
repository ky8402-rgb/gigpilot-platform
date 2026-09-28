import fs from 'fs';
import path from 'path';
import { CapitalAccounting, GridConfiguration } from './types.js';

/**
 * Durable trading state.
 *
 * Nothing about realized performance used to survive a restart: capital counters, FIFO lots, the
 * processed-fill de-duplication set and the measured cost evidence all reset to zero. Because every
 * deploy restarts the service, the platform could never accumulate a trustworthy realized net
 * P&L, and the optimizer could never gather the fills it needs. This module persists exactly the
 * state that must outlive a process, and nothing else.
 *
 * Deliberately NOT persisted:
 *   - open orders / positions: the exchange is authoritative and these are re-synced from
 *     /v5/order/realtime and /v5/position/list at boot. Persisting them would risk resurrecting
 *     phantom state after a crash.
 *   - credentials, tokens and any secret: `findSecretLikeKeys` refuses the write outright.
 *
 * Writes are atomic (temp file + rename) and 0600, and a corrupt or unknown-version file is
 * discarded rather than trusted.
 */

const PERSISTENT_DATA_DIR = process.env.GIGPILOT_DATA_DIR || path.join(process.cwd(), '.gigpilot-data');
export const TRADING_STATE_PATH = path.join(PERSISTENT_DATA_DIR, 'trading-state.json');
export const TRADING_STATE_VERSION = 1;

/** Bounds so a pathological file can never balloon memory. */
export const MAX_PROCESSED_FILL_IDS = 5000;
export const MAX_MEASURED_FILLS = 200;
export const MAX_LOTS_PER_SYMBOL = 500;

/** A grid older than this, or drifted this far outside its bounds, is not restored at boot. */
export const GRID_RESTORE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const GRID_RESTORE_MAX_DRIFT_PCT = 20;

/** Mirrors the engine's FIFO lot exactly — no extra fields are invented. */
export interface PersistedFifoLot {
  quantity: number;
  unitCostUsd: number;
}

export interface PersistedMeasuredFill {
  id: string;
  orderId: string;
  price: number;
  amount: number;
  feeUsd: number;
  referenceMid?: number;
  referenceHalfSpreadBps?: number;
  timestamp: string;
  side: 'BUY' | 'SELL';
}

export interface PersistedTradingState {
  version: number;
  savedAt: string;
  capital: CapitalAccounting;
  fifoLots: Record<string, PersistedFifoLot[]>;
  processedFillIds: string[];
  measuredFills: PersistedMeasuredFill[];
  equityHighWaterMarkUsd: number;
  utcDayKey: string;
  utcDayStartEquityUsd: number | null;
  activeGrid: GridConfiguration | null;
  autonomyLevel: number;
  activeSymbol: string;
}

const SECRET_LIKE = /(secret|token|password|passphrase|api[_-]?key|private[_-]?key|mnemonic|signature|credential|jwt)/i;

/** Recursively lists object keys whose name looks like a credential. Used as a write-time guard. */
export function findSecretLikeKeys(value: unknown, prefix = '', found: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) findSecretLikeKeys(item, prefix, found);
    return found;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (SECRET_LIKE.test(key)) found.push(keyPath);
    findSecretLikeKeys(child, keyPath, found);
  }
  return found;
}

/**
 * Strict numeric coercion. `Number()` alone is not safe here: Number(null) === 0 and
 * Number(true) === 1, so a null counter would silently become a real zero in the P&L ledger.
 * Only genuine numbers and numeric strings are accepted; everything else yields null.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sanitizeCapital(raw: unknown): CapitalAccounting | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = toFiniteNumber(value);
    if (n !== null) out[key] = n;
  }
  return Object.keys(out).length > 0 ? (out as unknown as CapitalAccounting) : null;
}

function sanitizeLots(raw: unknown): Record<string, PersistedFifoLot[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, PersistedFifoLot[]> = {};
  for (const [symbol, lots] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(lots)) continue;
    const clean: PersistedFifoLot[] = [];
    for (const lot of lots.slice(0, MAX_LOTS_PER_SYMBOL)) {
      const l = lot as Record<string, unknown>;
      const quantity = toFiniteNumber(l?.quantity);
      const unitCostUsd = toFiniteNumber(l?.unitCostUsd);
      if (quantity === null || quantity <= 0) continue;
      if (unitCostUsd === null || unitCostUsd < 0) continue;
      clean.push({ quantity, unitCostUsd });
    }
    if (clean.length > 0) out[symbol] = clean;
  }
  return out;
}

function sanitizeMeasuredFills(raw: unknown): PersistedMeasuredFill[] {
  if (!Array.isArray(raw)) return [];
  const clean: PersistedMeasuredFill[] = [];
  for (const fill of raw.slice(-MAX_MEASURED_FILLS)) {
    const f = fill as Record<string, unknown>;
    const price = toFiniteNumber(f?.price);
    const amount = toFiniteNumber(f?.amount);
    const referenceMid = toFiniteNumber(f?.referenceMid);
    // A fill without a captured quote contributes nothing to cost measurement, so it is dropped
    // here for the same reason the cost model excludes it.
    if (typeof f?.id !== 'string' || !f.id) continue;
    if (price === null || price <= 0) continue;
    if (amount === null || amount <= 0) continue;
    if (referenceMid === null || referenceMid <= 0) continue;
    const halfSpread = toFiniteNumber(f?.referenceHalfSpreadBps);
    const fee = toFiniteNumber(f?.feeUsd);
    clean.push({
      id: f.id,
      orderId: typeof f.orderId === 'string' ? f.orderId : '',
      price,
      amount,
      feeUsd: fee === null ? 0 : Math.max(0, fee),
      referenceMid,
      referenceHalfSpreadBps: halfSpread === null ? 0 : Math.max(0, halfSpread),
      timestamp: typeof f?.timestamp === 'string' ? f.timestamp : new Date().toISOString(),
      side: f?.side === 'SELL' ? 'SELL' : 'BUY'
    });
  }
  return clean;
}

export function serializeTradingState(state: PersistedTradingState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Parses persisted state. Returns null for anything malformed, of an unknown version, or missing
 * the capital block — a partial restore of P&L is worse than none, so callers must treat null as
 * "start clean" rather than "assume zero" where zero would be wrong.
 */
export function deserializeTradingState(raw: string): PersistedTradingState | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (Number(parsed.version) !== TRADING_STATE_VERSION) return null;

  const capital = sanitizeCapital(parsed.capital);
  if (!capital) return null;

  const processedFillIds = Array.isArray(parsed.processedFillIds)
    ? parsed.processedFillIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0).slice(-MAX_PROCESSED_FILL_IDS)
    : [];

  const utcDayStart = parsed.utcDayStartEquityUsd;
  const activeGrid = parsed.activeGrid && typeof parsed.activeGrid === 'object' && !Array.isArray(parsed.activeGrid)
    ? (parsed.activeGrid as GridConfiguration)
    : null;

  return {
    version: TRADING_STATE_VERSION,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    capital,
    fifoLots: sanitizeLots(parsed.fifoLots),
    processedFillIds,
    measuredFills: sanitizeMeasuredFills(parsed.measuredFills),
    equityHighWaterMarkUsd: toFiniteNumber(parsed.equityHighWaterMarkUsd) ?? 0,
    utcDayKey: typeof parsed.utcDayKey === 'string' ? parsed.utcDayKey : '',
    utcDayStartEquityUsd: toFiniteNumber(utcDayStart),
    activeGrid,
    autonomyLevel: toFiniteNumber(parsed.autonomyLevel) ?? 0,
    activeSymbol: typeof parsed.activeSymbol === 'string' && parsed.activeSymbol ? parsed.activeSymbol : 'BTC/USDT'
  };
}

/**
 * A restored grid may only be reused while it is still a fair description of the market. An old or
 * badly drifted grid would derive TP/SL boundaries that no longer bracket the position, so it is
 * rejected and the caller keeps its fail-closed behaviour instead.
 */
export function isGridRestorable(
  grid: GridConfiguration | null | undefined,
  currentPrice: number,
  nowMs: number,
  maxAgeMs: number = GRID_RESTORE_MAX_AGE_MS,
  maxDriftPct: number = GRID_RESTORE_MAX_DRIFT_PCT
): boolean {
  if (!grid) return false;
  const upper = Number(grid.upperBoundary);
  const lower = Number(grid.lowerBoundary);
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= lower || lower <= 0) return false;

  // GridConfiguration carries no createdAt, so lastRebalancedAt is the freshness reference: a grid
  // is regenerated at START and on every autonomous rebalance.
  const freshAtRaw = (grid as unknown as { createdAt?: string }).createdAt || grid.lastRebalancedAt;
  const freshAtMs = Date.parse(String(freshAtRaw || ''));
  if (!Number.isFinite(freshAtMs)) return false;
  if (nowMs - freshAtMs > maxAgeMs) return false;

  const price = Number(currentPrice);
  if (!Number.isFinite(price) || price <= 0) return false;

  const driftPct = price > upper
    ? ((price - upper) / upper) * 100
    : price < lower
      ? ((lower - price) / lower) * 100
      : 0;
  return driftPct <= maxDriftPct;
}

/** Writes state atomically. Returns false (without throwing) when the write is unsafe or fails. */
export function writeTradingState(state: PersistedTradingState): boolean {
  const secretKeys = findSecretLikeKeys(state);
  if (secretKeys.length > 0) {
    // Fail-safe: refuse rather than persist something credential-shaped to disk.
    console.error(`[statePersistence] Refusing to persist trading state: secret-like keys present (${secretKeys.join(', ')}).`);
    return false;
  }
  const tempPath = `${TRADING_STATE_PATH}.tmp`;
  try {
    fs.mkdirSync(PERSISTENT_DATA_DIR, { recursive: true });
    fs.writeFileSync(tempPath, serializeTradingState(state), { mode: 0o600 });
    fs.renameSync(tempPath, TRADING_STATE_PATH);
    return true;
  } catch (err: any) {
    console.error(`[statePersistence] Failed to persist trading state: ${err?.message || err}`);
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* best effort */ }
    return false;
  }
}

/** Reads persisted state. Returns null when absent or invalid; never throws. */
export function readTradingState(): PersistedTradingState | null {
  try {
    if (!fs.existsSync(TRADING_STATE_PATH)) return null;
    const raw = fs.readFileSync(TRADING_STATE_PATH, 'utf-8');
    return deserializeTradingState(raw);
  } catch (err: any) {
    console.error(`[statePersistence] Failed to read trading state: ${err?.message || err}`);
    return null;
  }
}
