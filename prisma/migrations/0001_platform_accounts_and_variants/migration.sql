-- DropIndex
DROP INDEX "PlatformCredential_platform_shopId_key";

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Data migration
INSERT INTO "Business" ("id", "name", "updatedAt") VALUES ('business-default', 'Dermarket', CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "PlatformAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL DEFAULT 'business-default',
    "platform" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "appKey" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" DATETIME,
    "scope" TEXT,
    "externalShopId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlatformAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Data migration: salin Account -> PlatformAccount SEBELUM tabel lama di-drop.
-- appKey sengaja NULL (diisi kemudian oleh flow OAuth di TUGAS 2 dari env).
INSERT INTO "PlatformAccount" ("id", "businessId", "platform", "label", "appKey", "accessToken", "refreshToken", "tokenExpiresAt", "scope", "externalShopId", "updatedAt")
SELECT "id",
       'business-default',
       CASE "platform" WHEN 'Shopee' THEN 'SHOPEE' WHEN 'TikTok Shop' THEN 'TIKTOK_SHOP' ELSE 'UNKNOWN' END,
       "label",
       NULL,
       "accessToken",
       NULL,
       NULL,
       NULL,
       NULL,
       CURRENT_TIMESTAMP
FROM "Account";

-- Data migration: merge PlatformCredential (tabel kosong pada data saat ini; rule dipertahankan).
-- Match by (platform, externalShopId) -> update; tidak match -> insert baris baru.
UPDATE "PlatformAccount"
SET "accessToken" = (SELECT "accessToken" FROM "PlatformCredential" pc WHERE pc."shopId" IS NOT NULL AND pc."shopId" = "PlatformAccount"."externalShopId"),
    "refreshToken" = (SELECT "refreshToken" FROM "PlatformCredential" pc WHERE pc."shopId" IS NOT NULL AND pc."shopId" = "PlatformAccount"."externalShopId"),
    "tokenExpiresAt" = (SELECT "expiresAt" FROM "PlatformCredential" pc WHERE pc."shopId" IS NOT NULL AND pc."shopId" = "PlatformAccount"."externalShopId")
WHERE "externalShopId" IS NOT NULL;

INSERT INTO "PlatformAccount" ("id", "businessId", "platform", "label", "appKey", "accessToken", "refreshToken", "tokenExpiresAt", "scope", "externalShopId", "updatedAt")
SELECT lower(hex(randomblob(16))), 'business-default',
       CASE pc."platform" WHEN 'TIKTOK' THEN 'TIKTOK_SHOP' WHEN 'SHOPEE' THEN 'SHOPEE' WHEN 'TOKOPEDIA' THEN 'TOKOPEDIA' ELSE 'UNKNOWN' END,
       'Pending ' || pc."platform",
       NULL, pc."accessToken", pc."refreshToken", pc."expiresAt", NULL, pc."shopId", CURRENT_TIMESTAMP
FROM "PlatformCredential" pc
WHERE pc."shopId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PlatformAccount" pa
    WHERE pa."platform" = CASE pc."platform" WHEN 'TIKTOK' THEN 'TIKTOK_SHOP' WHEN 'SHOPEE' THEN 'SHOPEE' WHEN 'TOKOPEDIA' THEN 'TOKOPEDIA' ELSE 'UNKNOWN' END
      AND pa."externalShopId" = pc."shopId"
  );

-- DropTable (dipindah ke sini: data Account & PlatformCredential sudah disalin/dimerge)
PRAGMA foreign_keys=off;
DROP TABLE "Account";
DROP TABLE "PlatformCredential";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "masterProductId" TEXT NOT NULL,
    CONSTRAINT "ProductVariant_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Data migration: backfill 1 varian default per produk lama (baca stock SEBELUM kolom stock di-drop).
INSERT INTO "ProductVariant" ("id", "sku", "stock", "masterProductId")
SELECT 'variant-' || "id", 'DEFAULT-' || "id", "stock", "id" FROM "MasterProduct";

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "buyerName" TEXT,
    "amount" REAL,
    "accountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "qty" INTEGER NOT NULL,
    "price" REAL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlatformOrderMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalOrderId" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    CONSTRAINT "PlatformOrderMapping_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlatformOrderMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "carrier" TEXT,
    "trackingNo" TEXT,
    "status" TEXT NOT NULL,
    "shippedAt" DATETIME,
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Shipment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "errorMessage" TEXT,
    "payload" TEXT,
    "accountId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MasterProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "businessId" TEXT NOT NULL DEFAULT 'business-default',
    "threshold" INTEGER NOT NULL DEFAULT 20,
    CONSTRAINT "MasterProduct_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MasterProduct" ("id", "name", "threshold") SELECT "id", "name", "threshold" FROM "MasterProduct";
DROP TABLE "MasterProduct";
ALTER TABLE "new_MasterProduct" RENAME TO "MasterProduct";
CREATE TABLE "new_ProductMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelSku" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,
    CONSTRAINT "ProductMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductMapping" ("accountId", "channelSku", "id", "variantId") SELECT "accountId", "channelSku", "id", 'variant-' || "masterProductId" FROM "ProductMapping";
DROP TABLE "ProductMapping";
ALTER TABLE "new_ProductMapping" RENAME TO "ProductMapping";
CREATE UNIQUE INDEX "ProductMapping_accountId_variantId_key" ON "ProductMapping"("accountId", "variantId");
CREATE UNIQUE INDEX "ProductMapping_accountId_channelSku_key" ON "ProductMapping"("accountId", "channelSku");
CREATE TABLE "new_SalesLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qty" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "critical" BOOLEAN NOT NULL,
    "text" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,
    CONSTRAINT "SalesLog_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SalesLog" ("accountId", "channelSku", "critical", "id", "qty", "stockAfter", "text", "time", "variantId") SELECT "accountId", "channelSku", "critical", "id", "qty", "stockAfter", "text", "time", 'variant-' || "masterProductId" FROM "SalesLog";
DROP TABLE "SalesLog";
ALTER TABLE "new_SalesLog" RENAME TO "SalesLog";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_platform_externalShopId_key" ON "PlatformAccount"("platform", "externalShopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_masterProductId_sku_key" ON "ProductVariant"("masterProductId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformOrderMapping_accountId_externalOrderId_key" ON "PlatformOrderMapping"("accountId", "externalOrderId");

