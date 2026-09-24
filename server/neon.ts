import { neon, neonConfig, Pool } from '@neondatabase/serverless';

// Configure Neon Serverless driver
// Uses standard WebSockets / HTTP for lightweight connection-pooled queries
export function getNeonSql() {
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  const activeUrl = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')
    ? dbUrl
    : 'postgresql://neondb_owner:dummy@ep-dummy.us-east-2.aws.neon.tech/neondb?sslmode=require';
  return neon(activeUrl);
}

export function getNeonPool() {
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  const activeUrl = dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')
    ? dbUrl
    : 'postgresql://neondb_owner:dummy@ep-dummy.us-east-2.aws.neon.tech/neondb?sslmode=require';
  return new Pool({ connectionString: activeUrl });
}

/**
 * Runs a test query against Neon PostgreSQL database to verify connection health & latency
 */
export async function testNeonConnection(): Promise<{
  success: boolean;
  version?: string;
  now?: string;
  databaseName?: string;
  activeConnections?: number;
  latencyMs?: number;
  error?: string;
}> {
  const startTime = Date.now();
  const databaseUrl = (process.env.DATABASE_URL || '').trim();
  try {
    if (!databaseUrl || !databaseUrl.includes('neon.tech')) {
      return {
        success: false,
        error: 'DATABASE_URL is not configured with a valid Neon connection string.',
      };
    }

    const sql = getNeonSql();
    const result = await sql`
      SELECT 
        version() as version, 
        NOW() as now, 
        current_database() as database_name
    `;

    const latencyMs = Date.now() - startTime;
    const row = result[0] || {};

    return {
      success: true,
      version: row.version,
      now: row.now ? new Date(row.now).toISOString() : new Date().toISOString(),
      databaseName: row.database_name,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      latencyMs: Date.now() - startTime,
      error: err?.message || String(err),
    };
  }
}
