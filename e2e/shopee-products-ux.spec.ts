import { test, expect, type Page } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import jwt from 'jsonwebtoken';
import { sql } from './helpers';

const PATH = '/products/marketplace/shopee';
const API = '**/api/marketplace/shopee/products?*';
const title = 'Kaos Kaki Bola ANTI SLIP Panjang 60cm Dewasa Bahan Poliester Double Karet';
const shops = [{ id: 'shop-1', label: 'Toko Kaos Kaki' }, { id: 'shop-2', label: 'Toko Bola' }, { id: 'shop-3', label: '12345678' }];
const rows = Array.from({ length: 20 }, (_, index) => ({
  key: `shop-${index % 3 + 1}|${100 + index}`, accountId: shops[index % 3].id,
  accountLabel: shops[index % 3].label, platformProductId: String(100 + index),
  platformTitle: `${index === 0 ? title : `Produk ${index}`} ()`,
  variantId: index === 1 ? null : `variant-${index}`, status: 'NORMAL',
  channelSku: `SKU-${index}`, variantCount: index === 2 ? 5 : 1,
  stockTotal: index === 0 ? 0 : index === 1 ? 7 : index === 2 ? 1777764 : 10,
  imageUrl: null, lastSyncedAt: '2026-10-10T03:14:00.000Z',
  mappingStatus: index === 0 ? 'connected' : index === 1 ? 'unlinked' : index === 2 ? 'failed' : 'connected',
}));
let token: string;
const errors = new WeakMap<Page, string[]>();

test.beforeAll(() => {
  loadEnvConfig(process.cwd());
  const user = JSON.parse(sql(`SELECT json_build_object('id', id, 'tokenVersion', "tokenVersion") FROM "User" WHERE username='admin'`));
  token = jwt.sign({ sub: user.id, username: 'admin', businessId: 'business-default', tokenVersion: user.tokenVersion }, process.env.JWT_SECRET!, { expiresIn: '1h' });
});

test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page)!.push(error.message));
  await page.context().addCookies([{ name: 'maxius_session', value: token, url: 'http://localhost:3100', httpOnly: true }]);
  await page.route(API, async route => {
    const params = new URL(route.request().url()).searchParams;
    let filtered = rows.filter(row => !params.get('accountIds') || params.get('accountIds')!.split(',').includes(row.accountId));
    if (params.get('mapping') !== 'all') filtered = filtered.filter(row => row.mappingStatus === params.get('mapping'));
    if (params.get('search')) filtered = filtered.filter(row => row.platformTitle.includes(params.get('search')!));
    if (params.get('sort') === 'stock_asc') filtered = [...filtered].sort((a, b) => a.stockTotal - b.stockTotal);
    if (params.get('sort') === 'stock_desc') filtered = [...filtered].sort((a, b) => b.stockTotal - a.stockTotal);
    await route.fulfill({ json: { rows: filtered, total: filtered.length, page: 1, pageSize: 20,
      accounts: shops, counts: { all: filtered.length, active: filtered.length, out: 1 },
      lastSyncedAt: '2026-10-10T03:14:00.000Z', syncProductCount: 120 } });
  });
  await page.route('**/api/marketplace/shopee/products/sync', route => route.fulfill({ json: { ok: true, accounts: [{ accountId: 'shop-1', label: 'Toko Kaos Kaki', items: 1, models: 1, matched: 1 }] } }));
});

test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test('desktop: nama toko, judul, stok, sticky, sort, dan pencarian header', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(PATH);
  const products = page.getByTestId('shopee-product-row');
  await expect(products).toHaveCount(20);
  await expect(products.first()).toContainText(title);
  await expect(products.first()).not.toContainText('()');
  await expect(products.first()).toContainText('Toko Kaos Kaki');
  await expect(products.first()).toContainText('Terhubung');
  await expect(products.first()).toContainText('Habis');
  await expect(products.nth(1)).toContainText('Menipis');
  await expect(products.nth(2)).toContainText('1.777.764');
  await expect(products.nth(2)).toContainText('Gagal sinkron');
  await expect(products.nth(2)).toContainText('Nama toko belum diatur');
  await expect(products.first()).not.toContainText('Mapped');
  const search = page.getByRole('button', { name: 'Cari', exact: true });
  expect(await search.evaluate(el => {
    const icon = el.querySelector('svg')!.getBoundingClientRect();
    const text = el.querySelector('span')!.getBoundingClientRect();
    return text.left >= icon.right;
  })).toBe(true);
  await search.click();
  await expect(page.getByPlaceholder('Cari menu atau tindakan...')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('columnheader', { name: 'Stok' }).getByRole('button').click();
  await expect(page.getByRole('columnheader', { name: 'Stok' })).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('columnheader', { name: 'Stok' }).getByRole('button').click();
  await expect(products.first()).toContainText('1.777.764');
  const scroll = page.getByTestId('shopee-table-scroll');
  const before = await products.first().locator('td').nth(1).boundingBox();
  await scroll.evaluate(el => { el.scrollLeft = 350; el.scrollTop = 250; });
  const after = await products.first().locator('td').nth(1).boundingBox();
  expect(Math.abs(before!.x - after!.x)).toBeLessThan(2);
  expect(await scroll.locator('thead th').nth(1).evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await scroll.evaluate(el => { el.scrollLeft = 0; el.scrollTop = 0; });
  await page.locator('#content').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: 'test-results/shopee-desktop.png', fullPage: true });
});

