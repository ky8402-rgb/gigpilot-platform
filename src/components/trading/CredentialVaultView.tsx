import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyRound, Lock, ShieldAlert, ShieldCheck, Eye, EyeOff, Wallet, ExternalLink,
  RefreshCw, Trash2, AlertTriangle, Loader2
} from 'lucide-react';
import {
  fetchCredentialVault,
  storeExchangeCredentials,
  setWithdrawalAddress,
  clearWithdrawalAddress,
  CredentialVaultStatus,
  StoreCredentialsResult,
  WithdrawalAddressResult,
  VaultExchangeStatus
} from '../../services/tradingService';

/**
 * CREDENTIAL VAULT — owner-only entry of exchange API credentials and the withdrawal allowlist.
 *
 * SECURITY POSTURE. This view handles live exchange secrets, so it is written as a control, not as
 * a form:
 *  - Key and secret live ONLY in this component's local state. They are never written to
 *    durable browser storage, session storage, IndexedDB, cookies, the URL, a global store, a log, or the
 *    console.
 *  - Both are cleared to "" immediately after the request settles, success OR failure, so nothing
 *    can read them back out of state afterwards.
 *  - Neither field is autofocused, and both opt out of password-manager capture, so a browser does
 *    not offer to save a live trading credential.
 *  - Nothing is persisted server-side either: the backend keeps them in process memory and they are
 *    gone on restart. The UI states that plainly rather than implying a durable vault.
 *  - The withdrawal destination is an ALLOWLIST record. There is no button here that moves money,
 *    because there is no endpoint that moves money.
 */

const NETWORKS = ['TRC20', 'ERC20', 'BEP20', 'ARBITRUM', 'OPTIMISM', 'POLYGON', 'BASE', 'SOL'];

interface CredentialVaultViewProps {
  isOwnerAuth: boolean;
  onRequireAuth: () => void;
}

const notAutofillable = {
  autoComplete: 'new-password',
  autoCapitalize: 'off' as const,
  autoCorrect: 'off' as const,
  spellCheck: false,
  'aria-autocomplete': 'none' as const,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true'
};

