ALTER TABLE "InventorySetting" ADD CONSTRAINT "InventorySetting_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_businessId_fkey"
FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "InventorySetting" s LEFT JOIN "Business" b ON b.id=s."businessId" WHERE b.id IS NULL) THEN
    ALTER TABLE "InventorySetting" VALIDATE CONSTRAINT "InventorySetting_businessId_fkey";
  ELSE RAISE NOTICE 'InventorySetting has orphan business IDs; FK remains NOT VALID. Run read-only orphan detector.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "SyncRun" s LEFT JOIN "Business" b ON b.id=s."businessId" WHERE b.id IS NULL) THEN
    ALTER TABLE "SyncRun" VALIDATE CONSTRAINT "SyncRun_businessId_fkey";
  ELSE RAISE NOTICE 'SyncRun has orphan business IDs; FK remains NOT VALID. Run read-only orphan detector.';
  END IF;
END $$;
