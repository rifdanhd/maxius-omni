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

test('SKU master: hitungan aktif, dialog stok, aksi massal, dan arsip', async ({ page }) => {
  await login(page);
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Stok Varian', exact: true })).toBeVisible();
  const api = await page.request.get('/api/inventory/master-stock?limit=1');
  expect(api.ok()).toBeTruthy();
  const counts = (await api.json()).counts;
  for (const [label, key] of [['Semua', 'all'], ['Habis', 'empty'], ['Menipis', 'low'], ['Oversell', 'oversells']] as const) {
    await expect(page.getByRole('tab', { name: new RegExp(label) })).toContainText(Number(counts[key]).toLocaleString('id-ID'));
  }
  await page.getByLabel('Cari SKU atau nama produk').fill('E2E-STOCKPAGE-SKU');
  const row = page.getByTestId('master-stock-row').filter({ hasText: 'E2E-STOCKPAGE-SKU' }).first();
  await expect(page.getByTestId('master-stock-row')).toHaveCount(2);
  await row.getByRole('button', { name: 'Ubah stok', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Simpan perubahan' })).toBeDisabled();
  await dialog.getByLabel('Stok fisik akhir').fill('11');
  await dialog.getByLabel('Disisihkan di gudang ini').fill('1');
  await dialog.getByLabel('Alasan wajib').fill('Opname uji SKU master');
  await dialog.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => sql(`SELECT stock || ':' || "safetyStock" FROM "ProductVariant" WHERE id='${VAR_ID}';`)).toBe('11:1');
  await page.getByLabel('Pilih semua SKU di halaman ini').check();
  await page.getByRole('button', { name: 'Ubah stok (2)', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Stok fisik akhir').fill('20');
  await dialog.getByLabel('Disisihkan di gudang ini').fill('2');
  await dialog.getByLabel('Alasan wajib').fill('Koreksi massal uji browser');
  await dialog.getByRole('button', { name: 'Simpan perubahan' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => sql(`SELECT COUNT(*) FROM "ProductVariant" WHERE id IN ('${VAR_ID}','${VAR_ID_2}') AND stock=20 AND "safetyStock"=2;`)).toBe('2');
  await page.getByRole('button', { name: 'Rincian E2E-STOCKPAGE-SKU', exact: true }).click();
  await page.getByRole('button', { name: 'Arsipkan SKU', exact: true }).click();
  await expect(page.getByTestId('master-stock-row')).toHaveCount(1);
  await page.getByLabel(/Tampilkan arsip/).check();
  await expect(page.getByTestId('master-stock-row')).toHaveCount(2);
  await expect(page.getByText('Arsip / nonaktif', { exact: true })).toBeVisible();
  await page.screenshot({ path: SHOT('sku-master-dialog-bulk-archive') });
});
