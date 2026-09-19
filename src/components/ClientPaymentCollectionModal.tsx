import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  QrCode,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  X,
  CreditCard,
  ShieldCheck,
  Receipt,
  Download,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Building,
  Printer
} from 'lucide-react';
import {
  fetchPaymentCollectionLinks,
  recordClientPayment,
  PaymentCollectionLinks,
  PaymentCollectionRecord
} from '../services/api';
import { PayPalSdkV6Button } from './PayPalSdkV6Button';
import { printOrSaveInvoicePdf } from '../utils/invoicePdfGenerator';

interface ClientPaymentCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId?: string | number;
  initialAmount?: number;
  clientName?: string;
  projectTitle?: string;
  onPaymentSuccess?: (payment: PaymentCollectionRecord) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const ClientPaymentCollectionModal: React.FC<ClientPaymentCollectionModalProps> = ({
  isOpen,
  onClose,
  orderId,
  initialAmount = 250,
  clientName = 'Valued Client',
  projectTitle = 'Freelance Engineering Deliverable',
  onPaymentSuccess,
  showToast,
}) => {
  const [amountUsd, setAmountUsd] = useState<number>(initialAmount);
  const [name, setName] = useState<string>(clientName);
  const [email, setEmail] = useState<string>('');
  const [selectedMethod, setSelectedMethod] = useState<'payoneer' | 'paypal' | 'instant_escrow'>('payoneer');
  const [paymentLinks, setPaymentLinks] = useState<PaymentCollectionLinks | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [completedPayment, setCompletedPayment] = useState<PaymentCollectionRecord | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAmountUsd(initialAmount || 250);
      setName(clientName || 'Valued Client');
      setCompletedPayment(null);
      loadLinks(initialAmount || 250, clientName);
    }
  }, [isOpen, initialAmount, clientName]);

  const loadLinks = async (usd: number, cName?: string) => {
    try {
      const links = await fetchPaymentCollectionLinks({
        amountUsd: usd,
        clientName: cName,
        memo: `Deliverables: ${projectTitle}`,
      });
      setPaymentLinks(links);
    } catch (err: any) {
      console.warn('Failed to load payment links:', err);
    }
  };

  const handleAmountChange = (newUsd: number) => {
    const valid = Math.max(1, newUsd);
    setAmountUsd(valid);
    loadLinks(valid, name);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(true);
    showToast('Payment link copied to clipboard!', 'info');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCollectMoney = async () => {
    setIsProcessing(true);
    try {
      const res = await recordClientPayment({
        orderId,
        clientName: name,
        clientEmail: email.trim() || undefined,
        description: `Deliverable Settle: ${projectTitle}`,
        amountUsd,
        paymentMethod: selectedMethod,
      });

      if (res.success && res.payment) {
        setCompletedPayment(res.payment);
        showToast(`Collected $${res.payment.amountUsd} USD (₹${res.payment.amountInr.toLocaleString('en-IN')}) successfully!`, 'success');
        onPaymentSuccess?.(res.payment);
      }
    } catch (err: any) {
      showToast(`Collection failed: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0f1422] border border-emerald-500/40 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-emerald-950/30 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                Direct Money Collection Gateway
              </span>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Collect Payment from Client
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          
          {/* If already completed, show celebratory receipt */}
          {completedPayment ? (
            <div className="space-y-4 py-2 text-center">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/10">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="space-y-1">
                <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest">
                  Payment Successfully Collected &amp; Settled
                </span>
                <h3 className="text-2xl font-black text-white">
                  ${completedPayment.amountUsd.toFixed(2)} USD
                </h3>
                <p className="text-xs text-slate-400">
                  Equivalent to ₹{completedPayment.amountInr.toLocaleString('en-IN')} INR deposited into {completedPayment.payoutDestination}
                </p>
              </div>

              {/* Receipt Details Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 text-left space-y-2.5 max-w-lg mx-auto">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                  <span className="text-slate-400">Invoice Reference</span>
                  <span className="font-mono font-bold text-white">{completedPayment.invoiceNumber}</span>
                </div>
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                  <span className="text-slate-400">Client</span>
                  <span className="font-semibold text-white">{completedPayment.clientName}</span>
                </div>
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                  <span className="text-slate-400">Method</span>
                  <span className="font-mono text-emerald-400 uppercase">{completedPayment.paymentMethod}</span>
                </div>
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                  <span className="text-slate-400">Timestamp</span>
                  <span className="text-slate-300 font-mono">{new Date(completedPayment.paidAt).toLocaleString()}</span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono break-all pt-1">
                  TxHash: {completedPayment.transactionHash}
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={() => {
                    printOrSaveInvoicePdf({
                      id: completedPayment.invoiceNumber,
                      orderTitle: projectTitle || 'Client Deliverable Settlement',
                      clientName: completedPayment.clientName,
                      clientEmail: email || undefined,
                      amount: completedPayment.amountUsd,
                      currency: 'USD',
                      date: completedPayment.paidAt,
                      status: 'Paid',
                      transactionHash: completedPayment.transactionHash
                    });
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-md cursor-pointer"
                  title="Generate Official PDF with Payoneer ${PAYONEER_BANK_NAME} Payment Instructions"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print / Save PDF</span>
                </button>

                <button
                  onClick={() => {
                    const printable = `INVOICE & PROOF OF PAYMENT\nInvoice: ${completedPayment.invoiceNumber}\nClient: ${completedPayment.clientName}\nAmount: $${completedPayment.amountUsd} USD\nPaid: ${completedPayment.paidAt}\nTxHash: ${completedPayment.transactionHash}\n\nPAYMENT INSTRUCTIONS & REMITTANCE ON RECORD:\nBank Name: ${PAYONEER_BANK_NAME}\nBank Address: ${PAYONEER_BANK_ADDRESS}\nBeneficiary: Kundan Kumar\nAccount Number: ${PAYONEER_ACCOUNT_NUMBER}\nAccount Type: CHECKING\nRouting (ABA): ${PAYONEER_ROUTING_ABA}\nSWIFT / BIC: ${PAYONEER_SWIFT}\nPayPal: ${PAYPAL_ME_URL}`;
                    const blob = new Blob([printable], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${completedPayment.invoiceNumber}_receipt.txt`;
                    a.click();
                  }}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Text Receipt</span>
                </button>

                <button
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold transition-all cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Payment Config Box */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Amount to Collect (USD) *
                  </label>
                  <div className="relative">
                    <DollarSign className="w-4 h-4 text-emerald-400 absolute left-3 top-2.5" />
                    <input
                      type="number"
                      min="1"
                      value={amountUsd}
                      onChange={(e) => handleAmountChange(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-sm font-bold text-white focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  {paymentLinks && (
                    <span className="text-[11px] text-slate-400 mt-1 block">
                      ≈ {paymentLinks.formattedInr} at ₹83.25/USD
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Client Name / Org *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Alex Chen (Apex Fintech)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Method Selector Tabs */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Collection Channel:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMethod('payoneer')}
                    className={`p-3 rounded-2xl border text-center transition-all cursor-pointer relative overflow-hidden ${
                      selectedMethod === 'payoneer'
                        ? 'bg-sky-600/20 border-sky-400 text-white shadow-md shadow-sky-500/10'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="text-[9px] bg-emerald-500/25 text-emerald-300 font-bold px-1.5 py-0.2 rounded border border-emerald-500/30 uppercase tracking-wider block w-fit mx-auto mb-1">
                      Primary
                    </span>
                    <span className="text-xs font-bold block">Payoneer USD</span>
                    <span className="text-[10px] text-sky-400 font-mono">${PAYONEER_BANK_NAME} ACH / Wire</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMethod('paypal')}
                    className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                      selectedMethod === 'paypal'
                        ? 'bg-blue-600/20 border-blue-500 text-white shadow-md'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">Instant</span>
                    <span className="text-xs font-bold block">PayPal.me</span>
                    <span className="text-[10px] text-blue-400 font-mono">Auto-Swept</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedMethod('instant_escrow')}
                    className={`p-3 rounded-2xl border text-center transition-all cursor-pointer ${
                      selectedMethod === 'instant_escrow'
                        ? 'bg-purple-600/20 border-purple-500 text-white shadow-md'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="text-[9px] text-slate-400 uppercase tracking-wider block mb-1">Milestone</span>
                    <span className="text-xs font-bold block">Instant Escrow</span>
                    <span className="text-[10px] text-purple-400 font-mono">Direct Release</span>
                  </button>
                </div>
              </div>

              {/* Active Method Details Area */}
              {selectedMethod === 'payoneer' && (
                <div className="rounded-2xl border border-sky-500/40 bg-sky-950/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Primary Collection Account: Payoneer ${PAYONEER_BANK_NAME} USD Checking</span>
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      ${amountUsd} USD
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Bank Name &amp; Address:</span>
                      <strong className="text-white">${PAYONEER_BANK_NAME}</strong>
                      <span className="text-slate-400 block text-[10px]">111 Wall Street, New York, NY 10043</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Beneficiary / Account Holder:</span>
                      <strong className="text-white">Kundan Kumar</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Account Number &amp; Type:</span>
                      <div className="flex items-center gap-2">
                        <strong className="text-white">${PAYONEER_ACCOUNT_NUMBER}</strong>
                        <button
                          onClick={() => handleCopy('${PAYONEER_ACCOUNT_NUMBER}')}
                          className="text-[10px] text-sky-400 hover:underline flex items-center gap-0.5"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <span className="text-emerald-400 text-[10px]">CHECKING</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Routing (ABA) &amp; SWIFT:</span>
                      <div className="text-slate-200">
                        ABA: <strong className="text-sky-300">${PAYONEER_ROUTING_ABA}</strong> &bull; SWIFT: <strong className="text-cyan-300">${PAYONEER_SWIFT}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-xs">
                    <button
                      onClick={() => {
                        const instructions = `PRIMARY PAYMENT INSTRUCTIONS (Payoneer ${PAYONEER_BANK_NAME} USD Wire/ACH):\nBank Name: ${PAYONEER_BANK_NAME}\nBank Address: ${PAYONEER_BANK_ADDRESS}\nBeneficiary: Kundan Kumar\nAccount Number: ${PAYONEER_ACCOUNT_NUMBER}\nAccount Type: CHECKING\nRouting (ABA): ${PAYONEER_ROUTING_ABA}\nSWIFT / BIC: ${PAYONEER_SWIFT}\nCurrency: USD\nAmount Due: $${amountUsd} USD`;
                        handleCopy(instructions);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-sky-900/60 hover:bg-sky-800 text-sky-200 text-xs font-sans font-semibold flex items-center gap-1.5 transition cursor-pointer border border-sky-700/50"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Full Wire Remittance Memo</span>
                    </button>

                    <button
                      onClick={() => {
                        printOrSaveInvoicePdf({
                          invoiceNumber: `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
                          date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
                          clientName: name || 'Valued Client',
                          clientEmail: email || 'client@enterprise.com',
                          jobTitle: projectTitle,
                          amountUsd,
                          status: 'Pending Payment',
                        });
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-900/50 hover:bg-emerald-800 text-emerald-200 text-xs font-sans font-semibold flex items-center gap-1.5 transition cursor-pointer border border-emerald-700/50"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Generate &amp; Print PDF Invoice</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Active Method Details Area */}
              {selectedMethod === 'paypal' && paymentLinks && (
                <div className="rounded-2xl border border-blue-500/30 bg-blue-950/15 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-400" />
                      <span>Verified PayPal Direct Payment Link</span>
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      ${amountUsd} USD
                    </span>
                  </div>

                  <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 truncate">
                    <span className="truncate flex-1">{paymentLinks.paypalUrl}</span>
                    <button
                      onClick={() => handleCopy(paymentLinks.paypalUrl)}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-sans font-semibold flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      {copiedLink ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                    <span>Destination: <strong>PayPal.me/${PAYPAL_ME_USERNAME}</strong> <span className="text-slate-500">(${PAYPAL_RECEIVER_EMAIL})</span></span>
                    <a
                      href={paymentLinks.paypalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <span>Open Checkout Page</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  {/* Interactive In-App PayPal Checkout Button */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                      Or Pay Directly with PayPal In-App:
                    </span>
                    <PayPalSdkV6Button
                      amount={amountUsd}
                      currency="USD"
                      description={`Payment for Order #${orderId || 'Direct'}: ${projectTitle}`}
                      clientName={name}
                      onSuccess={(_orderId) => {
                        handleCollectMoney();
                      }}
                      onError={(err) => {
                        console.warn('[PayPal Modal] Notice:', err);
                      }}
                    />
                  </div>
                </div>
              )}

              {selectedMethod === 'instant_escrow' && (
                <div className="rounded-2xl border border-purple-500/30 bg-purple-950/15 p-4 space-y-2 text-xs text-slate-300">
                  <h4 className="font-bold text-white flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-purple-400" />
                    <span>Instant Marketplace Escrow Release</span>
                  </h4>
                  <p>
                    For clients on Freelancer or RemoteOK, this approves the milestone and immediately deposits the cleared funds into your platform account balance.
                  </p>
                </div>
              )}

              {/* Direct Execution Action */}
              <div className="pt-2">
                <button
                  onClick={handleCollectMoney}
                  disabled={isProcessing}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm transition-all shadow-xl shadow-emerald-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>
                    {isProcessing ? 'Recording & Verifying Payment...' : `⚡ Collect $${amountUsd} USD Now & Settle`}
                  </span>
                </button>
                <p className="text-[11px] text-center text-slate-500 mt-2">
                  Generates an immutable cryptographic invoice receipt and credits your wallet.
                </p>
              </div>
            </>
          )}

        </div>

      </div>
    </div>
  );
};
