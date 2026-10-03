/**
 * Universal API Client for GigPilot (Frontend to EC2 Backend)
 * Features:
 * - Automatic credentials: 'include' (fetch) and withCredentials: true (axios)
 * - Cross-subdomain cookie handling
 * - Bearer token fallback from localStorage
 * - Robust error interceptors
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// Default production backend URL on AWS EC2 (Mumbai ap-south-1 Elastic IP)
export const DEFAULT_PRODUCTION_BACKEND_URL = 'https://35-154-110-156.sslip.io';

// Default backend URL (dynamically resolves to same-origin in container, or live EC2 on Amplify)
export const DEFAULT_API_URL =
  (typeof window !== 'undefined' && (
    window.location.hostname.includes('amplifyapp.com') ||
    window.location.hostname.includes('cloudfront.net') ||
    window.location.hostname.includes('vercel.app') ||
    window.location.hostname.includes('pages.dev')
  ) ? DEFAULT_PRODUCTION_BACKEND_URL : (typeof window !== 'undefined' && window.location?.origin)) ||
  (typeof import.meta !== 'undefined' && (
    (import.meta as any).env?.REACT_APP_API_URL ||
    (import.meta as any).env?.VITE_BACKEND_URL ||
    (import.meta as any).env?.VITE_API_BASE_URL ||
    (import.meta as any).env?.VITE_API_URL
  )) ||
  (typeof process !== 'undefined' && (
    process.env?.REACT_APP_API_URL ||
    process.env?.API_BASE_URL ||
    process.env?.VITE_BACKEND_URL
  )) ||
  DEFAULT_PRODUCTION_BACKEND_URL;

function normalizeApiBaseUrl(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  const value = candidate.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function getBaseApiUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    const isDetachedStaticHost =
      host.includes('amplifyapp.com') ||
      host.includes('cloudfront.net') ||
      host.includes('vercel.app') ||
      host.includes('github.io') ||
      host.includes('netlify.app') ||
      host.includes('pages.dev');

    if (isDetachedStaticHost) {
      return DEFAULT_PRODUCTION_BACKEND_URL;
    }
    const normalizedOrigin = normalizeApiBaseUrl(window.location.origin);
    return normalizedOrigin || DEFAULT_PRODUCTION_BACKEND_URL;
  }

  const customUrl =
    (typeof import.meta !== 'undefined' && (
      (import.meta as any).env?.REACT_APP_API_URL ||
      (import.meta as any).env?.VITE_BACKEND_URL ||
      (import.meta as any).env?.VITE_API_BASE_URL ||
      (import.meta as any).env?.VITE_API_URL
    )) ||
    (typeof process !== 'undefined' && (
      process.env?.REACT_APP_API_URL ||
      process.env?.API_BASE_URL ||
      process.env?.VITE_BACKEND_URL
    ));

  if (
    customUrl &&
    typeof customUrl === 'string' &&
    customUrl.trim().length > 0 &&
    !customUrl.includes('ky7079.co') &&
    !customUrl.includes('onrender.com') &&
    !customUrl.includes('render.com') &&
    !(typeof window !== 'undefined' && window.location?.protocol === 'https:' && customUrl.startsWith('http://'))
  ) {
    const normalizedCustomUrl = normalizeApiBaseUrl(customUrl);
    if (normalizedCustomUrl) return normalizedCustomUrl;
  }

  return DEFAULT_PRODUCTION_BACKEND_URL;
}

/**
 * The ONE place the owner session token is read from.
 *
 * `tradingService.setStoredOwnerToken()` — what the owner login flow actually calls — persists the
 * session under `gigpilot_owner_token`. This module previously read `gigpilot_token` / `token`
 * instead, so every request issued through `apiClient` or `apiFetch` went out ANONYMOUS after a
 * successful login and was refused with 401 by the owner-auth gate. The app looked broken to an
 * owner who had just signed in correctly.
 *
 * Reading the canonical key first, with the legacy keys retained as fallbacks, keeps a single source
 * of truth without invalidating any session already in a user's browser.
 */
export function getOwnerToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return (
    localStorage.getItem('gigpilot_owner_token') ||
    localStorage.getItem('gigpilot_token') ||
    localStorage.getItem('token')
  );
}

/**
 * 1. Axios Instance configured for Cross-Domain Cookies & CORS
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: getBaseApiUrl(),
  withCredentials: true, // Sends HTTP-only cookies across subdomains
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30000,
});

// Request interceptor: Attach Bearer token as backup if present
apiClient.interceptors.request.use(
  (config) => {
    if (typeof localStorage !== 'undefined') {
      const token = getOwnerToken();
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: Standardize error format
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const errorMsg =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected network error occurred';
    return Promise.reject(new Error(errorMsg));
  }
);

/**
 * 2. Standard Fetch Wrapper with Credentials for Cross-Domain Deployment
 */
export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T; status: number; ok: boolean }> {
  const base = getBaseApiUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = cleanEndpoint.startsWith('http') ? cleanEndpoint : `${base}${cleanEndpoint}`;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (typeof localStorage !== 'undefined') {
    const token = getOwnerToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Enables cross-subdomain cookies
  });

  let data: any;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMsg = data?.error || data?.message || `Request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  return { data, status: response.status, ok: response.ok };
}

export default apiClient;
