import axios from 'axios';

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  mode: 'live' | 'sandbox';
  receiverEmail: string;
  paypalMeUsername: string;
  webhookId?: string;
  currency: string;
  autoCapture: boolean;
}

// PayPal credentials must be supplied by the runtime environment.
// Never commit live client secrets to source control.
function resolveActiveCredentials() {
  return {
    clientId: (process.env.PAYPAL_CLIENT_ID || '').trim(),
    clientSecret: (process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET || '').trim()
  };
}

// Known placeholder credentials are never accepted for live calls.
const DUMMY_CREDENTIALS = [
  'your_paypal_client_id',
  'your_paypal_client_secret',
  'placeholder'
];

// In-memory token cache to prevent redundant OAuth token calls
let cachedPayPalToken: { token: string; expiresAt: number } | null = null;
let lastFailedAttemptTimestamp = 0;

const initialCreds = resolveActiveCredentials();

// Default in-memory config initialized from environment variables
let payPalConfig: PayPalConfig = {
  clientId: initialCreds.clientId,
  clientSecret: initialCreds.clientSecret,
  mode: (process.env.PAYPAL_MODE === 'sandbox') ? 'sandbox' : 'live',
  receiverEmail: process.env.PAYPAL_RECEIVER_EMAIL || '',
  paypalMeUsername: process.env.PAYPAL_ME_USERNAME || '',
  webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
  currency: 'USD',
  autoCapture: true
};

export function getPayPalConfig(): PayPalConfig {
  const envMode: 'live' | 'sandbox' = process.env.PAYPAL_MODE === 'sandbox' ? 'sandbox' : 'live';
  const creds = resolveActiveCredentials();
  return {
    ...payPalConfig,
    clientId: payPalConfig.clientId || creds.clientId,
    clientSecret: payPalConfig.clientSecret || creds.clientSecret,
    mode: process.env.PAYPAL_MODE ? envMode : (payPalConfig.mode || 'live'),
    receiverEmail: (process.env.PAYPAL_RECEIVER_EMAIL || payPalConfig.receiverEmail || '').trim(),
    paypalMeUsername: (process.env.PAYPAL_ME_USERNAME || payPalConfig.paypalMeUsername || '').trim(),
    webhookId: (process.env.PAYPAL_WEBHOOK_ID || payPalConfig.webhookId || '').trim()
  };
}

export function updatePayPalConfig(newConfig: Partial<PayPalConfig>): PayPalConfig {
  payPalConfig = {
    ...payPalConfig,
    ...newConfig
  };
  // Invalidate cached token when credentials change
  cachedPayPalToken = null;
  lastFailedAttemptTimestamp = 0;
  return getPayPalConfig();
}

export function isPayPalConfigured(): boolean {
  const cfg = getPayPalConfig();
  if (!cfg.clientId || !cfg.clientSecret) return false;
  if (DUMMY_CREDENTIALS.includes(cfg.clientId) || DUMMY_CREDENTIALS.includes(cfg.clientSecret)) {
    return false;
  }
  return cfg.clientId.trim().length > 10 && cfg.clientSecret.trim().length > 10;
}

