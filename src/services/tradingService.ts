import {
  AuditLog,
  AutonomyLevel,
  BinanceAccountState,
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
import {
  DEFAULT_AUDIT_LOGS,
  DEFAULT_CHAMPION_STRATEGY,
  DEFAULT_DESTINATION_WALLET,
  DEFAULT_RESEARCH_ITEMS,
  DEFAULT_RISK_DATA,
  DEFAULT_SWEEPS,
  DEFAULT_SYSTEM_UPDATES,
  generateDefaultGrid,
  generateDefaultMasterState,
  generateDefaultOrders
} from '../data/defaultTradingData';

// Track connection health
let isBackendLive: boolean = false;
let workingBaseUrl: string | null = null;
let lastSyncTimestamp: string = new Date().toISOString();

export function isEngineLiveConnected(): boolean {
  return isBackendLive;
}

export function getLastSyncTime(): string {
  return lastSyncTimestamp;
}

// In-memory simulated fallback store so user can test all controls even if offline
let fallbackMasterState: MasterTradingState = generateDefaultMasterState();
let fallbackPairs: Array<{ symbol: string; price: number; open24h: number; high24h: number; low24h: number; volume24h: number; change24hPct: number }> = [];
const offlineStrategy: StrategyVersion = {
  ...DEFAULT_CHAMPION_STRATEGY,
  status: 'VALIDATING',
  validationScore: 0,
  backtestResults: {
    netProfit: 0,
    grossProfit: 0,
    totalFees: 0,
    roiPct: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdownPct: 0,
    winRatePct: 0,
    profitFactor: 0,
    tradesCount: 0,
    avgTradeProfitUsd: 0,
    avgHoldingTimeMinutes: 0,
    orderFillRatePct: 0,
    capitalUtilizationPct: 0
  },
  actualEffect: 'Backend unavailable; strategy performance is not available.'
};
let fallbackStrategies: StrategyVersion[] = [offlineStrategy];
let fallbackResearch = [...DEFAULT_RESEARCH_ITEMS];
let fallbackSweeps = [...DEFAULT_SWEEPS];
let fallbackAuditLogs = [...DEFAULT_AUDIT_LOGS];
let fallbackUpdates = [...DEFAULT_SYSTEM_UPDATES];

/**
 * Return prioritized candidate base URLs for trading API:
 * 1. Previously confirmed working base URL
 * 2. Explicit environment variable if configured
 * 3. Relative co-located path (/api/trading) - works for local dev, Express, and Amplify rewrites
 * 4. Direct AWS EC2 backend (https://3-222-149-9.sslip.io/api/trading)
 */
export function getCandidateBaseUrls(): string[] {
  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL || (import.meta as any).env?.VITE_API_URL || (import.meta as any).env?.VITE_API_BASE_URL;
  const urls: string[] = [];

  if (workingBaseUrl) {
    urls.push(workingBaseUrl);
  }

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    urls.push(`${envUrl.replace(/\/$/, '')}/api/trading`);
  }

  // 1. Same-origin relative path
  urls.push('/api/trading');

  // 2. Direct AWS EC2 endpoint
  urls.push('https://3-222-149-9.sslip.io/api/trading');

  return [...new Set(urls)];
}

const OWNER_TOKEN_STORAGE_KEY = 'gigpilot_owner_token';

export function getStoredOwnerToken(): string | null {
  // Owner authentication is cookie-based; tokens are intentionally not exposed
  // to JavaScript/localStorage where an XSS could steal them.
  return null;
}

export function setStoredOwnerToken(_token: string | null): void {
  // Retained as a compatibility no-op for existing callers.
}

/**
 * Resilient multi-endpoint HTTP fetch with timeout and automatic failover.
 * Never throws an uncaught fatal error that crashes the UI.
 */
