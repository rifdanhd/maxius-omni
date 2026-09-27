import { test, expect } from '@playwright/test';
import { login, sql, SHOT } from './helpers';

test('F0: verifikasi runtime halaman Stok Mismatch + tombol Retry', async ({ page }) => {
  await login(page);

  const navLink = page.getByRole('link', { name: 'Stok Mismatch' });
  if (!(await navLink.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Inventori', exact: true }).click();
  }
  await expect(navLink).toBeVisible();

  const found = sql(
    `SELECT m."variantId" || '|' || m."accountId" || '|' || m."channelSku"
     FROM "ProductMapping" m WHERE m."variantId" IS NOT NULL LIMIT 1`
  );
  const [variantId, accountId, channelSku] = found.split('|');
  expect(variantId).toBeTruthy();

  sql(
    `INSERT INTO "SyncJob" (id,"channelSku","newSellable",status,"retryCount","lastError","accountId","variantId","createdAt","updatedAt")
     VALUES ('e2e-mismatch-verify','${channelSku}',0,'FAILED',3,'fixture: push gagal (e2e)','${accountId}','${variantId}',now(),now())
     ON CONFLICT DO NOTHING`
  );

  await page.goto('/inventory/mismatch');
  await expect(page.getByRole('heading', { name: 'Stok Mismatch' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mismatch', exact: true })).toBeVisible();
  await expect(page.getByText(channelSku).first()).toBeVisible();
  await expect(page.getByText('fixture: push gagal (e2e)')).toBeVisible();

  await page.screenshot({ path: SHOT('f0-mismatch-page.png'), fullPage: true });

  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText(/Retry (berhasil|selesai)/)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: SHOT('f0-mismatch-retry.png'), fullPage: true });
});
