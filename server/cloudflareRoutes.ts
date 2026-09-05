import express, { Request, Response } from 'express';
import {
  getCloudflareZoneId,
  listCloudflareRecords,
  createCloudflareRecord,
  deleteCloudflareRecord,
  executeGigpilotCloudflareMigration,
} from './cloudflareDnsService.js';

export const cloudflareRoutes = express.Router();

/**
 * GET /api/cloudflare/status
 * Queries Cloudflare to inspect zone status and DNS records
 */
cloudflareRoutes.get('/status', async (req: Request, res: Response) => {
  const domain = (req.query.domain as string) || 'gigpilot.com';
  const token = (req.query.token as string) || process.env.CLOUDFLARE_API_TOKEN;

  if (!token) {
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
 * POST /api/cloudflare/migrate
 * Executes the full DNS migration for gigpilot.com
 */
cloudflareRoutes.post('/migrate', async (req: Request, res: Response) => {
  try {
    const { domain = 'gigpilot.com', ec2Ip = '13.233.54.120', token, zoneId } = req.body;
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
