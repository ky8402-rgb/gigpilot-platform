import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import fs from 'fs';
import path from 'path';
import { getCookieConfig } from './leadNotifications.js';

/**
 * Realistic modern browser User-Agent string to mimic standard desktop browser sessions
 */
const REALISTIC_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface FreelancerProjectSummary {
  id: string | number;
  title: string;
  description: string;
  budget: {
    minimum?: number;
    maximum?: number;
    currency?: string;
  };
  timeSubmitted: string;
  url: string;
  ownerId?: string | number;
  status: string;
}

export function getFreelancerApiBase(): string {
  const raw = (
    process.env.FREELANCER_API_BASE_URL ||
    process.env.FREELANCER_API_BASE ||
    'https://www.freelancer.com/api'
  ).trim().replace(/\/+$/, '');
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}

/**
 * Constructs authenticated headers for Freelancer.com API requests using standard OAuth 2.0 Bearer tokens.
 * Legacy v0.1 custom headers (freelancer-oauth-v1) are completely deprecated and removed.
 */
export function getFreelancerRequestHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const dynamicCookies = getCookieConfig ? getCookieConfig().freelancerCookies : '';
  const tokenMatch = dynamicCookies ? dynamicCookies.match(/(?:freelancer_session|auth_token)=([^;\s]+)/i) : null;
  const cookieToken = tokenMatch?.[1];

  const oauthToken = (
    cookieToken ||
    process.env.FREELANCER_ACCESS_TOKEN ||
    process.env.FREELANCER_AUTH_TOKEN ||
    process.env.FREELANCER_SESSION ||
    '3PKsiB3m736mE0wnirnHeLTUzLP1xc'
  ).trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'FreelanceAutoBidder/1.0 (+https://3-222-149-9.sslip.io)',
    ...customHeaders,
  };

  if (!oauthToken || oauthToken === '') {
    console.warn(
      '[Freelancer Auth Warning] FREELANCER_ACCESS_TOKEN is missing or empty. ' +
      'Please obtain your official OAuth token from https://accounts.freelancer.com/settings/develop and set it in your environment variables.'
    );
  } else {
    // Standard OAuth 2.0 Bearer Authorization header
    headers['Authorization'] = `Bearer ${oauthToken}`;
    if (dynamicCookies) {
      headers['Cookie'] = dynamicCookies;
    }
  }

  return headers;
}

/**
 * Safe Axios wrapper for Freelancer.com requests.
 * Handles 401/403/session-expiration errors gracefully with console warnings
 * to ensure background processes never crash the web service.
 */
export async function executeFreelancerRequest<T = any>(
  url: string,
  options: AxiosRequestConfig = {}
): Promise<{ success: boolean; data?: T; status?: number; error?: string }> {
  const requestHeaders = getFreelancerRequestHeaders(options.headers as Record<string, string>);

  try {
    const response: AxiosResponse<T> = await axios({
      url,
      timeout: options.timeout || 12000,
      ...options,
      headers: requestHeaders,
    });

    return {
      success: true,
      data: response.data,
      status: response.status,
    };
  } catch (error: any) {
    const status = error?.response?.status;
    const responseBody = error?.response?.data;

    if (status === 401 || status === 403) {
      console.warn(
        `[Freelancer Auth Warning] Authentication failed (HTTP ${status}) from ${url}. ` +
        `Your FREELANCER_ACCESS_TOKEN may be invalid or expired. ` +
        `Please generate an official token at https://accounts.freelancer.com/settings/develop. Service will continue running.`
      );
    } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.warn(`[Freelancer Network Notice] Request timed out while accessing ${url}.`);
    } else {
      console.warn(`[Freelancer Request Notice] Request to ${url} failed: ${error.message}`);
    }

    return {
      success: false,
      status,
      error: error.message || 'Unknown network error',
      data: responseBody,
    };
  }
}

/**
 * Fetch live active projects from Freelancer.com with authenticated headers
 */
