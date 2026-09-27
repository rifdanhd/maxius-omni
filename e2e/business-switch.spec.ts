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

test('GAP: komponen BrandSwitcher tidak dipasang di layout manapun', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 30_000 });
  // components/layout/BrandSwitcher.tsx sudah ada & fungsinya benar, tapi tidak
  // pernah di-import di header/sidebar/layout → pengguna TIDAK BISA ganti brand
  // lewat UI. Bila suatu saat dipasang, hapus assertion ini dan uji klik-nya.
  await expect(page.getByTitle('Ganti brand')).toHaveCount(0);
  await page.screenshot({ path: SHOT('no-switcher') });
});

// BUG (belum diperbaiki): GET /api/products mengabaikan req.businessId —
// semua brand melihat produk brand lain (kebocoran lintas brand; saat ini tidak
// terlihat karena hanya brand default yang punya produk).
// Root cause: app/api/products/route.ts GET tidak memfilter
// `where: { businessId: req.businessId }` padahal kolom MasterProduct.businessId
// ada dan route lain (mis. /api/inventory/mappings) sudah benar.
// Ganti `test.fixme` → `test` setelah route-nya di-filter.
test.fixme('daftar produk ter-scoping brand aktif', async ({ page }) => {
  await login(page);
  const res = await page.request.get('/api/products?businessId=business-raxen');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { products: { businessId: string }[] };
  expect(body.products.every((p) => p.businessId === 'business-raxen')).toBeTruthy();
});
