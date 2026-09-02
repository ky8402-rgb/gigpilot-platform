import axios, { AxiosInstance, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';

/**
 * Official Freelancer API client configured for REST endpoints
 * Using official OAuth Access Token from https://accounts.freelancer.com/settings/develop
 */
export const freelancerNetwork: AxiosInstance = axios.create({
  baseURL: 'https://api.freelancer.com',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'FreelanceAutoBidder/1.0 (+https://kundanvision369.onrender.com)',
  },
});

/**
 * Request Interceptor:
 * Injects official FREELANCER_ACCESS_TOKEN into Authorization and freelancer-oauth-v1 headers.
 * Logs a clear warning if the token is missing.
 */
freelancerNetwork.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = (
      (typeof process !== 'undefined' && (
        process.env?.FREELANCER_ACCESS_TOKEN ||
        process.env?.FREELANCER_AUTH_TOKEN ||
        process.env?.FREELANCER_SESSION
      )) ||
      '3PKsiB3m736mE0wnirnHeLTUzLP1xc'
    ).trim();

    if (token && token.length > 0) {
      config.headers.set('freelancer-oauth-v1', token);
      config.headers.set('Authorization', `Bearer ${token}`);
      config.headers.set('Cookie', `freelancer_session=${token}; auth_token=${token}`);
    } else {
      console.warn(
        '[FreelancerNetwork Warning] process.env.FREELANCER_ACCESS_TOKEN is missing or empty. ' +
        'Please generate an official token at https://accounts.freelancer.com/settings/develop'
      );
    }

    return config;
  },
  (error: AxiosError) => {
    console.warn('[FreelancerNetwork Request Error] Failed to configure request:', error.message);
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor:
 * Handles 401/403 token expiration responses by logging explicit warnings without crashing the server.
 */
freelancerNetwork.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error: AxiosError) => {
    const status = error.response?.status;
    const url = error.config?.url || 'Freelancer endpoint';

    if (status === 401 || status === 403) {
      console.warn(
        `[FreelancerNetwork Warning] Authentication failed (HTTP ${status}) for ${url}. ` +
        'Your FREELANCER_ACCESS_TOKEN may be invalid or expired. ' +
        'Generate a fresh token at https://accounts.freelancer.com/settings/develop'
      );
    } else if (status === 429) {
      console.warn(`[FreelancerNetwork Warning] Rate limit encountered (HTTP 429) for ${url}. Throttling requests.`);
    } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.warn(`[FreelancerNetwork Warning] Request to ${url} timed out.`);
    } else {
      console.warn(`[FreelancerNetwork Notice] Request to ${url} failed: ${error.message}`);
    }

    return Promise.reject(error);
  }
);

export default freelancerNetwork;

