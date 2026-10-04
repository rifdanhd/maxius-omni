import { test, expect } from '@playwright/test';
import { login, apiToken, sql } from './helpers';

/**
 * M8a — guard platform: order Shopee TIDAK BOLEH menyentuh API TikTok.
 *
 * Semua endpoint fulfillment/label wajib menjawab guard eksplisit
 * (code: "unsupported_platform" / failed per-item) sebelum panggilan TikTok
 * API apa pun — bukan error TikTok / sukses senyap.
 */

const BIZ = 'business-default';
const ACCT_S = 'e2e-m8a-shopee';
const ACCT_T = 'e2e-m8a-tiktok';
const ORD_S = 'e2e-m8a-order-shopee';
const ORD_T = 'e2e-m8a-order-tiktok';
/** orderNo yang tampil di kartu (bukan id). */
const NO_S = 'E2E-M8A-SHP-1';
const NO_T = 'E2E-M8A-TT-1';

test.beforeAll(() => {
  sql(
    `INSERT INTO "PlatformAccount" (id, platform, label, "businessId", "createdAt", "updatedAt") ` +
      `VALUES ('${ACCT_S}','SHOPEE','E2E M8a Shopee','${BIZ}',NOW(),NOW()) ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "PlatformAccount" (id, platform, label, "accessToken", "businessId", "createdAt", "updatedAt") ` +
      `VALUES ('${ACCT_T}','TIKTOK_SHOP','E2E M8a TikTok','e2e-m8a-fake-token','${BIZ}',NOW(),NOW()) ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "Order" (id, "orderNo", status, "createTime", "updatedAt", "accountId") ` +
      `VALUES ('${ORD_S}','E2E-M8A-SHP-1','AWAITING_SHIPMENT',NOW(),NOW(),'${ACCT_S}') ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "OrderItem" (id, qty, "channelSku", "orderId") ` +
      `VALUES ('${ORD_S}-item',1,'SKU-M8A-1','${ORD_S}') ON CONFLICT (id) DO NOTHING;`
  );
  sql(
    `INSERT INTO "Shipment" (id, "externalId", status, "orderId", "accountId") ` +
      `VALUES ('${ORD_S}-shp','778899','READY_TO_SHIP','${ORD_S}','${ACCT_S}') ON CONFLICT DO NOTHING;`
  );
  sql(
    `INSERT INTO "Order" (id, "orderNo", status, "createTime", "updatedAt", "accountId") ` +
      `VALUES ('${ORD_T}','E2E-M8A-TT-1','AWAITING_SHIPMENT',NOW(),NOW(),'${ACCT_T}') ON CONFLICT (id) DO NOTHING;`
  );
});

test.afterAll(() => {
  sql(`DELETE FROM "Order" WHERE id IN ('${ORD_S}','${ORD_T}');`);
  sql(`DELETE FROM "PlatformAccount" WHERE id IN ('${ACCT_S}','${ACCT_T}');`);
});