const Chip: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
      ok
        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
        : 'bg-slate-900 border-slate-700 text-slate-400'
    }`}
  >
    {ok ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
    {label}
  </span>
);

export const CredentialVaultView: React.FC<CredentialVaultViewProps> = ({
  isOwnerAuth,
  onRequireAuth
}) => {
  const [vault, setVault] = useState<CredentialVaultStatus | null>(null);
  const [loadingVault, setLoadingVault] = useState<boolean>(false);
  const [vaultError, setVaultError] = useState<string | null>(null);

  const [exchange, setExchange] = useState<string>('bybit');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiSecret, setApiSecret] = useState<string>('');
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<StoreCredentialsResult | null>(null);

  const [network, setNetwork] = useState<string>('TRC20');
  const [address, setAddress] = useState<string>('');
  const [addressLabel, setAddressLabel] = useState<string>('');
  const [confirmation, setConfirmation] = useState<string>('');
  const [savingAddress, setSavingAddress] = useState<boolean>(false);
  const [addressResult, setAddressResult] = useState<WithdrawalAddressResult | null>(null);

  const loadVault = useCallback(async () => {
    if (!isOwnerAuth) return;
    setLoadingVault(true);
    setVaultError(null);
    try {
      setVault(await fetchCredentialVault());
    } catch (err: any) {
      setVaultError(err?.message || 'Could not read the credential vault.');
    } finally {
      setLoadingVault(false);
    }
  }, [isOwnerAuth]);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  const handleSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const key = apiKey;
    const secret = apiSecret;
    if (!key.trim() || !secret.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await storeExchangeCredentials(exchange, key, secret);
      setResult(res);
      if (res.success) void loadVault();
    } finally {
      // The credentials must not outlive the request. Cleared in `finally` so they are wiped on
      // success AND on a thrown error, and never left behind for a later render to expose.
      setApiKey('');
      setApiSecret('');
      setShowSecret(false);
      setSubmitting(false);
    }
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingAddress) return;
    setSavingAddress(true);
    setAddressResult(null);
    try {
      const res = await setWithdrawalAddress(exchange, network, address, confirmation, addressLabel);
      setAddressResult(res);
      if (res.success) {
        setConfirmation('');
        setAddress('');
        void loadVault();
      }
    } finally {
      setSavingAddress(false);
    }
  };

  const handleClearAddress = async () => {
    setSavingAddress(true);
    setAddressResult(null);
    try {
      const res = await clearWithdrawalAddress(exchange);
      setAddressResult(res);
      void loadVault();
    } finally {
      setSavingAddress(false);
    }
  };

  if (!isOwnerAuth) {
    return (
      <div className="p-6 font-mono text-xs">
        <div className="max-w-xl mx-auto bg-zinc-900 border border-amber-700/50 rounded-xl p-6 text-center">
          <Lock className="w-6 h-6 text-amber-400 mx-auto mb-3" />
          <h3 className="text-white font-extrabold text-sm mb-2">Owner authentication required</h3>
          <p className="text-slate-400 leading-relaxed mb-4">
            Exchange credentials and the withdrawal allowlist are owner-only. They are not readable,
            and not writable, from an unauthenticated session.
          </p>
          <button
            onClick={onRequireAuth}
            className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider"
          >
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  const current: VaultExchangeStatus | undefined = vault?.exchanges?.[exchange];
  const saved = vault?.withdrawalAddresses?.[exchange];
  const phrase = vault?.withdrawalConfirmationPhrase || 'CONFIRM-WITHDRAWAL-ADDRESS';

  return (
    <div className="p-4 md:p-6 font-mono text-xs text-slate-200 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-white font-extrabold text-base flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-400" /> Credential Vault
          </h2>
          <p className="text-slate-400 mt-1 leading-relaxed max-w-2xl">
            Load exchange credentials into engine memory and record where profit is allowed to go.
            Credentials are held <span className="text-amber-300 font-semibold">in memory only</span> —
            never written to disk, never backed up, and gone on restart. A key with withdrawal
            permission is refused at arming.
          </p>
        </div>
        <button
          onClick={() => void loadVault()}
          disabled={loadingVault}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        >
          {loadingVault ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {vaultError && (
        <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-200 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div>{vaultError}</div>
        </div>
      )}

      {/* ---------------------------------------------------------------- exchange tabs */}
      <div className="flex gap-2">
        {Object.entries(vault?.exchanges || { bybit: undefined as any, binance: undefined as any })
          .filter(([k]) => k === 'bybit' || k === 'binance')
          .map(([name, spec]) => (
            <button
              key={name}
              onClick={() => {
                setExchange(name);
                setResult(null);
                setAddressResult(null);
              }}
              className={`px-4 py-2 rounded-lg border font-bold uppercase tracking-wider text-[11px] ${
                exchange === name
                  ? 'bg-amber-600/20 border-amber-600 text-amber-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {spec?.label || name}
            </button>
          ))}
      </div>

      {/* ---------------------------------------------------------------- credentials */}
      <div className="bg-zinc-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-white font-bold text-[13px]">
            {current?.label || exchange} API credentials
          </h3>
          <div className="flex gap-2">
            <Chip ok={!!current?.keyLoaded} label={current?.keyLoaded ? 'Key loaded' : 'No key'} />
            <Chip ok={!!current?.secretLoaded} label={current?.secretLoaded ? 'Secret loaded' : 'No secret'} />
            <Chip ok={!!current?.ready} label={current?.ready ? 'Ready' : 'Not ready'} />
          </div>
        </div>

        {current && (
          <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 leading-relaxed text-slate-400">
            <div>
              Permissions required:{' '}
              <span className="text-emerald-300">{current.requiredPermissions}</span>
            </div>
            <div>
              Permissions that must stay OFF:{' '}
              <span className="text-rose-300">{current.forbiddenPermissions}</span>
            </div>
            <a
              href={current.keyConsoleUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-amber-400 hover:text-amber-300 mt-2"
            >
              Open {current.label} API management <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        <form onSubmit={handleSubmitCredentials} autoComplete="off" className="space-y-3">
          <div>
            <label htmlFor="vault-api-key" className="block text-[11px] font-semibold text-slate-300 mb-1">
              API Key
            </label>
            <input
              id="vault-api-key"
              name="gigpilot-vault-api-key"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              {...notAutofillable}
              disabled={submitting}
              placeholder="Paste the API key…"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor="vault-api-secret" className="block text-[11px] font-semibold text-slate-300 mb-1">
              API Secret
            </label>
            <div className="relative">
              <input
                id="vault-api-secret"
                name="gigpilot-vault-api-secret"
                type={showSecret ? 'text' : 'password'}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                {...notAutofillable}
                disabled={submitting}
                placeholder="Paste the API secret…"
                className="w-full pl-3 pr-10 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={showSecret ? 'Hide secret' : 'Show secret'}
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {result && !result.success && (
            <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{result.error || 'Rejected'}</div>
                {result.message && <div className="text-rose-300/90 mt-0.5">{result.message}</div>}
              </div>
            </div>
          )}

          {result?.success && result.verification && (
            <div
              className={`p-2.5 rounded-lg border flex items-start gap-2 ${
                result.verification.attempted && result.verification.ok
                  ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
                  : result.verification.withdrawalPermissionRefused
                    ? 'bg-rose-950/60 border-rose-800 text-rose-200'
                    : 'bg-amber-950/50 border-amber-800 text-amber-200'
              }`}
            >
              {result.verification.withdrawalPermissionRefused ? (
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              ) : result.verification.ok ? (
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-semibold">
                  {result.verification.withdrawalPermissionRefused
                    ? 'REFUSED — this key can withdraw.'
                    : result.verification.ok
                      ? 'Loaded and verified.'
                      : 'Loaded, but not verified.'}
                </div>
                <div className="mt-0.5 opacity-90">{result.verification.message}</div>
                {result.verification.withdrawalPermissionRefused && (
                  <div className="mt-1.5">
                    Remove the withdrawal permission at the exchange and load the key again. Trading
                    stays blocked while this key is in use.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
            <span className="text-[11px] text-slate-500 leading-relaxed max-w-md">
              Never stored in your browser, and never written to the server's disk. Cleared the moment
              you submit.
            </span>
            <button
              type="submit"
              disabled={submitting || !apiKey.trim() || !apiSecret.trim()}
              className="px-5 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold uppercase tracking-wider shadow-lg shadow-amber-950/60 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {submitting ? 'Loading…' : 'Load into memory'}
            </button>
          </div>
        </form>
      </div>

      {/* ---------------------------------------------------------------- withdrawal allowlist */}
      <div className="bg-zinc-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-2">
          <Wallet className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-white font-bold text-[13px]">Profit withdrawal destination</h3>
            <p className="text-slate-400 mt-1 leading-relaxed max-w-2xl">
              The single address profit may be withdrawn to. This records a destination — it does not
              move funds, and no button here can. Changing it is the highest-risk action in the
              product, so it requires typing the confirmation phrase.
            </p>
          </div>
        </div>

        {saved ? (
          <div className="rounded-lg bg-slate-950/80 border border-emerald-900/60 p-3 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Allowlisted</div>
              <div className="text-emerald-300 break-all font-semibold">{saved.address}</div>
              <div className="text-slate-500 mt-1">
                {saved.network}
                {saved.label ? ` · ${saved.label}` : ''}
              </div>
            </div>
            <button
              onClick={() => void handleClearAddress()}
              disabled={savingAddress}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-rose-900/60 border border-slate-700 text-slate-300 font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
          </div>
        ) : (
          <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 text-slate-500">
            No destination set for {current?.label || exchange}. With nothing allowlisted, no
            withdrawal can be addressed.
          </div>
        )}

        <form onSubmit={handleSaveAddress} autoComplete="off" className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="vault-net" className="block text-[11px] font-semibold text-slate-300 mb-1">
                Network
              </label>
              <select
                id="vault-net"
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                disabled={savingAddress}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
              >
                {NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="vault-label" className="block text-[11px] font-semibold text-slate-300 mb-1">
                Label (optional)
              </label>
              <input
                id="vault-label"
                type="text"
                value={addressLabel}
                onChange={(e) => setAddressLabel(e.target.value)}
                disabled={savingAddress}
                placeholder="e.g. cold storage"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="vault-addr" className="block text-[11px] font-semibold text-slate-300 mb-1">
              Address
            </label>
            <input
              id="vault-addr"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              {...notAutofillable}
              disabled={savingAddress}
              placeholder={network === 'TRC20' ? 'T…' : network === 'SOL' ? 'Base58…' : '0x…'}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
            />
            <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              Verified before it is stored: Tron addresses are Base58Check-checked, so one mistyped
              character is rejected. EVM addresses must be all-lowercase — a mixed-case address claims
              an EIP-55 checksum this deployment cannot verify, so it is refused rather than trusted.
            </div>
          </div>

          <div>
            <label htmlFor="vault-confirm" className="block text-[11px] font-semibold text-slate-300 mb-1">
              Type <span className="text-amber-300">{phrase}</span> to confirm
            </label>
            <input
              id="vault-confirm"
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              {...notAutofillable}
              disabled={savingAddress}
              placeholder={phrase}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          {addressResult && (
            <div
              className={`p-2.5 rounded-lg border flex items-start gap-2 ${
                addressResult.success
                  ? 'bg-emerald-950/50 border-emerald-800 text-emerald-200'
                  : 'bg-rose-950/60 border-rose-800 text-rose-200'
              }`}
            >
              {addressResult.success ? (
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-semibold">
                  {addressResult.success ? 'Destination saved.' : addressResult.error || 'Rejected'}
                </div>
                {addressResult.message && <div className="mt-0.5 opacity-90">{addressResult.message}</div>}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-slate-500 leading-relaxed max-w-md">
              Withdrawal execution is not enabled in this build. This is a destination record.
            </span>
            <button
              type="submit"
              disabled={savingAddress || !address.trim() || confirmation.trim() !== phrase}
              className="px-5 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold uppercase tracking-wider shadow-lg shadow-amber-950/60 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {savingAddress && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save destination
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
