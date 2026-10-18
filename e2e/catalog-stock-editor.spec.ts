import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('Katalog Pusat: stok hanya dibaca dan perubahan diarahkan ke Stok Varian', async ({ page }) => {
  const product = {
    id: 'product-stock-editor',
    name: 'Produk Uji Editor Stok',
    threshold: 4,
    imageUrl: null,
    isActive: true,
    type: 'single',
    variants: [
      {
        id: 'variant-stock-editor',
        sku: 'SKU-EDITOR-1',
        stock: 7,
        safetyStock: 2,
        minStock: null,
        mappings: [],
      },
    ],
    bundleItems: [],
  };

  await page.route('**/api/products*', (route) =>
    route.fulfill({ json: { products: [product] } })
  );
  let stockWrites = 0;
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/api\/inventory\/.+variant/.test(request.url())) stockWrites++;
  });

  await login(page);
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Produk Master' })).toBeVisible({ timeout: 30_000 });

  const listPhysical = page.getByRole('spinbutton', { name: 'Stok fisik daftar SKU-EDITOR-1', exact: true });
  const listReserved = page.getByRole('spinbutton', { name: 'Stok cadangan daftar SKU-EDITOR-1', exact: true });
  await expect(listPhysical).toHaveCount(0);
  await expect(listReserved).toHaveCount(0);
  await expect(page.getByText('Tersedia 5', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Lihat 1 varian produk' }).click();
  const detailReserved = page.getByRole('spinbutton', { name: 'Stok cadangan detail SKU-EDITOR-1', exact: true });
  const detailRow = page.getByTestId('catalog-variant-variant-stock-editor');
  await expect(page.getByRole('spinbutton', { name: 'Stok fisik detail SKU-EDITOR-1', exact: true })).toHaveCount(0);
  await expect(detailReserved).toHaveCount(0);
  await expect(detailRow.locator('td').nth(3)).toHaveText('7');
  await expect(detailRow.locator('td').nth(4)).toHaveText('2');
  await expect(detailRow.locator('td').nth(5)).toHaveText('5');
  await expect(detailRow.getByRole('link', { name: 'Kelola di Stok Varian' })).toHaveAttribute('href', '/inventory');
  expect(stockWrites).toBe(0);
});