test('M8a API: endpoint fulfillment/label menolak order Shopee sebelum panggilan TikTok', async ({ page }) => {
  await login(page);
  const token = await apiToken(page);
  const auth = { Authorization: `Bearer ${token}` };

  // Detail order — 200 + platform SHOPEE (kategori TikTok tidak dipanggil utk Shopee).
  const detail = await page.request.get(`/api/orders/${ORD_S}`, { headers: auth });
  expect(detail.status()).toBe(200);
  expect((await detail.json()).platform).toBe('SHOPEE');

  // Ship — guard eksplisit 400, bukan panggilan TikTok.
  const ship = await page.request.post(`/api/orders/${ORD_S}/ship`, {
    headers: auth,
    data: {},
  });
  expect(ship.status()).toBe(400);
  expect((await ship.json()).code).toBe('unsupported_platform');

  // Handover slots.
  const slots = await page.request.get(`/api/orders/${ORD_S}/handover-slots`, { headers: auth });
  expect(slots.status()).toBe(400);
  expect((await slots.json()).code).toBe('unsupported_platform');

  // Shipping-parameter (opsi Atur Pengiriman Shopee): TikTok ditolak guard,
  // Shopee tanpa token → error eksplisit, tanpa panggilan API Shopee apa pun.
  const spTt = await page.request.get(`/api/orders/${ORD_T}/shipping-parameter`, { headers: auth });
  expect(spTt.status()).toBe(400);
  expect((await spTt.json()).code).toBe('unsupported_platform');

  const spS = await page.request.get(`/api/orders/${ORD_S}/shipping-parameter`, { headers: auth });
  expect(spS.status()).toBe(502);
  expect((await spS.json()).ok).toBe(false);

  // Shopee-ship: gagal per-order (akun tanpa token) & status order TIDAK berubah.
  const ss = await page.request.post('/api/orders/fulfillment/shopee-ship', {
    headers: auth,
    data: { orderIds: [ORD_S], method: 'PICKUP', addressId: 1 },
  });
  expect(ss.status()).toBe(200);
  const ssBody = await ss.json();
  expect(ssBody.summary.success).toBe(0);
  expect(ssBody.results[0].ok).toBe(false);
  const ssDetail = await page.request.get(`/api/orders/${ORD_S}`, { headers: auth });
  expect((await ssDetail.json()).status).toBe('AWAITING_SHIPMENT');

  // Label resmi — 400 unsupported_platform (frontend fallback cetak lokal).
  const label = await page.request.get(`/api/orders/${ORD_S}/label`, { headers: auth });
  expect(label.status()).toBe(400);
  expect((await label.json()).code).toBe('unsupported_platform');

  // Pickup bulk — per-order gagal dengan pesan Seller Center (bukan error TikTok).
  const pickup = await page.request.post('/api/orders/fulfillment/pickup', {
    headers: auth,
    data: { orderIds: [ORD_S], handover_method: 'DROP_OFF' },
  });
  expect(pickup.status()).toBe(200);
  const pickupBody = await pickup.json();
  expect(pickupBody.results[0].ok).toBe(false);
  expect(pickupBody.results[0].error).toContain('Seller Center');

  // Cetak label batch (3 rute) — Shopee dilewati per-item, bukan dipanggil ke TikTok.
  for (const path of [
    '/api/orders/fulfillment/shipping-label',
    '/api/orders/label-pack',
    '/api/orders/bulk-label',
  ]) {
    const res = await page.request.post(path, {
      headers: auth,
      data: { orderIds: [ORD_S] },
    });
    expect(res.status(), path).toBe(200);
    const body = await res.json();
    expect(body.count, path).toBe(0);
    expect(body.failed[0].reason, path).toContain('TikTok tidak berlaku');
  }

  // Tracking sync dengan accountId Shopee — 400 eksplisit, bukan sukses senyap.
  const tSync = await page.request.post('/api/orders/fulfillment/tracking-sync', {
    headers: auth,
    data: { accountId: ACCT_S },
  });
  expect(tSync.status()).toBe(400);
  expect((await tSync.json()).code).toBe('unsupported_platform');

  // Reconcile resi dengan accountId Shopee — 400 eksplisit.
  const rec = await page.request.post('/api/orders/fulfillment/reconcile', {
    headers: auth,
    data: { accountId: ACCT_S },
  });
  expect(rec.status()).toBe(400);
  expect((await rec.json()).code).toBe('unsupported_platform');

  // Sync order — akun Shopee masuk lewat cabang SHOPEE (M8b), bukan ingest TikTok:
  // buktinya pesan error cabang Shopee (tanpa shop_cipher) & tanpa panggilan jaringan.
  const sync = await page.request.post('/api/orders/sync', { headers: auth });
  expect(sync.status()).toBe(200);
  const syncBody = await sync.json();
  const syncResults = syncBody.results as Array<{ accountId: string; error?: string }>;
  expect(syncResults.map((r) => r.accountId)).toContain(ACCT_T);
  const shopeeResult = syncResults.find((r) => r.accountId === ACCT_S);
  expect(shopeeResult?.error).toContain('access token');
  expect(shopeeResult?.error).not.toContain('shop_cipher');

  // Regresi jalur TikTok (semua berhenti lokal — tanpa panggilan jaringan):
  const ttDetail = await page.request.get(`/api/orders/${ORD_T}`, { headers: auth });
  expect(ttDetail.status()).toBe(200);
  expect((await ttDetail.json()).platform).toBe('TIKTOK_SHOP');

  const ttShip = await page.request.post(`/api/orders/${ORD_T}/ship`, {
    headers: auth,
    data: {},
  });
  expect(ttShip.status()).toBe(400);
  expect((await ttShip.json()).code).toBeUndefined(); // "Belum ada paket", bukan guard

  const ttLabel = await page.request.get(`/api/orders/${ORD_T}/label`, { headers: auth });
  expect(ttLabel.status()).toBe(404); // "Belum ada paket", bukan guard

  const ttPickup = await page.request.post('/api/orders/fulfillment/pickup', {
    headers: auth,
    data: { orderIds: [ORD_T], handover_method: 'DROP_OFF' },
  });
  expect(ttPickup.status()).toBe(200);
  const ttPickupBody = await ttPickup.json();
  expect(ttPickupBody.results[0].ok).toBe(false);
  expect(ttPickupBody.results[0].error).toContain('Belum ada paket');
});

