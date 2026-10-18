import { test, expect } from '@playwright/test';
import { sql, login } from './helpers';

const ROOT = '/Users/udan/Downloads/maxius-project/maxius-platform';
const SHOT = (n: string) => `${ROOT}/e2e/screenshots/stock-${n}.png`;
const SEED_ID = 'e2e-seed-oversell-001';
const ACCT_ID = 'e2e-stockpage-acct';
const MP_ID = 'e2e-stockpage-mp';
const VAR_ID = 'e2e-stockpage-var';
const VAR_ID_2 = 'e2e-stockpage-var-2';

test.beforeAll(() => {
  sql(
    `INSERT INTO "PlatformAccount" (id, platform, label, "businessId", "createdAt", "updatedAt") ` +
      `VALUES ('${ACCT_ID}','TIKTOK_SHOP','E2E StockPage Acct TMP','business-default',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "MasterProduct" (id, name, "businessId") ` +
      `VALUES ('${MP_ID}','E2E StockPage Master TMP','business-default') ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "ProductVariant" (id, sku, stock, "safetyStock", "masterProductId", "createdAt", "updatedAt") ` +
      `VALUES ('${VAR_ID}','E2E-STOCKPAGE-SKU',10,0,'${MP_ID}',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "ProductVariant" (id, sku, stock, "safetyStock", "masterProductId", "createdAt", "updatedAt") ` +
      `VALUES ('${VAR_ID_2}','E2E-STOCKPAGE-SKU-2',8,0,'${MP_ID}',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "SyncLog" (id, direction, kind, status, message, payload, "accountId", "createdAt") ` +
      `VALUES ('${SEED_ID}','in','central_stock_deduct','skipped','e2e seed oversell',` +
      `'{"orderId":"e2e-order-001","deductionsAttempted":[{"variantId":"${VAR_ID}","qty":2}]}',` +
      `'${ACCT_ID}',NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
});

test.afterAll(() => {
  sql(`DELETE FROM "SyncLog" WHERE id='${SEED_ID}';`);
  sql(`DELETE FROM "ProductVariant" WHERE id IN ('${VAR_ID}','${VAR_ID_2}');`);
  sql(`DELETE FROM "MasterProduct" WHERE id='${MP_ID}';`);
  sql(`DELETE FROM "PlatformAccount" WHERE id='${ACCT_ID}';`);
});

test('B: halaman Stok Varian end-to-end', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);

  // 1. Badge vs API langsung.
  const apiRes = await page.request.get('/api/inventory/stock?tab=all&limit=1');
  expect(apiRes.ok()).toBeTruthy();
  const apiCounts = ((await apiRes.json()) as { counts: Record<string, number> }).counts;

  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Atur Stok Gudang' })).toBeVisible({ timeout: 30_000 });
  for (const [tab, key] of [
    ['Semua Produk', 'all'],
    ['Habis', 'empty'],
    ['Stok Menipis', 'low'],
    ['Oversell', 'oversells'],
  ] as const) {
    const tabBtn = page.getByRole('button', { name: new RegExp(tab) });
    await expect(tabBtn).toBeVisible();
    await expect(tabBtn).toContainText(String(apiCounts[key]));
  }
  await page.screenshot({ path: SHOT('b1-tabs-badges') });

  // 2. Cari fixture lalu edit stok fisik dan cadangan langsung di baris.
  const search = page.getByPlaceholder('Cari SKU / nama varian / produk…');
  await search.fill('E2E-STOCKPAGE-SKU');
  await search.press('Enter');
  const firstRow = page.getByTestId(`inventory-row-${VAR_ID}`);
  const physicalInput = firstRow.getByLabel('Stok fisik E2E-STOCKPAGE-SKU', { exact: true });
  await expect(physicalInput).toHaveValue('10');
  await physicalInput.fill('11');
  const physicalSave = page.waitForResponse((response) =>
    response.url().includes(`/api/inventory/variants/${VAR_ID}/adjust`) && response.request().method() === 'POST',
    { timeout: 60_000 }
  );
  await physicalInput.press('Enter');
  expect((await physicalSave).ok()).toBeTruthy();
  await expect(physicalInput).toHaveValue('11', { timeout: 60_000 });
  await expect(page.getByText(/Stok fisik E2E-STOCKPAGE-SKU disimpan/)).toBeVisible({ timeout: 60_000 });

  const cadanganInput = firstRow.getByLabel('Stok cadangan E2E-STOCKPAGE-SKU', { exact: true });
  await cadanganInput.fill('1');
  await page.screenshot({ path: SHOT('b2-edit-cadangan-open') });
  await firstRow.getByRole('button', { name: 'Simpan stok cadangan e2e-stockpage-sku' }).click();
  await expect(cadanganInput).toHaveValue('1', { timeout: 15_000 });
  await page.screenshot({ path: SHOT('b3-edit-cadangan-saved') });

  // 3. Edit Batas Min inline + reset ke null (fallback *).
  const minCell = firstRow.locator('td').nth(8);
  await minCell.getByTitle(/Ubah batas minimum/).click();
  const minInput = minCell.locator('input[type="number"]');
  await minInput.fill('999');
  await minCell.getByRole('button', { name: 'Simpan' }).click();
  await expect(minCell).toContainText('999', { timeout: 15_000 });
  await page.screenshot({ path: SHOT('b4-edit-min-saved') });
  // reset: kosongkan -> ikut produk induk (tanda *)
  await minCell.getByTitle(/Ubah batas minimum/).click();
  await minCell.locator('input[type="number"]').fill('');
  const stockReload = page.waitForResponse((response) =>
    response.url().includes('/api/inventory/stock?') && response.request().method() === 'GET'
  );
  await minCell.getByRole('button', { name: 'Simpan' }).click();
  await stockReload;
  await expect(minCell).toContainText('*', { timeout: 15_000 });

  // 4. Edit massal dua varian, lalu pastikan kedua nilai berubah.
  await page.getByLabel('Pilih varian E2E-STOCKPAGE-SKU', { exact: true }).check();
  await page.getByLabel('Pilih varian E2E-STOCKPAGE-SKU-2', { exact: true }).check();
  const bulk = page.getByRole('region', { name: 'Aksi massal stok' });
  await expect(bulk).toContainText('2 varian dipilih');
  await bulk.getByLabel('Data yang diubah').selectOption('safetyStock');
  await bulk.getByLabel('Nilai baru').fill('2');
  await bulk.getByRole('button', { name: 'Terapkan' }).click();
  await expect(page.getByText('2 varian berhasil diperbarui. Sinkronisasi marketplace diproses.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId(`inventory-row-${VAR_ID}`).getByLabel('Stok cadangan E2E-STOCKPAGE-SKU', { exact: true })).toHaveValue('2');
  await expect(page.getByTestId(`inventory-row-${VAR_ID_2}`).getByLabel('Stok cadangan E2E-STOCKPAGE-SKU-2', { exact: true })).toHaveValue('2');
  await page.screenshot({ path: SHOT('b5-bulk-stock-saved') });

  // Kembalikan fixture agar uji dapat diulang.
  await page.getByLabel('Pilih varian E2E-STOCKPAGE-SKU', { exact: true }).check();
  await page.getByLabel('Pilih varian E2E-STOCKPAGE-SKU-2', { exact: true }).check();
  await page.getByRole('region', { name: 'Aksi massal stok' }).getByLabel('Nilai baru').fill('0');
  await page.getByRole('region', { name: 'Aksi massal stok' }).getByRole('button', { name: 'Terapkan' }).click();
  await physicalInput.fill('10');
  await physicalInput.press('Enter');

  // 5. Stok masuk/keluar cepat serta riwayat per varian.
  await firstRow.getByRole('button', { name: 'Masuk', exact: true }).click();
  let movementDialog = page.getByRole('dialog', { name: 'Stok Masuk' });
  await movementDialog.getByLabel('Jumlah').fill('2');
  await movementDialog.getByLabel('Catatan (opsional)').fill('Restok uji browser');
  await movementDialog.getByRole('button', { name: 'Simpan Stok Masuk' }).click();
  await expect(physicalInput).toHaveValue('12', { timeout: 20_000 });

  await firstRow.getByRole('button', { name: 'Keluar', exact: true }).click();
  movementDialog = page.getByRole('dialog', { name: 'Stok Keluar' });
  await movementDialog.getByLabel('Jumlah').fill('2');
  await movementDialog.getByLabel('Alasan').selectOption({ label: 'Barang rusak' });
  await movementDialog.getByRole('button', { name: 'Simpan Stok Keluar' }).click();
  await expect(physicalInput).toHaveValue('10', { timeout: 20_000 });

  await firstRow.getByLabel('Lihat riwayat stok E2E-STOCKPAGE-SKU').click();
  await expect(page.getByText('Pembelian atau restok — Restok uji browser')).toBeVisible();
  await expect(page.getByText('Barang rusak', { exact: true })).toBeVisible();
  await page.getByTitle('Tutup').click();

  // 6. Tab Oversell: tandai satu entri seed sebagai sudah ditangani.
  const oversellsTab = page.getByRole('button', { name: /Oversell/ });
  await oversellsTab.click();
  await expect(page.getByText('e2e seed oversell')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: SHOT('b6-oversells-before') });
  const seedRow = page.locator('tbody tr', { hasText: 'e2e seed oversell' });
  await seedRow.getByRole('button', { name: 'Tandai sudah ditangani' }).click();
  await expect(seedRow.getByText('Sudah ditangani')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: SHOT('b7-oversells-handled') });
  // seed dibiarkan handled; afterAll menghapus barisnya.
});
