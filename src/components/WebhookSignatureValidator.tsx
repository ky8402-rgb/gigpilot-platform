import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Zap,
  Lock,
  Code2,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Terminal,
  FileCode,
  Sliders,
  Play,
  RotateCcw,
  Clock,
  ExternalLink
} from 'lucide-react';
import { JsonBeautifier } from './JsonBeautifier';
import {
  ActivityLogItem,
  fetchWebhookSecretConfig,
  updateWebhookSecret,
  verifyWebhookSignatureAPI,
  generateWebhookSignatureAPI,
  computeClientHmacSha256,
  SignatureVerificationResult
} from '../services/api';

interface WebhookSignatureValidatorProps {
  initialPayload?: any;
  initialSignature?: string;
  initialHeaderName?: string;
  recentLogs?: ActivityLogItem[];
  activeSecret?: string;
  onSecretChanged?: (newSecret: string) => void;
  onSecretUpdated?: (newSecret?: string) => void;
  isModal?: boolean;
  onClose?: () => void;
}

const PRESET_PAYLOADS = [
  {
    label: 'Upwork Job Ingestion Webhook',
    platform: 'Upwork',
    headerName: 'x-upwork-signature',
    format: 'prefix_sha256' as const,
    payload: {
      event_type: 'job_posted',
      delivery_id: 'del_upw_882910',
      timestamp: new Date().toISOString(),
      data: {
        id: 'upw_984102',
        title: 'Full-Stack React & Node.js Dashboard for AI Video SaaS',
        budget: 650,
        category: 'Web Development',
        client_name: 'Loomi AI Labs',
        client_country: 'United States',
        skills: ['React', 'TypeScript', 'Node.js', 'Tailwind CSS']
      }
    }
  },
  {
    label: 'Freelancer Project Milestone Webhook',
    platform: 'Freelancer',
    headerName: 'x-freelancer-signature',
    format: 'prefix_sha256' as const,
    payload: {
      event: 'project_created',
      time_updated: Math.floor(Date.now() / 1000),
      project: {
        id: 'fl_proj_772183',
        title: 'Python Scraper & Real-Time Telegram Alert Bot',
        amount: 320,
        budget: { minimum: 250, maximum: 320 },
        employer: { username: 'QuantX Media', country: 'Germany' },
        skills: [{ name: 'Python' }, { name: 'FastAPI' }, { name: 'Telegram API' }]
      }
    }
  },
  {
    label: 'PayPal Payment Capture Webhook',
    platform: 'PayPal Gateway',
    headerName: 'paypal-transmission-sig',
    format: 'prefix_sha256' as const,
    payload: {
      id: 'WH-89421098',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      create_time: new Date().toISOString(),
      resource: {
        id: 'CAP-88301829',
        amount: {
          value: '750.00',
          currency_code: 'USD'
        },
        status: 'COMPLETED',
        payer: {
          email_address: 'client@novasphere.tech',
          name: { given_name: 'Alex', surname: 'Morgan' }
        }
      }
    }
  },
  {
    label: 'RemoteOK Job Alert Ingestion',
    platform: 'RemoteOK',
    headerName: 'x-webhook-signature',
    format: 'prefix_sha256' as const,
    payload: {
      event: 'job_alert',
      source: 'RemoteOK API',
      job_id: 'rok_9921',
      title: 'Autonomous Full-Stack AI Engineer',
      salary_usd: 120000,
      tags: ['React', 'TypeScript', 'Node.js', 'AI']
    }
  }
];

