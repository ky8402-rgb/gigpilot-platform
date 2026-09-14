import React, { useState, useEffect } from 'react';
import {
  getFreelancerTokenDetails,
  testFreelancerTokenCandidate,
  updateFreelancerToken,
  getFreelancerOAuth2Config,
  saveFreelancerOAuth2Config,
  FreelancerTokenDetails,
  FreelancerTokenTestResult,
  FreelancerOAuth2Config
} from '../services/api';
import { freelancerOAuthService } from '../services/freelancer-oauth.service';

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
  // Tab state: 'bearer' (OAuth2 Personal Access Token) vs 'oauth2_flow' (OAuth2 Client App Flow)
  const [activeTab, setActiveTab] = useState<'bearer' | 'oauth2_flow'>('bearer');

  // Bearer token state
  const [tokenInput, setTokenInput] = useState('');
  const [tokenDetails, setTokenDetails] = useState<FreelancerTokenDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<FreelancerTokenTestResult | null>(null);

  // OAuth2 App Flow state
  const [oauthConfig, setOauthConfig] = useState<FreelancerOAuth2Config | null>(null);
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [redirectUriInput, setRedirectUriInput] = useState('');
  const [scopesInput, setScopesInput] = useState('basic profile projects');
  const [authCodeInput, setAuthCodeInput] = useState('');
  const [isSavingOAuthConfig, setIsSavingOAuthConfig] = useState(false);
  const [isExchangingCode, setIsExchangingCode] = useState(false);
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadAllData();
      setTestResult(null);

      // Check URL search parameters for OAuth code if returning from redirect
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code') || urlParams.get('freelancer_code');
        if (code) {
          setActiveTab('oauth2_flow');
          setAuthCodeInput(code);
        }
      } catch {}
    }
  }, [isOpen]);

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [tokenRes, oauthRes] = await Promise.all([
        getFreelancerTokenDetails(),
        getFreelancerOAuth2Config()
      ]);

      if (tokenRes.success && tokenRes.details) {
        setTokenDetails(tokenRes.details);
      }

      if (oauthRes.success && oauthRes.config) {
        const cfg = oauthRes.config;
        setOauthConfig(cfg);
        if (cfg.clientId) setClientIdInput(cfg.clientId);
        if (cfg.redirectUri) setRedirectUriInput(cfg.redirectUri);
        if (cfg.scopes) setScopesInput(cfg.scopes);
      }
    } catch (err: any) {
      console.warn('[FreelancerTokenModal] Data load error:', err);
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
        await loadAllData();
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

  const handleSaveOAuthConfig = async () => {
    if (!clientIdInput.trim()) {
      if (showToast) showToast('Please provide your Freelancer Client ID.', 'warning');
      return;
    }

    setIsSavingOAuthConfig(true);
    try {
      const res = await saveFreelancerOAuth2Config({
        clientId: clientIdInput.trim(),
        clientSecret: clientSecretInput.trim() || undefined,
        redirectUri: redirectUriInput.trim() || undefined,
        scopes: scopesInput.trim() || 'basic profile projects',
        authMode: 'oauth2_app'
      });

      if (res.success) {
        if (showToast) showToast('Freelancer OAuth2 app credentials saved!', 'success');
        if (res.config) setOauthConfig(res.config);
        setClientSecretInput('');
      } else {
        if (showToast) showToast(`Failed: ${res.error || res.message}`, 'error');
      }
    } catch (err: any) {
      if (showToast) showToast(`Error saving OAuth config: ${err.message}`, 'error');
    } finally {
      setIsSavingOAuthConfig(false);
    }
  };

  const handleLaunchAuthorize = async () => {
    if (!oauthConfig?.clientId) {
      if (showToast) showToast('Please save your Freelancer Client ID first.', 'warning');
      return;
    }

    try {
      // Generate secure authorization URL with CSRF state protection
      const authUrl = await freelancerOAuthService.generateAuthorizationUrl({
        clientId: oauthConfig.clientId,
        redirectUri: redirectUriInput.trim() || oauthConfig.redirectUri,
        scopes: oauthConfig.scopes,
      });

      // Open Freelancer OAuth2 consent window
      const width = 600;
      const height = 750;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      window.open(
        authUrl,
        'FreelancerOAuth2Authorize',
        `width=${width},height=${height},left=${left},top=${top},status=yes,scrollbars=yes`
      );

      if (showToast) {
        showToast('Opened Freelancer OAuth consent screen with CSRF state protection.', 'info');
      }
    } catch (err: any) {
      if (showToast) showToast(`Failed to generate authorization URL: ${err.message}`, 'error');
    }
  };

  const handleExchangeCode = async () => {
    const rawInput = authCodeInput.trim();
    if (!rawInput) {
      if (showToast) showToast('Please paste the authorization code.', 'warning');
      return;
    }

    // Extract code and optional state if pasted as a full callback URL (e.g. ?code=...&state=...)
    let code = rawInput;
    let state: string | undefined;

    if (rawInput.includes('code=')) {
      try {
        const urlObj = new URL(rawInput.startsWith('http') ? rawInput : `http://dummy.com${rawInput.startsWith('/') ? '' : '/'}${rawInput}`);
        code = urlObj.searchParams.get('code') || rawInput;
        state = urlObj.searchParams.get('state') || undefined;
      } catch (_) {}
    }

    setIsExchangingCode(true);
    try {
      const tokenData = await freelancerOAuthService.exchangeCodeForTokens(
        code,
        state,
        redirectUriInput.trim() || undefined
      );

      if (showToast) {
        showToast(
          `OAuth2 token exchanged! Connected as ${tokenData.username ? '@' + tokenData.username : 'verified user'}.`,
          'success'
        );
      }
      setAuthCodeInput('');
      await loadAllData();
      if (onTokenUpdated) onTokenUpdated(tokenData.username);
    } catch (err: any) {
      if (showToast) showToast(`Exchange failed: ${err.message}`, 'error');
    } finally {
      setIsExchangingCode(false);
    }
  };

  const handleRefreshToken = async () => {
    setIsRefreshingToken(true);
    try {
      const tokenData = await freelancerOAuthService.refreshToken();
      if (showToast) {
        showToast(`OAuth2 token silently refreshed (${tokenData.username || 'active'}).`, 'success');
      }
      await loadAllData();
      if (onTokenUpdated) onTokenUpdated(tokenData.username);
    } catch (err: any) {
      if (showToast) showToast(`Token refresh error: ${err.message}`, 'error');
    } finally {
      setIsRefreshingToken(false);
    }
  };

  const copyRedirectUri = () => {
    const uri = redirectUriInput || oauthConfig?.redirectUri || `${window.location.origin}/api/freelancer/oauth2/callback`;
    navigator.clipboard.writeText(uri);
    setCopiedRedirect(true);
    setTimeout(() => setCopiedRedirect(false), 2000);
    if (showToast) showToast('Redirect URI copied to clipboard!', 'info');
  };

  const handleOpenDeveloperPortal = () => {
    window.open('https://accounts.freelancer.com/settings/develop', '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121624] border border-[#2a3147] rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-[#f0f3fa]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#20273a] flex items-center justify-between bg-[#161c2d]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <i className="fas fa-key text-base"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                Freelancer API OAuth 2.0
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono font-semibold">
                  OAuth 2.0 Standard
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 border border-amber-500/20 font-mono">
                  Legacy v0.1 Deprecated
                </span>
              </h2>
              <p className="text-xs text-[#8d98b8]">
                Configure OAuth 2.0 Authorization Code Flows and Bearer Tokens for automated bidding.
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

        {/* Tab Selector */}
        <div className="flex border-b border-[#20273a] bg-[#141926] px-6 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('bearer')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'bearer'
                ? 'border-blue-500 text-blue-400 font-bold'
                : 'border-transparent text-[#8d98b8] hover:text-slate-200'
            }`}
          >
            <i className="fas fa-fingerprint"></i>
            OAuth2 Personal Access Token
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300">Fast</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('oauth2_flow')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'oauth2_flow'
                ? 'border-indigo-500 text-indigo-400 font-bold'
                : 'border-transparent text-[#8d98b8] hover:text-slate-200'
            }`}
          >
            <i className="fas fa-network-wired"></i>
            OAuth2 App &amp; Authorization Flow
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300">Client App</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 bg-[#0d101a]">
          
          {/* Active Connection Summary Card */}
          <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <i className="fas fa-signal text-cyan-400"></i>
                Active Connection Status
              </span>
              <span className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                tokenDetails?.status === 'valid'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}>
                {tokenDetails?.status === 'valid'
                  ? `● Verified (@${tokenDetails.username || 'kundank879'})`
                  : '⚠ Unverified / Token Expired'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-[#0d101a] p-2.5 rounded-lg border border-[#20273a]">
                <div className="text-[10px] text-[#8d98b8] uppercase font-semibold">User Profile</div>
                <div className="font-mono text-cyan-400 font-bold mt-0.5 truncate">
                  @{tokenDetails?.username || 'kundank879'}
                </div>
              </div>
              <div className="bg-[#0d101a] p-2.5 rounded-lg border border-[#20273a]">
                <div className="text-[10px] text-[#8d98b8] uppercase font-semibold">User ID</div>
                <div className="font-mono text-white font-bold mt-0.5">
                  {tokenDetails?.userId || 94426143}
                </div>
              </div>
              <div className="bg-[#0d101a] p-2.5 rounded-lg border border-[#20273a] col-span-2 sm:col-span-1">
                <div className="text-[10px] text-[#8d98b8] uppercase font-semibold">Token Mode</div>
                <div className="font-mono text-indigo-300 font-semibold mt-0.5 truncate">
                  {oauthConfig?.authMode === 'oauth2_app' ? 'OAuth2 App Flow' : 'OAuth2 Bearer Token'}
                </div>
              </div>
            </div>

            {/* Masked Token Preview */}
            <div className="bg-[#0d101a] p-2.5 rounded-lg border border-[#20273a] flex items-center justify-between">
              <div className="overflow-hidden">
                <div className="text-[10px] text-[#8d98b8] uppercase font-semibold">Active Token Preview</div>
                <div className="font-mono text-xs text-slate-300 truncate mt-0.5">
                  {isLoading ? 'Checking token...' : (tokenDetails?.maskedToken || 'None')}
                </div>
              </div>
              <button
                type="button"
                onClick={loadAllData}
                disabled={isLoading}
                title="Refresh Status from Freelancer API"
                className="text-xs text-blue-400 hover:text-blue-300 p-1.5 rounded hover:bg-slate-800 transition-colors shrink-0 ml-2"
              >
                <i className={`fas fa-sync-alt ${isLoading ? 'fa-spin' : ''}`}></i>
              </button>
            </div>
          </div>

          {/* TAB 1: OAuth2 Personal Access Token (Direct) */}
          {activeTab === 'bearer' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <i className="fas fa-edit text-blue-400"></i>
                    Paste OAuth2 Bearer Token
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenDeveloperPortal}
                    className="text-[11px] text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <span>Get Token from Developer Portal</span>
                    <i className="fas fa-external-link-alt text-[9px]"></i>
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    rows={3}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="Paste your official Freelancer OAuth2 Personal Access Token from accounts.freelancer.com/settings/develop"
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

                {!tokenInput && (
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                    <button
                      type="button"
                      onClick={() => setTokenInput('hqR3kujm33mk4eR5zjmzsHRsrqs3s2')}
                      className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition-colors cursor-pointer font-medium"
                    >
                      <i className="fas fa-bolt text-amber-400"></i>
                      <span>Quick-Fill Active Token (<span className="font-mono text-[10px]">hqR3...3s2</span>)</span>
                    </button>
                    <span className="text-slate-500 hidden sm:inline">Official Freelancer Personal Token</span>
                  </div>
                )}

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
                        <span>Save &amp; Activate Token</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Instructions */}
              <div className="p-3.5 rounded-xl bg-[#161c2d]/70 border border-[#20273a] text-xs space-y-2">
                <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <i className="fas fa-info-circle text-blue-400"></i>
                  Where to find your Personal Access Token
                </div>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 pl-1">
                  <li>Navigate to <a href="https://accounts.freelancer.com/settings/develop" target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300 font-medium">accounts.freelancer.com/settings/develop</a></li>
                  <li>Click on your registered Application or create a new Developer App</li>
                  <li>Copy your <strong>Personal Access Token</strong> and paste it into the field above</li>
                </ol>
                <div className="pt-1.5 border-t border-[#20273a] text-[11px] text-emerald-400/90 flex items-center gap-1.5">
                  <i className="fas fa-shield-alt text-emerald-400"></i>
                  <span><strong>Automatic Status:</strong> Personal Access Tokens are permanent. You do <strong>not</strong> need a <code>FREELANCER_REFRESH_TOKEN</code> secret value.</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OAuth2 Client App & Authorization Code Flow */}
          {activeTab === 'oauth2_flow' && (
            <div className="space-y-4">
              
              {/* Credentials Form */}
              <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] space-y-3">
                <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <i className="fas fa-cog text-indigo-400"></i>
                  OAuth2 App Credentials (Freelancer Developer Portal)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[11px] text-[#8d98b8] mb-1 font-semibold">
                      Client ID (App ID)
                    </label>
                    <input
                      type="text"
                      value={clientIdInput}
                      onChange={(e) => setClientIdInput(e.target.value)}
                      placeholder="e.g. 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"
                      className="w-full bg-[#0d101a] border border-[#20273a] rounded-lg p-2.5 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#8d98b8] mb-1 font-semibold flex items-center justify-between">
                      <span>Client Secret</span>
                      {oauthConfig?.clientSecretConfigured && (
                        <span className="text-[10px] text-emerald-400 font-normal">● Saved in env</span>
                      )}
                    </label>
                    <input
                      type="password"
                      value={clientSecretInput}
                      onChange={(e) => setClientSecretInput(e.target.value)}
                      placeholder={oauthConfig?.clientSecretConfigured ? '•••••••••••••••• (Leave blank to keep current)' : 'Paste client secret'}
                      className="w-full bg-[#0d101a] border border-[#20273a] rounded-lg p-2.5 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-[#8d98b8] font-semibold">
                        OAuth2 Redirect URI (Add this to your Freelancer App Settings)
                      </label>
                      <button
                        type="button"
                        onClick={copyRedirectUri}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                      >
                        <i className={`fas ${copiedRedirect ? 'fa-check text-emerald-400' : 'fa-copy'}`}></i>
                        {copiedRedirect ? 'Copied!' : 'Copy URI'}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={redirectUriInput}
                      onChange={(e) => setRedirectUriInput(e.target.value)}
                      placeholder="https://3-222-149-9.sslip.io/api/freelancer/oauth2/callback"
                      className="w-full bg-[#0d101a] border border-[#20273a] rounded-lg p-2.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-[#8d98b8] mb-1 font-semibold">
                      OAuth Scopes
                    </label>
                    <input
                      type="text"
                      value={scopesInput}
                      onChange={(e) => setScopesInput(e.target.value)}
                      placeholder="basic profile projects"
                      className="w-full bg-[#0d101a] border border-[#20273a] rounded-lg p-2.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleSaveOAuthConfig}
                    disabled={isSavingOAuthConfig || !clientIdInput.trim()}
                    className="py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all disabled:opacity-40 flex items-center gap-2 cursor-pointer"
                  >
                    {isSavingOAuthConfig ? (
                      <>
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Saving Credentials...</span>
                      </>
                    ) : (
                      <>
                        <i className="fas fa-save"></i>
                        <span>Save App Credentials</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Step 2: Launch Authorization Screen */}
              <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] space-y-3">
                <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <i className="fas fa-external-link-alt text-blue-400"></i>
                  Step 1: Authorize on Freelancer.com
                </div>
                <p className="text-xs text-[#8d98b8]">
                  Click the button below to open the official Freelancer consent dialog. Upon approving, you will be redirected to your configured Redirect URI with an authorization code.
                </p>

                <button
                  type="button"
                  onClick={handleLaunchAuthorize}
                  disabled={!clientIdInput.trim()}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-blue-500/20 disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fas fa-shield-alt"></i>
                  <span>Launch Freelancer OAuth2 Consent Screen</span>
                </button>
              </div>

              {/* Step 3: Exchange Authorization Code */}
              <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] space-y-3">
                <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <i className="fas fa-exchange-alt text-emerald-400"></i>
                  Step 2: Exchange Authorization Code for Tokens
                </div>
                <p className="text-xs text-[#8d98b8]">
                  Paste the <code className="text-indigo-300 font-mono">code</code> parameter from your redirect URL to complete the token exchange:
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={authCodeInput}
                    onChange={(e) => setAuthCodeInput(e.target.value)}
                    placeholder="Paste ?code=... string here"
                    className="flex-1 bg-[#0d101a] border border-[#20273a] rounded-xl p-2.5 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleExchangeCode}
                    disabled={isExchangingCode || !authCodeInput.trim()}
                    className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all disabled:opacity-40 flex items-center gap-2 cursor-pointer"
                  >
                    {isExchangingCode ? (
                      <>
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Exchanging...</span>
                      </>
                    ) : (
                      <>
                        <i className="fas fa-arrow-right"></i>
                        <span>Exchange Code</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Step 4: Refresh Token Status */}
              <div className="p-4 rounded-xl bg-[#161c2d] border border-[#262f48] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <i className="fas fa-sync text-cyan-400"></i>
                    OAuth2 Token Rotation &amp; Refresh
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    oauthConfig?.authMode === 'personal_token' || oauthConfig?.hasRefreshToken
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-slate-700/30 border-slate-600 text-slate-400'
                  }`}>
                    {oauthConfig?.authMode === 'personal_token'
                      ? '● Permanent Token (No Refresh Needed)'
                      : oauthConfig?.hasRefreshToken
                      ? '● Refresh Token Available'
                      : 'No Refresh Token'}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="text-[11px] text-[#8d98b8]">
                    {oauthConfig?.authMode === 'personal_token' ? (
                      <span className="text-emerald-400/90 font-medium">Personal Access Token is active &amp; permanent; FREELANCER_REFRESH_TOKEN is not required.</span>
                    ) : oauthConfig?.expiresAt ? (
                      <span>Expires: {new Date(oauthConfig.expiresAt).toLocaleTimeString()}</span>
                    ) : (
                      <span>Auto-refreshes tokens before expiration</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshToken}
                    disabled={isRefreshingToken}
                    className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all border border-slate-700 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
                  >
                    <i className={`fas fa-sync-alt ${isRefreshingToken ? 'fa-spin text-cyan-400' : ''}`}></i>
                    <span>{isRefreshingToken ? 'Verifying...' : oauthConfig?.authMode === 'personal_token' ? 'Verify Active Token' : 'Rotate Token Now'}</span>
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#20273a] bg-[#161c2d] flex items-center justify-between text-xs text-[#8d98b8]">
          <div className="flex items-center gap-1.5">
            <i className="fas fa-shield-alt text-emerald-400"></i>
            <span>Encrypted locally &amp; hot-reloaded across EC2 and Amplify</span>
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