export async function fetchFreelancerLiveProjects(
  query: string = 'react',
  limit: number = 10
): Promise<FreelancerProjectSummary[]> {
  const apiUrl = `${getFreelancerApiBase()}/projects/0.1/projects/active/`;
  
  const result = await executeFreelancerRequest(apiUrl, {
    method: 'GET',
    params: {
      query,
      limit,
      sort_field: 'time_updated',
      reverse_sort: 'true',
      compact: 'true',
    },
  });

  if (result.success && result.data?.result?.projects) {
    const projects = result.data.result.projects;
    return projects.map((p: any) => ({
      id: p.id,
      title: p.title || 'Freelancer Project',
      description: p.preview_description || p.description || '',
      budget: {
        minimum: p.budget?.minimum,
        maximum: p.budget?.maximum,
        currency: p.currency?.code || 'USD',
      },
      timeSubmitted: p.time_submitted ? new Date(p.time_submitted * 1000).toISOString() : new Date().toISOString(),
      url: `https://www.freelancer.com/projects/${p.seo_url || p.id}`,
      ownerId: p.owner_id,
      status: p.status || 'active',
    }));
  }

  return [];
}

/**
 * Verify if the configured Freelancer OAuth Access Token is valid
 */
export async function verifyFreelancerAuthStatus(): Promise<{
  configured: boolean;
  tokenPresent: boolean;
  username?: string;
  status: 'valid' | 'missing' | 'expired' | 'unverified';
  message: string;
}> {
  const tokenString = (
    process.env.FREELANCER_ACCESS_TOKEN ||
    process.env.FREELANCER_AUTH_TOKEN ||
    process.env.FREELANCER_SESSION ||
    '3PKsiB3m736mE0wnirnHeLTUzLP1xc'
  ).trim();
  const tokenPresent = Boolean(tokenString && tokenString.length > 0);

  if (!tokenPresent) {
    return {
      configured: false,
      tokenPresent: false,
      status: 'missing',
      message: 'FREELANCER_ACCESS_TOKEN is not configured in environment variables. Obtain your token at https://accounts.freelancer.com/settings/develop',
    };
  }

  // Attempt official test call to verify authentication: /api/users/0.1/self
  let testResult = await executeFreelancerRequest(`${getFreelancerApiBase()}/users/0.1/self`, {
    method: 'GET',
  });

  if (!testResult.success && testResult.status === 404) {
    testResult = await executeFreelancerRequest(`${getFreelancerApiBase()}/users/0.1/users/self`, {
      method: 'GET',
    });
  }

  if (testResult.success) {
    const username = testResult.data?.result?.username || testResult.data?.result?.public_name;
    return {
      configured: true,
      tokenPresent: true,
      username,
      status: 'valid',
      message: `Freelancer API token verified successfully (${username || 'Authenticated User'}).`,
    };
  }

  if (testResult.status === 401 || testResult.status === 403) {
    return {
      configured: true,
      tokenPresent: true,
      status: 'expired',
      message: 'Freelancer authentication failed (HTTP 401/403). Access token may have expired or is invalid.',
    };
  }

  return {
    configured: true,
    tokenPresent: true,
    status: 'unverified',
    message: testResult.error || 'Could not verify Freelancer API token status.',
  };
}

/**
 * Masks a token for safe display in UI (e.g. 3PKs••••••••••••••••••••LP1xc)
 */
export function maskFreelancerToken(token: string): string {
  if (!token) return '';
  const trimmed = token.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  const middle = '•'.repeat(Math.min(20, Math.max(6, trimmed.length - 8)));
  return `${prefix}${middle}${suffix}`;
}

/**
 * Online verification of a candidate token against Freelancer REST API v0.1 (/api/users/0.1/self)
 */
