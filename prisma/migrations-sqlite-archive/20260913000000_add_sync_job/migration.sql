-- CreateTable: SyncJob (state machine push stok; SyncLog tetap append-only history)
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelSku" TEXT NOT NULL,
    "newSellable" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" DATETIME,
    "lastError" TEXT,
    "accountId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SyncJob_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex: coalesce level DB (satu PENDING per varian+akun+channelSku)
CREATE UNIQUE INDEX "SyncJob_variantId_accountId_channelSku_status_key" ON "SyncJob"("variantId", "accountId", "channelSku", "status");

-- CreateIndex: query job siap retry (status + nextRetryAt)
CREATE INDEX "SyncJob_status_nextRetryAt_idx" ON "SyncJob"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "SyncJob_variantId_idx" ON "SyncJob"("variantId");
