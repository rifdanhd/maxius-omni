import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Toast tombol "Sync Semua" (Produk Marketplace › Shopee).
 *
 * Respons /api/marketplace/shopee/products/sync memakai field
 * label/items/models/matched/error — tiga kasus wajib tampil benar:
 * sukses, error per akun, dan accounts kosong.
 */
const SYNC_GLOB = '**/api/marketplace/shopee/products/sync*';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/marketplace/shopee/products?*', route => route.fulfill({
    json: { rows: [], total: 0, accounts: [{ id: 'acc-1', label: 'Toko Sukses' }], counts: {}, syncProductCount: 100 },
  }));
});

async function confirmSync(page: Page) {
  await page.getByRole('button', { name: 'Perbarui Data', exact: true }).click();
  await page.getByRole('button', { name: 'Perbarui sekarang', exact: true }).click();
}

async function stubSync(page: Page, accounts: unknown[]): Promise<void> {
  await page.route(SYNC_GLOB, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, accounts }),
    })
  );
}

test('sync sukses: toast memakai items/models/matched, tanpa "undefined"', async ({ page }) => {
  await login(page);
  await stubSync(page, [
    { accountId: 'acc-1', label: 'Toko Sukses', items: 12, models: 30, matched: 11 },
  ]);
  await page.goto('/products/marketplace/shopee');
  await confirmSync(page);

  await page.getByRole('button', { name: /^Notifikasi/ }).click();
  const toast = page.getByRole('dialog', { name: 'Pusat notifikasi' });
  await expect(toast).toContainText('Sinkron selesai. 11 varian diperbarui.', { timeout: 15_000 });
  await expect(page.locator('[data-app-toast]')).toHaveCount(0);
  await expect(page.getByText('undefined')).toHaveCount(0);
});

test('sync gagal per akun: pesan manusiawi dengan detail Shopee tersembunyi', async ({ page }) => {
  await login(page);
  await stubSync(page, [
    {
      accountId: 'acc-2',
      label: 'Toko Gagal',
      items: 0,
      models: 0,
      matched: 0,
      error: '[Shopee] API error (error_auth_permission_denied): token expired | req-1',
    },
  ]);
  await page.goto('/products/marketplace/shopee');
  await confirmSync(page);

  const toast = page.locator('[data-app-inline-notification]');
  await expect(toast).toContainText('Koneksi toko perlu diperbarui', { timeout: 15_000 });
  await expect(toast.locator('pre')).not.toBeVisible();
  await toast.getByText('Lihat detail', { exact: true }).click();
  await expect(toast.locator('pre')).toContainText('Toko Gagal: [Shopee] API error');
  await expect(page.locator('[data-app-toast="success"]')).toHaveCount(0);
});

test('accounts kosong: toast menjelaskan brand aktif tanpa akun Shopee', async ({ page }) => {
  await login(page);
  await stubSync(page, []);
  await page.goto('/products/marketplace/shopee');
  await confirmSync(page);

  await expect(page.locator('[data-app-inline-notification]')).toContainText('Bisnis aktif belum memiliki toko Shopee', { timeout: 15_000 });
  await expect(page.locator('[data-app-toast="success"]')).toHaveCount(0);
});
