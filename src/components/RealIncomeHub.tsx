import React, { useState } from 'react';
import {
  DollarSign,
  CreditCard,
  QrCode,
  Share2,
  ExternalLink,
  Check,
  Copy,
  Sparkles,
  Zap,
  Briefcase,
  ShieldCheck,
  Send,
  ArrowRight,
  TrendingUp,
  Globe,
  Building,
  CheckCircle2,
  FileText,
  Clock,
  HelpCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';

import { PayPalSdkV6Button } from './PayPalSdkV6Button';

interface RealIncomeHubProps {
  onPaymentReceived: (amount: number, clientName: string, description: string) => void;
  onNavigateToTab: (tab: string) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

interface ServicePackage {
  id: string;
  title: string;
  category: string;
  description: string;
  deliverables: string[];
  priceUsd: number;
  priceInr: number;
  deliveryDays: number;
  badge?: string;
  iconColor: string;
}

const SERVICE_PACKAGES: ServicePackage[] = [
  {
    id: 'pkg_fullstack_mvp',
    title: 'Full-Stack SaaS & Web App MVP',
    category: 'Full-Stack Engineering',
    description: 'Production-ready React/TypeScript frontend, robust Node.js backend, authentication, database, and cloud deployment.',
    deliverables: [
      'Responsive React + Tailwind CSS UI',
      'REST / GraphQL API Endpoints',
      'Database Schema & Migrations',
      'Cloud Deployment (Cloud Run / Vercel)',
      '14-day Post-Launch Bug Warranty'
    ],
    priceUsd: 499,
    priceInr: 41500,
    deliveryDays: 5,
    badge: 'Most Popular',
    iconColor: 'from-blue-500 to-indigo-600'
  },
  {
    id: 'pkg_ai_agent_pipeline',
    title: 'Custom AI Agent & Webhook Ingestion',
    category: 'AI & Automation',
    description: 'Autonomous Gemini / LLM workflow integration, cryptographic HMAC webhook ingestion, and real-time activity pipelines.',
    deliverables: [
      'Gemini 2.5 / Flash AI Orchestration',
      'HMAC SHA-256 Webhook Security',
      'Real-time Telemetry & Stream Logging',
      'Automated Prompt Engineering',
      'API Integration Documentation'
    ],
    priceUsd: 299,
    priceInr: 24800,
    deliveryDays: 3,
    badge: 'High Demand',
    iconColor: 'from-purple-500 to-violet-600'
  },
  {
    id: 'pkg_payment_gateway',
    title: 'Payment Gateway & Invoicing System',
    category: 'Fintech & Checkout',
    description: 'Seamless checkout integration supporting PayPal, Stripe, and Indian UPI QR codes with instant automated receipts.',
    deliverables: [
      'PayPal Orders & Instant Capture API',
      'NPCI Dynamic UPI QR Matrix Generator',
      'Automated Invoicing & Tax Receipts',
      'Multi-Currency USD ↔ INR Converter',
      'Webhook IPN Event Listeners'
    ],
    priceUsd: 199,
    priceInr: 16500,
    deliveryDays: 2,
    iconColor: 'from-emerald-500 to-teal-600'
  },
  {
    id: 'pkg_express_audit',
    title: 'Express Code Audit & Bug Fixes',
    category: 'Performance & QA',
    description: 'Rapid 24-hour turnaround for critical bugs, TypeScript compilation errors, performance optimization, and UI polish.',
    deliverables: [
      'Deep Architecture & Security Audit',
      'Resolution of Up to 5 Complex Bugs',
      'Lighthouse 95+ Performance Boost',
      'Clean Code Refactoring',
      'Priority 24-Hour Delivery'
    ],
    priceUsd: 99,
    priceInr: 8200,
    deliveryDays: 1,
    badge: '24h Delivery',
    iconColor: 'from-amber-500 to-orange-600'
  }
];

export const RealIncomeHub: React.FC<RealIncomeHubProps> = ({
  onPaymentReceived,
  onNavigateToTab,
  showToast
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'packages' | 'custom_link' | 'live_jobs' | 'playbook'>('packages');
  const [selectedPackage, setSelectedPackage] = useState<ServicePackage | null>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState<'paypal' | 'upi' | 'wire'>('paypal');

  // Custom Payment Link Generator Form State
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [customAmountUsd, setCustomAmountUsd] = useState('150');
  const [customCurrency, setCustomCurrency] = useState<'USD' | 'INR'>('USD');
  const [generatedShareText, setGeneratedShareText] = useState('');
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [isSimulatingConfirmation, setIsSimulatingConfirmation] = useState(false);

  // Constants
  const PAYPAL_HANDLE = 'ky8402';
  const PAYPAL_EMAIL = 'kundank4@icloud.com';
  const UPI_ID = 'chandimay@ybl';
  const ACCOUNT_HOLDER = 'Kundan Kumar';
  const BANK_NAME = 'Federal Bank';
  const ACCOUNT_NUMBER = '99980119788763';
  const IFSC_CODE = 'FDRL0001447';
  const SWIFT_CODE = 'FDRLINBBIBD';
  const USD_TO_INR_RATE = 86.85;

  // Open Checkout for a package
  const handleOpenCheckout = (pkg: ServicePackage) => {
    setSelectedPackage(pkg);
    setCheckoutModalOpen(true);
  };

  // Generate shareable invoice payment text
  const handleGenerateCustomLink = () => {
    const amt = parseFloat(customAmountUsd);
    if (isNaN(amt) || amt <= 0) {
      showToast('Please enter a valid amount', 'warning');
      return;
    }

    const title = projectTitle.trim() || 'Freelance Engineering Deliverable';
    const client = clientName.trim() || 'Valued Client';
    const amtUsd = customCurrency === 'USD' ? amt : Math.round(amt / USD_TO_INR_RATE);
    const amtInr = customCurrency === 'INR' ? amt : Math.round(amt * USD_TO_INR_RATE);

    const shareMessage = `📋 INVOICE & DIRECT PAYMENT REQUEST
-----------------------------------------
Client: ${client}
Project: ${title}
Amount: $${amtUsd.toLocaleString()} USD (₹${amtInr.toLocaleString('en-IN')} INR)
Payee: ${ACCOUNT_HOLDER} (${PAYPAL_EMAIL})

💳 Pay with PayPal (Instant Global Checkout):
https://paypal.me/${PAYPAL_HANDLE}/${amtUsd}USD

🇮🇳 Pay via UPI (GPay / PhonePe / Paytm / BHIM):
UPI ID: ${UPI_ID}
Direct UPI Link: upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(ACCOUNT_HOLDER)}&am=${amtInr}&cu=INR&tn=${encodeURIComponent(title)}

🏦 Direct Bank Transfer (NEFT / IMPS / SWIFT):
Bank: ${BANK_NAME}
Account Number: ${ACCOUNT_NUMBER}
IFSC Code: ${IFSC_CODE}
SWIFT / BIC: ${SWIFT_CODE}
-----------------------------------------
Thank you for your business!`;

    setGeneratedShareText(shareMessage);
    showToast('Payment link & invoice details generated!', 'success');
  };

  const handleCopyShareText = () => {
    if (!generatedShareText) return;
    navigator.clipboard.writeText(generatedShareText);
    setCopiedShareLink(true);
    showToast('Copied payment request to clipboard! Ready to send to client.', 'success');
    setTimeout(() => setCopiedShareLink(false), 2500);
  };

  // Helper for direct PayPal.me link
  const getPayPalUrl = (usdAmount: number) => {
    return `https://paypal.me/${PAYPAL_HANDLE}/${usdAmount}USD`;
  };

  // Helper for UPI URI
  const getUpiUri = (inrAmount: number, desc: string) => {
    return `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(ACCOUNT_HOLDER)}&am=${inrAmount}&cu=INR&tn=${encodeURIComponent(desc)}`;
  };

  // Helper for dynamic QR code image URL
  const getQrCodeUrl = (data: string) => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data)}&margin=10`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      
      {/* Header Banner: Real Income Generation */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-r from-slate-900 via-slate-900/90 to-emerald-950/40 p-6 sm:p-8 shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
              <Zap className="h-3.5 w-3.5" />
              <span>Real Revenue &amp; Client Payment Gateway</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Monetize Your Skills &amp; Collect Real Income
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Accept live payments from international and domestic clients directly into your verified <strong className="text-emerald-400">PayPal ({PAYPAL_EMAIL})</strong> and <strong className="text-emerald-400">{BANK_NAME} Account ({ACCOUNT_NUMBER})</strong> via instant PayPal links, UPI QR codes, and smart milestone invoicing.
            </p>
          </div>

          {/* Quick Payment Credentials Badge */}
          <div className="flex flex-col sm:flex-row md:flex-col gap-3 min-w-[260px] bg-slate-950/70 border border-slate-800 rounded-2xl p-4 text-xs font-mono">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-slate-400 flex items-center gap-1.5 font-sans">
                <Globe className="w-3.5 h-3.5 text-blue-400" /> Global PayPal:
              </span>
              <a 
                href={getPayPalUrl(50)} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-blue-400 hover:underline font-bold"
              >
                paypal.me/{PAYPAL_HANDLE}
              </a>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-slate-400 flex items-center gap-1.5 font-sans">
                <QrCode className="w-3.5 h-3.5 text-emerald-400" /> Domestic UPI:
              </span>
              <span className="text-emerald-400 font-bold">{UPI_ID}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400 flex items-center gap-1.5 font-sans">
                <Building className="w-3.5 h-3.5 text-teal-400" /> Indian Bank:
              </span>
              <span className="text-slate-200 font-bold">{BANK_NAME} ••8763</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveSubTab('packages')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
            activeSubTab === 'packages'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
          }`}
        >
          <Briefcase className="h-4 w-4" />
          <span>Client Service Packages ({SERVICE_PACKAGES.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('custom_link')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
            activeSubTab === 'custom_link'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
          }`}
        >
          <CreditCard className="h-4 w-4" />
          <span>Instant Invoice &amp; Payment Link Generator</span>
        </button>

        <button
          onClick={() => setActiveSubTab('live_jobs')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
            activeSubTab === 'live_jobs'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
          }`}
        >
          <Globe className="h-4 w-4" />
          <span>Live Remote Contracts &amp; Proposals</span>
        </button>

        <button
          onClick={() => setActiveSubTab('playbook')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
            activeSubTab === 'playbook'
              ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
          }`}
        >
          <Sparkles className="h-4 w-4" />
          <span>Real Income Playbook ($100–$500/day)</span>
        </button>
      </div>

      {/* TAB 1: SERVICE PACKAGES */}
      {activeSubTab === 'packages' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold text-white">Pre-Packaged Client Offerings</h3>
              <p className="text-xs text-slate-400">Fixed-price engineering packages clients can buy with 1 click via PayPal or UPI.</p>
            </div>
            <button
              onClick={() => setActiveSubTab('custom_link')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              <span>Create Custom Scope Order</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SERVICE_PACKAGES.map((pkg) => (
              <div
                key={pkg.id}
                className="relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-6 backdrop-blur-sm transition-all hover:border-slate-700 hover:shadow-xl group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="space-y-1">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                        {pkg.category}
                      </span>
                      <h4 className="text-lg font-extrabold text-white group-hover:text-emerald-300 transition-colors">
                        {pkg.title}
                      </h4>
                    </div>
                    {pkg.badge && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                        {pkg.badge}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 mb-4 leading-relaxed">
                    {pkg.description}
                  </p>

                  <div className="space-y-2 mb-6 border-t border-slate-800/80 pt-4">
                    <span className="text-[11px] font-bold uppercase text-slate-400 tracking-wider block">
                      Included Deliverables:
                    </span>
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {pkg.deliverables.map((item, idx) => (
                        <li key={idx} className="flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="border-t border-slate-800/80 pt-4">
                  <div className="flex items-baseline justify-between mb-4">
                    <div>
                      <span className="text-2xl font-black text-white font-mono">
                        ${pkg.priceUsd}
                      </span>
                      <span className="text-xs text-slate-400 font-sans ml-1">USD</span>
                      <span className="text-xs text-slate-500 ml-2 font-mono">
                        (₹{pkg.priceInr.toLocaleString('en-IN')} INR)
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {pkg.deliveryDays} Day Delivery
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleOpenCheckout(pkg)}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2.5 text-xs font-extrabold transition-all shadow-md active:scale-95"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      <span>Instant Checkout</span>
                    </button>

                    <a
                      href={getPayPalUrl(pkg.priceUsd)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 px-4 py-2.5 text-xs font-bold transition-all"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Direct PayPal Link</span>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: INSTANT INVOICE & CUSTOM PAYMENT LINK GENERATOR */}
      {activeSubTab === 'custom_link' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Form Controls (6 cols) */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>Create Client Payment Request</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Enter your client's details and custom milestone fee to generate direct PayPal &amp; UPI payment links.
              </p>
            </div>

            <div className="space-y-3 pt-2 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Client / Company Name</label>
                <input
                  type="text"
                  placeholder="e.g. Nexus Media, John Smith, Upwork Client"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Project / Milestone Description</label>
                <input
                  type="text"
                  placeholder="e.g. React Frontend Development, AI Agent Integration"
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Payment Amount</label>
                  <input
                    type="number"
                    min="1"
                    value={customAmountUsd}
                    onChange={(e) => setCustomAmountUsd(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-slate-100 font-mono font-bold focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Currency</label>
                  <select
                    value={customCurrency}
                    onChange={(e) => setCustomCurrency(e.target.value as 'USD' | 'INR')}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="USD">USD ($) - Global PayPal &amp; SWIFT</option>
                    <option value="INR">INR (₹) - Indian UPI &amp; IMPS</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleGenerateCustomLink}
                className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-3 text-xs font-bold transition-all shadow-md active:scale-95"
              >
                <Zap className="h-4 w-4" />
                <span>Generate Client Payment Link &amp; Details</span>
              </button>
            </div>
          </div>

          {/* Right Column: Formatted Output / Copyable Message (6 cols) */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-emerald-400" />
                  <span>Shareable Invoice Summary</span>
                </h3>
                {generatedShareText && (
                  <button
                    onClick={handleCopyShareText}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1 text-xs font-bold hover:bg-emerald-500/20 transition-all"
                  >
                    {copiedShareLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedShareLink ? 'Copied!' : 'Copy to Clipboard'}</span>
                  </button>
                )}
              </div>

              {generatedShareText ? (
                <div className="mt-3">
                  <textarea
                    readOnly
                    rows={13}
                    value={generatedShareText}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 p-3.5 font-mono text-xs text-slate-200 focus:outline-none select-all"
                  />
                </div>
              ) : (
                <div className="mt-8 text-center py-12 px-4 rounded-xl border border-dashed border-slate-800 text-slate-400 space-y-2">
                  <FileText className="h-8 w-8 mx-auto text-slate-600" />
                  <p className="text-xs">Fill in the project details on the left and click "Generate" to construct your client payment request.</p>
                </div>
              )}
            </div>

            {generatedShareText && (
              <div className="flex items-center gap-2 pt-2">
                <a
                  href={getPayPalUrl(parseFloat(customAmountUsd) || 50)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 py-2.5 text-xs font-bold transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Test PayPal Link</span>
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: LIVE REMOTE CONTRACTS & PROPOSALS */}
      {activeSubTab === 'live_jobs' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                <span>Live Remote Developer Job Feeds</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Apply directly to real paying companies with AI-generated winning proposals.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onNavigateToTab('remoteok')}
                className="flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white px-3.5 py-2 text-xs font-bold transition-all"
              >
                <span>Browse RemoteOK Jobs</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-purple-400">RemoteOK Feed</span>
                <span className="text-emerald-400 font-mono">$80k–$180k/yr</span>
              </div>
              <p className="text-xs text-slate-300">
                Direct remote developer listings with unauthenticated REST feed. Apply directly on employer career portals.
              </p>
              <button
                onClick={() => onNavigateToTab('remoteok')}
                className="w-full mt-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 text-xs font-semibold"
              >
                Open RemoteOK Radar
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-sky-400">Freelancer.com</span>
                <span className="text-emerald-400 font-mono">$50–$2,500/gig</span>
              </div>
              <p className="text-xs text-slate-300">
                Live active project bids for full-stack, Python, React, automation, and API integration.
              </p>
              <a
                href="https://www.freelancer.com/jobs"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center w-full mt-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 text-xs font-semibold"
              >
                Open Freelancer.com ↗
              </a>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-emerald-400">Direct Client Invoicing</span>
                <span className="text-emerald-400 font-mono">100% Retained</span>
              </div>
              <p className="text-xs text-slate-300">
                Bill private clients directly via your custom PayPal.me link or Indian Bank UPI with 0% platform intermediary commission.
              </p>
              <button
                onClick={() => setActiveSubTab('custom_link')}
                className="w-full mt-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30 py-1.5 text-xs font-semibold"
              >
                Generate Payment Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: REAL INCOME PLAYBOOK */}
      {activeSubTab === 'playbook' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>The Real Freelance Revenue Playbook ($100–$500/Day)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              A software dashboard alone does not create money out of thin air. Real income is generated when you deliver genuine engineering value to clients who pay you via the payment channels connected here.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-xs">1</span>
                <span>Apply to 5+ Live Jobs Daily</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Use the <strong>RemoteOK Feed</strong> and <strong>Freelancer Public Radar</strong> in this dashboard. Click on jobs matching your skills (React, Node.js, AI, Python) and generate tailored proposals with the Gemini AI Proposal Studio to pitch clients immediately.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-3">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-sm">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/20 border border-blue-500/30 text-xs">2</span>
                <span>Send Direct Payment Links</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                When you agree on a milestone with a client, generate an instant <strong>PayPal.me link</strong> (<code className="text-blue-300">paypal.me/{PAYPAL_HANDLE}/[Amount]</code>) or <strong>UPI QR code</strong>. When they pay, the money arrives immediately in your actual bank account.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-3">
              <div className="flex items-center gap-2 text-purple-400 font-bold text-sm">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/20 border border-purple-500/30 text-xs">3</span>
                <span>Deliver High-Value MVP Packages</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Promote the fixed-price service packages (e.g. $499 Full-Stack SaaS MVP or $299 AI Agent Integration) on your LinkedIn, GitHub portfolio, or Twitter. Clients can order directly through this portal.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CHECKOUT MODAL FOR SELECTED PACKAGE */}
      {checkoutModalOpen && selectedPackage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl overflow-hidden my-6 space-y-6">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                  {selectedPackage.category}
                </span>
                <h3 className="text-lg font-black text-white mt-0.5">
                  {selectedPackage.title}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Amount: <strong className="text-emerald-400 font-mono">${selectedPackage.priceUsd} USD</strong> (₹{selectedPackage.priceInr.toLocaleString('en-IN')} INR)
                </p>
              </div>
              <button
                onClick={() => setCheckoutModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {/* Payment Method Switcher */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <button
                onClick={() => setCheckoutPaymentMethod('paypal')}
                className={`py-2 px-3 rounded-xl font-bold border transition-all ${
                  checkoutPaymentMethod === 'paypal'
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                💳 PayPal (USD)
              </button>

              <button
                onClick={() => setCheckoutPaymentMethod('upi')}
                className={`py-2 px-3 rounded-xl font-bold border transition-all ${
                  checkoutPaymentMethod === 'upi'
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                🇮🇳 UPI QR (INR)
              </button>

              <button
                onClick={() => setCheckoutPaymentMethod('wire')}
                className={`py-2 px-3 rounded-xl font-bold border transition-all ${
                  checkoutPaymentMethod === 'wire'
                    ? 'bg-teal-600 text-white border-teal-500 shadow-md'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                🏦 Bank Wire
              </button>
            </div>

            {/* Method Details */}
            {checkoutPaymentMethod === 'paypal' && (
              <div className="space-y-4 rounded-2xl bg-slate-950 p-5 border border-slate-800">
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Receiver PayPal Email:</span>
                    <strong className="text-white font-mono">{PAYPAL_EMAIL}</strong>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>PayPal.me Handle:</span>
                    <strong className="text-blue-400 font-mono">@{PAYPAL_HANDLE}</strong>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Package Price:</span>
                    <strong className="text-emerald-400 font-mono text-sm">${selectedPackage.priceUsd}.00 USD</strong>
                  </div>
                </div>

                <div className="pt-2">
                  <PayPalSdkV6Button
                    amount={selectedPackage.priceUsd}
                    currency="USD"
                    description={`Client Order: ${selectedPackage.title}`}
                    clientName="Valued Client"
                    clientEmail="client@paypal-direct.com"
                    onSuccess={(orderId) => {
                      confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
                      onPaymentReceived(selectedPackage.priceUsd, 'PayPal Client', selectedPackage.title);
                      showToast(`🎉 PayPal v6 Payment Captured! Work Order initialized.`, 'success');
                      setCheckoutModalOpen(false);
                    }}
                    onError={(err) => {
                      showToast(`PayPal SDK notice: ${err?.message || 'Handled'}`, 'info');
                    }}
                  />
                </div>
              </div>
            )}

            {checkoutPaymentMethod === 'upi' && (
              <div className="space-y-4 rounded-2xl bg-slate-950 p-5 border border-slate-800 text-center">
                <div className="space-y-1 text-xs">
                  <span className="text-emerald-400 font-bold uppercase tracking-wider text-[10px]">
                    Scan with any Indian UPI App (GPay / PhonePe / Paytm / BHIM)
                  </span>
                  <div className="text-base font-extrabold text-white font-mono">
                    ₹{selectedPackage.priceInr.toLocaleString('en-IN')} INR
                  </div>
                  <div className="text-slate-400 font-mono text-xs">VPA: {UPI_ID}</div>
                </div>

                {/* Scannable QR Code */}
                <div className="flex justify-center my-2">
                  <div className="p-3 bg-white rounded-2xl shadow-xl inline-block">
                    <img
                      src={getQrCodeUrl(getUpiUri(selectedPackage.priceInr, selectedPackage.title))}
                      alt="UPI QR Code"
                      className="w-44 h-44 object-contain"
                    />
                  </div>
                </div>

                <a
                  href={getUpiUri(selectedPackage.priceInr, selectedPackage.title)}
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 underline"
                >
                  <span>Open UPI App on Mobile Phone ↗</span>
                </a>
              </div>
            )}

            {checkoutPaymentMethod === 'wire' && (
              <div className="space-y-3 rounded-2xl bg-slate-950 p-5 border border-slate-800 text-xs">
                <div className="font-bold text-slate-200 border-b border-slate-800 pb-2">
                  Domestic &amp; International Wire Transfer Instructions
                </div>
                <div className="grid grid-cols-2 gap-3 text-slate-300">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Beneficiary Name:</span>
                    <strong className="text-white">{ACCOUNT_HOLDER}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Bank Name:</span>
                    <strong className="text-white">{BANK_NAME}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Account Number:</span>
                    <strong className="text-white font-mono">{ACCOUNT_NUMBER}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">IFSC Code (India):</span>
                    <strong className="text-emerald-400 font-mono">{IFSC_CODE}</strong>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500 block text-[10px]">SWIFT / BIC Code (Global):</span>
                    <strong className="text-blue-400 font-mono">{SWIFT_CODE}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setCheckoutModalOpen(false)}
                className="rounded-xl border border-slate-800 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
