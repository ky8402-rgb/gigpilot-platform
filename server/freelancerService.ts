import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

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
 * Uses process.env.FREELANCER_ACCESS_TOKEN / FREELANCER_AUTH_TOKEN / FREELANCER_SESSION and realistic User-Agent headers.
 */
export function getFreelancerRequestHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const oauthToken = (
    process.env.FREELANCER_ACCESS_TOKEN ||
    process.env.FREELANCER_AUTH_TOKEN ||
    process.env.FREELANCER_SESSION ||
    '3PKsiB3m736mE0wnirnHeLTUzLP1xc'
  ).trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'FreelanceAutoBidder/1.0 (+https://kundanvision369.onrender.com)',
    ...customHeaders,
  };

  if (!oauthToken || oauthToken === '') {
    console.warn(
      '[Freelancer Auth Warning] FREELANCER_ACCESS_TOKEN is missing or empty. ' +
      'Please obtain your official OAuth token from https://accounts.freelancer.com/settings/develop and set it in your Render environment variables.'
    );
  } else {
    // Attach official Freelancer OAuth and session cookie headers
    headers['freelancer-oauth-v1'] = oauthToken;
    headers['Authorization'] = `Bearer ${oauthToken}`;
    headers['Cookie'] = `freelancer_session=${oauthToken}; auth_token=${oauthToken}`;
  }

  return headers;
}

/**
 * Safe Axios wrapper for Freelancer.com requests.
 * Handles 401/403/session-expiration errors gracefully with console warnings
 * to ensure background processes never crash the Render web service.
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
        `Please generate an official token at https://accounts.freelancer.com/settings/develop. Render service will continue running.`
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
  const apiUrl = 'https://api.freelancer.com/api/projects/0.1/projects/';
  
  const result = await executeFreelancerRequest(apiUrl, {
    method: 'GET',
    params: {
      query,
      project_statuses: ['active'],
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
