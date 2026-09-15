-- CreateTable
CREATE TABLE "PromotionActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "externalActivityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "productLevel" TEXT NOT NULL,
    "durationType" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "sourceCreatedAt" DATETIME,
    "sourceUpdatedAt" DATETIME,
    "sourceCreatedEpoch" TEXT,
    "sourceCreatedUnit" TEXT,
    "sourceUpdatedEpoch" TEXT,
    "sourceUpdatedUnit" TEXT,
    "lastConfirmedAt" DATETIME,
    "rawPayload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromotionActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromotionActivityItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "externalItemKey" TEXT NOT NULL,
    "platformProductId" TEXT NOT NULL,
    "platformSkuId" TEXT,
    "productMappingId" TEXT,
    "discount" TEXT,
    "activityPriceAmount" TEXT,
    "activityPriceCurrency" TEXT,
    "quantityLimit" INTEGER,
    "quantityPerUser" INTEGER,
    "usedQuantity" INTEGER,
    "rawPayload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromotionActivityItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PromotionActivity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromotionActivityItem_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PromotionActivity_accountId_status_idx" ON "PromotionActivity"("accountId", "status");

-- CreateIndex
CREATE INDEX "PromotionActivity_accountId_startsAt_idx" ON "PromotionActivity"("accountId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionActivity_accountId_externalActivityId_key" ON "PromotionActivity"("accountId", "externalActivityId");

-- CreateIndex
CREATE INDEX "PromotionActivityItem_platformProductId_idx" ON "PromotionActivityItem"("platformProductId");

-- CreateIndex
CREATE INDEX "PromotionActivityItem_platformSkuId_idx" ON "PromotionActivityItem"("platformSkuId");

-- CreateIndex
CREATE INDEX "PromotionActivityItem_productMappingId_idx" ON "PromotionActivityItem"("productMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionActivityItem_activityId_externalItemKey_key" ON "PromotionActivityItem"("activityId", "externalItemKey");
