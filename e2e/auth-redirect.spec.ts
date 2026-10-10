import { test, expect } from '@playwright/test';
import { login } from './helpers';

const SHOT = (n: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/auth-${n}.png`;

test('C1: cookie sesi invalid sejak awal -> langsung ke /login, tanpa admin panel', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'maxius_session', value: 'INVALID.EXPIRED.TEST', url: baseURL! }]);
  await page.goto('/dashboard');
  await page.waitForURL('**/login**', { timeout: 15_000 });
  expect(page.url()).toContain('/login');
  // Admin panel tidak boleh tampil: sidebar & konten dashboard absen.
  await expect(page.getByRole('heading', { name: 'Selamat Datang' })).toBeVisible();
  await page.screenshot({ path: SHOT('c1-invalid-redirected') });
});

test('C2: API 401 dari dalam halaman -> redirect /login?reason=session_expired', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 30_000 });
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Stok Varian' })).toBeVisible({
    timeout: 60_000,
  });
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Muat Ulang' }).click();
  await page.waitForURL('**/login**', { timeout: 30_000 });
  expect(page.url()).toContain('reason=session_expired');
  await expect(page.getByText('Sesi Anda berakhir, silakan login kembali.')).toBeVisible();
  await expect(page.getByPlaceholder('Masukkan username')).toBeVisible();
  await page.screenshot({ path: SHOT('c2-expired-message') });
});

test('C3: tanpa cookie sesi -> /login', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/dashboard');
  await page.waitForURL('**/login**', { timeout: 15_000 });
  expect(page.url()).toContain('/login');
  await page.screenshot({ path: SHOT('c3-no-token') });
});
