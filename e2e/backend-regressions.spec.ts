import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const scripts = [
  'test-stock-input.mts', 'test-session-security.mts', 'test-auth-security.mts',
  'test-response-security.mts', 'test-pii-security.mts', 'test-oauth-security.mts',
  'test-upload-security.mts', 'test-safe-fetch.mts', 'test-stock-lock.mts',
  'test-promotion-write-policy.mts', 'test-shopee-parser.unit.mts',
  'test-feedback-ui.mts', 'test-sdk-transport.mts',
  'test-stock-in-concurrency.integration.mts', 'test-stock-guard.integration.mts',
  'test-mapping-safety.integration.mts', 'test-master-products.integration.mts',
  'test-stock-opname.integration.mts', 'test-shopee-order-sync.integration.mts',
  'test-stock-push-queue.integration.mts', 'test-stock-movement.integration.mts',
  'test-stock-in-push.integration.mts', 'test-shopee-import.integration.mts',
  'test-shopee-products.integration.mts', 'test-inventory-settings.integration.mts',
  'test-phase-a-acceptance.integration.mts', 'test-phase-b-mismatch.integration.mts',
  'test-phase-b-retry.integration.mts', 'test-phase-b-shopee.integration.mts',
  'test-phase-c-kpi.integration.mts', 'test-phase-c-reports.integration.mts',
  'test-orphan-sku.integration.mts', 'test-null-variant.mts',
  'test-promotion-create.integration.mts',
];

for (const script of scripts) {
  test(`backend: ${script}`, async ({}, testInfo) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', path.join('scripts', script)], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 100_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        POSTGRES_ADMIN_URL: 'postgresql://udan@127.0.0.1:5432/postgres',
        POSTGRES_URL: 'postgresql://udan@127.0.0.1:5432/postgres',
        DATABASE_URL: 'postgresql://udan@127.0.0.1:5432/postgres',
        JWT_SECRET: 'maxius-local-regression-only-20261018',
        PII_ENC_KEY: 'ab'.repeat(32),
        TIKTOK_APP_KEY: 'local-fixture-key', TIKTOK_APP_SECRET: 'local-fixture-secret',
        SHOPEE_PARTNER_ID: '999888', SHOPEE_PARTNER_KEY: 'local-fixture-secret',
        AUTO_SYNC_DISABLED: 'true', SYNC_RETRY_DISABLED: 'true',
      },
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`;
    await testInfo.attach('backend-output', { body: output, contentType: 'text/plain' });
    expect(result.status, output).toBe(0);
  });
}
