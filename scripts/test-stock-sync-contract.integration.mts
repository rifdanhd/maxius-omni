import assert from "node:assert/strict";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { setupTestDb } from "./lib/test-db";
const db = setupTestDb("stock_sync_contract");
process.env.PII_ENC_KEY = "ab".repeat(32);
process.env.TIKTOK_APP_KEY = "fixture-env-app"; process.env.TIKTOK_APP_SECRET = "fixture-env-secret";
process.env.SHOPEE_PARTNER_ID = "123"; process.env.SHOPEE_PARTNER_KEY = "fixture-shopee-key";
const { prisma } = await import("../lib/db/prisma");
const { syncStockToMarketplaces: sync } = await import("../lib/services/sync.service");
const { updateStockBatch: tiktokBatch } = await import("../lib/integrations/tiktokShop");
const { updateStockBatch: shopeeBatch } = await import("../lib/integrations/shopee");
const { allocationQuantity } = await import("../lib/services/stock-allocation.policy");
const { validateInventorySettingsUpdate, updateInventorySettings, getCachedInventorySettings } = await import("../lib/services/inventory-settings.service");
const { pushStockAndWait, _resetStockPushQueueForTests } = await import("../lib/services/stock-push-queue.service");
const { processDueSyncJobs, settleDispatchedSyncJobs } = await import("../lib/services/sync-job.service");
const { changeMasterStock } = await import("../lib/services/master-stock-mutation.service");
const { drainStockOutbox } = await import("../lib/services/stock-outbox.service");
const { getMasterStock } = await import("../lib/services/master-stock.service");
const { logStockPush } = await import("../lib/services/sync-log.util");
const { isTransientPlatformError } = await import("../lib/services/rate-limit.policy");
const { safeStockPushMessage } = await import("../lib/services/stock-push-error");
const originalFetch = globalThis.fetch;
type Sku = { id: string; seller_sku: string; warehouse_inventory: Array<{ warehouse_id: string }> };
const products: Array<{ id: string; skus: Sku[] }> = [{ id: "product-1", skus: [
  { id: "1736990378593650231", seller_sku: "SELLER-A", warehouse_inventory: [{ warehouse_id: "warehouse-1" }] },
  { id: "1736990378593584695", seller_sku: "SELLER-B", warehouse_inventory: [{ warehouse_id: "warehouse-2" }] },
] }];
const calls: Array<{ url: URL; body: Record<string, unknown>; token: string | null }> = [];
let failSku = ""; let http429 = false; let expiredOnce = false; let expiredOnWrite = false; let refreshes = 0; let malformed = false;
let shopeeExpiredOnWrite = false; let shopeeRefreshes = 0;
let shopeeFailModel = -1; let shopeeMalformed = false;
const writes = () => calls.filter((call) => call.url.pathname.endsWith("inventory/update") || call.url.pathname.endsWith("update_stock"));
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const body = JSON.parse(String(init?.body ?? "{}"));
  calls.push({ url, body, token: new Headers(init?.headers).get("x-tts-access-token") });
  if (url.hostname === "auth.tiktok-shops.com") { refreshes++; return Response.json({ code: 0, data: { access_token: "fixture-refreshed-token", refresh_token: "fixture-next-refresh", access_token_expire_in: Math.floor(Date.now() / 1000) + 3600 } }); }
  if (url.hostname === "open-api.tiktokglobalshop.com") {
    if (expiredOnce) { expiredOnce = false; return Response.json({ code: 105002, message: "token expired" }); }
    if (http429) { http429 = false; return Response.json({ code: 999998, message: "busy" }, { status: 429 }); }
    if (url.pathname.endsWith("inventory/search")) {
      const rows = products.filter((product) => !body.product_ids || body.product_ids.includes(product.id)).map((product) => ({ product_id: product.id, skus: product.skus.filter((sku) => !body.sku_ids || body.sku_ids.includes(sku.id)) })).filter((product) => product.skus.length);
      return Response.json({ code: 0, data: { inventory: rows } });
    }
    if (url.pathname.endsWith("products/search")) { assert.ok(body.seller_skus.length <= 10); assert.equal(body.sku_ids, undefined); assert.equal(body.product_ids, undefined); return Response.json({ code: 0, data: { products: products.filter((product) => product.skus.some((sku) => body.seller_skus.includes(sku.seller_sku))) } }); }
    if (url.pathname.endsWith("inventory/update")) {
      if (expiredOnWrite) { expiredOnWrite = false; return Response.json({ code: 105002, message: "token expired at write" }); }
      return Response.json({ code: 0, ...(malformed ? {} : { data: { errors: failSku ? [{ code: 12052990, message: "SKU rejected", detail: { sku_id: failSku, extra_errors: [{ code: 12052097, message: "warehouse rejected" }] } }] : [] } }) });
    }
    throw new Error("Mock TikTok endpoint tidak terdaftar: " + url.pathname);
  }
  assert.equal(url.hostname, "partner.shopeemobile.com", "Tidak boleh ada request ke host lain");
  if (url.pathname.endsWith("auth/access_token/get")) { shopeeRefreshes++; return Response.json({ access_token: "fixture-sh-refreshed", refresh_token: "fixture-sh-refresh-next", expire_in: 3600 }); }
  if (url.pathname.endsWith("update_stock") && shopeeExpiredOnWrite) { shopeeExpiredOnWrite = false; return Response.json({ error: "error_auth", message: "token expired" }); }
  if (url.pathname.endsWith("get_item_list")) return Response.json({ response: { item: [{ item_id: 100 }, { item_id: 200 }], has_next_page: false } });
  if (url.pathname.endsWith("get_item_base_info")) return Response.json({ response: { item_list: [{ item_id: 100, item_sku: "PARENT" }, { item_id: 200, item_sku: "SINGLE" }] } });
  if (url.pathname.endsWith("get_model_list")) return Response.json({ response: { model: url.searchParams.get("item_id") === "100" ? [{ model_id: 1, model_sku: "SH-ONE" }, { model_id: 2, model_sku: "SH-TWO" }] : [] } });
  if (url.pathname.endsWith("update_stock")) return Response.json({ error: "", ...(shopeeMalformed ? {} : { response: { failure_list: body.stock_list.filter((item: { model_id: number }) => item.model_id === shopeeFailModel).map((item: { model_id: number }) => ({ model_id: item.model_id, failed_reason: "model rejected" })), success_list: body.stock_list.filter((item: { model_id: number }) => item.model_id !== shopeeFailModel).map((item: { model_id: number }) => ({ model_id: item.model_id })) } }) });
  throw new Error("Mock Shopee endpoint tidak terdaftar: " + url.pathname);
};
try {
  await prisma.business.createMany({ data: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });
  await prisma.user.create({ data: { id: "fixture-user", username: "fixture-user", passwordHash: "fixture-only" } });
  const credential = await prisma.appCredential.create({ data: { platform: "TIKTOK_SHOP", label: "App fixture", clientId: "fixture-own-app", clientSecret: "fixture-own-secret" } });
  await prisma.platformAccount.createMany({ data: [
    { id: "tt", platform: "TIKTOK_SHOP", businessId: "a", label: "TikTok A", accessToken: "fixture-token", refreshToken: "fixture-refresh", shopCipher: "fixture-cipher", appCredentialId: credential.id },
    { id: "sh", platform: "SHOPEE", businessId: "a", label: "Shopee A", accessToken: "fixture-sh-token", refreshToken: "fixture-sh-refresh", externalShopId: "42" },
    { id: "foreign", platform: "TIKTOK_SHOP", businessId: "b", label: "Other", accessToken: "fixture-b", shopCipher: "fixture-b" },
  ] });
  const product = await prisma.masterProduct.create({ data: { businessId: "a", name: "Stok fixture" } });
  const variant = await prisma.productVariant.create({ data: { masterProductId: product.id, sku: "CENTRAL", stock: 100, safetyStock: 10 } });
  const tt = await prisma.productMapping.create({ data: { accountId: "tt", variantId: variant.id, channelSku: "1736990378593650231", sellerSku: "SELLER-A", platformSkuId: "1736990378593650231", platformProductId: "product-1", platformStock: 1, lastStockPushStatus: "FAILED", lastStockPushError: "previous real error", lastStockPushAt: new Date(1000), updatedAt: new Date() } });
  await prisma.productMapping.create({ data: { accountId: "sh", variantId: variant.id, channelSku: "100:1", updatedAt: new Date() } });
  await prisma.stockLedger.create({ data: { id: "initial-stock-fixture", variantId: variant.id, changeQty: 100, reason: "INITIAL_STOCK", referenceId: "initial-stock-fixture", stockAfter: 100, note: "Baseline stok fixture" } });
  await updateInventorySettings("a", { stockBaselineReady: true });
  const targets = [{ accountId: "tt", channelSku: tt.channelSku }];
  for (const value of [undefined, "false", "TRUE"]) {
    if (value === undefined) delete process.env.STOCK_PUSH_ENABLED; else process.env.STOCK_PUSH_ENABLED = value;
    const result = await sync(targets, 90); assert.equal(result[0].outcome, "disabled"); assert.equal(writes().length, 0);
  }
  process.env.STOCK_PUSH_ENABLED = "true";
  for (const bad of ["false", null, 0]) assert.equal(validateInventorySettingsUpdate({ stockPushEnabled: bad }).ok, false);
  assert.equal(validateInventorySettingsUpdate({ stockPushEnabled: false }).ok, true);
  await updateInventorySettings("a", { stockPushEnabled: false });
  assert.equal((await sync(targets, 90))[0].outcome, "disabled");
  await updateInventorySettings("a", { stockPushEnabled: true });
  assert.equal((await getCachedInventorySettings("a")).stockPushEnabled, true);
  await prisma.platformAccount.update({ where: { id: "tt" }, data: { stockPushEnabled: false } });
  assert.equal((await sync(targets, 90))[0].outcome, "disabled");
  await prisma.platformAccount.update({ where: { id: "tt" }, data: { stockPushEnabled: true, isFrozen: true } });
  assert.equal((await sync(targets, 90))[0].outcome, "disabled");
  await prisma.platformAccount.update({ where: { id: "tt" }, data: { isFrozen: false } });
  for (const [key, platformTargets] of [["syncPushTiktok", targets], ["syncPushShopee", [{ accountId: "sh", channelSku: "100:1" }]]] as const) {
    await updateInventorySettings("a", { [key]: false }); assert.equal((await sync([...platformTargets], 90))[0].outcome, "disabled");
    await updateInventorySettings("a", { [key]: true });
  }
  await sync(targets, 90, { dryRun: true }); assert.equal(writes().length, 0);
  const unchanged = await prisma.productMapping.findUniqueOrThrow({ where: { id: tt.id } });
  assert.equal(unchanged.lastStockPushStatus, "FAILED"); assert.equal(unchanged.lastStockPushError, "previous real error"); assert.equal(unchanged.lastStockPushAt!.getTime(), 1000); assert.equal(unchanged.platformStock, 1);
  assert.equal((await sync([{ accountId: "tt", channelSku: "missing" }], 90))[0].success, false);
  assert.equal((await sync([{ accountId: "nonexistent", channelSku: "missing" }], 90))[0].success, false);
  console.log("PASS: global, brand, toko, platform, frozen, dry-run, validasi dan metadata tanpa push palsu");
  for (const [mode, value, expected] of [["FULL", 100, 80], ["PERCENT", 50, 40], ["FIXED", 30, 30], ["EQUAL", 0, 20]] as const) assert.equal(allocationQuantity(90, { mode, value, buffer: 10 }, 4), expected);
  assert.equal(allocationQuantity(-5, { mode: "FULL", value: 100, buffer: 0 }, 0), 0);
  assert.throws(() => allocationQuantity(NaN, { mode: "FULL", value: 100, buffer: 0 }, 1));
  assert.throws(() => allocationQuantity(90, { mode: "PERCENT", value: 101, buffer: 0 }, 1));
  const delivered = await sync(targets, 90, { waitForDelivery: true }); assert.equal(delivered[0].outcome, "success");
  const tiktokWrite = writes().find((call) => call.url.hostname === "open-api.tiktokglobalshop.com")!;
  assert.equal(tiktokWrite.url.searchParams.get("app_key"), "fixture-own-app");
  assert.deepEqual(tiktokWrite.body.skus, [{ id: tt.platformSkuId, inventory: [{ warehouse_id: "warehouse-1", quantity: 90 }] }]);
  const signed = [...tiktokWrite.url.searchParams.entries()].filter(([key]) => key !== "sign" && key !== "access_token").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + value).join("");
  const signBody = "fixture-own-secret" + tiktokWrite.url.pathname + signed + JSON.stringify(tiktokWrite.body) + "fixture-own-secret";
  assert.equal(tiktokWrite.url.searchParams.get("sign"), crypto.createHmac("sha256", "fixture-own-secret").update(signBody).digest("hex"));
  assert.equal((await prisma.productMapping.findUniqueOrThrow({ where: { id: tt.id } })).platformStock, 90);
  const previousSync = (await prisma.productMapping.findUniqueOrThrow({ where: { id: tt.id } })).lastSyncedAt;
  failSku = tt.platformSkuId!;
  assert.equal((await pushStockAndWait("tt", tt.channelSku, 90)).success, false);
  const rejectedMapping = await prisma.productMapping.findUniqueOrThrow({ where: { id: tt.id } });
  assert.equal(rejectedMapping.platformStock, 90);
  assert.equal(rejectedMapping.lastSyncedAt?.getTime(), previousSync?.getTime());
  assert.equal(rejectedMapping.lastStockPushStatus, "FAILED");
  failSku = "";
  for (const [mode, value, expected] of [["FULL", 100, 80], ["PERCENT", 50, 40], ["FIXED", 30, 30], ["EQUAL", 0, 40]] as const) {
    await prisma.productMapping.updateMany({ where: { variantId: variant.id }, data: { stockAllocationMode: mode, stockAllocationValue: value, stockBuffer: 10 } });
    const allocated = await sync([...targets, { accountId: "sh", channelSku: "100:1" }], 90, { waitForDelivery: true });
    assert.ok(allocated.every((result) => result.outcome === "success"));
    const latestTikTok = [...writes()].reverse().find((call) => call.url.hostname === "open-api.tiktokglobalshop.com")!;
    const latestShopee = [...writes()].reverse().find((call) => call.url.hostname === "partner.shopeemobile.com")!;
    assert.equal((latestTikTok.body.skus as Array<{ inventory: Array<{ quantity: number }> }>)[0].inventory[0].quantity, expected);
    assert.equal((latestShopee.body.stock_list as Array<{ seller_stock: Array<{ stock: number }> }>)[0].seller_stock[0].stock, expected);
    await prisma.platformAccount.update({ where: { id: "tt" }, data: { stockPushEnabled: false } });
    assert.equal((await sync(targets, 90))[0].outcome, "disabled", `Gate toko harus berlaku untuk ${mode}`);
    await prisma.platformAccount.update({ where: { id: "tt" }, data: { stockPushEnabled: true } });
  }
  await prisma.productMapping.updateMany({ where: { variantId: variant.id }, data: { stockAllocationMode: null, stockAllocationValue: null, stockBuffer: null } });
  await sync(targets, 90, { waitForDelivery: true });
  const item = { channelSku: "SELLER-A", quantity: 12 };
  assert.equal((await tiktokBatch("fixture", [item], "cipher")).ok.length, 1);
  assert.equal((await tiktokBatch("fixture", [{ channelSku: "product-1", quantity: 1 }], "cipher")).ok.length, 0);
  assert.equal((await tiktokBatch("fixture", [{ channelSku: "absent", quantity: 1 }], "cipher")).failed.length, 1);
  const mismatch = await tiktokBatch("fixture", [{ channelSku: tt.channelSku, skuId: tt.platformSkuId!, sellerSku: "WRONG-SELLER", productId: "product-1", quantity: 1 }], "cipher");
  assert.ok(String(mismatch.failed[0].error).includes("SKU_MISMATCH"));
  products.push({ id: "product-duplicate", skus: [{ ...products[0].skus[0], id: "999", warehouse_inventory: [{ warehouse_id: "warehouse-1" }] }] });
  const beforeAmbiguous = writes().length;
  assert.equal((await tiktokBatch("fixture", [item], "cipher")).failed.length, 1); assert.equal(writes().length, beforeAmbiguous);
  products.pop();
  const savedWarehouses = products[0].skus[0].warehouse_inventory;
  products[0].skus[0].warehouse_inventory = [{ warehouse_id: "warehouse-1" }, { warehouse_id: "warehouse-2" }];
  assert.equal((await tiktokBatch("fixture", [item], "cipher")).failed.length, 1); products[0].skus[0].warehouse_inventory = savedWarehouses;
  failSku = products[0].skus[1].id;
  const partial = await tiktokBatch("fixture", [{ channelSku: "SELLER-A", quantity: 1 }, { channelSku: "SELLER-B", quantity: 2 }], "cipher");
  assert.equal(partial.ok.length, 1); assert.equal(partial.failed.length, 1); failSku = "";
  const partialBody = writes().at(-1)!.body.skus as Array<{ id: string; inventory: Array<{ warehouse_id: string }> }>;
  assert.equal(partialBody.find((sku) => sku.id === products[0].skus[1].id)!.inventory[0].warehouse_id, "warehouse-2");
  malformed = true; assert.equal((await tiktokBatch("fixture", [item], "cipher")).failed.length, 1); malformed = false;
  http429 = true; await assert.rejects(tiktokBatch("fixture", [item], "cipher"), (error) => isTransientPlatformError(error));
  expiredOnce = true; await pushStockAndWait("tt", tt.channelSku, 90); assert.equal(refreshes, 1);
  expiredOnWrite = true; assert.equal((await pushStockAndWait("tt", tt.channelSku, 90)).success, true); assert.equal(refreshes, 2);
  assert.ok(calls.some((call) => call.token === "fixture-refreshed-token"));
  console.log("PASS: TikTok seller SKU, SKU ID, gudang per SKU, app toko, partial failure, respons tidak lengkap, HTTP 429 dan refresh token");
  const shopee = await shopeeBatch("fixture", "42", [{ channelSku: "100:1", quantity: 50 }, { channelSku: "100:2", quantity: 30 }]); assert.equal(shopee.ok.length, 2);
  assert.deepEqual(writes().at(-1)!.body.stock_list, [{ model_id: 1, seller_stock: [{ stock: 50 }] }, { model_id: 2, seller_stock: [{ stock: 30 }] }]);
  assert.equal((await shopeeBatch("fixture", "42", [{ channelSku: "SH-ONE", quantity: 5 }])).ok.length, 1);
  assert.equal((await shopeeBatch("fixture", "42", [{ channelSku: "SINGLE", quantity: 5 }])).ok.length, 1);
  assert.equal((await shopeeBatch("fixture", "42", [{ channelSku: "PARENT", quantity: 5 }])).failed.length, 1);
  await prisma.productMapping.updateMany({ where: { accountId: "sh", channelSku: "100:1" }, data: { platformProductId: "999" } });
  const beforeMismatch = writes().length;
  assert.equal((await sync([{ accountId: "sh", channelSku: "100:1" }], 90))[0].success, false);
  assert.equal(writes().length, beforeMismatch);
  await prisma.productMapping.updateMany({ where: { accountId: "sh", channelSku: "100:1" }, data: { platformProductId: null } });
  shopeeFailModel = 2; const partialSh = await shopeeBatch("fixture", "42", [{ channelSku: "100:1", quantity: 5 }, { channelSku: "100:2", quantity: 6 }]); assert.equal(partialSh.ok.length, 1); assert.equal(partialSh.failed.length, 1); shopeeFailModel = -1;
  shopeeMalformed = true; assert.equal((await shopeeBatch("fixture", "42", [{ channelSku: "100:1", quantity: 5 }])).failed.length, 1); shopeeMalformed = false;
  shopeeExpiredOnWrite = true; assert.equal((await sync([{ accountId: "sh", channelSku: "100:1" }], 90))[0].success, true); assert.equal(shopeeRefreshes, 1);
  console.log("PASS: Shopee item/model, seller SKU, tanpa variasi, parent SKU ditolak, partial failure dan respons tidak lengkap");
  await prisma.syncJob.deleteMany({});
  const job = await prisma.syncJob.create({ data: { variantId: variant.id, accountId: "tt", channelSku: tt.channelSku, newSellable: 90 } });
  const queued = await sync(targets, 90); assert.equal(queued[0].outcome, "deferred");
  await settleDispatchedSyncJobs(variant.id, 90, queued); assert.equal((await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } })).status, "PENDING");
  await prisma.platformAccount.update({ where: { id: "tt" }, data: { stockPushEnabled: false } });
  const beforeDisabled = writes().length;
  const worker = await processDueSyncJobs({ businessId: "a" }); assert.equal(worker.disabled, 1); assert.equal(worker.succeeded, 0); assert.equal(writes().length, beforeDisabled);
  const disabledView = await getMasterStock("a", new URLSearchParams()); assert.equal(disabledView.rows[0].listings.find((listing) => listing.accountId === "tt")!.status, "DISABLED");
  await prisma.platformAccount.update({ where: { id: "tt" }, data: { stockPushEnabled: true } });
  _resetStockPushQueueForTests();
  const balance = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
  await changeMasterStock("a", "fixture-user", [{ variantId: variant.id, expectedVersion: balance.version, warehouseId: "warehouse-a", kind: "IN", quantity: 10, reason: "fixture restok", requestId: "fixture-restock-stock-sync" }]);
  await drainStockOutbox(100, "a");
  const completed = await processDueSyncJobs({ businessId: "a" }); assert.ok(completed.succeeded >= 2);
  assert.equal((await prisma.productMapping.findUniqueOrThrow({ where: { id: tt.id } })).platformStock, 100);
  await logStockPush("tt", tt.channelSku, 100, "dry_run", "fixture dry run");
  assert.equal((await prisma.productMapping.findUniqueOrThrow({ where: { id: tt.id } })).lastStockPushStatus, "SUCCESS");
  const other = await prisma.productVariant.create({ data: { masterProductId: product.id, sku: "CHANGED-MAPPING", stock: 5 } });
  await prisma.syncJob.create({ data: { variantId: other.id, accountId: "tt", channelSku: tt.channelSku, newSellable: 5 } });
  const beforeStale = writes().length;
  assert.equal((await processDueSyncJobs({ businessId: "a", variantId: other.id })).pendingRetry, 1);
  assert.equal(writes().length, beforeStale, "Job lama tidak boleh menarget mapping SKU lain");
  await assert.rejects(prisma.productMapping.create({ data: { accountId: "foreign", variantId: variant.id, channelSku: "cross-tenant", updatedAt: new Date() } }));
  const redacted = safeStockPushMessage('accessToken: "fixture-sensitive-token", https://example.invalid?access_token=fixture-sensitive-token');
  assert.ok(!redacted.includes("fixture-sensitive-token"));
  assert.ok(safeStockPushMessage({ code: "P2022" }).includes("Skema"));
  const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
  assert.ok(migrations.some((migration) => migration.migration_name === "20261026_010000_account_stock_push_enabled"));
  await prisma.userBusiness.create({ data: { userId: "fixture-user", businessId: "a", role: "owner" } });
  const { createSessionToken } = await import("../lib/services/auth.service");
  const { PATCH } = await import("../app/api/stores/[id]/route");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: "fixture-user" } });
  const jwt = createSessionToken(user, "a");
  const changeStore = (id: string, payload: unknown) => PATCH(new NextRequest(`http://localhost/api/stores/${id}`, {
    method: "PATCH", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(payload),
  }), { params: Promise.resolve({ id }) });
  assert.equal((await changeStore("tt", { stockPushEnabled: false })).status, 200);
  assert.equal((await changeStore("foreign", { stockPushEnabled: false })).status, 404);
  assert.equal((await prisma.platformAccount.findUniqueOrThrow({ where: { id: "foreign" } })).stockPushEnabled, true);
  assert.equal((await changeStore("tt", { stockPushEnabled: "false" })).status, 400);
  assert.equal((await changeStore("tt", { stockPushEnabled: true })).status, 200);
  console.log("PASS: API pengaturan toko bertipe ketat, terisolasi customer; migrasi uji lengkap; job dengan mapping berubah tidak dikirim");
  console.log("PASS: gudang → outbox → worker → dua API mock → snapshot; deferred/disabled bukan sukses; dry-run menjaga bukti push");
} finally { _resetStockPushQueueForTests(); globalThis.fetch = originalFetch; await prisma.$disconnect(); db.cleanup(); }
