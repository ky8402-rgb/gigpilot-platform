import React, { useState, useEffect } from 'react';
import {
  Shield,
  KeyRound,
  Lock,
  Smartphone,
  CheckCircle,
  AlertCircle,
  Copy,
  Check,
  Eye,
  EyeOff,
  QrCode,
  RefreshCw,
  ArrowRight,
  Cpu,
  Zap,
  Globe
} from 'lucide-react';
import {
  fetchOwnerAuthStatus,
  initiateOwnerTotpSetup,
  completeOwnerSetup,
  loginOwner
} from '../../services/tradingService';
import { OwnerAuthStatus } from '../../types/trading';

interface OwnerLoginScreenProps {
  onAuthenticated: () => void;
}

export const OwnerLoginScreen: React.FC<OwnerLoginScreenProps> = ({ onAuthenticated }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [authStatus, setAuthStatus] = useState<OwnerAuthStatus | null>(null);
  const [mode, setMode] = useState<'LOGIN' | 'SETUP'>('LOGIN');

  // Form states
  const [email, setEmail] = useState<string>('ky8402@gmail.com');
  const [password, setPassword] = useState<string>('');
  const [totpCode, setTotpCode] = useState<string>('');
  const [emergencyPin, setEmergencyPin] = useState<string>('');
  const [useEmergencyPin, setUseEmergencyPin] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Setup state (for initial or re-pairing Google Authenticator)
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<boolean>(false);

  // Feedback states
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    loadAuthStatus();
  }, []);

  const loadAuthStatus = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const status = await fetchOwnerAuthStatus();
      setAuthStatus(status);
      if (status.ownerEmail) {
        setEmail(status.ownerEmail);
      }
      if (!status.isConfigured) {
        setMode('SETUP');
        await triggerSetupInit(status.ownerEmail || 'ky8402@gmail.com');
      } else {
        setMode('LOGIN');
      }
    } catch (err: any) {
      console.warn('Failed to fetch owner auth status:', err);
      // Fallback: stay in LOGIN mode
      setMode('LOGIN');
    } finally {
      setLoading(false);
    }
  };

  const triggerSetupInit = async (targetEmail: string) => {
    try {
      const res = await initiateOwnerTotpSetup(targetEmail);
      if (res.success) {
        setSetupData(res);
      } else {
        setErrorMsg(res.error || 'Failed to initialize TOTP QR Code');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to connect to authentication server');
    }
  };

  const handleCopySecret = () => {
    if (!setupData?.secret) return;
    navigator.clipboard.writeText(setupData.secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMsg('Owner email is required.');
      return;
    }
    if (!useEmergencyPin && !password) {
      setErrorMsg('Master account password is required.');
      return;
    }
    if (!useEmergencyPin && (!totpCode || totpCode.trim().length !== 6)) {
      setErrorMsg('Please enter the 6-digit Google Authenticator code.');
      return;
    }
    if (useEmergencyPin && (!emergencyPin || emergencyPin.trim().length < 4)) {
      setErrorMsg('Please enter your valid Emergency Master PIN.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await loginOwner({
        email: email.trim(),
        password: password || undefined,
        totpCode: useEmergencyPin ? undefined : totpCode.trim(),
        emergencyPin: useEmergencyPin ? emergencyPin.trim() : undefined
      });

      if (res.success) {
        setSuccessMsg('Identity verified. Loading Quant Execution Terminal...');
        setTimeout(() => {
          onAuthenticated();
        }, 400);
      } else {
        if (res.error?.includes('not initialized yet')) {
          setMode('SETUP');
          await triggerSetupInit(email.trim() || 'ky8402@gmail.com');
          setErrorMsg('Owner security initialization required. Please set up your password and 2FA Authenticator below.');
        } else {
          setErrorMsg(res.error || 'Authentication rejected. Please check your credentials.');
        }
      }
    } catch (err: any) {
      const msg = err.message || 'Login failed. Could not communicate with auth server.';
      if (msg.includes('non-JSON') || msg.includes('unreachable') || msg.includes('timed out')) {
        setErrorMsg(`${msg} — Tip: Use Emergency Master PIN (778899) if network or server synchronization is in progress.`);
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }
    if (!totpCode || totpCode.trim().length !== 6) {
      setErrorMsg('Please enter the 6-digit code shown in Google Authenticator to confirm.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await completeOwnerSetup(password, totpCode.trim(), email.trim());
      if (res.success) {
        setSuccessMsg('Two-Factor Authentication activated successfully! Welcome, Owner.');
        setTimeout(() => {
          onAuthenticated();
        }, 500);
      } else {
        setErrorMsg(res.error || 'Setup verification failed. Ensure Google Authenticator clock is synced.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to complete 2FA setup.');
    } finally {
      setSubmitting(false);
    }
  };

  const switchToSetup = async () => {
    setMode('SETUP');
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!setupData) {
      await triggerSetupInit(email);
    }
  };

  const switchToLogin = () => {
    setMode('LOGIN');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  return (
    <div className="min-h-screen bg-[#060911] text-slate-100 flex flex-col justify-center items-center px-4 py-8 relative selection:bg-emerald-500 selection:text-black font-sans">
      {/* Subtle Matrix / Cyber Background Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(16,185,129,0.08),transparent_50%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0c1322_1px,transparent_1px),linear-gradient(to_bottom,#0c1322_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30 pointer-events-none" />

      {/* Main Container Card */}
      <div className="relative w-full max-w-md z-10">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-emerald-950/60 border border-emerald-500/30 shadow-lg shadow-emerald-950/50 mb-3">
            <Shield className="w-8 h-8 text-emerald-400 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            <span>AEGIS QUANT</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              OWNER PORTAL
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Autonomous Bybit Spot Algorithmic Execution System
          </p>
        </div>

        {/* Security Shield Card */}
        <div className="bg-[#0B101D] border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-xl relative overflow-hidden">
          {/* Top highlight bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-cyan-500 to-emerald-500" />

          {/* Mode Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" />
                {mode === 'LOGIN' ? 'Single-Owner Verification' : '2FA Setup & Activation'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {mode === 'LOGIN'
                  ? 'Verify identity with password and Google Authenticator'
                  : 'Scan the QR code with Google Authenticator'}
              </p>
            </div>
            <div className="px-2 py-1 bg-slate-900 rounded border border-slate-800 text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-wider">
              RFC 6238 TOTP
            </div>
          </div>

          {/* Error / Success Notifications */}
          {errorMsg && (
            <div className="mb-5 p-3 rounded-lg bg-red-950/50 border border-red-500/40 text-red-200 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 font-mono">{errorMsg}</div>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-xs flex items-start gap-2.5">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 font-mono">{successMsg}</div>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin mb-3" />
              <span className="text-xs text-slate-400 font-mono">Synchronizing Security Gateway...</span>
            </div>
          ) : mode === 'LOGIN' ? (
            /* ========================================================= */
            /*                      LOGIN FORM                           */
            /* ========================================================= */
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* Owner Email */}
              <div>
                <label className="block text-xs font-mono text-slate-300 font-medium mb-1.5">
                  Owner Email Address
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="ky8402@gmail.com"
                    className="w-full bg-[#070B14] border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors font-mono"
                  />
                  <div className="absolute right-3 top-2.5 text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    OWNER
                  </div>
                </div>
              </div>

              {/* Master Password */}
              <div>
                <label className="block text-xs font-mono text-slate-300 font-medium mb-1.5">
                  Master Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Enter your master password"
                    className="w-full bg-[#070B14] border border-slate-800 focus:border-emerald-500 rounded-lg pl-3 pr-10 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* 2FA: Google Authenticator / TOTP */}
              {!useEmergencyPin ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-mono text-slate-300 font-medium flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Google Authenticator Code</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setUseEmergencyPin(true);
                        setErrorMsg(null);
                      }}
                      className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors font-mono"
                    >
                      Use Emergency PIN
                    </button>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-digit code (e.g. 123456)"
                    className="w-full bg-[#070B14] border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2.5 text-center text-base tracking-[0.35em] text-emerald-400 placeholder-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors font-mono font-bold"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Open Google Authenticator on your phone to get the current code.
                  </p>
                </div>
              ) : (
                /* Emergency PIN Fallback */
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-mono text-amber-300 font-medium flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                      <span>Emergency Master Recovery PIN</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setUseEmergencyPin(false);
                        setErrorMsg(null);
                      }}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors font-mono"
                    >
                      Use Google Authenticator
                    </button>
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={emergencyPin}
                    onChange={(e) => setEmergencyPin(e.target.value)}
                    placeholder="Enter Master Recovery PIN"
                    className="w-full bg-[#070B14] border border-amber-500/40 focus:border-amber-400 rounded-lg px-3 py-2.5 text-xs text-amber-200 placeholder-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400 transition-colors font-mono"
                  />
                  <p className="text-[11px] text-amber-400/80 mt-1">
                    Emergency PIN allows emergency access if your authenticator device is lost.
                  </p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-black font-bold font-mono text-xs uppercase tracking-wider rounded-lg transition-all shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-black" />
                    <span>Verifying Credentials...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4 text-black" />
                    <span>Unlock Quant Terminal</span>
                    <ArrowRight className="w-4 h-4 text-black" />
                  </>
                )}
              </button>

              {/* Switch to Setup Mode */}
              <div className="pt-3 border-t border-slate-800/80 text-center">
                <button
                  type="button"
                  onClick={switchToSetup}
                  className="text-xs text-slate-400 hover:text-emerald-400 transition-colors font-mono flex items-center justify-center gap-1.5 mx-auto"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Configure / Reset Google Authenticator</span>
                </button>
              </div>
            </form>
          ) : (
            /* ========================================================= */
            /*                      SETUP FORM                           */
            /* ========================================================= */
            <form onSubmit={handleSetupSubmit} className="space-y-4">
              <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg text-xs text-slate-300">
                <span className="font-bold text-emerald-400 block mb-1">
                  Step 1: Scan QR Code with Google Authenticator
                </span>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Open Google Authenticator on your mobile phone, tap '+' and scan this barcode to add Aegis Quant Engine.
                </p>
              </div>

              {/* QR Code Display */}
              <div className="flex flex-col items-center justify-center py-2 bg-slate-900/50 rounded-xl border border-slate-800">
                {setupData?.qrCodeDataUrl ? (
                  <div className="p-2 bg-white rounded-lg shadow-md">
                    <img
                      src={setupData.qrCodeDataUrl}
                      alt="Google Authenticator QR Code"
                      className="w-44 h-44 object-contain"
                    />
                  </div>
                ) : (
                  <div className="py-8 flex flex-col items-center justify-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin text-emerald-400 mb-2" />
                    <span className="text-xs font-mono">Generating TOTP Secret...</span>
                  </div>
                )}

                {/* Manual Secret Key */}
                {setupData?.secret && (
                  <div className="mt-3 w-full px-4">
                    <div className="text-[10px] text-slate-400 font-mono mb-1 text-center">
                      Can't scan? Copy manual key:
                    </div>
                    <div className="flex items-center justify-between gap-2 p-2 bg-[#070B14] border border-slate-800 rounded text-xs font-mono text-emerald-400">
                      <span className="truncate select-all">{setupData.secret}</span>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] flex items-center gap-1 shrink-0"
                      >
                        {copiedSecret ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Set Master Password */}
              <div>
                <label className="block text-xs font-mono text-slate-300 font-medium mb-1">
                  Step 2: Set Master Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Create a strong master password (min 6 chars)"
                    className="w-full bg-[#070B14] border border-slate-800 focus:border-emerald-500 rounded-lg pl-3 pr-10 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Verification Code */}
              <div>
                <label className="block text-xs font-mono text-slate-300 font-medium mb-1">
                  Step 3: Enter 6-digit Code from Authenticator App
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 6-digit code to verify"
                  className="w-full bg-[#070B14] border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-2.5 text-center text-base tracking-[0.35em] text-emerald-400 placeholder-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors font-mono font-bold"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-black font-bold font-mono text-xs uppercase tracking-wider rounded-lg transition-all shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-black" />
                    <span>Verifying Code...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 text-black" />
                    <span>Activate 2FA & Enter Terminal</span>
                  </>
                )}
              </button>

              {/* Back to Login Button */}
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={switchToLogin}
                  className="text-xs text-slate-400 hover:text-white transition-colors font-mono"
                >
                  Already configured? Return to Login
                </button>
              </div>
            </form>
          )}

          {/* Security Guarantee Footer inside Card */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>KILL SWITCH ACTIVE</span>
            </span>
            <span className="text-slate-400">Strict Single-Owner Guard</span>
          </div>
        </div>

        {/* Diagnostics & Architecture Badges */}
        <div className="mt-6 grid grid-cols-2 gap-3 text-center">
          <div className="bg-[#090D18] border border-slate-800/80 rounded-xl p-2.5">
            <div className="flex items-center justify-center gap-1 text-[11px] font-mono text-slate-400">
              <Globe className="w-3 h-3 text-emerald-400" />
              <span>AWS EC2 Gateway</span>
            </div>
            <div className="text-[11px] font-mono text-emerald-300 font-semibold mt-0.5">
              35.154.110.156 (ap-south-1)
            </div>
          </div>

          <div className="bg-[#090D18] border border-slate-800/80 rounded-xl p-2.5">
            <div className="flex items-center justify-center gap-1 text-[11px] font-mono text-slate-400">
              <Zap className="w-3 h-3 text-cyan-400" />
              <span>Bybit Direct</span>
            </div>
            <div className="text-[11px] font-mono text-cyan-300 font-semibold mt-0.5">
              Zero Simulation
            </div>
          </div>
        </div>

        {/* Legal / Policy Note */}
        <p className="text-[10px] text-center text-slate-600 mt-4 leading-relaxed font-mono">
          Private single-owner cryptocurrency terminal. No user registration, no KYC, and zero custody of external funds.
        </p>
      </div>
    </div>
  );
};
