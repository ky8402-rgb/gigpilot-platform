-- CreateTable
CREATE TABLE IF NOT EXISTS "Bid" (
    "id" TEXT NOT NULL,
    "jobTitle" TEXT,
    "company" TEXT,
    "clientName" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'freelancer',
    "package" TEXT,
    "amount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "workStatus" TEXT NOT NULL DEFAULT 'Not Started',
    "notes" TEXT,
    "jobUrl" TEXT,
    "startedAt" TIMESTAMP(3),
    "estimatedDays" INTEGER DEFAULT 7,
    "deadline" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- Performance Indexes for Bid Model
CREATE INDEX IF NOT EXISTS "Bid_workStatus_idx" ON "Bid"("workStatus");
CREATE INDEX IF NOT EXISTS "Bid_createdAt_idx" ON "Bid"("createdAt");
CREATE INDEX IF NOT EXISTS "Bid_deadline_idx" ON "Bid"("deadline");
CREATE INDEX IF NOT EXISTS "Bid_status_idx" ON "Bid"("status");
