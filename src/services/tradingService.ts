import {
  AuditLog,
  AutonomyLevel,
  BybitAccountState,
  CapitalAccounting,
  DestinationWallet,
  GridConfiguration,
  MasterTradingState,
  Order,
  OwnerAuthStatus,
  PositionDriftRecord,
  ProfitSweep,
  ReconciliationAuditEvent,
  ReconciliationAuditStatus,
  ResearchItem,
  RiskRuleConfig,
  StrategyVersion,
  SystemUpdate,
  TradingMode
} from '../types/trading';

let isBackendLive = false;
let workingBaseUrl: string | null = null;
let lastSyncTimestamp: string | null = null;

export function isEngineLiveConnected(): boolean {
  return isBackendLive;
}

export function getLastSyncTime(): string {
  return lastSyncTimestamp || '';
}

function isDeadOrDeprecatedUrl(url: string): boolean {
  return /3\.222\.149\.9|3-222-149-9|65\.0\.73\.85|65-0-73-85/.test(url);
}

function normalizeTradingBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed || isDeadOrDeprecatedUrl(trimmed)) return '';

  // Accept either a backend origin or an already-prefixed API URL. Never
  // create /api/trading/api/trading from an already-prefixed environment value.
  return trimmed
    .replace(/\/api\/trading$/i, '')
    .replace(/\/api$/i, '');
}

export function getCandidateBaseUrls(): string[] {
  const envUrl =
    (import.meta as any).env?.VITE_BACKEND_URL ||
    (import.meta as any).env?.VITE_API_URL ||
    (import.meta as any).env?.VITE_API_BASE_URL;
  const urls: string[] = [];

  if (workingBaseUrl && !isDeadOrDeprecatedUrl(workingBaseUrl)) {
    urls.push(workingBaseUrl);
  }
  if (typeof envUrl === 'string' && envUrl.trim()) {
    const normalized = normalizeTradingBaseUrl(envUrl);
    if (normalized && !isDeadOrDeprecatedUrl(normalized)) {
      urls.push(`${normalized}/api/trading`);
    }
  }

  // Canonical live Bybit trading backend (AWS Mumbai ap-south-1 Elastic IP)
  urls.push('https://35-154-110-156.sslip.io/api/trading');

  // Same-origin fallback for local dev / preview environments
  if (typeof window !== 'undefined' && window.location) {
    const isAmplifyHost = window.location.hostname.endsWith('.amplifyapp.com');
    if (!isAmplifyHost && window.location.origin) {
      urls.push(`${window.location.origin}/api/trading`);
    }
  }

  return [...new Set(urls.filter((u) => !isDeadOrDeprecatedUrl(u)))];
}

// ---------------------------------------------------------------------------
// Owner session token — IN-MEMORY only.
//
// A bearer token in durable browser storage is readable by any injected script (XSS), so the token
// no longer lives in such a store. It is held in a module-level variable; on same-origin deployments a
// reload recovers a session from the httpOnly cookie via `refreshOwnerSession()`. The exported
// function names are unchanged so existing callers keep working.
// ---------------------------------------------------------------------------
const LEGACY_OWNER_TOKEN_KEYS = [
  'gigpilot_owner_token', // canonical owner key this module used to persist
  'gigpilot_token',       // legacy alias read by lib/api.ts
  'token'                 // legacy alias read by lib/api.ts
] as const;

let ownerTokenInMemory: string | null = null;
let ownerTokenListener: (() => void) | null = null;

// MIGRATION (runs on module load): unconditionally scrub any legacy owner bearer from durable browser
// storage. Leaving it behind would preserve the exact credential this module exists to remove. That
// storage may be unavailable (SSR / private browsing); the try/catch covers that case.
try {
  for (const legacyKey of LEGACY_OWNER_TOKEN_KEYS) {
    localStorage.removeItem(legacyKey);
  }
} catch {
  // No durable storage available — there is nothing to migrate.
}

export function getStoredOwnerToken(): string | null {
  return ownerTokenInMemory;
}

export function setStoredOwnerToken(token: string | null): void {
  ownerTokenInMemory = token;
  if (ownerTokenListener) {
    try {
      ownerTokenListener();
    } catch {
      // A subscriber must never break the auth flow.
    }
  }
}

/** Optional subscription so UI can react to login/logout/refresh without a storage event. */
export function subscribeOwnerToken(listener: () => void): () => void {
  ownerTokenListener = listener;
  return () => {
    if (ownerTokenListener === listener) ownerTokenListener = null;
  };
}

