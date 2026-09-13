import axios, { AxiosInstance, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { freelancerOAuthService } from './freelancer-oauth.service';

/**
 * Official Freelancer API client configured for standard OAuth 2.0 REST endpoints
 * Using official OAuth 2.0 Bearer Access Token from https://accounts.freelancer.com/settings/develop
 */
const getInitialBaseUrl = (): string => {
  if (typeof process !== 'undefined' && (process.env?.FREELANCER_API_BASE_URL || process.env?.FREELANCER_API_BASE)) {
    return (process.env.FREELANCER_API_BASE_URL || process.env.FREELANCER_API_BASE)!.trim().replace(/\/+$/, '');
  }
  return 'https://www.freelancer.com/api';
};

export const freelancerNetwork: AxiosInstance = axios.create({
  baseURL: getInitialBaseUrl(),
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'FreelanceAutoBidder/1.0 (+https://3-222-149-9.sslip.io)',
  },
});

/**
 * Request Interceptor:
 * Injects standard OAuth 2.0 Bearer access token into Authorization header.
 * Legacy v0.1 custom headers (freelancer-oauth-v1) are deprecated and removed.
 * Checks dynamically managed OAuth service tokens before falling back to environment defaults.
 */
freelancerNetwork.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // Check dynamic token storage first
    let token = freelancerOAuthService.getAccessToken();

    // If dynamic token is expiring soon and refresh token is present, perform silent refresh
    if (freelancerOAuthService.isAuthenticated() && freelancerOAuthService.isTokenExpired(45) && freelancerOAuthService.getRefreshToken()) {
      try {
        const refreshed = await freelancerOAuthService.refreshToken();
        token = refreshed.accessToken;
      } catch (err) {
        console.warn('[FreelancerNetwork] Pre-flight refresh failed, attempting with current token');
      }
    }

    // Fallback to environment tokens
    if (!token) {
      token = (
        (typeof process !== 'undefined' && (
          process.env?.FREELANCER_ACCESS_TOKEN ||
          process.env?.FREELANCER_AUTH_TOKEN ||
          process.env?.FREELANCER_SESSION
        )) ||
        ''
      ).trim();
    }

    if (token && token.length > 0 && token !== '3PKsiB3m736mE0wnirnHeLTUzLP1xc') {
      config.headers.set('Authorization', `Bearer ${token}`);
    }

    return config;
  },
  (error: AxiosError) => {
    console.info('[FreelancerNetwork Request Notice] Failed to configure request:', error.message);
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor:
 * Handles 401/403 token expiration responses.
 * Attempts automatic token refresh and request retry on 401 if a refresh token exists.
 */
freelancerNetwork.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error: AxiosError) => {
    const status = error.response?.status;
    const url = error.config?.url || 'Freelancer endpoint';
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean });

    if (status === 401 && originalRequest && !originalRequest._retry && freelancerOAuthService.getRefreshToken()) {
      originalRequest._retry = true;
      try {
        console.log(`[FreelancerNetwork] 401 encountered on ${url}. Attempting silent token refresh...`);
        const refreshed = await freelancerOAuthService.refreshToken();
        if (refreshed.accessToken && originalRequest.headers) {
          originalRequest.headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
          return freelancerNetwork(originalRequest);
        }
      } catch (refreshErr) {
        console.info('[FreelancerNetwork Notice] Token refresh not completed after 401:', refreshErr);
      }
    }

    if (status === 401 || status === 403) {
      console.info(
        `[FreelancerNetwork Notice] Authentication required (HTTP ${status}) for ${url}. ` +
        'Generate an official token at https://accounts.freelancer.com/settings/develop'
      );
    } else if (status === 429) {
      console.info(`[FreelancerNetwork Notice] Rate limit encountered (HTTP 429) for ${url}. Throttling requests.`);
    } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.info(`[FreelancerNetwork Notice] Request to ${url} timed out.`);
    } else {
      console.info(`[FreelancerNetwork Notice] Request to ${url} notice: ${error.message}`);
    }

    return Promise.reject(error);
  }
);

export default freelancerNetwork;