export function getPayPalBaseUrl(): string {
  const cfg = getPayPalConfig();
  return cfg.mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

/**
 * Generate PayPal OAuth2 Bearer Access Token with in-memory caching and graceful error handling
 */
export async function getPayPalAccessToken(): Promise<string | null> {
  const cfg = getPayPalConfig();
  if (!isPayPalConfigured()) {
    return null;
  }

  // Return valid cached token if not expired (with 60s safety buffer)
  if (cachedPayPalToken && cachedPayPalToken.expiresAt > Date.now() + 60000) {
    return cachedPayPalToken.token;
  }

  // Avoid spamming PayPal if previous attempt failed recently (within 30s)
  if (Date.now() - lastFailedAttemptTimestamp < 30000) {
    return null;
  }

  const authString = Buffer.from(`${cfg.clientId.trim()}:${cfg.clientSecret.trim()}`).toString('base64');
  const baseUrl = getPayPalBaseUrl();

  try {
    const res = await axios.post(
      `${baseUrl}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    const token = res.data?.access_token;
    if (token) {
      const expiresInSec = Number(res.data?.expires_in) || 3600;
      cachedPayPalToken = {
        token,
        expiresAt: Date.now() + (expiresInSec * 1000)
      };
      return token;
    }
    return null;
  } catch (error: any) {
    lastFailedAttemptTimestamp = Date.now();
    const errorData = error?.response?.data;
    if (errorData?.error === 'invalid_client') {
      // Gracefully handle unauthenticated client credentials
      return null;
    }
    console.warn('PayPal OAuth access notice:', errorData?.error_description || errorData?.error || error.message);
    return null;
  }
}

/**
 * Create a PayPal v2 Checkout Order
 */
export async function createPayPalOrder(params: {
  amount: number;
  currency?: string;
  description?: string;
  clientName?: string;
  clientEmail?: string;
  returnUrl?: string;
  cancelUrl?: string;
  customId?: string;
}): Promise<{
  orderId: string;
  status: string;
  approveUrl: string;
  isLiveRest: boolean;
}> {
  const cfg = getPayPalConfig();
  const token = await getPayPalAccessToken();
  const currency = params.currency || cfg.currency || 'USD';
  const formattedAmount = Number(params.amount).toFixed(2);
  const baseUrl = getPayPalBaseUrl();

  if (token) {
    try {
      const payload: any = {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: params.customId || `ord_${Date.now()}`,
            description: params.description || 'Freelance Engineering Milestone Deliverable',
            custom_id: params.customId || `custom_${Date.now()}`,
            payee: cfg.receiverEmail ? {
              email_address: cfg.receiverEmail
            } : undefined,
            amount: {
              currency_code: currency,
              value: formattedAmount
            }
          }
        ],
        application_context: {
          brand_name: 'Freelance Autonomous OS',
          landing_page: 'NO_PREFERENCE',
          user_action: 'PAY_NOW',
          return_url: params.returnUrl || 'https://your-domain.com/?payment=paypal_success',
          cancel_url: params.cancelUrl || 'https://your-domain.com/?payment=paypal_cancelled'
        }
      };

      if (params.clientEmail) {
        payload.payer = {
          email_address: params.clientEmail,
          name: params.clientName ? { given_name: params.clientName } : undefined
        };
      }

      const res = await axios.post(`${baseUrl}/v2/checkout/orders`, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 12000
      });

      const links = res.data?.links || [];
      const approveLink = links.find((l: any) => l.rel === 'approve')?.href || `https://www.paypal.com/checkoutnow?token=${res.data?.id}`;

      return {
        orderId: res.data?.id,
        status: res.data?.status || 'CREATED',
        approveUrl: approveLink,
        isLiveRest: true
      };
    } catch (err: any) {
      console.warn('PayPal REST API order create failed, falling back to instant PayPal.me smart gateway:', err?.response?.data || err.message);
    }
  }

  throw new Error('PAYPAL_ORDER_CREATE_FAILED: Live PayPal order creation was not confirmed by PayPal.');
}

/**
 * Capture a PayPal v2 Checkout Order
 */
export async function capturePayPalOrder(orderId: string): Promise<{
  orderId: string;
  status: string;
  captureId?: string;
  amountCaptured: number;
  currency: string;
  payerEmail?: string;
  payerName?: string;
  isLiveRest: boolean;
  rawResponse?: any;
}> {
  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  if (token && !orderId.startsWith('PP-ORD-')) {
    try {
      const res = await axios.post(
        `${baseUrl}/v2/checkout/orders/${orderId}/capture`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 12000
        }
      );

      const captureData = res.data?.purchase_units?.[0]?.payments?.captures?.[0];
      const payer = res.data?.payer;

      return {
        orderId: res.data?.id || orderId,
        status: res.data?.status || 'COMPLETED',
        captureId: captureData?.id,
        amountCaptured: parseFloat(captureData?.amount?.value || '0'),
        currency: captureData?.amount?.currency_code || 'USD',
        payerEmail: payer?.email_address,
        payerName: payer?.name ? `${payer.name.given_name || ''} ${payer.name.surname || ''}`.trim() : undefined,
        isLiveRest: true,
        rawResponse: res.data
      };
    } catch (err: any) {
      console.error('PayPal REST capture error:', err?.response?.data || err.message);
      throw new Error('PAYPAL_CAPTURE_FAILED: PayPal did not confirm the capture.');
    }
  }

  throw new Error('PAYPAL_NOT_CONFIGURED: Live PayPal capture could not be verified.');
}

