import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

async function mockSession(page: Page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    json: { businessId: 'e2e-business', user: { username: 'admin', role: 'ADMIN' } },
  }));
}

test('notifikasi masuk ke lonceng dan error penghalang tampil sebagai banner tanpa toast', async ({ page }) => {
  await page.route('**/api/stock-alerts', (route) => route.fulfill({ json: { alerts: [], reminder: null } }));
  await page.route('**/api/sync-jobs?*', (route) => route.fulfill({ json: { rows: [], nextCursor: null } }));
  await page.route('**/api/stores', (route) => route.fulfill({ json: [] }));
  await mockSession(page);
  await login(page);

  await page.evaluate(() => {
    const occurredAt = new Date().toISOString();
    window.dispatchEvent(new CustomEvent('maxius:notification', {
      detail: {
        variant: 'error',
        notification: {
          id: 'local:e2e-error',
          source: 'local',
          fingerprint: 'e2e-error',
          severity: 'error',
          title: 'Sinkron gagal',
          description: 'Koneksi toko perlu diperbarui.',
          href: '/dashboard',
          occurredAt,
        },
      },
    }));
  });

  await expect(page.locator('[data-app-inline-notification]')).toContainText('Koneksi toko perlu diperbarui.');
  await expect(page.getByRole('button', { name: /Notifikasi, 1 belum dibaca/ })).toBeVisible();
  await expect(page.locator('[data-sonner-toaster]')).toHaveCount(0);

  await page.getByRole('button', { name: /Notifikasi, 1 belum dibaca/ }).click();
  await expect(page.getByLabel('Pusat notifikasi')).toContainText('Sinkron gagal');
  await page.getByRole('button', { name: 'Tandai semua dibaca' }).click();
  await expect(page.getByRole('button', { name: 'Notifikasi' })).toBeVisible();

  await page.evaluate(() => {
    const occurredAt = new Date().toISOString();
    window.dispatchEvent(new CustomEvent('maxius:notification', {
      detail: {
        variant: 'success',
        notification: {
          id: 'local:e2e-success', source: 'local', fingerprint: 'success:e2e-success', severity: 'info',
          title: 'Berhasil', description: 'Stok tersimpan.', href: '/dashboard', occurredAt,
        },
      },
    }));
  });
  await expect(page.getByLabel('Pusat notifikasi')).toContainText('Stok tersimpan.');
  await expect(page.getByRole('button', { name: 'Notifikasi' })).toBeVisible();
});
