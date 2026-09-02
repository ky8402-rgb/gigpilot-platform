import { Pool } from 'pg';
import crypto from 'crypto';
import { getNeonPool } from './neon.js';

export interface User {
  id: string;
  email: string;
  paypal_email: string | null;
  rating: number;
  current_workload: number;
  is_available: boolean;
}

export interface Job {
  id: string;
  title: string;
  description: string;
  budget: number;
  status: 'open' | 'assigned' | 'completed' | 'paid';
  customer_id: string;
  external_id?: string | null;
  created_at: string;
}

export interface Bid {
  id: string;
  job_id: string;
  worker_id: string;
  amount: number;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface WorkOrder {
  id: string;
  job_id: string;
  worker_id: string;
  bid_id: string;
  status: 'assigned' | 'in_progress' | 'completed' | 'paid';
  completion_deadline: string;
  completed_at: string | null;
  payment_status: 'pending' | 'processing' | 'paid' | 'failed';
  customer_confirmed?: boolean;
  worker_marked_complete?: boolean;
}

export interface Transaction {
  id: string;
  work_order_id: string;
  amount: number;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  paypal_payout_batch_id: string | null;
  created_at: string;
  retry_count?: number;
  last_error?: string | null;
}

export interface SelfHealingLog {
  id: string;
  timestamp: string;
  check_status: 'healthy' | 'degraded' | 'critical';
  remediation_triggered: boolean;
  remediation_success: boolean;
  details: any;
  retry_count: number;
}

export interface MLTrainingData {
  id: string;
  features: Record<string, number>;
  label: string;
  timestamp: string;
  source: 'health_check' | 'manual' | 'synthetic_bootstrap';
}

export interface MLFeedback {
  prediction_id: string;
  predicted_label: string;
  confidence: number;
  actual_label: string;
  remediation_success: boolean;
  features: Record<string, number>;
  timestamp: string;
}

export interface MLModelRecord {
  version: string;
  path: string;
  accuracy: number;
  f1_score: number;
  deployed_at: string;
  active: boolean;
  metadata?: Record<string, any>;
}

// In-Memory resilient state (used when offline/fallback or parallel to DB)
class InMemoryStore {
  users: Map<string, User> = new Map();
  jobs: Map<string, Job> = new Map();
  bids: Map<string, Bid> = new Map();
  workOrders: Map<string, WorkOrder> = new Map();
  transactions: Map<string, Transaction> = new Map();
  selfHealingLogs: SelfHealingLog[] = [];
  mlTrainingData: MLTrainingData[] = [];
  mlFeedback: MLFeedback[] = [];
  mlModels: MLModelRecord[] = [
    {
      version: 'v1.0.0',
      path: 'models/rf_model_v1.0.0.joblib',
      accuracy: 0.942,
      f1_score: 0.928,
      deployed_at: new Date().toISOString(),
      active: true,
      metadata: { algorithm: 'RandomForestClassifier', n_estimators: 100 }
    }
  ];

  constructor() {
    this.seedDefaultWorkers();
  }

  seedDefaultWorkers() {
    const defaultWorkers: User[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'alex.developer@example.com',
        paypal_email: 'alex.worker.paypal@example.com',
        rating: 4.95,
        current_workload: 0,
        is_available: true,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'sam.fullstack@example.com',
        paypal_email: 'sam.worker.paypal@example.com',
        rating: 4.88,
        current_workload: 1,
        is_available: true,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'jordan.engineer@example.com',
        paypal_email: 'jordan.worker.paypal@example.com',
        rating: 4.92,
        current_workload: 0,
        is_available: true,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        email: 'customer.demo@example.com',
        paypal_email: null,
        rating: 5.0,
        current_workload: 0,
        is_available: true,
      }
    ];

    for (const u of defaultWorkers) {
      this.users.set(u.id, u);
    }
  }
}

export const memoryStore = new InMemoryStore();

let pgPoolInstance: Pool | null = null;

export function getPgPool(): Pool | null {
  const dbUrl = (process.env.DATABASE_URL || '').trim();
  if (!dbUrl || (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://'))) {
    return null;
  }

  if (!pgPoolInstance) {
    pgPoolInstance = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 15000,
      max: 10,
    });
  }
  return pgPoolInstance;
}

/**
 * Initialize PostgreSQL tables if connected to Neon / Postgres
 */
