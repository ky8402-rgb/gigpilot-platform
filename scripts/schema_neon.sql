-- ====================================================================
-- Freelance Autonomous OS: Neon / PostgreSQL Database Schema
-- Schema with users (paypal_email), jobs, bids, work_orders, transactions
-- ====================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create "users" Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    paypal_email TEXT,          -- Worker's PayPal email for automated payouts
    rating DECIMAL DEFAULT 0,
    current_workload INT DEFAULT 0,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Create "jobs" Table
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    budget DECIMAL NOT NULL,
    status TEXT DEFAULT 'open', -- open, assigned, completed, paid
    customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    external_id VARCHAR(255),   -- External freelancer platform project ID
    created_at TIMESTAMP DEFAULT NOW()
);

-- Migration command to add external_id if table exists:
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_jobs_external_id ON jobs (external_id);

-- 4. Create "bids" Table
CREATE TABLE IF NOT EXISTS bids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, accepted, rejected
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Create "work_orders" Table
CREATE TABLE IF NOT EXISTS work_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id UUID REFERENCES users(id) ON DELETE CASCADE,
    bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'assigned', -- assigned, in_progress, completed, paid
    completion_deadline TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    payment_status TEXT DEFAULT 'pending', -- pending, processing, paid, failed
    customer_confirmed BOOLEAN DEFAULT FALSE,
    worker_marked_complete BOOLEAN DEFAULT FALSE
);

-- Migration commands for existing database tables:
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS worker_marked_complete BOOLEAN DEFAULT FALSE;

-- 6. Create "transactions" Table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
    amount DECIMAL NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, processing, paid, failed
    paypal_payout_batch_id TEXT,   -- PayPal Payout Batch ID / Transaction ID
    created_at TIMESTAMP DEFAULT NOW()
);

-- 7. High Performance Query Indexes
CREATE INDEX IF NOT EXISTS idx_users_available_workload ON users(is_available, current_workload, rating DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_deadline ON work_orders(completion_deadline, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_payment_status ON work_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_transactions_work_order ON transactions(work_order_id);

-- 8. Seed Initial Default Workers with PayPal Payout Emails
INSERT INTO users (id, email, paypal_email, rating, current_workload, is_available)
VALUES 
  ('11111111-1111-4111-8111-111111111111', 'alex.developer@example.com', 'alex.worker.paypal@example.com', 4.95, 0, true),
  ('22222222-2222-4222-8222-222222222222', 'sam.fullstack@example.com', 'sam.worker.paypal@example.com', 4.88, 1, true),
  ('33333333-3333-4333-8333-333333333333', 'jordan.engineer@example.com', 'jordan.worker.paypal@example.com', 4.92, 0, true),
  ('44444444-4444-4444-8444-444444444444', 'customer.demo@example.com', NULL, 5.0, 0, true)
ON CONFLICT (id) DO NOTHING;
