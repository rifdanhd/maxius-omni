/**
 * Helper bersama untuk spec e2e.
 *
 * Semua akses DB lewat `.e2e-db.json` (ditulis scripts/e2e-dev.mts) — JANGAN
 * hardcode `maxius_dev`: dev server e2e sengaja memakai database terisolasi.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { expect, type Page } from '@playwright/test';
import { TEST_ADMIN_PASSWORD } from '../scripts/lib/e2e-credentials';

export { TEST_ADMIN_PASSWORD };

const ROOT = path.resolve(__dirname, '..');
const MARKER = path.join(ROOT, '.e2e-db.json');

export interface E2eDb {
  name: string;
  url: string;
  port: string;
  origin?: string;
}

export function dbInfo(): E2eDb {
  if (!fs.existsSync(MARKER)) {
    throw new Error(
      'Marker .e2e-db.json tidak ada — jalankan e2e lewat `npx playwright test` (webServer scripts/e2e-dev.mts).'
    );
  }
  const info = JSON.parse(fs.readFileSync(MARKER, 'utf8')) as E2eDb;
  const url = new URL(info.url);
  if (!/^maxius_test_e2e_[a-z0-9_]+$/.test(info.name)
      || !['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.pathname !== `/${info.name}`
      || [...url.searchParams.keys()].some((key) => /^(host|hostaddr|service)$/i.test(key))) {
    throw new Error('E2E hanya boleh memakai database maxius_test_e2e_* lokal yang dibuat sesi pengujian.');
  }
  return info;
}

/** baseURL dev server e2e (port dipakai bersama dengan playwright.config.ts). */
export function baseUrl(): string {
  const info = dbInfo();
  return info.origin ?? `http://localhost:${info.port}`;
}

/** Eksekusi SQL mentah di DB e2e (ON_ERROR_STOP, hasil trim). */
export function sql(query: string): string {
  const db = dbInfo();
  return execFileSync(
    'psql',
    [db.url, '-v', 'ON_ERROR_STOP=1', '-tAc', query],
    { encoding: 'utf8' }
  ).trim();
}

/** Login UI lengkap sampai dashboard siap. */
export async function login(page: Page, username = 'admin', password = TEST_ADMIN_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill(username);
  await page.getByPlaceholder('••••••••').fill(password);
  const submit = async () => {
    const response = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/auth/login' && res.request().method() === 'POST');
    await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
    return response;
  };
  let response = await submit();
  if (response.status() === 429) {
    const seconds = Number(response.headers()['retry-after'] ?? 60);
    await page.waitForTimeout(Math.min(60, Math.max(1, Number.isFinite(seconds) ? seconds : 60)) * 1000);
    response = await submit();
  }
  expect(response.status(), 'Login pengujian harus berhasil').toBe(200);
  await page.waitForURL('/dashboard', { timeout: 90_000, waitUntil: 'commit' });
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 60_000 });
}

export const SHOT = (name: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/${name}.png`;
