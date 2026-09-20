import {
  AuditLog,
  AutonomyLevel,
  CapitalAccounting,
  DestinationWallet,
  GridConfiguration,
  MasterTradingState,
  Order,
  ProfitSweep,
  ResearchItem,
  RiskRuleConfig,
  StrategyVersion,
  SystemUpdate,
  TradingMode
} from '../types/trading';

export function getBaseApi(): string {
  // 1. Explicit Vite environment variable
  const envUrl = (import.meta as any).env?.VITE_BACKEND_URL || (import.meta as any).env?.VITE_API_URL || (import.meta as any).env?.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return `${envUrl.replace(/\/$/, '')}/api/trading`;
  }

  // 2. AWS Amplify CloudFront static domain -> Direct to AWS EC2 backend
  if (typeof window !== 'undefined' && window.location.hostname.includes('amplifyapp.com')) {
    return 'https://3-222-149-9.sslip.io/api/trading';
  }

  // 3. Co-located Express server (Local dev, Cloud Run, EC2 standalone)
  return '/api/trading';
}

const BASE_API = getBaseApi();

/**
 * Resilient JSON fetch helper with retry, timeout, content-type validation,
 * and automatic failover from static SPA hosting to live EC2 backend.
 */
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  let attempts = 0;
  const maxAttempts = 3;
  let activeUrl = url;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const res = await fetch(activeUrl, options);
      const contentType = res.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        // If relative URL returned HTML (SPA fallback), immediately failover to live EC2 backend
        if (activeUrl.startsWith('/api/')) {
          activeUrl = `https://3-222-149-9.sslip.io${activeUrl}`;
          continue;
        }

        const text = await res.text();
        console.warn(`[tradingService] Attempt ${attempts}/${maxAttempts}: expected JSON from ${activeUrl}, got ${contentType}:`, text.slice(0, 100));
        if (attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, 600 * attempts));
          continue;
        }
        throw new Error(`Server returned non-JSON response (${res.status})`);
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }
      return data;
    } catch (err: any) {
      if (activeUrl.startsWith('/api/')) {
        activeUrl = `https://3-222-149-9.sslip.io${activeUrl}`;
      }
      if (attempts >= maxAttempts) {
        throw err;
      }
      await new Promise(r => setTimeout(r, 600 * attempts));
    }
  }

  throw new Error(`Failed to fetch ${url} after ${maxAttempts} attempts`);
}

export async function fetchTradingState(): Promise<MasterTradingState> {
  return fetchJson<MasterTradingState>(`${BASE_API}/state`);
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
  const data = await fetchJson<{ success: boolean; pairs: any[] }>(`${BASE_API}/pairs`);
  return data.pairs;
}

export async function fetchPairDetails(symbol: string) {
  return fetchJson<{
    success: boolean;
    symbol: string;
    currentPrice: number;
    candles: any[];
    orderBook: { bids: any[]; asks: any[] };
    indicators: any;
  }>(`${BASE_API}/pair/${encodeURIComponent(symbol)}`);
}

export async function selectActivePair(symbol: string) {
  return fetchJson<{ success: boolean; symbol: string }>(`${BASE_API}/pair/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol })
  });
}

export async function setAutonomyLevel(level: AutonomyLevel) {
  return fetchJson<{ success: boolean; level: AutonomyLevel }>(`${BASE_API}/autonomy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level })
  });
}

export async function setTradingMode(mode: TradingMode) {
  return fetchJson<{ success: boolean; mode: TradingMode }>(`${BASE_API}/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });
}

export async function triggerKillSwitch(reason?: string) {
  return fetchJson<{ success: boolean; killSwitch: any }>(`${BASE_API}/kill-switch/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
}

export async function deactivateKillSwitch() {
  return fetchJson<{ success: boolean; killSwitch: any }>(`${BASE_API}/kill-switch/deactivate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
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
  return fetchJson<{ success: boolean; grid: GridConfiguration }>(`${BASE_API}/grid/configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
}

export async function placeManualOrder(order: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price: number;
  amount: number;
}): Promise<{ success: boolean; order?: Order; error?: string }> {
  return fetchJson<{ success: boolean; order?: Order; error?: string }>(`${BASE_API}/order/place`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order)
  });
}

export async function cancelOrder(orderId: string) {
  return fetchJson<{ success: boolean; orderId: string }>(`${BASE_API}/order/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId })
  });
}

export async function cancelAllOrders() {
  return fetchJson<{ success: boolean; count: number }>(`${BASE_API}/order/cancel-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function fetchStrategies(): Promise<{
  champion: StrategyVersion;
  challengers: StrategyVersion[];
  history: StrategyVersion[];
}> {
  return fetchJson<{
    champion: StrategyVersion;
    challengers: StrategyVersion[];
    history: StrategyVersion[];
  }>(`${BASE_API}/strategies`);
}

export async function promoteChallenger(challengerId: string) {
  return fetchJson<{ success: boolean; reason: string; champion?: StrategyVersion }>(`${BASE_API}/strategy/promote`, {
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
  return fetchJson<{ success: boolean; challenger: StrategyVersion }>(`${BASE_API}/strategy/create-variant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
}

export async function executeUserScript(code: string) {
  return fetchJson<{
    success: boolean;
    result: {
      success: boolean;
      logs: string[];
      ordersGenerated: any[];
      executionTimeMs: number;
      error?: string;
    };
  }>(`${BASE_API}/script/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
}

export async function fetchWebResearch(): Promise<{ items: ResearchItem[] }> {
  return fetchJson<{ success: boolean; items: ResearchItem[] }>(`${BASE_API}/research`);
}

export async function analyzeResearchIntelligence(title: string, content: string, source: string) {
  return fetchJson<{ success: boolean; item: ResearchItem }>(`${BASE_API}/research/analyze`, {
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
  return fetchJson<{
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
  }>(`${BASE_API}/profit-sweep`);
}

export async function updateDestinationWallet(wallet: { address: string; chain: string; label?: string }) {
  return fetchJson<{ success: boolean; wallet: DestinationWallet }>(`${BASE_API}/profit-sweep/wallet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wallet)
  });
}

export async function executeProfitSweep(amount: number) {
  return fetchJson<{ success: boolean; sweep?: ProfitSweep; updatedCapital?: CapitalAccounting; error?: string }>(`${BASE_API}/profit-sweep/execute`, {
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
  return fetchJson<{
    config: RiskRuleConfig;
    circuitBreakerActive: boolean;
    events: any[];
  }>(`${BASE_API}/risk`);
}

export async function updateRiskConfig(config: Partial<RiskRuleConfig>) {
  return fetchJson<{ success: boolean; config: RiskRuleConfig }>(`${BASE_API}/risk/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
}

export async function resetCircuitBreaker() {
  return fetchJson<{ success: boolean; circuitBreakerActive: boolean }>(`${BASE_API}/risk/reset-circuit-breaker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function fetchUpdatesHistory(): Promise<{ updates: SystemUpdate[] }> {
  return fetchJson<{ success: boolean; updates: SystemUpdate[] }>(`${BASE_API}/updates`);
}

export async function triggerCanaryRollout(version?: string, notes?: string) {
  return fetchJson<{ success: boolean; update: SystemUpdate }>(`${BASE_API}/updates/rollout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, notes })
  });
}

export async function fetchAuditLogs(): Promise<{ logs: AuditLog[] }> {
  return fetchJson<{ success: boolean; logs: AuditLog[] }>(`${BASE_API}/audit-logs`);
}
