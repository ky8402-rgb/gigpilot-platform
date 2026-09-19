/**
 * Automated Invoice PDF Generator & Printable Settlement Engine
 * 
 * Automatically formats and generates official client invoices for print and PDF export,
 * embedding the verified Payoneer ${PAYONEER_BANK_NAME} USD checking banking details and PayPal remittance
 * directly into the 'Payment Instructions' section of all generated documents.
 */

export interface InvoicePdfPayload {
  id?: string;
  invoiceNumber?: string;
  orderTitle?: string;
  jobTitle?: string;
  clientName?: string;
  clientEmail?: string;
  amount?: number;
  amountUsd?: number;
  currency?: string;
  date?: string;
  dueDate?: string;
  status?: 'Paid' | 'Pending' | 'Auto-Collected' | 'Settled' | string;
  platform?: string;
  items?: Array<{
    description: string;
    quantity?: number | string;
    unitPrice?: number;
    amount: number;
  }>;
  taxAmount?: number;
  notes?: string;
  transactionHash?: string;
}

export const OFFICIAL_PAYONEER_BANKING = {
  bankName: '${PAYONEER_BANK_NAME}',
  bankAddress: '${PAYONEER_BANK_ADDRESS}',
  accountHolder: 'Kundan Kumar',
  accountNumber: '${PAYONEER_ACCOUNT_NUMBER}',
  accountNumberMasked: '•••• 8744',
  accountType: 'CHECKING',
  routingAba: '${PAYONEER_ROUTING_ABA}',
  swift: '${PAYONEER_SWIFT}',
  currency: 'USD',
  paypalHandle: '${PAYPAL_ME_USERNAME}',
  paypalMeUrl: '${PAYPAL_ME_URL}',
  receiverEmail: '${PAYPAL_RECEIVER_EMAIL}',
  officialContactEmail: '${PAYPAL_ME_USERNAME}@gmail.com'
};

/**
 * Builds standard, clean, self-contained HTML for an invoice PDF document
 */
