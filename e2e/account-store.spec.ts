import { test, expect } from '@playwright/test';
import { sql, login } from './helpers';

const SHOT = (n: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/account-store-${n}.png`;

const ACCT = 'e2e-account-store';
const LABEL = 'E2E Toko Akun Management';

test.beforeAll(() => {
  // Akun tanpa accessToken → status "Terputus" (offline; penambahan toko asli
  // hanya lewat OAuth marketplace, tidak ada form manual).
  sql(
    `INSERT INTO "PlatformAccount" (id, platform, label, "businessId", "createdAt", "updatedAt") ` +
      `VALUES ('${ACCT}','TIKTOK_SHOP','${LABEL}','business-default',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
});

test.afterAll(() => {
  sql(`DELETE FROM "PlatformAccount" WHERE id = '${ACCT}';`);
});

test('daftar toko: baris tampil dengan platform, status & brand yang benar', async ({ page }) => {
  await login(page);
  await page.goto('/settings/accounts');
  await expect(
    page.getByRole('heading', { name: 'Tambahkan Semua Toko Marketplace kamu' })
  ).toBeVisible({ timeout: 30_000 });
  // Tab default = Integrasi (komponen StoreIntegration).
  await expect(page.getByRole('button', { name: 'Integrasi' })).toBeVisible();

  const row = page.locator('tr', { hasText: LABEL });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('TikTok Shop');
  await expect(row).toContainText('Terputus'); // tanpa token
  await expect(row).toContainText('Maxius'); // businessName dari brand aktif
  await page.screenshot({ path: SHOT('list') });
});

test('modal Tambah Marketplace: 6 kartu, Lazada "segera hadir", Shopee wajib konfirmasi', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings/accounts');
  await expect(
    page.getByRole('heading', { name: 'Tambahkan Semua Toko Marketplace kamu' })
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Tambahkan Marketplace' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih Marketplace' })).toBeVisible();

  // 4 marketplace + 2 online store.
  for (const name of ['Shopee', 'Lazada', 'TikTok Shop', 'Blibli', 'Shopify', 'WooCommerce']) {
    // exact: false — kartu TikTok membawa <img alt="TikTok Shop"> sehingga
    // accessible name-nya jadi "TikTok Shop TikTok Shop".
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  await page.screenshot({ path: SHOT('modal') });

  // Shopee: app ISV belum live → muncul konfirmasi, BATAL tidak menavigasi.
  await page.getByRole('button', { name: 'Shopee' }).click();
  await expect(page.getByText('Yakin authorize toko Shopee?')).toBeVisible();
  const urlSebelum = page.url();
  await page.getByRole('button', { name: 'Batal' }).click();
  await expect(page.getByText('Yakin authorize toko Shopee?')).toHaveCount(0);
  expect(page.url()).toBe(urlSebelum);

  // Lazada: integrasi belum tersedia → toast, tanpa navigasi.
  await page.getByRole('button', { name: 'Lazada' }).click();
  await expect(page.getByText('Integrasi Lazada segera hadir')).toBeVisible();
  expect(page.url()).toBe(urlSebelum);
  await page.screenshot({ path: SHOT('toast-lazada') });
});

test('hapus toko lewat UI: konfirmasi → baris hilang → data terhapus dari DB', async ({ page }) => {
  await login(page);
  await page.goto('/settings/accounts');
  await expect(
    page.getByRole('heading', { name: 'Tambahkan Semua Toko Marketplace kamu' })
  ).toBeVisible({ timeout: 30_000 });

  const row = page.locator('tr', { hasText: LABEL });
  await expect(row).toBeVisible({ timeout: 30_000 });
  expect(sql(`SELECT COUNT(*) FROM "PlatformAccount" WHERE id = '${ACCT}';`)).toBe('1');

  // window.confirm + alert sama-sama ditangani (auto-accept).
  page.on('dialog', (d) => d.accept());
  await row.getByTitle('Hapus').click();

  await expect(page.locator('tr', { hasText: LABEL })).toHaveCount(0, { timeout: 30_000 });
  expect(sql(`SELECT COUNT(*) FROM "PlatformAccount" WHERE id = '${ACCT}';`)).toBe('0');
  await page.screenshot({ path: SHOT('deleted') });
});
