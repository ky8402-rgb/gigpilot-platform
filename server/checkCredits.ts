import { Request, Response, NextFunction } from 'express';
import { prisma, isDatabaseConfigured } from './db.js';

export interface AuthenticatedRequest extends Request {
  user?: any;
}

/**
 * Express Middleware: checkCredits
 * Verifies that the user has at least 1 credit in the database before proceeding.
 * If credits < 1, returns HTTP 402 (Payment Required) with checkout redirect action.
 */
export const checkCredits = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.body?.userId || req.headers['x-user-id'] as string;

    if (!userId || !isDatabaseConfigured) {
      // In development, memory mode, or anonymous requests, proceed
      return next();
    }

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        // User not found in database yet; allow next()
        return next();
      }

      if (user.credits < 1) {
        return res.status(402).json({
          error: 'Insufficient credits. Please purchase more to generate proposals.',
          action: '/api/paypal/create-order',
          credits: user.credits,
        });
      }

      // Pass along full user model to subsequent handlers
      req.user = user;
    } catch {
      // Database query failed; allow through gracefully
    }
    next();
  } catch (error: any) {
    next();
  }
};

export default checkCredits;