test('M8a/M8c UI: pickup Shopee buka ShopeeShipModal; Cetak Label = label lokal (Shopee) / label resmi (TikTok)', async ({ page }) => {
  await login(page);
  await page.goto('/orders');

  // Kartu OrderCard = ancestor terdekat ber-class bg-white.rounded-xl dari link orderNo.
  const cardOf = (orderNo: string) =>
    page
      .getByRole('link', { name: orderNo, exact: true })
      .locator('xpath=ancestor::div[contains(@class,"bg-white") and contains(@class,"rounded-xl")][1]');

  const card = cardOf(NO_S);
  await expect(card).toBeVisible({ timeout: 30_000 });

  // Klik "Atur Pengiriman" di kartu Shopee → ShopeeShipModal TERBUKA (bukan alert).
  // Akun e2e tanpa token → opsi API gagal dimuat, modal menampilkan hint Seller Center.
  await card.getByRole('button', { name: 'Atur Pengiriman', exact: true }).click();
  await expect(page.getByText('Atur Pengiriman Shopee (1)')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('bisa dikirim via Seller Center')).toBeVisible();
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(page.getByText('Atur Pengiriman Shopee (1)')).toHaveCount(0);

  // Pilih hanya order Shopee → menu Cetak menawarkan "Label" LOKAL (M8c),
  // tanpa opsi label resmi TikTok.
  await card.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Cetak (1)' }).click();
  await expect(page.getByText('Cetak Invoice')).toBeVisible();
  await expect(page.getByText('Label pengiriman lokal')).toBeVisible();
  await expect(page.getByText('Label resmi TikTok gabungan (PDF)')).toHaveCount(0);

  // Klik "Cetak Label" (Shopee-only) → label lokal lewat detail order (DB):
  // detail terpanggil & NOL panggilan endpoint label TikTok.
  const labelApiCalls: string[] = [];
  let detailCalled = false;
  page.on('request', (req) => {
    const url = req.url();
    if (/\/api\/orders\/[^/?]+\/label(\?|$)|label-pack|bulk-label/.test(url)) {
      labelApiCalls.push(url);
    }
    if (url.includes(`/api/orders/${ORD_S}`) && !/\/label(\?|$)/.test(url)) {
      detailCalled = true;
    }
  });
  page.on('dialog', (d) => {
    d.accept().catch(() => {});
  });
  const popupP = page.waitForEvent('popup', { timeout: 5_000 }).catch(() => null);
  await page.getByRole('menuitem', { name: /^Cetak Label/ }).click();
  await popupP;
  await expect.poll(() => detailCalled, { timeout: 10_000 }).toBe(true);
  expect(labelApiCalls).toEqual([]);
  await page.keyboard.press('Escape');

  // Tambahkan order TikTok terpilih → campuran menawarkan label resmi TikTok.
  const ttCard = cardOf(NO_T);
  await ttCard.locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: 'Cetak (2)' }).click();
  await expect(page.getByText('Label resmi TikTok')).toBeVisible();
});
