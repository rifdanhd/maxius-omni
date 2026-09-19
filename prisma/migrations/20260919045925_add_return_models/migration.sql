-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalReturnId" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "orderId" TEXT,
    "status" TEXT NOT NULL,
    "rawStatus" TEXT NOT NULL,
    "rawPayload" TEXT,
    "type" TEXT,
    "requestType" TEXT,
    "reason" TEXT,
    "reasonText" TEXT,
    "solution" TEXT,
    "refundAmount" DOUBLE PRECISION,
    "currency" TEXT,
    "buyerEvidence" TEXT,
    "negotiation" TEXT,
    "isPlatformAutoApproved" BOOLEAN NOT NULL DEFAULT false,
    "slaDueDate" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3),

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "externalSkuId" TEXT,
    "channelSku" TEXT NOT NULL,
    "productName" TEXT,
    "skuName" TEXT,
    "imageUrl" TEXT,
    "qty" INTEGER NOT NULL,
    "price" DOUBLE PRECISION,
    "variantId" TEXT,
    "restockedAt" TIMESTAMP(3),
    "restockLedgerId" TEXT,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnAuditLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "returnId" TEXT,
    "externalReturnId" TEXT,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadSent" TEXT,
    "resultStatus" TEXT NOT NULL,
    "platformError" TEXT,
    "platformMessage" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReturnRequest_accountId_status_idx" ON "ReturnRequest"("accountId", "status");

-- CreateIndex
CREATE INDEX "ReturnRequest_slaDueDate_idx" ON "ReturnRequest"("slaDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_accountId_externalReturnId_key" ON "ReturnRequest"("accountId", "externalReturnId");

-- CreateIndex
CREATE INDEX "ReturnItem_variantId_idx" ON "ReturnItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnItem_returnId_channelSku_key" ON "ReturnItem"("returnId", "channelSku");

-- CreateIndex
CREATE INDEX "ReturnAuditLog_accountId_createdAt_idx" ON "ReturnAuditLog"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnAuditLog_returnId_idx" ON "ReturnAuditLog"("returnId");

-- CreateIndex
CREATE INDEX "ReturnAuditLog_resultStatus_idx" ON "ReturnAuditLog"("resultStatus");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnAuditLog" ADD CONSTRAINT "ReturnAuditLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnAuditLog" ADD CONSTRAINT "ReturnAuditLog_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
