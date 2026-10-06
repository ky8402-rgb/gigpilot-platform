import React, { useState } from 'react';
import { KeyRound, Lock, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { ControlPlaneReason } from '../../services/tradingService';

interface ApiSecretModalProps {
  isOpen: boolean;
  submitting: boolean;
  error?: string | null;
  reasons?: ControlPlaneReason[];
  onCancel: () => void;
  onSubmit: (apiSecret: string) => void | Promise<void>;
}

/**
 * Masked, per-session exchange API secret prompt.
 *
 * SECURITY POSTURE — this is a security control, not an ordinary form:
 *  - The secret lives ONLY in this component's local state. It is never written to localStorage,
 *    sessionStorage, IndexedDB, cookies, the URL, a global store, a log, or the console.
 *  - It is cleared to "" immediately after the request resolves, success OR failure, and again on
 *    cancel/unmount, so it cannot be read back from component state.
 *  - `autoComplete` is disabled and the field is NOT autofocused, so a browser password manager is
 *    not invited to save or pre-fill it.
 */
export const ApiSecretModal: React.FC<ApiSecretModalProps> = ({
  isOpen,
  submitting,
  error,
  reasons,
  onCancel,
  onSubmit
}) => {
  const [apiSecret, setApiSecret] = useState<string>('');
  const [showSecret, setShowSecret] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = apiSecret;
    if (!value.trim() || submitting) return;
    try {
      await onSubmit(value);
    } finally {
      // The secret must not outlive the request. Clear it immediately after the promise settles,
      // success OR failure, so nothing can read it back from state.
      setApiSecret('');
    }
  };

  const handleCancel = () => {
    setApiSecret('');
    setShowSecret(false);
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 font-mono text-xs">
      <div className="bg-zinc-900 border border-amber-600/60 rounded-xl max-w-md w-full p-6 shadow-2xl text-slate-100">
        <div className="flex items-center gap-2.5 mb-3 text-amber-400">
          <Lock className="w-5 h-5" />
          <h3 className="font-extrabold text-base text-white">Exchange API Secret Required</h3>
        </div>

        <p className="text-xs text-slate-300 mb-3 leading-relaxed">
          This deployment requires the exchange API secret to be typed by hand for every armed session.
        </p>

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-3">
          <label
            htmlFor="gigpilot-runtime-api-secret"
            className="block text-[11px] font-semibold text-slate-300"
          >
            API Secret
          </label>
          <div className="relative">
            <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="gigpilot-runtime-api-secret"
              // Deliberately not a password-manager-friendly name, and no autoFocus below.
              name="gigpilot-runtime-api-secret"
              type={showSecret ? 'text' : 'password'}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              // Suppress browser autofill / credential save (see also autoComplete="off" on the form).
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-autocomplete="none"
              data-lpignore="true"
              data-1p-ignore="true"
              disabled={submitting}
              placeholder="Type the secret for this session only…"
              className="w-full pl-9 pr-10 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              title={showSecret ? 'Hide secret' : 'Show secret'}
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-200 text-[11px] flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{error}</div>
                {reasons && reasons.length > 0 && (
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-rose-300/90">
                    {reasons.map((r, i) => (
                      <li key={`${r.code || 'reason'}-${i}`}>
                        {r.message || r.detail || r.code || 'ARM blocked.'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-2.5 text-[11px] text-slate-400 leading-relaxed">
            The secret is held in engine memory for this session only and is never written to disk or
            stored in your browser. It is cleared the moment you disarm.
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="px-4 py-2 rounded text-slate-400 hover:bg-zinc-800 text-xs font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !apiSecret.trim()}
              className="px-5 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-950/60 disabled:opacity-50"
            >
              {submitting ? 'Arming…' : 'Confirm & Arm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
