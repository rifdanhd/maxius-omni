import { defineConfig } from '@playwright/test';

/**
 * Konfigurasi minimal untuk spec e2e di ./e2e.
 * - baseURL localhost:3000; dev server dipakai ulang bila sudah jalan
 *   (reuseExistingServer) agar cocok dengan alur kerja manual yang lama.
 * - Chromium headless (cache browser: ~/Library/Caches/ms-playwright).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
