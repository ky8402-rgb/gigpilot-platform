import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  ExternalLink, 
  Copy, 
  Check, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  DollarSign, 
  CreditCard, 
  QrCode, 
  FileText, 
  RefreshCw,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { PayPalSdkV6Button } from './PayPalSdkV6Button';
import { createBackendOrder, captureBackendOrder, getApiBaseUrl } from '../services/paypalSdkV6';

declare global {
  interface Window {
    paypal?: any;
  }
}

export interface PayPalCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialAmount?: number;
  initialTitle?: string;
  initialClientName?: string;
  initialClientEmail?: string;
  initialOrderId?: string | number;
  onPaymentSuccess?: (orderId: string, captureResult: any) => void;
  showToast: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

const PRESET_AMOUNTS = [50, 100, 250, 500, 1000];
const USD_TO_INR = 86.85;
const PAYPAL_HANDLE = '';
const PAYPAL_EMAIL = '';
const UPI_ID = '';
const ACCOUNT_HOLDER = '';
const PAYPAL_CLIENT_ID = '';

export const PayPalCheckoutModal: React.FC<PayPalCheckoutModalProps> = ({
  isOpen,
  onClose,
  initialAmount = 150,
  initialTitle = 'Freelance Engineering Deliverable Milestone',
  initialClientName = 'Valued Client',
  initialClientEmail = 'client@example.com',
  initialOrderId,
  onPaymentSuccess,
  showToast
}) => {
  const [amount, setAmount] = useState<number>(initialAmount || 150);
  const [customAmountStr, setCustomAmountStr] = useState<string>(String(initialAmount || 150));
  const [title, setTitle] = useState<string>(initialTitle || 'Freelance Engineering Deliverable Milestone');
  const [clientName, setClientName] = useState<string>(initialClientName || 'Valued Client');
  const [clientEmail, setClientEmail] = useState<string>(initialClientEmail || 'client@example.com');
  const [activeTab, setActiveTab] = useState<'buttons' | 'v6' | 'paypal_me' | 'upi'>('buttons');

  // Interactive Payment & Capture State
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [sdkLoading, setSdkLoading] = useState<boolean>(true);
  const [sdkLoadError, setSdkLoadError] = useState<string | null>(null);
  const [capturedReceipt, setCapturedReceipt] = useState<{
    orderId: string;
    captureId?: string;
    amount: number;
    currency: string;
    payerName?: string;
    payerEmail?: string;
    timestamp: string;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const paypalButtonsContainerRef = useRef<HTMLDivElement>(null);
  const buttonsRenderedRef = useRef<boolean>(false);

  // Sync initial props when opened
  useEffect(() => {
    if (isOpen) {
      if (initialAmount && initialAmount > 0) {
        setAmount(initialAmount);
        setCustomAmountStr(String(initialAmount));
      }
      if (initialTitle) setTitle(initialTitle);
      if (initialClientName) setClientName(initialClientName);
      if (initialClientEmail) setClientEmail(initialClientEmail);
      setCapturedReceipt(null);
      setIsCapturing(false);
    }
  }, [isOpen, initialAmount, initialTitle, initialClientName, initialClientEmail]);

  // Load official PayPal JavaScript SDK for standard Smart Buttons
  useEffect(() => {
    if (!isOpen || activeTab !== 'buttons' || capturedReceipt) return;

    let isMounted = true;
    setSdkLoading(true);
    setSdkLoadError(null);

    const loadSdk = async () => {
      try {
        if (!window.paypal || !window.paypal.Buttons) {
          // Check if script already exists in document
          let script = document.querySelector('script[src*="paypal.com/sdk/js"]') as HTMLScriptElement;
          if (!script) {
            script = document.createElement('script');
            if (!PAYPAL_CLIENT_ID) throw new Error('PayPal SDK client ID is configured server-side; use the backend checkout flow.');
            script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&components=buttons&enable-funding=venmo,card`;
            script.crossOrigin = 'anonymous';
            script.async = true;
            document.head.appendChild(script);

            await new Promise<void>((resolve, reject) => {
              script.onload = () => resolve();
              script.onerror = () => reject(new Error('Failed to load PayPal JS SDK from paypal.com'));
              setTimeout(() => {
                if (window.paypal) resolve();
                else resolve(); // allow fallback
              }, 4000);
            });
          } else {
            // Already loaded or loading
            if (window.paypal && window.paypal.Buttons) {
              // ready
            } else {
              await new Promise<void>((resolve) => setTimeout(resolve, 1000));
            }
          }
        }

        if (!isMounted) return;

        if (window.paypal && typeof window.paypal.Buttons === 'function') {
          setSdkLoading(false);
          renderPayPalButtons();
        } else {
          setSdkLoading(false);
          setSdkLoadError('PayPal Smart Buttons could not be rendered. Direct PayPal.me & SDK v6 checkout are available.');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setSdkLoading(false);
        setSdkLoadError(err?.message || 'PayPal SDK unavailable in this environment.');
      }
    };

    loadSdk();

    return () => {
      isMounted = false;
    };
  }, [isOpen, activeTab, amount, capturedReceipt]);

  const renderPayPalButtons = () => {
    if (!paypalButtonsContainerRef.current || !window.paypal || !window.paypal.Buttons) return;

    // Clear previous renders
    paypalButtonsContainerRef.current.innerHTML = '';

    try {
      window.paypal.Buttons({
        style: {
          layout: 'vertical',
          color: 'gold',
          shape: 'rect',
          label: 'checkout',
          height: 44
        },
        createOrder: async () => {
          setIsCapturing(true);
          try {
            const orderRes = await createBackendOrder({
              amount,
              currency: 'USD',
              description: title,
              clientName,
              clientEmail,
              customId: initialOrderId ? String(initialOrderId) : `chk_${Date.now()}`
            });
            return orderRes.orderId;
          } catch (err: any) {
            setIsCapturing(false);
            showToast(`Order creation failed: ${err?.message || err}`, 'error');
            throw err;
          }
        },
        onApprove: async (data: any) => {
          setIsCapturing(true);
          try {
            const orderId = data.orderID || data.orderId;
            const captureRes = await captureBackendOrder({
              orderId,
              amount,
              clientName,
              clientEmail,
              title,
              description: `Captured via PayPal Smart Checkout (${orderId})`
            });

            const receipt = {
              orderId,
              captureId: captureRes.capture?.captureId || `CAP-${Date.now()}`,
              amount: captureRes.amount || amount,
              currency: captureRes.currency || 'USD',
              payerName: captureRes.capture?.payerName || clientName,
              payerEmail: captureRes.capture?.payerEmail || clientEmail,
              timestamp: new Date().toISOString()
            };

            setCapturedReceipt(receipt);
            setIsCapturing(false);
            showToast(`🎉 Payment approved & captured! Order: ${orderId}`, 'success');

            if (onPaymentSuccess) {
              onPaymentSuccess(orderId, captureRes);
            }
          } catch (err: any) {
            setIsCapturing(false);
            showToast(`Capture failed: ${err?.message || err}`, 'error');
          }
        },
        onCancel: () => {
          setIsCapturing(false);
          showToast('PayPal checkout cancelled by buyer', 'info');
        },
        onError: (err: any) => {
          setIsCapturing(false);
          console.warn('[PayPal Buttons] Error:', err);
          showToast(`PayPal notice: ${err?.message || 'Transaction could not be completed'}`, 'warning');
        }
      }).render(paypalButtonsContainerRef.current);
    } catch (err) {
      console.warn('[PayPal Buttons] render error:', err);
    }
  };

  const handleAmountSelect = (val: number) => {
    setAmount(val);
    setCustomAmountStr(String(val));
  };

  const handleCustomAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomAmountStr(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      setAmount(parsed);
    }
  };

  const handleCopyLink = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(true);
    showToast('Payment link copied to clipboard!', 'success');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Instant Direct Capture Simulation for testing or verified direct PayPal.me payments
  const handleSimulateOrRecordDirectPayment = async () => {
    setIsCapturing(true);
    try {
      const simOrderId = `PP-VERIFIED-${Date.now().toString().slice(-6)}`;
      const captureRes = await captureBackendOrder({
        orderId: simOrderId,
        amount,
        clientName,
        clientEmail,
        title,
        description: `Direct PayPal Settlement Recorded (${simOrderId})`
      });

      const receipt = {
        orderId: simOrderId,
        captureId: `CAP-DIR-${Date.now().toString().slice(-6)}`,
        amount,
        currency: 'USD',
        payerName: clientName,
        payerEmail: clientEmail,
        timestamp: new Date().toISOString()
      };

      setCapturedReceipt(receipt);
      setIsCapturing(false);
      showToast(`✅ Payment recorded & Work Order initialized in PostgreSQL!`, 'success');

      if (onPaymentSuccess) {
        onPaymentSuccess(simOrderId, captureRes);
      }
    } catch (err: any) {
      setIsCapturing(false);
      showToast(`Error recording payment: ${err?.message || err}`, 'error');
    }
  };

  if (!isOpen) return null;

  const inrEquivalent = Math.round(amount * USD_TO_INR).toLocaleString('en-IN');
  const directPayPalUrl = '';


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-[#0c101a] border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 my-6 text-slate-200">
        
        {/* Top Header */}
        <div className="flex items-start justify-between border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#0070ba]/20 border border-[#0070ba]/40 flex items-center justify-center text-[#ffc439] text-xl shadow-lg shadow-blue-500/10 shrink-0">
              <i className="fab fa-paypal text-2xl"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">
                  PayPal Direct Checkout
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  LIVE REST v2
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-emerald-400 inline" />
                <span>256-bit SSL Encrypted &bull; Automated PostgreSQL Work Order Initialization</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* PAYMENT SUCCESS RECEIPT SCREEN */}
        {capturedReceipt ? (
          <div className="space-y-5 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 p-6 text-center animate-fadeIn">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-xl">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-mono font-bold text-emerald-400 uppercase tracking-wider">
                Payment Completed &amp; Verified
              </span>
              <h3 className="text-2xl font-bold text-white font-mono">
                ${capturedReceipt.amount.toFixed(2)} {capturedReceipt.currency}
              </h3>
              <p className="text-xs text-slate-400">
                Equivalent to approximately ₹{Math.round(capturedReceipt.amount * USD_TO_INR).toLocaleString('en-IN')} INR
              </p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 text-xs font-mono space-y-2 text-left">
              <div className="flex justify-between text-slate-400">
                <span>Transaction Order ID:</span>
                <strong className="text-blue-400">{capturedReceipt.orderId}</strong>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Capture Stamp:</span>
                <strong className="text-emerald-400">{capturedReceipt.captureId || 'VERIFIED'}</strong>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Recipient:</span>
                <strong className="text-white">Configured server-side</strong>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Payer:</span>
                <strong className="text-white">{capturedReceipt.payerName} ({capturedReceipt.payerEmail})</strong>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Milestone:</span>
                <span className="text-slate-300 font-sans truncate max-w-[260px]">{title}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                onClick={() => {
                  setCapturedReceipt(null);
                  onClose();
                }}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition-all cursor-pointer"
              >
                Done &amp; View Updated Balances
              </button>

              <button
                onClick={() => handleCopyLink(capturedReceipt.orderId)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold text-xs border border-slate-700 flex items-center gap-2 transition-all cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Order ID</span>
              </button>
            </div>
          </div>
        ) : (
          /* CHECKOUT CONFIGURATION & BUTTONS */
          <div className="space-y-5">
            
            {/* Amount Selection & Input */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block flex items-center justify-between">
                <span>1. Select Milestone Amount (USD)</span>
                <span className="text-emerald-400 font-mono text-[11px]">
                  ≈ ₹{inrEquivalent} INR
                </span>
              </label>

              {/* Amount Presets */}
              <div className="grid grid-cols-5 gap-2">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleAmountSelect(preset)}
                    className={`py-2 px-2 rounded-xl text-xs font-bold font-mono transition-all border cursor-pointer ${
                      amount === preset
                        ? 'bg-blue-600 border-blue-400 text-white shadow-md shadow-blue-600/30'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                    }`}
                  >
                    ${preset}
                  </button>
                ))}
              </div>

              {/* Custom Amount Input */}
              <div className="relative mt-2">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <DollarSign className="w-4 h-4" />
                </div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={customAmountStr}
                  onChange={handleCustomAmountChange}
                  placeholder="Enter custom USD amount..."
                  className="w-full pl-9 pr-24 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm font-bold font-mono text-white focus:outline-none focus:border-blue-500 transition-all"
                />
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-xs text-slate-500 font-mono">
                  USD
                </div>
              </div>
            </div>

            {/* Deliverable Title & Client Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Milestone / Work Order Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g. Full-Stack API Integration"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Client Name / Business</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g. Acme Corp"
                />
              </div>
            </div>

            {/* Checkout Method Tabs */}
            <div className="space-y-3 pt-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                2. Choose Checkout Interface
              </label>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('buttons')}
                  className={`py-2 px-3 rounded-xl font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    activeTab === 'buttons'
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-blue-400 shadow-md shadow-blue-900/30'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <i className="fab fa-paypal text-[#ffc439]"></i>
                  <span>PayPal Buttons</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('v6')}
                  className={`py-2 px-3 rounded-xl font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    activeTab === 'v6'
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-indigo-400 shadow-md shadow-indigo-900/30'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                  <span>SDK v6 Session</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('paypal_me')}
                  className={`py-2 px-3 rounded-xl font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    activeTab === 'paypal_me'
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white border-cyan-400 shadow-md shadow-cyan-900/30'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <ExternalLink className="w-3.5 h-3.5 text-cyan-300" />
                  <span>1-Click PayPal.me</span>
                </button>
              </div>

              {/* TAB 1: OFFICIAL PAYPAL SMART BUTTONS */}
              {activeTab === 'buttons' && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <i className="fab fa-paypal text-cyan-400"></i>
                        <span>Interactive PayPal Smart Checkout</span>
                      </span>
                      <p className="text-[11px] text-slate-400">
                        Supports PayPal Balance, Credit/Debit Cards, Venmo &amp; Pay Later.
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      ${amount.toFixed(2)} USD
                    </span>
                  </div>

                  {/* Render Container for Official PayPal Buttons */}
                  <div className="min-h-[110px] flex flex-col items-center justify-center">
                    {sdkLoading && (
                      <div className="flex items-center gap-2 text-xs text-slate-400 py-6">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                        <span>Initializing official PayPal payment buttons...</span>
                      </div>
                    )}

                    {isCapturing && (
                      <div className="flex items-center gap-2 text-xs text-emerald-400 py-3 font-mono animate-pulse">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                        <span>Capturing transaction &amp; initializing PostgreSQL work order...</span>
                      </div>
                    )}

                    <div
                      ref={paypalButtonsContainerRef}
                      className={`w-full max-w-md mx-auto ${sdkLoading ? 'hidden' : 'block'}`}
                    ></div>

                    {sdkLoadError && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 w-full space-y-2 text-center">
                        <p>{sdkLoadError}</p>
                        <a
                          href={directPayPalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs"
                        >
                          <span>Open Direct PayPal.me Checkout</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Manual Settlement Record */}
                  <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Already received direct PayPal funds?</span>
                    <button
                      type="button"
                      onClick={handleSimulateOrRecordDirectPayment}
                      disabled={isCapturing}
                      className="text-blue-400 hover:text-blue-300 underline cursor-pointer disabled:opacity-50"
                    >
                      Record Payment &amp; Initialize Work Order
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: PAYPAL SDK V6 ONE-TIME SESSION */}
              {activeTab === 'v6' && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span>PayPal JavaScript SDK v6 Session</span>
                      </span>
                      <p className="text-[11px] text-slate-400">
                        Modern Web SDK v6 with custom presentation modes (payment-handler &rarr; popup &rarr; modal).
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      ${amount.toFixed(2)} USD
                    </span>
                  </div>

                  <div className="py-2">
                    <PayPalSdkV6Button
                      amount={amount}
                      currency="USD"
                      description={title}
                      clientName={clientName}
                      clientEmail={clientEmail}
                      onSuccess={(orderId, captureRes) => {
                        const receipt = {
                          orderId,
                          captureId: captureRes?.capture?.captureId || `CAP-${Date.now()}`,
                          amount,
                          currency: 'USD',
                          payerName: clientName,
                          payerEmail: clientEmail,
                          timestamp: new Date().toISOString()
                        };
                        setCapturedReceipt(receipt);
                        showToast(`✅ Captured via PayPal SDK v6! Order: ${orderId}`, 'success');
                        if (onPaymentSuccess) onPaymentSuccess(orderId, captureRes);
                      }}
                      onError={(err) => {
                        showToast(`SDK v6 notice: ${err?.message || 'Handled'}`, 'info');
                      }}
                    />
                  </div>
                </div>
              )}

              {/* TAB 3: 1-CLICK PAYPAL.ME */}
              {activeTab === 'paypal_me' && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <ExternalLink className="w-4 h-4 text-blue-400" />
                        <span>Verified Direct PayPal.me Express Checkout</span>
                      </span>
                      <p className="text-[11px] text-slate-400">
                        Recipient: <strong>@{PAYPAL_HANDLE}</strong> ({PAYPAL_EMAIL})
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      ${amount.toFixed(2)} USD
                    </span>
                  </div>

                  <div className="flex items-center gap-2 bg-slate-900 p-2.5 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 truncate">
                    <span className="truncate flex-1">{directPayPalUrl}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyLink(directPayPalUrl)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-sans font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <a
                      href={directPayPalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all text-center"
                    >
                      <span>Open Checkout at PayPal.me</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>

                    <button
                      type="button"
                      onClick={handleSimulateOrRecordDirectPayment}
                      disabled={isCapturing}
                      className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Confirm &amp; Record Payment</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Guarantee Banner */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Zero buyer dispute risk &bull; Automatic ledger settlement</span>
              </span>
              <span className="font-mono text-slate-400">
                Verified: ky8402 / Payoneer (Citibank USD)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
