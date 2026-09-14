import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';

/**
 * Interface representing persisted Freelancer OAuth 2.0 token credentials
 */
export interface FreelancerOAuthTokenData {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  expiresAt?: number; // Epoch milliseconds
  scope?: string;
  username?: string;
  userId?: string | number;
  tokenStatus?: string;
  updatedAt: number;
}

export interface GenerateAuthUrlOptions {
  clientId?: string;
  redirectUri?: string;
  scopes?: string | string[];
  prompt?: 'consent' | 'select_account';
  statePayload?: Record<string, any>;
}

export interface CSRFStateValidationResult {
  valid: boolean;
  error?: string;
  payload?: Record<string, any>;
}

export interface StoredOAuthState {
  state: string;
  createdAt: number;
  expiresAt: number;
  payload?: Record<string, any>;
}

interface QueuedRequest {
  resolve: (value?: any) => void;
  reject: (reason?: any) => void;
  config: InternalAxiosRequestConfig;
}

/**
 * Storage Keys
 */
const STORAGE_KEYS = {
  TOKENS: 'gigpilot_freelancer_oauth_tokens',
  LEGACY_ACCESS_TOKEN: 'freelancer_access_token',
  LEGACY_REFRESH_TOKEN: 'freelancer_refresh_token',
  LEGACY_EXPIRES_AT: 'freelancer_token_expires_at',
  CSRF_STATE: 'gigpilot_freelancer_oauth_state',
  CSRF_STATE_DATA: 'gigpilot_freelancer_oauth_state_data',
};

const DEFAULT_AUTH_URL = 'https://accounts.freelancer.com/oauth/authorise';
const DEFAULT_API_BASE_URL = 'https://api.freelancer.com';
const CSRF_STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Resolves the active backend API URL (handles same-origin, AWS Amplify static hosts, and EC2)
 */
function resolveBackendBaseUrl(): string {
  // Check localStorage custom override
  if (typeof localStorage !== 'undefined') {
    try {
      const customUrl = localStorage.getItem('gigpilot_custom_backend_url');
      if (customUrl && customUrl.trim().length > 0) {
        return customUrl.trim().replace(/\/+$/, '');
      }
    } catch (_) {}
  }

  // Check build-time or runtime environment variables
  const envUrl =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BACKEND_URL) ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.REACT_APP_API_URL) ||
    (typeof process !== 'undefined' && (process.env?.REACT_APP_API_URL || process.env?.API_BASE_URL || process.env?.VITE_BACKEND_URL));

  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // If running in browser on a detached host (e.g. Amplify)
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (
      host.includes('amplifyapp.com') ||
      host.includes('cloudfront.net') ||
      host.includes('vercel.app') ||
      host.includes('github.io')
    ) {
      return 'https://3-222-149-9.sslip.io';
    }
  }

  return '';
}

/**
 * FreelancerOAuthService
 * 
 * Provides end-to-end management of Freelancer OAuth 2.0 Authorization Code flow:
 * - Cryptographically secure CSRF state generation and validation
 * - Dynamic Authorization URL builder
 * - Authorization code exchange for Access & Refresh tokens
 * - Automated silent token refresh with request deduplication (mutex)
 * - Axios interceptor for automatic Bearer header injection and 401 retry loops
 */
export class FreelancerOAuthService {
  private inMemoryTokens: FreelancerOAuthTokenData | null = null;
  private inMemoryStateStore: Map<string, StoredOAuthState> = new Map();
  private isRefreshing = false;
  private refreshPromise: Promise<FreelancerOAuthTokenData> | null = null;
  private failedQueue: QueuedRequest[] = [];
  private listeners: Array<(tokens: FreelancerOAuthTokenData | null) => void> = [];

  constructor() {
    this.inMemoryTokens = this.loadTokensFromStorage();
  }

  // ============================================================================
  // TOKEN STORAGE & ACCESSORS
  // ============================================================================

  /**
   * Load tokens from storage with fallback to legacy keys
   */
  public loadTokensFromStorage(): FreelancerOAuthTokenData | null {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return null;
    }

    try {
      // Primary structured token record
      const raw = localStorage.getItem(STORAGE_KEYS.TOKENS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.accessToken) {
          return parsed as FreelancerOAuthTokenData;
        }
      }

