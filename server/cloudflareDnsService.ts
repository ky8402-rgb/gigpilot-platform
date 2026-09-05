import axios from 'axios';

export interface CloudflareDnsRecord {
  id?: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string;
  created_on?: string;
  modified_on?: string;
}

export interface CloudflareApiResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  name_servers: string[];
}

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * Returns authorization headers for Cloudflare API v4
 */
export function getCloudflareHeaders(token?: string) {
  const apiKey = process.env.CLOUDFLARE_API_KEY;
  const email = process.env.CLOUDFLARE_EMAIL || 'ky8402@gmail.com';

  if (apiKey) {
    return {
      'X-Auth-Key': apiKey,
      'X-Auth-Email': email,
      'Content-Type': 'application/json',
    };
  }

  const apiToken = token || process.env.CLOUDFLARE_API_TOKEN || '';
  return {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Resolves Cloudflare Zone ID for a given domain name (e.g., gigpilot.com)
 */
export async function getCloudflareZoneId(domain: string = 'gigpilot.com', token?: string): Promise<{
  success: boolean;
  zoneId?: string;
  zone?: CloudflareZone;
  error?: string;
}> {
  const envZoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (envZoneId) {
    return { success: true, zoneId: envZoneId };
  }

  const apiToken = token || process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    return { success: false, error: 'CLOUDFLARE_API_TOKEN is not configured.' };
  }

  try {
    const url = `${CLOUDFLARE_API_BASE}/zones?name=${encodeURIComponent(domain)}`;
    const res = await axios.get<CloudflareApiResponse<CloudflareZone[]>>(url, {
      headers: getCloudflareHeaders(apiToken),
      timeout: 10000,
    });

    if (!res.data.success || !res.data.result || res.data.result.length === 0) {
      return {
        success: false,
        error: `No Cloudflare zone found for domain '${domain}'. Please make sure the domain has been added to your Cloudflare account.`,
      };
    }

    const zone = res.data.result[0];
    return {
      success: true,
      zoneId: zone.id,
      zone,
    };
  } catch (err: any) {
    const errorMsg = err.response?.data?.errors?.[0]?.message || err.message || 'Failed to query Cloudflare zones';
    return { success: false, error: errorMsg };
  }
}

/**
 * Lists DNS records for a given zone
 */
export async function listCloudflareRecords(
  zoneId: string,
  token?: string
): Promise<{ success: boolean; records?: CloudflareDnsRecord[]; error?: string }> {
  try {
    const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?per_page=100`;
    const res = await axios.get<CloudflareApiResponse<CloudflareDnsRecord[]>>(url, {
      headers: getCloudflareHeaders(token),
      timeout: 10000,
    });

    if (!res.data.success) {
      return {
        success: false,
        error: res.data.errors?.[0]?.message || 'Failed to list DNS records from Cloudflare',
      };
    }

    return {
      success: true,
      records: res.data.result,
    };
  } catch (err: any) {
    const errorMsg = err.response?.data?.errors?.[0]?.message || err.message || 'Error listing Cloudflare records';
    return { success: false, error: errorMsg };
  }
}

/**
 * Creates a DNS record in Cloudflare
 */
export async function createCloudflareRecord(
  zoneId: string,
  record: {
    type: string;
    name: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
    comment?: string;
  },
  token?: string
): Promise<{ success: boolean; record?: CloudflareDnsRecord; error?: string }> {
  try {
    const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`;
    const res = await axios.post<CloudflareApiResponse<CloudflareDnsRecord>>(url, {
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl || 600,
      proxied: record.proxied ?? false,
      comment: record.comment || 'Managed via GigPilot automated DNS',
    }, {
      headers: getCloudflareHeaders(token),
      timeout: 10000,
    });

    if (!res.data.success) {
      return {
        success: false,
        error: res.data.errors?.[0]?.message || 'Failed to create Cloudflare DNS record',
      };
    }

    return { success: true, record: res.data.result };
  } catch (err: any) {
    const errorMsg = err.response?.data?.errors?.[0]?.message || err.message || 'Error creating Cloudflare record';
    return { success: false, error: errorMsg };
  }
}

/**
 * Deletes a DNS record in Cloudflare
 */
export async function deleteCloudflareRecord(
  zoneId: string,
  recordId: string,
  token?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`;
    const res = await axios.delete<CloudflareApiResponse<{ id: string }>>(url, {
      headers: getCloudflareHeaders(token),
      timeout: 10000,
    });

    if (!res.data.success) {
      return {
        success: false,
        error: res.data.errors?.[0]?.message || 'Failed to delete Cloudflare DNS record',
      };
    }

    return { success: true };
  } catch (err: any) {
    const errorMsg = err.response?.data?.errors?.[0]?.message || err.message || 'Error deleting Cloudflare record';
    return { success: false, error: errorMsg };
  }
}

/**
 * Updates an existing DNS record in Cloudflare
 */
export async function updateCloudflareRecord(
  zoneId: string,
  recordId: string,
  record: {
    type: string;
    name: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
    comment?: string;
  },
  token?: string
): Promise<{ success: boolean; record?: CloudflareDnsRecord; error?: string }> {
  try {
    const url = `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`;
    const res = await axios.put<CloudflareApiResponse<CloudflareDnsRecord>>(url, {
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl || 600,
      proxied: record.proxied ?? false,
      comment: record.comment || 'Managed via GigPilot automated DNS',
    }, {
      headers: getCloudflareHeaders(token),
      timeout: 10000,
    });

    if (!res.data.success) {
      return {
        success: false,
        error: res.data.errors?.[0]?.message || 'Failed to update Cloudflare DNS record',
      };
    }

    return { success: true, record: res.data.result };
  } catch (err: any) {
    const errorMsg = err.response?.data?.errors?.[0]?.message || err.message || 'Error updating Cloudflare record';
    return { success: false, error: errorMsg };
  }
}

/**
 * Executes full migration setup on Cloudflare for gigpilot.com:
 * 1. Resolves Zone ID
 * 2. Fetches existing DNS records
 * 3. Deletes any existing A or CNAME records for @ (including 1.1.1.1) and www
 * 4. Creates A record for @ pointing to 13.233.54.120 (TTL 600)
 * 5. Creates CNAME record for www pointing to gigpilot.com / @ (TTL 600)
 */
export async function executeGigpilotCloudflareMigration(options: {
  domain?: string;
  ec2Ip?: string;
  token?: string;
  zoneId?: string;
}): Promise<{
  success: boolean;
  message: string;
  zoneId?: string;
  deletedRecords: CloudflareDnsRecord[];
  createdRecords: CloudflareDnsRecord[];
  allActiveRecords: CloudflareDnsRecord[];
  error?: string;
}> {
  const domain = options.domain || 'gigpilot.com';
  const ec2Ip = options.ec2Ip || process.env.EC2_HOST || '13.233.54.120';
  const token = options.token || process.env.CLOUDFLARE_API_TOKEN;

  if (!token) {
    return {
      success: false,
      message: 'Cloudflare API token is missing. Please provide CLOUDFLARE_API_TOKEN.',
      deletedRecords: [],
      createdRecords: [],
      allActiveRecords: [],
      error: 'Token missing',
    };
  }

  // 1. Resolve Zone ID
  let targetZoneId = options.zoneId;
  if (!targetZoneId) {
    const zoneRes = await getCloudflareZoneId(domain, token);
    if (!zoneRes.success || !zoneRes.zoneId) {
      return {
        success: false,
        message: `Zone identification failed: ${zoneRes.error}`,
        deletedRecords: [],
        createdRecords: [],
        allActiveRecords: [],
        error: zoneRes.error,
      };
    }
    targetZoneId = zoneRes.zoneId;
  }

  // 2. Fetch existing DNS records
  const listRes = await listCloudflareRecords(targetZoneId, token);
  if (!listRes.success || !listRes.records) {
    return {
      success: false,
      message: `Failed fetching existing records: ${listRes.error}`,
      zoneId: targetZoneId,
      deletedRecords: [],
      createdRecords: [],
      allActiveRecords: [],
      error: listRes.error,
    };
  }

  const existing = listRes.records;
  const deletedRecords: CloudflareDnsRecord[] = [];
  const createdRecords: CloudflareDnsRecord[] = [];

  // 3. Delete existing A/CNAME records for apex (@ or gigpilot.com) and www
  for (const r of existing) {
    const isApex = r.name === domain || r.name === `@`;
    const isWww = r.name === `www.${domain}` || r.name === 'www';

    if ((isApex && (r.type === 'A' || r.type === 'CNAME')) || (isWww && (r.type === 'A' || r.type === 'CNAME'))) {
      if (r.id) {
        const del = await deleteCloudflareRecord(targetZoneId, r.id, token);
        if (del.success) {
          deletedRecords.push(r);
        }
      }
    }
  }

  // 4. Create A record for @ -> 13.233.54.120 with TTL 600
  const apexRes = await createCloudflareRecord(
    targetZoneId,
    {
      type: 'A',
      name: '@',
      content: ec2Ip,
      ttl: 600,
      proxied: false, // DNS-only for direct EC2 resolution
      comment: 'EC2 Backend / Full-Stack',
    },
    token
  );

  if (!apexRes.success || !apexRes.record) {
    return {
      success: false,
      message: `Failed creating A record for @: ${apexRes.error}`,
      zoneId: targetZoneId,
      deletedRecords,
      createdRecords,
      allActiveRecords: [],
      error: apexRes.error,
    };
  }
  createdRecords.push(apexRes.record);

  // 5. Create CNAME record for www -> @ with TTL 600
  const wwwRes = await createCloudflareRecord(
    targetZoneId,
    {
      type: 'CNAME',
      name: 'www',
      content: domain,
      ttl: 600,
      proxied: false,
      comment: 'WWW Alias to Apex',
    },
    token
  );

  if (wwwRes.success && wwwRes.record) {
    createdRecords.push(wwwRes.record);
  }

  // 6. Fetch final state
  const finalListRes = await listCloudflareRecords(targetZoneId, token);

  return {
    success: true,
    message: `Cloudflare DNS migration completed successfully for ${domain}! Erroneous records removed, and apex '@' points to ${ec2Ip} (TTL 600).`,
    zoneId: targetZoneId,
    deletedRecords,
    createdRecords,
    allActiveRecords: finalListRes.records || createdRecords,
  };
}