export async function fetchWithFailover<T>(
  endpointPath: string,
  options?: RequestInit & { timeoutMs?: number; baseUrls?: string[] }
): Promise<T> {
  // An explicit base list lets a caller target a different mount point (e.g. the ML control plane,
  // which lives at the API root rather than under /api/trading) while still reusing the exact same
  // owner-token header injection, timeout, and host-failover behaviour.
  const overrideBases = options?.baseUrls && options.baseUrls.length > 0 ? options.baseUrls : null;
  const candidates = overrideBases ?? getCandidateBaseUrls();
  let lastError: Error | null = null;
  const timeoutMs = options?.timeoutMs ?? 15000;

  const mergedHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(options?.headers as Record<string, string> || {})
  };
  const token = getStoredOwnerToken();
  if (token) mergedHeaders.Authorization = `Bearer ${token}`;

  const { timeoutMs: _timeout, baseUrls: _baseUrls, ...fetchOptions } = options || {};
  for (const baseUrl of candidates) {
    const cleanEndpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    const targetUrl = `${baseUrl}${cleanEndpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(targetUrl, {
        ...fetchOptions,
        headers: mergedHeaders,
        signal: controller.signal
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Live trading API returned non-JSON response from ${targetUrl}`);
      }

      const data = await res.json();

      // Successful JSON response indicates the backend is reached and active. Only cache a host
      // discovered from the default trading list: an explicit base list (ML root) must not
      // overwrite the trading failover preference with a non-/api/trading origin.
      if (!overrideBases) workingBaseUrl = baseUrl;
      isBackendLive = true;
      lastSyncTimestamp = new Date().toISOString();

      if (!res.ok) {
        // BOTH the code and the cause. Preferring `error` alone discarded `message`, which the
        // backend populates with the real reason — the dashboard showed a bare "TICKERS_UNAVAILABLE"
        // while the response carried "REST GET /v5/market/tickers failed: ...". An error code with no
        // cause is unactionable for an operator and unhelpful for anyone trying to fix it.
        const errMsg = data?.error
          ? (data?.message ? `${data.error}: ${data.message}` : String(data.error))
          : (data?.message || `API error HTTP ${res.status}`);
        const clientErr = new Error(errMsg);
        (clientErr as any).status = res.status;
        (clientErr as any).data = data;
        throw clientErr;
      }

      return data as T;
    } catch (err: any) {
      // If the backend authoritatively rejected credentials or request (HTTP 400-499),
      // re-throw immediately instead of rotating to different hosts
      if (err?.status && err.status >= 400 && err.status < 500) {
        throw err;
      }
      const message =
        err?.name === 'AbortError'
          ? `Live trading API timed out after ${Math.round(timeoutMs / 1000)}s: ${targetUrl}`
          : (err?.message || `Live trading API request failed: ${targetUrl}`);
      lastError = new Error(message);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  isBackendLive = false;
  throw lastError || new Error(`Live trading API unavailable for ${endpointPath}`);
}

/**
 * GET /api/state — the backend telemetry snapshot.
 *
 * RETURNS `Partial`, AND THAT IS THE POINT. `/api/state` does NOT carry `activeSymbol`: the selected
 * symbol is a VIEW concern owned by the dashboard, not a fact the engine reports. Typing this as a
 * complete `MasterTradingState` was a lie that let `setState(masterState)` replace the view state
 * wholesale, erase `activeSymbol`, and crash the very next render on
 * `state.activeSymbol.replace(...)`.
 *
 * The bug stayed invisible while the control plane was unreachable, because the assignment never ran;
 * fixing the CORS allow-list let the fetch succeed and surfaced it. A `Partial` return makes the
 * compiler reject a wholesale assignment, so this class of bug cannot come back.
 */
export async function fetchTradingState(): Promise<Partial<MasterTradingState>> {
  return await fetchWithFailover<Partial<MasterTradingState>>('/state');
}


export interface FuturesUniverseMarket {
  exchange: 'BYBIT';
  symbol: string;
  baseAsset: string;
  quoteAsset: 'USDT';
  contractType: 'PERPETUAL';
  status: string;
  price: number;
  volume24h: number;
  change24hPct: number;
  fundingRate: number | null;
  bid: number;
  ask: number;
  spreadBps: number;
  tickSize: number | null;
  qtyStep: number | null;
  makerFeeBps: number | null;
  takerFeeBps: number | null;
  /**
   * OPTIONAL BECAUSE NOTHING MEASURES THEM. The engine has no liquidity- or execution-scoring
   * quantity, so the universe endpoint omits them rather than sending an invented number. Services
   * must not fabricate a metric merely because a type asked for one.
   */
  liquidityScore?: number;
  executionScore?: number;
  eligible: boolean;
  reasons: string[];
}

export async function fetchFuturesUniverse(): Promise<FuturesUniverseMarket[]> {
  const data = await fetchWithFailover<{ success: boolean; markets: FuturesUniverseMarket[] }>('/futures/universe');
  if (!data.success || !Array.isArray(data.markets)) throw new Error('Live futures universe unavailable.');
  return data.markets;
}

export async function fetchAllPairs(): Promise<Array<{
  symbol: string;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24hPct: number;
}>> {
  const data = await fetchWithFailover<{ success: boolean; pairs: any[] }>('/pairs');
  if (!Array.isArray(data.pairs) || data.pairs.length === 0) {
    throw new Error('Live market data unavailable: exchange returned no trading pairs.');
  }
  return data.pairs.map((p) => {
    const values = ['price', 'open24h', 'high24h', 'low24h', 'volume24h', 'change24hPct'];
    for (const key of values) {
      if (typeof p?.[key] !== 'number' || !Number.isFinite(p[key])) {
        throw new Error(`Live market data invalid for ${p?.symbol || 'unknown pair'}: ${key} is unavailable.`);
      }
    }
    return {
      symbol: String(p.symbol),
      price: p.price,
      open24h: p.open24h,
      high24h: p.high24h,
      low24h: p.low24h,
      volume24h: p.volume24h,
      change24hPct: p.change24hPct
    };
  });
}

