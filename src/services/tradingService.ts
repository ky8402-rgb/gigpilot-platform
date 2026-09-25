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
  ProfitSweep,
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

const OWNER_TOKEN_STORAGE_KEY = 'gigpilot_owner_token';

export function getStoredOwnerToken(): string | null {
  try {
    return localStorage.getItem(OWNER_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredOwnerToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(OWNER_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(OWNER_TOKEN_STORAGE_KEY);
  } catch {
    // Storage availability must not affect exchange API truth.
  }
}

export async function fetchWithFailover<T>(
  endpointPath: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const candidates = getCandidateBaseUrls();
  let lastError: Error | null = null;
  const timeoutMs = options?.timeoutMs ?? 15000;

  const mergedHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(options?.headers as Record<string, string> || {})
  };
  const token = getStoredOwnerToken();
  if (token) mergedHeaders.Authorization = `Bearer ${token}`;

  const { timeoutMs: _timeout, ...fetchOptions } = options || {};
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

      // Successful JSON response indicates the backend is reached and active
      workingBaseUrl = baseUrl;
      isBackendLive = true;
      lastSyncTimestamp = new Date().toISOString();

      if (!res.ok) {
        const errMsg = data?.error || data?.message || `API error HTTP ${res.status}`;
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

export async function fetchTradingState(): Promise<MasterTradingState> {
  return await fetchWithFailover<MasterTradingState>('/state');
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

export async function fetchAutonomousOptimizer(): Promise<{
  success: boolean;
  objective: 'NET_REALIZED_PROFIT_AFTER_FEES';
  autonomousDecisioning: boolean;
  decisions: any[];
  strategyBuilds: any[];
  engine: any;
}> {
  const res = await fetchWithFailover<any>('/optimizer');
  if (!res?.success) throw new Error('Autonomous optimizer telemetry unavailable.');
  return res;
}

export async function runAutonomousOptimizer() {
  return await fetchWithFailover<any>('/optimizer/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function fetchStrategies(): Promise<{
  champion: StrategyVersion;
  challengers: StrategyVersion[];
  history: StrategyVersion[];
}> {
  const res = await fetchWithFailover<{
    champion: StrategyVersion;
    challengers: StrategyVersion[];
    history: StrategyVersion[];
  }>('/strategies');
  if (!res.champion) throw new Error('Live strategy state unavailable: champion strategy is missing.');
  return res;
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

export async function executeUserScript(code: string) {
  return await fetchWithFailover<{
    success: boolean;
    result: {
      success: boolean;
      logs: string[];
      ordersGenerated: any[];
      executionTimeMs: number;
      error?: string;
    };
  }>('/script/execute', {
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
  return await fetchWithFailover('/profit-sweep');
}

export async function updateDestinationWallet(wallet: { address: string; chain: string; label?: string }) {
  return await fetchWithFailover<{ success: boolean; wallet: DestinationWallet }>('/profit-sweep/wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wallet)
  });
}

export async function executeProfitSweep(amount: number) {
  return await fetchWithFailover<{ success: boolean; sweep?: ProfitSweep; updatedCapital?: CapitalAccounting; error?: string }>('/profit-sweep/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount })
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
  return await fetchWithFailover<{ success: boolean; circuitBreakerActive: boolean }>('/risk/reset-circuit-breaker', {
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
  isTestnet?: boolean
): Promise<{ success: boolean; message: string; accountState?: any; error?: string }> {
  return await fetchWithFailover<{ success: boolean; message?: string; error?: string }>('/exchanges/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exchange: 'BYBIT', apiKey, apiSecret, isTestnet }),
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
    const res = await fetchWithFailover<{ success: boolean; token?: string; error?: string }>('/auth/login', {
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

export async function logoutOwner(): Promise<void> {
  await fetchWithFailover('/auth/logout', { method: 'POST' });
  setStoredOwnerToken(null);
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
  simulatedRegime?: string;
  simulatedEdgeBps?: number;
  simulatedDepthUsd?: number;
  simulatedBaseRatio?: number;
  simulatedLiquidationDistancePct?: number;
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
