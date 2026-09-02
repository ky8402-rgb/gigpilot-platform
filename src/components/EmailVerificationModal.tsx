import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Mail, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  ShieldCheck, 
  Zap, 
  Lock,
  ArrowRight
} from 'lucide-react';
import { requestVerificationEmail, verifyEmailCode } from '../services/api';

interface EmailVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: string;
  isVerified: boolean;
  onVerificationSuccess: () => void;
}

export const EmailVerificationModal: React.FC<EmailVerificationModalProps> = ({
  isOpen,
  onClose,
  email = 'ky8402@gmail.com',
  isVerified,
  onVerificationSuccess
}) => {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [devOtpPreview, setDevOtpPreview] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendCountdown > 0) {
      timer = setTimeout(() => setResendCountdown(prev => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  // When modal opens, if not verified, automatically trigger OTP send if not already sent
  useEffect(() => {
    if (isOpen && !isVerified && resendCountdown === 0 && !devOtpPreview) {
      handleSendCode();
    }
  }, [isOpen, isVerified]);

  if (!isOpen) return null;

  const handleSendCode = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);
    try {
      const res = await requestVerificationEmail(email);
      if (res.success) {
        setSuccessMsg(`A 6-digit verification code was dispatched to ${email}`);
        if (res.devOtpPreview) {
          setDevOtpPreview(res.devOtpPreview);
          // Pre-populate for swift testing
          const chars = res.devOtpPreview.split('').slice(0, 6);
          setDigits(chars);
        }
        setResendCountdown(60);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to dispatch verification email');
    } finally {
      setLoading(false);
    }
  };

  const handleDigitChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste
      const pasted = value.replace(/\D/g, '').slice(0, 6).split('');
      const newDigits = [...digits];
      pasted.forEach((char, i) => {
        if (i < 6) newDigits[i] = char;
      });
      setDigits(newDigits);
      if (pasted.length === 6) {
        inputRefs.current[5]?.focus();
      }
      return;
    }

    const cleanChar = value.replace(/\D/g, '');
    const newDigits = [...digits];
    newDigits[index] = cleanChar;
    setDigits(newDigits);

    if (cleanChar && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const code = digits.join('');
    if (code.length < 6) {
      setErrorMsg('Please enter all 6 digits of the verification code.');
      return;
    }

    setErrorMsg('');
    setLoading(true);
    try {
      const res = await verifyEmailCode(email, code);
      if (res.success) {
        setSuccessMsg('Email verified successfully! Your account now has full verified access.');
        onVerificationSuccess();
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setErrorMsg(res.error || 'Invalid verification code.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Verification failed. Please check the code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-[#11141f] shadow-2xl text-slate-100 overflow-hidden my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#161b2b] px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl bg-sky-500/10 p-2.5 text-sky-400 border border-sky-500/20">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Email Verification</h2>
              <p className="text-xs text-slate-400">Authenticate identity &amp; unlock payouts</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Status Banner */}
          <div className={`flex items-center justify-between p-3.5 rounded-xl border ${
            isVerified 
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
              : 'bg-amber-950/30 border-amber-500/30 text-amber-300'
          }`}>
            <div className="flex items-center space-x-2.5">
              {isVerified ? (
                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />
              )}
              <div>
                <div className="text-xs font-bold text-white">
                  {isVerified ? 'Verified Account' : 'Verification Required'}
                </div>
                <div className="text-[11px] opacity-80 font-mono">{email}</div>
              </div>
            </div>

            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
              isVerified 
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
            }`}>
              {isVerified ? 'VERIFIED' : 'PENDING'}
            </span>
          </div>

          {errorMsg && (
            <div className="flex items-start space-x-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start space-x-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {isVerified ? (
            <div className="space-y-4 py-2 text-center">
              <p className="text-xs text-slate-300 leading-relaxed">
                Your email <strong className="text-white font-mono">{email}</strong> is fully verified. You enjoy unlocked access to instant PayPal escrow releases, automated GST invoices, and high-priority lead broadcasts.
              </p>

              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="rounded-xl border border-slate-800 bg-[#0d101a] p-3">
                  <div className="flex items-center space-x-2 text-emerald-400 text-xs font-bold mb-1">
                    <Zap className="h-3.5 w-3.5" />
                    <span>Instant Payouts</span>
                  </div>
                  <p className="text-[11px] text-slate-400">No hold periods for completed platform milestones.</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#0d101a] p-3">
                  <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold mb-1">
                    <Lock className="h-3.5 w-3.5" />
                    <span>2FA Security</span>
                  </div>
                  <p className="text-[11px] text-slate-400">Full audit logging &amp; tokenized API session keys.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-slate-800 py-3 text-xs font-bold text-white hover:bg-slate-700 transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                We sent a 6-digit one-time passcode (OTP) to your email. Enter the code below to complete verification:
              </p>

              {devOtpPreview && (
                <div className="rounded-lg bg-sky-950/40 border border-sky-500/30 p-2.5 text-xs text-sky-300 flex items-center justify-between">
                  <span>Development OTP Code:</span>
                  <span className="font-mono font-bold text-sky-400 tracking-widest">{devOtpPreview}</span>
                </div>
              )}

              {/* 6 Digit Inputs */}
              <div className="flex justify-between gap-2">
                {digits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    className="h-12 w-12 rounded-xl border border-slate-800 bg-[#0b0d15] text-center font-mono text-lg font-bold text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  disabled={resendCountdown > 0 || loading}
                  onClick={handleSendCode}
                  className="text-sky-400 hover:text-sky-300 disabled:opacity-40 flex items-center space-x-1.5"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                  <span>{resendCountdown > 0 ? `Resend code in ${resendCountdown}s` : 'Resend verification code'}</span>
                </button>
              </div>

              <button
                type="submit"
                disabled={loading || digits.join('').length < 6}
                className="w-full flex items-center justify-center space-x-2 rounded-xl bg-sky-600 py-3 text-xs font-bold text-white hover:bg-sky-500 transition-all shadow-lg shadow-sky-600/30 disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Verifying Code...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Verify &amp; Activate Email</span>
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

export default EmailVerificationModal;
