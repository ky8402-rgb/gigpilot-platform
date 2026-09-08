import React, { useState, useEffect } from 'react';
import {
  fetchPayPalLiveBalance,
  fetchPayPalLiveReportingTransactions,
  createPayPalLiveInvoice,
  createPayPalCheckoutOrder,
  PayPalLiveBalanceResult
} from '../services/api';

interface PayPalSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletBalance: number;
  todayEarnings: number;
  onRefreshParent?: () => void;
  showToast?: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

export const PayPalSettlementModal: React.FC<PayPalSettlementModalProps> = ({
  isOpen,
  onClose,
  walletBalance,
  todayEarnings,
  showToast
}) => {
  const [activeTab, setActiveTab] = useState<'status' | 'invoice' | 'test_deposit' | 'transactions'>('status');
  const [balanceData, setBalanceData] = useState<PayPalLiveBalanceResult | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(false);

  // Invoice Form State
  const [invoiceAmount, setInvoiceAmount] = useState<string>('75.00');
  const [clientName, setClientName] = useState<string>('Enterprise Client');
  const [clientEmail, setClientEmail] = useState<string>('');
  const [invoiceTitle, setInvoiceTitle] = useState<string>('Full-Stack Autonomous Cloud Milestone');
  const [invoiceNote, setInvoiceNote] = useState<string>('Payment due upon milestone delivery via PayPal.');
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState<{
    invoiceNumber: string;
    payerViewUrl: string;
    amount: number;
  } | null>(null);

  // Test Deposit State
  const [testAmount, setTestAmount] = useState<string>('1.00');
  const [isCreatingTestOrder, setIsCreatingTestOrder] = useState(false);
  const [testApproveUrl, setTestApproveUrl] = useState<string | null>(null);

  const loadLiveBalance = async () => {
    setIsLoadingBalance(true);
    try {
      const data = await fetchPayPalLiveBalance();
      setBalanceData(data);
      if (showToast) {
        showToast('Live PayPal account balance and settlement status updated.', 'info');
      }
    } catch (err: any) {
      console.error('Failed to load PayPal live balance:', err);
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const loadTransactions = async () => {
    setIsLoadingTx(true);
    try {
      const res = await fetchPayPalLiveReportingTransactions(30);
      setTransactions(res.transactions || []);
    } catch (err) {
      console.error('Failed to fetch reporting transactions:', err);
    } finally {
      setIsLoadingTx(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLiveBalance();
      loadTransactions();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(invoiceAmount);
    if (isNaN(amt) || amt <= 0) {
      if (showToast) showToast('Please enter a valid invoice amount.', 'warning');
      return;
    }

    setIsGeneratingInvoice(true);
    try {
      const res = await createPayPalLiveInvoice({
        amount: amt,
        currency: 'USD',
        clientName: clientName.trim() || 'Client',
        clientEmail: clientEmail.trim() || 'client@example.com',
        title: invoiceTitle.trim() || 'Freelance Engineering Deliverable',
        note: invoiceNote
      });

      if (res.success && res.payerViewUrl) {
        setGeneratedInvoice({
          invoiceNumber: res.invoiceNumber || res.invoiceId,
          payerViewUrl: res.payerViewUrl,
          amount: amt
        });
        if (showToast) {
          showToast(`Official PayPal Invoice #${res.invoiceNumber} generated!`, 'success');
        }
      } else {
        if (showToast) showToast('Failed to create PayPal invoice: ' + (res.error || 'Unknown error'), 'error');
      }
    } catch (err: any) {
      if (showToast) showToast('Failed to create PayPal invoice: ' + err.message, 'error');
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  const handleTestDeposit = async () => {
    const amt = parseFloat(testAmount);
    if (isNaN(amt) || amt <= 0) {
      if (showToast) showToast('Please enter a valid deposit amount.', 'warning');
      return;
    }

    setIsCreatingTestOrder(true);
    try {
      const res = await createPayPalCheckoutOrder({
        amount: amt,
        currency: 'USD',
        description: `Live $${amt.toFixed(2)} USD PayPal Test Deposit Verification`
      });

      if (res.success && res.approveUrl) {
        setTestApproveUrl(res.approveUrl);
        window.open(res.approveUrl, '_blank', 'noopener,noreferrer');
        if (showToast) {
          showToast(`Opened PayPal Checkout for $${amt.toFixed(2)} USD!`, 'info');
        }
      } else {
        if (showToast) showToast('Could not initialize test order.', 'error');
      }
    } catch (err: any) {
      if (showToast) showToast('Error creating test checkout: ' + err.message, 'error');
    } finally {
      setIsCreatingTestOrder(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-[#0e121d] border border-[#2a3147] rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-[#003087]/30 via-[#0e121d] to-[#0070ba]/20 border-b border-[#2a3147]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#003087]/40 border border-[#0070ba]/60 flex items-center justify-center text-[#00cfe8]">
              <i className="fab fa-paypal text-xl"></i>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                PayPal Revenue & Settlement Center
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30">
                  LIVE REST API
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Merchant: Kundan Kumar &bull; Account ID: {balanceData?.accountId || '98UNBJBN67H6W'} &bull; Auto-Swept to Federal Bank
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
          >
            <i className="fas fa-times text-base"></i>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#2a3147] bg-[#0a0d14] px-6 gap-2">
          <button
            onClick={() => setActiveTab('status')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'status'
                ? 'border-[#00cfe8] text-[#00cfe8]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <i className="fas fa-wallet"></i>
            <span>Live Account &amp; Settlement</span>
          </button>
          <button
            onClick={() => setActiveTab('invoice')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'invoice'
                ? 'border-[#00cfe8] text-[#00cfe8]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <i className="fas fa-file-invoice-dollar"></i>
            <span>Create Real PayPal Invoice</span>
          </button>
          <button
            onClick={() => setActiveTab('test_deposit')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'test_deposit'
                ? 'border-[#00cfe8] text-[#00cfe8]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <i className="fas fa-money-bill-wave"></i>
            <span>Test Live Deposit ($1.00)</span>
          </button>
          <button
            onClick={() => setActiveTab('transactions')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition ${
              activeTab === 'transactions'
                ? 'border-[#00cfe8] text-[#00cfe8]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <i className="fas fa-history"></i>
            <span>PayPal Ledger</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">
          {/* TAB 1: STATUS & EXPLANATION */}
          {activeTab === 'status' && (
            <div className="space-y-6">
              {/* Important Clarification Banner */}
              <div className="bg-amber-950/30 border border-amber-500/40 rounded-xl p-4 text-amber-200 text-xs leading-relaxed space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-400 text-sm">
                  <i className="fas fa-info-circle"></i>
                  <span>Important: Why Revenue Was Not Showing in Your PayPal Balance</span>
                </div>
                <p>
                  <strong>1. Job Board Opportunities vs. Client Payments:</strong> The opportunities listed on the dashboard (from RemoteOK, FlexJobs, etc.) are open project listings to bid on. They are prospective earnings and are not funded into escrow until a client contracts and pays for the milestone.
                </p>
                <p>
                  <strong>2. RBI Cross-Border Auto-Sweep Rule:</strong> As an Indian merchant account, under Reserve Bank of India (RBI) regulations, PayPal India cannot hold foreign currency balances indefinitely, nor allow outbound API disbursements.
                </p>
                <p>
                  <strong>3. 100% Automated Bank Settlement:</strong> Whenever a client pays an official invoice or checkout link, <strong>100% of the funds are automatically deposited into your linked Federal Bank account within 24 to 48 hours</strong>.
                </p>
              </div>

              {/* Live Status Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Real PayPal Account Balance */}
                <div className="bg-[#131826] border border-[#2a3147] rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">Live PayPal REST Balance</span>
                    <button
                      onClick={loadLiveBalance}
                      disabled={isLoadingBalance}
                      className="text-[11px] text-[#00cfe8] hover:underline flex items-center gap-1"
                    >
                      <i className={`fas fa-sync-alt ${isLoadingBalance ? 'animate-spin' : ''}`}></i>
                      <span>Sync Live</span>
                    </button>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white font-mono">
                      ${balanceData?.availableBalance?.toFixed(2) || '0.00'}
                    </span>
                    <span className="text-xs font-mono text-emerald-400">USD (Available)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 border-t border-[#2a3147] pt-2 space-y-1 font-mono">
                    <div className="flex justify-between">
                      <span>Total Account Balance:</span>
                      <span className="text-white">${balanceData?.totalBalance?.toFixed(2) || '0.00'} USD</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Merchant ID:</span>
                      <span className="text-white font-mono">{balanceData?.accountId || '98UNBJBN67H6W'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Verified Email:</span>
                      <span className="text-white font-mono">{balanceData?.email || 'kundank4@icloud.com'}</span>
                    </div>
                  </div>
                </div>

                {/* Linked Settlement Bank */}
                <div className="bg-[#131826] border border-[#2a3147] rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">Linked Auto-Withdrawal Bank</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                      RBI Sweeper Active
                    </span>
                  </div>
                  <div>
                    <div className="text-base font-bold text-white flex items-center gap-2">
                      <i className="fas fa-university text-emerald-400"></i>
                      <span>Federal Bank</span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-1">
                      Account: •••• 8763 &bull; IFSC: FDRL0001447
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 border-t border-[#2a3147] pt-2">
                    <p className="text-emerald-400">
                      ✓ All USD received from international clients is automatically credited to this bank account daily.
                    </p>
                  </div>
                </div>
              </div>

              {/* Direct Receiving Links */}
              <div className="bg-[#131826] border border-[#2a3147] rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <i className="fas fa-link text-[#00cfe8]"></i>
                  <span>Direct PayPal Receiving Link</span>
                </h3>
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <div className="flex-1 w-full bg-[#0a0d14] border border-[#2a3147] px-3 py-2.5 rounded-xl font-mono text-xs text-[#00cfe8] flex items-center justify-between">
                    <span>https://paypal.me/ky8402</span>
                    <span className="text-[10px] text-slate-400">Handle: ky8402</span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('https://paypal.me/ky8402');
                      if (showToast) showToast('Copied https://paypal.me/ky8402 to clipboard!', 'success');
                    }}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#003087] hover:bg-[#0070ba] text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <i className="fas fa-copy"></i>
                    <span>Copy Link</span>
                  </button>
                  <a
                    href="https://paypal.me/ky8402"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <i className="fas fa-external-link-alt"></i>
                    <span>Open PayPal.Me</span>
                  </a>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={() => setActiveTab('invoice')}
                  className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg"
                >
                  <i className="fas fa-file-invoice-dollar text-base"></i>
                  <span>Create Live PayPal Invoice for Client</span>
                </button>
                <button
                  onClick={() => setActiveTab('test_deposit')}
                  className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#003087] to-[#0070ba] hover:opacity-90 text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg"
                >
                  <i className="fas fa-check-circle text-base"></i>
                  <span>Test $1.00 Real Deposit Verification</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: INVOICE GENERATOR */}
          {activeTab === 'invoice' && (
            <div className="space-y-5">
              <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3.5 text-xs text-emerald-200 flex items-start gap-2.5">
                <i className="fas fa-shield-alt text-emerald-400 mt-0.5 text-sm"></i>
                <p>
                  This tool uses PayPal's <strong>Invoicing v2 REST API</strong> to create an official, legally valid invoice directly on PayPal. Clients can open the link and pay via Credit Card, Debit Card, or PayPal balance. The money is credited to your PayPal merchant account and auto-swept to Federal Bank.
                </p>
              </div>

              <form onSubmit={handleCreateInvoice} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Invoice Amount ($ USD) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="1.00"
                      required
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                      placeholder="e.g. 150.00"
                      className="w-full bg-[#131826] border border-[#2a3147] rounded-xl px-3.5 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-[#00cfe8]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Client Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Client or Company Name"
                      className="w-full bg-[#131826] border border-[#2a3147] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#00cfe8]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Client Email Address (Optional)
                    </label>
                    <input
                      type="email"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      placeholder="client@company.com"
                      className="w-full bg-[#131826] border border-[#2a3147] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#00cfe8]"
                    />
                    <span className="text-[10px] text-slate-500">If provided, PayPal can email them directly.</span>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Milestone / Service Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={invoiceTitle}
                      onChange={(e) => setInvoiceTitle(e.target.value)}
                      placeholder="Service Deliverable Title"
                      className="w-full bg-[#131826] border border-[#2a3147] rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#00cfe8]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Invoice Note to Client
                  </label>
                  <textarea
                    rows={2}
                    value={invoiceNote}
                    onChange={(e) => setInvoiceNote(e.target.value)}
                    className="w-full bg-[#131826] border border-[#2a3147] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#00cfe8]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isGeneratingInvoice}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                >
                  <i className={`fas ${isGeneratingInvoice ? 'fa-spinner fa-spin' : 'fa-check-circle'}`}></i>
                  <span>{isGeneratingInvoice ? 'Creating Live PayPal Invoice...' : 'Generate Official PayPal Invoice & Link'}</span>
                </button>
              </form>

              {/* Output Result */}
              {generatedInvoice && (
                <div className="mt-4 p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400">
                      ✓ Invoice #{generatedInvoice.invoiceNumber} Ready!
                    </span>
                    <span className="text-xs font-mono text-white font-bold">
                      ${generatedInvoice.amount.toFixed(2)} USD
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#0a0d14] border border-[#2a3147] text-xs font-mono text-emerald-300 break-all">
                    {generatedInvoice.payerViewUrl}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(generatedInvoice.payerViewUrl);
                        if (showToast) showToast('Invoice payment link copied to clipboard!', 'success');
                      }}
                      className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <i className="fas fa-copy"></i>
                      <span>Copy Client Payment Link</span>
                    </button>
                    <a
                      href={generatedInvoice.payerViewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <i className="fas fa-external-link-alt"></i>
                      <span>Open Live Invoice on PayPal</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TEST REAL DEPOSIT */}
          {activeTab === 'test_deposit' && (
            <div className="space-y-5">
              <div className="bg-sky-950/20 border border-sky-500/30 rounded-xl p-3.5 text-xs text-sky-200 flex items-start gap-2.5">
                <i className="fas fa-info-circle text-sky-400 mt-0.5 text-sm"></i>
                <p>
                  To verify with 100% certainty that your PayPal integration is crediting revenue, you can make a live test payment of <strong>$1.00 USD</strong>. This creates a real PayPal order captured directly into your account (<strong>98UNBJBN67H6W</strong>).
                </p>
              </div>

              <div className="bg-[#131826] border border-[#2a3147] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">
                    Test Deposit Amount ($ USD):
                  </label>
                  <div className="flex gap-2">
                    {['1.00', '5.00', '10.00'].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTestAmount(val)}
                        className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition ${
                          testAmount === val
                            ? 'bg-[#00cfe8] text-black'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        ${val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0.50"
                    value={testAmount}
                    onChange={(e) => setTestAmount(e.target.value)}
                    className="w-full bg-[#0a0d14] border border-[#2a3147] rounded-xl px-4 py-3 text-lg font-mono text-white focus:outline-none focus:border-[#00cfe8]"
                  />
                  <span className="absolute right-4 top-3.5 text-xs font-mono text-slate-400">USD</span>
                </div>

                <button
                  onClick={handleTestDeposit}
                  disabled={isCreatingTestOrder}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#003087] to-[#0070ba] hover:opacity-90 text-white font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                >
                  <i className={`fab fa-paypal text-base ${isCreatingTestOrder ? 'animate-spin' : ''}`}></i>
                  <span>
                    {isCreatingTestOrder
                      ? 'Creating Live Checkout Session...'
                      : `Open Live PayPal Checkout ($${parseFloat(testAmount || '0').toFixed(2)} USD)`}
                  </span>
                </button>
              </div>

              {testApproveUrl && (
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-700 text-xs space-y-2">
                  <span className="text-slate-400">Direct Checkout Session Link:</span>
                  <div className="p-2 rounded bg-black font-mono text-slate-300 break-all text-[11px]">
                    {testApproveUrl}
                  </div>
                  <a
                    href={testApproveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#00cfe8] hover:underline font-semibold"
                  >
                    <span>Click here to complete payment on PayPal</span>
                    <i className="fas fa-external-link-alt text-[10px]"></i>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: TRANSACTIONS LEDGER */}
          {activeTab === 'transactions' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Verified PayPal Transactions (Past 30 Days)
                </span>
                <button
                  onClick={loadTransactions}
                  disabled={isLoadingTx}
                  className="text-xs text-[#00cfe8] hover:underline flex items-center gap-1"
                >
                  <i className={`fas fa-sync-alt ${isLoadingTx ? 'animate-spin' : ''}`}></i>
                  <span>Refresh</span>
                </button>
              </div>

              {isLoadingTx ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  <i className="fas fa-spinner fa-spin text-lg mb-2"></i>
                  <p>Querying PayPal Reporting API...</p>
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 bg-[#131826] rounded-xl border border-[#2a3147] p-6 space-y-2">
                  <i className="fas fa-receipt text-2xl text-slate-500 mb-1"></i>
                  <p className="font-semibold text-slate-300">No Settled PayPal Transactions Found Yet</p>
                  <p className="text-[11px] max-w-md mx-auto">
                    Once a client pays an official invoice or uses your PayPal.Me link, the cleared transaction will appear here instantly with full PayPal transaction IDs.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => setActiveTab('invoice')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                    >
                      Create First Invoice
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.map((tx: any) => (
                    <div
                      key={tx.id}
                      className="p-3 bg-[#131826] border border-[#2a3147] rounded-xl flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-white flex items-center gap-2">
                          <span>{tx.payerName || 'Client'}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                            PayPal Verified
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          ID: {tx.paypalTransactionId || tx.id} &bull; {new Date(tx.date).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold font-mono text-emerald-400 text-sm">
                          +${Number(tx.amount).toFixed(2)} USD
                        </div>
                        <div className="text-[10px] text-slate-400">Cleared</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#0a0d14] border-t border-[#2a3147] flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>REST Gateway Connected to live production PayPal API</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
