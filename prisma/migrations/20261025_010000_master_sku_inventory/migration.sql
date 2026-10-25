-- DropIndex
DROP INDEX "ProductMapping_accountId_variantId_key";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "importOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PlatformAccount" ADD COLUMN     "stockAllocationMode" TEXT NOT NULL DEFAULT 'FULL',
ADD COLUMN     "stockAllocationValue" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "stockBuffer" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductMapping" ADD COLUMN     "platformSkuId" TEXT,
ADD COLUMN     "sellerSku" TEXT,
ADD COLUMN     "stockAllocationMode" TEXT,
ADD COLUMN     "stockAllocationValue" INTEGER,
ADD COLUMN     "stockBuffer" INTEGER;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StockLedger" ADD COLUMN     "warehouseId" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "requestFingerprint" TEXT;

-- CreateTable
CREATE TABLE "InventoryWarehouse" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InventoryWarehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantWarehouseStock" (
    "variantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VariantWarehouseStock_pkey" PRIMARY KEY ("variantId","warehouseId")
);

-- CreateTable
CREATE TABLE "MasterSkuKey" (
    "businessId" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "variantId" TEXT,

    CONSTRAINT "MasterSkuKey_pkey" PRIMARY KEY ("businessId","sellerSku")
);

-- CreateTable
CREATE TABLE "SkuMappingReview" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mappingId" TEXT,
    "sellerSku" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "candidateIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkuMappingReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryWarehouse_businessId_idx" ON "InventoryWarehouse"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryWarehouse_businessId_name_key" ON "InventoryWarehouse"("businessId", "name");

-- CreateIndex
CREATE INDEX "VariantWarehouseStock_warehouseId_idx" ON "VariantWarehouseStock"("warehouseId");

-- CreateIndex
CREATE INDEX "MasterSkuKey_variantId_idx" ON "MasterSkuKey"("variantId");

-- CreateIndex
CREATE INDEX "SkuMappingReview_businessId_status_idx" ON "SkuMappingReview"("businessId", "status");

-- CreateIndex
CREATE INDEX "SkuMappingReview_mappingId_idx" ON "SkuMappingReview"("mappingId");

-- CreateIndex
CREATE INDEX "ProductMapping_accountId_variantId_idx" ON "ProductMapping"("accountId", "variantId");

-- CreateIndex
CREATE INDEX "ProductMapping_variantId_idx" ON "ProductMapping"("variantId");

-- CreateIndex
CREATE INDEX "ProductMapping_accountId_sellerSku_idx" ON "ProductMapping"("accountId", "sellerSku");

-- AddForeignKey
ALTER TABLE "InventoryWarehouse" ADD CONSTRAINT "InventoryWarehouse_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantWarehouseStock" ADD CONSTRAINT "VariantWarehouseStock_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantWarehouseStock" ADD CONSTRAINT "VariantWarehouseStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterSkuKey" ADD CONSTRAINT "MasterSkuKey_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterSkuKey" ADD CONSTRAINT "MasterSkuKey_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuMappingReview" ADD CONSTRAINT "SkuMappingReview_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuMappingReview" ADD CONSTRAINT "SkuMappingReview_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "ProductMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "InventoryWarehouse_one_default" ON "InventoryWarehouse" ("businessId") WHERE "isDefault";
CREATE TABLE "WarehouseOrderAllocation" (
  "orderId" TEXT NOT NULL REFERENCES "Order"(id) ON DELETE CASCADE,
  "variantId" TEXT NOT NULL REFERENCES "ProductVariant"(id) ON DELETE CASCADE,
  "warehouseId" TEXT NOT NULL REFERENCES "InventoryWarehouse"(id),
  quantity INTEGER NOT NULL,
  PRIMARY KEY ("orderId", "variantId", "warehouseId")
);
CREATE INDEX "WarehouseOrderAllocation_variantId_idx" ON "WarehouseOrderAllocation" ("variantId");
CREATE INDEX "WarehouseOrderAllocation_warehouseId_idx" ON "WarehouseOrderAllocation" ("warehouseId");
ALTER TABLE "ProductMapping" ADD COLUMN "lastStockPushStatus" TEXT,
  ADD COLUMN "lastStockPushError" TEXT, ADD COLUMN "lastStockPushAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "PlatformOrderMapping_orderId_idx" ON "PlatformOrderMapping" ("orderId");
CREATE INDEX IF NOT EXISTS "ReturnRequest_orderId_idx" ON "ReturnRequest" ("orderId");
CREATE INDEX IF NOT EXISTS "Shipment_orderId_idx" ON "Shipment" ("orderId");
CREATE INDEX IF NOT EXISTS "StockLedger_accountId_idx" ON "StockLedger" ("accountId");
CREATE INDEX "Order_active_stock_idx" ON "Order" ("accountId", "status") WHERE NOT "importOnly";
CREATE INDEX "StockOutbox_businessId_variantId_status_idx" ON "StockOutbox" ("businessId", "variantId", status);
CREATE INDEX "SyncJob_accountId_variantId_channelSku_updatedAt_idx" ON "SyncJob" ("accountId", "variantId", "channelSku", "updatedAt");

