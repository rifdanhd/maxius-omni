import { test, expect } from '@playwright/test';
import { sql, login } from './helpers';

const SHOT = (n: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/promo-listing-${n}.png`;

// Fixture mandiri: listing promosi diisi oleh INGEST (scripts/run-promotion-ingest),
// bukan oleh tombol create. Karena itu activity di-seed langsung ke DB — sama
// persis dengan bentuk hasil ingest — lalu diverifikasi lewat UI.
const ACCT = 'e2e-promolist-acct';
const LABEL = 'E2E Promo Listing Toko';
const MP = 'e2e-promolist-mp';
const VAR = 'e2e-promolist-var';
const MAP = 'e2e-promolist-map';
const ACT = 'e2e-promolist-activity';
const EXT = 'e2e-promolist-ext';
const STAMP = Date.now().toString().slice(-8);
const TITLE = `Promo Gajian E2E ${STAMP}`;
const CHANNEL_SKU = `E2E-PL-${STAMP}`;

function plusHours(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

test.beforeAll(() => {
  sql(
    `INSERT INTO "PlatformAccount" (id, platform, label, "businessId", "createdAt", "updatedAt") ` +
      `VALUES ('${ACCT}','TIKTOK_SHOP','${LABEL}','business-default',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "MasterProduct" (id, name, "businessId") ` +
      `VALUES ('${MP}','E2E Promo Listing Produk','business-default') ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "ProductVariant" (id, sku, stock, "safetyStock", price, "masterProductId", "createdAt", "updatedAt") ` +
      `VALUES ('${VAR}','${CHANNEL_SKU}',15,0,90000,'${MP}',NOW(),NOW()) ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "ProductMapping" (id, "channelSku", "variantId", "accountId", price, ` +
      `"platformProductId", "platformStatus", "platformTitle", "createdAt", "updatedAt") ` +
      `VALUES ('${MAP}','${CHANNEL_SKU}','${VAR}','${ACCT}',90000,'E2E-PL-P1','ACTIVE',` +
      `'${TITLE}',NOW(),NOW()) ON CONFLICT (id) DO NOTHING;`
  );
  // Bentuk activity = hasil ingest (jadwal mencakup sekarang → tab "Aktif").
  sql(
    `INSERT INTO "PromotionActivity" (id, "accountId", "externalActivityId", title, ` +
      `"activityType", status, "productLevel", "startsAt", "endsAt", "lastConfirmedAt", "updatedAt") ` +
      `VALUES ('${ACT}','${ACCT}','${EXT}','${TITLE}','FULL_SKU_DISCOUNT','ONGOING','SKU_LEVEL',` +
      `'${plusHours(-2)}','${plusHours(48)}',NOW(),NOW()) ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "PromotionActivityItem" (id, "activityId", "externalItemKey", ` +
      `"platformProductId", "productMappingId", "updatedAt") ` +
      `VALUES ('${ACT}-item','${ACT}','e2e-pl-item-1','E2E-PL-P1','${MAP}',NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
});

test.afterAll(() => {
  // FK-safe: audit → item → activity → mapping → varian → produk → toko.
  sql(`DELETE FROM "PromotionAuditLog" WHERE "accountId" = '${ACCT}';`);
  sql(`DELETE FROM "PromotionActivityItem" WHERE "activityId" = '${ACT}';`);
  sql(`DELETE FROM "PromotionActivity" WHERE id = '${ACT}';`);
  sql(`DELETE FROM "ProductMapping" WHERE id = '${MAP}';`);
  sql(`DELETE FROM "ProductVariant" WHERE id = '${VAR}';`);
  sql(`DELETE FROM "MasterProduct" WHERE id = '${MP}';`);
  sql(`DELETE FROM "PlatformAccount" WHERE id = '${ACCT}';`);
});

test('listing promosi: activity tampil, bisa dicari/difilter, bertahan setelah reload', async ({
  page,
}) => {
  await login(page);
  await page.goto('/promotions');
  await expect(page.getByRole('heading', { name: 'Promosi Marketplace' })).toBeVisible({
    timeout: 30_000,
  });

  // 1. Activity fixture terdaftar & terhitung.
  const counter = page.getByText(/activity terpantau/);
  await expect(counter).toBeVisible({ timeout: 30_000 });
  const count = Number(((await counter.innerText()).match(/\d+/) ?? ['0'])[0]);
  expect(count).toBeGreaterThanOrEqual(1);
  const title = page.getByText(TITLE);
  await expect(title).toBeVisible({ timeout: 30_000 });
  // Status + label toko ikut tampil di baris yang sama.
  await expect(page.getByText('ONGOING').first()).toBeVisible();
  // scope ke baris tabel — LABEL juga ada sebagai <option> filter toko (hidden).
  await expect(page.locator('tbody tr').filter({ hasText: LABEL })).toBeVisible();
  await page.screenshot({ path: SHOT('row') });

  // 2. Expand baris → item + ID external terlihat (product info terhubung).
  await page.getByRole('button', { name: /^\d+ produk/ }).first().click();
  await expect(page.getByText(CHANNEL_SKU).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`ID: ${EXT}`)).toBeVisible();
  await page.screenshot({ path: SHOT('expanded') });

  // 3. Pencarian: kata kunci yang tidak ada mengosongkan hasil, reset memulihkan.
  const search = page.getByPlaceholder('Cari nama promosi, produk, atau SKU');
  await search.fill('kata-tidak-ada-xyz');
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset Filter' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset Filter' }).click();
  await expect(page.getByText(TITLE)).toBeVisible({ timeout: 15_000 });

  // 4. Filter toko: hanya toko fixture yang dipilih → activity tetap tampil.
  const storeFilter = page.locator('select').first();
  await storeFilter.selectOption(ACCT);
  await expect(page.getByText(TITLE)).toBeVisible({ timeout: 15_000 });

  // 5. Reload → data dibaca ulang dari DB, bukan state sementara.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Promosi Marketplace' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(TITLE)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: SHOT('after-reload') });
});

