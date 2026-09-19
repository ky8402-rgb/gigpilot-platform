import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma, isDatabaseConfigured } from './db.js';

export interface AuthenticatedRequest extends Request {
  user?: any;
}

const JWT_SECRET = (process.env.JWT_SECRET || '').trim();

/**
 * Authentication Middleware
 * Resolves user from JWT Bearer token or fallback user headers
 */
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    return res.status(503).json({ error: 'AUTH_CONFIGURATION_REQUIRED' });
  }

  try {
    const authHeader = req.headers.authorization;
    let decodedToken: any = null;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        try { decodedToken = jwt.verify(token, JWT_SECRET); }
        catch { return res.status(401).json({ error: 'INVALID_OR_EXPIRED_TOKEN' }); }
      }
    }

    if (!decodedToken && (req as any).cookies) {
      const cookieToken = (req as any).cookies.token || (req as any).cookies.auth_token;
      if (cookieToken) {
        try { decodedToken = jwt.verify(cookieToken, JWT_SECRET); }
        catch { return res.status(401).json({ error: 'INVALID_OR_EXPIRED_TOKEN' }); }
      }
    }

    if (!decodedToken) {
      return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    }

    const userId = decodedToken.userId || decodedToken.id;
    if (!userId) return res.status(401).json({ error: 'TOKEN_USER_ID_REQUIRED' });

    if (!isDatabaseConfigured) {
      return res.status(503).json({ error: 'DATABASE_AUTH_REQUIRED' });
    }

    const user: any = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: 'USER_NOT_FOUND' });

    req.user = user;
    return next();
  } catch (error) {
    console.error('[JWT Auth] Authentication failure');
    return res.status(401).json({ error: 'AUTHENTICATION_FAILED' });
  }
};

export default authMiddleware;
