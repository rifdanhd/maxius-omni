-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "canViewFullPii" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL DEFAULT 'business-default',
    "platform" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "appKey" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "externalShopId" TEXT,
    "shopCipher" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "imageUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'single',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "importedFrom" TEXT,
    "businessId" TEXT NOT NULL DEFAULT 'business-default',
    "threshold" INTEGER NOT NULL DEFAULT 20,

    CONSTRAINT "MasterProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "masterProductId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "name" TEXT,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "price" DOUBLE PRECISION,
    "priceUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "masterProductId" TEXT NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleItem" (
    "id" TEXT NOT NULL,
    "bundleProductId" TEXT NOT NULL,
    "componentVariantId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "priceUpdatedAt" TIMESTAMP(3),
    "platformProductId" TEXT,
    "platformStatus" TEXT,
    "platformStatusRaw" TEXT,
    "platformStock" INTEGER,
    "platformTitle" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesLog" (
    "id" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qty" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "critical" BOOLEAN NOT NULL,
    "text" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "variantId" TEXT NOT NULL DEFAULT '',
    "accountId" TEXT NOT NULL,

    CONSTRAINT "SalesLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "buyerName" TEXT,
    "buyerEmail" TEXT,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "createTime" TIMESTAMP(3),
    "paidTime" TIMESTAMP(3),
    "shippingDueTime" TIMESTAMP(3),
    "rtsSlaTime" TIMESTAMP(3),
    "ttsSlaTime" TIMESTAMP(3),
    "recommendedShippingTime" TIMESTAMP(3),
    "buyerNote" TEXT,
    "sellerNote" TEXT,
    "isCod" BOOLEAN,
    "paymentMethodName" TEXT,
    "paymentJson" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "recipientAddress" TEXT,
    "piiAnonymizedAt" TIMESTAMP(3),
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price" DOUBLE PRECISION,
    "channelSku" TEXT NOT NULL,
    "productId" TEXT,
    "imageUrl" TEXT,
    "productName" TEXT,
    "skuName" TEXT,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformOrderMapping" (
    "id" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "lastWebhookUpdateTime" INTEGER,
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "PlatformOrderMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "carrier" TEXT,
    "trackingNo" TEXT,
    "status" TEXT NOT NULL,
    "shippedAt" TIMESTAMP(3),
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentTrackingEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "actionCode" INTEGER,
    "description" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentTrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionActivity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalActivityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "productLevel" TEXT NOT NULL,
    "durationType" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "sourceCreatedEpoch" TEXT,
    "sourceCreatedUnit" TEXT,
    "sourceUpdatedEpoch" TEXT,
    "sourceUpdatedUnit" TEXT,
    "lastConfirmedAt" TIMESTAMP(3),
    "rawPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionActivityItem" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionActivityItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionAuditLog" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productMappingId" TEXT,

    CONSTRAINT "PromotionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "errorMessage" TEXT,
    "payload" TEXT,
    "accountId" TEXT NOT NULL,
    "handledAt" TIMESTAMP(3),
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "newSellable" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "accountId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiiAccessLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNo" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PiiAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL,
    "changeQty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "note" TEXT,
    "stockAfter" INTEGER NOT NULL,
    "variantId" TEXT NOT NULL,
    "accountId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOpname" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "StockOpname_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOpnameItem" (
    "id" TEXT NOT NULL,
    "opnameId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "systemStock" INTEGER NOT NULL,
    "countedStock" INTEGER,

    CONSTRAINT "StockOpnameItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySetting" (
    "id" TEXT NOT NULL DEFAULT 'inventory-default',
    "lowStockDefaultThreshold" INTEGER NOT NULL DEFAULT 20,
    "notifyLowStock" BOOLEAN NOT NULL DEFAULT true,
    "notifyLowStockEmail" BOOLEAN NOT NULL DEFAULT false,
    "syncPushTokopedia" BOOLEAN NOT NULL DEFAULT true,
    "syncPushShopee" BOOLEAN NOT NULL DEFAULT true,
    "syncPushTiktok" BOOLEAN NOT NULL DEFAULT true,
    "opnameReminderFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_platform_externalShopId_key" ON "PlatformAccount"("platform", "externalShopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_masterProductId_sku_key" ON "ProductVariant"("masterProductId", "sku");

-- CreateIndex
CREATE INDEX "BundleItem_componentVariantId_idx" ON "BundleItem"("componentVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "BundleItem_bundleProductId_componentVariantId_key" ON "BundleItem"("bundleProductId", "componentVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_accountId_variantId_key" ON "ProductMapping"("accountId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_accountId_channelSku_key" ON "ProductMapping"("accountId", "channelSku");

-- CreateIndex
CREATE INDEX "SalesLog_variantId_time_idx" ON "SalesLog"("variantId", "time");

-- CreateIndex
CREATE INDEX "Order_createTime_status_idx" ON "Order"("createTime", "status");

-- CreateIndex
CREATE INDEX "Order_accountId_createTime_idx" ON "Order"("accountId", "createTime");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_channelSku_idx" ON "OrderItem"("variantId", "channelSku");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformOrderMapping_accountId_externalOrderId_key" ON "PlatformOrderMapping"("accountId", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_accountId_orderId_externalId_key" ON "Shipment"("accountId", "orderId", "externalId");

-- CreateIndex
CREATE INDEX "ShipmentTrackingEvent_shipmentId_eventTime_idx" ON "ShipmentTrackingEvent"("shipmentId", "eventTime");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentTrackingEvent_shipmentId_eventTime_description_key" ON "ShipmentTrackingEvent"("shipmentId", "eventTime", "description");

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

-- CreateIndex
CREATE INDEX "PromotionAuditLog_accountId_createdAt_idx" ON "PromotionAuditLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionAuditLog_userId_createdAt_idx" ON "PromotionAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionAuditLog_externalActivityId_idx" ON "PromotionAuditLog"("externalActivityId");

-- CreateIndex
CREATE INDEX "PromotionAuditLog_resultStatus_idx" ON "PromotionAuditLog"("resultStatus");

-- CreateIndex
CREATE INDEX "SyncJob_status_nextRetryAt_idx" ON "SyncJob"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "SyncJob_variantId_idx" ON "SyncJob"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_variantId_accountId_channelSku_status_key" ON "SyncJob"("variantId", "accountId", "channelSku", "status");

-- CreateIndex
CREATE INDEX "PiiAccessLog_userId_idx" ON "PiiAccessLog"("userId");

-- CreateIndex
CREATE INDEX "PiiAccessLog_orderId_idx" ON "PiiAccessLog"("orderId");

-- CreateIndex
CREATE INDEX "StockLedger_variantId_createdAt_idx" ON "StockLedger"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockLedger_reason_referenceId_idx" ON "StockLedger"("reason", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLedger_reason_referenceId_variantId_key" ON "StockLedger"("reason", "referenceId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockOpname_code_key" ON "StockOpname"("code");

-- CreateIndex
CREATE INDEX "StockOpname_status_startedAt_idx" ON "StockOpname"("status", "startedAt");

-- CreateIndex
CREATE INDEX "StockOpnameItem_variantId_idx" ON "StockOpnameItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockOpnameItem_opnameId_variantId_key" ON "StockOpnameItem"("opnameId", "variantId");

-- AddForeignKey
ALTER TABLE "PlatformAccount" ADD CONSTRAINT "PlatformAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterProduct" ADD CONSTRAINT "MasterProduct_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_bundleProductId_fkey" FOREIGN KEY ("bundleProductId") REFERENCES "MasterProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleItem" ADD CONSTRAINT "BundleItem_componentVariantId_fkey" FOREIGN KEY ("componentVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLog" ADD CONSTRAINT "SalesLog_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesLog" ADD CONSTRAINT "SalesLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformOrderMapping" ADD CONSTRAINT "PlatformOrderMapping_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformOrderMapping" ADD CONSTRAINT "PlatformOrderMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTrackingEvent" ADD CONSTRAINT "ShipmentTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionActivity" ADD CONSTRAINT "PromotionActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionActivityItem" ADD CONSTRAINT "PromotionActivityItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PromotionActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionActivityItem" ADD CONSTRAINT "PromotionActivityItem_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionAuditLog" ADD CONSTRAINT "PromotionAuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionAuditLog" ADD CONSTRAINT "PromotionAuditLog_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpname" ADD CONSTRAINT "StockOpname_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpnameItem" ADD CONSTRAINT "StockOpnameItem_opnameId_fkey" FOREIGN KEY ("opnameId") REFERENCES "StockOpname"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOpnameItem" ADD CONSTRAINT "StockOpnameItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

