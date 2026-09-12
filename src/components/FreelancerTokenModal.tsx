import React, { useState, useEffect } from 'react';
import {
  getFreelancerTokenDetails,
  testFreelancerTokenCandidate,
  updateFreelancerToken,
  FreelancerTokenDetails,
  FreelancerTokenTestResult
} from '../services/api';

export interface FreelancerTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTokenUpdated?: (username?: string) => void;
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const FreelancerTokenModal: React.FC<FreelancerTokenModalProps> = ({
  isOpen,
  onClose,
  onTokenUpdated,
  showToast
}) => {
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenDetails, setTokenDetails] = useState<FreelancerTokenDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<FreelancerTokenTestResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadDetails();
      setTestResult(null);
    }
  }, [isOpen]);

  const loadDetails = async () => {
    setIsLoading(true);
    try {
      const res = await getFreelancerTokenDetails();
      if (res.success && res.details) {
        setTokenDetails(res.details);
      }
    } catch (err: any) {
      console.warn('[FreelancerTokenModal] Load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestToken = async () => {
    const candidate = tokenInput.trim();
    if (!candidate) {
      if (showToast) showToast('Please enter a Freelancer API token to test.', 'warning');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testFreelancerTokenCandidate(candidate);
      setTestResult(result);
      if (result.valid) {
        if (showToast) showToast(`✓ Token verified for @${result.username} (${result.latencyMs}ms)!`, 'success');
      } else {
        if (showToast) showToast(`✕ Verification failed: ${result.message}`, 'error');
      }
    } catch (err: any) {
      setTestResult({
        valid: false,
        status: 'unverified',
        latencyMs: 0,
        message: err.message || 'Error testing token.'
      });
      if (showToast) showToast(err.message || 'Verification request failed.', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveToken = async () => {
    const candidate = tokenInput.trim();
    if (!candidate) {
      if (showToast) showToast('Please paste a valid Freelancer API token.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      const res = await updateFreelancerToken(candidate);
      if (res.success) {
        if (showToast) {
          showToast(res.message || 'Freelancer API token saved successfully!', 'success');
        }
        await loadDetails();
        setTokenInput('');
        setTestResult(null);
        if (onTokenUpdated) {
          onTokenUpdated(res.username);
        }
      } else {
        if (showToast) {
          showToast(`Failed to update token: ${res.error || res.message}`, 'error');
        }
      }
    } catch (err: any) {
      if (showToast) showToast(`Save error: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadDefaultSession = () => {
    setTokenInput('3PKsiB3m736mE0wnirnHeLTUzLP1xc');
    if (showToast) showToast('Loaded verified active session token (@kundank879)', 'info');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121624] border border-[#2a3147] rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-[#f0f3fa]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#20273a] flex items-center justify-between bg-[#161c2d]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <i className="fas fa-key text-base"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Freelancer API Token Configuration
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                  OAuth v0.1
                </span>
              </h2>
              <p className="text-xs text-[#8d98b8]">
                Update &amp; verify Personal Access Token for bids, lead feeds &amp; win telemetry.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8d98b8] hover:text-white p-2 rounded-lg hover:bg-[#20273a] transition-colors"
            title="Close modal"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 bg-[#0d101a]">
          
          {/* Active Status Card */}
          <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <i className="fas fa-signal text-cyan-400"></i>
                Current Active Connection
              </span>
              <span className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                tokenDetails?.status === 'valid'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}>
                {tokenDetails?.status === 'valid'
                  ? `● Active (@${tokenDetails.username || 'kundank879'})`
                  : '⚠ Unverified / Expired'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[#0d101a] p-2.5 rounded-lg border border-[#20273a]">
                <div className="text-[10px] text-[#8d98b8] uppercase font-semibold">User Profile</div>
                <div className="font-mono text-cyan-400 font-bold mt-0.5">
                  @{tokenDetails?.username || 'kundank879'}
                </div>
              </div>
              <div className="bg-[#0d101a] p-2.5 rounded-lg border border-[#20273a]">
                <div className="text-[10px] text-[#8d98b8] uppercase font-semibold">User ID</div>
                <div className="font-mono text-white font-bold mt-0.5">
                  {tokenDetails?.userId || 94426143}
                </div>
              </div>
            </div>

            {/* Masked Token Preview */}
            <div className="bg-[#0d101a] p-2.5 rounded-lg border border-[#20273a] flex items-center justify-between">
              <div className="overflow-hidden">
                <div className="text-[10px] text-[#8d98b8] uppercase font-semibold">Configured Token Preview</div>
                <div className="font-mono text-xs text-slate-300 truncate mt-0.5">
                  {isLoading ? 'Checking token...' : (tokenDetails?.maskedToken || 'None')}
                </div>
              </div>
              <button
                type="button"
                onClick={loadDetails}
                disabled={isLoading}
                title="Refresh Status from Freelancer API"
                className="text-xs text-blue-400 hover:text-blue-300 p-1.5 rounded hover:bg-slate-800 transition-colors shrink-0 ml-2"
              >
                <i className={`fas fa-sync-alt ${isLoading ? 'fa-spin' : ''}`}></i>
              </button>
            </div>
          </div>

          {/* Input New Token Form */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <i className="fas fa-edit text-blue-400"></i>
                Paste New Freelancer Token
              </label>
              <button
                type="button"
                onClick={handleLoadDefaultSession}
                className="text-[11px] text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors cursor-pointer"
              >
                Load Default (@kundank879)
              </button>
            </div>

            <div className="relative">
              <textarea
                rows={3}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Paste your Freelancer OAuth Personal Access Token (e.g. 3PKsiB3m736mE0wnirnHeLTUzLP1xc)"
                className="w-full bg-[#161c2d] border border-[#262f48] rounded-xl p-3 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 transition-colors pr-10"
              />
              {tokenInput && (
                <button
                  type="button"
                  onClick={() => setTokenInput('')}
                  className="absolute right-3 top-3 text-slate-400 hover:text-white text-xs"
                  title="Clear input"
                >
                  <i className="fas fa-times-circle"></i>
                </button>
              )}
            </div>

            {/* Test Result Feedback Box */}
            {testResult && (
              <div className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 animate-in fade-in duration-150 ${
                testResult.valid
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}>
                <i className={`fas ${testResult.valid ? 'fa-check-circle text-emerald-400' : 'fa-exclamation-triangle text-red-400'} mt-0.5`}></i>
                <div className="space-y-1 flex-1">
                  <div className="font-bold flex items-center justify-between">
                    <span>{testResult.valid ? 'Token Valid & Verified' : 'Verification Failed'}</span>
                    {testResult.latencyMs > 0 && (
                      <span className="font-mono text-[10px] opacity-80">{testResult.latencyMs}ms</span>
                    )}
                  </div>
                  <p className="text-[11px] opacity-90">{testResult.message}</p>
                  {testResult.username && (
                    <div className="font-mono text-[11px] font-semibold text-white">
                      Connected User: @{testResult.username} (ID: {testResult.userId})
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleTestToken}
                disabled={isTesting || !tokenInput.trim()}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all border border-slate-700 hover:border-slate-600 disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isTesting ? (
                  <>
                    <i className="fas fa-spinner fa-spin text-cyan-400"></i>
                    <span>Testing against Freelancer API...</span>
                  </>
                ) : (
                  <>
                    <i className="fas fa-vial text-cyan-400"></i>
                    <span>Test Connection</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSaveToken}
                disabled={isSaving || !tokenInput.trim()}
                className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-blue-500/20 disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Applying &amp; Updating Token...</span>
                  </>
                ) : (
                  <>
                    <i className="fas fa-check-circle"></i>
                    <span>Save &amp; Update Freelancer Token</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Guide & Official Portal Link */}
          <div className="p-3.5 rounded-xl bg-[#161c2d]/70 border border-[#20273a] text-xs space-y-2">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5">
              <i className="fas fa-info-circle text-blue-400"></i>
              How to obtain a Freelancer API Token
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 pl-1">
              <li>Log in to your account at <a href="https://accounts.freelancer.com/settings/develop" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300 font-medium">accounts.freelancer.com/settings/develop</a></li>
              <li>Create or select an Application with standard read/write scopes</li>
              <li>Copy the <strong>Personal Access Token</strong> and paste it into the field above</li>
            </ol>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#20273a] bg-[#161c2d] flex items-center justify-between text-xs text-[#8d98b8]">
          <div className="flex items-center gap-1.5">
            <i className="fas fa-shield-alt text-emerald-400"></i>
            <span>Secured locally &amp; hot-reloaded across runtime</span>
          </div>
          <button
            onClick={onClose}
            className="py-1.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium transition-colors"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};

export default FreelancerTokenModal;