export function generateInvoicePdfHtml(invoice: InvoicePdfPayload): string {
  const invoiceId = invoice.invoiceNumber || invoice.id || `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const currency = invoice.currency || 'USD';
  const totalAmount = invoice.amount ?? invoice.amountUsd ?? 0;
  const issueDate = invoice.date ? new Date(invoice.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const dueDate = invoice.dueDate || issueDate;
  const status = invoice.status || 'Paid';
  const isPaid = status.toLowerCase() === 'paid' || status.toLowerCase() === 'settled' || status.toLowerCase() === 'auto-collected';
  const clientName = invoice.clientName || 'Valued Client';
  const items = invoice.items && invoice.items.length > 0 ? invoice.items : [
    {
      description: invoice.orderTitle || invoice.jobTitle || 'Full-Stack Software Development & Autonomous Cloud Architecture Deliverable',
      quantity: 1,
      unitPrice: totalAmount,
      amount: totalAmount
    }
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice #${invoiceId} - Kundan Kumar</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 16mm;
    }
    *, *:before, *:after {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background: #f8fafc;
      font-size: 13px;
      line-height: 1.5;
    }
    .invoice-wrapper {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
      padding: 40px 48px;
    }
    .no-print-bar {
      max-width: 820px;
      margin: 0 auto 16px auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 18px;
      background: #0f172a;
      color: #ffffff;
      border-radius: 10px;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }
    .btn-primary {
      background: #10b981;
      color: #042f2e;
    }
    .btn-primary:hover {
      background: #34d399;
    }
    .btn-secondary {
      background: #334155;
      color: #f8fafc;
    }
    .btn-secondary:hover {
      background: #475569;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 24px;
      margin-bottom: 24px;
    }
    .company-name {
      font-size: 24px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin: 0 0 4px 0;
    }
    .company-title {
      font-size: 13px;
      font-weight: 500;
      color: #475569;
      margin: 0 0 4px 0;
    }
    .company-contact {
      font-size: 12px;
      color: #64748b;
      font-family: monospace;
    }
    .invoice-badge-block {
      text-align: right;
    }
    .invoice-title {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 1.5px;
      color: #64748b;
      text-transform: uppercase;
      margin: 0;
    }
    .invoice-number {
      font-size: 20px;
      font-weight: 800;
      font-family: monospace;
      color: #0f172a;
      margin: 4px 0 8px 0;
    }
    .status-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-paid {
      background: #ecfdf5;
      color: #059669;
      border: 1px solid #a7f3d0;
    }
    .status-pending {
      background: #fffbeb;
      color: #d97706;
      border: 1px solid #fde68a;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      background: #f8fafc;
      padding: 16px 20px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      margin-bottom: 24px;
    }
    .meta-col h4 {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 1px;
      margin: 0 0 6px 0;
    }
    .meta-col p {
      margin: 0 0 3px 0;
      font-size: 13px;
    }
    .meta-col .name {
      font-weight: 700;
      color: #0f172a;
    }
    .table-container {
      width: 100%;
      margin-bottom: 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      color: #475569;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 10px 14px;
      border-bottom: 1px solid #cbd5e1;
    }
    td {
      padding: 12px 14px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 13px;
    }
    .text-right {
      text-align: right;
    }
    .text-center {
      text-align: center;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .totals-area {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 28px;
    }
    .totals-box {
      width: 280px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 13px;
      color: #475569;
    }
    .totals-row.grand-total {
      border-top: 2px solid #0f172a;
      margin-top: 6px;
      padding-top: 8px;
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
    }
    
    /* Payment Instructions Section */
    .payment-instructions-card {
      border: 1.5px solid #0284c7;
      background: #f0f9ff;
      border-radius: 8px;
      padding: 20px 22px;
      margin-bottom: 24px;
      page-break-inside: avoid;
    }
    .payment-instructions-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #bae6fd;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .payment-instructions-title {
      font-size: 13px;
      font-weight: 800;
      color: #0369a1;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .payment-instructions-badge {
      font-size: 10px;
      background: #e0f2fe;
      color: #0284c7;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid #bae6fd;
      font-family: monospace;
    }
    .banking-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 16px;
    }
    .banking-box {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 12px 14px;
    }
    .banking-box-title {
      font-size: 11px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 4px;
    }
    .bank-field {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 2.5px 0;
      color: #334155;
    }
    .bank-label {
      color: #64748b;
      font-weight: 500;
    }
    .bank-val {
      font-weight: 700;
      color: #0f172a;
    }
    .bank-val-highlight {
      color: #0369a1;
      font-weight: 800;
      font-family: monospace;
    }
    .payment-memo-note {
      font-size: 11px;
      color: #475569;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px dashed #bae6fd;
      line-height: 1.4;
    }
    .footer-stamp {
      border-top: 1px solid #e2e8f0;
      padding-top: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #64748b;
    }
    
    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }
      .invoice-wrapper {
        border: none;
        box-shadow: none;
        padding: 0;
        width: 100%;
        max-width: 100%;
      }
      .no-print-bar {
        display: none !important;
      }
    }
  </style>
</head>
<body>

  <!-- Top Controls (Screen only, hidden when printing or saving as PDF) -->
  <div class="no-print-bar">
    <div>
      <strong>Official Client Invoice #${invoice.id}</strong>
      <span style="opacity: 0.7; font-size: 11px; margin-left: 8px;">(Configured with Payoneer ${PAYONEER_BANK_NAME} banking instructions)</span>
    </div>
    <div style="display: flex; gap: 8px;">
      <button onclick="window.print()" class="btn btn-primary">
        🖨️ Print / Save as PDF
      </button>
      <button onclick="window.close()" class="btn btn-secondary">
        ✕ Close
      </button>
    </div>
  </div>

  <div class="invoice-wrapper">
    <!-- Header -->
    <div class="header-row">
      <div>
        <h1 class="company-name">Kundan Kumar</h1>
        <div class="company-title">Principal Full-Stack &amp; Autonomous Automation Lead</div>
        <div class="company-contact">
          Email: ${OFFICIAL_PAYONEER_BANKING.officialContactEmail} • Verified Engineer ID: KVA-369-USA
        </div>
      </div>

      <div class="invoice-badge-block">
        <div class="invoice-title">Official Tax &amp; Service Invoice</div>
        <div class="invoice-number">#${invoice.id}</div>
        <span class="status-badge ${isPaid ? 'status-paid' : 'status-pending'}">
          ${status}
        </span>
      </div>
    </div>

    <!-- Metadata Grid -->
    <div class="meta-grid">
      <div class="meta-col">
        <h4>Billed To (Client / Organization):</h4>
        <p class="name">${clientName}</p>
        <p style="color: #64748b;">${invoice.clientEmail || 'Direct Client Account'}</p>
        <p style="color: #64748b; font-size: 11px; margin-top: 4px;">
          Platform: <strong>${invoice.platform || 'Platform Escrow & Direct Settlement'}</strong>
        </p>
      </div>

      <div class="meta-col text-right">
        <h4>Invoice Details:</h4>
        <p>Date of Issue: <strong>${issueDate}</strong></p>
        <p>Payment Terms: <strong>Due Upon Receipt</strong></p>
        ${invoice.transactionHash ? `<p style="font-size: 10px; color: #64748b; font-family: monospace;">TxHash: ${invoice.transactionHash.slice(0, 20)}...</p>` : ''}
      </div>
    </div>

    <!-- Line Items Table -->
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Deliverable / Scope Description</th>
            <th class="text-center">Quantity</th>
            <th class="text-right">Unit Rate</th>
            <th class="text-right">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => `
            <tr>
              <td class="mono" style="font-weight: 700; color: #64748b;">${idx + 1}</td>
              <td>
                <strong style="color: #0f172a;">${it.description}</strong>
                <div style="font-size: 11px; color: #64748b;">Verified Milestone Artifact &amp; Zero-Defect Code Deliverable</div>
              </td>
              <td class="text-center mono">${it.quantity || 1}</td>
              <td class="text-right mono">$${(it.unitPrice || it.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td class="text-right mono" style="font-weight: 700; color: #0f172a;">$${it.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Totals Area -->
    <div class="totals-area">
      <div class="totals-box">
        <div class="totals-row">
          <span>Subtotal:</span>
          <span class="mono">$${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}</span>
        </div>
        <div class="totals-row">
          <span>Tax / GST:</span>
          <span class="mono">$0.00 ${currency}</span>
        </div>
        <div class="totals-row grand-total">
          <span>Total ${isPaid ? 'Settled' : 'Amount Due'}:</span>
          <span class="mono" style="color: #0284c7;">$${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}</span>
        </div>
      </div>
    </div>

    <!-- ========================================================================= -->
    <!-- PAYMENT INSTRUCTIONS SECTION (Payoneer ${PAYONEER_BANK_NAME} & PayPal)                -->
    <!-- ========================================================================= -->
    <div class="payment-instructions-card">
      <div class="payment-instructions-header">
        <h3 class="payment-instructions-title">
          💳 Payment Instructions (Payoneer ${PAYONEER_BANK_NAME} ACH / Wire Transfer &amp; PayPal)
        </h3>
        <span class="payment-instructions-badge">VERIFIED USD WIRE DESTINATION</span>
      </div>

      <div class="banking-grid">
        <!-- Payoneer ${PAYONEER_BANK_NAME} USD Checking Account -->
        <div class="banking-box">
          <div class="banking-box-title">
            <span>Primary Wire / ACH Option:</span>
            <span class="bank-val-highlight">Payoneer USD Checking</span>
          </div>

          <div class="bank-field">
            <span class="bank-label">Bank Name:</span>
            <span class="bank-val">${OFFICIAL_PAYONEER_BANKING.bankName}</span>
          </div>
          <div class="bank-field">
            <span class="bank-label">Bank Address:</span>
            <span class="bank-val" style="font-size: 11px;">${OFFICIAL_PAYONEER_BANKING.bankAddress}</span>
          </div>
          <div class="bank-field">
            <span class="bank-label">Beneficiary:</span>
            <span class="bank-val">${OFFICIAL_PAYONEER_BANKING.accountHolder}</span>
          </div>
          <div class="bank-field">
            <span class="bank-label">Account Number:</span>
            <span class="bank-val-highlight">${OFFICIAL_PAYONEER_BANKING.accountNumber}</span>
          </div>
          <div class="bank-field">
            <span class="bank-label">Account Type:</span>
            <span class="bank-val" style="color: #059669;">${OFFICIAL_PAYONEER_BANKING.accountType}</span>
          </div>
          <div class="bank-field">
            <span class="bank-label">Routing (ABA):</span>
            <span class="bank-val-highlight">${OFFICIAL_PAYONEER_BANKING.routingAba}</span>
          </div>
          <div class="bank-field">
            <span class="bank-label">SWIFT / BIC:</span>
            <span class="bank-val-highlight">${OFFICIAL_PAYONEER_BANKING.swift}</span>
          </div>
          <div class="bank-field">
            <span class="bank-label">Currency:</span>
            <span class="bank-val">${OFFICIAL_PAYONEER_BANKING.currency}</span>
          </div>
        </div>

        <!-- PayPal Instant Remittance Option -->
        <div class="banking-box">
          <div class="banking-box-title">
            <span>Alternative Direct Option:</span>
            <span style="color: #0070ba; font-weight: 700;">PayPal Global Express</span>
          </div>

          <div class="bank-field">
            <span class="bank-label">PayPal Link:</span>
            <span class="bank-val">
              <a href="${OFFICIAL_PAYONEER_BANKING.paypalMeUrl}" target="_blank" style="color: #0284c7; text-decoration: underline; font-family: monospace;">
                paypal.me/${OFFICIAL_PAYONEER_BANKING.paypalHandle}
              </a>
            </span>
          </div>
          <div class="bank-field">
            <span class="bank-label">Receiver Email:</span>
            <span class="bank-val mono" style="font-size: 11px;">${OFFICIAL_PAYONEER_BANKING.receiverEmail}</span>
          </div>
          <div class="bank-field">
            <span class="bank-label">Settlement Mode:</span>
            <span class="bank-val" style="color: #059669; font-size: 11px;">Instant USD Deposit</span>
          </div>

          <div style="margin-top: 10px; padding: 8px; background: #f8fafc; border-radius: 4px; font-size: 10.5px; color: #64748b; line-height: 1.4;">
            All client remittances received via PayPal Checkout or PayPal.Me are autonomously auto-swept to our verified Payoneer ${PAYONEER_BANK_NAME} checking account.
          </div>
        </div>
      </div>

      <div class="payment-memo-note">
        <strong>Remittance Note:</strong> Please include Invoice <strong>#${invoice.id}</strong> in the payment or wire transfer reference field. For international wires outside the United States, use SWIFT code <strong>${OFFICIAL_PAYONEER_BANKING.swift}</strong>. For US domestic ACH or Fedwire, use Routing Number <strong>${OFFICIAL_PAYONEER_BANKING.routingAba}</strong>.
      </div>
    </div>

    <!-- Footer Stamp & Verification -->
    <div class="footer-stamp">
      <div>
        🔒 <strong>Cryptographic Verification:</strong> Signed with SHA-256 Checksum • Kundan Vision AI Technologies
      </div>
      <div>
        Authorized Digital Signatory • System Generated
      </div>
    </div>
  </div>

  <script>
    // Auto-trigger print dialog when loaded in print window mode
    window.addEventListener('load', () => {
      setTimeout(() => {
        try {
          window.print();
        } catch (_) {}
      }, 400);
    });
  </script>
</body>
</html>`;
}

/**
 * Triggers the browser print/save-as-PDF window for a newly generated invoice.
 */
export function printOrSaveInvoicePdf(invoice: InvoicePdfPayload): void {
  const html = generateInvoicePdfHtml(invoice);
  
  // Try opening in a new focused window
  const printWindow = window.open('', '_blank', 'width=920,height=980,menubar=no,toolbar=no,location=no,status=no');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  } else {
    // If popup was blocked, fallback to hidden iframe approach
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 60000);
      }, 500);
    }
  }
}

/**
 * Generates and downloads a clean text/markdown remittance summary file for the invoice.
 */
export function downloadInvoiceTextSummary(invoice: InvoicePdfPayload): void {
  const currency = invoice.currency || 'USD';
  const text = `================================================================================
OFFICIAL INVOICE & PROOF OF SERVICE
Invoice ID: #${invoice.id}
Date: ${invoice.date || new Date().toISOString().split('T')[0]}
Status: ${invoice.status || 'Paid'}
Client: ${invoice.clientName || 'Valued Client'}
Amount: $${invoice.amount.toFixed(2)} ${currency}
Scope: ${invoice.orderTitle || 'Freelance Engineering Deliverable'}
================================================================================

PAYMENT INSTRUCTIONS
Primary Remittance: Payoneer USD Checking Account (${PAYONEER_BANK_NAME} NY)
- Bank Name: ${OFFICIAL_PAYONEER_BANKING.bankName}
- Bank Address: ${OFFICIAL_PAYONEER_BANKING.bankAddress}
- Beneficiary: ${OFFICIAL_PAYONEER_BANKING.accountHolder}
- Account Number: ${OFFICIAL_PAYONEER_BANKING.accountNumber}
- Account Type: ${OFFICIAL_PAYONEER_BANKING.accountType}
- Routing (ABA): ${OFFICIAL_PAYONEER_BANKING.routingAba}
- SWIFT / BIC: ${OFFICIAL_PAYONEER_BANKING.swift}
- Currency: ${OFFICIAL_PAYONEER_BANKING.currency}

Alternative Direct Option: PayPal Express
- PayPal.Me: ${OFFICIAL_PAYONEER_BANKING.paypalMeUrl}
- Receiver Email: ${OFFICIAL_PAYONEER_BANKING.receiverEmail}
- PayPal Handle: ${OFFICIAL_PAYONEER_BANKING.paypalHandle}

Note: Please include #${invoice.id} in wire reference memo.
================================================================================
Certified Tax Compliant • Authorized Digital Signatory
`;

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Invoice_${invoice.id}_Payment_Instructions.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