export async function initializeDatabaseSchema(): Promise<boolean> {
  const pool = getPgPool();
  if (!pool) {
    console.log('ℹ️ [Database] Running with in-memory resilient storage (DATABASE_URL not configured).');
    return false;
  }

  try {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          email TEXT UNIQUE,
          paypal_email TEXT,
          rating DECIMAL DEFAULT 0,
          current_workload INT DEFAULT 0,
          is_available BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS jobs (
          id UUID PRIMARY KEY,
          title TEXT,
          description TEXT,
          budget DECIMAL,
          status TEXT DEFAULT 'open',
          customer_id UUID REFERENCES users(id),
          external_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
      CREATE INDEX IF NOT EXISTS idx_jobs_external_id ON jobs (external_id);

      CREATE TABLE IF NOT EXISTS bids (
          id UUID PRIMARY KEY,
          job_id UUID REFERENCES jobs(id),
          worker_id UUID REFERENCES users(id),
          amount DECIMAL,
          status TEXT DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS work_orders (
          id UUID PRIMARY KEY,
          job_id UUID REFERENCES jobs(id),
          worker_id UUID REFERENCES users(id),
          bid_id UUID REFERENCES bids(id),
          status TEXT DEFAULT 'assigned',
          completion_deadline TIMESTAMP,
          completed_at TIMESTAMP,
          payment_status TEXT DEFAULT 'pending',
          customer_confirmed BOOLEAN DEFAULT FALSE,
          worker_marked_complete BOOLEAN DEFAULT FALSE
      );

      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_confirmed BOOLEAN DEFAULT FALSE;
      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS worker_marked_complete BOOLEAN DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS transactions (
          id UUID PRIMARY KEY,
          work_order_id UUID REFERENCES work_orders(id),
          amount DECIMAL,
          status TEXT DEFAULT 'pending',
          paypal_payout_batch_id TEXT,
          created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS self_healing_logs (
          id UUID PRIMARY KEY,
          timestamp TIMESTAMP DEFAULT NOW(),
          check_status TEXT,
          remediation_triggered BOOLEAN DEFAULT FALSE,
          remediation_success BOOLEAN DEFAULT FALSE,
          details JSONB,
          retry_count INT DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_self_healing_logs_ts ON self_healing_logs (timestamp DESC);

      CREATE TABLE IF NOT EXISTS ml_training_data (
          id UUID PRIMARY KEY,
          features JSONB NOT NULL,
          label TEXT NOT NULL,
          timestamp TIMESTAMP DEFAULT NOW(),
          source TEXT DEFAULT 'health_check'
      );
      CREATE INDEX IF NOT EXISTS idx_ml_training_ts ON ml_training_data (timestamp DESC);

      CREATE TABLE IF NOT EXISTS ml_feedback (
          prediction_id UUID PRIMARY KEY,
          predicted_label TEXT NOT NULL,
          confidence DECIMAL NOT NULL,
          actual_label TEXT,
          remediation_success BOOLEAN DEFAULT FALSE,
          features JSONB,
          timestamp TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ml_feedback_ts ON ml_feedback (timestamp DESC);

      CREATE TABLE IF NOT EXISTS ml_models (
          version TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          accuracy DECIMAL NOT NULL,
          f1_score DECIMAL NOT NULL,
          deployed_at TIMESTAMP DEFAULT NOW(),
          active BOOLEAN DEFAULT FALSE,
          metadata JSONB
      );
    `;

    await pool.query(schemaSql);
    console.log('✅ [Database] PostgreSQL schema initialized successfully.');

    // Seed default workers in Postgres if empty
    const checkWorkers = await pool.query('SELECT COUNT(*) as count FROM users WHERE paypal_email IS NOT NULL');
    if (parseInt(checkWorkers.rows[0]?.count || '0', 10) === 0) {
      for (const worker of memoryStore.users.values()) {
        await pool.query(
          `INSERT INTO users (id, email, paypal_email, rating, current_workload, is_available)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [worker.id, worker.email, worker.paypal_email, worker.rating, worker.current_workload, worker.is_available]
        );
      }
      console.log('✅ [Database] Default workers seeded in PostgreSQL.');
    }

    return true;
  } catch (err: any) {
    console.warn('⚠️ [Database] Postgres schema init fallback notice:', err.message);
    return false;
  }
}

/**
 * Persist a self-healing diagnostic / remediation event to Postgres and in-memory store
 */
export async function insertSelfHealingLog(log: Omit<SelfHealingLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): Promise<SelfHealingLog> {
  const fullLog: SelfHealingLog = {
    id: log.id || crypto.randomUUID(),
    timestamp: log.timestamp || new Date().toISOString(),
    check_status: log.check_status,
    remediation_triggered: log.remediation_triggered,
    remediation_success: log.remediation_success,
    details: log.details || {},
    retry_count: log.retry_count || 0,
  };

  // Always store in in-memory store
  memoryStore.selfHealingLogs.unshift(fullLog);
  if (memoryStore.selfHealingLogs.length > 200) {
    memoryStore.selfHealingLogs.pop();
  }

  // Persist to PostgreSQL if connected
  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO self_healing_logs (id, timestamp, check_status, remediation_triggered, remediation_success, details, retry_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          fullLog.id,
          fullLog.timestamp,
          fullLog.check_status,
          fullLog.remediation_triggered,
          fullLog.remediation_success,
          JSON.stringify(fullLog.details),
          fullLog.retry_count,
        ]
      );
    } catch (err: any) {
      console.warn('⚠️ [Database] Failed to insert into self_healing_logs in PostgreSQL:', err.message);
    }
  }

  return fullLog;
}

