-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PromotionAuditLog" (
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
    "productMappingId" TEXT,
    CONSTRAINT "PromotionAuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PromotionAuditLog_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PromotionAuditLog" ("accountId", "action", "activityTitle", "batchIndex", "batchTotal", "createdAt", "externalActivityId", "id", "itemsAfter", "itemsBefore", "payloadSent", "requestId", "resultStatus", "tiktokCode", "tiktokMessage", "updatedAt", "userId", "username") SELECT "accountId", "action", "activityTitle", "batchIndex", "batchTotal", "createdAt", "externalActivityId", "id", "itemsAfter", "itemsBefore", "payloadSent", "requestId", "resultStatus", "tiktokCode", "tiktokMessage", "updatedAt", "userId", "username" FROM "PromotionAuditLog";
DROP TABLE "PromotionAuditLog";
ALTER TABLE "new_PromotionAuditLog" RENAME TO "PromotionAuditLog";
CREATE INDEX "PromotionAuditLog_accountId_createdAt_idx" ON "PromotionAuditLog"("accountId", "createdAt");
CREATE INDEX "PromotionAuditLog_userId_createdAt_idx" ON "PromotionAuditLog"("userId", "createdAt");
CREATE INDEX "PromotionAuditLog_externalActivityId_idx" ON "PromotionAuditLog"("externalActivityId");
CREATE INDEX "PromotionAuditLog_resultStatus_idx" ON "PromotionAuditLog"("resultStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