export async function fetchPairDetails(symbol: string) {
  const encoded = encodeURIComponent(symbol);
  let data: any;
  try {
    data = await fetchWithFailover<any>(`/pair/${encoded}`);
  } catch {
    const altEncoded = encodeURIComponent(symbol.replace('/', '-'));
    data = await fetchWithFailover<any>(`/pair/${altEncoded}`);
  }

  if (!data?.success || typeof data.currentPrice !== 'number' || !Number.isFinite(data.currentPrice) || data.currentPrice <= 0) {
    throw new Error(`Live market data unavailable for ${symbol}: invalid current price.`);
  }
  if (!Array.isArray(data.candles) || data.candles.length === 0) {
    throw new Error(`Live market data unavailable for ${symbol}: candles are missing.`);
  }
  if (!data.orderBook || !Array.isArray(data.orderBook.bids) || !Array.isArray(data.orderBook.asks) ||
      data.orderBook.bids.length === 0 || data.orderBook.asks.length === 0) {
    throw new Error(`Live market data unavailable for ${symbol}: order book is missing.`);
  }

  const requiredIndicatorPaths = [
    'rsi14',
    'macd.macd',
    'macd.signal',
    'macd.histogram',
    'ema9',
    'ema21',
    'ema50',
    'ema200',
    'bollingerBands.upper',
    'bollingerBands.middle',
    'bollingerBands.lower',
    'bollingerBands.bandwidth',
    'atr14',
    'vwap',
    'spreadBps',
    'volatility24h'
  ];
  for (const path of requiredIndicatorPaths) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], data.indicators);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Live market indicators unavailable for ${symbol}: ${path}.`);
    }
  }

  return {
    success: true,
    symbol: data.symbol || symbol,
    currentPrice: data.currentPrice,
    candles: data.candles,
    orderBook: data.orderBook,
    indicators: data.indicators,
    regime: data.regime,
    source: data.source
  };
}

export async function selectActivePair(symbol: string) {
  return await fetchWithFailover<{ success: boolean; symbol: string }>('/pair/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol })
  });
}

export async function setAutonomyLevel(level: AutonomyLevel) {
  return await fetchWithFailover<{ success: boolean; level: AutonomyLevel }>('/autonomy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level })
  });
}

export async function setTradingMode(mode: TradingMode) {
  if (mode !== 'LIVE') throw new Error('GigPilot is live-only; no alternate trading modes are permitted.');
  return await fetchWithFailover<{ success: boolean; mode: TradingMode }>('/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'LIVE' })
  });
}

export async function triggerKillSwitch(reason?: string) {
  return await fetchWithFailover<{ success: boolean; GLOBAL_KILL_SWITCH_ACTIVE: boolean; botsDisabled: boolean; killSwitch: any }>('/kill-switch/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
}

export async function deactivateKillSwitch() {
  return await fetchWithFailover<{ success: boolean; GLOBAL_KILL_SWITCH_ACTIVE: boolean; botsDisabled: boolean; killSwitch: any }>('/kill-switch/deactivate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function toggleGlobalKillSwitch(active?: boolean, reason?: string) {
  return await fetchWithFailover<{ success: boolean; GLOBAL_KILL_SWITCH_ACTIVE: boolean; botsDisabled: boolean; killSwitch: any }>('/kill-switch/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active, reason })
  });
}

export async function configureGrid(config: {
  upperBoundary?: number;
  lowerBoundary?: number;
  levelsCount?: number;
  spacingType?: 'ARITHMETIC' | 'GEOMETRIC';
  totalAllocatedUsd?: number;
  volatilityAdjustment?: boolean;
  trendProtection?: boolean;
}): Promise<{ success: boolean; grid: GridConfiguration }> {
  const res = await fetchWithFailover<{ success: boolean; grid: GridConfiguration }>('/grid/configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  if (!res.success || !res.grid) throw new Error('Live grid configuration was not accepted by the trading backend.');
  return res;
}

export async function placeManualOrder(order: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price: number;
  amount: number;
}): Promise<{ success: boolean; order?: Order; error?: string }> {
  return await fetchWithFailover<{ success: boolean; order?: Order; error?: string }>('/order/place', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order)
  });
}

export async function cancelOrder(orderId: string) {
  return await fetchWithFailover<{ success: boolean; orderId: string }>('/order/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId })
  });
}

export async function cancelAllOrders() {
  return await fetchWithFailover<{ success: boolean; count: number }>('/order/cancel-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * The authoritative answer to "can this platform trade right now?".
 *
 * Deliberately NOT derived in the UI: the server owns this verdict so every surface agrees. The UI
 * renders what it is told, including the blocker list that names the real cause.
 */
export async function fetchTradingReadiness(): Promise<{
  ready: boolean;
  blockers: string[];
  signals: { id: string; ok: boolean; detail: string }[];
  context: { autonomyLevel: number | null; armed: boolean | null; autonomousTradingActive: boolean };
  assessedAt: string;
}> {
  return await fetchWithFailover('/readiness');
}

export async function fetchAutonomousOptimizer(): Promise<{
  success: boolean;
  objective: 'NET_REALIZED_PROFIT_AFTER_FEES';
  autonomousDecisioning: boolean;
  decisions: any[];
  strategyBuilds: any[];
  engine: any;
}> {
  const res = await fetchWithFailover<any>('/autonomous-optimizer/status');
  if (!res?.success) throw new Error('Autonomous optimizer telemetry unavailable.');
  // Map names only — never invent values. `autonomousDecisioning` and `engine` come from the
  // live engine health payload the backend already returns.
  return {
    success: true,
    objective: 'NET_REALIZED_PROFIT_AFTER_FEES',
    autonomousDecisioning: Boolean(res.engine?.details?.autonomousDecisioning ?? res.health?.details?.autonomousDecisioning),
    decisions: res.decisions ?? [],
    strategyBuilds: res.strategyBuilds ?? res.builds ?? [],
    engine: res.engine ?? res.health ?? null
  };
}

export async function runAutonomousOptimizer() {
  return await fetchWithFailover<any>('/autonomous-optimizer/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function fetchStrategies(): Promise<{
  champion: StrategyVersion;
  challengers: StrategyVersion[];
  history: StrategyVersion[];
  rollbackTelemetry?: {
    regressionRollbackCount: number;
    lastRollbackEvent: any;
    historyDepth: number;
  };
}> {
  const res = await fetchWithFailover<{
    champion: StrategyVersion;
    challengers: StrategyVersion[];
    history: StrategyVersion[];
    rollbackTelemetry?: {
      regressionRollbackCount: number;
      lastRollbackEvent: any;
      historyDepth: number;
    };
  }>('/strategies');
  if (!res.champion) throw new Error('Live strategy state unavailable: champion strategy is missing.');
  return res;
}

export async function rollbackStrategy(reason?: string) {
  return await fetchWithFailover<{
    success: boolean;
    message?: string;
    error?: string;
    restoredChampion?: StrategyVersion;
    rolledBackChampion?: StrategyVersion;
  }>('/strategy/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason || 'Manual owner rollback invoked via UI' })
  });
}

export async function promoteChallenger(challengerId: string) {
  return await fetchWithFailover<{ success: boolean; reason: string; champion?: StrategyVersion }>('/strategy/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengerId })
  });
}

export async function createStrategyVariant(params: {
  baseStrategyId: string;
  name: string;
  reasonForChange: string;
  parameters: Partial<StrategyVersion['parameters']>;
  expectedEffect: string;
}) {
  return await fetchWithFailover<{ success: boolean; challenger: StrategyVersion }>('/strategy/create-variant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
}

export async function validateUserScript(code: string) {
  return await fetchWithFailover<{
    success: boolean;
    result: {
      success: boolean;
      logs: string[];
      validationTimeMs: number;
      executable: false;
      error?: string;
    };
  }>('/script/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
}

export async function fetchWebResearch(): Promise<{ items: ResearchItem[] }> {
  const res = await fetchWithFailover<{ success: boolean; items: ResearchItem[] }>('/research');
  if (!Array.isArray(res.items)) throw new Error('Live research source unavailable.');
  return { items: res.items };
}

export async function analyzeResearchIntelligence(title: string, content: string, source: string) {
  return await fetchWithFailover<{ success: boolean; item: ResearchItem }>('/research/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, source })
  });
}

export async function fetchProfitSweepInfo(): Promise<{
  destinationWallet: DestinationWallet;
  minSweepThresholdUsd: number;
  profitReserveBufferUsd: number;
  eligibility: {
    eligibleAmount: number;
    canSweep: boolean;
    reserveRetained: number;
    reason?: string;
  };
  history: ProfitSweep[];
}> {
  return await fetchWithFailover('/sweep/info');
}

export async function updateDestinationWallet(wallet: { address: string; chain: string; label?: string }) {
  // The sweeper route expects the wallet WRAPPED as { wallet }; posting it bare would 400.
  return await fetchWithFailover<{ success: boolean; wallet: DestinationWallet }>('/sweep/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet })
  });
}

export async function executeProfitSweep(amount: number) {
  // The sweeper route reads `amountUsd`; sending `amount` would 400 as an invalid amount.
  return await fetchWithFailover<{ success: boolean; sweep?: ProfitSweep; updatedCapital?: CapitalAccounting; error?: string }>('/sweep/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amountUsd: amount })
  });
}

export async function fetchRiskData(): Promise<{
  config: RiskRuleConfig;
  circuitBreakerActive: boolean;
  events: any[];
}> {
  return await fetchWithFailover('/risk');
}

export async function updateRiskConfig(config: Partial<RiskRuleConfig>) {
  return await fetchWithFailover<{ success: boolean; config: RiskRuleConfig }>('/risk/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
}

export async function resetCircuitBreaker() {
  return await fetchWithFailover<{ success: boolean; circuitBreakerActive: boolean }>('/risk/circuit-breaker/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function fetchUpdatesHistory(): Promise<{ updates: SystemUpdate[] }> {
  const res = await fetchWithFailover<{ success: boolean; updates: SystemUpdate[] }>('/updates');
  if (!Array.isArray(res.updates)) throw new Error('Live update history unavailable.');
  return { updates: res.updates };
}

export async function triggerCanaryRollout(version?: string, notes?: string) {
  return await fetchWithFailover<{ success: boolean; update: SystemUpdate }>('/updates/rollout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, notes })
  });
}

export async function fetchAuditLogs(): Promise<{ logs: AuditLog[] }> {
  const res = await fetchWithFailover<{ success: boolean; logs: AuditLog[] }>('/audit-logs');
  if (!Array.isArray(res.logs)) throw new Error('Live audit log source unavailable.');
  return { logs: res.logs };
}

export async function fetchLiveAssets(forceRefresh = false): Promise<{ success: boolean; assets: BybitAccountState }> {
  const res = await fetchWithFailover<{ success: boolean; assets: BybitAccountState }>(
    `/assets${forceRefresh ? '?refresh=true' : ''}`,
    { timeoutMs: 15000 }
  );
  if (!res.success || !res.assets || res.assets.status !== 'CONNECTED') {
    throw new Error(res.assets?.message || 'Live Bybit account data unavailable.');
  }
  return res;
}

export async function fetchBybitStatus(): Promise<{
  success: boolean;
  apiKeyConfigured: boolean;
  keyMask: string;
  serverIp: string;
  baseUrl: string;
  status: string;
}> {
  const credsRes = await fetchWithFailover<{ success: boolean; credentials: any[] }>('/exchanges/credentials', { timeoutMs: 10000 });
  const bybitCred = credsRes.credentials?.find((c: any) => c.exchange === 'BYBIT');
  if (!bybitCred) throw new Error('Live Bybit credential status is unavailable.');
  return {
    success: true,
    apiKeyConfigured: Boolean(bybitCred.configured),
    keyMask: bybitCred.apiKeyMask || 'NOT CONFIGURED',
    serverIp: '',
    baseUrl: 'https://api.bybit.com',
    status: bybitCred.status || 'UNCONFIGURED'
  };
}

export async function updateBybitKeys(
  apiKey: string,
  apiSecret: string,
): Promise<{ success: boolean; message: string; accountState?: any; error?: string }> {
  return await fetchWithFailover<{ success: boolean; message?: string; error?: string }>('/exchanges/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exchange: 'BYBIT', apiKey, apiSecret }),
    timeoutMs: 25000
  }).then((res) => ({
    success: Boolean(res.success),
    message: res.message || '',
    error: res.error
  }));
}

export async function fetchOwnerAuthStatus(): Promise<OwnerAuthStatus> {
  const res = await fetchWithFailover<OwnerAuthStatus & { success: boolean }>('/auth/status');
  return {
    isAuthenticated: res.isAuthenticated,
    isConfigured: res.isConfigured,
    ownerEmail: res.ownerEmail,
    totpEnabled: res.totpEnabled,
    hasPassword: res.hasPassword,
    GLOBAL_KILL_SWITCH_ACTIVE: res.GLOBAL_KILL_SWITCH_ACTIVE
  };
}

export async function initiateOwnerTotpSetup(email?: string): Promise<{
  success: boolean;
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  error?: string;
}> {
  return await fetchWithFailover('/auth/setup-init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
}

export async function completeOwnerSetup(
  password: string,
  totpCode: string,
  email?: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const res = await fetchWithFailover<{ success: boolean; token?: string; error?: string }>('/auth/setup-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, totpCode, email })
    });
    if (res.success && res.token) setStoredOwnerToken(res.token);
    return res;
  } catch (err: any) {
    if (err?.data && typeof err.data === 'object') {
      return err.data;
    }
    return { success: false, error: err?.message || 'Setup request failed' };
  }
}

export async function loginOwner(credentials: {
  email: string;
  password?: string;
  totpCode?: string;
  emergencyPin?: string;
}): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    // Owner authentication is mounted at the API root, not the legacy /api/trading
    // compatibility surface. That compatibility route intentionally exposes status only;
    // using it for login can never validate the password/TOTP pair.
    const res = await fetchWithFailover<{ success: boolean; token?: string; error?: string }>('/api/auth/login', {
      baseUrls: getControlPlaneBaseUrls(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    if (res.success && res.token) setStoredOwnerToken(res.token);
    return res;
  } catch (err: any) {
    if (err?.data && typeof err.data === 'object') {
      return err.data;
    }
    return { success: false, error: err?.message || 'Authentication request failed' };
  }
}

/**
 * End the owner session: clear the httpOnly cookie server-side (best effort) and wipe memory.
 *
 * `POST /api/auth/logout` with `credentials: 'include'` is what clears the cookie; the in-memory
 * bearer is cleared in `finally` so a network failure can never leave the client holding a session.
 */
export async function logoutOwner(): Promise<void> {
  try {
    for (const base of getControlPlaneBaseUrls()) {
      try {
        await fetch(`${base}/api/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        break; // first reachable API root wins; logout is idempotent
      } catch {
        // Network failure on this host — try the next candidate.
      }
    }
  } finally {
    setStoredOwnerToken(null);
  }
}

