-- CreateTable
CREATE TABLE "PromotionAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "externalActivityId" TEXT,
    "activityTitle" TEXT,
    "payloadSent" TEXT,
    "resultStatus" TEXT NOT NULL,
    "tiktokCode" INTEGER,
    "tiktokMessage" TEXT,
    "requestId" TEXT,
    "itemsBefore" TEXT,
    "itemsAfter" TEXT,
    "batchIndex" INTEGER,
    "batchTotal" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromotionAuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PromotionAuditLog_accountId_createdAt_idx" ON "PromotionAuditLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionAuditLog_userId_createdAt_idx" ON "PromotionAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionAuditLog_externalActivityId_idx" ON "PromotionAuditLog"("externalActivityId");

-- CreateIndex
CREATE INDEX "PromotionAuditLog_resultStatus_idx" ON "PromotionAuditLog"("resultStatus");
