import express, { Request, Response } from 'express';
import {
  getCloudflareZoneId,
  listCloudflareRecords,
  createCloudflareRecord,
  updateCloudflareRecord,
  deleteCloudflareRecord,
  executeGigpilotCloudflareMigration,
} from './cloudflareDnsService.js';

export const cloudflareRoutes = express.Router();

/**
 * GET /api/cloudflare/status
 * Queries Cloudflare to inspect zone status and DNS records
 */
cloudflareRoutes.get('/status', async (req: Request, res: Response) => {
  const domain = (req.query.domain as string) || 'ky7079.co';
  const token = (req.query.token as string) || process.env.CLOUDFLARE_API_TOKEN;

  if (!token && !process.env.CLOUDFLARE_API_KEY) {
    return res.json({
      success: true,
      configured: false,
      domain,
      message: 'CLOUDFLARE_API_TOKEN is not configured.',
    });
  }

  const zoneRes = await getCloudflareZoneId(domain, token);
  if (!zoneRes.success || !zoneRes.zoneId) {
    return res.json({
      success: false,
      configured: true,
      domain,
      error: zoneRes.error,
    });
  }

  const recordsRes = await listCloudflareRecords(zoneRes.zoneId, token);
  return res.json({
    success: true,
    configured: true,
    domain,
    zone: zoneRes.zone,
    records: recordsRes.records || [],
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/cloudflare/dns_records & POST /api/cloudflare/update_cloudflare_dns
 * Cloudflare API v4 DNS management endpoint.
 *
 * Parameters:
 *  - action: 'create' | 'update' | 'delete' | 'list' | 'migrate'
 *  - record_type (or type): 'A' | 'CNAME' | 'TXT' | 'MX' etc.
 *  - name: e.g. '@' or 'gigpilot.com' or 'www'
 *  - value (or content): e.g. '13.233.54.120'
 *  - ttl: number (e.g. 600)
 *  - record_id: string (optional, for update/delete)
 *  - domain: string (default: 'gigpilot.com')
 *  - zone_id: string (optional, auto-resolves)
 *  - token: string (optional, uses CLOUDFLARE_API_TOKEN)
 */
async function handleDnsRecords(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const token = req.body.token || bearerToken || process.env.CLOUDFLARE_API_TOKEN;

    const {
      action = 'create',
      record_type = req.body.type || 'A',
      name = '@',
      value = req.body.content || '',
      ttl = 600,
      record_id,
      domain = 'ky7079.co',
      proxied = false,
    } = req.body;

    let zoneId = req.body.zone_id || req.params.zone_id || (domain === 'ky7079.co' ? '4bd2820de10e3037a95a41d823a53e6c' : process.env.CLOUDFLARE_ZONE_ID);
    if (!zoneId) {
      const zoneRes = await getCloudflareZoneId(domain, token);
      if (!zoneRes.success || !zoneRes.zoneId) {
        return res.status(400).json({ success: false, error: zoneRes.error || 'Failed to resolve zone ID' });
      }
      zoneId = zoneRes.zoneId;
    }

    if (action === 'list') {
      const listRes = await listCloudflareRecords(zoneId, token);
      return res.json(listRes);
    }

    if (action === 'delete') {
      let targetId = record_id;
      if (!targetId) {
        // Find by name and type if not provided
        const listRes = await listCloudflareRecords(zoneId, token);
        const match = listRes.records?.find(
          r => (r.name === name || r.name === `${name}.${domain}` || (name === '@' && r.name === domain)) &&
               r.type.toUpperCase() === record_type.toUpperCase()
        );
        if (match?.id) {
          targetId = match.id;
        } else {
          return res.status(404).json({ success: false, error: `No record found matching ${record_type} ${name}` });
        }
      }
      const delRes = await deleteCloudflareRecord(zoneId, targetId, token);
      return res.json(delRes);
    }

    if (action === 'update') {
      let targetId = record_id;
      if (!targetId) {
        const listRes = await listCloudflareRecords(zoneId, token);
        const match = listRes.records?.find(
          r => (r.name === name || r.name === `${name}.${domain}` || (name === '@' && r.name === domain)) &&
               r.type.toUpperCase() === record_type.toUpperCase()
        );
        if (match?.id) {
          targetId = match.id;
        } else {
          return res.status(404).json({ success: false, error: `No record found to update matching ${record_type} ${name}` });
        }
      }
      const updateRes = await updateCloudflareRecord(
        zoneId,
        targetId,
        {
          type: record_type,
          name: name === '@' ? domain : name,
          content: value,
          ttl: Number(ttl) || 600,
          proxied: Boolean(proxied),
        },
        token
      );
      return res.json(updateRes);
    }

    if (action === 'migrate') {
      const result = await executeGigpilotCloudflareMigration({
        domain,
        ec2Ip: value || '3.222.149.9',
        token,
        zoneId,
      });
      return res.json(result);
    }

    // Default action: create
    const createRes = await createCloudflareRecord(
      zoneId,
      {
        type: record_type,
        name: name === '@' ? domain : name,
        content: value,
        ttl: Number(ttl) || 600,
        proxied: Boolean(proxied),
      },
      token
    );
    return res.json(createRes);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

cloudflareRoutes.post('/dns_records', handleDnsRecords);
cloudflareRoutes.post('/update_cloudflare_dns', handleDnsRecords);
cloudflareRoutes.all('/zones/:zone_id/dns_records', handleDnsRecords);

/**
 * POST /api/cloudflare/migrate
 * Executes the full DNS migration for gigpilot.com
 */
cloudflareRoutes.post('/migrate', async (req: Request, res: Response) => {
  try {
    const rawEc2 = process.env.EC2_HOST;
    const defaultHost = (!rawEc2 || rawEc2.startsWith('i-') || rawEc2 === '13.233.54.120') ? '3.222.149.9' : rawEc2;
    const { domain = 'gigpilot.com', ec2Ip = defaultHost, token, zoneId } = req.body;
    const result = await executeGigpilotCloudflareMigration({
      domain,
      ec2Ip,
      token,
      zoneId,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default cloudflareRoutes;

