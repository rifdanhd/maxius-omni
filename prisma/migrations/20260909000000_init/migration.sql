-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "canViewFullPii" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    "shopCipher" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlatformAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MasterProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "businessId" TEXT NOT NULL DEFAULT 'business-default',
    "threshold" INTEGER NOT NULL DEFAULT 20,
    CONSTRAINT "MasterProduct_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "masterProductId" TEXT NOT NULL,
    CONSTRAINT "ProductVariant_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelSku" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,
    CONSTRAINT "ProductMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesLog" (
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

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "buyerName" TEXT,
    "buyerEmail" TEXT,
    "amount" REAL,
    "currency" TEXT,
    "createTime" DATETIME,
    "paidTime" DATETIME,
    "shippingDueTime" DATETIME,
    "rtsSlaTime" DATETIME,
    "ttsSlaTime" DATETIME,
    "recommendedShippingTime" DATETIME,
    "buyerNote" TEXT,
    "isCod" BOOLEAN,
    "paymentMethodName" TEXT,
    "paymentJson" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "recipientAddress" TEXT,
    "piiAnonymizedAt" DATETIME,
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
    "channelSku" TEXT NOT NULL,
    "productId" TEXT,
    "imageUrl" TEXT,
    "productName" TEXT,
    "skuName" TEXT,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlatformOrderMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalOrderId" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "lastWebhookUpdateTime" INTEGER,
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    CONSTRAINT "PlatformOrderMapping_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlatformOrderMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
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

-- CreateTable
CREATE TABLE "PiiAccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNo" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "changeQty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "note" TEXT,
    "stockAfter" INTEGER NOT NULL,
    "variantId" TEXT NOT NULL,
    "accountId" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_platform_externalShopId_key" ON "PlatformAccount"("platform", "externalShopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_masterProductId_sku_key" ON "ProductVariant"("masterProductId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_accountId_variantId_key" ON "ProductMapping"("accountId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_accountId_channelSku_key" ON "ProductMapping"("accountId", "channelSku");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformOrderMapping_accountId_externalOrderId_key" ON "PlatformOrderMapping"("accountId", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_accountId_orderId_externalId_key" ON "Shipment"("accountId", "orderId", "externalId");

-- CreateIndex
CREATE INDEX "PiiAccessLog_userId_idx" ON "PiiAccessLog"("userId");

-- CreateIndex
CREATE INDEX "PiiAccessLog_orderId_idx" ON "PiiAccessLog"("orderId");

-- CreateIndex
CREATE INDEX "StockLedger_variantId_createdAt_idx" ON "StockLedger"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedger_reason_referenceId_idx" ON "StockLedger"("reason", "referenceId");

