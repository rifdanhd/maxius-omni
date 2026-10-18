import { test, expect } from '@playwright/test';
import { dbInfo, login, sql } from './helpers';

const accountId = 'e2e-refresh-token';
const label = 'E2E Pembaruan Koneksi';

test.beforeEach(() => {
  sql(`INSERT INTO "PlatformAccount" (id,platform,label,"businessId","accessToken","refreshToken","tokenExpiresAt","shopCipher","createdAt","updatedAt")
    VALUES ('${accountId}','TIKTOK_SHOP','${label}','business-default','fixture-expired','fixture-refresh',NOW()-INTERVAL '1 day','fixture-cipher',NOW(),NOW())
    ON CONFLICT (id) DO UPDATE SET "accessToken"='fixture-expired',"refreshToken"='fixture-refresh',"tokenExpiresAt"=NOW()-INTERVAL '1 day',"isFrozen"=false;`);
});

test.afterEach(() => {
  sql(`DELETE FROM "PlatformAccount" WHERE id='${accountId}';`);
});

test('token habis: status menunggu pembaruan, sinkron aktif, token tidak bocor', async ({ page }) => {
  await login(page);
  const response = await page.request.get('/api/stores');
  expect(response.ok()).toBeTruthy();
  const stores = await response.json();
  const store = stores.find((row: { id: string }) => row.id === accountId);
  expect(store).toMatchObject({ status: 'expired', canRefresh: true });
  expect(JSON.stringify(stores)).not.toContain('fixture-refresh');
  expect(JSON.stringify(stores)).not.toContain('fixture-expired');
  await page.getByRole('button', { name: /^Notifikasi/ }).click();
  await expect(page.getByRole('dialog', { name: 'Pusat notifikasi' })).not.toContainText(label);
  await page.keyboard.press('Escape');
  await page.goto('/settings/accounts');
  const row = page.getByRole('row').filter({ hasText: label });
  await expect(row).toContainText('Menunggu pembaruan');
  await expect(row.getByRole('button', { name: 'Hubungkan ulang' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: `Perbarui data ${label}` })).toBeEnabled();
  await page.route(`**/api/stores/${accountId}/sync`, async (route) => {
    sql(`UPDATE "PlatformAccount" SET "tokenExpiresAt"=NOW()+INTERVAL '7 days' WHERE id='${accountId}';`);
    await route.fulfill({ json: { success: true, message: 'Data produk toko selesai diperbarui.' } });
  });
  await row.getByRole('button', { name: `Perbarui data ${label}` }).click();
  await expect(row).toContainText('Terhubung');
});