export async function testFreelancerToken(candidateToken: string): Promise<{
  valid: boolean;
  status: 'valid' | 'expired' | 'unverified' | 'missing';
  username?: string;
  userId?: number | string;
  email?: string;
  latencyMs: number;
  message: string;
}> {
  const token = (candidateToken || '').trim();
  if (!token) {
    return {
      valid: false,
      status: 'missing',
      latencyMs: 0,
      message: 'No Freelancer API token provided.',
    };
  }

  const startTime = Date.now();
  try {
    const res = await axios.get(`${getFreelancerApiBase()}/users/0.1/self`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': 'FreelanceAutoBidder/1.0 (+https://3-222-149-9.sslip.io)',
      },
      timeout: 9000,
    });
    const latencyMs = Date.now() - startTime;

    if (res.data?.status === 'success' && res.data?.result) {
      const user = res.data.result;
      const username = user.username || user.public_name || `User_${user.id}`;
      return {
        valid: true,
        status: 'valid',
        username,
        userId: user.id,
        email: user.email || undefined,
        latencyMs,
        message: `Token verified successfully for @${username} (Latency: ${latencyMs}ms).`,
      };
    }

    return {
      valid: false,
      status: 'unverified',
      latencyMs,
      message: res.data?.message || 'Freelancer API returned non-success response status.',
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const httpStatus = err?.response?.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        valid: false,
        status: 'expired',
        latencyMs,
        message: `Authentication failed (HTTP ${httpStatus}). Token is invalid, revoked, or expired.`,
      };
    }
    return {
      valid: false,
      status: 'unverified',
      latencyMs,
      message: err?.response?.data?.message || err.message || 'Network error verifying token with Freelancer API.',
    };
  }
}

/**
 * Gets details of the currently active Freelancer token
 */
export async function getFreelancerTokenDetails(): Promise<{
  configured: boolean;
  tokenPresent: boolean;
  maskedToken: string;
  username?: string;
  userId?: number | string;
  status: 'valid' | 'expired' | 'unverified' | 'missing';
  message: string;
  isCustomToken: boolean;
  developerPortalUrl: string;
}> {
  const currentToken = (
    process.env.FREELANCER_ACCESS_TOKEN ||
    process.env.FREELANCER_AUTH_TOKEN ||
    process.env.FREELANCER_SESSION ||
    '3PKsiB3m736mE0wnirnHeLTUzLP1xc'
  ).trim();

  const isCustomToken = Boolean(
    process.env.FREELANCER_ACCESS_TOKEN &&
    process.env.FREELANCER_ACCESS_TOKEN.trim() !== '3PKsiB3m736mE0wnirnHeLTUzLP1xc'
  );

  const verification = await testFreelancerToken(currentToken);

  return {
    configured: Boolean(currentToken),
    tokenPresent: Boolean(currentToken),
    maskedToken: maskFreelancerToken(currentToken),
    username: verification.username || 'kundank879',
    userId: verification.userId || 94426143,
    status: verification.status,
    message: verification.message,
    isCustomToken,
    developerPortalUrl: 'https://accounts.freelancer.com/settings/develop',
  };
}

/**
 * Save and apply a new Freelancer API token across server runtime and persistent files
 */