/**
 * Retrieve recent self-healing logs (with Postgres fallback to in-memory store)
 */
export async function getSelfHealingLogs(limit: number = 50): Promise<SelfHealingLog[]> {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT id, timestamp, check_status, remediation_triggered, remediation_success, details, retry_count
         FROM self_healing_logs
         ORDER BY timestamp DESC
         LIMIT $1`,
        [limit]
      );
      if (res.rows.length > 0) {
        return res.rows.map((row) => ({
          id: row.id,
          timestamp: new Date(row.timestamp).toISOString(),
          check_status: row.check_status,
          remediation_triggered: Boolean(row.remediation_triggered),
          remediation_success: Boolean(row.remediation_success),
          details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {},
          retry_count: Number(row.retry_count) || 0,
        }));
      }
    } catch (err: any) {
      console.warn('⚠️ [Database] Failed to fetch self_healing_logs from PostgreSQL, using memory store:', err.message);
    }
  }

  return memoryStore.selfHealingLogs.slice(0, limit);
}

/**
  * Insert labeled training data sample
  */
export async function insertMLTrainingData(sample: Omit<MLTrainingData, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): Promise<MLTrainingData> {
  const fullSample: MLTrainingData = {
    id: sample.id || crypto.randomUUID(),
    features: sample.features,
    label: sample.label,
    timestamp: sample.timestamp || new Date().toISOString(),
    source: sample.source || 'health_check',
  };

  memoryStore.mlTrainingData.unshift(fullSample);
  if (memoryStore.mlTrainingData.length > 500) {
    memoryStore.mlTrainingData.pop();
  }

  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO ml_training_data (id, features, label, timestamp, source)
         VALUES ($1, $2, $3, $4, $5)`,
        [fullSample.id, JSON.stringify(fullSample.features), fullSample.label, fullSample.timestamp, fullSample.source]
      );
    } catch (err: any) {
      console.warn('⚠️ [Database] Failed to insert ml_training_data to PG:', err.message);
    }
  }
  return fullSample;
}

/**
 * Retrieve training data samples
 */
export async function getMLTrainingData(limit: number = 200): Promise<MLTrainingData[]> {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT id, features, label, timestamp, source
         FROM ml_training_data
         ORDER BY timestamp DESC
         LIMIT $1`,
        [limit]
      );
      if (res.rows.length > 0) {
        return res.rows.map((row) => ({
          id: row.id,
          features: typeof row.features === 'string' ? JSON.parse(row.features) : row.features,
          label: row.label,
          timestamp: new Date(row.timestamp).toISOString(),
          source: row.source,
        }));
      }
    } catch (err: any) {
      console.warn('⚠️ [Database] Failed to fetch ml_training_data from PG:', err.message);
    }
  }
  return memoryStore.mlTrainingData.slice(0, limit);
}

/**
 * Record ML prediction feedback (for continuous improvement)
 */
export async function insertMLFeedback(feedback: MLFeedback): Promise<MLFeedback> {
  memoryStore.mlFeedback.unshift(feedback);
  if (memoryStore.mlFeedback.length > 300) {
    memoryStore.mlFeedback.pop();
  }

  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO ml_feedback (prediction_id, predicted_label, confidence, actual_label, remediation_success, features, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (prediction_id) DO UPDATE
         SET actual_label = EXCLUDED.actual_label,
             remediation_success = EXCLUDED.remediation_success`,
        [
          feedback.prediction_id,
          feedback.predicted_label,
          feedback.confidence,
          feedback.actual_label,
          feedback.remediation_success,
          JSON.stringify(feedback.features),
          feedback.timestamp,
        ]
      );
    } catch (err: any) {
      console.warn('⚠️ [Database] Failed to insert ml_feedback into PG:', err.message);
    }
  }
  return feedback;
}

