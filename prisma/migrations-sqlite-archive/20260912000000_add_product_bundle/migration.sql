-- AlterTable: MasterProduct (tipe produk single | bundle, validasi di kode)
ALTER TABLE "MasterProduct" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'single';

-- CreateTable: BundleItem (komposisi produk bundle)
CREATE TABLE "BundleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleProductId" TEXT NOT NULL,
    "componentVariantId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BundleItem_bundleProductId_fkey" FOREIGN KEY ("bundleProductId") REFERENCES "MasterProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BundleItem_componentVariantId_fkey" FOREIGN KEY ("componentVariantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BundleItem_bundleProductId_componentVariantId_key" ON "BundleItem"("bundleProductId", "componentVariantId");
CREATE INDEX "BundleItem_componentVariantId_idx" ON "BundleItem"("componentVariantId");