export async function saveFreelancerApiToken(rawToken: string): Promise<{
  success: boolean;
  message: string;
  username?: string;
  userId?: number | string;
  authStatus: {
    configured: boolean;
    tokenPresent: boolean;
    maskedToken: string;
    username?: string;
    userId?: number | string;
    status: string;
    message: string;
  };
}> {
  const token = (rawToken || '').trim();
  if (!token) {
    return {
      success: false,
      message: 'Freelancer API token cannot be empty.',
      authStatus: {
        configured: false,
        tokenPresent: false,
        maskedToken: '',
        status: 'missing',
        message: 'No token provided.',
      },
    };
  }

  // 1. Verify online with Freelancer API
  const verification = await testFreelancerToken(token);

  // 2. Set runtime environment variables immediately
  process.env.FREELANCER_ACCESS_TOKEN = token;
  process.env.FREELANCER_AUTH_TOKEN = token;
  process.env.FREELANCER_SESSION = token;

  // 3. Persist to local .env and .env.production if they exist
  try {
    for (const envFileName of ['.env', '.env.production']) {
      const fullEnvPath = path.join(process.cwd(), envFileName);
      if (fs.existsSync(fullEnvPath)) {
        let content = fs.readFileSync(fullEnvPath, 'utf-8');
        if (content.includes('FREELANCER_ACCESS_TOKEN=')) {
          content = content.replace(/FREELANCER_ACCESS_TOKEN=.*/g, `FREELANCER_ACCESS_TOKEN="${token}"`);
        } else {
          content += `\nFREELANCER_ACCESS_TOKEN="${token}"\n`;
        }
        if (content.includes('FREELANCER_AUTH_TOKEN=')) {
          content = content.replace(/FREELANCER_AUTH_TOKEN=.*/g, `FREELANCER_AUTH_TOKEN="${token}"`);
        }
        if (content.includes('FREELANCER_SESSION=')) {
          content = content.replace(/FREELANCER_SESSION=.*/g, `FREELANCER_SESSION="${token}"`);
        }
        fs.writeFileSync(fullEnvPath, content, 'utf-8');
      }
    }
  } catch (envErr: any) {
    console.warn('[Freelancer Token] Could not write to .env files:', envErr.message);
  }

  // 4. Persist to bidding_config.json for startup re-hydration
  try {
    const configPath = path.join(process.cwd(), 'bidding_config.json');
    let configData: any = {};
    if (fs.existsSync(configPath)) {
      try {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        configData = {};
      }
    }
    configData.freelancerAccessToken = token;
    configData.freelancerUsername = verification.username;
    configData.freelancerUserId = verification.userId;
    configData.freelancerTokenUpdated = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
  } catch (cfgErr: any) {
    console.warn('[Freelancer Token] Could not write to bidding_config.json:', cfgErr.message);
  }

  // 5. Update lead notifications session store
  try {
    const { updateCookieConfig } = await import('./leadNotifications.js');
    if (typeof updateCookieConfig === 'function') {
      updateCookieConfig({
        freelancerCookies: `freelancer_session=${token}; auth_token=${token}`,
        freelancerStatus: verification.valid ? 'active' : 'expired',
        lastValidatedAt: new Date().toISOString()
      });
    }
  } catch (leadErr: any) {
    console.warn('[Freelancer Token] Could not update lead notifications cookies:', leadErr.message);
  }

  console.log(`✅ [Freelancer Service] Successfully updated FREELANCER_ACCESS_TOKEN (Status: ${verification.status}, User: ${verification.username || 'unknown'})`);

  return {
    success: true,
    message: verification.valid
      ? `Freelancer API token successfully applied and verified for @${verification.username}!`
      : `Freelancer API token updated in system environment. Note: API validation returned: ${verification.message}`,
    username: verification.username,
    userId: verification.userId,
    authStatus: {
      configured: true,
      tokenPresent: true,
      maskedToken: maskFreelancerToken(token),
      username: verification.username,
      userId: verification.userId,
      status: verification.status,
      message: verification.message,
    },
  };
}

export interface FreelancerOAuth2Config {
  oauthVersion: '2.0';
  legacyV01Deprecated: boolean;
  configured: boolean;
  clientId: string;
  clientSecretConfigured: boolean;
  redirectUri: string;
  scopes: string;
  authorizationUrl: string;
  hasRefreshToken: boolean;
  maskedRefreshToken?: string;
  expiresAt?: string | null;
  authMode: 'personal_token' | 'oauth2_app';
  currentUsername?: string;
  tokenStatus?: string;
}

export interface FreelancerOAuth2ExchangeResult {
  success: boolean;
  message: string;
  username?: string;
  userId?: number | string;
  expiresIn?: number;
  tokenStatus?: string;
  error?: string;
}

/**
 * Loads current OAuth2 configuration from environment and bidding_config.json
 */
