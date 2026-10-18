import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { sql, TEST_ADMIN_PASSWORD } from './helpers';

/**
 * [E2E] Form "Barang Masuk" (stock-in) di halaman Mapping — Daftar Varian.
 *
 * Seed 1 varian khusus (stok 0) via sqlite, lalu:
 *  1. Buka form Barang Masuk, isi qty +2, catat.
 *  2. Stok tampil 2; Riwayat Stok memuat baris STOCK_IN +2.
 *  3. afterAll menghapus varian + master + ledger seed (DB kembali bersih).
 */

const ROOT = '/Users/udan/Downloads/maxius-project/maxius-platform';
const SHOT = (n: string) => `${ROOT}/e2e/screenshots/stock-in-${n}.png`;
const MP_ID = 'e2e-stockin-mp';
const VAR_ID = 'e2e-stockin-var';
const SKU = 'E2E-STOCKIN-SKU';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill('admin');
  await page.getByPlaceholder('••••••••').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  await page.waitForURL('/dashboard', { timeout: 30_000, waitUntil: 'commit' });
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(() => {
  sql(
    `INSERT INTO "MasterProduct" (id, name, "businessId") ` +
      `VALUES ('${MP_ID}','E2E StockIn Master TMP','business-default') ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "ProductVariant" (id, sku, stock, "safetyStock", "masterProductId", "createdAt", "updatedAt") ` +
      `VALUES ('${VAR_ID}','${SKU}',0,0,'${MP_ID}',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
});

test.afterAll(() => {
  sql(`DELETE FROM "StockLedger" WHERE "variantId"='${VAR_ID}';`);
  sql(`DELETE FROM "ProductVariant" WHERE id='${VAR_ID}';`);
  sql(`DELETE FROM "MasterProduct" WHERE id='${MP_ID}';`);
});

test('Barang Masuk: +2 tercatat ke stok & ledger STOCK_IN', async ({ page }) => {
  await login(page);
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Atur Stok Gudang' })).toBeVisible({ timeout: 30_000 });
  const search = page.getByPlaceholder('Cari SKU / nama varian / produk…');
  await search.fill(SKU);
  await search.press('Enter');

  // Baris varian seed (SKU unik).
  const row = page.locator('tbody tr', { hasText: SKU }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('0');

  // 1. Buka form Barang Masuk & isi qty 2.
  await row.getByRole('button', { name: 'Masuk', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Stok Masuk' });
  await expect(form).toBeVisible();
  await page.screenshot({ path: SHOT('1-form-open') });

  await form.getByLabel('Jumlah').fill('2');
  await form.getByLabel('Catatan (opsional)').fill('e2e restock');

  // 2. Catat → stok berubah jadi 2.
  await form.getByRole('button', { name: 'Simpan Stok Masuk' }).click();
  await expect(row.getByLabel(`Stok fisik ${SKU}`, { exact: true })).toHaveValue('2');

  // 3. Riwayat Stok memuat baris STOCK_IN +2.
  await row.getByLabel(`Lihat riwayat stok ${SKU}`).click();
  const ledgerRow = page.locator('tbody tr').filter({ hasText: 'e2e restock' }).first();
  await expect(ledgerRow).toBeVisible({ timeout: 15_000 });
  await expect(ledgerRow).toContainText('+2');
  expect(sql(`SELECT stock FROM "ProductVariant" WHERE id='${VAR_ID}';`)).toBe('2');
  expect(sql(`SELECT COUNT(*) FROM "StockLedger" WHERE "variantId"='${VAR_ID}' AND "changeQty"=2;`)).toBe('1');
  await page.screenshot({ path: SHOT('2-ledger') });
});
