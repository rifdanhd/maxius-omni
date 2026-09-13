import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const SHOT = (n: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/auth-${n}.png`;

async function login(page: Page, username = 'admin', password = 'admin123') {
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill(username);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  // waitUntil commit: tahan terhadap pantulan load pasca-login.
  await page.waitForURL('/', { timeout: 30_000, waitUntil: 'commit' });
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 60_000 });
}

test('C1: token invalid sejak awal -> langsung ke /login, tanpa admin panel', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'INVALID.EXPIRED.TEST');
    localStorage.setItem('username', 'testghost');
  });
  await page.goto('/');
  await page.waitForURL('**/login**', { timeout: 15_000 });
  expect(page.url()).toContain('/login');
  // Admin panel tidak boleh tampil: sidebar & konten dashboard absen.
  await expect(page.getByRole('heading', { name: 'Selamat Datang' })).toBeVisible();
  await page.screenshot({ path: SHOT('c1-invalid-redirected') });
});

test('C2: API 401 dari dalam halaman -> redirect /login?reason=session_expired', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 30_000 });
  // Buka /inventory DULU saat token masih valid (layout mount + konten tampil),
  // baru rusak token lalu picu fetch ASLI aplikasi (tombol Muat Ulang ->
  // authFetch -> 401 -> handleUnauthorized).
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Stok Varian' })).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(() => localStorage.setItem('token', 'INVALID.EXPIRED.TEST'));
  await page.getByRole('button', { name: 'Muat Ulang' }).click();
  await page.waitForURL('**/login**', { timeout: 30_000 });
  expect(page.url()).toContain('reason=session_expired');
  await expect(page.getByText('Sesi Anda berakhir, silakan login kembali.')).toBeVisible();
  await expect(page.getByPlaceholder('Masukkan username')).toBeVisible();
  await page.screenshot({ path: SHOT('c2-expired-message') });
});

test('C3: tanpa token sama sekali -> /login', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForURL('**/login**', { timeout: 15_000 });
  expect(page.url()).toContain('/login');
  await page.screenshot({ path: SHOT('c3-no-token') });
});
