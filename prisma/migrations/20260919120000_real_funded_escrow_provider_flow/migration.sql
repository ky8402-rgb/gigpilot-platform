-- Persisted funded-work-order, milestone approval, escrow reservation and provider settlement state.
ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "fundedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "fundingProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "fundingProviderTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "clientApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "escrowStatus" TEXT NOT NULL DEFAULT 'UNFUNDED',
  ADD COLUMN IF NOT EXISTS "milestoneStatus" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL';

CREATE TABLE IF NOT EXISTS "EscrowMilestone" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  "deliverableChecksum" TEXT,
  "approvalTokenHash" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscrowMilestone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EscrowLedger" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "milestoneId" TEXT,
  "provider" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "state" TEXT NOT NULL DEFAULT 'RESERVED',
  "providerReference" TEXT,
  "providerTransactionId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscrowLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EscrowLedger_idempotencyKey_key" ON "EscrowLedger"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentWebhookEvent_eventId_key" ON "PaymentWebhookEvent"("eventId");
CREATE INDEX IF NOT EXISTS "EscrowLedger_workOrderId_state_idx" ON "EscrowLedger"("workOrderId","state");
CREATE INDEX IF NOT EXISTS "EscrowLedger_provider_providerReference_idx" ON "EscrowLedger"("provider","providerReference");
CREATE INDEX IF NOT EXISTS "EscrowMilestone_workOrderId_status_idx" ON "EscrowMilestone"("workOrderId","status");
CREATE INDEX IF NOT EXISTS "PaymentWebhookEvent_provider_eventType_idx" ON "PaymentWebhookEvent"("provider","eventType");

DO $$ BEGIN
  ALTER TABLE "EscrowMilestone" ADD CONSTRAINT "EscrowMilestone_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EscrowLedger" ADD CONSTRAINT "EscrowLedger_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EscrowLedger" ADD CONSTRAINT "EscrowLedger_milestoneId_fkey"
    FOREIGN KEY ("milestoneId") REFERENCES "EscrowMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