      // Legacy fallback keys
      const legacyAccess = localStorage.getItem(STORAGE_KEYS.LEGACY_ACCESS_TOKEN);
      if (legacyAccess) {
        const legacyRefresh = localStorage.getItem(STORAGE_KEYS.LEGACY_REFRESH_TOKEN) || undefined;
        const legacyExpiry = localStorage.getItem(STORAGE_KEYS.LEGACY_EXPIRES_AT);
        const expiresAt = legacyExpiry ? new Date(legacyExpiry).getTime() : undefined;

        const fallbackData: FreelancerOAuthTokenData = {
          accessToken: legacyAccess,
          refreshToken: legacyRefresh,
          tokenType: 'Bearer',
          expiresAt,
          updatedAt: Date.now(),
        };
        return fallbackData;
      }
    } catch (err) {
      console.warn('[FreelancerOAuthService] Failed to load tokens from storage:', err);
    }

    return null;
  }

  /**
   * Persists tokens to in-memory cache and localStorage
   */
  public saveTokens(data: Partial<FreelancerOAuthTokenData>): FreelancerOAuthTokenData {
    const existing = this.inMemoryTokens || this.loadTokensFromStorage();

    const expiresAt = data.expiresAt || (
      data.expiresIn ? Date.now() + data.expiresIn * 1000 : existing?.expiresAt
    );

    const merged: FreelancerOAuthTokenData = {
      accessToken: data.accessToken || existing?.accessToken || '',
      refreshToken: data.refreshToken !== undefined ? data.refreshToken : existing?.refreshToken,
      tokenType: data.tokenType || existing?.tokenType || 'Bearer',
      expiresIn: data.expiresIn !== undefined ? data.expiresIn : existing?.expiresIn,
      expiresAt,
      scope: data.scope || existing?.scope,
      username: data.username || existing?.username,
      userId: data.userId || existing?.userId,
      tokenStatus: data.tokenStatus || existing?.tokenStatus,
      updatedAt: Date.now(),
    };

    this.inMemoryTokens = merged;

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.TOKENS, JSON.stringify(merged));
        // Maintain backwards compatibility
        if (merged.accessToken) {
          localStorage.setItem(STORAGE_KEYS.LEGACY_ACCESS_TOKEN, merged.accessToken);
        }
        if (merged.refreshToken) {
          localStorage.setItem(STORAGE_KEYS.LEGACY_REFRESH_TOKEN, merged.refreshToken);
        }
        if (merged.expiresAt) {
          localStorage.setItem(STORAGE_KEYS.LEGACY_EXPIRES_AT, new Date(merged.expiresAt).toISOString());
        }
      } catch (err) {
        console.warn('[FreelancerOAuthService] Failed to write tokens to localStorage:', err);
      }
    }

    this.notifyListeners(merged);
    return merged;
  }

  /**
   * Clears stored tokens
   */
  public clearTokens(): void {
    this.inMemoryTokens = null;

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEYS.TOKENS);
        localStorage.removeItem(STORAGE_KEYS.LEGACY_ACCESS_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.LEGACY_REFRESH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.LEGACY_EXPIRES_AT);
      } catch (_) {}
    }

    this.notifyListeners(null);
  }

  public getTokens(): FreelancerOAuthTokenData | null {
    if (!this.inMemoryTokens) {
      this.inMemoryTokens = this.loadTokensFromStorage();
    }
    return this.inMemoryTokens;
  }

  public getAccessToken(): string | null {
    const tokens = this.getTokens();
    return tokens?.accessToken || null;
  }

  public getRefreshToken(): string | null {
    const tokens = this.getTokens();
    return tokens?.refreshToken || null;
  }

  /**
   * Checks whether the current access token has expired or is about to expire within bufferSeconds
   */
  public isTokenExpired(bufferSeconds = 60): boolean {
    const tokens = this.getTokens();
    if (!tokens || !tokens.accessToken) {
      return true;
    }
    if (!tokens.expiresAt) {
      // If no explicit expiration is known, assume valid
      return false;
    }
    const bufferMs = bufferSeconds * 1000;
    return Date.now() + bufferMs >= tokens.expiresAt;
  }

  public isAuthenticated(): boolean {
    const tokens = this.getTokens();
    return Boolean(tokens?.accessToken && tokens.accessToken.trim().length > 0);
  }

  // ============================================================================
  // CSRF STATE PROTECTION
  // ============================================================================

  /**
   * Generates a cryptographically secure random state with a timestamp and optional payload
   */
  public generateState(payload?: Record<string, any>): string {
    let randomHex = '';

    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const array = new Uint8Array(24);
      window.crypto.getRandomValues(array);
      randomHex = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    } else {
      randomHex = Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    const stateData: StoredOAuthState = {
      state: randomHex,
      createdAt: Date.now(),
      expiresAt: Date.now() + CSRF_STATE_TTL_MS,
      payload,
    };

    // Store in memory map for resilient SSR/Node/testing access
    this.inMemoryStateStore.set(randomHex, stateData);

    // Store in sessionStorage (preferred for session-scoped OAuth) with localStorage fallback
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(STORAGE_KEYS.CSRF_STATE, randomHex);
        sessionStorage.setItem(STORAGE_KEYS.CSRF_STATE_DATA, JSON.stringify(stateData));
      } catch (_) {}
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEYS.CSRF_STATE, randomHex);
        localStorage.setItem(STORAGE_KEYS.CSRF_STATE_DATA, JSON.stringify(stateData));
      } catch (_) {}
    }

    return randomHex;
  }

  /**
   * Validates and consumes the CSRF state parameter returned from the OAuth redirect
   */
  public validateAndConsumeState(receivedState: string): CSRFStateValidationResult {
    if (!receivedState || typeof receivedState !== 'string') {
      return { valid: false, error: 'Missing state parameter from OAuth callback.' };
    }

    let storedState: string | null = null;
    let storedDataRaw: string | null = null;
    let inMemStateData: StoredOAuthState | undefined;

    // Check memory store first
    if (this.inMemoryStateStore.has(receivedState)) {
      inMemStateData = this.inMemoryStateStore.get(receivedState);
      this.inMemoryStateStore.delete(receivedState);
      storedState = inMemStateData?.state || null;
    }

    if (typeof sessionStorage !== 'undefined') {
      const sessState = sessionStorage.getItem(STORAGE_KEYS.CSRF_STATE);
      if (sessState) {
        storedState = storedState || sessState;
        storedDataRaw = sessionStorage.getItem(STORAGE_KEYS.CSRF_STATE_DATA);
        sessionStorage.removeItem(STORAGE_KEYS.CSRF_STATE);
        sessionStorage.removeItem(STORAGE_KEYS.CSRF_STATE_DATA);
      }
    }

    if (!storedState && typeof localStorage !== 'undefined') {
      const localState = localStorage.getItem(STORAGE_KEYS.CSRF_STATE);
      if (localState) {
        storedState = localState;
        storedDataRaw = localStorage.getItem(STORAGE_KEYS.CSRF_STATE_DATA);
        localStorage.removeItem(STORAGE_KEYS.CSRF_STATE);
        localStorage.removeItem(STORAGE_KEYS.CSRF_STATE_DATA);
      }
    }

    if (!storedState) {
      return {
        valid: false,
        error: 'No matching CSRF state found in session. Authorization flow may have timed out.',
      };
    }

    if (storedState !== receivedState) {
      return {
        valid: false,
        error: 'CSRF State mismatch. Potential cross-site request forgery attack detected.',
      };
    }

    let payload: Record<string, any> | undefined = inMemStateData?.payload;
    if (inMemStateData) {
      if (inMemStateData.expiresAt && Date.now() > inMemStateData.expiresAt) {
        return {
          valid: false,
          error: 'OAuth state has expired (exceeded 15-minute TTL). Please re-initiate login.',
        };
      }
    } else if (storedDataRaw) {
      try {
        const parsed: StoredOAuthState = JSON.parse(storedDataRaw);
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
          return {
            valid: false,
            error: 'OAuth state has expired (exceeded 15-minute TTL). Please re-initiate login.',
          };
        }
        payload = parsed.payload;
      } catch (_) {}
    }

    return { valid: true, payload };
  }

  // ============================================================================
  // AUTHORIZATION URL BUILDER
  // ============================================================================

  /**
   * Generates the Freelancer.com OAuth 2.0 Authorization URL with CSRF protection
   */
  public async generateAuthorizationUrl(options: GenerateAuthUrlOptions = {}): Promise<string> {
    const backendBase = resolveBackendBaseUrl();

    // 1. Resolve configuration from backend if clientId is not supplied
    let clientId = options.clientId;
    let redirectUri = options.redirectUri;
    let scopes = options.scopes;

    if (!clientId) {
      try {
        const configRes = await axios.get(`${backendBase}/api/freelancer/oauth2/config`, {
          timeout: 5000,
        });
        if (configRes.data?.success && configRes.data.config) {
          clientId = clientId || configRes.data.config.clientId;
          redirectUri = redirectUri || configRes.data.config.redirectUri;
          scopes = scopes || configRes.data.config.scopes;
        }
      } catch (err) {
        console.warn('[FreelancerOAuthService] Could not fetch server OAuth2 config, using fallbacks:', err);
      }
    }

    // Client ID fallback
    clientId = clientId || '';

    // Redirect URI fallback
    if (!redirectUri && typeof window !== 'undefined') {
      redirectUri = `${window.location.origin}/api/freelancer/oauth2/callback`;
    } else if (!redirectUri) {
      redirectUri = 'https://3-222-149-9.sslip.io/api/freelancer/oauth2/callback';
    }

    // Scopes fallback
    const scopeStr = Array.isArray(scopes)
      ? scopes.join(' ')
      : scopes || 'basic profile projects';

    // 2. Generate and store CSRF state
    const state = this.generateState(options.statePayload);

    // 3. Assemble the OAuth 2.0 Authorize URL
    const url = new URL(DEFAULT_AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopeStr);
    url.searchParams.set('state', state);

    if (options.prompt) {
      url.searchParams.set('prompt', options.prompt);
    }

    return url.toString();
  }

  // ============================================================================
  // AUTHORIZATION CODE EXCHANGE
  // ============================================================================

  /**
   * Exchanges authorization code for Access & Refresh tokens via backend proxy
   */
  public async exchangeCodeForTokens(
    code: string,
    state?: string,
    redirectUri?: string
  ): Promise<FreelancerOAuthTokenData> {
    const cleanCode = (code || '').trim();
    if (!cleanCode) {
      throw new Error('Authorization code is required for OAuth token exchange.');
    }

    // Validate CSRF state if provided
    if (state) {
      const stateResult = this.validateAndConsumeState(state);
      if (!stateResult.valid) {
        throw new Error(`OAuth Security Validation Failed: ${stateResult.error}`);
      }
    }

    const backendBase = resolveBackendBaseUrl();
    const endpoint = `${backendBase}/api/freelancer/oauth2/callback`;

    try {
      const res = await axios.post(
        endpoint,
        { code: cleanCode, redirectUri },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000,
        }
      );

      const data = res.data;
      if (!data.success && !data.access_token) {
        throw new Error(data.message || data.error || 'Token exchange failed');
      }

      // Format token response
      const tokenPayload: Partial<FreelancerOAuthTokenData> = {
        accessToken: data.access_token || data.accessToken || '',
        refreshToken: data.refresh_token || data.refreshToken,
        tokenType: data.token_type || 'Bearer',
        expiresIn: data.expires_in || data.expiresIn || 3600,
        username: data.username,
        userId: data.userId || data.user_id,
        tokenStatus: data.tokenStatus || 'active',
      };

      return this.saveTokens(tokenPayload);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      console.error('[FreelancerOAuthService] Exchange code failed:', msg);
      throw new Error(`Token exchange failed: ${msg}`);
    }
  }

  // ============================================================================
  // AUTOMATED TOKEN REFRESH CYCLE (MUTEX & REQUEST DEDUPLICATION)
  // ============================================================================

  /**
   * Performs an automated silent token refresh.
   * If multiple concurrent requests trigger a refresh, they all share a single Promise.
   */
  public async refreshToken(): Promise<FreelancerOAuthTokenData> {
    // If a refresh is already in flight, return the active promise
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    const currentRefreshToken = this.getRefreshToken();
    const currentAccessToken = this.getAccessToken();

    // If neither token is present, we cannot authenticate
    if (!currentRefreshToken && !currentAccessToken) {
      this.clearTokens();
      throw new Error('No Freelancer access token or refresh token configured. User must authenticate.');
    }

    this.isRefreshing = true;

    this.refreshPromise = (async () => {
      const backendBase = resolveBackendBaseUrl();
      const endpoint = `${backendBase}/api/freelancer/oauth2/refresh`;

      try {
        console.log('[FreelancerOAuthService] Executing token refresh/verification...');
        const res = await axios.post(
          endpoint,
          { refreshToken: currentRefreshToken || undefined },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
          }
        );

        const data = res.data;
        if (!data.success && !data.access_token) {
          throw new Error(data.message || data.error || 'Failed to refresh or verify token.');
        }

        const newTokens: Partial<FreelancerOAuthTokenData> = {
          accessToken: data.access_token || data.accessToken || currentAccessToken || '',
          refreshToken: data.refresh_token || data.refreshToken || currentRefreshToken,
          tokenType: data.token_type || 'Bearer',
          expiresIn: data.expires_in || data.expiresIn || 315360000,
          username: data.username || this.inMemoryTokens?.username,
          userId: data.userId || data.user_id || this.inMemoryTokens?.userId,
          tokenStatus: data.tokenStatus || 'active',
        };

        const saved = this.saveTokens(newTokens);
        console.log('[FreelancerOAuthService] Token verified/refreshed successfully.');

        // Flush queued requests
        this.processFailedQueue(null, saved.accessToken);
        return saved;
      } catch (err: any) {
        // If we have an active personal access token, avoid destructive deletion
        if (!currentRefreshToken && currentAccessToken) {
          console.warn('[FreelancerOAuthService] Personal token verification note:', err.message);
          const current = this.inMemoryTokens || this.loadTokensFromStorage();
          if (current) {
            this.processFailedQueue(null, current.accessToken);
            return current;
          }
        }

        const errorMsg = err.response?.data?.message || err.message;
        console.error('[FreelancerOAuthService] Token refresh failed:', errorMsg);

        // Reject queued requests
        this.processFailedQueue(err, null);
        if (!currentAccessToken) {
          this.clearTokens();
        }
        throw err;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private processFailedQueue(error: any, token: string | null = null): void {
    this.failedQueue.forEach(prom => {
      if (error) {
        prom.reject(error);
      } else {
        if (token && prom.config.headers) {
          prom.config.headers.set('Authorization', `Bearer ${token}`);
        }
        prom.resolve(axios(prom.config));
      }
    });

    this.failedQueue = [];
  }

  // ============================================================================
  // AXIOS INTERCEPTOR FACTORY
  // ============================================================================

  /**
   * Attaches OAuth 2.0 request and response interceptors to an existing Axios instance
   */
  public attachOAuthInterceptors(instance: AxiosInstance): AxiosInstance {
    // 1. Request Interceptor: Attach Bearer & Pre-flight token freshness check
    instance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // Only run refresh check if user is authenticated and token has a known expiry
        if (this.isAuthenticated()) {
          // Pre-flight check: If token expires within 45 seconds, refresh prior to sending request
          if (this.isTokenExpired(45) && this.getRefreshToken()) {
            try {
              await this.refreshToken();
            } catch (refreshErr) {
              console.warn('[FreelancerOAuthService] Pre-flight refresh failed, attempting with current token:', refreshErr);
            }
          }

          const token = this.getAccessToken();
          if (token && config.headers) {
            config.headers.set('Authorization', `Bearer ${token}`);
          }
        }

        return config;
      },
      (error: AxiosError) => Promise.reject(error)
    );

    // 2. Response Interceptor: Intercept 401 Unauthorized & Trigger Silent Refresh Cycle
    instance.interceptors.response.use(
      (response: AxiosResponse) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean });

        if (!originalRequest) {
          return Promise.reject(error);
        }

        const status = error.response?.status;

        // Check if 401 and hasn't been retried yet
        if (status === 401 && !originalRequest._retry) {
          const refreshToken = this.getRefreshToken();

          // If no refresh token is stored, log and fail the request without destroying personal credentials
          if (!refreshToken) {
            console.warn('[FreelancerOAuthService] 401 received and no refresh token present.');
            return Promise.reject(error);
          }

          originalRequest._retry = true;

          // If refresh is already in progress, queue this request
          if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
              this.failedQueue.push({ resolve, reject, config: originalRequest });
            });
          }

          try {
            const refreshed = await this.refreshToken();
            if (refreshed.accessToken && originalRequest.headers) {
              originalRequest.headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
            }
            return instance(originalRequest);
          } catch (refreshErr) {
            return Promise.reject(refreshErr);
          }
        }

        return Promise.reject(error);
      }
    );

    return instance;
  }

  /**
   * Creates a dedicated Axios instance pre-configured with Freelancer OAuth interceptors
   */
  public createOAuthAxios(customConfig: AxiosRequestConfig = {}): AxiosInstance {
    const instance = axios.create({
      baseURL: customConfig.baseURL || DEFAULT_API_BASE_URL,
      timeout: customConfig.timeout || 20000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'FreelanceAutoBidder/1.0 (+https://3-222-149-9.sslip.io)',
        ...customConfig.headers,
      },
      ...customConfig,
    });

    return this.attachOAuthInterceptors(instance);
  }

  // ============================================================================
  // AUTH STATE SUBSCRIPTIONS
  // ============================================================================

  public subscribe(listener: (tokens: FreelancerOAuthTokenData | null) => void): () => void {
    this.listeners.push(listener);
    // Immediately emit current state
    listener(this.getTokens());

    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(tokens: FreelancerOAuthTokenData | null): void {
    this.listeners.forEach(fn => {
      try {
        fn(tokens);
      } catch (err) {
        console.warn('[FreelancerOAuthService] Listener threw error:', err);
      }
    });
  }
}

// Export singleton instance
export const freelancerOAuthService = new FreelancerOAuthService();

// Export pre-configured axios client
export const freelancerOAuthAxios = freelancerOAuthService.createOAuthAxios();

export default freelancerOAuthService;
