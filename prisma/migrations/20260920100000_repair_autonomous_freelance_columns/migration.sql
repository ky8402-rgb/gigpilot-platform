-- Production repair migration: ensure provider-backed autonomous freelance state exists on existing WorkOrder tables.
-- Idempotent by design so it is safe for already-upgraded databases.
ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "externalProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "externalProjectId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalBidId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalAcceptanceVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "externalAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'NOT_READY',
  ADD COLUMN IF NOT EXISTS "deliverableChecksum" TEXT;

CREATE INDEX IF NOT EXISTS "WorkOrder_externalProvider_externalBidId_idx"
  ON "WorkOrder"("externalProvider","externalBidId");

CREATE INDEX IF NOT EXISTS "WorkOrder_externalAcceptanceVerified_escrowStatus_idx"
  ON "WorkOrder"("externalAcceptanceVerified","escrowStatus");
