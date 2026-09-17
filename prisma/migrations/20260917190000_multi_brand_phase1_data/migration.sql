-- M1 data: 5 brand, kredensial legacy, junction user×brand.
-- Idempotent: aman diulang (UPDATE bersyarat + ON CONFLICT DO NOTHING).
-- Rollback: hapus baris yg di-INSERT di sini (lihat M1 di laporan), lalu
-- `prisma migrate resolve --rolled-back` + deploy migrasi DDL sebelumnya.

-- 1. Rename business existing (id TETAP "business-default", FK tak tersentuh).
UPDATE "Business"
SET name = 'Maxius', "updatedAt" = CURRENT_TIMESTAMP
WHERE id = 'business-default';

-- 2. 4 brand baru (id deterministik agar idempotent & mudah di-link kode).
INSERT INTO "Business" (id, name, "createdAt", "updatedAt")
VALUES
  ('business-raxen', 'Raxen', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('business-kaos-kaki-sport', 'Kaos Kaki Sport', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('business-den-sport', 'Den Sport', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('business-getobdg', 'Geto.bdg', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- 3. Kredensial "Legacy ENV" (secret NULL = baca dari env seperti sekarang).
--    TIDAK ada baris isFrozen / secret Shopee di-seed di sini (keputusan no.5).
INSERT INTO "AppCredential" (id, platform, label, "isActive", "createdAt", "updatedAt")
VALUES
  ('app-cred-shopee-legacy', 'SHOPEE', 'Legacy ENV (Seller app)', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('app-cred-tiktok-legacy', 'TIKTOK_SHOP', 'Legacy ENV', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- 4. Arahkan akun existing yg belum punya credential ke Legacy ENV per platform.
UPDATE "PlatformAccount"
SET "appCredentialId" = 'app-cred-shopee-legacy'
WHERE platform = 'SHOPEE' AND "appCredentialId" IS NULL;

UPDATE "PlatformAccount"
SET "appCredentialId" = 'app-cred-tiktok-legacy'
WHERE platform = 'TIKTOK_SHOP' AND "appCredentialId" IS NULL;

-- 5. Fase 1: semua user akses semua brand (tanpa role).
INSERT INTO "UserBusiness" ("userId", "businessId")
SELECT u.id, b.id FROM "User" u CROSS JOIN "Business" b
ON CONFLICT DO NOTHING;
