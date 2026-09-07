-- AlterTable: User — flag akses PII
ALTER TABLE "User" ADD COLUMN "canViewFullPii" BOOLEAN DEFAULT true;

-- AlterTable: Order — PII + finansial pembeli
ALTER TABLE "Order" ADD COLUMN "buyerNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "isCod" BOOLEAN;
ALTER TABLE "Order" ADD COLUMN "paymentMethodName" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentJson" TEXT;
ALTER TABLE "Order" ADD COLUMN "recipientName" TEXT;
ALTER TABLE "Order" ADD COLUMN "recipientPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN "recipientAddress" TEXT;
ALTER TABLE "Order" ADD COLUMN "piiAnonymizedAt" DATETIME;

-- AlterTable: OrderItem — nama produk & variasi
ALTER TABLE "OrderItem" ADD COLUMN "productName" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "skuName" TEXT;

-- AlterTable: Shipment — id paket platform untuk idempotency
ALTER TABLE "Shipment" ADD COLUMN "externalId" TEXT;

-- CreateIndex / unique constraint Shipment
CREATE UNIQUE INDEX "Shipment_accountId_orderId_externalId_key" ON "Shipment"("accountId", "orderId", "externalId");

-- CreateTable: audit PII
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
CREATE INDEX "PiiAccessLog_userId_idx" ON "PiiAccessLog"("userId");
CREATE INDEX "PiiAccessLog_orderId_idx" ON "PiiAccessLog"("orderId");
