import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma, isDatabaseConfigured } from './db.js';

export interface AuthenticatedRequest extends Request {
  user?: any;
}

const JWT_SECRET = process.env.JWT_SECRET || process.env.OWNER_SESSION_SECRET || '';

/**
 * Authentication Middleware
 * Resolves user from JWT Bearer token or fallback user headers
 */
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (JWT_SECRET.length < 32) {
    return res.status(503).json({ success: false, error: 'Authentication service is not configured.' });
  }

  try {
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if ((req as any).cookies) {
      token = String((req as any).cookies.token || (req as any).cookies.auth_token || '').trim();
    }

    if (!token || token.length > 4096) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    let decodedToken: any;
    try {
      decodedToken = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid or expired authentication token.' });
    }

    const userId = decodedToken?.userId || decodedToken?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication token has no user identity.' });
    }

    if (!isDatabaseConfigured) {
      return res.status(503).json({ success: false, error: 'User database is not configured.' });
    }

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return res.status(401).json({ success: false, error: 'Authenticated user no longer exists.' });
      }
      req.user = user;
      return next();
    } catch {
      return res.status(503).json({ success: false, error: 'User authentication lookup failed.' });
    }
  } catch {
    return res.status(401).json({ success: false, error: 'Authentication failed.' });
  }
};
export default authMiddleware;
