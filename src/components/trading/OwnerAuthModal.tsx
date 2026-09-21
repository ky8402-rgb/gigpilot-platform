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
  QrCode
} from 'lucide-react';
import {
  fetchOwnerAuthStatus,
  initiateOwnerTotpSetup,
  completeOwnerSetup,
  loginOwner
} from '../../services/tradingService';
import { OwnerAuthStatus } from '../../types/trading';

interface OwnerAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
}

export const OwnerAuthModal: React.FC<OwnerAuthModalProps> = ({ isOpen, onClose, onAuthSuccess }) => {
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

  // Setup state
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState<boolean>(false);

  // Status message
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    loadStatus();
  }, [isOpen]);

  const loadStatus = async () => {
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
        await startSetup(status.ownerEmail || 'ky8402@gmail.com');
      } else {
        setMode('LOGIN');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to check owner authentication status');
    } finally {
      setLoading(false);
    }
  };

  const startSetup = async (targetEmail: string) => {
    try {
      const res = await initiateOwnerTotpSetup(targetEmail);
      if (res.success) {
        setSetupData(res);
      } else {
        setErrorMsg(res.error || 'Failed to initialize TOTP');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize TOTP');
    }
  };

  const handleCopySecret = () => {
    if (!setupData?.secret) return;
    navigator.clipboard.writeText(setupData.secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !password ||
      password.length < 12 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/[0-9]/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
      setErrorMsg('Password must be at least 12 characters and include uppercase, lowercase, number, and symbol.');
      return;
    }
    if (!totpCode || totpCode.trim().length !== 6) {
      setErrorMsg('Please enter the 6-digit verification code from Google Authenticator.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await completeOwnerSetup(password, totpCode.trim(), email);
      if (res.success) {
        setSuccessMsg('2FA Setup completed successfully! Authenticated as Owner.');
        setTimeout(() => {
          onAuthSuccess();
          onClose();
        }, 1200);
      } else {
        setErrorMsg(res.error || 'Invalid code or setup failed.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Setup request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await loginOwner({
        email: email.trim(),
        password: password,
        totpCode: useEmergencyPin ? undefined : totpCode.trim(),
        emergencyPin: useEmergencyPin ? emergencyPin.trim() : undefined
      });

      if (res.success) {
        setSuccessMsg('Authentication successful. Welcome, Owner.');
        setTimeout(() => {
          onAuthSuccess();
          onClose();
        }, 1000);
      } else {
        setErrorMsg(res.error || 'Login rejected: Invalid credentials.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication error.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-100 text-sm font-bold p-1"
        >
          ✕
        </button>

        {/* Header Badge */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100">Owner Access Portal</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                1-OWNER ONLY
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Personal cryptographic protection • Google Authenticator 2FA
            </p>
          </div>
        </div>

        {/* Status Messages */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-950/60 border border-emerald-800/80 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* LOADING STATE */}
        {loading ? (
          <div className="py-12 text-center text-slate-400 text-xs font-mono">
            Verifying cryptographic credentials...
          </div>
        ) : mode === 'SETUP' ? (
          /* ========================================= */
          /* INITIAL SETUP FLOW (PASSWORD + TOTP QR)   */
          /* ========================================= */
          <form onSubmit={handleSetupSubmit} className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-1">
              <div className="font-semibold text-amber-400">First-Time Setup for Owner</div>
              <p className="text-[11px] text-slate-400">
                Configure your master password and scan the QR code into Google Authenticator.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Owner Email</label>
              <input
                type="email"
                value={email}
                readOnly
                className="w-full px-3 py-2 bg-slate-950/80 border border-slate-800 rounded-lg text-xs text-slate-400 font-mono cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Set Master Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create master password (min 6 characters)..."
                  className="w-full pl-3 pr-10 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* QR CODE DISPLAY */}
            {setupData && (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="text-center">
                  <span className="text-[11px] text-slate-400 block mb-2">Scan in Google Authenticator:</span>
                  <div className="inline-block p-2 bg-white rounded-lg shadow-inner">
                    <img
                      src={setupData.qrCodeDataUrl}
                      alt="Google Authenticator QR Code"
                      className="w-36 h-36"
                    />
                  </div>
                </div>

                <div className="text-center">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">Manual Base32 Secret:</span>
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-xs font-mono font-bold text-amber-400 bg-slate-900 px-2 py-1 rounded border border-slate-800">
                      {setupData.secret}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopySecret}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                      title="Copy Secret"
                    >
                      {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Enter 6-Digit Google Authenticator Code
              </label>
              <input
                type="text"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-center text-lg font-mono font-bold text-amber-400 tracking-widest focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition shadow-lg"
            >
              {submitting ? 'Verifying...' : 'Confirm & Activate 2FA'}
            </button>
          </form>
        ) : (
          /* ========================================= */
          /* STANDARD OWNER LOGIN (EMAIL + PASS + TOTP) */
          /* ========================================= */
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Owner Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Master Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your master password..."
                  className="w-full pl-3 pr-10 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  required={!useEmergencyPin}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!useEmergencyPin ? (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300">Google Authenticator (6 Digits)</label>
                  <button
                    type="button"
                    onClick={() => setUseEmergencyPin(true)}
                    className="text-[10px] text-amber-400 hover:underline"
                  >
                    Lost phone? Use PIN
                  </button>
                </div>
                <input
                  type="text"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-center text-lg font-mono font-bold text-amber-400 tracking-widest focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-rose-300">Emergency Master PIN</label>
                  <button
                    type="button"
                    onClick={() => setUseEmergencyPin(false)}
                    className="text-[10px] text-slate-400 hover:underline"
                  >
                    Back to TOTP
                  </button>
                </div>
                <input
                  type="password"
                  value={emergencyPin}
                  onChange={(e) => setEmergencyPin(e.target.value)}
                  placeholder="Enter 6-digit emergency PIN..."
                  className="w-full px-3 py-2 bg-slate-950 border border-rose-800 rounded-lg text-center text-sm font-mono font-bold text-rose-400 focus:outline-none"
                  required
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition shadow-lg shadow-emerald-950"
            >
              {submitting ? 'Verifying...' : 'Authenticate & Unlock Engine'}
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setMode('SETUP');
                  startSetup(email);
                }}
                className="text-[11px] text-slate-500 hover:text-slate-400 underline"
              >
                Reconfigure Google Authenticator QR Code
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
