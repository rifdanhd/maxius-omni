-- AlterTable
ALTER TABLE "InventorySetting" ADD COLUMN "businessId" TEXT NOT NULL DEFAULT 'business-default';

-- CreateIndex
CREATE UNIQUE INDEX "InventorySetting_businessId_key" ON "InventorySetting"("businessId");
