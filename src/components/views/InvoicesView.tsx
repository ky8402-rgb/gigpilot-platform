import React from 'react';
import type { Invoice } from '../../App';

interface InvoicesViewProps {
  invoices: Invoice[];
  onGenerateInvoice: () => void;
  onOpenPayPalInvoice: (inv: Invoice) => void;
  onOpenGSTInvoice: (inv: Invoice) => void;
  onDownloadPDF: (invId: string) => void;
  onDownloadAllInvoices: () => void;
  fmt: (n: number) => string;
}

export const InvoicesView: React.FC<InvoicesViewProps> = ({
  invoices,
  onGenerateInvoice,
  onOpenPayPalInvoice,
  onOpenGSTInvoice,
  onDownloadPDF,
  onDownloadAllInvoices,
  fmt,
}) => {
  return (
    <div className="space-y-4">
      <div className="bg-[#161b2b] rounded-2xl border border-[#2a3147] p-6 shadow-lg">
        <div className="flex items-center justify-between pb-4 border-b border-[#2a3147] mb-5">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <i className="fas fa-file-invoice-dollar text-[#4f7cff]"></i>
              Automated Invoices &amp; Receipts
            </h3>
            <p className="text-xs text-[#9aa2bf] mt-0.5">Invoices are automatically generated upon milestone completion</p>
          </div>

          <button
            onClick={onGenerateInvoice}
            className="bg-[#4f7cff] hover:bg-[#3d6bf0] text-white px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-sm"
          >
            <i className="fas fa-plus"></i>
            <span>Generate Invoice</span>
          </button>
        </div>

        <div className="space-y-3">
          {invoices.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              <i className="fas fa-file-invoice text-2xl mb-2 text-slate-500 block"></i>
              No invoices generated yet. Complete orders or click "Generate Invoice".
            </div>
          ) : (
            invoices.map((inv, idx) => (
              <div
                key={`inv-${inv.id || idx}-${idx}`}
                className="flex flex-wrap items-center justify-between p-4 bg-[#11141f] rounded-xl border border-[#2a3147] text-xs hover:border-[#4f7cff] transition-all gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#4f7cff]/15 text-[#4f7cff] flex items-center justify-center">
                    <i className="fas fa-file-invoice"></i>
                  </div>
                  <div>
                    <div className="font-bold text-white text-sm">{inv.id}</div>
                    <div className="text-[#9aa2bf]">{inv.orderTitle} • Client: {inv.client}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-sm font-bold text-white">{fmt(inv.amount)} USD</span>
                  <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] ${
                    inv.status === 'Paid' ? 'bg-[#2ecc71]/20 text-[#2ecc71]' : 'bg-[#f39c12]/20 text-[#f39c12]'
                  }`}>
                    {inv.status}
                  </span>
                  
                  {/* PayPal Receive / Pay Action */}
                  <button
                    onClick={() => onOpenPayPalInvoice(inv)}
                    className="bg-gradient-to-r from-[#003087] to-[#0070ba] hover:opacity-90 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                    title="Collect or Pay this invoice via PayPal (USD)"
                  >
                    <i className="fab fa-paypal text-[#00cfe8]"></i>
                    <span>PayPal ($)</span>
                  </button>

                  {/* GST / Razorpay Invoice Pay Action */}
                  <button
                    onClick={() => onOpenGSTInvoice(inv)}
                    className="bg-gradient-to-r from-amber-600 to-amber-700 hover:opacity-90 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                    title="View GST compliant Tax Invoice (₹ INR)"
                  >
                    <i className="fas fa-file-invoice text-amber-300"></i>
                    <span>GST Invoice (₹)</span>
                  </button>

                  <button
                    onClick={() => onDownloadPDF(inv.id)}
                    className="p-2 text-[#9aa2bf] hover:text-white bg-[#161b2b] hover:bg-[#1e2438] rounded-lg transition-all cursor-pointer"
                    title="Download PDF"
                  >
                    <i className="fas fa-download"></i>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-[#2a3147] flex justify-between items-center flex-wrap gap-3">
          <div className="flex items-center gap-4 text-xs text-[#9aa2bf] flex-wrap">
            <span className="flex items-center gap-1.5">
              <i className="fab fa-paypal text-[#00cfe8]"></i>
              Live PayPal REST &amp; PayPal.Me (USD, EUR, GBP)
            </span>
            <span className="text-slate-600">•</span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              <i className="fas fa-database text-emerald-400"></i>
              PostgreSQL Direct Work Order Initialization
            </span>
          </div>
          <button
            onClick={onDownloadAllInvoices}
            className="bg-[#11141f] hover:bg-[#1e2438] border border-[#2a3147] text-white px-4 py-2 rounded-full text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <i className="fas fa-download"></i>
            <span>Download All Invoices</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoicesView;
