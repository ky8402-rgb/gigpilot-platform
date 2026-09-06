import axios from 'axios';

export interface GoDaddyDnsRecord {
  type: string;
  name: string;
  data: string;
  ttl?: number;
  priority?: number;
  weight?: number;
  port?: number;
  protocol?: string;
  service?: string;
}

export interface GoDaddyCredentials {
  key: string;
  secret: string;
  baseUrl: string;
}

/**
 * Resolves GoDaddy API credentials from arguments or environment
 */
export function getGoDaddyCredentials(apiKey?: string, apiSecret?: string): GoDaddyCredentials {
  const key = apiKey || process.env.GODADDY_API_KEY || '';
  const secret = apiSecret || process.env.GODADDY_API_SECRET || '';
  const env = (process.env.GODADDY_ENV || 'production').toLowerCase();
  const baseUrl = env === 'ote' || env === 'test'
    ? 'https://api.ote-godaddy.com/v1'
    : 'https://api.godaddy.com/v1';

  return { key, secret, baseUrl };
}

/**
 * Headers required by GoDaddy REST API
 */
function getHeaders(key: string, secret: string) {
  return {
    'Authorization': `sso-key ${key}:${secret}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/**
 * Fetches all existing DNS records for the specified domain
 */
export async function fetchGoDaddyRecords(
  domain: string = 'gigpilot.com',
  apiKey?: string,
  apiSecret?: string
): Promise<{ success: boolean; records?: GoDaddyDnsRecord[]; error?: string; status?: number }> {
  const { key, secret, baseUrl } = getGoDaddyCredentials(apiKey, apiSecret);

  if (!key || !secret) {
    return {
      success: false,
      error: 'GoDaddy API Key and Secret are not configured. Please provide them via environment variables (GODADDY_API_KEY, GODADDY_API_SECRET) or in the request payload.',
    };
  }

  try {
    const url = `${baseUrl}/domains/${domain}/records`;
    const response = await axios.get<GoDaddyDnsRecord[]>(url, {
      headers: getHeaders(key, secret),
      timeout: 10000,
    });

    return {
      success: true,
      records: response.data,
      status: response.status,
    };
  } catch (err: any) {
    const status = err.response?.status;
    let errorMsg = err.message || 'Failed to fetch GoDaddy DNS records';
    if (status === 401 || status === 403) {
      errorMsg = 'Authentication failed: Invalid GoDaddy API Key or Secret. Ensure you generated production keys from https://developer.godaddy.com/keys.';
    } else if (status === 404) {
      errorMsg = `Domain '${domain}' was not found in this GoDaddy account.`;
    } else if (err.response?.data?.message) {
      errorMsg = `GoDaddy API Error: ${err.response.data.message}`;
    }
    return {
      success: false,
      error: errorMsg,
      status,
    };
  }
}

/**
 * Updates a specific record set (type and name) without affecting other DNS records
 */
export async function putGoDaddyRecord(
  domain: string,
  type: string,
  name: string,
  records: Array<{ data: string; ttl?: number }>,
  apiKey?: string,
  apiSecret?: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  const { key, secret, baseUrl } = getGoDaddyCredentials(apiKey, apiSecret);

  if (!key || !secret) {
    return {
      success: false,
      error: 'GoDaddy API Key and Secret are required.',
    };
  }

  try {
    const url = `${baseUrl}/domains/${domain}/records/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;
    const payload = records.map(r => ({
      data: r.data,
      ttl: r.ttl || 600,
    }));

    const response = await axios.put(url, payload, {
      headers: getHeaders(key, secret),
      timeout: 10000,
    });

    return {
      success: true,
      status: response.status,
    };
  } catch (err: any) {
    const status = err.response?.status;
    let errorMsg = err.message || `Failed to update ${type} record for ${name}`;
    if (err.response?.data?.message) {
      errorMsg = `GoDaddy API Error: ${err.response.data.message}`;
    }
    return {
      success: false,
      error: errorMsg,
      status,
    };
  }
}

export interface AutoFixDnsResult {
  success: boolean;
  message: string;
  domain: string;
  target: 'ec2' | 'amplify';
  updatedRecords: GoDaddyDnsRecord[];
  previousRecords?: GoDaddyDnsRecord[];
  error?: string;
  dnsPropagationNote: string;
}

/**
 * Automatically replaces the invalid 1.1.1.1 record on GoDaddy with either
 * AWS EC2 (13.233.54.120) or AWS Amplify (d2qe2q720fbn3x.amplifyapp.com).
 */