test('audit UNVERIFIED → banner peringatan + badge "Perlu cek manual" di listing', async ({
  page,
}) => {
  const userId = sql(`SELECT id FROM "User" WHERE username = 'admin';`);
  sql(
    `INSERT INTO "PromotionAuditLog" (id, "accountId", "userId", username, action, ` +
      `"externalActivityId", "activityTitle", "resultStatus", "updatedAt") ` +
      `VALUES ('${ACT}-audit','${ACCT}','${userId}','admin','CREATE','${EXT}','${TITLE}',` +
      `'UNVERIFIED',NOW()) ON CONFLICT (id) DO NOTHING;`
  );

  await login(page);
  await page.goto('/promotions');
  await expect(page.getByRole('heading', { name: 'Promosi Marketplace' })).toBeVisible({
    timeout: 30_000,
  });

  // Banner atas: hasil create yang tidak terkonfirmasi TIDAK boleh hilang.
  const banner = page.locator('p.font-bold', {
    hasText: 'tindakan promosi perlu perhatian',
  });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText('TIDAK TERVERIFIKASI');
  // Badge pada baris activity yang sama.
  await expect(page.getByText('Perlu cek manual')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: SHOT('unverified-banner') });

  // Tutup banner → badge di baris TETAP ada (hanya banner yang dismis).
  await page.getByRole('button', { name: 'Tutup' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByText('Perlu cek manual')).toBeVisible();

  sql(`DELETE FROM "PromotionAuditLog" WHERE id = '${ACT}-audit';`);
});

// BUG (belum diperbaiki): promo hasil wizard TIDAK pernah muncul di listing.
// Root cause: POST /api/marketplace/tiktok/promotions/create hanya menulis
// PromotionAuditLog (SUCCESS/TIKTOK_ERROR/UNVERIFIED) — TIDAK pernah membuat
// PromotionActivity; halaman /promotions membaca PromotionActivity (diisi
// ingest). Secara offline hasil create selalu "Promosi TIDAK jadi dibuat."
// (akun tanpa accessToken/shopCipher → audit TIKTOK_ERROR, 400).
// Ganti `test.fixme` → `test` bila create mulai menulis activity / ingest
// otomatis dijalankan setelah create.
test.fixme('promo hasil create muncul sendiri di listing promosi', async ({ page }) => {
  await login(page);
  await page.goto('/promotions');
  await expect(page.getByRole('heading', { name: 'Promosi Marketplace' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Promosi Hasil Wizard E2E')).toBeVisible({ timeout: 30_000 });
});
