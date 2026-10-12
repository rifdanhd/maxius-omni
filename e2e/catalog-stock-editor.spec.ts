import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('Katalog Pusat: edit stok varian dari daftar dan detail', async ({ page }) => {
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
  await page.route('**/api/inventory/variants/variant-stock-editor/adjust', async (route) => {
    const body = route.request().postDataJSON() as { newStock: number };
    product.variants[0].stock = body.newStock;
    await route.fulfill({ json: { ok: true, stockAfter: body.newStock } });
  });
  await page.route('**/api/inventory/variant/variant-stock-editor', async (route) => {
    const body = route.request().postDataJSON() as { safetyStock: number };
    product.variants[0].safetyStock = body.safetyStock;
    await route.fulfill({
      json: { safetyStock: body.safetyStock, minStock: null, minStockResolved: 4, notifyEmail: false },
    });
  });

  await login(page);
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Produk Master' })).toBeVisible({ timeout: 30_000 });

  const listPhysical = page.getByRole('spinbutton', { name: 'Stok fisik daftar SKU-EDITOR-1', exact: true });
  const listReserved = page.getByRole('spinbutton', { name: 'Stok cadangan daftar SKU-EDITOR-1', exact: true });
  await expect(listPhysical).toHaveValue('7');
  await expect(listReserved).toHaveValue('2');
  await expect(page.getByText('Tersedia 5', { exact: true })).toBeVisible();

  await listPhysical.fill('8');
  await listPhysical.press('Enter');
  await expect(page.getByText('Stok SKU-EDITOR-1 berhasil disimpan.')).toBeVisible();
  await expect(page.getByText('Tersedia 6', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Lihat 1 varian produk' }).click();
  const detailReserved = page.getByRole('spinbutton', { name: 'Stok cadangan detail SKU-EDITOR-1', exact: true });
  const detailRow = page.getByTestId('catalog-variant-variant-stock-editor');
  await expect(page.getByRole('spinbutton', { name: 'Stok fisik detail SKU-EDITOR-1', exact: true })).toHaveValue('8');
  await detailReserved.fill('3');
  await detailReserved.press('Enter');
  await expect(detailRow.locator('td').nth(5)).toHaveText('5');
  await expect(detailRow.getByText('Tersimpan', { exact: true })).toBeVisible();
  await expect(detailRow).toContainText('sinkronisasi marketplace diproses');
});
