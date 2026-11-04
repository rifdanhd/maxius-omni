ALTER TABLE "InventorySetting"
ADD COLUMN "stockBaselineReady" BOOLEAN NOT NULL DEFAULT false;

UPDATE "InventorySetting"
SET "stockBaselineReady" = false;
