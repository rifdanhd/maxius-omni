CREATE TABLE "StockOutbox" (
  "id" TEXT PRIMARY KEY,
  "eventKey" TEXT NOT NULL UNIQUE,
  "variantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "handledAt" TIMESTAMP(3)
);
CREATE INDEX "StockOutbox_status_createdAt_idx" ON "StockOutbox"("status", "createdAt");

CREATE FUNCTION maxius_stock_ledger_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "StockOutbox"("id", "eventKey", "variantId", "businessId")
  SELECT NEW."id", NEW."id", NEW."variantId", p."businessId"
  FROM "ProductVariant" v JOIN "MasterProduct" p ON p."id"=v."masterProductId"
  WHERE v."id"=NEW."variantId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "StockLedger_transactional_outbox" AFTER INSERT ON "StockLedger"
FOR EACH ROW EXECUTE FUNCTION maxius_stock_ledger_outbox();
