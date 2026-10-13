import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

async function mockSession(page: Page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    json: { businessId: 'e2e-business', user: { username: 'admin', role: 'ADMIN' } },
  }));
}

function activity(overrides: Record<string, unknown>) {
  return {
    id: 'promo-default',
    accountId: 'shop-default',
    externalActivityId: 'EXT-DEFAULT',
    title: 'Promo Default',
    activityType: 'DIRECT_DISCOUNT',
    status: 'ONGOING',
    productLevel: 'PRODUCT',
    durationType: null,
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-10-20T00:00:00.000Z',
    sourceCreatedAt: '2026-10-01T00:00:00.000Z',
    sourceUpdatedAt: null,
    lastConfirmedAt: '2026-10-12T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    account: { id: 'shop-default', label: 'Toko Default', platform: 'SHOPEE' },
    items: [],
    ...overrides,
  };
}

test('Promosi menampilkan data terbaru dan dapat difilter berdasarkan marketplace, status, dan tanggal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/marketplace/tiktok/promotions?*', (route) => route.fulfill({
    json: {
      ok: true,
      source: 'marketplace_api',
      isExample: false,
      supportedPlatforms: ['SHOPEE', 'TIKTOK_SHOP'],
      activities: [
        activity({ id: 'older', title: 'Promo Shopee Lama', externalActivityId: 'OLD', sourceCreatedAt: '2026-10-01T00:00:00.000Z' }),
        activity({
          id: 'newer', title: 'Promo TikTok Terbaru', externalActivityId: 'NEW',
          startsAt: '2026-10-12T00:00:00.000Z', sourceCreatedAt: '2026-10-12T00:00:00.000Z',
          account: { id: 'tiktok-1', label: 'Toko TikTok', platform: 'TIKTOK_SHOP' },
        }),
        activity({
          id: 'upcoming', title: 'Promo Akan Datang', externalActivityId: 'NEXT', status: 'NOT_START',
          startsAt: '2026-10-18T00:00:00.000Z', endsAt: '2026-10-25T00:00:00.000Z',
          sourceCreatedAt: '2026-10-13T00:00:00.000Z',
          account: { id: 'tiktok-1', label: 'Toko TikTok', platform: 'TIKTOK_SHOP' },
        }),
      ],
    },
  }));
  await page.route('**/api/marketplace/tiktok/promotions/alerts', (route) => route.fulfill({ json: { alerts: [] } }));
  await mockSession(page);
  await login(page);
  await page.goto('/promotions', { waitUntil: 'commit' });

  const rows = page.locator('tbody > tr');
  await expect(rows.nth(0)).toContainText('Promo TikTok Terbaru');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Filter marketplace promosi').selectOption('SHOPEE');
  await expect(page.getByText('Promo Shopee Lama')).toBeVisible();
  await expect(page.getByText('Promo TikTok Terbaru')).toHaveCount(0);

  await page.getByLabel('Filter marketplace promosi').selectOption('ALL');
  await page.getByLabel('Tanggal akhir promosi').fill('2026-10-05');
  await expect(page.getByText('Promo Shopee Lama')).toBeVisible();
  await expect(page.getByText('Promo TikTok Terbaru')).toHaveCount(0);

  await page.getByRole('button', { name: /Akan Datang/ }).click();
  await page.getByRole('button', { name: 'Reset Filter' }).click();
  await expect(page.getByText('Promo Akan Datang')).toBeVisible();
  await expect(page.getByText('Integrasi promosi Tokopedia masih menunggu akses API.')).toBeVisible();
});
