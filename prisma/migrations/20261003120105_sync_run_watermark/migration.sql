-- AlterTable
ALTER TABLE "PlatformAccount" ADD COLUMN     "lastPulledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL DEFAULT 'business-default',
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'orders',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "message" TEXT,
    "cursor" TEXT,
    "windowFrom" TIMESTAMP(3),
    "windowTo" TIMESTAMP(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_businessId_status_idx" ON "SyncRun"("businessId", "status");

-- CreateIndex
CREATE INDEX "SyncRun_status_updatedAt_idx" ON "SyncRun"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
