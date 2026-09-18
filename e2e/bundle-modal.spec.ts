import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'child_process';

const ROOT = '/Users/udan/Downloads/maxius-project/maxius-platform';
const SHOT = (n: string) => `${ROOT}/e2e/screenshots/bundle-${n}.png`;
const BUNDLE_NAME = `Paket Duo Kaos Kaki (E2E ${Date.now()})`;

function sql(q: string) {
  return execFileSync(
    'psql',
    ['-h', 'localhost', '-U', 'udan', '-d', 'maxius_dev', '-v', 'ON_ERROR_STOP=1', '-tAc', q],
    { encoding: 'utf8' }
  ).trim();
}

// Fixture komponen: 2 master single + 1 varian masing-masing (mandiri,
// tidak tergantung data dev lain).
test.beforeAll(() => {
  for (const [mp, v, sku] of [
    ['e2e-bundle-mp-1', 'e2e-bundle-var-1', 'E2E-BUNDLE-1'],
    ['e2e-bundle-mp-2', 'e2e-bundle-var-2', 'E2E-BUNDLE-2'],
  ]) {
    sql(
      `INSERT INTO "MasterProduct" (id, name, "businessId") ` +
        `VALUES ('${mp}',${
          mp.endsWith('1')
            ? "'Kaos kaki polos hitam (E2E TMP)'"
            : "'Kaos kaki motif garis (E2E TMP)'"
        },'business-default') ON CONFLICT (id) DO NOTHING;`
    );
    sql(
      `INSERT INTO "ProductVariant" (id, sku, stock, "safetyStock", "masterProductId", "createdAt", "updatedAt") ` +
        `VALUES ('${v}','${sku}',10,0,'${mp}',NOW(),NOW()) ON CONFLICT (id) DO NOTHING;`
    );
  }
});

test.afterAll(() => {
  // Hapus bundle hasil test + fixture (bundle tidak punya varian sendiri;
  // hapus via nama unik; item ikut cascade).
  sql(`DELETE FROM "MasterProduct" WHERE name = '${BUNDLE_NAME}';`);
  for (const v of ['e2e-bundle-var-1', 'e2e-bundle-var-2']) {
    sql(`DELETE FROM "ProductVariant" WHERE id='${v}';`);
  }
  for (const mp of ['e2e-bundle-mp-1', 'e2e-bundle-mp-2']) {
    sql(`DELETE FROM "MasterProduct" WHERE id='${mp}';`);
  }
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill('admin');
  await page.getByPlaceholder('••••••••').fill('admin123');
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  await page.waitForURL('/dashboard', { timeout: 30_000, waitUntil: 'commit' });
}

async function openBundleModal(page: Page) {
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Produk Master' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Tambah Produk Baru/ }).click();
  await expect(page.getByText('Tambah Produk Bundle')).toBeVisible();
  await page.screenshot({ path: SHOT('dropdown') });
  await page.getByText('Tambah Produk Bundle').click();
  await expect(page.getByRole('heading', { name: 'Tambah Produk Bundle' })).toBeVisible();
}

test('dropdown menampilkan 4 opsi (2 aktif, 2 segera-hadir)', async ({ page }) => {
  await login(page);
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Produk Master' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Tambah Produk Baru/ }).click();
  await expect(page.getByText('Tambah Produk Bundle')).toBeVisible();
  await expect(page.getByText('Tambah dari Marketplace')).toBeVisible();
  await expect(page.getByText('Segera hadir').first()).toBeVisible();
  await page.screenshot({ path: SHOT('dropdown') });
});

test('validasi: submit tanpa nama & tanpa komponen diblokir di frontend', async ({ page }) => {
  await login(page);
  await openBundleModal(page);
  let requested = false;
  await page.route('**/api/products/bundle', (route) => {
    requested = true;
    return route.continue();
  });
  await page.getByRole('button', { name: 'Simpan bundle' }).click();
  await expect(page.getByText('Nama bundle wajib diisi.')).toBeVisible();
  expect(requested).toBe(false);
  await page.getByPlaceholder(/Paket Hemat/).fill('Tanpa Komponen');
  await page.getByRole('button', { name: 'Simpan bundle' }).click();
  await expect(page.getByText('Tambahkan minimal 1 varian komponen.')).toBeVisible();
  expect(requested).toBe(false);
  await page.screenshot({ path: SHOT('validation') });
});

test('E2E: buat bundle 2 komponen → toast + tab Bundle', async ({ page }) => {
  await login(page);
  await openBundleModal(page);
  await page.getByPlaceholder(/Paket Hemat/).fill(BUNDLE_NAME);

  // Komponen 1: Kaos kaki polos hitam
  await page.getByPlaceholder(/Cari varian/).fill('polos hitam');
  await page.getByRole('button', { name: /Kaos kaki polos hitam/ }).first().click();
  // Komponen 2: Kaos kaki motif garis
  await page.getByPlaceholder(/Cari varian/).fill('motif garis');
  await page.getByRole('button', { name: /Kaos kaki motif garis/ }).first().click();
  await expect(page.getByText('Komponen (2)')).toBeVisible();
  await page.screenshot({ path: SHOT('form-filled') });

  await page.getByRole('button', { name: 'Simpan bundle' }).click();
  // Catatan: pakai string literal (substring match), BUKAN RegExp — nama bundle
  // mengandung kurung literal "(...)" yang berarti grup di sintaks RegExp.
  await expect(page.getByText(`Produk bundle "${BUNDLE_NAME}" berhasil dibuat`)).toBeVisible({
    timeout: 30_000,
  });
  // Modal tertutup + tab Bundle aktif + produk muncul
  await expect(page.getByRole('heading', { name: 'Tambah Produk Bundle' })).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(BUNDLE_NAME).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: SHOT('created') });
});
