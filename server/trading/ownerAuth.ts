/**
 * Backwards-compatibility shim.
 *
 * The canonical OwnerAuthProvider now lives in server/auth/. This module
 * re-exports the active provider's helpers and the route middleware so
 * server/trading/routes.ts can keep its existing import paths.
 *
 * The provider is selected at module load via the auth registry. The
 * `ownerAuth` object, `extractToken`, `isOwner`, and `requireOwnerAuth`
 * function names are preserved verbatim so the rest of the codebase does
 * not need to change.
 */

import type { Request, Response, NextFunction } from 'express';
import { OwnerAuthProvider } from '../auth/types.js';
import { selectAuthProvider } from '../auth/registry.js';

export const ownerAuth: OwnerAuthProvider = selectAuthProvider();

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7).trim();
  return (req.headers['x-owner-token'] as string) || null;
}

export function isOwner(req: Request): boolean {
  const token = extractToken(req);
  return token ? ownerAuth.verifyToken(token) : false;
}

export function requireOwnerAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
  if (!isOwner(req)) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid single-owner authentication token required for this operational trading endpoint.',
    });
    return;
  }
  next();
}
