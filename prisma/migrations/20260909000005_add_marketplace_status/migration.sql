-- ProductMapping: status & snapshot sinkronisasi listing TikTok Shop.
ALTER TABLE "ProductMapping" ADD COLUMN "platformProductId" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "platformStatus" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "platformStatusRaw" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "platformStock" INTEGER;
ALTER TABLE "ProductMapping" ADD COLUMN "platformTitle" TEXT;
ALTER TABLE "ProductMapping" ADD COLUMN "lastSyncedAt" DATETIME;