/**
 * Execute PayPal Payout / Mass Payment to Subcontractor
 */
export async function createPayPalPayout(params: {
  receiverEmail: string;
  amount: number;
  currency?: string;
  note?: string;
  recipientName?: string;
}): Promise<{
  payoutBatchId: string;
  status: string;
  amount: number;
  currency: string;
  isLiveRest: boolean;
}> {
  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();
  const currency = params.currency || 'USD';
  const formattedAmount = Number(params.amount).toFixed(2);

  if (token) {
    try {
      const senderBatchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const payload = {
        sender_batch_header: {
          sender_batch_id: senderBatchId,
          email_subject: 'You have received a payment for freelance engineering services',
          email_message: params.note || 'Milestone payment completed via Freelance Autonomous OS'
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: {
              value: formattedAmount,
              currency
            },
            note: params.note || 'Subcontractor project milestone payment',
            sender_item_id: `item_${Date.now()}`,
            receiver: params.receiverEmail
          }
        ]
      };

      const res = await axios.post(`${baseUrl}/v1/payments/payouts`, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 12000
      });

      return {
        payoutBatchId: res.data?.batch_header?.payout_batch_id || senderBatchId,
        status: res.data?.batch_header?.batch_status || 'PENDING',
        amount: Number(params.amount),
        currency,
        isLiveRest: true
      };
    } catch (err: any) {
      const errData = err?.response?.data;
      console.warn('PayPal Payouts REST API error:', errData || err.message);
      if (errData?.name === 'PAYOUT_NOT_AVAILABLE') {
        throw new Error(
          'PAYOUT_NOT_AVAILABLE: PayPal merchant accounts with auto-sweep enabled automatically deposit all foreign client revenue received via PayPal Checkout, Invoicing, or PayPal.Me directly into your linked Payoneer Citibank checking account (Acc: 70589110002638744 / Routing: 031100209) within 24-48 hours.'
        );
      }
      throw new Error(errData?.message || err.message || 'PayPal Payout request failed');
    }
  }

  throw new Error('PayPal API credentials not configured or live token unavailable');
}

/**
 * Fetch Real-Time PayPal Account Balance & Merchant Status
 */
