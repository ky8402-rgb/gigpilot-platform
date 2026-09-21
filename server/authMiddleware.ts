import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma, isDatabaseConfigured } from './db.js';

export interface AuthenticatedRequest extends Request {
  user?: any;
}

const JWT_SECRET = process.env.JWT_SECRET || 'gigpilot_default_jwt_secret_dev_369';

/**
 * Authentication Middleware
 * Resolves user from JWT Bearer token or fallback user headers
 */
export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const fallbackUser = {
    id: 'user_active_1',
    email: 'ky8402@gmail.com',
    name: 'Kundan Kumar',
    passwordHash: '',
    credits: 25,
    subscriptionStatus: 'active',
    createdAt: new Date(),
  };

  try {
    const authHeader = req.headers.authorization;
    let decodedToken: any = null;

    // 1. Check Authorization Bearer Header
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        decodedToken = jwt.verify(token, JWT_SECRET);
      } catch (err: any) {
        console.warn('[JWT Auth] Invalid or expired bearer token:', err.message);
      }
    }

    // 2. Check HTTP-Only Cookie ('token' or 'auth_token') if Bearer was not provided or failed
    if (!decodedToken && (req as any).cookies) {
      const cookieToken = (req as any).cookies.token || (req as any).cookies.auth_token;
      if (cookieToken) {
        try {
          decodedToken = jwt.verify(cookieToken, JWT_SECRET);
        } catch (err: any) {
          console.warn('[JWT Auth] Invalid or expired cookie token:', err.message);
        }
      }
    }

    const userId = decodedToken?.userId || decodedToken?.id || (req.headers['x-user-id'] as string) || req.body?.userId;
    const userEmail = decodedToken?.email || (req.headers['x-user-email'] as string) || req.body?.email;

    if (!isDatabaseConfigured) {
      req.user = userId
        ? { id: userId, email: userEmail || `${userId}@example.com`, credits: 25, name: decodedToken?.name || 'Developer' }
        : fallbackUser;
      return next();
    }

    if (userId) {
      let user: any = null;
      try {
        user = await prisma.user.findUnique({ where: { id: userId } });
      } catch {
        // fallback
      }

      if (user) {
        req.user = user;
        return next();
      }
    }

    // Default fallback active user
    let defaultUser: any = null;
    try {
      defaultUser = await prisma.user.findFirst();
    } catch {
      // fallback
    }

    req.user = defaultUser || fallbackUser;
    next();
  } catch (error) {
    req.user = fallbackUser;
    next();
  }
};

export default authMiddleware;
