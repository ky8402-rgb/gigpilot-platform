import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Service Worker registration with safe dev-mode cleanup to prevent MIME type and stale chunk intercept issues
if ('serviceWorker' in navigator) {
  const isProd = (import.meta as any).env?.PROD ?? (process.env.NODE_ENV === 'production');
  if (isProd) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(
        (registration) => {
          console.log('🚀 [ServiceWorker] Registered with scope:', registration.scope);
        },
        (err) => {
          console.log('ℹ️ [ServiceWorker] Registration skipped:', err.message);
        }
      );
    });
  } else {
    // In development mode, unregister any service workers and clear caches
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
    if ('caches' in window) {
      caches.keys().then((keys) => {
        for (const key of keys) {
          caches.delete(key);
        }
      });
    }
  }
}


