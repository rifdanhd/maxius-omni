-- Anti-oversell di level database (TUGAS 1):
-- Satu order hanya boleh memotong stok SEKALI per varian. Unique ini menjadi
-- kunci idempotency DB-level: dua webhook/sync yang masuk hampir bersamaan
-- untuk order yang sama akan saling gugur (create ledger kedua gagal unique
-- constraint -> transaksi rollback), bukan saling menunggu.
CREATE UNIQUE INDEX "StockLedger_reason_referenceId_variantId_key" ON "StockLedger"("reason", "referenceId", "variantId");
