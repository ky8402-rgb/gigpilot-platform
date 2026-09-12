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

/**
 * Constructs authenticated headers for Freelancer.com API and scraping requests.
 * Uses active session cookies from cookieConfigStore or process.env.
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
    // Attach official Freelancer OAuth and session cookie headers
    headers['freelancer-oauth-v1'] = oauthToken;
    headers['Authorization'] = `Bearer ${oauthToken}`;
    headers['Cookie'] = dynamicCookies || `freelancer_session=${oauthToken}; auth_token=${oauthToken}`;
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
  const apiUrl = 'https://api.freelancer.com/api/projects/0.1/projects/active/';
  
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
  // In Freelancer API 0.1, the authenticated user profile endpoint is /api/users/0.1/self (or /api/users/0.1/users/self)
  let testResult = await executeFreelancerRequest('https://api.freelancer.com/api/users/0.1/self', {
    method: 'GET',
  });

  if (!testResult.success && testResult.status === 404) {
    testResult = await executeFreelancerRequest('https://api.freelancer.com/api/users/0.1/users/self', {
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
    const res = await axios.get('https://api.freelancer.com/api/users/0.1/self', {
      headers: {
        'freelancer-oauth-v1': token,
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
