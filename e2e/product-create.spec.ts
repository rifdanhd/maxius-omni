import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { sql, login } from './helpers';

const SHOT = (n: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/product-create-${n}.png`;

// Jalur pembuatan produk yang BENAR-BENAR ada di UI (menu "Tambah Produk Baru"
// → "Buat produk satuan manual" masih disabled/"Segera hadir"): form
// "Tambah Mapping" di /products/mapping membuat produk + varian + mapping
// dalam satu POST /api/inventory/mappings.
const ACCT = 'e2e-prod-acct';
const STAMP = Date.now().toString().slice(-8);
const NAME = `Kaos Kaki E2E ${STAMP}`;
const CHANNEL_SKU = `E2E-CH-${STAMP}`;
const VARIANT_SKU = `${CHANNEL_SKU}-A`;

test.beforeAll(() => {
  sql(
    `INSERT INTO "PlatformAccount" (id, platform, label, "businessId", "createdAt", "updatedAt") ` +
      `VALUES ('${ACCT}','TIKTOK_SHOP','E2E Produk Toko','business-default',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
});

test.afterAll(() => {
  // FK-safe: mapping → varian → produk → toko (stock ledger cascade via varian).
  sql(`DELETE FROM "ProductMapping" WHERE "channelSku" = '${CHANNEL_SKU}';`);
  sql(`DELETE FROM "ProductVariant" WHERE sku = '${VARIANT_SKU}';`);
  sql(`DELETE FROM "MasterProduct" WHERE name = '${NAME}';`);
  sql(`DELETE FROM "PlatformAccount" WHERE id = '${ACCT}';`);
});

test('produk baru: buat via form mapping → muncul di /products → tetap ada setelah reload', async ({
  page,
}) => {
  await login(page);

  // 1. Form Tambah Mapping — mode "varian baru".
  await page.goto('/products/mapping');
  await expect(page.getByRole('heading', { name: 'Mapping Stok Terpusat' })).toBeVisible({
    timeout: 30_000,
  });
  const tokoSelect = page.locator('select').first();
  await tokoSelect.selectOption(ACCT);
  await page.getByPlaceholder('mis. TTS3-BLK-A').fill(CHANNEL_SKU);
  // Default = "Pakai varian yang sudah ada" (tercentang) → matikan untuk mode baru.
  const useExisting = page
    .locator('label')
    .filter({ hasText: 'Pakai varian yang sudah ada' })
    .locator('input[type="checkbox"]');
  await useExisting.uncheck();
  await expect(page.getByPlaceholder('mis. Kaos kaki polos hitam')).toBeVisible();
  await page.getByPlaceholder('mis. Kaos kaki polos hitam').fill(NAME);
  await page.getByPlaceholder('pakai channel SKU bila kosong').fill(VARIANT_SKU);
  const numberInputs = page.locator('input[type="number"]');
  await numberInputs.nth(0).fill('7'); // Stok Awal
  await numberInputs.nth(1).fill('2'); // Stok Aman
  await page.screenshot({ path: SHOT('form') });

  await page.getByRole('button', { name: 'Simpan Hubungan (Mapping)' }).click();

  // 2. Sukses: mapping masuk ke daftar, form dikosongkan, tidak ada error.
  // pakai cell exact — channel SKU juga muncul di option select varian target.
  await expect(page.getByRole('cell', { name: CHANNEL_SKU, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Gagal menyimpan mapping.')).toHaveCount(0);
  await expect(page.getByPlaceholder('mis. TTS3-BLK-A')).toHaveValue('');
  await page.screenshot({ path: SHOT('saved') });

  // 3. Produk tampil di /products lengkap dengan varian + stok efektif.
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Produk Master' })).toBeVisible({
    timeout: 30_000,
  });
  const search = page.getByPlaceholder(/Cari nama produk, SKU, atau SKU marketplace/);
  await search.fill(NAME);
  // debounce pencarian 300ms — tunggu benar-benar tersaring (1 baris) dulu,
  // kalau tidak assertion "Lihat 1 varian produk" kena strict-mode (banyak baris).
  await expect(page.locator('tbody tr')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText(NAME)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Lihat 1 varian produk/ })).toBeVisible();
  await page.getByRole('button', { name: /^Lihat 1 varian produk/ }).click();
  await expect(page.getByText(VARIANT_SKU).first()).toBeVisible();
  // Stok efektif = 7 − stok aman 2 = 5; kolom menampilkan fisik aslinya.
  await expect(page.getByText('(fisik 7)').first()).toBeVisible();
  await page.screenshot({ path: SHOT('products-list') });

  // 4. Reload — data persisten, bukan sekadar state di memori.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Produk Master' })).toBeVisible({
    timeout: 30_000,
  });
  await search.fill(NAME);
  await expect(page.locator('tbody tr')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText(NAME)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Lihat 1 varian produk/ })).toBeVisible();
  await page.screenshot({ path: SHOT('after-reload') });

  // 5. Konsistensi UI ↔ DB (bukan hanya assertion di layar).
  expect(sql(`SELECT COUNT(*) FROM "MasterProduct" WHERE name = '${NAME}';`)).toBe('1');
  expect(sql(`SELECT COUNT(*) FROM "ProductVariant" WHERE sku = '${VARIANT_SKU}';`)).toBe('1');
  expect(
    sql(
      `SELECT COUNT(*) FROM "ProductMapping" WHERE "channelSku" = '${CHANNEL_SKU}' AND "accountId" = '${ACCT}';`
    )
  ).toBe('1');
});

test('validasi form mapping: toko & channel SKU wajib diisi', async ({ page }: { page: Page }) => {
  await login(page);
  await page.goto('/products/mapping');
  await expect(page.getByRole('heading', { name: 'Mapping Stok Terpusat' })).toBeVisible({
    timeout: 30_000,
  });
  let requested = false;
  await page.route('**/api/inventory/mappings', (route) => {
    if (route.request().method() === 'POST') {
      requested = true;
      return route.abort();
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Simpan Hubungan (Mapping)' }).click();
  await expect(page.getByText('Pilih toko dan isi channel SKU.')).toBeVisible();
  expect(requested).toBe(false);
  await page.screenshot({ path: SHOT('validation') });
});