export function getFreelancerOAuth2Config(): FreelancerOAuth2Config {
  let storedConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), 'bidding_config.json');
    if (fs.existsSync(configPath)) {
      storedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {}

  const clientId = (
    process.env.FREELANCER_CLIENT_ID ||
    storedConfig.freelancerClientId ||
    ''
  ).trim();

  const clientSecret = (
    process.env.FREELANCER_CLIENT_SECRET ||
    storedConfig.freelancerClientSecret ||
    ''
  ).trim();

  const defaultRedirectUri = process.env.BASE_URL 
    ? `${process.env.BASE_URL.replace(/\/+$/, '')}/api/freelancer/oauth2/callback`
    : 'https://3-222-149-9.sslip.io/api/freelancer/oauth2/callback';

  const redirectUri = (
    process.env.FREELANCER_REDIRECT_URI ||
    storedConfig.freelancerRedirectUri ||
    defaultRedirectUri
  ).trim();

  const scopes = (
    process.env.FREELANCER_SCOPES ||
    storedConfig.freelancerScopes ||
    'basic profile projects'
  ).trim();

  const refreshToken = (
    process.env.FREELANCER_REFRESH_TOKEN ||
    storedConfig.freelancerRefreshToken ||
    ''
  ).trim();

  const expiresAt = storedConfig.freelancerTokenExpiresAt || null;
  const authMode = storedConfig.freelancerAuthMode || (clientId ? 'oauth2_app' : 'personal_token');
  const currentUsername = storedConfig.freelancerUsername || 'kundank879';

  // Construct official Freelancer authorization URL
  const authUrlParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    prompt: 'consent'
  });
  const authorizationUrl = `https://accounts.freelancer.com/oauth/authorize?${authUrlParams.toString()}`;

  return {
    oauthVersion: '2.0',
    legacyV01Deprecated: true,
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecretConfigured: Boolean(clientSecret),
    redirectUri,
    scopes,
    authorizationUrl,
    hasRefreshToken: Boolean(refreshToken),
    maskedRefreshToken: refreshToken ? maskFreelancerToken(refreshToken) : undefined,
    expiresAt,
    authMode,
    currentUsername,
    tokenStatus: storedConfig.freelancerAccessToken ? 'active' : 'missing'
  };
}

/**
 * Persist Freelancer OAuth2 App credentials
 */