/**
 * Recover an owner session after a reload from the httpOnly session cookie.
 *
 * `POST /api/auth/refresh` re-mints a token from the cookie. This is what makes in-memory storage
 * viable: same-origin deployments get a session back on reload without ever persisting the token in
 * JavaScript. It NEVER throws; a 401 (no session to refresh — e.g. the cross-origin Amplify
 * deployment, where the SameSite=Strict cookie is withheld) is a normal outcome, reported as false.
 */
export async function refreshOwnerSession(): Promise<boolean> {
  for (const base of getControlPlaneBaseUrls()) {
    try {
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) continue; // 401 = nothing to refresh here; try the next candidate
      const data = await res.json().catch(() => null);
      if (data?.success && typeof data.token === 'string' && data.token) {
        setStoredOwnerToken(data.token);
        return true;
      }
    } catch {
      // Network/host failure — try the next candidate.
    }
  }
  return false;
}

export async function getAutonomousOptimizerStatus(): Promise<{
  success: boolean;
  health: any;
  autoApplyEnabled: boolean;
  latestAudit: any;
  latestStrategyAllocation?: any;
  decisions: any[];
  builds: any[];
  championStrategy: any;
}> {
  return fetchWithFailover('/autonomous-optimizer/status');
}

export async function triggerAutonomousOptimizerRun(): Promise<{
  success: boolean;
  decision: any;
  latestAudit: any;
  latestStrategyAllocation?: any;
  builds: any[];
  championStrategy: any;
}> {
  return fetchWithFailover('/autonomous-optimizer/run', { method: 'POST' });
}

