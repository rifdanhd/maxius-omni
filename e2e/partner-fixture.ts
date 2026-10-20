import { expect } from '@playwright/test';
import { sql } from './helpers';

/**
 * Fixture dummy untuk screenshot TikTok Shop Partner Center.
 * DIJALANKAN SAJA PADA DB E2E TERISOLASI (maxius_test_e2e_*).
 *
 * Aturan keamanan:
 * - Tidak ada kredensial toko nyata: semua PlatformAccount tetap tanpa
 *   accessToken/shopCipher, sehingga push stok dibatalkan lewat guard
 *   stock-push-queue (log "skipped") dan TIDAK MENEMBAK API TikTok/Shopee asli.
 * - Semua data dummy: 1 toko uji, 5 produk, SKU uji TEST-MAXIUS-01.
 * - Data pembeli palsu ("Dummy Pembeli N", telepon tersensor) — tidak ada PII nyata.
 */

export const TEST_SKU = process.env.MAXIUS_TEST_SKU ?? 'TEST-MAXIUS-01';

const FIXTURE = `
-- GUARD: gagalkan fixture bila DB e2e punya kredensial toko nyata
DO $$ BEGIN
  IF (SELECT count(*) FROM "PlatformAccount" WHERE "accessToken" IS NOT NULL OR "shopCipher" IS NOT NULL) > 0 THEN
    RAISE EXCEPTION 'Kredensial toko nyata terdeteksi di DB e2e — push stok harus tidak menembak API asli.';
  END IF;
END $$;

-- 1 toko uji: sisakan tiktok-1 (tanpa token), buang toko dummy lain
DELETE FROM "ProductMapping" WHERE "accountId" IN ('tiktok-2', 'tiktok-3');
DELETE FROM "PlatformAccount" WHERE "id" IN ('tiktok-2', 'tiktok-3');

-- produk uji tambahan: master + varian SKU uji TEST-MAXIUS-01
INSERT INTO "MasterProduct" ("id", "name", "status", "isActive", "type", "businessId", "threshold")
VALUES ('mp-partner-test', 'Kaos Kaki Uji Partner', 'active', true, 'single', 'business-default', 10)
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "ProductVariant" ("id", "sku", "stock", "masterProductId", "price", "updatedAt")
VALUES ('pv-partner-test', 'TEST-MAXIUS-01', 50, 'mp-partner-test', 19900, now())
ON CONFLICT ("masterProductId", "sku") DO UPDATE SET "stock" = 50, "price" = 19900, "updatedAt" = now(), "id" = 'pv-partner-test';
INSERT INTO "ProductMapping" ("id", "channelSku", "variantId", "accountId", "price", "platformProductId", "platformStatus", "platformStatusRaw", "platformStock", "platformTitle", "lastSyncedAt", "updatedAt")
VALUES ('pmp-partner-test-01', 'TTS1-TESTMAXIUS-01', 'pv-partner-test', 'tiktok-1', 19900, '74219900000PARTNER', 'ACTIVE', 'ACTIVE', 48, 'Kaos Kaki Uji Partner', now(), now())
ON CONFLICT ("accountId", "channelSku") DO UPDATE SET
  "variantId" = 'pv-partner-test', "platformStatus" = 'ACTIVE', "platformStock" = 48,
  "platformTitle" = 'Kaos Kaki Uji Partner', "lastSyncedAt" = now(), "updatedAt" = now();

-- mapping toko toko uji untuk varian seed (tampil sebagai listing tersinkron)
UPDATE "ProductMapping" m SET
  "platformProductId" = '74' || substr(md5(m."id"), 1, 11),
  "platformStatus" = 'ACTIVE',
  "platformStatusRaw" = 'ACTIVE',
  "platformStock" = v."stock",
  "platformTitle" = p."name",
  "lastSyncedAt" = now(),
  "updatedAt" = now(),
  "price" = COALESCE(v."price", m."price", 19900)
FROM "ProductVariant" v JOIN "MasterProduct" p ON p."id" = v."masterProductId"
WHERE m."variantId" = v."id";

-- pesanan dummy (semua pembeli palsu) — status mengikuti tab OrdersPage
INSERT INTO "Order" ("id", "orderNo", "status", "buyerName", "amount", "currency", "createTime", "paidTime", "isCod", "paymentMethodName", "recipientName", "recipientPhone", "recipientAddress", "accountId", "updatedAt")
VALUES
  ('ord-partner-1', 'PTP261001', 'UNPAID', 'Dummy Pembeli 1', 19900, 'IDR', now() - interval '1 day', NULL, false, 'Transfer Bank', 'Dummy Pembeli 1', '[Tersensor]', 'Jl. Dummy No. 1, Jakarta', 'tiktok-1', now()),
  ('ord-partner-2', 'PTP261002', 'AWAITING_SHIPMENT', 'Dummy Pembeli 2', 39800, 'IDR', now() - interval '2 day', now() - interval '2 day', false, 'COD', 'Dummy Pembeli 2', '[Tersensor]', 'Jl. Dummy No. 2, Bandung', 'tiktok-1', now()),
  ('ord-partner-3', 'PTP261003', 'COMPLETED', 'Dummy Pembeli 3', 19900, 'IDR', now() - interval '9 day', now() - interval '9 day', false, 'Transfer Bank', 'Dummy Pembeli 3', '[Tersensor]', 'Jl. Dummy No. 3, Surabaya', 'tiktok-1', now())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "OrderItem" ("id", "qty", "price", "channelSku", "productName", "skuName", "orderId")
VALUES
  ('oi-partner-1', 1, 19900, 'TTS1-TESTMAXIUS-01', 'Kaos Kaki Uji Partner', 'TEST-MAXIUS-01', 'ord-partner-1'),
  ('oi-partner-2a', 1, 19900, 'TTS1-BLACK01', 'Kaos kaki polos hitam', 'SOCK-BLK', 'ord-partner-2'),
  ('oi-partner-2b', 1, 19900, 'TTS1-BLACK01', 'Kaos kaki polos hitam', 'SOCK-BLK', 'ord-partner-2'),
  ('oi-partner-3', 1, 19900, 'TTS1-WHITE01', 'Kaos kaki olahraga putih', 'SOCK-WHT', 'ord-partner-3')
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "PlatformOrderMapping" ("id", "externalOrderId", "rawStatus", "orderId", "accountId")
VALUES
  ('pom-partner-1', '74219900000ORD01', 'UNPAID', 'ord-partner-1', 'tiktok-1'),
  ('pom-partner-2', '74219900000ORD02', 'AWAITING_SHIPMENT', 'ord-partner-2', 'tiktok-1'),
  ('pom-partner-3', '74219900000ORD03', 'COMPLETED', 'ord-partner-3', 'tiktok-1')
ON CONFLICT ("accountId", "externalOrderId") DO NOTHING;

-- log sinkronisasi dummy: push sukses + tarik pesanan
INSERT INTO "SyncLog" ("id", "direction", "kind", "status", "message", "accountId", "createdAt")
VALUES
  ('sl-partner-1', 'out', 'stock_push', 'success', 'Push stok TTS1-TESTMAXIUS-01 → 48 (dummy)', 'tiktok-1', now() - interval '5 minutes'),
  ('sl-partner-2', 'out', 'stock_push', 'success', 'Push stok TTS1-BLACK01 → 120 (dummy)', 'tiktok-1', now() - interval '10 minutes'),
  ('sl-partner-3', 'in', 'order', 'success', 'Tarik pesanan TikTok: 3 pesanan baru (dummy)', 'tiktok-1', now() - interval '15 minutes')
ON CONFLICT ("id") DO NOTHING;
`;

/** Terapkan fixture + verifikasi pra-kondisi. */
export function applyPartnerFixture(): void {
  sql(FIXTURE);
  const accounts = sql(`SELECT count(*) FROM "PlatformAccount"`);
  const withToken = sql(`SELECT count(*) FROM "PlatformAccount" WHERE "accessToken" IS NOT NULL OR "shopCipher" IS NOT NULL`);
  expect(withToken, 'DB e2e tidak boleh punya kredensial toko nyata').toBe('0');
  expect(accounts, 'harus tersisa 1 toko uji').toBe('1');
  const skuExists = sql(`SELECT count(*) FROM "ProductVariant" WHERE "sku" = 'TEST-MAXIUS-01'`);
  expect(skuExists).toBe('1');
  const orders = sql(`SELECT count(*) FROM "Order" WHERE "accountId" = 'tiktok-1'`);
  expect(Number(orders)).toBeGreaterThanOrEqual(3);
}
