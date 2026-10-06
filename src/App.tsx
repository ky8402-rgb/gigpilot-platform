import React, { useState, useEffect } from 'react';
import { TradingDashboard } from './components/trading/TradingDashboard';
import { OwnerLoginScreen } from './components/auth/OwnerLoginScreen';
import { fetchOwnerAuthStatus, getStoredOwnerToken, refreshOwnerSession, logoutOwner } from './services/tradingService';
import { Shield, RefreshCw } from 'lucide-react';

export function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [checkingSession, setCheckingSession] = useState<boolean>(true);

  useEffect(() => {
    checkInitialSession();
  }, []);

  const checkInitialSession = async () => {
    try {
      // The token is memory-only, so a reload starts empty. When the deployment is same-origin the
      // httpOnly session cookie can re-mint one here; cross-origin it is a no-op (false) and the
      // owner must sign in again — the accepted cost of keeping the bearer out of durable storage.
      await refreshOwnerSession();

      const token = getStoredOwnerToken();
      if (!token) {
        setIsAuthenticated(false);
        setCheckingSession(false);
        return;
      }

      // Verify token with backend
      const status = await fetchOwnerAuthStatus();
      if (status.isAuthenticated) {
        setIsAuthenticated(true);
      } else {
        // Token was invalid or expired
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.warn('Could not verify owner session:', err);
      // In case of error, prevent unauthorized access by requiring login
      setIsAuthenticated(false);
    } finally {
      setCheckingSession(false);
    }
  };

  const handleAuthenticated = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    await logoutOwner();
    setIsAuthenticated(false);
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#060911] text-slate-100 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 bg-emerald-950/60 border border-emerald-500/30 rounded-2xl animate-pulse">
            <Shield className="w-8 h-8 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            <span>Validating Single-Owner Security Session...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <OwnerLoginScreen onAuthenticated={handleAuthenticated} />;
  }

  return <TradingDashboard onLogout={handleLogout} />;
}

export default App;
