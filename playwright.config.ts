import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Konfigurasi e2e ./e2e.
 *
 * DB & server: `scripts/e2e-dev.mts` membuat database Postgres terisolasi
 * (maxius_test_e2e_*), me-seed-nya, lalu menjalankan `next dev -p 3100`
 * dengan POSTGRES_URL ke DB tsb. Spec membaca URL tsb dari `.e2e-db.json`.
 * Jadi tiap run e2e mulai dari DB bersih dan TIDAK menyentuh `maxius_dev`.
 */
const ROOT = __dirname;
const MARKER = path.join(ROOT, '.e2e-db.json');
const PORT = 3100;
const production = process.env.E2E_SERVER_MODE === 'production';
const origin = `${production ? 'https' : 'http'}://localhost:${PORT}`;

/** Jangan mengambil alih server atau database milik sesi lain. */
function assertNoExistingRun(): void {
  // Config ini juga di-load di PROSES WORKER (Playwright memuat config di tiap
  // worker). Marker server yang aktif hanya diperiksa proses utama.
  if (process.env.TEST_WORKER_INDEX !== undefined || process.env.JEST_WORKER_ID !== undefined) {
    return;
  }
  if (!fs.existsSync(MARKER)) return;
  throw new Error('Sesi E2E sebelumnya belum dibersihkan. Proses dan database tidak dihapus otomatis.');
}

assertNoExistingRun();

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'backend-regressions.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '.next-e2e/qa/browser-results.json' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
    ignoreHTTPSErrors: production,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx tsx scripts/e2e-dev.mts',
    url: origin,
    ignoreHTTPSErrors: production,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