test('pembaruan gagal menyediakan jalan hubungkan ulang; akun dibekukan tetap terkunci', async ({ page }) => {
  await login(page);
  await page.route(`**/api/stores/${accountId}/sync`, (route) => route.fulfill({ status: 502, json: { error: 'Operasi gagal. Coba lagi atau periksa log server.' } }));
  await page.goto('/settings/accounts');
  const row = page.getByRole('row').filter({ hasText: label });
  await row.getByRole('button', { name: `Perbarui data ${label}` }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Hubungkan ulang' })).toBeVisible();
  sql(`UPDATE "PlatformAccount" SET "isFrozen"=true WHERE id='${accountId}';`);
  await page.reload();
  await expect(row).toContainText('Dibekukan');
  await expect(row.getByRole('button', { name: `Perbarui data ${label}` })).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Hubungkan ulang' })).toHaveCount(0);
  const response = await page.request.get('/api/stores');
  expect((await response.json()).find((store: { id: string }) => store.id === accountId).canRefresh).toBe(false);
});

test('tanpa refresh token harus hubungkan ulang; modal mendukung Escape dan fokus', async ({ page }) => {
  sql(`UPDATE "PlatformAccount" SET "refreshToken"=NULL WHERE id='${accountId}';`);
  await login(page);
  await page.goto('/settings/accounts');
  const row = page.getByRole('row').filter({ hasText: label });
  await expect(row).toContainText('Perlu dihubungkan ulang');
  await expect(row.getByRole('button', { name: 'Hubungkan ulang' })).toBeVisible();
  await expect(row.getByRole('button', { name: `Perbarui data ${label}` })).toBeDisabled();
  const trigger = page.getByRole('button', { name: 'Tambahkan Marketplace' });
  await trigger.click();
  const modal = page.getByRole('dialog', { name: 'Pilih Marketplace' });
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('layanan TikTok memakai token terbaru, kredensial akun, dan satu refresh untuk pagination', async () => {
  process.env.POSTGRES_URL = dbInfo().url;
  process.env.DATABASE_URL = dbInfo().url;
  process.env.AUTO_SYNC_DISABLED = 'true';
  process.env.SYNC_RETRY_DISABLED = 'true';
  process.env.TIKTOK_APP_KEY = 'fixture-app';
  process.env.TIKTOK_APP_SECRET = 'fixture-secret';
  const { prisma } = await import('../lib/db/prisma');
  const { syncTikTokListings } = await import('../lib/services/marketplace-tiktok.service');
  const { withRefreshedTiktokToken } = await import('../lib/services/tiktok-token.service');
  const { TikTokApiError } = await import('../lib/integrations/tiktokShop');
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  let pages = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'auth.tiktok-shops.com' && url.pathname.endsWith('/refresh')) {
      expect(url.searchParams.get('refresh_token')).toBe('fixture-refresh');
      refreshes++;
      return Response.json({ code: 0, data: { access_token: 'fixture-new', refresh_token: 'fixture-rotated', access_token_expire_in: Math.floor(Date.now() / 1000) + 604800 } });
    }
    if (url.hostname === 'open-api.tiktokglobalshop.com' && url.pathname.endsWith('/products/search')) {
      expect(new Headers(init?.headers).get('x-tts-access-token')).toBe('fixture-new');
      expect(url.searchParams.get('app_key')).toBe('fixture-app');
      pages++;
      return Response.json({ code: 0, data: { products: [], ...(pages === 1 ? { next_page_token: 'second-page' } : {}) } });
    }
    throw new Error('Unexpected network request');
  };
  try {
    const stale = await prisma.platformAccount.findUniqueOrThrow({ where: { id: accountId } });
    const result = await syncTikTokListings('business-default', accountId);
    expect(result[0].error).toBeUndefined();
    expect(refreshes).toBe(1);
    expect(pages).toBe(2);
    await expect(withRefreshedTiktokToken(stale, async (token) => token)).resolves.toBe('fixture-new');
    await expect(withRefreshedTiktokToken(stale, async () => { throw new TikTokApiError('SCOPE', 105005, 'No permission', '-'); })).rejects.toThrow('No permission');
    expect(refreshes).toBe(1);
    await prisma.platformAccount.update({ where: { id: accountId }, data: { accessToken: null, refreshToken: null } });
    await expect(withRefreshedTiktokToken(stale, async () => 'unexpected')).rejects.toThrow('hubungkan ulang');
    expect(refreshes).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.syncLog.deleteMany({ where: { accountId } });
    await prisma.$disconnect();
  }
});

test('layanan Shopee tidak memakai ulang refresh token lama dan menghormati pembekuan terbaru', async () => {
  process.env.POSTGRES_URL = dbInfo().url;
  process.env.DATABASE_URL = dbInfo().url;
  process.env.SHOPEE_PARTNER_ID = '999888';
  process.env.SHOPEE_PARTNER_KEY = 'fixture-shopee-secret';
  const { prisma } = await import('../lib/db/prisma');
  const { withRefreshedToken, loadShopeeAccount } = await import('../lib/services/marketplace-shopee.service');
  const { ShopeeApiError } = await import('../lib/integrations/shopee');
  await prisma.platformAccount.update({ where: { id: accountId }, data: { platform: 'SHOPEE', externalShopId: '123456' } });
  const stale = await loadShopeeAccount(accountId);
  expect(stale).not.toBeNull();
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe('/api/v2/auth/access_token/get');
    expect(JSON.parse(String(init?.body)).refresh_token).toBe('fixture-refresh');
    refreshes++;
    return Response.json({ access_token: 'fixture-shopee-new', refresh_token: 'fixture-shopee-rotated', expire_in: 14400 });
  };
  try {
    const call = (token: string) => {
      if (token === 'fixture-expired') throw new ShopeeApiError('error_auth', 'token expired', '-');
      return Promise.resolve(token);
    };
    expect(await withRefreshedToken(stale!, call)).toBe('fixture-shopee-new');
    expect(await withRefreshedToken(stale!, call)).toBe('fixture-shopee-new');
    expect(refreshes).toBe(1);
    await prisma.platformAccount.update({ where: { id: accountId }, data: { isFrozen: true } });
    await expect(withRefreshedToken(stale!, call)).rejects.toThrow('dibekukan');
    expect(refreshes).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.$disconnect();
  }
});
