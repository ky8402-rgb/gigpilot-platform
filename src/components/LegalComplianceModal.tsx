import React, { useState } from 'react';
import { 
  X, 
  ShieldCheck, 
  FileText, 
  Lock, 
  Receipt, 
  CheckCircle2, 
  ExternalLink,
  Printer,
  Copy,
  Check,
  Scale
} from 'lucide-react';

interface LegalComplianceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'terms' | 'privacy' | 'gst' | 'refunds';
}

export const LegalComplianceModal: React.FC<LegalComplianceModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'terms'
}) => {
  const [activeTab, setActiveTab] = useState<'terms' | 'privacy' | 'gst' | 'refunds'>(initialTab);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/legal#${activeTab}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl bg-indigo-500/10 p-2 text-indigo-400 border border-indigo-500/20">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white sm:text-lg flex items-center gap-2">
                Production Compliance &amp; Legal Center
                <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border border-emerald-500/30">
                  PAYPAL REST CERTIFIED
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Terms of Service, GDPR/DPDP Privacy Policy, 18% GST Disclosures &amp; Merchant Policies
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              title="Print legal documentation"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all text-xs flex items-center gap-1.5 border border-slate-800"
            >
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </button>

            <button
              onClick={handleCopyLink}
              title="Copy link to document"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all text-xs flex items-center gap-1.5 border border-slate-800"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
            </button>

            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/60 px-6 py-2 overflow-x-auto text-xs font-semibold">
          <button
            onClick={() => setActiveTab('terms')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
              activeTab === 'terms'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>Terms of Service</span>
          </button>

          <button
            onClick={() => setActiveTab('privacy')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
              activeTab === 'privacy'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Lock className="h-4 w-4" />
            <span>Privacy Policy (GDPR / DPDP)</span>
          </button>

          <button
            onClick={() => setActiveTab('gst')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
              activeTab === 'gst'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Receipt className="h-4 w-4" />
            <span>18% GST &amp; Tax Compliance</span>
          </button>

          <button
            onClick={() => setActiveTab('refunds')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
              activeTab === 'refunds'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>Refund &amp; Cancellation Policy</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 text-slate-300 text-xs sm:text-sm leading-relaxed space-y-6">
          
          {/* TAB 1: TERMS OF SERVICE */}
          {activeTab === 'terms' && (
            <div className="space-y-6">
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-lg font-bold text-white">Terms of Service</h3>
                <p className="text-xs text-slate-400 mt-1">Last Updated: August 2026 • Effective Date: Immediate</p>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-white">1. Agreement to Terms</h4>
                  <p className="text-slate-300 mt-1">
                    By accessing or using Kundan Vision AI Technologies and its autonomous freelance automation platform, you agree to be bound by these Terms of Service. If you disagree with any part of these terms, you must not access the service.
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">2. Description of Services &amp; AI Proposal Generation</h4>
                  <p className="text-slate-300 mt-1">
                    The platform provides autonomous job feed aggregation (RemoteOK, Upwork, Freelancer.com), speed alerts via Telegram &amp; Email, AI-powered proposal copywriting powered by Google Gemini, and automated payment gateway connections (Stripe, Razorpay, PayPal, Bank Transfers).
                  </p>
                  <div className="mt-2 rounded-xl bg-slate-800/60 border border-slate-700/60 p-3 text-xs text-slate-300">
                    <strong className="text-amber-400 font-semibold">AI Content Disclaimer:</strong> All proposals and bids generated by the AI are automated drafts. You retain sole responsibility for reviewing and validating the accuracy, deliverables, milestones, and quotes before submitting bids to prospective clients.
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">3. Pricing, Credits &amp; Paid Production Tier</h4>
                  <p className="text-slate-300 mt-1">
                    Proposal generation is charged on a per-credit basis ($1.00 USD or ₹85.00 INR per proposal credit) or via monthly speed subscription plans. Credits are deducted automatically upon successful generation of each high-converting proposal.
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">4. Payment Processing (Stripe &amp; Razorpay)</h4>
                  <p className="text-slate-300 mt-1">
                    Payments are processed securely via Stripe Inc. (international cards) and Razorpay Software Private Limited (UPI, RuPay cards, Indian NetBanking). All transactions are encrypted with TLS 1.3 and comply with PCI-DSS standards. We do not store raw card numbers on our servers.
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">5. Account Credentials &amp; Scraping Safety</h4>
                  <p className="text-slate-300 mt-1">
                    Session cookies and tokens uploaded for headless scraper integration are encrypted at rest using AES-256-GCM. Users are solely responsible for ensuring compliance with third-party freelance marketplace rules.
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">6. Limitation of Liability</h4>
                  <p className="text-slate-300 mt-1">
                    In no event shall Kundan Vision AI Technologies or its directors be liable for any indirect, incidental, special, consequential, or punitive damages resulting from client contract outcomes or third-party platform API changes.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PRIVACY POLICY */}
          {activeTab === 'privacy' && (
            <div className="space-y-6">
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-lg font-bold text-white">Privacy Policy (GDPR, CCPA &amp; Indian DPDP Act 2023)</h3>
                <p className="text-xs text-slate-400 mt-1">Committed to zero unencrypted data exposure and privacy by design</p>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-white">1. Information We Collect</h4>
                  <ul className="list-disc list-inside space-y-1.5 text-slate-300 mt-1">
                    <li><strong className="text-slate-200">Account &amp; Contact:</strong> Name, email address (ky8402@gmail.com), phone number, and Telegram Chat ID for speed alert dispatching.</li>
                    <li><strong className="text-slate-200">Freelancer Profile:</strong> Professional title, skills, hourly rate, bio, and proposal tone preferences.</li>
                    <li><strong className="text-slate-200">Payment &amp; Billing Data:</strong> Transaction references, Stripe customer IDs, Razorpay order IDs, GSTIN for tax invoice generation.</li>
                    <li><strong className="text-slate-200">Scraper Session State:</strong> Encrypted authentication cookies stored locally in session storage or secured container storage.</li>
                  </ul>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">2. How We Use Your Data</h4>
                  <p className="text-slate-300 mt-1">
                    We use collected data solely to:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-slate-300 mt-1">
                    <li>Send instant sub-second lead notifications to your designated Telegram bot and Email.</li>
                    <li>Power server-side Gemini 3.7 Flash API calls for proposal copywriting.</li>
                    <li>Generate legal GST Tax Invoices (SAC 998315) and record revenue transactions.</li>
                    <li>Maintain real-time webhook activity and error diagnostics.</li>
                  </ul>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">3. Third-Party Service Providers</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                    <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                      <div className="font-bold text-white">Google Gemini API</div>
                      <div className="text-xs text-slate-400 mt-0.5">Processes proposal prompts server-side without training public models on your customer data.</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                      <div className="font-bold text-white">Stripe Inc.</div>
                      <div className="text-xs text-slate-400 mt-0.5">Processes international subscription billing and credit pack checkouts.</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                      <div className="font-bold text-white">Razorpay Software Pvt Ltd</div>
                      <div className="text-xs text-slate-400 mt-0.5">Processes domestic Indian UPI, NetBanking, RuPay payments &amp; GST tax collection.</div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                      <div className="font-bold text-white">Telegram Bot API</div>
                      <div className="text-xs text-slate-400 mt-0.5">Delivers instant smartphone push alerts for matching job opportunities.</div>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">4. Your Data Rights &amp; Deletion</h4>
                  <p className="text-slate-300 mt-1">
                    You have the right to request export or complete deletion of your profile, proposal history, and session tokens at any time by contacting compliance at <a href="mailto:ky8402@gmail.com" className="text-indigo-400 underline">ky8402@gmail.com</a>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: GST & TAX COMPLIANCE */}
          {activeTab === 'gst' && (
            <div className="space-y-6">
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-lg font-bold text-white">Indian Goods &amp; Services Tax (GST) Disclosures</h3>
                <p className="text-xs text-slate-400 mt-1">Compliance with Central GST Act 2017 &amp; Integrated GST Act 2017</p>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/60 p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-slate-400 block">Service Accounting Code (SAC):</span>
                      <span className="text-white font-mono font-bold text-sm">998315 / 998314</span>
                      <span className="text-slate-400 block text-[11px] mt-0.5">Hosting, IT Infrastructure &amp; AI Proposal Software Services</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Applicable GST Tax Rate:</span>
                      <span className="text-emerald-400 font-mono font-bold text-sm">18.00%</span>
                      <span className="text-slate-400 block text-[11px] mt-0.5">Calculated on all domestic Indian transactions</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Registered Legal Entity:</span>
                      <span className="text-white font-bold">Kundan Vision AI Technologies Pvt Ltd</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Merchant GSTIN:</span>
                      <span className="text-indigo-300 font-mono font-bold">27AABCK3690F1Z9 (Maharashtra)</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">Tax Calculation Rules</h4>
                  <ul className="list-disc list-inside space-y-1.5 text-slate-300 mt-1">
                    <li><strong className="text-slate-200">Intra-State Supply (Maharashtra):</strong> Central GST (CGST) 9% + State GST (SGST) 9% = 18%.</li>
                    <li><strong className="text-slate-200">Inter-State Supply (Other Indian States):</strong> Integrated GST (IGST) 18%.</li>
                    <li><strong className="text-slate-200">B2B Input Tax Credit (ITC):</strong> Businesses entering a valid 15-digit GSTIN receive an official Tax Invoice containing their GSTIN to claim 100% input tax credit against their output tax liability.</li>
                    <li><strong className="text-slate-200">Export of Services (Zero Rated):</strong> Foreign transactions processed in USD via Stripe or PayPal are classified as export of services under Letter of Undertaking (LUT).</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: REFUNDS & CANCELLATION */}
          {activeTab === 'refunds' && (
            <div className="space-y-6">
              <div className="border-b border-slate-800 pb-4">
                <h3 className="text-lg font-bold text-white">Refund &amp; Cancellation Policy</h3>
                <p className="text-xs text-slate-400 mt-1">Transparent consumer protection policy for digital goods and subscriptions</p>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-white">1. AI Proposal Credits</h4>
                  <p className="text-slate-300 mt-1">
                    AI proposal credits are digital tokens consumed instantly upon generating custom bidding copy. Once a credit is consumed to generate a proposal, it is non-refundable. If an API system error occurs during generation where no text is produced, the credit is automatically restored to your account balance.
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">2. Speed Radar Subscriptions</h4>
                  <p className="text-slate-300 mt-1">
                    Monthly subscriptions ($29/mo or $79/mo) can be cancelled at any time through your account portal or by contacting support. Cancellation takes effect at the end of the current paid billing period with no further auto-renewals.
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white">3. Merchant Dispute Resolution</h4>
                  <p className="text-slate-300 mt-1">
                    If you experience any billing discrepancy, duplicate charge, or failed webhook delivery, please contact our merchant support team at <a href="mailto:ky8402@gmail.com" className="text-cyan-400 underline">ky8402@gmail.com</a> within 14 days for resolution or refund processing via original payment method (PayPal REST Gateway).
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/90 px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>Kundan Vision AI Technologies • Registered Merchant</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            I Understand &amp; Agree
          </button>
        </div>

      </div>
    </div>
  );
};
