import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync } from 'child_process';

/**
 * [E2E] Panel "SKU Order Belum Ter-mapping" di halaman Mapping.
 *
 * Seed 1 order + 1 item orphan via sqlite (pola stock-page.spec.ts), lalu:
 *  1. Panel tampil dengan SKU & qty yang benar.
 *  2. Aksi "Ke varian ada" → Mapping + Backfill → panel hilang & baris mapping
 *     masuk ke tabel Daftar Mapping.
 *  3. afterAll membersihkan baris seed (DB dev kembali seperti semula).
 */

const ROOT = '/Users/udan/Downloads/maxius-project/maxius-platform';
const DB = `${ROOT}/prisma/dev.db`;
const SHOT = (n: string) => `${ROOT}/e2e/screenshots/mapping-orphan-${n}.png`;
const ORPHAN_SKU = 'E2E-ORPHAN-E2E';
const ORDER_NO = 'E2E-ORPHAN-E2E-ORD';

function sql(q: string) {
  // execFileSync + args: tanpa shell, supaya kutip "Order" (keyword SQL) utuh.
  return execFileSync('sqlite3', [DB, q], { encoding: 'utf8' }).trim();
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Masukkan username').fill('admin');
  await page.getByPlaceholder('••••••••').fill('admin123');
  await page.getByRole('button', { name: 'Masuk Sekarang' }).click();
  await page.waitForURL('/', { timeout: 30_000, waitUntil: 'commit' });
  await expect(page.getByText('Yang Perlu Dilakukan')).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(() => {
  const now = Date.now();
  const acct = sql('SELECT id FROM PlatformAccount WHERE accessToken IS NOT NULL LIMIT 1;');
  // Varian khusus yang pasti BELUM ter-mapping di akun mana pun (hindari 409
  // dari unique accountId+variantId), plus order + item orphan-nya.
  // Kolom timestamp diisi eksplisit: insert sqlite mentah tidak melewati
  // default Prisma (@updatedAt). MasterProduct tidak punya kolom timestamp.
  sql(
    `INSERT INTO MasterProduct (id, name, type, status, isActive, threshold) ` +
      `VALUES ('${ORDER_NO}-mp','E2E Orphan Master TMP','single','active',1,20);`
  );
  sql(
    `INSERT INTO ProductVariant (id, sku, stock, safetyStock, masterProductId, createdAt, updatedAt) ` +
      `VALUES ('${ORDER_NO}-var','E2E-ORPHAN-VAR',0,0,'${ORDER_NO}-mp',${now},${now});`
  );
  sql(
    `INSERT INTO "Order" (id, orderNo, status, accountId, createTime, updatedAt) ` +
      `VALUES ('${ORDER_NO}-1','${ORDER_NO}','COMPLETED','${acct}',${now},${now});`
  );
  sql(
    `INSERT INTO OrderItem (id, qty, channelSku, productName, orderId, variantId) ` +
      `VALUES ('${ORDER_NO}-item-1', 4, '${ORPHAN_SKU}', 'Produk Uji Panel Mapping', '${ORDER_NO}-1', NULL);`
  );
});

test.afterAll(() => {
  sql(`DELETE FROM ProductMapping WHERE channelSku='${ORPHAN_SKU}';`);
  sql(`DELETE FROM OrderItem WHERE id='${ORDER_NO}-item-1';`);
  sql(`DELETE FROM "Order" WHERE id='${ORDER_NO}-1';`);
  sql(`DELETE FROM ProductVariant WHERE id='${ORDER_NO}-var';`);
  sql(`DELETE FROM MasterProduct WHERE id='${ORDER_NO}-mp';`);
});

test('Panel orphan SKU: tampil → mapping ke varian ada → panel hilang', async ({ page }) => {
  await login(page);
  await page.goto('/products/mapping');
  await expect(page.getByRole('heading', { name: 'Mapping Stok Terpusat' })).toBeVisible({ timeout: 30_000 });

  // 1. Panel tampil dengan SKU orphan hasil seed.
  const panel = page.getByTestId(`orphan-row-${ORPHAN_SKU}`);
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText('4 pcs');
  await page.screenshot({ path: SHOT('1-panel-visible') });

  // 2. Mode default "Ke varian ada": pilih varian khusus (bebas konflik) lalu mapping.
  const varId = sql(`SELECT id FROM ProductVariant WHERE id='${ORDER_NO}-var';`);
  await panel.locator('select').first().selectOption(varId);
  await panel.getByRole('button', { name: 'Mapping + Backfill' }).click();

  // Panel hilang (orphan sudah ter-backfill) dan mapping masuk daftar.
  await expect(page.getByTestId('orphan-panel')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('table').getByText(ORPHAN_SKU)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: SHOT('2-mapped') });
});
