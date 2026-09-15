-- AlterTable: ProductVariant (batas minimum per varian + toggle notifikasi email)
ALTER TABLE "ProductVariant" ADD COLUMN "minStock" INTEGER;
ALTER TABLE "ProductVariant" ADD COLUMN "notifyEmail" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: SyncLog (penanda penanganan manual oversell)
ALTER TABLE "SyncLog" ADD COLUMN "handledAt" DATETIME;
ALTER TABLE "SyncLog" ADD COLUMN "handledBy" TEXT;
