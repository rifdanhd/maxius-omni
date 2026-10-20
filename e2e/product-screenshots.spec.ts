import { test } from '@playwright/test';
import { login } from './helpers';

/**
 * Snapshot produk: foto tiap halaman fitur sesuai daftar menu Sidebar.
 * Jalankan lewat `npx playwright test product-screenshots.spec.ts` —
 * webServer e2e-dev.mts menyediakan dev server + DB terisolasi berisi data seed.
 */
const ROOT = '/Users/udan/Downloads/maxius-project/maxius-platform';
const SHOT = (n: string) => `${ROOT}/e2e/screenshots/product-${n}.png`;

const PAGES: Array<{ file: string; route: string }> = [
  { file: '01-dashboard', route: '/dashboard' },
  { file: '02-orders', route: '/orders' },
  { file: '03-orders-returns', route: '/orders/returns' },
  { file: '04-products', route: '/products' },
  { file: '05-products-mapping', route: '/products/mapping' },
  { file: '06-products-prices', route: '/products/prices' },
  { file: '07-products-images', route: '/products/images' },
  { file: '08-products-copy', route: '/products/copy' },
  { file: '09-inventory', route: '/inventory' },
  { file: '10-inventory-mismatch', route: '/inventory/mismatch' },
  { file: '11-inventory-settings', route: '/inventory/settings' },
  { file: '12-inventory-opname', route: '/inventory/opname' },
  { file: '13-inventory-history', route: '/inventory/history' },
  { file: '14-promotions', route: '/promotions' },
  { file: '15-reports-sales', route: '/reports/sales' },
  { file: '16-reports-stock', route: '/reports/stock' },
  { file: '17-settings-accounts', route: '/settings/accounts' },
  { file: '18-education', route: '/education' },
];

test('snapshot semua halaman fitur', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  for (const { file, route } of PAGES) {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Beri waktu data & grafik (recharts) selesai dirender.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: SHOT(file), fullPage: true });
  }
});