async function fetchWithFailover<T>(endpointPath: string, options?: RequestInit): Promise<T> {
  const candidates = getCandidateBaseUrls();
  let lastError: any = null;

  const mergedHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(options?.headers as Record<string, string> || {})
  };

  const mergedOptions: RequestInit = {
    ...options,
    credentials: 'include',
    headers: mergedHeaders
  };

  for (const baseUrl of candidates) {
    const cleanEndpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    const targetUrl = `${baseUrl}${cleanEndpoint}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(targetUrl, {
        ...mergedOptions,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') || '';
      // If server returned HTML (e.g. Amplify S3 fallback or Cloud Run auth redirect), failover to next candidate
      if (!contentType.includes('application/json')) {
        continue;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      // Mark this candidate as working!
      workingBaseUrl = baseUrl;
      isBackendLive = true;
      lastSyncTimestamp = new Date().toISOString();
      return data as T;
    } catch (err: any) {
      lastError = err;
      // Continue to next candidate
    }
  }

  isBackendLive = false;
  throw lastError || new Error(`All backend candidates unreachable for ${endpointPath}`);
}

export async function fetchTradingState(): Promise<MasterTradingState> {
  try {
    const liveState = await fetchWithFailover<MasterTradingState>('/state');
    fallbackMasterState = liveState;
    return liveState;
  } catch (err) {
    console.info('[tradingService] Using client simulation engine for trading state:', (err as any)?.message);
    fallbackMasterState.serverTime = new Date().toISOString();
    return fallbackMasterState;
  }
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
  try {
    const data = await fetchWithFailover<{ success: boolean; pairs: any[] }>('/pairs');
    fallbackPairs = data.pairs;
    return data.pairs;
  } catch {
    return [];
  }
}

export async function fetchPairDetails(symbol: string) {
  try {
    return await fetchWithFailover<{
      success: boolean;
      symbol: string;
      currentPrice: number;
      candles: any[];
      orderBook: { bids: any[]; asks: any[] };
      indicators: any;
    }>(`/pair/${encodeURIComponent(symbol)}`);
  } catch (err: any) {
    return {
      success: false,
      symbol,
      currentPrice: 0,
      candles: [],
      orderBook: { bids: [], asks: [] },
      indicators: null,
      error: err.message || 'Live market telemetry unavailable.'
    };
  }
}

export async function selectActivePair(symbol: string) {
  try {
    const res = await fetchWithFailover<{ success: boolean; symbol: string }>('/pair/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    fallbackMasterState.activeSymbol = symbol;
    return res;
  } catch (err: any) {
    return { success: false, symbol, error: err.message || 'Failed to select active pair.' };
  }
}

export async function setAutonomyLevel(level: AutonomyLevel) {
  try {
    const res = await fetchWithFailover<{ success: boolean; level: AutonomyLevel }>('/autonomy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level })
    });
    fallbackMasterState.autonomyLevel = level;
    fallbackMasterState.botsDisabled = level === 0;
    fallbackMasterState.activeBotsCount = level === 0 ? 0 : 1;
    return res;
  } catch (err: any) {
    return { success: false, level, error: err.message || 'Failed to change autonomy level.' };
  }
}

export async function setTradingMode}

export async function setTradingMode(mode: TradingMode) {
  try {
    const res = await fetchWithFailover<{ success: boolean; mode: TradingMode }>('/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    fallbackMasterState.tradingMode = mode;
    return res;
  } catch (err: any) {
    return { success: false, mode, error: err.message || 'Failed to change trading mode.' };
  }
}

export async function triggerKillSwitch}

export async function triggerKillSwitch(reason?: string) {
  try {
    const res = await fetchWithFailover<{ success: boolean; GLOBAL_KILL_SWITCH_ACTIVE: boolean; botsDisabled: boolean; killSwitch: any }>('/kill-switch/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    fallbackMasterState.GLOBAL_KILL_SWITCH_ACTIVE = true;
    fallbackMasterState.botsDisabled = true;
    fallbackMasterState.activeBotsCount = 0;
    fallbackMasterState.autonomyLevel = 0;
    fallbackMasterState.killSwitch.isActive = true;
    return res;
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to activate kill switch on backend.' };
  }
}

export async function deactivateKillSwitch}

export async function deactivateKillSwitch() {
  try {
    const res = await fetchWithFailover<{ success: boolean; GLOBAL_KILL_SWITCH_ACTIVE: boolean; botsDisabled: boolean; killSwitch: any }>('/kill-switch/deactivate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    fallbackMasterState.GLOBAL_KILL_SWITCH_ACTIVE = false;
    fallbackMasterState.botsDisabled = false;
    fallbackMasterState.activeBotsCount = 1;
    fallbackMasterState.autonomyLevel = 1;
    fallbackMasterState.killSwitch.isActive = false;
    return res;
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to release backend kill switch.' };
  }
}

export async function toggleGlobalKillSwitch}

export async function toggleGlobalKillSwitch(active?: boolean, reason?: string) {
  try {
    const res = await fetchWithFailover<{ success: boolean; GLOBAL_KILL_SWITCH_ACTIVE: boolean; botsDisabled: boolean; killSwitch: any }>('/kill-switch/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, reason })
    });
    const nextActive = res.GLOBAL_KILL_SWITCH_ACTIVE;
    fallbackMasterState.GLOBAL_KILL_SWITCH_ACTIVE = nextActive;
    fallbackMasterState.botsDisabled = nextActive;
    fallbackMasterState.activeBotsCount = nextActive ? 0 : 1;
    fallbackMasterState.autonomyLevel = nextActive ? 0 : 1;
    fallbackMasterState.killSwitch.isActive = nextActive;
    return res;
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to change backend kill switch state.' };
  }
}

export async function configureGrid}

export async function configureGrid(config: {
  upperBoundary?: number;
  lowerBoundary?: number;
  levelsCount?: number;
  spacingType?: 'ARITHMETIC' | 'GEOMETRIC';
  totalAllocatedUsd?: number;
  volatilityAdjustment?: boolean;
  trendProtection?: boolean;
}): Promise<{ success: boolean; grid: GridConfiguration }> {
  try {
    const res = await fetchWithFailover<{ success: boolean; grid: GridConfiguration }>('/grid/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    fallbackMasterState.activeGrid = res.grid;
    return res;
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to configure live grid on backend.' };
  }
}

export async function placeManualOrder}

export async function placeManualOrder(order: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price: number;
  amount: number;
}): Promise<{ success: boolean; order?: Order; error?: string }> {
  try {
    const res = await fetchWithFailover<{ success: boolean; order?: Order; error?: string }>('/order/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });
    if (res.order) {
      fallbackMasterState.openOrders.unshift(res.order);
    }
    return res;
  } catch (err: any) {
    return { success: false, error: err.message || 'Live order placement could not be confirmed by backend.' };
  }
}

export async function cancelOrder(orderId: string) {
  try {
    const res = await fetchWithFailover<{ success: boolean; orderId: string }>('/order/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId })
    });
    fallbackMasterState.openOrders = fallbackMasterState.openOrders.filter(o => o.id !== orderId);
    return res;
  } catch {
    fallbackMasterState.openOrders = fallbackMasterState.openOrders.filter(o => o.id !== orderId);
    return { success: true, orderId };
  }
}

export async function cancelAllOrders() {
  try {
    const res = await fetchWithFailover<{ success: boolean; count: number }>('/order/cancel-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    fallbackMasterState.openOrders = [];
    return res;
  } catch {
    const count = fallbackMasterState.openOrders.length;
    fallbackMasterState.openOrders = [];
    return { success: true, count };
  }
}

export async function fetchStrategies(): Promise<{
  champion: StrategyVersion;
  challengers: StrategyVersion[];
  history: StrategyVersion[];
}> {
  try {
    return await fetchWithFailover<{
      champion: StrategyVersion;
      challengers: StrategyVersion[];
      history: StrategyVersion[];
    }>('/strategies');
  } catch {
    return {
      champion: fallbackStrategies[0],
      challengers: [],
      history: []
    };
  }
}

export async function promoteChallenger(challengerId: string) {
  try {
    return await fetchWithFailover<{ success: boolean; reason: string; champion?: StrategyVersion }>('/strategy/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengerId })
    });
  } catch (err: any) {
    return { success: false, reason: err.message || 'Strategy promotion could not be confirmed by backend.' };
  }
}

export async function createStrategyVariant(params: {
  baseStrategyId: string;
  name: string;
  reasonForChange: string;
  parameters: Partial<StrategyVersion['parameters']>;
  expectedEffect: string;
}) {
  try {
    return await fetchWithFailover<{ success: boolean; challenger: StrategyVersion }>('/strategy/create-variant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
  } catch (err: any) {
    return { success: false, error: err.message || 'Strategy variant creation could not be confirmed by backend.' };
  }
}

export async function executeUserScript(code: string) {
  try {
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
  } catch (err: any) {
    return {
      success: false,
      result: {
        success: false,
        logs: [],
        ordersGenerated: [],
        executionTimeMs: 0,
        error: err.message || 'Script execution could not be confirmed by backend.'
      }
    };
  }
}

export async function fetchWebResearch(): Promise<{ items: ResearchItem[] }> {
  try {
    const res = await fetchWithFailover<{ success: boolean; items: ResearchItem[] }>('/research');
    return { items: res.items };
  } catch {
    return { items: [] };
  }
}

export async function analyzeResearchIntelligence(title: string, content: string, source: string) {
  try {
    return await fetchWithFailover<{ success: boolean; item: ResearchItem }>('/research/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, source })
    });
  } catch (err: any) {
    return { success: false, error: err.message || 'Research analysis could not be confirmed by backend.' };
  }
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
  try {
    return await fetchWithFailover<{
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
    }>('/profit-sweep');
  } catch (err: any) {
    return {
      destinationWallet: DEFAULT_DESTINATION_WALLET,
      minSweepThresholdUsd: 50,
      profitReserveBufferUsd: 200,
      eligibility: {
        eligibleAmount: 0,
        canSweep: false,
        reserveRetained: 0,
        reason: err.message || 'Backend unavailable; sweep eligibility is not available.'
      },
      history: []
    };
  }
}

export async function updateDestinationWallet(wallet: { address: string; chain: string; label?: string }) {
  try {
    return await fetchWithFailover<{ success: boolean; wallet: DestinationWallet }>('/profit-sweep/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wallet)
    });
  } catch (err: any) {
    return { success: false, error: err.message || 'Destination wallet update could not be confirmed by backend.' };
  }
}

export async function executeProfitSweep(amount: number) {
  try {
    return await fetchWithFailover<{ success: boolean; sweep?: ProfitSweep; updatedCapital?: CapitalAccounting; error?: string }>('/profit-sweep/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
  } catch (err: any) {
    return { success: false, error: err.message || 'Profit sweep could not be confirmed by backend. No funds were moved.' };
  }
}

export async function fetchRiskData(): Promise<{
  config: RiskRuleConfig;
  circuitBreakerActive: boolean;
  events: any[];
}> {
  try {
    return await fetchWithFailover<{
      config: RiskRuleConfig;
      circuitBreakerActive: boolean;
      events: any[];
    }>('/risk');
  } catch {
    return {
      config: DEFAULT_RISK_DATA as any,
      circuitBreakerActive: true,
      events: [{ type: 'BACKEND_UNAVAILABLE', status: 'FAIL_CLOSED', message: 'Live risk state unavailable; trading controls are disabled.' }]
    };
  }
}

export async function updateRiskConfig(config: Partial<RiskRuleConfig>) {
  try {
    return await fetchWithFailover<{ success: boolean; config: RiskRuleConfig }>('/risk/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
  } catch (err: any) {
    return { success: false, error: err.message || 'Risk configuration could not be confirmed by backend.' };
  }
}

export async function resetCircuitBreaker() {
  try {
    return await fetchWithFailover<{ success: boolean; circuitBreakerActive: boolean }>('/risk/reset-circuit-breaker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return { success: false, circuitBreakerActive: true, error: err.message || 'Circuit breaker reset could not be confirmed by backend.' };
  }
}

export async function fetchUpdatesHistory(): Promise<{ updates: SystemUpdate[] }> {
  try {
    return await fetchWithFailover<{ success: boolean; updates: SystemUpdate[] }>('/updates');
  } catch {
    return { updates: [] };
  }
}

export async function triggerCanaryRollout(version?: string, notes?: string) {
  try {
    return await fetchWithFailover<{ success: boolean; update: SystemUpdate }>('/updates/rollout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, notes })
    });
  } catch (err: any) {
    return { success: false, error: err.message || 'Canary rollout could not be confirmed by backend.' };
  }
}

export async function fetchAuditLogs(): Promise<{ logs: AuditLog[] }> {
  try {
    return await fetchWithFailover<{ success: boolean; logs: AuditLog[] }>('/audit-logs');
  } catch {
    return { logs: fallbackAuditLogs };
  }
}

// ==========================================
// REAL BINANCE ASSETS & OWNER AUTHENTICATION
// ==========================================

export async function fetchLiveAssets(forceRefresh = false): Promise<{ success: boolean; assets: BinanceAccountState }> {
  try {
    return await fetchWithFailover<{ success: boolean; assets: BinanceAccountState }>(`/assets${forceRefresh ? '?refresh=true' : ''}`);
  } catch (err: any) {
    return {
      success: false,
      assets: {
        status: 'DISCONNECTED',
        message: err.message || 'Failed to reach Binance assets API',
        serverIp: '3.222.149.9',
        timestamp: new Date().toISOString(),
        totalEquityUsd: 0,
        availableCashUsd: 0,
        lockedInOrdersUsd: 0,
        withdrawableProfitUsd: 0,
        initialTradingCapitalUsd: 0,
        profitReserveBufferUsd: 0,
        spotBalances: [],
        realizedProfitUsd: 0,
        unrealizedProfitUsd: 0,
        todayPnLUsd: 0,
        todayPnLPct: 0,
        openOrdersCount: 0,
        openOrders: [],
        recentTrades: [],
        transactions: [],
        canTrade: false,
        canWithdraw: false,
        canDeposit: false,
        accountType: 'SPOT',
        apiKeyConfigured: false,
        keyMask: 'NOT CONFIGURED'
      }
    };
  }
}

export async function fetchBinanceStatus(): Promise<{
  success: boolean;
  apiKeyConfigured: boolean;
  keyMask: string;
  serverIp: string;
  baseUrl: string;
  status: string;
}> {
  try {
    return await fetchWithFailover('/binance/status');
  } catch {
    return {
      success: true,
      apiKeyConfigured: false,
      keyMask: 'NOT CONFIGURED',
      serverIp: '3.222.149.9',
      baseUrl: 'https://api.binance.com',
      status: 'UNCONFIGURED'
    };
  }
}

export async function updateBinanceKeys(
  apiKey: string,
  apiSecret: string,
  baseUrl?: string
): Promise<{ success: boolean; message: string; accountState?: any; error?: string }> {
  try {
    return await fetchWithFailover('/binance/update-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, apiSecret, baseUrl })
    });
  } catch (err: any) {
    return { success: false, message: '', error: err.message || 'Failed to update Binance credentials' };
  }
}

export async function fetchOwnerAuthStatus(): Promise<OwnerAuthStatus> {
  try {
    const res = await fetchWithFailover<OwnerAuthStatus & { success: boolean }>('/auth/status');
    return {
      isAuthenticated: res.isAuthenticated,
      isConfigured: res.isConfigured,
      ownerEmail: res.ownerEmail || 'ky8402@gmail.com',
      totpEnabled: res.totpEnabled,
      hasPassword: res.hasPassword,
      GLOBAL_KILL_SWITCH_ACTIVE: res.GLOBAL_KILL_SWITCH_ACTIVE
    };
  } catch {
    return {
      isAuthenticated: !!getStoredOwnerToken(),
      isConfigured: false,
      ownerEmail: 'ky8402@gmail.com',
      totpEnabled: false,
      hasPassword: false,
      GLOBAL_KILL_SWITCH_ACTIVE: true
    };
  }
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
  const res = await fetchWithFailover<{ success: boolean; token?: string; error?: string }>('/auth/setup-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, totpCode, email })
  });
  if (res.success && res.token) {
    setStoredOwnerToken(res.token);
  }
  return res;
}

export async function loginOwner(credentials: {
  email: string;
  password?: string;
  totpCode?: string;
  emergencyPin?: string;
}): Promise<{ success: boolean; token?: string; error?: string }> {
  const res = await fetchWithFailover<{ success: boolean; token?: string; error?: string }>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
  if (res.success && res.token) {
    setStoredOwnerToken(res.token);
  }
  return res;
}

export async function logoutOwner(): Promise<void> {
  try {
    await fetchWithFailover('/auth/logout', { method: 'POST' });
  } catch {}
  setStoredOwnerToken(null);
}

