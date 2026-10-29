-- Add stockPushEnabled column to InventorySetting
ALTER TABLE "InventorySetting" ADD COLUMN     "stockPushEnabled" BOOLEAN NOT NULL DEFAULT true;