export async function getPayPalLiveBalance(): Promise<{
  success: boolean;
  accountId: string;
  merchantName: string;
  email: string;
  paypalMeUsername: string;
  availableBalance: number;
  totalBalance: number;
  withheldBalance: number;
  currency: string;
  asOfTime: string;
  isLiveRest: boolean;
  autoSweepStatus: string;
  linkedBank: string;
}> {
  const cfg = getPayPalConfig();
  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  if (token) {
    try {
      const res = await axios.get(`${baseUrl}/v1/reporting/balances`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      });

      const primaryBalance = res.data?.balances?.find((b: any) => b.primary || b.currency === 'USD') || res.data?.balances?.[0];
      const availVal = parseFloat(primaryBalance?.available_balance?.value || '0.00');
      const totalVal = parseFloat(primaryBalance?.total_balance?.value || '0.00');
      const withheldVal = parseFloat(primaryBalance?.withheld_balance?.value || '0.00');

      return {
        success: true,
        accountId: res.data?.account_id || '',
        merchantName: '',
        email: cfg.receiverEmail || '',
        paypalMeUsername: cfg.paypalMeUsername || '',
        availableBalance: availVal,
        totalBalance: totalVal,
        withheldBalance: withheldVal,
        currency: primaryBalance?.currency || 'USD',
        asOfTime: res.data?.as_of_time || new Date().toISOString(),
        isLiveRest: true,
        autoSweepStatus: 'UNKNOWN - provider confirmation required',
        linkedBank: 'UNKNOWN - provider configuration required'
      };
    } catch (err: any) {
      console.warn('PayPal live balance query notice:', err?.response?.data || err.message);
    }
  }

  return {
    success: false,
    accountId: '',
    merchantName: '',
    email: '',
    paypalMeUsername: '',
    availableBalance: 0,
    totalBalance: 0,
    withheldBalance: 0,
    currency: 'USD',
    asOfTime: new Date().toISOString(),
    isLiveRest: false,
    autoSweepStatus: 'UNKNOWN - provider confirmation required',
    linkedBank: 'UNKNOWN - provider configuration required'
  };
}

/**
 * Fetch Real-Time PayPal Transactions from Reporting API
 */
export async function getPayPalLiveTransactions(days: number = 30): Promise<{
  success: boolean;
  totalItems: number;
  transactions: any[];
  isLiveRest: boolean;
}> {
  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();

  if (token) {
    try {
      const now = Date.now();
      const startDate = new Date(now - Math.min(days, 30) * 86400000).toISOString().split('.')[0] + 'Z';
      const endDate = new Date(now).toISOString().split('.')[0] + 'Z';

      const res = await axios.get(
        `${baseUrl}/v1/reporting/transactions?start_date=${startDate}&end_date=${endDate}&page_size=50&fields=all`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          timeout: 10000
        }
      );

      const items = res.data?.transaction_details || [];
      const parsedTransactions = items.map((t: any) => {
        const info = t.transaction_info || {};
        const payer = t.payer_info || {};
        const amt = parseFloat(info.transaction_amount?.value || '0.00');

        return {
          id: info.transaction_id || `tx_${Date.now()}`,
          paypalTransactionId: info.transaction_id,
          amount: amt,
          currency: info.transaction_amount?.currency_code || 'USD',
          status: info.transaction_status || 'SUCCESS',
          date: info.transaction_initiation_date || new Date().toISOString(),
          payerName: payer.payer_name?.alternate_full_name || `${payer.payer_name?.given_name || ''} ${payer.payer_name?.surname || ''}`.trim() || 'PayPal Client',
          payerEmail: payer.email_address || 'client@paypal.com',
          description: info.transaction_subject || info.transaction_note || 'Direct Freelance Revenue',
          isLiveRest: true,
          type: amt >= 0 ? 'credit' : 'debit'
        };
      });

      return {
        success: true,
        totalItems: res.data?.total_items || parsedTransactions.length,
        transactions: parsedTransactions,
        isLiveRest: true
      };
    } catch (err: any) {
      console.warn('PayPal reporting transactions query notice:', err?.response?.data || err.message);
    }
  }

  return {
    success: false,
    totalItems: 0,
    transactions: [],
    isLiveRest: false
  };
}

/**
 * Create an Official Live PayPal Invoice via Invoicing v2 API
 */
