import crypto from 'crypto';

export interface SignatureVerificationResult {
  valid: boolean;
  status: 'VERIFIED' | 'MISMATCH' | 'MISSING_SIGNATURE' | 'INVALID_FORMAT' | 'EXPIRED_TIMESTAMP';
  algorithm: string;
  headerName: string;
  receivedSignature: string;
  computedSignature: string;
  expectedHeader: string;
  timingMs: number;
  reason?: string;
  timestamp?: number;
  timestampTolerancePassed?: boolean;
}

// Default runtime signing secret fallback
let runtimeWebhookSecret: string = process.env.WEBHOOK_SIGNING_SECRET || process.env.PAYPAL_WEBHOOK_ID || 'whsec_standard_live_secure_key_369';

export function getEffectiveWebhookSecret(): string {
  return process.env.WEBHOOK_SIGNING_SECRET || process.env.PAYPAL_WEBHOOK_ID || runtimeWebhookSecret;
}

export function setRuntimeWebhookSecret(newSecret: string): void {
  if (newSecret && typeof newSecret === 'string') {
    runtimeWebhookSecret = newSecret.trim();
  }
}

/**
 * Normalize payload to raw string format for cryptographic hashing
 */
export function normalizePayloadToString(payload: any): string {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload === null || payload === undefined) {
    return '';
  }
  return JSON.stringify(payload);
}

/**
 * Compute HMAC-SHA256 hex string from payload & secret
 */
export function computeHmacSha256(secret: string, payload: string | object): string {
  const payloadString = normalizePayloadToString(payload);
  return crypto.createHmac('sha256', secret).update(payloadString, 'utf8').digest('hex');
}

/**
 * Compute HMAC with arbitrary algorithm (sha256, sha1, sha512)
 */
export function computeHmac(secret: string, payload: string | object, algorithm: 'sha256' | 'sha1' | 'sha512' = 'sha256'): string {
  const payloadString = normalizePayloadToString(payload);
  return crypto.createHmac(algorithm, secret).update(payloadString, 'utf8').digest('hex');
}

/**
 * Generate standard webhook signature header value
 */
export function generateSignatureHeader(secret: string, payload: string | object, format: 'prefix_sha256' | 'raw_hex' | 'timestamped_v1' | 'base64' = 'prefix_sha256'): string {
  const payloadString = normalizePayloadToString(payload);
  const hashHex = crypto.createHmac('sha256', secret).update(payloadString, 'utf8').digest('hex');

  if (format === 'raw_hex') {
    return hashHex;
  }
  if (format === 'base64') {
    return crypto.createHmac('sha256', secret).update(payloadString, 'utf8').digest('base64');
  }
  if (format === 'timestamped_v1') {
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payloadString}`;
    const hash = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    return `t=${timestamp},v1=${hash}`;
  }

  return `sha256=${hashHex}`;
}

/**
 * Safe timing comparison between two hex strings
 */
function safeTimingEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Comprehensive Webhook Signature Verification Helper
 */
export function verifyWebhookSignature(options: {
  secret?: string;
  payload: any;
  signature?: string;
  headerName?: string;
  algorithm?: 'sha256' | 'sha1' | 'sha512';
  toleranceSeconds?: number;
}): SignatureVerificationResult {
  const start = performance.now();
  const secret = options.secret || getEffectiveWebhookSecret();
  const algorithm = options.algorithm || 'sha256';
  const headerName = options.headerName || 'x-webhook-signature';
  const rawSignature = (options.signature || '').trim();
  const toleranceSeconds = options.toleranceSeconds || 300; // 5 mins replay window

  const payloadString = normalizePayloadToString(options.payload);
  const directHash = crypto.createHmac(algorithm, secret).update(payloadString, 'utf8').digest('hex');
  const expectedHeader = `sha256=${directHash}`;

  if (!rawSignature) {
    return {
      valid: false,
      status: 'MISSING_SIGNATURE',
      algorithm,
      headerName,
      receivedSignature: '',
      computedSignature: directHash,
      expectedHeader,
      timingMs: parseFloat((performance.now() - start).toFixed(3)),
      reason: `No signature provided in ${headerName} header.`
    };
  }

  // Handle timestamped signature format: t=timestamp,v1=hash
  if (rawSignature.includes('t=') && rawSignature.includes('v1=')) {
    const parts = rawSignature.split(',');
    let timestampStr = '';
    let v1Hash = '';

    for (const part of parts) {
      const [k, v] = part.split('=');
      if (k === 't') timestampStr = v;
      if (k === 'v1') v1Hash = v;
    }

    const timestampNum = parseInt(timestampStr, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    const diff = Math.abs(nowSec - timestampNum);
    const timePassed = diff <= toleranceSeconds;

    if (!timePassed) {
      return {
        valid: false,
        status: 'EXPIRED_TIMESTAMP',
        algorithm: 'sha256',
        headerName,
        receivedSignature: rawSignature,
        computedSignature: '',
        expectedHeader: `t=${timestampStr},v1=<computed>`,
        timingMs: parseFloat((performance.now() - start).toFixed(3)),
        timestamp: timestampNum,
        timestampTolerancePassed: false,
        reason: `Signature timestamp ${timestampNum} is older than ${toleranceSeconds}s tolerance (difference: ${diff}s).`
      };
    }

    const signedPayload = `${timestampStr}.${payloadString}`;
    const computedHash = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    const isValid = safeTimingEqual(v1Hash, computedHash);

    return {
      valid: isValid,
      status: isValid ? 'VERIFIED' : 'MISMATCH',
      algorithm: 'sha256',
      headerName,
      receivedSignature: v1Hash,
      computedSignature: computedHash,
      expectedHeader: `t=${timestampStr},v1=${computedHash}`,
      timingMs: parseFloat((performance.now() - start).toFixed(3)),
      timestamp: timestampNum,
      timestampTolerancePassed: true,
      reason: isValid ? 'HMAC SHA-256 signature verified' : 'Computed hash did not match v1 signature'
    };
  }

  // Standard hex format: sha256=<hex> or raw <hex>
  let cleanReceived = rawSignature;
  if (rawSignature.startsWith('sha256=')) {
    cleanReceived = rawSignature.substring(7);
  }

  const isValid = safeTimingEqual(cleanReceived, directHash);

  return {
    valid: isValid,
    status: isValid ? 'VERIFIED' : 'MISMATCH',
    algorithm,
    headerName,
    receivedSignature: cleanReceived,
    computedSignature: directHash,
    expectedHeader,
    timingMs: parseFloat((performance.now() - start).toFixed(3)),
    reason: isValid ? 'HMAC SHA-256 signature verified' : 'Hash signature mismatch'
  };
}
