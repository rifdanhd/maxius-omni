-- Label atribut varian marketplace (mis. "Biru, 10 Buah") hasil ekstraksi
-- dari platformStatusRaw. Dibaca oleh daftar mapping/stok agar tidak perlu
-- memuat payload mentah (ratusan MB untuk seluruh katalog).
ALTER TABLE "ProductMapping" ADD COLUMN "variantAttributes" TEXT;
