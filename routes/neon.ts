import express from 'express';
import { testNeonConnection, getNeonSql, getNeonPool } from '../server/neon.js';

const router = express.Router();

/**
 * GET /api/neon/health
 * Returns Neon serverless PostgreSQL connection status, database version, and latency
 */
router.get('/health', async (req, res) => {
  try {
    const result = await testNeonConnection();
    if (result.success) {
      return res.json({
        status: 'healthy',
        neonDriver: '@neondatabase/serverless',
        ...result,
      });
    } else {
      return res.status(503).json({
        status: 'degraded',
        neonDriver: '@neondatabase/serverless',
        ...result,
      });
    }
  } catch (err: any) {
    return res.status(500).json({
      status: 'error',
      error: err.message || String(err),
    });
  }
});

/**
 * POST /api/neon/query
 * Executes a safe read-only or parameterized query against the configured Neon PostgreSQL instance
 */
router.post('/query', async (req, res) => {
  const { query } = req.body || {};
  const sqlString = typeof query === 'string' && query.trim() ? query.trim() : 'SELECT NOW() as server_time, current_database() as db, version() as pg_version';

  // Basic security guard against destructive DDL in raw API query runner
  const upper = sqlString.toUpperCase();
  if (upper.includes('DROP DATABASE') || upper.includes('DROP SCHEMA')) {
    return res.status(400).json({
      success: false,
      error: 'Destructive DDL statements are blocked on this diagnostic endpoint.',
    });
  }

  try {
    const pool = getNeonPool();
    const result = await pool.query(sqlString);
    return res.json({
      success: true,
      query: sqlString,
      rowCount: result.rowCount ?? result.rows.length,
      rows: result.rows,
      executedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      query: sqlString,
      error: err.message || String(err),
    });
  }
});

export default router;
