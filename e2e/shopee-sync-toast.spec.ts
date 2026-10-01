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
  await page.getByRole('button', { name: /Sync Semua/ }).click();

  await expect(page.getByText('Sync selesai')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Toko Sukses: 12 item, 30 varian, 11 ter-cocok')).toBeVisible();
  await expect(page.getByText('undefined')).toHaveCount(0);
});

test('sync gagal per akun: toast error berisi nama toko + pesan Shopee', async ({ page }) => {
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
  await page.getByRole('button', { name: /Sync Semua/ }).click();

  await expect(page.getByText('Toko Gagal: [Shopee] API error')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Sync selesai')).toHaveCount(0);
});

test('accounts kosong: toast menjelaskan brand aktif tanpa akun Shopee', async ({ page }) => {
  await login(page);
  await stubSync(page, []);
  await page.goto('/products/marketplace/shopee');
  await page.getByRole('button', { name: /Sync Semua/ }).click();

  await expect(page.getByText('Brand aktif tidak punya akun Shopee')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Sync selesai')).toHaveCount(0);
});
