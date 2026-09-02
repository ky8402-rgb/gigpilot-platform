import React, { useRef } from 'react';
import {
  X,
  Printer,
  Download,
  Receipt,
  CheckCircle2,
  Building2,
  ShieldCheck,
  TrendingUp,
  Sparkles
} from 'lucide-react';

interface GSTInvoiceModalProps {
  invoice: any | null;
  isOpen: boolean;
  onClose: () => void;
}

export const GSTInvoiceModal: React.FC<GSTInvoiceModalProps> = ({
  invoice,
  isOpen,
  onClose
}) => {
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const seller = invoice.seller || {
    businessName: 'Kundan Vision AI Technologies Pvt Ltd',
    gstin: '27AABCK3690F1Z9',
    address: 'B-402, Cyber Heights Tech Park, Mumbai, Maharashtra 400051, India',
    stateCode: '27',
    stateName: 'Maharashtra'
  };

  const buyer = invoice.buyer || {
    name: 'Alex Morgan',
    email: 'ky8402@gmail.com',
    stateCode: '27',
    stateName: 'Maharashtra',
    gstin: 'N/A (B2C Consumer)'
  };

  const item = invoice.item || {
    description: 'Gemini Paid Tier AI Proposal Generation Credits',
    sacCode: '998315',
    sacDescription: 'Hosting, IT Infrastructure & Automated AI Software Services',
    credits: 10,
    baseAmount: 850,
    cgst: 76.50,
    sgst: 76.50,
    igst: 0,
    totalTax: 153.00,
    grandTotal: 1003.00
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Modal Top Controls (Not in Print) */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-6 py-4 print:hidden">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white sm:text-lg flex items-center gap-2">
                Official GST Tax Invoice
                <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-2 py-0.5 rounded font-mono font-bold">
                  PAID
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                SAC 998315 • Input Tax Credit (ITC) Eligible • Central &amp; State GST
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition-all cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Print Invoice</span>
            </button>

            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Tax Invoice Sheet */}
        <div ref={printRef} className="flex-1 overflow-y-auto p-6 sm:p-8 bg-white text-slate-900 text-xs sm:text-sm font-sans space-y-6">
          
          {/* Header Banner */}
          <div className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="text-xl font-black text-slate-900 tracking-tight">
                {seller.businessName}
              </div>
              <p className="text-xs text-slate-600 max-w-sm mt-1">
                {seller.address}
              </p>
              <div className="text-xs font-mono font-bold text-slate-800 mt-1">
                GSTIN: <span className="text-indigo-900">{seller.gstin}</span> • State: {seller.stateCode} ({seller.stateName})
              </div>
            </div>

            <div className="sm:text-right">
              <div className="text-xs font-extrabold uppercase tracking-widest text-slate-500">TAX INVOICE</div>
              <div className="text-base font-black text-slate-900 font-mono mt-0.5">
                {invoice.invoiceNumber || 'KVA-2026-GST-102938'}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                Date: {new Date(invoice.date || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              <div className="text-xs text-slate-600">
                Payment Ref: <span className="font-mono">{invoice.paymentId || 'pay_sim_success'}</span>
              </div>
            </div>
          </div>

          {/* Bill To / Consignee Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">BILLED TO (BUYER):</div>
              <div className="text-sm font-bold text-slate-900 mt-1">{buyer.name}</div>
              <div className="text-xs text-slate-600">{buyer.email}</div>
              <div className="text-xs font-mono text-slate-700 mt-1">
                GSTIN: <span className="font-bold">{buyer.gstin || 'B2C Consumer (Unregistered)'}</span>
              </div>
              <div className="text-xs text-slate-600">
                State: {buyer.stateCode} - {buyer.stateName}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">SUPPLY &amp; TAX SUMMARY:</div>
              <div className="text-xs text-slate-700 mt-1">
                <strong>Place of Supply:</strong> {buyer.stateName} ({buyer.stateCode})
              </div>
              <div className="text-xs text-slate-700">
                <strong>Reverse Charge Applicable:</strong> No
              </div>
              <div className="text-xs text-slate-700">
                <strong>Service Category:</strong> Online Information Database Access &amp; SaaS (OIDAR/SaaS)
              </div>
              <div className="text-xs text-emerald-800 font-bold mt-1">
                Status: Payment Confirmed (Razorpay Gateway)
              </div>
            </div>
          </div>

          {/* Itemized Line Items Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Item Description</th>
                  <th className="py-2.5 px-3">SAC Code</th>
                  <th className="py-2.5 px-3 text-center">Qty (Credits)</th>
                  <th className="py-2.5 px-3 text-right">Taxable Value</th>
                  <th className="py-2.5 px-3 text-right">GST Rate</th>
                  <th className="py-2.5 px-3 text-right">Total Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="py-3 px-3 font-mono font-bold">1</td>
                  <td className="py-3 px-3">
                    <div className="font-bold text-slate-900">{item.description}</div>
                    <div className="text-[11px] text-slate-500">{item.sacDescription}</div>
                  </td>
                  <td className="py-3 px-3 font-mono font-bold text-indigo-900">{item.sacCode}</td>
                  <td className="py-3 px-3 text-center font-mono font-bold">{item.credits}</td>
                  <td className="py-3 px-3 text-right font-mono">₹{item.baseAmount.toFixed(2)}</td>
                  <td className="py-3 px-3 text-right font-mono font-bold">18.00%</td>
                  <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">₹{item.grandTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Tax Breakup Calculation */}
          <div className="flex flex-col sm:flex-row justify-between gap-6 pt-2">
            <div className="text-xs text-slate-600 max-w-sm space-y-2">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4" />
                  Gemini Production Economics
                </div>
                <div className="text-[11px] text-emerald-800 mt-1">
                  Charged @ $1.00 (₹85.00) per bid • Gemini API Cost ~$0.02 per proposal • <strong>+5,000% Gross Profit Margin</strong>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                This is an electronically generated Tax Invoice compliant with Section 31 of the CGST Act, 2017. No physical signature is required.
              </p>
            </div>

            <div className="w-full sm:w-72 space-y-2 text-xs">
              <div className="flex justify-between text-slate-700">
                <span>Taxable Base Value:</span>
                <span className="font-mono font-medium">₹{item.baseAmount.toFixed(2)}</span>
              </div>
              
              {item.cgst > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Central Tax (CGST 9.00%):</span>
                  <span className="font-mono">₹{item.cgst.toFixed(2)}</span>
                </div>
              )}

              {item.sgst > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>State Tax (SGST 9.00%):</span>
                  <span className="font-mono">₹{item.sgst.toFixed(2)}</span>
                </div>
              )}

              {item.igst > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Integrated Tax (IGST 18.00%):</span>
                  <span className="font-mono">₹{item.igst.toFixed(2)}</span>
                </div>
              )}

              <div className="border-t-2 border-slate-900 pt-2 flex justify-between text-sm font-black text-slate-900">
                <span>Grand Total (INR):</span>
                <span className="font-mono text-base text-indigo-900">₹{item.grandTotal.toFixed(2)}</span>
              </div>
              <div className="text-[11px] text-slate-500 text-right">
                (Equivalent to ~${(item.grandTotal / 85).toFixed(2)} USD)
              </div>
            </div>
          </div>

          {/* Merchant Stamp & Verification Footer */}
          <div className="border-t border-slate-200 pt-4 flex items-center justify-between text-[11px] text-slate-500">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span>Certified Tax Compliant • Kundan Vision AI Technologies</span>
            </div>
            <div className="font-mono">
              Authorized Signatory • System Generated
            </div>
          </div>

        </div>

        {/* Bottom Controls */}
        <div className="flex items-center justify-end border-t border-slate-800 bg-slate-950/90 px-6 py-4 print:hidden">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-all cursor-pointer"
          >
            Close Invoice
          </button>
        </div>

      </div>
    </div>
  );
};
