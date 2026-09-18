import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'child_process';

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

// DB dev lokal = Postgres (POSTGRES_URL). ON_ERROR_STOP agar seed gagal
// terdengar (bukan diam-diam lanjut dengan data kosong).
function sql(q: string) {
  // execFileSync + args: tanpa shell, supaya kutip SQL utuh.
  return execFileSync(
    'psql',
    ['-h', 'localhost', '-U', 'udan', '-d', 'maxius_dev', '-v', 'ON_ERROR_STOP=1', '-tAc', q],
    { encoding: 'utf8' }
  ).trim();
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill('admin');
  await page.getByPlaceholder('••••••••').fill('admin123');
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
  await page.goto('/products/mapping');
  await expect(page.getByRole('heading', { name: 'Mapping Stok Terpusat' })).toBeVisible({ timeout: 30_000 });

  // Baris varian seed (SKU unik).
  const row = page.locator('tbody tr', { hasText: SKU }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('0');

  // 1. Buka form Barang Masuk & isi qty 2.
  await row.getByRole('button', { name: 'Barang Masuk' }).click();
  const form = page.getByText(/Barang Masuk: E2E StockIn Master TMP/);
  await expect(form).toBeVisible();
  await page.screenshot({ path: SHOT('1-form-open') });

  await page.locator('input[type="number"]').last().fill('2');
  await page.getByText(/Catatan/).locator('..').locator('input[type="text"]').first().fill('e2e restock');

  // 2. Catat → stok berubah jadi 2.
  await page.getByRole('button', { name: 'Catat' }).click();
  await expect(row).toContainText('2', { timeout: 15_000 });

  // 3. Riwayat Stok memuat baris STOCK_IN +2.
  await page.getByRole('button', { name: 'Riwayat Stok' }).click();
  await expect(page.getByText('Riwayat Stok (stock_ledger)')).toBeVisible({ timeout: 15_000 });
  const ledgerRow = page.locator('tbody tr', { hasText: SKU }).filter({ hasText: 'STOCK_IN' }).first();
  await expect(ledgerRow).toBeVisible({ timeout: 15_000 });
  await expect(ledgerRow).toContainText('+2');
  await page.screenshot({ path: SHOT('2-ledger') });
});
