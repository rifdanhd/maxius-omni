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

test('modal Tambah Marketplace: 2 kartu (Shopee logo resmi + TikTok Shop), sisanya dihapus', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings/accounts');
  await expect(
    page.getByRole('heading', { name: 'Tambahkan Semua Toko Marketplace kamu' })
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Tambahkan Marketplace' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih Marketplace' })).toBeVisible();

  // Lazada, Blibli, Shopify & WooCommerce sudah dihapus dari modal.
  for (const name of ['Lazada', 'Blibli', 'Shopify', 'WooCommerce']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }

  // Hanya 2 kartu: Shopee + TikTok Shop.
  for (const name of ['Shopee', 'TikTok Shop']) {
    // exact: false — kartu TikTok membawa <img alt="TikTok Shop"> sehingga
    // accessible name-nya jadi "TikTok Shop TikTok Shop".
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  // Shopee: ikon = logo brand asli (path fill #EE4D2D), bukan ikon lucide.
  await expect(
    page.getByRole('button', { name: 'Shopee' }).locator('svg path[fill="#EE4D2D"]')
  ).toBeVisible();
  await page.screenshot({ path: SHOT('modal') });

  // Shopee: app ISV sudah approved → TANPA konfirmasi, langsung navigasi ke
  // authorize (OAuth di-intercept agar test tidak keluar ke shopee.com).
  await page.route('**/api/auth/shopee/authorize*', async (route) => {
    await route.fulfill({
      status: 302,
      headers: { location: '/settings/accounts?success=e2e-oauth-intercepted' },
      body: '',
    });
  });
  const urlSebelum = page.url();
  await page.getByRole('button', { name: 'Shopee' }).click();
  await expect(page.getByText('Yakin authorize toko Shopee?')).toHaveCount(0);
  await page.waitForURL('**/settings/accounts?success=e2e-oauth-intercepted', { timeout: 15_000 });
  expect(page.url()).not.toBe(urlSebelum);
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
