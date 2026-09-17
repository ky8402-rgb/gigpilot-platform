import crypto from 'crypto';
import { logActivityEvent } from './activityLogger.js';

export interface PaymentCollectionRecord {
  id: string;
  invoiceNumber: string;
  orderId?: string | number;
  clientName: string;
  clientEmail?: string;
  description: string;
  amountUsd: number;
  amountInr: number;
  paymentMethod: 'payoneer' | 'paypal' | 'card' | 'instant_escrow';
  status: 'PAID' | 'PENDING' | 'FAILED';
  paidAt: string;
  transactionHash: string;
  receiptUrl?: string;
  payoutDestination: string;
}

// Verified Primary Beneficiary Settlement Accounts
export const PRIMARY_PAYONEER_ACCOUNT = {
  isPrimary: true,
  bankName: 'Citibank',
  bankAddress: '111 Wall Street New York, NY 10043 USA',
  accountHolder: 'Kundan Kumar',
  accountNumber: '70589110002638744',
  accountNumberMasked: '•••• 8744',
  accountType: 'CHECKING',
  routingAba: '031100209',
  swiftBic: 'CITIUS33',
  currency: 'USD',
  transferTypes: 'ACH, Fedwire, SWIFT Wire, Global ACH',
  notes: 'Primary payment collection destination for all client deliverables, contract milestones, and auto-swept marketplace payouts.',
};

// In-memory payment ledger
const paymentLedger: PaymentCollectionRecord[] = [
  {
    id: 'pay_init_0',
    invoiceNumber: 'INV-2026-8490',
    orderId: 'wo_init_0',
    clientName: 'Apex Financial Technologies LLC',
    clientEmail: 'billing@apexfintech.io',
    description: 'Autonomous Cloud Ledger & High-Throughput Settlement Pipeline',
    amountUsd: 450,
    amountInr: 39082,
    paymentMethod: 'payoneer',
    status: 'PAID',
    paidAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    transactionHash: '0x3c2a1b9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1',
    payoutDestination: 'Payoneer USD Checking (Citibank, Acc: 70589110002638744, Routing: 031100209)',
  },
  {
    id: 'pay_init_1',
    invoiceNumber: 'INV-2026-8491',
    orderId: 'wo_init_1',
    clientName: 'Alex Chen (Apex Fintech)',
    clientEmail: 'alex@apexfintech.io',
    description: 'Automated Payment Webhook Handler & Idempotency Key Engine',
    amountUsd: 225,
    amountInr: 18675,
    paymentMethod: 'payoneer',
    status: 'PAID',
    paidAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    transactionHash: '0x9f8c2b7e1a3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f',
    payoutDestination: 'Payoneer USD Checking (Citibank, Acc: 70589110002638744, Routing: 031100209)',
  },
  {
    id: 'pay_init_2',
    invoiceNumber: 'INV-2026-8492',
    orderId: 'wo_init_2',
    clientName: 'Sarah Miller (Luxe Brands)',
    clientEmail: 'sarah@luxebrands.com',
    description: 'E-Commerce Next.js Checkout & Performance Optimization',
    amountUsd: 300,
    amountInr: 24900,
    paymentMethod: 'paypal',
    status: 'PAID',
    paidAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    transactionHash: '0x4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b',
    payoutDestination: 'PayPal (Auto-Sweeps to Payoneer Citibank)',
  },
];

const PAYPAL_HANDLE = 'ky8402';
const USD_TO_INR_RATE = 86.85;

/**
 * Generate direct payment collection links
 */
export function getPaymentCollectionLinks(params: {
  amountUsd: number;
  clientName?: string;
  invoiceRef?: string;
  memo?: string;
}) {
  const usd = Math.max(1, params.amountUsd);
  const inr = Math.round(usd * USD_TO_INR_RATE);
  const memo = params.memo || params.invoiceRef || `Freelance Deliverable Payment`;

  const paypalUrl = `https://paypal.me/${PAYPAL_HANDLE}/${usd}USD`;

  return {
    primaryMethod: 'payoneer',
    amountUsd: usd,
    amountInr: inr,
    payoneer: PRIMARY_PAYONEER_ACCOUNT,
    paypalUrl,
    paypalHandle: PAYPAL_HANDLE,
    formattedUsd: `${usd.toFixed(2)} USD`,
    formattedInr: `₹${inr.toLocaleString('en-IN')}`,
  };
}

/**
 * Record a collected client payment
 */
export function recordCollectedPayment(data: {
  orderId?: string | number;
  clientName: string;
  clientEmail?: string;
  description: string;
  amountUsd: number;
  paymentMethod?: 'payoneer' | 'paypal' | 'card' | 'instant_escrow';
}): PaymentCollectionRecord {
  const amountUsd = Math.max(1, data.amountUsd);
  const amountInr = Math.round(amountUsd * USD_TO_INR_RATE);
  const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const paymentMethod = data.paymentMethod || 'payoneer';

  let payoutDestination = 'Payoneer USD Checking (Citibank, Acc: 70589110002638744, Routing: 031100209)';
  if (paymentMethod === 'paypal') {
    payoutDestination = 'PayPal (Auto-Swept to Payoneer Citibank)';
  } else if (paymentMethod === 'instant_escrow') {
    payoutDestination = 'Platform Escrow Direct Release (Payoneer Wire)';
  }

  const record: PaymentCollectionRecord = {
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    invoiceNumber,
    orderId: data.orderId,
    clientName: data.clientName,
    clientEmail: data.clientEmail || `${data.clientName.toLowerCase().replace(/[^a-z0-9]/g, '')}@client.com`,
    description: data.description,
    amountUsd,
    amountInr,
    paymentMethod,
    status: 'PAID',
    paidAt: now,
    transactionHash: txHash,
    payoutDestination,
  };

  paymentLedger.unshift(record);

  logActivityEvent({
    source: 'PaymentCollectionService',
    type: 'PAYMENT_COLLECTED',
    status: 'success',
    summary: `Collected $${amountUsd.toFixed(2)} USD (₹${amountInr.toLocaleString('en-IN')}) from ${data.clientName} via ${paymentMethod.toUpperCase()} (Settled to Payoneer Citibank)`,
    tags: ['revenue', 'payment_collected', paymentMethod, 'payoneer'],
  });

  return record;
}

/**
 * Get all collected payments and revenue stats
 */
export function getPaymentSummary() {
  const totalCollectedUsd = paymentLedger.reduce((sum, p) => sum + p.amountUsd, 0);
  const totalCollectedInr = paymentLedger.reduce((sum, p) => sum + p.amountInr, 0);

  return {
    totalCollectedUsd,
    totalCollectedInr,
    transactionCount: paymentLedger.length,
    recentPayments: paymentLedger.slice(0, 20),
    primaryDestination: 'payoneer',
    destinations: {
      primary: 'payoneer',
      payoneer: PRIMARY_PAYONEER_ACCOUNT,
      paypal: PAYPAL_HANDLE,
      paypalEmail: 'ky8402@gmail.com',
      usdToInrRate: USD_TO_INR_RATE,
    },
  };
}