export async function fetchStrategyAllocation(): Promise<{
  success: boolean;
  allocation: any;
}> {
  return fetchWithFailover('/strategy-allocator/current');
}

export async function reallocateStrategyCapital(): Promise<{
  success: boolean;
  decision: any;
  allocation: any;
  activeGridCapitalUsd: number;
}> {
  return fetchWithFailover('/strategy-allocator/reallocate', { method: 'POST' });
}

export async function toggleAutonomousOptimizer(enabled?: boolean): Promise<{
  success: boolean;
  autoApplyEnabled: boolean;
}> {
  return fetchWithFailover('/autonomous-optimizer/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  });
}

// 3-Way Trade Decision Architecture (BUY / SELL / DO NOTHING)
export async function fetchDecisionStats(): Promise<{
  success: boolean;
  stats: import('../types/trading').LearningDecisionStats;
}> {
  return fetchWithFailover('/decisions');
}

export async function evaluateSignalDecision(payload: {
  symbol?: string;
  side: 'BUY' | 'SELL';
  price?: number;
  amount?: number;
  source?: string;
  }): Promise<{
  success: boolean;
  decision: import('../types/trading').TradeDecision;
  stats: import('../types/trading').LearningDecisionStats;
}> {
  return fetchWithFailover('/decisions/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

// -------------------------------------------------------------
// GigPilot Bybit Linear Futures Services
// -------------------------------------------------------------
export interface GigPilotMarket {
  symbol: string;
  mid: number;
  last: number;
  mark: number;
  spread_bps: number;
  funding_rate: number;
  tick_age_ms: number;
  imbalance: number;
  atr_bps: number;
  fee_bps: number;
}

export interface GigPilotSignal {
  symbol: string;
  side: string;
  gross_bps: number;
  fee_bps: number;
  spread_bps: number;
  slip_bps: number;
  funding_bps: number;
  net_bps: number;
  tradable: boolean;
  reason: string;
  ts_ms: number;
}

export interface GigPilotPosition {
  symbol: string;
  side: string;
  qty: number;
  entry: number;
  mark: number;
  upnl: number;
}

export interface GigPilotEvent {
  ts: string;
  kind: string;
  symbol: string;
  side?: string;
  px?: number;
  qty?: number;
  fee?: number;
  closed_pnl?: number;
  link?: string;
  [key: string]: any;
}

export interface GigPilotState {
  success: boolean;
  reachable?: boolean;
  error?: string;
  reasons?: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  idempotent?: boolean;
  daemonRunning?: boolean;
  ts: string;
  armed: boolean;
  host: string;
  position_mode?: string | null;
  hurdle_bps: number;
  equity: number | null;
  margin_ratio: number | null;
  gross_notional: number | null;
  daily_pnl: number | null;
  realized_today: number | null;
  positions: GigPilotPosition[];
  signals: GigPilotSignal[];
  markets: GigPilotMarket[];
  events: GigPilotEvent[];
  message?: string;
  live_execution_policy?: string;
  paper?: { enabled:boolean; real_capital_execution:boolean; starting_equity:number; synthetic_equity:number; realized_pnl:number; unrealized_pnl:number; active_positions:GigPilotPosition[]; closed_trades:number; wins:number; win_rate:number; realized_slippage_bps:number; fills:number; rejections:Array<{ts:string;ts_ms:number;symbol:string;reason:string;[key:string]:any}>; model?:string|null };
  capital?:{equity_usd:number;available_usdt:number;deployed_notional_usd:number;min_order_notional_usd:number;capital_usage_pct:number;positioning:string};
  ops?: { l2_depth?:{required:number;symbols:Record<string,number>;min_symbol:number;ready:boolean}; services:Record<string,{name:string;active:boolean;state:string;enabled:string}>; l2_buffer:{rows:number;first_ts_ms?:number|null;last_ts_ms?:number|null;span_ms:number;db_bytes:number;disk_total_bytes:number;disk_used_bytes:number;disk_free_bytes:number;disk_used_pct:number} };
  ml?: {
    research_audits?: Array<{
      ts_ms:number; model_id:string; outcome:string; reason:string; payload?:any;
    }>;
    latest_audit?: any;
  };
}

export async function fetchGigPilotState(): Promise<GigPilotState> {
  return fetchWithFailover<GigPilotState>('/gigpilot/state');
}

export async function armGigPilot(): Promise<{ success: boolean; armed: boolean; error?: string; idempotent?: boolean; reasons?: Array<{ code: string; message: string; details?: Record<string, unknown> }> }> {
  return fetchWithFailover<{ success: boolean; armed: boolean; error?: string; idempotent?: boolean; reasons?: Array<{ code: string; message: string; details?: Record<string, unknown> }> }>('/gigpilot/arm', {
    method: 'POST'
  });
}

export async function disarmGigPilot(): Promise<{ success: boolean; armed: boolean | null; message?: string; error?: string }> {
  return fetchWithFailover<{ success: boolean; armed: boolean | null; message?: string; error?: string }>('/gigpilot/disarm', {
    method: 'POST'
  });
}

export async function killGigPilot(): Promise<{ success: boolean; killed: boolean; message?: string }> {
  return fetchWithFailover<{ success: boolean; killed: boolean; message?: string }>('/gigpilot/kill', {
    method: 'POST'
  });
}

// -------------------------------------------------------------
// LIVE arm/disarm control plane with a per-session runtime API secret
// -------------------------------------------------------------
// The arm/disarm control plane is mounted at the API ROOT (/api/arm, /api/disarm,
// /api/credentials/runtime), NOT under the /api/trading prefix the trading routes use. Derive the
// same host candidates with that prefix stripped and reuse fetchWithFailover so owner-token
// injection, timeouts and host failover are identical to every other owner-authenticated call.
function getControlPlaneBaseUrls(): string[] {
  const candidates = getCandidateBaseUrls()
    .map((u) => u.replace(/\/api\/trading\/?$/i, ''))
    .filter((u) => u.length > 0);

  // Amplify already reverse-proxies /api/* to the production EC2 control plane (amplify.yml).
  // Prefer that same-origin path for owner auth so Safari/Chrome do not depend on cross-origin
  // CORS for the security-critical login request. The backend origin remains a failover.
  if (typeof window !== 'undefined' && window.location?.origin) {
    const host = window.location.hostname;
    const isAmplifyHost = host.endsWith('.amplifyapp.com');
    if (isAmplifyHost) {
      candidates.unshift(window.location.origin);
    }
  }

  return [...new Set(candidates)];
}

/** A structured blocker/reason from the control plane. Shape mirrors the engine's reason objects. */
export interface ControlPlaneReason {
  code?: string;
  message?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface RuntimeCredentialStatus {
  success: boolean;
  requireRuntimeSecret: boolean;
  secretLoaded: boolean;
  loaded: string[];
  detail: Record<string, unknown>;
  secretSource: 'runtime' | 'config' | 'none';
  persisted: false;
}

/**
 * GET /api/credentials/runtime — reports whether a runtime secret is required/loaded. The server
 * never returns the secret value, only policy. `requireRuntimeSecret` drives the prompt: a deployment
 * that does not require hand-entry must not ask for a secret on every arm.
 */
export async function fetchRuntimeCredentialStatus(): Promise<RuntimeCredentialStatus> {
  return await fetchWithFailover<RuntimeCredentialStatus>('/api/credentials/runtime', {
    baseUrls: getControlPlaneBaseUrls()
  });
}

export interface ArmControlResult {
  success: boolean;
  armed: boolean;
  error?: string;
  reasons?: ControlPlaneReason[];
  runtimeSecretLoaded?: boolean;
  idempotent?: boolean;
}

/**
 * POST /api/arm with the hand-entered runtime secret.
 *
 * The caller owns the secret: it is placed straight into the request body and is never stored,
 * logged, or echoed back. 422 (rejected) and 428 (secret required) are normal control-flow
 * responses, so their structured body is returned to the UI rather than thrown.
 */
export async function armLive(apiSecret?: string): Promise<ArmControlResult> {
  try {
    return await fetchWithFailover<ArmControlResult>('/api/arm', {
      baseUrls: getControlPlaneBaseUrls(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiSecret: apiSecret ?? '' })
    });
  } catch (err: any) {
    if (err?.data && typeof err.data === 'object') return err.data as ArmControlResult;
    return { success: false, armed: false, error: err?.message || 'ARM request failed' };
  }
}

export interface DisarmControlResult {
  success: boolean;
  armed: boolean;
  runtimeSecretCleared?: boolean;
  idempotent?: boolean;
  error?: string;
}

/** POST /api/disarm — ends the armed session and scrubs the runtime secret from engine memory. */
export async function disarmLive(): Promise<DisarmControlResult> {
  try {
    return await fetchWithFailover<DisarmControlResult>('/api/disarm', {
      baseUrls: getControlPlaneBaseUrls(),
      method: 'POST'
    });
  } catch (err: any) {
    if (err?.data && typeof err.data === 'object') return err.data as DisarmControlResult;
    return { success: false, armed: true, error: err?.message || 'DISARM request failed' };
  }
}

export async function fetchGigPilotHealth(): Promise<{
  success: boolean;
  daemonRunning: boolean;
  healthy: boolean;
  public_ws: boolean;
  private_ws: boolean;
  feed_fresh: boolean;
  armed: boolean;
  host: string;
  position_mode?: string;
}> {
  return fetchWithFailover('/gigpilot/health');
}

export async function fetchReconciliationStatus(): Promise<{
  success: boolean;
  reconciliation: ReconciliationAuditStatus;
}> {
  return fetchWithFailover<{
    success: boolean;
    reconciliation: ReconciliationAuditStatus;
  }>('/reconciliation/status');
}

export async function triggerReconciliationAudit(autoHeal: boolean = true): Promise<{
  success: boolean;
  message?: string;
  reconciliation: ReconciliationAuditStatus;
  error?: string;
}> {
  return fetchWithFailover<{
    success: boolean;
    message?: string;
    reconciliation: ReconciliationAuditStatus;
    error?: string;
  }>('/reconciliation/audit', {
    method: 'POST',
    body: JSON.stringify({ autoHeal })
  });
}



export interface GigPilotMLAudit {
  ts_ms: number;
  model_id: string;
  outcome: string;
  reason: string;
  model_family: string;
  gross_edge_bps: number;
  cost_deductions: { fees_bps:number; two_x_peak_spread_bps:number; modeled_impact_bps:number };
  net_edge_bps: number;
  t_stat: number;
  oos_sharpe: number;
  gate_outcome: boolean;
  gate_thresholds: { net_edge_bps:number; t_stat:number; oos_sharpe:number };
}

export async function fetchMLAuditLatest(limit = 50): Promise<{success:boolean; audits:GigPilotMLAudit[]}> {
  return fetchWithFailover('/ml/audit/latest?limit=' + encodeURIComponent(String(limit)));
}

// -------------------------------------------------------------
// ML Research & Audit — champion/challenger tournament surface
// -------------------------------------------------------------
// The tournament control plane is mounted at the API ROOT (/api/ml/...), NOT under the /api/trading
// prefix the trading routes use. We therefore derive the same host candidates with that prefix
// stripped, and reuse fetchWithFailover so the owner token, timeout and failover are identical to
// every other owner-authenticated call.
function getMLRootBaseUrls(): string[] {
  return [
    ...new Set(
      getCandidateBaseUrls()
        .map((u) => u.replace(/\/api\/trading\/?$/i, ''))
        .filter((u) => u.length > 0)
    )
  ];
}

/** Gate thresholds exactly as reported by the backend; never hardcoded in the UI. */
export interface MLTournamentGates {
  min_net_edge_bps: number;
  min_oos_sharpe: number;
  min_profit_factor: number;
  min_t_stat: number;
  min_walk_forward_folds: number;
  min_oos_trades: number;
}

/** A candidate that was evaluated. `champion`/`winners` use this shape; `rejection` explains a miss. */
export interface MLTournamentCandidate {
  model_id: string;
  family: string;
  liquidity: string;
  net_edge_bps: number;
  oos_sharpe: number;
  profit_factor: number;
  t_stat: number;
  oos_trades: number;
  folds: number;
  max_drawdown_bps?: number;
  verified?: boolean;
  rejection?: string;
}

/** A ranked loser. Only these carry a `reason`; there is no `verified`/drawdown for unadmitted work. */
export interface MLRejectedRankedCandidate {
  model_id: string;
  family: string;
  liquidity: string;
  net_edge_bps: number;
  oos_sharpe: number;
  profit_factor: number;
  t_stat: number;
  oos_trades: number;
  folds: number;
  reason: string;
}

export interface MLTournamentPromotion {
  allowed: boolean;
  target_state: string;
  reason: string;
}

export type MLTournamentOutcome =
  | 'NO_CANDIDATE_CLEARED_GATES'
  | 'CHALLENGER_PROMOTED_TO_PAPER'
  | 'CHAMPION_HELD';

export interface MLTournament {
  version: number;
  symbol: string;
  started_at_ms: number;
  ended_at_ms: number;
  duration_ms: number;
  generations: number;
  population_size: number;
  candidates_evaluated: number;
  candidates_admitted: number;
  seed: number;
  bars_used: number;
  window_days: number;
  l2_ready: boolean;
  peak_spread_bps: number;
  gates: MLTournamentGates;
  champion: MLTournamentCandidate | null;
  winners: MLTournamentCandidate[];
  promotion: MLTournamentPromotion | null;
  rejected_ranked: MLRejectedRankedCandidate[];
  outcome: MLTournamentOutcome;
}

/** Frozen contract: GET /api/ml/tournament/latest?symbol=BTCUSDT (owner-authenticated). */
export interface MLTournamentResponse {
  success: boolean;
  available: boolean;
  tournament: MLTournament | null;
  real_capital_execution: boolean | null;
}

export async function fetchMLTournamentLatest(symbol = 'BTCUSDT'): Promise<MLTournamentResponse> {
  // The tournament keys results by venue symbol (BTCUSDT), not the display pair (BTC/USDT).
  const normalized = symbol.replace(/[\/\-_]/g, '').toUpperCase() || 'BTCUSDT';
  return await fetchWithFailover<MLTournamentResponse>(
    `/api/ml/tournament/latest?symbol=${encodeURIComponent(normalized)}`,
    { baseUrls: getMLRootBaseUrls() }
  );
}


/* ============================================================================================
 * Credential vault — owner-only exchange credentials and the withdrawal allowlist.
 *
 * These calls carry LIVE exchange secrets in the request body. Nothing here persists them: the
 * functions below deliberately have no cache, no module-level state, and no logging, and they never
 * touch durable browser storage, session storage, or cookies. The server holds them in memory.
 * ========================================================================================== */

export interface VaultExchangeStatus {
  label: string;
  keyLoaded: boolean;
  secretLoaded: boolean;
  ready: boolean;
  keyConsoleUrl: string;
  requiredPermissions: string;
  forbiddenPermissions: string;
}

export interface VaultWithdrawalAddress {
  exchange: string;
  network: string;
  address: string;
  label: string;
  set_at_ms: number;
}

export interface CredentialVaultStatus {
  success: boolean;
  exchanges: Record<string, VaultExchangeStatus>;
  withdrawalAddresses: Record<string, VaultWithdrawalAddress>;
  withdrawalConfirmationPhrase: string;
  persisted: boolean;
  withdrawalExecutionEnabled: boolean;
}

export interface CredentialVerification {
  attempted: boolean;
  ok?: boolean;
  message?: string;
  withdrawalPermissionRefused?: boolean;
}

export interface StoreCredentialsResult {
  success: boolean;
  error?: string;
  message?: string;
  exchanges?: Record<string, VaultExchangeStatus>;
  verification?: CredentialVerification;
  persisted?: boolean;
}

/** GET /api/credentials/vault — which exchanges are loaded, and where profit may be sent. */
export async function fetchCredentialVault(): Promise<CredentialVaultStatus> {
  return await fetchWithFailover<CredentialVaultStatus>('/api/credentials/vault', {
    baseUrls: getControlPlaneBaseUrls()
  });
}

/**
 * POST /api/credentials/exchange — load an exchange key pair into engine memory.
 *
 * 422 (invalid credentials) and 403 (confirmation required) are expected control-flow answers, so
 * the structured body is returned to the UI instead of thrown.
 */
export async function storeExchangeCredentials(
  exchange: string,
  apiKey: string,
  apiSecret: string
): Promise<StoreCredentialsResult> {
  try {
    return await fetchWithFailover<StoreCredentialsResult>('/api/credentials/exchange', {
      baseUrls: getControlPlaneBaseUrls(),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exchange, apiKey, apiSecret })
    });
  } catch (err: any) {
    if (err?.data && typeof err.data === 'object') return err.data as StoreCredentialsResult;
    return { success: false, error: err?.message || 'Credential request failed' };
  }
}

export interface WithdrawalAddressResult {
  success: boolean;
  error?: string;
  message?: string;
  withdrawalAddresses?: Record<string, VaultWithdrawalAddress>;
}

/**
 * POST /api/credentials/withdrawal-address — set the SINGLE destination profit may go to.
 *
 * `confirmation` must match the phrase the server publishes. This endpoint does not move funds and
 * there is no endpoint that does: the allowlist is a destination record, not a transfer.
 */
export async function setWithdrawalAddress(
  exchange: string,
  network: string,
  address: string,
  confirmation: string,
  label = ''
): Promise<WithdrawalAddressResult> {
  try {
    return await fetchWithFailover<WithdrawalAddressResult>(
      '/api/credentials/withdrawal-address',
      {
        baseUrls: getControlPlaneBaseUrls(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange, network, address, confirmation, label })
      }
    );
  } catch (err: any) {
    if (err?.data && typeof err.data === 'object') return err.data as WithdrawalAddressResult;
    return { success: false, error: err?.message || 'Withdrawal address request failed' };
  }
}

/** POST /api/credentials/withdrawal-address/clear — forget the allowlisted destination. */
export async function clearWithdrawalAddress(
  exchange: string
): Promise<WithdrawalAddressResult> {
  try {
    return await fetchWithFailover<WithdrawalAddressResult>(
      '/api/credentials/withdrawal-address/clear',
      {
        baseUrls: getControlPlaneBaseUrls(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange, network: '', address: '', confirmation: '' })
      }
    );
  } catch (err: any) {
    if (err?.data && typeof err.data === 'object') return err.data as WithdrawalAddressResult;
    return { success: false, error: err?.message || 'Clear request failed' };
  }
}
