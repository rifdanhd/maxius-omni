-- Asal mapping: manual | auto | review (badge di daftar Mapping Stok Terpusat)
ALTER TABLE "ProductMapping" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'manual';
