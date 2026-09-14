import { test, expect } from '@playwright/test';

/**
 * [E2E] Dashboard analytics — guard untuk bug duplicate React key "unknown".
 *
 * Latar: /api/analytics pernah mengirim topProducts dengan key "unknown"
 * berulang (item order yang belum di-mapping ke Produk Master semuanya
 * digulung jadi key literal "unknown") → React warning
 * "Encountered two children with the same key, `unknown`".
 *
 * Sekarang key = `${variantId}|${channelSku}` (kolom GROUP BY sesungguhnya),
 * jadi unik by construction. Spec ini memastikan:
 *  1. Tidak ada console error duplikat key saat dashboard dirender.
 *  2. Panel "Produk Terjual Teratas" tampil dengan nama produk (bukan
 *     literal "unknown").
 */

const SHOT = (n: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/dashboard-analytics-${n}.png`;

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill('admin');
  await page.getByPlaceholder('••••••••').fill('admin123');
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  await page.waitForURL('/', { timeout: 30_000, waitUntil: 'commit' });
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 60_000 });
}

test('Dashboard: tidak ada duplicate React key di panel Produk Terjual Teratas', async ({ page }) => {
  const keyErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Encountered two children with the same key/i.test(msg.text())) {
      keyErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    if (/Encountered two children with the same key/i.test(err.message)) {
      keyErrors.push(err.message);
    }
  });

  await login(page);

  // Section Analisis Bisnis dirender setelah data analytics masuk.
  await expect(page.getByText('Produk Terjual Teratas')).toBeVisible({ timeout: 30_000 });

  // Bila ada penjualan pada periode ini, nama produk tidak boleh "unknown".
  const panel = page.locator('div', { has: page.getByText('Produk Terjual Teratas') }).last();
  const hasEmpty = await panel.getByText('Belum ada penjualan pada periode ini.').count();
  if (hasEmpty === 0) {
    await expect(panel.getByText('unknown', { exact: true })).toHaveCount(0);
  }

  expect(keyErrors, keyErrors.join('\n')).toHaveLength(0);
  await page.screenshot({ path: SHOT('no-duplicate-keys'), fullPage: true });
});
