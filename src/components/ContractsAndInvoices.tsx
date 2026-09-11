import React, { useState } from 'react';
import { 
  Briefcase, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  FileText, 
  MessageSquare, 
  Sparkles, 
  Send, 
  Download, 
  ChevronRight,
  ShieldCheck,
  Check,
  Printer,
  Copy,
  ExternalLink,
  QrCode,
  Share2
} from 'lucide-react';
import { ActiveContract } from '../types';
import { generateClientReply } from '../services/api';
import { PayPalSdkV6Button } from './PayPalSdkV6Button';

interface ContractsAndInvoicesProps {
  contracts: ActiveContract[];
  onCompleteMilestone: (contractId: string, milestoneId: string) => void;
}

export const ContractsAndInvoices: React.FC<ContractsAndInvoicesProps> = ({
  contracts,
  onCompleteMilestone
}) => {
  const [selectedContract, setSelectedContract] = useState<ActiveContract>(contracts[0] || null);
  const [clientMessageInput, setClientMessageInput] = useState("");
  const [negotiationGoal, setNegotiationGoal] = useState("");
  const [aiDraftReply, setAiDraftReply] = useState<string | null>(null);
  const [strategyNotes, setStrategyNotes] = useState<string | null>(null);
  const [isGeneratingReply, setIsGeneratingReply] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState<ActiveContract | null>(null);
  const [invoiceCopied, setInvoiceCopied] = useState(false);

  const handleClearChat = () => {
    setClientMessageInput("");
    setNegotiationGoal("");
    setAiDraftReply(null);
    setStrategyNotes(null);
  };

  const handleGenerateReply = async () => {
    if (!clientMessageInput) return;
    setIsGeneratingReply(true);
    try {
      const res = await generateClientReply(
        clientMessageInput,
        selectedContract,
        selectedContract?.totalValue || 800,
        negotiationGoal
      );
      setAiDraftReply(res.reply);
      setStrategyNotes(res.strategyNotes);
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingReply(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Contracts & Milestone Tracker Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        
        {/* Left Column: Contracts list (5 cols) */}
        <div className="space-y-3 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center">
              <Briefcase className="mr-2 h-4 w-4 text-emerald-400" />
              Active Client Contracts ({contracts.length})
            </h3>
          </div>

          <div className="space-y-3">
            {contracts.map((c) => {
              const isSelected = selectedContract?.id === c.id;
              const completedMilestones = c.milestones.filter(m => m.completed).length;
              const progressPct = Math.round((completedMilestones / c.milestones.length) * 100);

              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedContract(c)}
                  className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                    isSelected
                      ? 'border-emerald-500/50 bg-slate-900/90 shadow-lg shadow-emerald-950/30'
                      : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 font-bold text-emerald-400">
                      {c.platform}
                    </span>
                    <span className="font-mono font-bold text-slate-200">
                      ${c.amountPaid.toLocaleString()} / ${c.totalValue.toLocaleString()}
                    </span>
                  </div>

                  <h4 className="mt-2 font-bold text-slate-100 text-sm">{c.jobTitle}</h4>
                  <p className="text-xs text-slate-400 mt-0.5">Client: <strong className="text-slate-300">{c.clientName}</strong></p>

                  {/* Progress Bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                      <span>Milestones: {completedMilestones}/{c.milestones.length}</span>
                      <span className="text-emerald-400 font-bold">{progressPct}% Paid</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {c.lastMessage && (
                    <div className="mt-3 rounded-lg bg-slate-950/60 p-2 text-[11px] text-slate-400 line-clamp-1 border border-slate-800">
                      💬 "{c.lastMessage}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Contract Details & Milestones (7 cols) */}
        {selectedContract && (
          <div className="space-y-4 lg:col-span-7">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur-sm">
              
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-400">
                      {selectedContract.platform}
                    </span>
                    <span className="text-xs text-slate-400">Started {selectedContract.startedDate}</span>
                  </div>
                  <h3 className="mt-1 text-base font-bold text-white sm:text-lg">{selectedContract.jobTitle}</h3>
                  <p className="text-xs text-slate-400">Client: <span className="text-slate-200 font-semibold">{selectedContract.clientName}</span></p>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setShowInvoiceModal(selectedContract)}
                    className="flex items-center space-x-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-all"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>View Invoice</span>
                  </button>
                </div>
              </div>

              {/* Milestones List */}
              <div className="mt-5 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">Deliverable Milestones</h4>
                
                {selectedContract.milestones.map((m, idx) => (
                  <div
                    key={m.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border p-3.5 gap-3 transition-all ${
                      m.completed 
                        ? 'border-emerald-500/30 bg-emerald-950/15 text-slate-200' 
                        : 'border-slate-800 bg-slate-950/60 text-slate-300'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="mt-0.5">
                        {m.completed ? (
                          <div className="rounded-full bg-emerald-500/20 p-1 text-emerald-400 border border-emerald-500/40">
                            <Check className="h-3.5 w-3.5" />
                          </div>
                        ) : (
                          <div className="rounded-full bg-slate-800 p-1 text-slate-500">
                            <Clock className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="font-bold text-xs sm:text-sm text-slate-100">{m.title}</div>
                        <div className="text-[11px] text-slate-400 flex items-center space-x-2 mt-0.5">
                          <span>Due: {m.dueDate}</span>
                          <span>•</span>
                          <span className="font-mono font-bold text-emerald-400">${m.amount.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div>
                      {m.completed ? (
                        <span className="inline-flex items-center text-xs font-bold text-emerald-400">
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          Escrow Released
                        </span>
                      ) : (
                        <button
                          onClick={() => onCompleteMilestone(selectedContract.id, m.id)}
                          className="w-full sm:w-auto flex items-center justify-center space-x-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 transition-all"
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Deliver & Request Payout
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </div>
        )}

      </div>

      {/* AI Client Negotiation & Objections Co-Pilot */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <div className="rounded-xl bg-purple-500/10 p-2 text-purple-400 border border-purple-500/20">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">AI Client Negotiation & Closing Co-Pilot</h3>
              <p className="text-xs text-slate-400">Draft persuasive, high-converting responses to client questions, discount requests, or scope creep.</p>
            </div>
          </div>
          <span className="hidden sm:inline-flex items-center text-xs font-semibold text-purple-400 font-mono">
            Powered by Gemini 3.7 Flash
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          
          {/* Input column */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-300">Client's Inbound Message / Request:</label>
              <textarea
                rows={3}
                value={clientMessageInput}
                onChange={(e) => setClientMessageInput(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
                placeholder="Paste client inquiry or negotiation pushback here..."
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300">Your Negotiation Target / Goal:</label>
              <input
                type="text"
                value={negotiationGoal}
                onChange={(e) => setNegotiationGoal(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-purple-500 focus:outline-none"
                placeholder="e.g. Defend price, upsell maintenance, prevent unpaid scope..."
              />
            </div>

            {/* Quick prompt templates */}
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <button
                onClick={() => setClientMessageInput("Can you do this for 30% less? We have other freelancers quoting cheaper.")}
                className="rounded bg-slate-800 px-2 py-1 text-slate-400 hover:text-slate-200"
              >
                "Quoting cheaper"
              </button>
              <button
                onClick={() => setClientMessageInput("Can you also include a mobile app version without increasing the budget?")}
                className="rounded bg-slate-800 px-2 py-1 text-slate-400 hover:text-slate-200"
              >
                "Scope creep"
              </button>
              <button
                onClick={() => setClientMessageInput("When can we hop on a call and start?")}
                className="rounded bg-slate-800 px-2 py-1 text-slate-400 hover:text-slate-200"
              >
                "Ready to start"
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleGenerateReply}
                disabled={isGeneratingReply || !clientMessageInput.trim()}
                className="flex-1 flex items-center justify-center space-x-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-purple-950/40 hover:from-purple-500 hover:to-indigo-500 active:scale-95 transition-all disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                <span>{isGeneratingReply ? 'Crafting High-Converting Response...' : 'Draft Strategic AI Reply'}</span>
              </button>
              {(clientMessageInput || negotiationGoal || aiDraftReply) && (
                <button
                  type="button"
                  onClick={handleClearChat}
                  className="px-3 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-all active:scale-95"
                  title="Clear chat and draft"
                >
                  Clear Chat
                </button>
              )}
            </div>
          </div>

          {/* Output column */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>AI Negotiation Draft</span>
                {aiDraftReply && (
                  <button
                    onClick={() => navigator.clipboard.writeText(aiDraftReply)}
                    className="text-purple-400 hover:text-purple-300"
                  >
                    Copy to Clipboard
                  </button>
                )}
              </div>

              {aiDraftReply ? (
                <div className="rounded-lg bg-slate-900/90 p-3 text-xs leading-relaxed text-slate-200 font-mono whitespace-pre-wrap">
                  {aiDraftReply}
                </div>
              ) : (
                <div className="py-10 text-center text-xs text-slate-500">
                  Click "Draft Strategic AI Reply" to generate psychology-grounded negotiation copy.
                </div>
              )}
            </div>

            {strategyNotes && (
              <div className="mt-3 rounded-lg bg-purple-950/30 border border-purple-500/20 p-2.5 text-[11px] text-purple-300">
                <strong>Strategy Rationale:</strong> {strategyNotes}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Real Printable Invoice Modal */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8 shadow-2xl overflow-hidden my-6">
            
            {/* Action Bar (Top) */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
              <div className="flex items-center space-x-2">
                <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-400">
                  Official Client Invoice
                </span>
                <span className="font-mono text-xs text-slate-400">#{showInvoiceModal.id}</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center space-x-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-xs font-semibold transition-all"
                  title="Print or Save as PDF"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Print / Save PDF</span>
                </button>

                <button
                  onClick={() => {
                    const text = `INVOICE #${showInvoiceModal.id}\nPayee: Kundan Kumar\nProject: ${showInvoiceModal.jobTitle}\nClient: ${showInvoiceModal.clientName}\nAmount Due: $${(showInvoiceModal.totalValue - showInvoiceModal.amountPaid).toLocaleString()} USD\n\nBank Transfer:\nBank: Federal Bank\nAccount: 99980119788763\nIFSC: FDRL0001447\nUPI: chandimay@ybl\nPayPal: https://paypal.me/ky8402`;
                    navigator.clipboard.writeText(text);
                    setInvoiceCopied(true);
                    setTimeout(() => setInvoiceCopied(false), 2000);
                  }}
                  className="flex items-center space-x-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 text-xs font-semibold transition-all"
                >
                  {invoiceCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{invoiceCopied ? 'Copied!' : 'Copy Summary'}</span>
                </button>

                <button
                  onClick={() => setShowInvoiceModal(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Printable Invoice Body */}
            <div className="space-y-6 text-xs" id="printable-invoice-content">
              {/* Header Info */}
              <div className="flex flex-col sm:flex-row justify-between gap-4 border-b border-slate-800 pb-5">
                <div>
                  <h2 className="text-lg font-black text-white tracking-tight">Kundan Kumar</h2>
                  <p className="text-slate-400 mt-0.5">Senior Full-Stack &amp; Autonomous Automation Lead</p>
                  <p className="text-slate-500 font-mono mt-1">Email: ky8402@gmail.com</p>
                </div>
                <div className="sm:text-right">
                  <div className="text-slate-400 font-semibold">Date of Issue</div>
                  <div className="text-white font-mono font-bold mt-0.5">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                  <div className="text-slate-400 mt-2 font-semibold">Payment Status</div>
                  <div className={`font-bold uppercase tracking-wider text-xs ${showInvoiceModal.amountPaid >= showInvoiceModal.totalValue ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {showInvoiceModal.amountPaid >= showInvoiceModal.totalValue ? 'Fully Paid' : 'Payment Due / Milestone Active'}
                  </div>
                </div>
              </div>

              {/* Billed To & Contract Scope */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-slate-950 p-4 border border-slate-800">
                <div>
                  <span className="text-slate-500 uppercase font-bold text-[10px] tracking-wider">Client / Recipient:</span>
                  <div className="font-bold text-sm text-slate-100 mt-0.5">{showInvoiceModal.clientName}</div>
                  <div className="text-slate-400 mt-1">Platform Escrow: <strong className="text-emerald-400">{showInvoiceModal.platform}</strong></div>
                  <div className="text-slate-400">Project: <span className="text-slate-300">{showInvoiceModal.jobTitle}</span></div>
                </div>
                <div className="sm:text-right flex flex-col justify-between">
                  <div>
                    <span className="text-slate-500 uppercase font-bold text-[10px] tracking-wider">Total Contract Value:</span>
                    <div className="font-mono text-xl font-black text-emerald-400 mt-0.5">${showInvoiceModal.totalValue.toLocaleString()} USD</div>
                  </div>
                  <div className="text-slate-400 text-xs">
                    Paid: <strong className="text-white font-mono">${showInvoiceModal.amountPaid.toLocaleString()}</strong> | Balance: <strong className="text-amber-400 font-mono">${(showInvoiceModal.totalValue - showInvoiceModal.amountPaid).toLocaleString()}</strong>
                  </div>
                </div>
              </div>

              {/* Milestone Deliverables Breakdown Table */}
              <div className="space-y-2">
                <div className="font-bold uppercase tracking-wider text-[11px] text-slate-300">Deliverable Breakdown</div>
                <div className="rounded-xl border border-slate-800 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-950/80 text-[11px] uppercase text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Milestone / Scope</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Status</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Amount (USD)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {showInvoiceModal.milestones.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-950/40">
                          <td className="py-2.5 px-3 font-sans text-slate-200">{m.title}</td>
                          <td className="py-2.5 px-3 text-center">
                            {m.completed ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 text-emerald-400 px-2 py-0.5 text-[10px] font-bold font-sans">
                                <Check className="w-3 h-3" /> Completed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-slate-800 text-slate-400 px-2 py-0.5 text-[10px] font-semibold font-sans">
                                Pending
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-white">${m.amount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Settlement Instructions (Federal Bank & UPI & PayPal) */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
                <div className="font-bold text-xs text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Official Settlement &amp; Remittance Details</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 space-y-1">
                    <div className="text-emerald-400 font-bold">🇮🇳 Domestic INR / NEFT / IMPS / UPI:</div>
                    <div className="text-slate-300">Bank: <strong className="text-white">Federal Bank</strong></div>
                    <div className="text-slate-300">A/C: <strong className="text-white font-mono">99980119788763</strong></div>
                    <div className="text-slate-300">IFSC: <strong className="text-white font-mono">FDRL0001447</strong></div>
                    <div className="text-slate-300">UPI ID: <strong className="text-emerald-400 font-mono">chandimay@ybl</strong></div>
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 space-y-1">
                    <div className="text-cyan-400 font-bold">🌏 Global USD / Wire &amp; PayPal:</div>
                    <div className="text-slate-300">SWIFT / BIC: <strong className="text-white font-mono">FDRLINBBIBD</strong></div>
                    <div className="text-slate-300">PayPal Handle: <strong className="text-white font-mono">ky8402</strong></div>
                    <div className="text-slate-300">Direct Link: <a href="https://paypal.me/ky8402" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline font-mono">paypal.me/ky8402</a></div>
                    <div className="text-slate-300">Email: <strong className="text-white font-mono">kundank4@icloud.com</strong></div>
                  </div>
                </div>

                {/* Instant PayPal SDK v6 Checkout Button */}
                <div className="pt-2">
                  <PayPalSdkV6Button
                    amount={Math.max(1, showInvoiceModal.totalValue - showInvoiceModal.amountPaid)}
                    currency="USD"
                    description={`Milestone Invoice Payment: ${showInvoiceModal.jobTitle || showInvoiceModal.id}`}
                    clientName={showInvoiceModal.clientName}
                    clientEmail="client@paypal-direct.com"
                    onSuccess={(orderId) => {
                      if (showInvoiceModal.milestones.length > 0) {
                        const firstIncomplete = showInvoiceModal.milestones.find(m => !m.completed);
                        if (firstIncomplete) {
                          onCompleteMilestone(showInvoiceModal.id, firstIncomplete.id);
                        }
                      }
                      setShowInvoiceModal(null);
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <a
                href={`https://paypal.me/ky8402/${showInvoiceModal.totalValue - showInvoiceModal.amountPaid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 px-4 py-2 text-xs font-bold transition-all"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open PayPal.me Invoice Link</span>
              </a>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowInvoiceModal(null)}
                  className="rounded-xl border border-slate-800 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-all"
                >
                  Close
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex items-center space-x-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-all shadow-md active:scale-95"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print Official Invoice</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