export async function saveFreelancerOAuth2AppConfig(config: {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  authMode?: 'personal_token' | 'oauth2_app';
}): Promise<{ success: boolean; message: string; config: FreelancerOAuth2Config }> {
  const cleanClientId = (config.clientId || '').trim();
  const cleanClientSecret = (config.clientSecret || '').trim();
  const cleanRedirectUri = (config.redirectUri || '').trim();
  const cleanScopes = (config.scopes || 'basic profile projects').trim();

  // 1. Update runtime environment
  if (cleanClientId) process.env.FREELANCER_CLIENT_ID = cleanClientId;
  if (cleanClientSecret) process.env.FREELANCER_CLIENT_SECRET = cleanClientSecret;
  if (cleanRedirectUri) process.env.FREELANCER_REDIRECT_URI = cleanRedirectUri;
  if (cleanScopes) process.env.FREELANCER_SCOPES = cleanScopes;

  // 2. Persist to .env and .env.production
  try {
    for (const envFileName of ['.env', '.env.production']) {
      const fullEnvPath = path.join(process.cwd(), envFileName);
      if (fs.existsSync(fullEnvPath)) {
        let content = fs.readFileSync(fullEnvPath, 'utf-8');
        const updates: Record<string, string> = {};
        if (cleanClientId) updates.FREELANCER_CLIENT_ID = cleanClientId;
        if (cleanClientSecret) updates.FREELANCER_CLIENT_SECRET = cleanClientSecret;
        if (cleanRedirectUri) updates.FREELANCER_REDIRECT_URI = cleanRedirectUri;
        if (cleanScopes) updates.FREELANCER_SCOPES = cleanScopes;

        for (const [key, val] of Object.entries(updates)) {
          if (content.includes(`${key}=`)) {
            content = content.replace(new RegExp(`${key}=.*`, 'g'), `${key}="${val}"`);
          } else {
            content += `\n${key}="${val}"\n`;
          }
        }
        fs.writeFileSync(fullEnvPath, content, 'utf-8');
      }
    }
  } catch (err: any) {
    console.warn('[Freelancer OAuth2] Could not write to .env files:', err.message);
  }

  // 3. Persist to bidding_config.json
  try {
    const configPath = path.join(process.cwd(), 'bidding_config.json');
    let configData: any = {};
    if (fs.existsSync(configPath)) {
      try {
        configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {
        configData = {};
      }
    }
    if (cleanClientId) configData.freelancerClientId = cleanClientId;
    if (cleanClientSecret) configData.freelancerClientSecret = cleanClientSecret;
    if (cleanRedirectUri) configData.freelancerRedirectUri = cleanRedirectUri;
    if (cleanScopes) configData.freelancerScopes = cleanScopes;
    if (config.authMode) configData.freelancerAuthMode = config.authMode;
    configData.freelancerOAuthUpdated = new Date().toISOString();
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
  } catch (cfgErr: any) {
    console.warn('[Freelancer OAuth2] Could not update bidding_config.json:', cfgErr.message);
  }

  const updatedConfig = getFreelancerOAuth2Config();
  return {
    success: true,
    message: 'Freelancer OAuth2 app credentials configured and stored successfully.',
    config: updatedConfig
  };
}

/**
 * Exchange Freelancer OAuth2 Authorization Code for Access and Refresh Tokens
 */
export async function exchangeFreelancerOAuth2Code(
  code: string,
  redirectUriOverride?: string
): Promise<FreelancerOAuth2ExchangeResult> {
  const cleanCode = (code || '').trim();
  if (!cleanCode) {
    return {
      success: false,
      message: 'Authorization code is required for OAuth2 token exchange.'
    };
  }

  const oauthConfig = getFreelancerOAuth2Config();
  const clientId = oauthConfig.clientId;
  let storedConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), 'bidding_config.json');
    if (fs.existsSync(configPath)) {
      storedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {}

  const clientSecret = (
    process.env.FREELANCER_CLIENT_SECRET ||
    storedConfig.freelancerClientSecret ||
    ''
  ).trim();

  if (!clientId || !clientSecret) {
    return {
      success: false,
      message: 'Freelancer Client ID and Client Secret must be configured before exchanging OAuth2 codes.'
    };
  }

  const redirectUri = redirectUriOverride || oauthConfig.redirectUri;

  try {
    console.log(`[Freelancer OAuth2] Exchanging code with accounts.freelancer.com/oauth/token...`);
    
    // Freelancer OAuth2 Token Endpoint accepts URL-encoded form data
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: cleanCode,
      redirect_uri: redirectUri
    });

    const tokenRes = await axios.post('https://accounts.freelancer.com/oauth/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'FreelanceAutoBidder/1.0 (+https://3-222-149-9.sslip.io)'
      },
      timeout: 15000
    });

    const data = tokenRes.data;
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const expiresIn = data.expires_in || 3600;

    if (!accessToken) {
      return {
        success: false,
        message: data.error_description || data.error || 'No access token returned from Freelancer OAuth token endpoint.'
      };
    }

    // 1. Activate & persist access token
    const saveResult = await saveFreelancerApiToken(accessToken);

    // 2. Persist refresh token & expiry
    try {
      const configPath = path.join(process.cwd(), 'bidding_config.json');
      let configData: any = {};
      if (fs.existsSync(configPath)) {
        try {
          configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch {
          configData = {};
        }
      }
      if (refreshToken) {
        configData.freelancerRefreshToken = refreshToken;
        process.env.FREELANCER_REFRESH_TOKEN = refreshToken;
      }
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      configData.freelancerTokenExpiresAt = expiresAt;
      configData.freelancerAuthMode = 'oauth2_app';
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn('[Freelancer OAuth2] Failed to save refresh token to config:', e.message);
    }

    return {
      success: true,
      message: `OAuth2 token exchange successful! Verified user: @${saveResult.username || 'unknown'} (expires in ${expiresIn}s).`,
      username: saveResult.username,
      userId: saveResult.userId,
      expiresIn,
      tokenStatus: saveResult.authStatus.status
    };
  } catch (err: any) {
    const errorDetails = err.response?.data?.error_description || err.response?.data?.message || err.message;
    console.error('[Freelancer OAuth2] Code exchange error:', errorDetails);
    return {
      success: false,
      message: `Token exchange failed: ${errorDetails}`,
      error: errorDetails
    };
  }
}

