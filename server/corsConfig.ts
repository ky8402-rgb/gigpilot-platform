import { Request, Response, NextFunction } from 'express';

export interface CorsConfigOptions {
  strictMode?: boolean;
  allowedOrigins?: string[];
  amplifyAppId?: string;
  ec2Host?: string;
}

/**
 * Evaluates whether an incoming HTTP Origin header is authorized.
 * In strict mode (CORS_STRICT=true):
 * - Locks down wildcards to the specific authorized Amplify App ID and EC2 sslip.io host
 * - Rejects arbitrary third-party .amplifyapp.com or .sslip.io domains
 * - Protects against CSRF and cross-origin data extraction
 */
export function isAllowedOrigin(
  origin: string | undefined,
  options?: CorsConfigOptions
): boolean {
  if (!origin) return true; // Direct server-to-server, curl, backend worker, healthcheck

  const isStrict = options?.strictMode ?? (process.env.CORS_STRICT === 'true');
  const customAllowed = options?.allowedOrigins ??
    (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

  const amplifyAppId = (options?.amplifyAppId || process.env.AMPLIFY_APP_ID || 'd2qe2q720fbn3x').toLowerCase();
  const rawEc2Host = options?.ec2Host || process.env.EC2_HOST || '35.154.110.156';
  const ec2SslipHost = `${rawEc2Host.replace(/\./g, '-')}.sslip.io`.toLowerCase();

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    // 1. Localhost development environments
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return true;
    }

    // 2. Custom environment allowlist (exact origin or hostname match)
    if (customAllowed.includes(origin.toLowerCase()) || customAllowed.includes(host)) {
      return true;
    }

    // 3. Custom primary domain (kundanvision.com and its subdomains)
    if (host === 'kundanvision.com' || host.endsWith('.kundanvision.com')) {
      return true;
    }

    // 4. Google Cloud Run & AI Studio preview domains
    if (host.endsWith('.run.app') || host.endsWith('.googleusercontent.com')) {
      return true;
    }

    // 5. AWS Amplify & EC2 sslip.io validation
    if (isStrict) {
      // STRICT MODE: Only allow the specific Amplify App ID and specific EC2 host
      if (host === `${amplifyAppId}.amplifyapp.com` || host.endsWith(`.${amplifyAppId}.amplifyapp.com`)) {
        return true;
      }
      if (host === ec2SslipHost || host === rawEc2Host) {
        return true;
      }
      // In strict mode, reject any unvetted wildcard
      return false;
    } else {
      // PERMISSIVE MODE: Allow any .amplifyapp.com or .sslip.io for dev/staging
      if (host.endsWith('.amplifyapp.com')) return true;
      if (host.endsWith('.sslip.io')) return true;
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Express CORS Middleware enforcing origin validation and CORS_STRICT protections.
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  const isStrict = process.env.CORS_STRICT === 'true';
  const allowed = isAllowedOrigin(origin, { strictMode: isStrict });

  if (allowed) {
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    } else {
      res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-GitHub-Event, X-GitHub-Delivery, X-Hub-Signature-256, X-Owner-Token'
    );
  } else {
    // Untrusted cross-origin request
    if (isStrict) {
      // Under strict mode, reject preflights and cross-origin API calls with 403 Forbidden
      if (req.method === 'OPTIONS') {
        return res.status(403).json({
          error: 'CORS policy violation: Origin not allowed under CORS_STRICT.',
          origin
        });
      }
      res.header('Access-Control-Allow-Origin', 'null');
      return res.status(403).json({
        error: 'CORS policy violation: Origin not allowed under CORS_STRICT.',
        origin
      });
    } else {
      res.header('Access-Control-Allow-Origin', 'null');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
}
