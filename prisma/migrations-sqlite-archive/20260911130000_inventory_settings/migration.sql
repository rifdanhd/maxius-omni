-- CreateTable
CREATE TABLE "InventorySetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'inventory-default',
    "lowStockDefaultThreshold" INTEGER NOT NULL DEFAULT 20,
    "notifyLowStock" BOOLEAN NOT NULL DEFAULT true,
    "notifyLowStockEmail" BOOLEAN NOT NULL DEFAULT false,
    "syncPushTokopedia" BOOLEAN NOT NULL DEFAULT true,
    "syncPushShopee" BOOLEAN NOT NULL DEFAULT true,
    "syncPushTiktok" BOOLEAN NOT NULL DEFAULT true,
    "opnameReminderFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "updatedAt" DATETIME NOT NULL
);

