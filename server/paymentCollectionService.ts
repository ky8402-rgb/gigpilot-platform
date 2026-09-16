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
  paymentMethod: 'paypal' | 'upi' | 'card' | 'instant_escrow';
  status: 'PAID' | 'PENDING' | 'FAILED';
  paidAt: string;
  transactionHash: string;
  receiptUrl?: string;
  payoutDestination: string;
}

// In-memory payment ledger
const paymentLedger: PaymentCollectionRecord[] = [
  {
    id: 'pay_init_1',
    invoiceNumber: 'INV-2026-8491',
    orderId: 'wo_init_1',
    clientName: 'Alex Chen (Apex Fintech)',
    clientEmail: 'alex@apexfintech.io',
    description: 'Automated Payment Webhook Handler & Idempotency Key Engine',
    amountUsd: 225,
    amountInr: 18675,
    paymentMethod: 'paypal',
    status: 'PAID',
    paidAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    transactionHash: '0x9f8c2b7e1a3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f',
    payoutDestination: 'PayPal (ky8402@gmail.com)',
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
    paymentMethod: 'instant_escrow',
    status: 'PAID',
    paidAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    transactionHash: '0x4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b',
    payoutDestination: 'UPI (kundanvision369@okhdfcbank)',
  },
];

const PAYPAL_HANDLE = 'kundanvision369';
const UPI_ID = 'kundanvision369@okhdfcbank';
const USD_TO_INR_RATE = 83.25;

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
  const upiUri = `upi://pay?pa=${UPI_ID}&pn=Kundan&am=${inr}&cu=INR&tn=${encodeURIComponent(memo)}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiUri)}&margin=10`;

  return {
    amountUsd: usd,
    amountInr: inr,
    paypalUrl,
    upiUri,
    qrCodeUrl,
    paypalHandle: PAYPAL_HANDLE,
    upiId: UPI_ID,
    formattedUsd: `$${usd.toFixed(2)} USD`,
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
  paymentMethod: 'paypal' | 'upi' | 'card' | 'instant_escrow';
}): PaymentCollectionRecord {
  const amountUsd = Math.max(1, data.amountUsd);
  const amountInr = Math.round(amountUsd * USD_TO_INR_RATE);
  const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();

  const record: PaymentCollectionRecord = {
    id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    invoiceNumber,
    orderId: data.orderId,
    clientName: data.clientName,
    clientEmail: data.clientEmail || `${data.clientName.toLowerCase().replace(/[^a-z0-9]/g, '')}@client.com`,
    description: data.description,
    amountUsd,
    amountInr,
    paymentMethod: data.paymentMethod,
    status: 'PAID',
    paidAt: now,
    transactionHash: txHash,
    payoutDestination: data.paymentMethod === 'upi' ? `UPI (${UPI_ID})` : `PayPal (${PAYPAL_HANDLE})`,
  };

  paymentLedger.unshift(record);

  logActivityEvent({
    source: 'PaymentCollectionService',
    type: 'PAYMENT_COLLECTED',
    status: 'success',
    summary: `Collected $${amountUsd.toFixed(2)} USD (₹${amountInr.toLocaleString('en-IN')}) from ${data.clientName} via ${data.paymentMethod.toUpperCase()}`,
    tags: ['revenue', 'payment_collected', data.paymentMethod],
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
    destinations: {
      paypal: PAYPAL_HANDLE,
      paypalEmail: 'ky8402@gmail.com',
      upi: UPI_ID,
      usdToInrRate: USD_TO_INR_RATE,
    },
  };
}