INSERT INTO "InventoryWarehouse" (id, "businessId", name, "isDefault")
SELECT 'warehouse-' || id, id, 'Gudang utama', true FROM "Business";
INSERT INTO "VariantWarehouseStock" ("variantId", "warehouseId", stock, "safetyStock")
SELECT pv.id, w.id, pv.stock, pv."safetyStock" FROM "ProductVariant" pv
JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
JOIN "InventoryWarehouse" w ON w."businessId" = mp."businessId" AND w."isDefault";

INSERT INTO "MasterSkuKey" ("businessId", "sellerSku", "variantId")
SELECT mp."businessId", trim(pv.sku), CASE WHEN count(*) = 1 THEN min(pv.id) ELSE NULL END
FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
WHERE trim(pv.sku) <> '' AND pv.sku !~ '^[0-9]+(:[0-9]+)?$'
GROUP BY mp."businessId", trim(pv.sku);
INSERT INTO "SkuMappingReview" (id, "businessId", "sellerSku", reason, "candidateIds", status)
SELECT 'review-' || md5(mp."businessId" || ':' || trim(pv.sku)), mp."businessId", trim(pv.sku),
       'SKU seller memiliki beberapa varian pusat; stok tidak digabung otomatis.', jsonb_agg(pv.id), 'PENDING'
FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
WHERE trim(pv.sku) <> '' AND pv.sku !~ '^[0-9]+(:[0-9]+)?$'
GROUP BY mp."businessId", trim(pv.sku) HAVING count(*) > 1;
UPDATE "ProductMapping" pm SET "sellerSku" = trim(pm."channelSku")
WHERE trim(pm."channelSku") <> '' AND pm."channelSku" !~ '^[0-9]+(:[0-9]+)?$';

CREATE FUNCTION inventory_variant_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stock IS DISTINCT FROM OLD.stock OR NEW."safetyStock" IS DISTINCT FROM OLD."safetyStock" THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_variant_version BEFORE UPDATE ON "ProductVariant"
FOR EACH ROW EXECUTE FUNCTION inventory_variant_version();

CREATE FUNCTION inventory_variant_warehouse_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant text; primary_warehouse text; remaining bigint; balance record; taken bigint; stock_order text; restore_order text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  SELECT "businessId" INTO tenant FROM "MasterProduct" WHERE id = NEW."masterProductId";
  IF NOT EXISTS (SELECT 1 FROM "InventoryWarehouse" WHERE "businessId" = tenant AND "isDefault") THEN
    INSERT INTO "InventoryWarehouse" (id, "businessId", name, "isDefault")
    VALUES ('warehouse-' || tenant, tenant, 'Gudang utama', true)
    ON CONFLICT ("businessId", name) DO UPDATE SET "isDefault" = true;
  END IF;
  SELECT id INTO primary_warehouse FROM "InventoryWarehouse" WHERE "businessId" = tenant AND "isDefault";
  INSERT INTO "VariantWarehouseStock" ("variantId", "warehouseId", stock, "safetyStock")
  VALUES (NEW.id, primary_warehouse, 0, 0) ON CONFLICT DO NOTHING;
  IF TG_OP = 'INSERT' THEN
    UPDATE "VariantWarehouseStock" SET stock = NEW.stock, "safetyStock" = NEW."safetyStock"
    WHERE "variantId" = NEW.id AND "warehouseId" = primary_warehouse;
    RETURN NEW;
  END IF;
  remaining := NEW.stock::bigint - OLD.stock::bigint;
  stock_order := NULLIF(current_setting('maxius.stock_order_id', true), '');
  restore_order := NULLIF(current_setting('maxius.restore_order_id', true), '');
  IF remaining >= 0 THEN
    IF restore_order IS NOT NULL THEN
      FOR balance IN SELECT * FROM "WarehouseOrderAllocation" WHERE "orderId" = restore_order AND "variantId" = NEW.id ORDER BY "warehouseId"
      LOOP
        taken := LEAST(balance.quantity, remaining);
        UPDATE "VariantWarehouseStock" SET stock = stock + taken
        WHERE "variantId" = NEW.id AND "warehouseId" = balance."warehouseId";
        remaining := remaining - taken;
        EXIT WHEN remaining = 0;
      END LOOP;
    END IF;
    IF remaining > 0 THEN
      UPDATE "VariantWarehouseStock" SET stock = stock + remaining
      WHERE "variantId" = NEW.id AND "warehouseId" = primary_warehouse;
    END IF;
  ELSE
    remaining := -remaining;
    FOR balance IN SELECT ws.* FROM "VariantWarehouseStock" ws WHERE ws."variantId" = NEW.id
      ORDER BY (ws."warehouseId" = primary_warehouse) DESC, ws."warehouseId" FOR UPDATE
    LOOP
      taken := LEAST(GREATEST(balance.stock, 0), remaining);
      UPDATE "VariantWarehouseStock" SET stock = stock - taken
      WHERE "variantId" = NEW.id AND "warehouseId" = balance."warehouseId";
      IF stock_order IS NOT NULL AND taken > 0 THEN
        IF NOT EXISTS (SELECT 1 FROM "Order" o JOIN "PlatformAccount" a ON a.id = o."accountId" WHERE o.id = stock_order AND a."businessId" = tenant) THEN
          RAISE EXCEPTION 'Pesanan dan SKU harus berasal dari customer yang sama';
        END IF;
        INSERT INTO "WarehouseOrderAllocation" ("orderId", "variantId", "warehouseId", quantity)
        VALUES (stock_order, NEW.id, balance."warehouseId", taken)
        ON CONFLICT ("orderId", "variantId", "warehouseId") DO UPDATE SET quantity = "WarehouseOrderAllocation".quantity + EXCLUDED.quantity;
      END IF;
      remaining := remaining - taken;
      EXIT WHEN remaining = 0;
    END LOOP;
    IF remaining > 0 THEN RAISE EXCEPTION 'Stok gudang tidak cukup'; END IF;
  END IF;
  remaining := NEW."safetyStock"::bigint - OLD."safetyStock"::bigint;
  IF remaining >= 0 THEN
    UPDATE "VariantWarehouseStock" SET "safetyStock" = "safetyStock" + remaining
    WHERE "variantId" = NEW.id AND "warehouseId" = primary_warehouse;
  ELSE
    remaining := -remaining;
    FOR balance IN SELECT ws.* FROM "VariantWarehouseStock" ws WHERE ws."variantId" = NEW.id
      ORDER BY (ws."warehouseId" = primary_warehouse) DESC, ws."warehouseId" FOR UPDATE
    LOOP
      taken := LEAST(GREATEST(balance."safetyStock", 0), remaining);
      UPDATE "VariantWarehouseStock" SET "safetyStock" = "safetyStock" - taken
      WHERE "variantId" = NEW.id AND "warehouseId" = balance."warehouseId";
      remaining := remaining - taken;
      EXIT WHEN remaining = 0;
    END LOOP;
    IF remaining > 0 THEN RAISE EXCEPTION 'Cadangan gudang tidak konsisten'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_variant_warehouse_mirror AFTER INSERT OR UPDATE OF stock, "safetyStock" ON "ProductVariant"