/**
 * Refresh Freelancer OAuth2 Access Token using stored Refresh Token
 */
export async function refreshFreelancerOAuth2Token(): Promise<FreelancerOAuth2ExchangeResult> {
  const oauthConfig = getFreelancerOAuth2Config();
  let storedConfig: any = {};
  try {
    const configPath = path.join(process.cwd(), 'bidding_config.json');
    if (fs.existsSync(configPath)) {
      storedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {}

  const clientId = oauthConfig.clientId;
  const clientSecret = (
    process.env.FREELANCER_CLIENT_SECRET ||
    storedConfig.freelancerClientSecret ||
    ''
  ).trim();
  const refreshToken = (
    process.env.FREELANCER_REFRESH_TOKEN ||
    storedConfig.freelancerRefreshToken ||
    ''
  ).trim();

  if (!clientId || !clientSecret) {
    return {
      success: false,
      message: 'Freelancer Client ID and Client Secret must be configured to refresh tokens.'
    };
  }

  if (!refreshToken) {
    return {
      success: false,
      message: 'No Freelancer refresh token available. Complete initial OAuth2 authorization first.'
    };
  }

  try {
    console.log(`[Freelancer OAuth2] Refreshing token at accounts.freelancer.com/oauth/token...`);
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    });

    const tokenRes = await axios.post('https://accounts.freelancer.com/oauth/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'FreelanceAutoBidder/1.0 (+https://3-222-149-9.sslip.io)'
      },
      timeout: 15000
    });

    const data = tokenRes.data;
    const accessToken = data.access_token;
    const newRefreshToken = data.refresh_token || refreshToken;
    const expiresIn = data.expires_in || 3600;

    if (!accessToken) {
      return {
        success: false,
        message: data.error_description || data.error || 'Failed to obtain access token from refresh.'
      };
    }

    // Save newly refreshed access token
    const saveResult = await saveFreelancerApiToken(accessToken);

    // Save updated refresh token & expiry
    try {
      const configPath = path.join(process.cwd(), 'bidding_config.json');
      let configData: any = {};
      if (fs.existsSync(configPath)) {
        try {
          configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch {
          configData = {};
        }
      }
      configData.freelancerRefreshToken = newRefreshToken;
      process.env.FREELANCER_REFRESH_TOKEN = newRefreshToken;
      configData.freelancerTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn('[Freelancer OAuth2] Could not update config with refreshed token:', e.message);
    }

    return {
      success: true,
      message: `OAuth2 token refreshed successfully for @${saveResult.username || 'unknown'}!`,
      username: saveResult.username,
      userId: saveResult.userId,
      expiresIn,
      tokenStatus: saveResult.authStatus.status
    };
  } catch (err: any) {
    const errorDetails = err.response?.data?.error_description || err.response?.data?.message || err.message;
    console.error('[Freelancer OAuth2] Token refresh error:', errorDetails);
    return {
      success: false,
      message: `Token refresh failed: ${errorDetails}`,
      error: errorDetails
    };
  }
}

