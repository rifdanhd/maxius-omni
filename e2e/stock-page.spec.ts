import { test, expect, request as baseRequest } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'child_process';

const ROOT = '/Users/udan/Downloads/maxius-project/maxius-platform';
const SHOT = (n: string) => `${ROOT}/e2e/screenshots/stock-${n}.png`;
const SEED_ID = 'e2e-seed-oversell-001';
const ACCT_ID = 'e2e-stockpage-acct';
const MP_ID = 'e2e-stockpage-mp';
const VAR_ID = 'e2e-stockpage-var';

function sql(q: string) {
  return execFileSync(
    'psql',
    ['-h', 'localhost', '-U', 'udan', '-d', 'maxius_dev', '-v', 'ON_ERROR_STOP=1', '-tAc', q],
    { encoding: 'utf8' }
  ).trim();
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill('admin');
  await page.getByPlaceholder('••••••••').fill('admin123');
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  await page.waitForURL('/dashboard', { timeout: 30_000, waitUntil: 'commit' });
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 60_000 });
}

async function apiToken(): Promise<string> {
  const ctx = await baseRequest.newContext({ baseURL: 'http://localhost:3000' });
  const res = await ctx.post('/api/auth/login', {
    data: { username: 'admin', password: 'admin123' },
  });
  const body = await res.json();
  await ctx.dispose();
  return body.token as string;
}

test.beforeAll(() => {
  sql(
    `INSERT INTO "PlatformAccount" (id, platform, label, "businessId", "createdAt", "updatedAt") ` +
      `VALUES ('${ACCT_ID}','TIKTOK_SHOP','E2E StockPage Acct TMP','business-default',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "MasterProduct" (id, name, "businessId") ` +
      `VALUES ('${MP_ID}','E2E StockPage Master TMP','business-default') ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "ProductVariant" (id, sku, stock, "safetyStock", "masterProductId", "createdAt", "updatedAt") ` +
      `VALUES ('${VAR_ID}','E2E-STOCKPAGE-SKU',10,0,'${MP_ID}',NOW(),NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "SyncLog" (id, direction, kind, status, message, payload, "accountId", "createdAt") ` +
      `VALUES ('${SEED_ID}','in','central_stock_deduct','skipped','e2e seed oversell',` +
      `'{"orderId":"e2e-order-001","deductionsAttempted":[{"variantId":"${VAR_ID}","qty":2}]}',` +
      `'${ACCT_ID}',NOW()) ` +
      `ON CONFLICT (id) DO NOTHING;`
  );
});

test.afterAll(() => {
  sql(`DELETE FROM "SyncLog" WHERE id='${SEED_ID}';`);
  sql(`DELETE FROM "ProductVariant" WHERE id='${VAR_ID}';`);
  sql(`DELETE FROM "MasterProduct" WHERE id='${MP_ID}';`);
  sql(`DELETE FROM "PlatformAccount" WHERE id='${ACCT_ID}';`);
});

