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
}

export function dbInfo(): E2eDb {
  if (!fs.existsSync(MARKER)) {
    throw new Error(
      'Marker .e2e-db.json tidak ada — jalankan e2e lewat `npx playwright test` (webServer scripts/e2e-dev.mts).'
    );
  }
  return JSON.parse(fs.readFileSync(MARKER, 'utf8')) as E2eDb;
}

/** baseURL dev server e2e (port dipakai bersama dengan playwright.config.ts). */
export function baseUrl(): string {
  return `http://localhost:${dbInfo().port}`;
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
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  await page.waitForURL('/dashboard', { timeout: 90_000, waitUntil: 'commit' });
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 60_000 });
}

export const SHOT = (name: string) =>
  `/Users/udan/Downloads/maxius-project/maxius-platform/e2e/screenshots/${name}.png`;
