import React, { useState, useEffect } from 'react';
import { 
  X, 
  KeyRound, 
  Mail, 
  Lock, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  RefreshCw, 
  ShieldCheck,
  Eye,
  EyeOff
} from 'lucide-react';
import { requestPasswordReset, submitPasswordReset, changeUserPassword } from '../services/api';

interface PasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
  onSuccess?: (message: string) => void;
}

export const PasswordResetModal: React.FC<PasswordResetModalProps> = ({
  isOpen,
  onClose,
  initialEmail = 'ky8402@gmail.com',
  onSuccess
}) => {
  const [mode, setMode] = useState<'forgot' | 'change'>('forgot');
  const [step, setStep] = useState<'request' | 'verify' | 'done'>('request');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [devCodePreview, setDevCodePreview] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendCountdown > 0) {
      timer = setTimeout(() => setResendCountdown(prev => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  if (!isOpen) return null;

  const handleRequestResetCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    if (!email || !email.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await requestPasswordReset(email);
      if (res.success) {
        setInfoMsg(res.message);
        if (res.devCodePreview) {
          setDevCodePreview(res.devCodePreview);
          setCode(res.devCodePreview); // Auto-fill for convenience
        }
        setStep('verify');
        setResendCountdown(60);
      } else {
        setErrorMsg(res.error || 'Failed to send password reset code.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error while requesting password reset.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    if (!code.trim()) {
      setErrorMsg('Please enter the 6-digit reset code.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await submitPasswordReset({
        email,
        code: code.trim(),
        newPassword
      });

      if (res.success) {
        setStep('done');
        if (onSuccess) onSuccess(res.message || 'Password successfully updated!');
      } else {
        setErrorMsg(res.error || 'Failed to reset password.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error occurred during password reset.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePasswordDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    if (!currentPassword) {
      setErrorMsg('Please enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await changeUserPassword({
        email,
        currentPassword,
        newPassword
      });

      if (res.success) {
        setStep('done');
        if (onSuccess) onSuccess('Password updated successfully!');
      } else {
        setErrorMsg(res.error || 'Failed to change password.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  // Password Strength Indicator Calculation
  const calculateStrength = (pass: string) => {
    let score = 0;
    if (pass.length >= 8) score++;
    if (/[A-Z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    return score;
  };

  const strength = calculateStrength(newPassword);
  const strengthLabels = ['Too weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const strengthColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-emerald-500', 'bg-teal-400'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#11141f] shadow-2xl text-slate-100 overflow-hidden my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#161b2b] px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-400 border border-indigo-500/20">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Password &amp; Security</h2>
              <p className="text-xs text-slate-400">Account credential reset and protection</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        {step !== 'done' && (
          <div className="flex border-b border-slate-800 bg-[#0d101a] px-6 pt-3 text-xs font-semibold space-x-6">
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setErrorMsg('');
                setInfoMsg('');
              }}
              className={`pb-2.5 transition-all border-b-2 ${
                mode === 'forgot'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Reset via OTP Code
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('change');
                setErrorMsg('');
                setInfoMsg('');
              }}
              className={`pb-2.5 transition-all border-b-2 ${
                mode === 'change'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Change Current Password
            </button>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6">
          {errorMsg && (
            <div className="mb-4 flex items-start space-x-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {infoMsg && (
            <div className="mb-4 flex items-start space-x-2.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs text-indigo-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-indigo-400" />
              <span>{infoMsg}</span>
            </div>
          )}

          {/* STEP: DONE */}
          {step === 'done' ? (
            <div className="py-6 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-bold text-white">Password Updated!</h3>
              <p className="text-xs text-slate-300 max-w-xs mx-auto">
                Your account password has been updated securely. All future logins must use the new credentials.
              </p>

              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-emerald-500 py-3 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
              >
                Done &amp; Return to Dashboard
              </button>
            </div>
          ) : mode === 'change' ? (
            /* CHANGE CURRENT PASSWORD FORM */
            <form onSubmit={handleChangePasswordDirect} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Account Email</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-[#0b0d15] px-3 py-2.5 text-xs text-slate-400 font-mono focus:outline-none opacity-80"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Current Password</label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter existing password"
                    required
                    className="w-full rounded-xl border border-slate-800 bg-[#0b0d15] py-2.5 pl-9 pr-9 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">New Password (8+ chars)</label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Create a strong password"
                    required
                    className="w-full rounded-xl border border-slate-800 bg-[#0b0d15] py-2.5 pl-9 pr-3 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                {/* Strength Meter */}
                {newPassword && (
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Strength: {strengthLabels[strength]}</span>
                      <span>{strength * 25}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden flex gap-1">
                      {[1, 2, 3, 4].map((level) => (
                        <div
                          key={level}
                          className={`h-full flex-1 rounded-full transition-all ${
                            strength >= level ? strengthColors[strength] : 'bg-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Confirm New Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-[#0b0d15] px-3 py-2.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center space-x-2 rounded-xl bg-indigo-600 py-3 text-xs font-bold text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>Update Password</span>
                  </>
                )}
              </button>
            </form>
          ) : step === 'request' ? (
            /* FORGOT PASSWORD - STEP 1: REQUEST CODE */
            <form onSubmit={handleRequestResetCode} className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Enter your registered email address. We will generate a secure 6-digit reset code to authorize your password update.
              </p>

              <div>
                <label className="text-xs font-semibold text-slate-300">Your Email Address</label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    className="w-full rounded-xl border border-slate-800 bg-[#0b0d15] py-2.5 pl-9 pr-3 text-xs text-slate-200 font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center space-x-2 rounded-xl bg-indigo-600 py-3 text-xs font-bold text-white hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/30 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Sending Reset Code...</span>
                  </>
                ) : (
                  <>
                    <span>Send 6-Digit Code</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            /* FORGOT PASSWORD - STEP 2: VERIFY CODE & SET NEW PASSWORD */
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="rounded-xl bg-indigo-950/40 border border-indigo-500/20 p-3 text-xs text-indigo-300 flex items-center justify-between">
                <div>
                  <span>Code sent to: </span>
                  <span className="font-mono font-bold text-white">{email}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('request')}
                  className="text-[11px] text-indigo-400 underline hover:text-indigo-200"
                >
                  Change
                </button>
              </div>

              {devCodePreview && (
                <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/30 p-2.5 text-xs text-emerald-300 flex items-center justify-between">
                  <span>Development OTP Code:</span>
                  <span className="font-mono font-bold text-emerald-400 tracking-widest">{devCodePreview}</span>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-slate-300">6-Digit Reset Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  required
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-[#0b0d15] px-3 py-2.5 text-center text-lg font-mono tracking-widest text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">New Password</label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    required
                    className="w-full rounded-xl border border-slate-800 bg-[#0b0d15] py-2.5 pl-9 pr-9 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {/* Strength */}
                {newPassword && (
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Strength: {strengthLabels[strength]}</span>
                      <span>{strength * 25}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden flex gap-1">
                      {[1, 2, 3, 4].map((level) => (
                        <div
                          key={level}
                          className={`h-full flex-1 rounded-full transition-all ${
                            strength >= level ? strengthColors[strength] : 'bg-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Confirm New Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-[#0b0d15] px-3 py-2.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  disabled={resendCountdown > 0 || loading}
                  onClick={() => handleRequestResetCode()}
                  className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
                >
                  {resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : 'Resend code'}
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center space-x-2 rounded-xl bg-emerald-500 py-3 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Resetting Password...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Confirm &amp; Update Password</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>

      </div>
    </div>
  );
};

export default PasswordResetModal;
