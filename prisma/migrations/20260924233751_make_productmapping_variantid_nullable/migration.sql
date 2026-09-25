-- AlterTable
ALTER TABLE "ProductMapping" ALTER COLUMN "variantId" DROP NOT NULL,
ALTER COLUMN "variantId" DROP DEFAULT;

-- Backfill safety: sisa sentinel '' → NULL (cek dev: 0 row terdampak)
UPDATE "ProductMapping" SET "variantId" = NULL WHERE "variantId" = '';

-- CreateIndex
CREATE INDEX "Business_id_idx" ON "Business"("id");

-- CreateIndex
CREATE INDEX "MasterProduct_businessId_idx" ON "MasterProduct"("businessId");
