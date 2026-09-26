import { PrismaClient } from '@prisma/client';

/**
 * Neon Serverless PostgreSQL Database Client
 * Configured with connection pooling and SSL mode for high performance.
 */

const NEON_DATABASE_URL =
  process.env.DATABASE_URL ||
  '';

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.prismaGlobal ??
  new PrismaClient({
    datasources: {
      db: {
        url: NEON_DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.prismaGlobal = prisma;
}

export default prisma;
