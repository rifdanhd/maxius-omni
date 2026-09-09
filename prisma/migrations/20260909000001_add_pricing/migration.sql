-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "price" REAL,
    "priceUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "masterProductId" TEXT NOT NULL,
    CONSTRAINT "ProductVariant_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductVariant" ("id", "masterProductId", "safetyStock", "sku", "stock", "createdAt", "updatedAt") SELECT "id", "masterProductId", "safetyStock", "sku", "stock", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "ProductVariant";
DROP TABLE "ProductVariant";
ALTER TABLE "new_ProductVariant" RENAME TO "ProductVariant";
CREATE UNIQUE INDEX "ProductVariant_masterProductId_sku_key" ON "ProductVariant"("masterProductId", "sku");
CREATE TABLE "new_ProductMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelSku" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,
    "price" REAL,
    "priceUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductMapping" ("accountId", "channelSku", "id", "variantId", "createdAt", "updatedAt") SELECT "accountId", "channelSku", "id", "variantId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "ProductMapping";
DROP TABLE "ProductMapping";
ALTER TABLE "new_ProductMapping" RENAME TO "ProductMapping";
CREATE UNIQUE INDEX "ProductMapping_accountId_variantId_key" ON "ProductMapping"("accountId", "variantId");
CREATE UNIQUE INDEX "ProductMapping_accountId_channelSku_key" ON "ProductMapping"("accountId", "channelSku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

