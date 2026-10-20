import { defineConfig } from '@playwright/test';

/**
 * Konfigurasi screenshot TikTok Shop Partner Center — INSTANS LOKAL.
 *
 * Memakai infrastruktur e2e: webServer scripts/e2e-dev.mts membuat DB Postgres
 * terisolasi (maxius_test_e2e_*), seed dummy, lalu next dev -p 3100.
 *
 * `env` webServer MENETRALKAN kredensial partner asli dari .env: Next hanya
 * mengisi env yang belum ada di process.env, jadi nilai dummy ini menimpa
 * TIKTOK/SHOPEE asli — server e2e tidak pernah memakai kredensial nyata.
 *
 * Jalankan: npx playwright test -c playwright.partner.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /partner-center-screenshots\.spec\.ts/,
  timeout: 720_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/partner-center',
  use: {
    baseURL: 'http://localhost:3100',
    extraHTTPHeaders: { Origin: 'http://localhost:3100' },
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'retain-on-failure',
    locale: 'id-ID',
  },
  webServer: {
    command: 'npx tsx scripts/e2e-dev.mts',
    url: 'http://localhost:3100',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...process.env,
      // Kredensial partner asli dari .env diganti dummy (lihat komentar atas).
      TIKTOK_APP_KEY: 'E2E-NO-OP',
      TIKTOK_APP_SECRET: 'E2E-NO-OP',
      SHOPEE_PARTNER_ID: 'E2E-NO-OP',
      SHOPEE_PARTNER_KEY: 'E2E-NO-OP',
    },
  },
});
