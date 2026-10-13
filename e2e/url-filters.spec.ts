import { expect, test } from '@playwright/test';
import { login } from './helpers';

async function keepSessionReady(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    json: {
      businessId: 'e2e-business',
      user: { username: 'admin', role: 'ADMIN' },
    },
  }));
}

test('Katalog Pusat memulihkan filter dari URL dan dapat di-reset', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/products*', (route) => route.fulfill({
    json: {
      products: [{
        id: 'product-filter', name: 'Kaos Filter', category: 'Aksesoris', threshold: 5,
        imageUrl: null, isActive: true, type: 'single', bundleItems: [],
        variants: [{
          id: 'variant-filter', sku: 'SKU-FILTER', stock: 7, safetyStock: 2, minStock: null,
          mappings: [{ id: 'mapping-filter', channelSku: 'SHOP-SKU', account: { id: 'shop-1', label: 'Toko Satu', platform: 'SHOPEE' } }],
        }],
      }],
    },
  }));
  await keepSessionReady(page);
  await login(page);
  await page.goto('/products?q=Kaos&category=Aksesoris&platform=SHOPEE&store=shop-1&stock=low&sort=stock_asc', { waitUntil: 'commit' });

  await expect(page.getByLabel('Filter kategori')).toHaveValue('Aksesoris', { timeout: 60_000 });
  await expect(page.getByLabel('Filter marketplace')).toHaveValue('SHOPEE');
  await expect(page.getByLabel('Filter toko')).toHaveValue('shop-1');
  await expect(page.getByText('Kategori: Aksesoris ×')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page).toHaveURL(/\/products$/);
});

test('Inventori mengirim filter URL ke API dan menampilkan chip aktif', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requested: string[] = [];
  await page.route('**/api/inventory/stock?*', (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      json: {
        rows: [], nextCursor: null,
        counts: { all: 0, empty: 0, low: 0, oversells: 0 },
        filters: {
          categories: ['Aksesoris'],
          accounts: [{ id: 'shop-1', label: 'Toko Satu', platform: 'SHOPEE' }],
        },
      },
    });
  });
  await keepSessionReady(page);
  await login(page);
  await page.goto('/inventory?q=kaos&category=Aksesoris&platform=SHOPEE&store=shop-1&sort=stock_asc', { waitUntil: 'commit' });

  await expect(page.getByLabel('Filter kategori inventori')).toHaveValue('Aksesoris', { timeout: 60_000 });
  await expect(page.getByText('Toko: Toko Satu ×')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => requested.some((url) => url.includes('category=Aksesoris') && url.includes('account=shop-1'))).toBe(true);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
});

test('Pesanan memulihkan marketplace, toko, kategori, dan tanggal dari URL', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requested: string[] = [];
  await page.route('**/api/orders?*', (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      json: {
        orders: [], total: 0, page: 1, pageSize: 1000, pageCount: 1, counts: {}, statuses: [],
        filters: {
          accounts: [{ id: 'shop-1', label: 'Toko Satu', platform: 'SHOPEE' }],
          categories: ['Aksesoris'],
        },
      },
    });
  });
  await page.route('**/api/orders/sync/status', (route) => route.fulfill({ json: { runs: [] } }));
  await keepSessionReady(page);
  await login(page);
  await page.goto('/orders?q=ORD-1&platform=SHOPEE&account=shop-1&category=Aksesoris&from=2026-10-01&to=2026-10-12', { waitUntil: 'commit' });

  await expect(page.getByLabel('Filter marketplace pesanan')).toHaveValue('SHOPEE', { timeout: 60_000 });
  await expect(page.getByLabel('Filter toko pesanan')).toHaveValue('shop-1');
  await expect(page.getByLabel('Filter kategori pesanan')).toHaveValue('Aksesoris');
  await expect(page.getByText('Mulai: 2026-10-01 ×')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => requested.some((url) => url.includes('account=shop-1') && url.includes('category=Aksesoris'))).toBe(true);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page).toHaveURL(/\/orders$/);
});
