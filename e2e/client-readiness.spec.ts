import { test, expect } from '@playwright/test';
import { login } from './helpers';

const routes = [
  '/dashboard', '/inventory', '/inventory/history', '/inventory/mismatch',
  '/inventory/settings', '/inventory/opname', '/products', '/products/mapping',
  '/products/prices', '/products/images', '/products/copy',
  '/products/marketplace/shopee', '/products/marketplace/tiktok',
  '/orders', '/orders/returns', '/promotions', '/promotions/create',
  '/reports/sales', '/reports/stock', '/settings/accounts', '/settings/account',
  '/apps/api-connections', '/logs', '/education',
];

for (const width of [320, 390, 1280]) {
  test(`kesiapan layar ${width}px: semua halaman utama tanpa crash, 5xx, atau overflow`, async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    await page.setViewportSize({ width, height: 900 });
    const runtimeErrors: string[] = [];
    const failedResponses: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 500 && new URL(response.url()).pathname.startsWith('/api/')) {
        failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    await login(page);
    const dimensions: { route: string; viewport: number; document: number }[] = [];
    for (const route of routes) {
      const response = await page.goto(route, { waitUntil: 'networkidle' });
      expect(response?.status(), route).toBe(200);
      await expect(page.locator('#content')).toBeVisible();
      const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      dimensions.push({ route, ...size });
      expect.soft(size.document, `Halaman melebar: ${route}`).toBeLessThanOrEqual(size.viewport + 1);
      expect.soft(runtimeErrors, `Crash pada ${route}`).toEqual([]);
      expect.soft(failedResponses, `API gagal pada ${route}`).toEqual([]);
      if (['/dashboard', '/inventory', '/settings/accounts'].includes(route)) {
        await page.screenshot({ path: testInfo.outputPath(`${route.slice(1).replaceAll('/', '-')}-${width}.png`), fullPage: true });
      }
    }
    await testInfo.attach('responsive-dimensions', { body: JSON.stringify(dimensions, null, 2), contentType: 'application/json' });
  });
}