FOR EACH ROW EXECUTE FUNCTION inventory_variant_warehouse_mirror();

CREATE FUNCTION inventory_balance_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
    JOIN "InventoryWarehouse" w ON w."businessId" = mp."businessId"
    WHERE pv.id = NEW."variantId" AND w.id = NEW."warehouseId") THEN
    RAISE EXCEPTION 'Gudang dan SKU harus berasal dari customer yang sama';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_balance_tenant BEFORE INSERT OR UPDATE ON "VariantWarehouseStock"
FOR EACH ROW EXECUTE FUNCTION inventory_balance_tenant();

CREATE FUNCTION inventory_balance_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE variant text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  variant := CASE WHEN TG_OP = 'DELETE' THEN OLD."variantId" ELSE NEW."variantId" END;
  UPDATE "ProductVariant" SET stock = (SELECT COALESCE(SUM(stock), 0) FROM "VariantWarehouseStock" WHERE "variantId" = variant),
    "safetyStock" = (SELECT COALESCE(SUM("safetyStock"), 0) FROM "VariantWarehouseStock" WHERE "variantId" = variant),
    "updatedAt" = CURRENT_TIMESTAMP WHERE id = variant;
  RETURN NULL;
END $$;
CREATE TRIGGER inventory_balance_total AFTER INSERT OR UPDATE OR DELETE ON "VariantWarehouseStock"
FOR EACH ROW EXECUTE FUNCTION inventory_balance_total();

CREATE FUNCTION inventory_mapping_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."variantId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
    JOIN "PlatformAccount" a ON a."businessId" = mp."businessId"
    WHERE pv.id = NEW."variantId" AND a.id = NEW."accountId"
  ) THEN RAISE EXCEPTION 'Mapping dan SKU harus berasal dari customer yang sama'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_mapping_tenant BEFORE INSERT OR UPDATE OF "variantId", "accountId" ON "ProductMapping"
FOR EACH ROW EXECUTE FUNCTION inventory_mapping_tenant();

CREATE FUNCTION inventory_sku_key_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."variantId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProductVariant" pv JOIN "MasterProduct" mp ON mp.id = pv."masterProductId"
    WHERE pv.id = NEW."variantId" AND mp."businessId" = NEW."businessId"
  ) THEN RAISE EXCEPTION 'Identitas SKU harus berasal dari customer yang sama'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_sku_key_tenant BEFORE INSERT OR UPDATE ON "MasterSkuKey"
FOR EACH ROW EXECUTE FUNCTION inventory_sku_key_tenant();