test('B: halaman Stok Varian end-to-end', async ({ page }) => {
  await login(page);

  // 1. Badge vs API langsung.
  const token = await apiToken();
  const apiRes = await fetch('http://localhost:3000/api/inventory/stock?tab=all&limit=1', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const apiCounts = ((await apiRes.json()) as { counts: Record<string, number> }).counts;

  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Stok Varian' })).toBeVisible({ timeout: 30_000 });
  for (const [tab, key] of [
    ['Semua Produk', 'all'],
    ['Habis', 'empty'],
    ['Stok Menipis', 'low'],
    ['Oversells', 'oversells'],
  ] as const) {
    const tabBtn = page.getByRole('button', { name: new RegExp(tab) });
    await expect(tabBtn).toBeVisible();
    await expect(tabBtn).toContainText(String(apiCounts[key]));
  }
  await page.screenshot({ path: SHOT('b1-tabs-badges') });

  // 2. Edit Cadangan inline (baris pertama) + revert.
  const firstRow = page.locator('tbody tr').first();
  const cadanganCell = firstRow.locator('td').nth(2);
  const oldVal = Number((await cadanganCell.innerText()).trim());
  await cadanganCell.getByTitle('Ubah cadangan').click();
  const cadanganInput = cadanganCell.locator('input[type="number"]');
  await cadanganInput.fill(String(oldVal + 1));
  await page.screenshot({ path: SHOT('b2-edit-cadangan-open') });
  await cadanganCell.getByRole('button', { name: 'Simpan' }).click();
  await expect(cadanganCell).toContainText(String(oldVal + 1), { timeout: 15_000 });
  await page.screenshot({ path: SHOT('b3-edit-cadangan-saved') });
  // revert
  await cadanganCell.getByTitle('Ubah cadangan').click();
  await cadanganCell.locator('input[type="number"]').fill(String(oldVal));
  await cadanganCell.getByRole('button', { name: 'Simpan' }).click();
  await expect(cadanganCell).toContainText(String(oldVal), { timeout: 15_000 });

  // 3. Edit Batas Min inline + reset ke null (fallback *).
  const minCell = firstRow.locator('td').nth(7);
  await minCell.getByTitle(/Ubah batas minimum/).click();
  const minInput = minCell.locator('input[type="number"]');
  await minInput.fill('999');
  await minCell.getByRole('button', { name: 'Simpan' }).click();
  await expect(minCell).toContainText('999', { timeout: 15_000 });
  await page.screenshot({ path: SHOT('b4-edit-min-saved') });
  // reset: kosongkan -> ikut produk induk (tanda *)
  await minCell.getByTitle(/Ubah batas minimum/).click();
  await minCell.locator('input[type="number"]').fill('');
  await minCell.getByRole('button', { name: 'Simpan' }).click();
  await expect(minCell).toContainText('*', { timeout: 15_000 });

  // 4. Toggle Email Notifikasi + reload persistence.
  const emailCell = firstRow.locator('td').nth(8);
  const toggle = emailCell.getByRole('switch');
  const before = await toggle.getAttribute('aria-checked');
  await toggle.click();
  await expect(toggle).toHaveAttribute(
    'aria-checked',
    before === 'true' ? 'false' : 'true',
    { timeout: 15_000 }
  );
  const after = before === 'true' ? 'false' : 'true';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Stok Varian' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('tbody tr').first().locator('td').nth(8).getByRole('switch')).toHaveAttribute(
    'aria-checked',
    after,
    { timeout: 15_000 }
  );
  await page.screenshot({ path: SHOT('b5-email-toggle-persisted') });
  // revert toggle
  await page.locator('tbody tr').first().locator('td').nth(8).getByRole('switch').click();
  await expect(
    page.locator('tbody tr').first().locator('td').nth(8).getByRole('switch')
  ).toHaveAttribute('aria-checked', before ?? 'false', { timeout: 15_000 });

  // 5. Tab Oversells: handle 1 entri seed -> badge berkurang tanpa reload.
  const oversellsTab = page.getByRole('button', { name: /Oversells/ });
  const badgeBefore = Number((await oversellsTab.innerText()).replace(/\D/g, ''));
  await oversellsTab.click();
  await expect(page.getByText('e2e seed oversell')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: SHOT('b6-oversells-before') });
  const seedRow = page.locator('tbody tr', { hasText: 'e2e seed oversell' });
  await seedRow.getByRole('button', { name: 'Tandai sudah ditangani' }).click();
  await expect(seedRow.getByText('Sudah ditangani')).toBeVisible({ timeout: 15_000 });
  await expect(oversellsTab).toContainText(String(Math.max(0, badgeBefore - 1)), {
    timeout: 15_000,
  });
  await page.screenshot({ path: SHOT('b7-oversells-handled') });
  // seed dibiarkan handled; afterAll menghapus barisnya.
});
