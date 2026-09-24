ALTER TABLE "WorkOrder"
  ADD COLUMN IF NOT EXISTS "externalProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "externalProjectId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalBidId" TEXT,
  ADD COLUMN IF NOT EXISTS "externalAcceptanceVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "externalAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'NOT_READY',
  ADD COLUMN IF NOT EXISTS "deliverableChecksum" TEXT;

CREATE INDEX IF NOT EXISTS "WorkOrder_externalProvider_externalProjectId_idx"
  ON "WorkOrder"("externalProvider", "externalProjectId");

CREATE INDEX IF NOT EXISTS "WorkOrder_externalAcceptanceVerified_deliveryStatus_idx"
  ON "WorkOrder"("externalAcceptanceVerified", "deliveryStatus");