/**
 * Retrieve recent ML feedback
 */
export async function getMLFeedback(limit: number = 50): Promise<MLFeedback[]> {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT prediction_id, predicted_label, confidence, actual_label, remediation_success, features, timestamp
         FROM ml_feedback
         ORDER BY timestamp DESC
         LIMIT $1`,
        [limit]
      );
      if (res.rows.length > 0) {
        return res.rows.map((row) => ({
          prediction_id: row.prediction_id,
          predicted_label: row.predicted_label,
          confidence: parseFloat(row.confidence),
          actual_label: row.actual_label,
          remediation_success: Boolean(row.remediation_success),
          features: typeof row.features === 'string' ? JSON.parse(row.features) : row.features || {},
          timestamp: new Date(row.timestamp).toISOString(),
        }));
      }
    } catch (err: any) {
      console.warn('⚠️ [Database] Failed to fetch ml_feedback from PG:', err.message);
    }
  }
  return memoryStore.mlFeedback.slice(0, limit);
}

/**
 * Upsert model registry record
 */
export async function upsertMLModel(model: MLModelRecord): Promise<void> {
  // If this model is active, deactivate others
  if (model.active) {
    memoryStore.mlModels.forEach((m) => {
      m.active = false;
    });
  }

  const existingIdx = memoryStore.mlModels.findIndex((m) => m.version === model.version);
  if (existingIdx >= 0) {
    memoryStore.mlModels[existingIdx] = model;
  } else {
    memoryStore.mlModels.unshift(model);
  }

  const pool = getPgPool();
  if (pool) {
    try {
      if (model.active) {
        await pool.query(`UPDATE ml_models SET active = FALSE WHERE version != $1`, [model.version]);
      }
      await pool.query(
        `INSERT INTO ml_models (version, path, accuracy, f1_score, deployed_at, active, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (version) DO UPDATE
         SET path = EXCLUDED.path,
             accuracy = EXCLUDED.accuracy,
             f1_score = EXCLUDED.f1_score,
             deployed_at = EXCLUDED.deployed_at,
             active = EXCLUDED.active,
             metadata = EXCLUDED.metadata`,
        [
          model.version,
          model.path,
          model.accuracy,
          model.f1_score,
          model.deployed_at,
          model.active,
          JSON.stringify(model.metadata || {}),
        ]
      );
    } catch (err: any) {
      console.warn('⚠️ [Database] Failed to upsert ml_models into PG:', err.message);
    }
  }
}

/**
 * Get all ML model versions
 */
export async function getMLModels(): Promise<MLModelRecord[]> {
  const pool = getPgPool();
  if (pool) {
    try {
      const res = await pool.query(
        `SELECT version, path, accuracy, f1_score, deployed_at, active, metadata
         FROM ml_models
         ORDER BY deployed_at DESC`
      );
      if (res.rows.length > 0) {
        return res.rows.map((row) => ({
          version: row.version,
          path: row.path,
          accuracy: parseFloat(row.accuracy),
          f1_score: parseFloat(row.f1_score),
          deployed_at: new Date(row.deployed_at).toISOString(),
          active: Boolean(row.active),
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
        }));
      }
    } catch (err: any) {
      console.warn('⚠️ [Database] Failed to fetch ml_models from PG:', err.message);
    }
  }
  return memoryStore.mlModels;
}

/**
 * Roll back to previous active model version
 */
export async function rollbackMLModel(): Promise<{ success: boolean; activeVersion?: string; previousVersion?: string }> {
  const models = await getMLModels();
  if (models.length < 2) {
    return { success: false };
  }

  const currentActive = models.find((m) => m.active);
  const candidate = models.find((m) => !m.active);

  if (!candidate) {
    return { success: false };
  }

  // Deactivate current, activate candidate
  if (currentActive) {
    currentActive.active = false;
    await upsertMLModel(currentActive);
  }
  candidate.active = true;
  await upsertMLModel(candidate);

  return {
    success: true,
    activeVersion: candidate.version,
    previousVersion: currentActive?.version,
  };
}

// Auto-initialize schema in background
initializeDatabaseSchema().catch(() => {});
