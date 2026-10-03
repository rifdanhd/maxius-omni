import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { sql, login, apiToken } from './helpers';

const SHOT = (n: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/business-${n}.png`;

// Fixture: 1 toko per brand — dipakai untuk membuktikan daftar toko ikut brand
// aktif. Brand Raxen sengaja dipakai sebagai perbandingan (bukan brand default).
const ACCT_DEFAULT = 'e2e-biz-acct-default';
const ACCT_RAXEN = 'e2e-biz-acct-raxen';
const LABEL_DEFAULT = 'E2E Toko Brand Default';
const LABEL_RAXEN = 'E2E Toko Brand Raxen';

test.beforeAll(() => {
  for (const [id, label, brand] of [
    [ACCT_DEFAULT, LABEL_DEFAULT, 'business-default'],
    [ACCT_RAXEN, LABEL_RAXEN, 'business-raxen'],
  ]) {
    sql(
      `INSERT INTO "PlatformAccount" (id, platform, label, "businessId", "createdAt", "updatedAt") ` +
        `VALUES ('${id}','TIKTOK_SHOP','${label}','${brand}',NOW(),NOW()) ON CONFLICT (id) DO NOTHING;`
    );
  }
});

test.afterAll(() => {
  sql(`DELETE FROM "PlatformAccount" WHERE id IN ('${ACCT_DEFAULT}','${ACCT_RAXEN}');`);
});

/** Cara BrandSwitcher mengganti brand: simpan lalu reload (tanpa switcher UI). */
async function switchBrand(page: Page, businessId: string): Promise<void> {
  await page.evaluate((id) => localStorage.setItem('activeBusinessId', id), businessId);
  await page.reload();
}

test('admin mengakses 5 brand (sumber data brand switcher)', async ({ page }) => {
  await login(page);
  // page.request TIDAK membawa token dari localStorage → kirim Bearer manual.
  const token = await apiToken(page);
  const res = await page.request.get('/api/businesses', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { businesses: { id: string; name: string }[] };
  expect(body.businesses).toHaveLength(5);
  const ids = body.businesses.map((b) => b.id);
  expect(ids).toContain('business-default');
  expect(ids).toContain('business-raxen');
  expect(body.businesses.every((b) => b.name.trim() !== '')).toBeTruthy();
});

test('ganti brand aktif → daftar toko di Pengaturan ikut berubah', async ({ page }) => {
  await login(page);

  // 1. Brand default: toko brand default tampil, toko brand Raxen tidak.
  await page.goto('/settings/accounts');
  await expect(
    page.getByRole('heading', { name: 'Tambahkan Semua Toko Marketplace kamu' })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(LABEL_DEFAULT)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(LABEL_RAXEN)).toHaveCount(0);
  await page.screenshot({ path: SHOT('default-brand') });

  // 2. Pindah ke brand Raxen → kebalikannya.
  await switchBrand(page, 'business-raxen');
  await expect(page.getByText(LABEL_RAXEN)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(LABEL_DEFAULT)).toHaveCount(0);
  await page.screenshot({ path: SHOT('raxen-brand') });

  // 3. Kembali ke brand default → datanya balik lagi (pilihan tersimpan).
  await switchBrand(page, 'business-default');
  await expect(page.getByText(LABEL_DEFAULT)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(LABEL_RAXEN)).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem('activeBusinessId'));
  expect(stored).toBe('business-default');
});

test('BrandSwitcher disembunyikan — satu dashboard tanpa dropdown brand', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 30_000 });
  // Dropdown brand (Maxius/Raxen/dll) sengaja dihapus dari header — semua toko
  // tampil dalam satu dashboard; brand aktif tetap bisa di-set via localStorage.
  await expect(page.getByTitle('Ganti brand')).toHaveCount(0);
  await page.screenshot({ path: SHOT('no-switcher') });
});

// Scoping GET /api/products: hanya brand aktif yang boleh terlihat.
// Fixture: 1 produk per brand — membuktikan filter-nya bukan kebetulan
// (daftar kosong juga lolos assertion `every`).
const PROD_DEFAULT = 'e2e-prod-default';
const PROD_RAXEN = 'e2e-prod-raxen';

test.beforeAll(() => {
  for (const [id, brand] of [
    [PROD_DEFAULT, 'business-default'],
    [PROD_RAXEN, 'business-raxen'],
  ]) {
    sql(
      `INSERT INTO "MasterProduct" (id, name, "businessId", "isActive") ` +
        `VALUES ('${id}','E2E Produk ${brand}','${brand}',true) ON CONFLICT (id) DO NOTHING;`
    );
  }
});

test.afterAll(() => {
  sql(`DELETE FROM "MasterProduct" WHERE id IN ('${PROD_DEFAULT}','${PROD_RAXEN}');`);
});

test('daftar produk ter-scoping brand aktif', async ({ page }) => {
  await login(page);
  const token = await apiToken(page);

  // Brand Raxen: produknya sendiri tampil, produk brand default tidak.
  const raxen = await page.request.get('/api/products?businessId=business-raxen', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(raxen.ok()).toBeTruthy();
  const raxenBody = (await raxen.json()) as { products: { id: string; businessId: string }[] };
  expect(raxenBody.products.length).toBeGreaterThan(0);
  expect(raxenBody.products.every((p) => p.businessId === 'business-raxen')).toBeTruthy();
  expect(raxenBody.products.map((p) => p.id)).toContain(PROD_RAXEN);
  expect(raxenBody.products.map((p) => p.id)).not.toContain(PROD_DEFAULT);

  // Brand default: sebaliknya.
  const def = await page.request.get('/api/products?businessId=business-default', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(def.ok()).toBeTruthy();
  const defBody = (await def.json()) as { products: { id: string; businessId: string }[] };
  expect(defBody.products.every((p) => p.businessId === 'business-default')).toBeTruthy();
  expect(defBody.products.map((p) => p.id)).toContain(PROD_DEFAULT);
  expect(defBody.products.map((p) => p.id)).not.toContain(PROD_RAXEN);
});