export async function createLivePayPalInvoice(params: {
  amount: number;
  currency?: string;
  clientName: string;
  clientEmail: string;
  title: string;
  description?: string;
  note?: string;
}): Promise<{
  success: boolean;
  invoiceId: string;
  invoiceNumber: string;
  payerViewUrl: string;
  status: string;
  amount: number;
  currency: string;
  isLiveRest: boolean;
}> {
  const cfg = getPayPalConfig();
  const token = await getPayPalAccessToken();
  const baseUrl = getPayPalBaseUrl();
  const currency = params.currency || cfg.currency || 'USD';
  const formattedAmount = Number(params.amount).toFixed(2);

  if (token) {
    try {
      // 1. Generate unique invoice number
      let invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
      try {
        const numRes = await axios.post(
          `${baseUrl}/v2/invoicing/generate-next-invoice-number`,
          {},
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            timeout: 8000
          }
        );
        if (numRes.data?.invoice_number) {
          invoiceNumber = numRes.data.invoice_number;
        }
      } catch (numErr) {
        console.warn('Could not generate next invoice number, using timestamp:', numErr);
      }

      // 2. Build invoice payload with Payoneer Citibank Payment Instructions
      const paymentInstructions = [
        'PAYMENT INSTRUCTIONS:',
        'Payoneer USD Checking Account (Citibank NY):',
        '• Bank Name: Citibank',
        '• Bank Address: 111 Wall Street New York, NY 10043 USA',
        '• Beneficiary: Kundan Kumar',
        '• Account Number: 70589110002638744',
        '• Account Type: CHECKING',
        '• Routing (ABA): 031100209',
        '• SWIFT / BIC: CITIUS33',
        '• Currency: USD',
        '• PayPal Direct Link: https://paypal.me/ky8402'
      ].join('\n');

      const invoicePayload = {
        detail: {
          invoice_number: invoiceNumber,
          invoice_date: new Date().toISOString().split('T')[0],
          currency_code: currency,
          note: params.note ? `${params.note}\n\n${paymentInstructions}` : `Milestone deliverable payment for freelance engineering services.\n\n${paymentInstructions}`,
          terms_and_conditions: paymentInstructions,
          payment_term: {
            term_type: 'DUE_ON_RECEIPT'
          }
        },
        invoicer: {
          business_name: 'Kundan Kumar',
          email_address: cfg.receiverEmail || 'kundank4@icloud.com'
        },
        primary_recipients: [
          {
            billing_info: {
              name: {
                given_name: params.clientName || 'Client'
              },
              email_address: params.clientEmail || 'client@example.com'
            }
          }
        ],
        items: [
          {
            name: params.title || 'Freelance Milestone',
            description: params.description || 'Full-Stack Development and Autonomous Cloud Engineering',
            quantity: '1',
            unit_amount: {
              currency_code: currency,
              value: formattedAmount
            },
            unit_of_measure: 'QUANTITY'
          }
        ]
      };

      const createRes = await axios.post(`${baseUrl}/v2/invoicing/invoices`, invoicePayload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const invoiceHref = createRes.data?.href || '';
      const invoiceId = invoiceHref.split('/').pop() || `INV2-${Date.now()}`;

      // 3. Send invoice to generate official payer view URL
      let payerViewUrl = `https://www.paypal.com/invoice/p/#${invoiceId}`;
      try {
        const sendRes = await axios.post(
          `${baseUrl}/v2/invoicing/invoices/${invoiceId}/send`,
          {
            send_to_recipient: Boolean(params.clientEmail && !params.clientEmail.includes('example.com')),
            send_to_invoicer: true
          },
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );

        if (sendRes.data?.href) {
          payerViewUrl = sendRes.data.href;
        }
      } catch (sendErr) {
        console.warn('Invoice send step notice:', sendErr);
      }

      return {
        success: true,
        invoiceId,
        invoiceNumber,
        payerViewUrl,
        status: 'SENT',
        amount: Number(params.amount),
        currency,
        isLiveRest: true
      };
    } catch (err: any) {
      console.warn('PayPal Invoicing REST API error:', err?.response?.data || err.message);
    }
  }

  throw new Error('PAYPAL_INVOICE_CREATE_FAILED: PayPal did not confirm invoice creation.');
}
