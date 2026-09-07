/**
 * Universal API Client for GigPilot (Frontend to Render Backend)
 * Features:
 * - Automatic credentials: 'include' (fetch) and withCredentials: true (axios)
 * - Cross-subdomain cookie handling for *.onrender.com
 * - Bearer token fallback from localStorage
 * - Robust error interceptors
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// Default production backend URL on AWS EC2
export const DEFAULT_PRODUCTION_BACKEND_URL = 'https://3-222-149-9.sslip.io';

// Default backend URL (dynamically resolves to same-origin in container, or live EC2 on Amplify)
export const DEFAULT_API_URL =
  (typeof window !== 'undefined' && (
    window.location.hostname.includes('amplifyapp.com') ||
    window.location.hostname.includes('cloudfront.net') ||
    window.location.hostname.includes('vercel.app') ||
    window.location.hostname.includes('pages.dev')
  ) ? DEFAULT_PRODUCTION_BACKEND_URL : (typeof window !== 'undefined' && window.location?.origin)) ||
  (typeof import.meta !== 'undefined' && ((import.meta as any).env?.VITE_BACKEND_URL || (import.meta as any).env?.VITE_API_URL)) ||
  DEFAULT_PRODUCTION_BACKEND_URL;

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
    return window.location.origin;
  }

  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    const customUrl =
      (import.meta as any).env.VITE_API_URL ||
      (import.meta as any).env.VITE_BACKEND_URL ||
      (import.meta as any).env.VITE_API_BASE_URL;
    if (customUrl && typeof customUrl === 'string' && customUrl.trim().length > 0 && !customUrl.includes('ky7079.co')) {
      return customUrl.trim().replace(/\/+$/, '');
    }
  }

  return DEFAULT_PRODUCTION_BACKEND_URL;
}

/**
 * 1. Axios Instance configured for Cross-Domain Render Cookies & CORS
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: getBaseApiUrl(),
  withCredentials: true, // CRITICAL: Sends HTTP-only cookies across onrender.com subdomains
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
      const token = localStorage.getItem('gigpilot_token') || localStorage.getItem('token');
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
 * 2. Standard Fetch Wrapper with Credentials for Cross-Domain Render Deployment
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
    const token = localStorage.getItem('gigpilot_token') || localStorage.getItem('token');
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // CRITICAL: Enables cross-subdomain cookies on Render
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
