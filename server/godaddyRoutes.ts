import express, { Request, Response } from 'express';
import {
  fetchGoDaddyRecords,
  autoFixGoDaddyDns,
  getGoDaddyCredentials
} from './godaddyDnsService.js';

export const godaddyRoutes = express.Router();

/**
 * GET /api/godaddy/status
 * Checks if GoDaddy credentials are configured and inspects active DNS records
 */
godaddyRoutes.get('/status', async (req: Request, res: Response) => {
  const domain = (req.query.domain as string) || 'gigpilot.com';
  const apiKey = (req.query.key as string) || undefined;
  const apiSecret = (req.query.secret as string) || undefined;
  const creds = getGoDaddyCredentials(apiKey, apiSecret);

  if (!creds.key || !creds.secret) {
    return res.json({
      success: true,
      configured: false,
      domain,
      message: 'GoDaddy API credentials are not yet configured. Please set GODADDY_API_KEY and GODADDY_API_SECRET.',
      targetOptions: [
        {
          id: 'ec2',
          name: 'AWS EC2 Backend / Fullstack',
          target: '3.222.149.9',
          description: 'Points apex @ to EC2 (3.222.149.9) and www to @',
        },
        {
          id: 'amplify',
          name: 'AWS Amplify Frontend',
          target: 'd2qe2q720fbn3x.amplifyapp.com',
          description: 'Points www to Amplify CloudFront and @ to backend proxy',
        },
      ],
    });
  }

  const result = await fetchGoDaddyRecords(domain, creds.key, creds.secret);

  if (!result.success) {
    return res.status(200).json({
      success: false,
      configured: true,
      domain,
      error: result.error,
    });
  }

  const records = result.records || [];
  const has1111Misconfig = records.some(
    r => (r.type === 'A' && r.data === '1.1.1.1') || (r.type === 'CNAME' && r.data === '1.1.1.1')
  );

  return res.json({
    success: true,
    configured: true,
    domain,
    has1111Misconfig,
    records,
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/godaddy/update-dns
 * Automatically updates GoDaddy DNS records to point to EC2 or Amplify
 */
godaddyRoutes.post('/update-dns', async (req: Request, res: Response) => {
  try {
    const {
      domain = 'gigpilot.com',
      target = 'ec2',
      apiKey,
      apiSecret,
      ec2Ip,
      amplifyHost
    } = req.body;

    const result = await autoFixGoDaddyDns({
      domain,
      target,
      apiKey,
      apiSecret,
      ec2Ip,
      amplifyHost
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal error executing GoDaddy DNS update',
    });
  }
});

export default godaddyRoutes;