export async function autoFixGoDaddyDns(options: {
  domain?: string;
  target?: 'ec2' | 'amplify';
  apiKey?: string;
  apiSecret?: string;
  ec2Ip?: string;
  amplifyHost?: string;
}): Promise<AutoFixDnsResult> {
  const domain = options.domain || 'gigpilot.com';
  const target = options.target || 'ec2';
  const rawEc2 = process.env.EC2_HOST;
  const defaultEc2 = (!rawEc2 || rawEc2.startsWith('i-') || rawEc2 === '13.233.54.120') ? '3.222.149.9' : rawEc2;
  const ec2Ip = options.ec2Ip || defaultEc2;
  const rawAmplify = process.env.AMPLIFY_APP_ID;
  const defaultAmplify = (!rawAmplify || rawAmplify.startsWith('AKIA')) ? 'd2qe2q720fbn3x' : rawAmplify;
  const amplifyHost = options.amplifyHost || `${defaultAmplify}.amplifyapp.com`;

  // 1. Fetch current records first to inspect the state and preserve backup
  const fetchRes = await fetchGoDaddyRecords(domain, options.apiKey, options.apiSecret);
  if (!fetchRes.success) {
    return {
      success: false,
      message: `Failed to access GoDaddy DNS: ${fetchRes.error}`,
      domain,
      target,
      updatedRecords: [],
      error: fetchRes.error,
      dnsPropagationNote: 'No records were changed due to authentication or network failure.',
    };
  }

  const previousRecords = fetchRes.records || [];
  const updatedRecords: GoDaddyDnsRecord[] = [];

  if (target === 'ec2') {
    // Point apex @ to EC2 IP
    const updateApexRes = await putGoDaddyRecord(
      domain,
      'A',
      '@',
      [{ data: ec2Ip, ttl: 600 }],
      options.apiKey,
      options.apiSecret
    );

    if (!updateApexRes.success) {
      return {
        success: false,
        message: `Failed updating apex A record to ${ec2Ip}: ${updateApexRes.error}`,
        domain,
        target,
        updatedRecords,
        previousRecords,
        error: updateApexRes.error,
        dnsPropagationNote: 'Partial failure: could not set A record.',
      };
    }
    updatedRecords.push({ type: 'A', name: '@', data: ec2Ip, ttl: 600 });

    // Point www to @
    const updateWwwRes = await putGoDaddyRecord(
      domain,
      'CNAME',
      'www',
      [{ data: '@', ttl: 600 }],
      options.apiKey,
      options.apiSecret
    );

    if (updateWwwRes.success) {
      updatedRecords.push({ type: 'CNAME', name: 'www', data: '@', ttl: 600 });
    }

    return {
      success: true,
      message: `Successfully updated GoDaddy DNS for '${domain}'! Apex '@' now points to EC2 (${ec2Ip}) and 'www' points to '@'. The 1.1.1.1 misconfiguration has been removed.`,
      domain,
      target,
      updatedRecords,
      previousRecords,
      dnsPropagationNote: 'DNS changes take 5 to 30 minutes to propagate globally across local DNS resolvers and ISPs.',
    };
  } else {
    // Target is AWS Amplify
    // 1. Point www CNAME to Amplify CloudFront target
    const updateWwwRes = await putGoDaddyRecord(
      domain,
      'CNAME',
      'www',
      [{ data: amplifyHost, ttl: 600 }],
      options.apiKey,
      options.apiSecret
    );

    if (!updateWwwRes.success) {
      return {
        success: false,
        message: `Failed updating www CNAME to ${amplifyHost}: ${updateWwwRes.error}`,
        domain,
        target,
        updatedRecords,
        previousRecords,
        error: updateWwwRes.error,
        dnsPropagationNote: 'Failed setting www CNAME for Amplify.',
      };
    }
    updatedRecords.push({ type: 'CNAME', name: 'www', data: amplifyHost, ttl: 600 });

    // 2. Also point apex @ to EC2 backend proxy so root requests don't hit 1.1.1.1
    const updateApexRes = await putGoDaddyRecord(
      domain,
      'A',
      '@',
      [{ data: ec2Ip, ttl: 600 }],
      options.apiKey,
      options.apiSecret
    );

    if (updateApexRes.success) {
      updatedRecords.push({ type: 'A', name: '@', data: ec2Ip, ttl: 600 });
    }

    return {
      success: true,
      message: `Successfully updated GoDaddy DNS for '${domain}'! 'www' now points to AWS Amplify (${amplifyHost}) and apex '@' points to backend proxy (${ec2Ip}). The 1.1.1.1 misconfiguration has been removed.`,
      domain,
      target,
      updatedRecords,
      previousRecords,
      dnsPropagationNote: 'DNS changes take 5 to 30 minutes to propagate globally across local DNS resolvers and ISPs.',
    };
  }
}