export const WebhookSignatureValidator: React.FC<WebhookSignatureValidatorProps> = ({
  initialPayload,
  initialSignature,
  recentLogs = [],
  activeSecret,
  onSecretChanged,
  onSecretUpdated,
  isModal = false,
  onClose
}) => {
  // Webhook Secret State
  const [webhookSecret, setWebhookSecret] = useState<string>(activeSecret || 'whsec_kundanvision_live_secure_key_8f9d023b');
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [secretSaving, setSecretSaving] = useState<boolean>(false);
  const [secretSavedFeedback, setSecretSavedFeedback] = useState<string | null>(null);

  // Validation Form State
  const [rawPayloadInput, setRawPayloadInput] = useState<string>(() => {
    if (initialPayload) {
      return typeof initialPayload === 'string' ? initialPayload : JSON.stringify(initialPayload, null, 2);
    }
    return JSON.stringify(PRESET_PAYLOADS[0].payload, null, 2);
  });

  const [signatureHeader, setSignatureHeader] = useState<string>('x-webhook-signature');
  const [signatureFormat, setSignatureFormat] = useState<'prefix_sha256' | 'raw_hex' | 'timestamped_v1' | 'base64'>('prefix_sha256');
  const [providedSignature, setProvidedSignature] = useState<string>(initialSignature || '');
  const [computedSignature, setComputedSignature] = useState<string>('');
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<SignatureVerificationResult | null>(null);

  // Active sub-tab in validator: 'tester' | 'snippets' | 'security_audit'
  const [activeTab, setActiveTab] = useState<'tester' | 'snippets' | 'security_audit'>('tester');
  const [codeLanguage, setCodeLanguage] = useState<'node' | 'python' | 'go'>('node');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Load active secret from localStorage or API
  useEffect(() => {
    const local = localStorage.getItem('kundanvision_webhook_secret');
    if (local) {
      setWebhookSecret(local);
    } else {
      fetchWebhookSecretConfig().then(cfg => {
        if (cfg && cfg.secret) {
          setWebhookSecret(cfg.secret);
          localStorage.setItem('kundanvision_webhook_secret', cfg.secret);
        }
      });
    }
  }, []);

  // Update secret
  const handleSaveSecret = async () => {
    setSecretSaving(true);
    setSecretSavedFeedback(null);
    try {
      localStorage.setItem('kundanvision_webhook_secret', webhookSecret);
      await updateWebhookSecret(webhookSecret);
      if (onSecretChanged) onSecretChanged(webhookSecret);
      if (onSecretUpdated) onSecretUpdated(webhookSecret);
      setSecretSavedFeedback('✓ Webhook Secret saved & synced to active runtime!');
      setTimeout(() => setSecretSavedFeedback(null), 3000);
    } catch (e: any) {
      setSecretSavedFeedback(`Error: ${e.message}`);
    } finally {
      setSecretSaving(false);
    }
  };

  // Generate high-entropy secret
  const handleGenerateSecret = () => {
    const randomArray = new Uint8Array(24);
    window.crypto.getRandomValues(randomArray);
    const hex = Array.from(randomArray).map(b => b.toString(16).padStart(2, '0')).join('');
    const newSec = `whsec_${hex}`;
    setWebhookSecret(newSec);
    setSecretSavedFeedback('✓ Generated 48-char secure cryptographic secret. Click "Save & Sync" to apply.');
  };

  // Auto-generate valid signature for current payload
  const handleGenerateValidSignature = async () => {
    try {
      let parsedPayload: any;
      try {
        parsedPayload = JSON.parse(rawPayloadInput);
      } catch {
        parsedPayload = rawPayloadInput;
      }
      const res = await generateWebhookSignatureAPI({
        payload: parsedPayload,
        secret: webhookSecret,
        format: signatureFormat
      });
      if (res.success) {
        setProvidedSignature(res.signature);
        setComputedSignature(res.rawHex);
      }
    } catch (err) {
      console.error('Failed to generate signature:', err);
    }
  };

  // Verify Signature
  const handleVerify = async () => {
    setVerifying(true);
    try {
      let parsedPayload: any;
      try {
        parsedPayload = JSON.parse(rawPayloadInput);
      } catch {
        parsedPayload = rawPayloadInput;
      }

      const res = await verifyWebhookSignatureAPI({
        payload: parsedPayload,
        secret: webhookSecret,
        signature: providedSignature,
        headerName: signatureHeader
      });

      if (res.success) {
        setVerificationResult(res.verification);
        setComputedSignature(res.verification.computedSignature);
      }
    } catch (err: any) {
      console.error('Failed to verify:', err);
    } finally {
      setVerifying(false);
    }
  };

  // Run initial generation/verification
  useEffect(() => {
    if (initialSignature) {
      setProvidedSignature(initialSignature);
      handleVerify();
    } else {
      handleGenerateValidSignature();
    }
  }, [rawPayloadInput, webhookSecret, signatureFormat]);

  // cURL generator with authentic signature
  const curlExample = useMemo(() => {
    const host = window.location.origin || 'http://localhost:3000';
    let cleanJson = rawPayloadInput;
    try {
      cleanJson = JSON.stringify(JSON.parse(rawPayloadInput));
    } catch {}
    
    return `curl -X POST "${host}/api/webhooks/upwork" \\
  -H "Content-Type: application/json" \\
  -H "${signatureHeader}: ${providedSignature || 'sha256=...'}" \\
  -d '${cleanJson.replace(/'/g, "'\\''")}'`;
  }, [rawPayloadInput, signatureHeader, providedSignature]);

  return (
    <div className={`flex flex-col bg-slate-900 text-slate-100 rounded-xl border border-slate-800 shadow-2xl overflow-hidden ${isModal ? 'max-h-[90vh]' : 'w-full'}`}>
      {/* Header Bar */}
      <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base text-slate-100">Webhook Security & Signature Validator</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-950/80 border border-emerald-500/40 text-emerald-400">
                HMAC-SHA256
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Configure your incoming webhook secret & verify cryptographic authenticity
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTab('tester')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'tester'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Validator & Tester
            </button>
            <button
              onClick={() => setActiveTab('snippets')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'snippets'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Verification Code
            </button>
            <button
              onClick={() => setActiveTab('security_audit')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'security_audit'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Security Specs
            </button>
          </div>

          {isModal && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Secret Configuration Bar */}
      <div className="p-4 bg-slate-950/40 border-b border-slate-800/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1 max-w-2xl">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-1.5">
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>Active Webhook Secret Key</span>
              <span className="text-[10px] text-slate-500 font-normal">(Shared HMAC Secret for signature validation)</span>
            </label>
            <div className="relative flex items-center">
              <input
                type={showSecret ? 'text' : 'password'}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="whsec_..."
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-3 pr-28 py-2 text-xs font-mono text-emerald-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
              <div className="absolute right-1.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  title={showSecret ? 'Hide secret' : 'Show secret'}
                  className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
                >
                  {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy(webhookSecret, 'secret')}
                  title="Copy secret"
                  className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
                >
                  {copiedKey === 'secret' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              onClick={handleGenerateSecret}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-300 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/30 rounded-lg transition-colors"
              title="Generate new 48-char random secret"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Generate Random</span>
            </button>
            <button
              onClick={handleSaveSecret}
              disabled={secretSaving}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-sm shadow-emerald-950 transition-all disabled:opacity-50"
            >
              {secretSaving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
              <span>Save & Sync</span>
            </button>
          </div>
        </div>

        {secretSavedFeedback && (
          <div className="mt-2 text-xs text-emerald-400 flex items-center gap-1.5 animate-fadeIn">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{secretSavedFeedback}</span>
          </div>
        )}
      </div>

      {/* Main Content Areas */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'tester' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Column: Payload & Controls (7 cols) */}
            <div className="lg:col-span-7 flex flex-col space-y-4">
              {/* Presets & Recent Loader */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-400">Load Template:</span>
                  <select
                    onChange={(e) => {
                      const idx = parseInt(e.target.value, 10);
                      if (!isNaN(idx) && PRESET_PAYLOADS[idx]) {
                        const sel = PRESET_PAYLOADS[idx];
                        setRawPayloadInput(JSON.stringify(sel.payload, null, 2));
                        setSignatureHeader(sel.headerName);
                        setSignatureFormat(sel.format);
                      }
                    }}
                    className="bg-slate-800 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    {PRESET_PAYLOADS.map((p, i) => (
                      <option key={i} value={i}>
                        {p.label} ({p.platform})
                      </option>
                    ))}
                  </select>
                </div>

                {recentLogs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">From Stream:</span>
                    <select
                      onChange={(e) => {
                        const log = recentLogs.find(l => l.id === e.target.value);
                        if (log && log.requestPayload) {
                          setRawPayloadInput(JSON.stringify(log.requestPayload, null, 2));
                          if (log.headers?.['x-upwork-signature']) {
                            setSignatureHeader('x-upwork-signature');
                            setProvidedSignature(log.headers['x-upwork-signature']);
                          } else if (log.headers?.['x-freelancer-signature']) {
                            setSignatureHeader('x-freelancer-signature');
                            setProvidedSignature(log.headers['x-freelancer-signature']);
                          } else if (log.headers?.['x-webhook-signature']) {
                            setSignatureHeader('x-webhook-signature');
                            setProvidedSignature(log.headers['x-webhook-signature']);
                          }
                        }
                      }}
                      className="bg-slate-800 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 max-w-[200px] truncate"
                    >
                      <option value="">-- Pick Recent Event --</option>
                      {recentLogs.slice(0, 10).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.source} - {l.summary.slice(0, 28)}...
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* JSON Editor / Payload Input */}
              <div className="flex flex-col flex-1 border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-medium text-slate-300">Raw Webhook Request Payload (JSON / String)</span>
                  </div>
                  <button
                    onClick={() => {
                      try {
                        const obj = JSON.parse(rawPayloadInput);
                        setRawPayloadInput(JSON.stringify(obj, null, 2));
                      } catch {}
                    }}
                    className="text-[11px] text-slate-400 hover:text-emerald-400 flex items-center gap-1"
                  >
                    <Sliders className="w-3 h-3" />
                    <span>Format JSON</span>
                  </button>
                </div>
                <textarea
                  value={rawPayloadInput}
                  onChange={(e) => setRawPayloadInput(e.target.value)}
                  rows={9}
                  className="w-full bg-transparent p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none resize-y"
                  placeholder="Paste incoming raw JSON payload here..."
                />
              </div>

              {/* Signature Header Settings */}
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Signature Header Name</label>
                    <select
                      value={signatureHeader}
                      onChange={(e) => setSignatureHeader(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 text-xs font-mono rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="x-webhook-signature">x-webhook-signature (Standard)</option>
                      <option value="paypal-transmission-sig">paypal-transmission-sig (PayPal)</option>
                      <option value="x-upwork-signature">x-upwork-signature (Upwork API)</option>
                      <option value="x-freelancer-signature">x-freelancer-signature (Freelancer)</option>
                      <option value="x-hub-signature-256">x-hub-signature-256 (GitHub / SHA256)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Signature Encoding Format</label>
                    <select
                      value={signatureFormat}
                      onChange={(e) => setSignatureFormat(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 text-xs font-mono rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="prefix_sha256">sha256=&lt;hex&gt; (Standard)</option>
                      <option value="raw_hex">Raw Hex Hash (64 chars)</option>
                      <option value="timestamped_v1">t=&lt;timestamp&gt;,v1=&lt;hex&gt; (Timestamped HMAC)</option>
                      <option value="base64">Base64 Encoded HMAC</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-400">
                      Incoming Signature Header Value to Test
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateValidSignature}
                        className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 hover:underline"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Compute Authentic Signature</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setProvidedSignature('sha256=tampered_invalid_signature_8830198230198')}
                        className="text-[11px] font-medium text-rose-400 hover:text-rose-300 hover:underline"
                      >
                        Tamper (Simulate Attack)
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={providedSignature}
                    onChange={(e) => setProvidedSignature(e.target.value)}
                    placeholder="sha256=8f9d023b91c84..."
                    className="w-full bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="flex items-center justify-end pt-1">
                  <button
                    onClick={handleVerify}
                    disabled={verifying}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-md shadow-emerald-950 transition-all"
                  >
                    {verifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    <span>Execute Signature Verification</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Verification Results & Audit (5 cols) */}
            <div className="lg:col-span-5 flex flex-col space-y-4">
              {/* Verification Verdict Card */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 flex flex-col">
                <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-slate-200">Validation Verdict</span>
                  </div>
                  {verificationResult && (
                    <span className="text-[10px] font-mono text-slate-400">
                      Evaluated in {verificationResult.timingMs}ms
                    </span>
                  )}
                </div>

                <div className="p-4 space-y-4">
                  {verificationResult ? (
                    <>
                      {verificationResult.valid ? (
                        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0">
                            <CheckCircle2 className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-emerald-300">SIGNATURE VERIFIED & AUTHENTIC</h4>
                            <p className="text-xs text-emerald-200/80 mt-0.5">
                              The payload has not been tampered with. Constant-time cryptographic HMAC-SHA256 matches the secret key.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 shrink-0">
                            <AlertTriangle className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-rose-300">
                              {verificationResult.status === 'MISSING_SIGNATURE'
                                ? 'SIGNATURE HEADER MISSING'
                                : 'SECURITY MISMATCH (INVALID SIGNATURE)'}
                            </h4>
                            <p className="text-xs text-rose-200/80 mt-0.5">
                              {verificationResult.reason || 'The provided signature does not match the computed hash of the payload.'}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Hash Comparison Diff */}
                      <div className="space-y-2.5 pt-1">
                        <div>
                          <span className="text-[11px] font-medium text-slate-400 block mb-1">
                            Received Signature Header:
                          </span>
                          <div className="p-2 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 break-all">
                            {verificationResult.receivedSignature || '<none provided>'}
                          </div>
                        </div>

                        <div>
                          <span className="text-[11px] font-medium text-slate-400 block mb-1">
                            Expected Computed Signature:
                          </span>
                          <div className="p-2 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-emerald-400 break-all flex items-center justify-between gap-2">
                            <span>{verificationResult.expectedHeader}</span>
                            <button
                              onClick={() => handleCopy(verificationResult.expectedHeader, 'exp_sig')}
                              className="text-slate-400 hover:text-white"
                            >
                              {copiedKey === 'exp_sig' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Security Parameters Checklist */}
                      <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-800/80 pt-3">
                        <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                          <span className="text-slate-500 text-[10px] block uppercase">Algorithm</span>
                          <span className="font-semibold text-slate-200">HMAC-SHA256</span>
                        </div>
                        <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60">
                          <span className="text-slate-500 text-[10px] block uppercase">Timing Attack Safe</span>
                          <span className="font-semibold text-emerald-400 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" /> Enabled
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="py-8 text-center text-slate-500 text-xs">
                      Click "Execute Signature Verification" to inspect the security proof.
                    </div>
                  )}
                </div>
              </div>

              {/* Instant cURL Test Command */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 flex flex-col flex-1">
                <div className="p-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-mono font-medium text-slate-300">Copyable cURL Command</span>
                  </div>
                  <button
                    onClick={() => handleCopy(curlExample, 'curl')}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-slate-300 bg-slate-800 hover:bg-slate-700"
                  >
                    {copiedKey === 'curl' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'curl' ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <div className="p-3 bg-slate-950 text-slate-300 font-mono text-[11px] overflow-x-auto whitespace-pre leading-relaxed">
                  {curlExample}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'snippets' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-200">
                Server-Side Signature Verification Code Examples
              </h4>
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setCodeLanguage('node')}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${
                    codeLanguage === 'node' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Node.js (Express)
                </button>
                <button
                  onClick={() => setCodeLanguage('python')}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${
                    codeLanguage === 'python' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Python (FastAPI)
                </button>
                <button
                  onClick={() => setCodeLanguage('go')}
                  className={`px-2.5 py-1 text-xs font-medium rounded ${
                    codeLanguage === 'go' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                  }`}
                >
                  Go (Golang)
                </button>
              </div>
            </div>

            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
              <div className="p-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">
                  {codeLanguage === 'node' && 'server/webhookSecurity.js (Timing-Safe Node.js crypto)'}
                  {codeLanguage === 'python' && 'webhook_validator.py (hmac & hmac.compare_digest)'}
                  {codeLanguage === 'go' && 'webhook_verifier.go (crypto/hmac & subtle.ConstantTimeCompare)'}
                </span>
                <button
                  onClick={() => handleCopy(
                    codeLanguage === 'node'
                      ? `import crypto from 'crypto';

export function verifyWebhookSignature(payload, signatureHeader, secret = process.env.WEBHOOK_SECRET) {
  if (!signatureHeader || !secret) return false;
  
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const expectedHash = crypto.createHmac('sha256', secret).update(payloadString, 'utf8').digest('hex');
  
  let receivedHash = signatureHeader;
  if (receivedHash.startsWith('sha256=')) receivedHash = receivedHash.slice(7);
  
  const bufA = Buffer.from(receivedHash, 'utf8');
  const bufB = Buffer.from(expectedHash, 'utf8');
  if (bufA.length !== bufB.length) return false;
  
  return crypto.timingSafeEqual(bufA, bufB);
}`
                      : codeLanguage === 'python'
                      ? `import hmac, hashlib, json

def verify_webhook_signature(payload, signature_header: str, secret: str) -> bool:
    if not signature_header or not secret:
        return False
    
    payload_bytes = payload if isinstance(payload, bytes) else json.dumps(payload, separators=(',', ':')).encode('utf-8')
    expected_hex = hmac.new(secret.encode('utf-8'), payload_bytes, hashlib.sha256).hexdigest()
    
    received_hex = signature_header.replace('sha256=', '')
    return hmac.compare_digest(received_hex.lower(), expected_hex.lower())`
                      : `package main

import (
  "crypto/hmac"
  "crypto/sha256"
  "crypto/subtle"
  "encoding/hex"
  "strings"
)

func VerifyWebhook(payload []byte, signatureHeader string, secret string) bool {
  mac := hmac.New(sha256.New, []byte(secret))
  mac.Write(payload)
  expectedHex := hex.EncodeToString(mac.Sum(nil))

  receivedHex := strings.TrimPrefix(signatureHeader, "sha256=")
  return subtle.ConstantTimeCompare([]byte(receivedHex), []byte(expectedHex)) == 1
}`,
                    'snippet'
                  )}
                  className="text-xs text-slate-300 hover:text-white flex items-center gap-1"
                >
                  {copiedKey === 'snippet' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'snippet' ? 'Copied' : 'Copy Snippet'}</span>
                </button>
              </div>

              <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
                {codeLanguage === 'node' && `import crypto from 'crypto';

export function verifyWebhookSignature(payload, signatureHeader, secret = process.env.WEBHOOK_SECRET) {
  if (!signatureHeader || !secret) return false;
  
  // 1. Normalize payload to UTF-8 string
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  // 2. Compute HMAC-SHA256
  const expectedHash = crypto.createHmac('sha256', secret).update(payloadString, 'utf8').digest('hex');
  
  // 3. Extract received hex
  let receivedHash = signatureHeader;
  if (receivedHash.startsWith('sha256=')) receivedHash = receivedHash.slice(7);
  
  // 4. Timing-safe constant-time comparison (prevents timing attacks)
  const bufA = Buffer.from(receivedHash, 'utf8');
  const bufB = Buffer.from(expectedHash, 'utf8');
  if (bufA.length !== bufB.length) return false;
  
  return crypto.timingSafeEqual(bufA, bufB);
}`}
                {codeLanguage === 'python' && `import hmac
import hashlib
import json

def verify_webhook_signature(payload, signature_header: str, secret: str) -> bool:
    if not signature_header or not secret:
        return False
    
    # 1. Normalize payload bytes
    if isinstance(payload, bytes):
        payload_bytes = payload
    elif isinstance(payload, str):
        payload_bytes = payload.encode('utf-8')
    else:
        payload_bytes = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    
    # 2. Compute HMAC-SHA256
    expected_hex = hmac.new(secret.encode('utf-8'), payload_bytes, hashlib.sha256).hexdigest()
    
    # 3. Clean header
    received_hex = signature_header.replace('sha256=', '').strip()
    
    # 4. Constant time comparison
    return hmac.compare_digest(received_hex.lower(), expected_hex.lower())`}
                {codeLanguage === 'go' && `package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
)

func VerifyWebhook(payload []byte, signatureHeader string, secret string) bool {
	if signatureHeader == "" || secret == "" {
		return false
	}
	
	// 1. Compute HMAC SHA-256
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expectedHex := hex.EncodeToString(mac.Sum(nil))

	// 2. Extract received hex
	receivedHex := strings.TrimPrefix(signatureHeader, "sha256=")

	// 3. Constant time compare
	return subtle.ConstantTimeCompare([]byte(receivedHex), []byte(expectedHex)) == 1
}`}
              </pre>
            </div>
          </div>
        )}

        {activeTab === 'security_audit' && (
          <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <h4 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>KundanVision Webhook Security Specification</span>
              </h4>
              <p>
                To prevent man-in-the-middle attacks, data tampering, and spoofed job/payment notifications, KundanVision implements strict cryptographic signature verification on all incoming webhook pipelines.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>1. HMAC-SHA256</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Payloads are digested using a 256-bit keyed hash algorithm ensuring data integrity and authenticity.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>2. Replay Attack Window</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Supports timestamped headers (Stripe/Upwork style <code className="text-amber-300">t=timestamp,v1=hash</code>) enforcing a 300s expiration limit.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-blue-400" />
                    <span>3. Constant-Time Compare</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Evaluates hash buffers using <code className="text-blue-300">crypto.timingSafeEqual</code> preventing microsecond timing analysis.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