test('aksi satu produk dan bulk hanya mengirim pilihan serta mencegah klik ganda', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const bodies: unknown[] = [];
  await page.route('**/api/marketplace/shopee/products/sync', async route => {
    bodies.push(route.request().postDataJSON());
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ json: { ok: true, accounts: [{ accountId: 'shop-1', label: 'Toko Kaos Kaki', items: 1, models: 1, matched: 1 }] } });
  });
  await page.goto(PATH);
  let first = page.getByTestId('shopee-product-row').first();
  await first.getByRole('button', { name: /^Aksi/ }).click();
  await page.getByRole('menuitem', { name: 'Lihat detail' }).click();
  await expect(page.getByRole('dialog')).toContainText('ID produk');
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Atur mapping' })).toHaveAttribute('href', /accountId=shop-1&channelSku=SKU-0/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await first.getByRole('button', { name: /^Aksi/ }).click();
  await page.getByRole('menuitem', { name: 'Sinkron produk ini' }).click();
  await expect(page.getByRole('button', { name: 'Menyinkronkan...' })).toBeDisabled();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toEqual({ products: [{ accountId: 'shop-1', productId: '100' }] });
  await page.getByRole('button', { name: /^Notifikasi/ }).click();
  await expect(page.getByRole('dialog', { name: 'Pusat notifikasi' })).toContainText('Sinkron selesai');
  await page.keyboard.press('Escape');
  await expect(first).toBeVisible();
  await first.getByRole('checkbox').check();
  await page.getByTestId('shopee-product-row').nth(1).getByRole('checkbox').check();
  await expect(page.getByRole('region', { name: 'Aksi produk terpilih' })).toContainText('2 produk dipilih');
  await page.getByRole('button', { name: 'Sinkron terpilih', exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual({ products: [{ accountId: 'shop-1', productId: '100' }, { accountId: 'shop-2', productId: '101' }] });
});

test('multi toko, mapping, konfirmasi dan dialog impor dapat digunakan dengan keyboard', async ({ page }) => {
  await page.goto(PATH);
  await page.getByRole('button', { name: 'Filter Toko/Akun' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Toko Kaos Kaki/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /Toko Bola/ }).click();
  await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Toko/Akun: 2 toko dipilih' })).toBeVisible();
  await page.getByLabel('Filter status mapping').selectOption('unlinked');
  await expect(page.getByTestId('shopee-product-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Perbarui Data', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('2 toko');
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  await page.getByRole('button', { name: 'Impor dari Shopee', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Impor produk dari Shopee');
  await expect(page.getByRole('dialog').locator('input[type=checkbox]:checked')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const width of [320, 390, 767]) {
  test(`mobile ${width}px: kartu, preferensi tersimpan, tema gelap dan fokus`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PATH);
    await expect(page.getByTestId('shopee-product-card')).toHaveCount(20);
    await expect(page.getByTestId('shopee-table-scroll')).toBeHidden();
    await page.getByRole('button', { name: 'Ringkas', exact: true }).click();
    await page.getByLabel('Ambang stok menipis').fill('15');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Ringkas', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Ambang stok menipis')).toHaveValue('15');
    await page.getByRole('button', { name: 'Ubah tema', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Gelap', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    const first = page.getByTestId('shopee-product-card').first();
    await first.getByRole('checkbox').check();
    await expect(page.getByRole('region', { name: 'Aksi produk terpilih' })).toContainText('1 produk dipilih');
    await first.getByRole('button', { name: /^Aksi/ }).click();
    await page.getByRole('menuitem', { name: 'Lihat detail' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(first.getByRole('button', { name: /^Aksi/ })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/shopee-${width}-dark.png`, fullPage: true });
  });
}

test('skeleton, pesan error dengan coba lagi, dan kondisi kosong', async ({ page }) => {
  let mode = 'loading';
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(API, async route => {
    if (mode === 'loading') await gate;
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: 'Koneksi terputus. Coba lagi.' } });
    return route.fulfill({ json: { rows: [], total: 0, accounts: mode === 'empty' ? [] : shops, counts: {}, syncProductCount: 0 } });
  });
  await page.goto(PATH);
  await expect(page.getByLabel('Memuat produk Shopee')).toBeVisible();
  mode = 'error'; release();
  await expect(page.getByRole('alert').filter({ hasText: 'Produk belum dapat dimuat' })).toBeVisible();
  mode = 'empty';
  await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Hubungkan toko Shopee', exact: true })).toBeVisible();
});
