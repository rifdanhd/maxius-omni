import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { setupTestDb } from "@/scripts/lib/test-db";

const adminUrl = new URL(process.env.POSTGRES_ADMIN_URL ?? process.env.POSTGRES_URL ?? "postgresql://udan@localhost:5432/postgres");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(adminUrl.hostname), "Test hanya boleh memakai PostgreSQL lokal");
process.env.POSTGRES_URL = adminUrl.toString();
process.env.JWT_SECRET = "shopee-products-local-integration-secret-2026";
process.env.PII_ENC_KEY = "ab".repeat(32);
process.env.APP_ORIGIN = "http://localhost:3100";
process.env.SHOPEE_PARTNER_ID = "999888";
process.env.SHOPEE_PARTNER_KEY = "local-fixture-partner-key";
const db = setupTestDb("shopee_products");
const { prisma } = await import("@/lib/db/prisma");
const { listShopeeProducts, getShopeeAccounts } = await import("@/lib/services/marketplace-shopee.service");
const { createSessionToken } = await import("@/lib/services/auth.service");
const { POST } = await import("@/app/api/marketplace/shopee/products/sync/route");
const { productTitle, storeName } = await import("@/components/products/shopee/presentation");
const originalFetch = globalThis.fetch;
const calls: URL[] = [];
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.ok(url.hostname.endsWith("shopeemobile.com"), "Tidak boleh mengakses layanan lain");
  calls.push(url);
  let response: Record<string, unknown>;
  if (url.pathname.endsWith("get_item_base_info")) {
    const ids = url.searchParams.get("item_id_list")!.split(",").map(Number);
    response = { item_list: ids.map((item_id) => ({ item_id, item_name: `Terbaru ${item_id}`, item_status: "NORMAL", stock_info: [{ stock: 12 }] })) };
  } else if (url.pathname.endsWith("get_model_list")) response = { model: [] };
  else if (url.pathname.endsWith("get_item_list")) response = { item: [{ item_id: 101 }, { item_id: 102 }], has_next_page: false };
  else throw new Error(`API tidak diharapkan: ${url.pathname}`);
  return new Response(JSON.stringify({ response }), { status: 200, headers: { "content-type": "application/json" } });
};

let passed = 0;
async function check(name: string, run: () => Promise<void> | void) {
  await run(); passed++; console.log(`PASS ${name}`);
}

try {
  const business = await prisma.business.create({ data: { name: "Produk Shopee UI" } });
  const other = await prisma.business.create({ data: { name: "Bisnis lain" } });
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), username: "shopee-ui-test", passwordHash: "fixture" } });
  await prisma.userBusiness.create({ data: { userId: user.id, businessId: business.id, role: "owner" } });
  const makeAccount = (label: string, externalShopId: string, businessId = business.id, platform = "SHOPEE") =>
    prisma.platformAccount.create({ data: { label, externalShopId, platform, businessId, accessToken: "fixture-token" } });
  const a = await makeAccount("Toko Kaos Kaki", "111");
  const b = await makeAccount("Toko Bola", "222");
  const foreign = await makeAccount("Rahasia", "333", other.id);
  const tiktok = await makeAccount("TikTok", "444", business.id, "TIKTOK_SHOP");
  const master = await prisma.masterProduct.create({ data: { name: "Produk Pusat", businessId: business.id } });
  const variant = await prisma.productVariant.create({ data: { sku: "SKU-PUSAT", stock: 99, masterProductId: master.id } });
  const makeMapping = async (accountId: string, productId: string, stock: number, mapped = true, sku = `${productId}:0`) => {
    const variantId = mapped ? productId === "103"
      ? (await prisma.productVariant.create({ data: { sku: `SKU-${productId}`, stock: 99, masterProductId: master.id } })).id
      : variant.id : null;
    return prisma.productMapping.create({ data: { accountId, channelSku: sku, platformProductId: productId,
      platformTitle: `Kaos Kaki ${productId} ()`, platformStatus: "NORMAL", platformStock: stock,
      variantId, lastSyncedAt: new Date("2026-10-10T03:14:00Z"), updatedAt: new Date() } });
  };
  const first = await makeMapping(a.id, "101", 0);
  await makeMapping(a.id, "102", 7, false);
  const large = await makeMapping(a.id, "103", 1_777_764);
  await makeMapping(b.id, "101", 40);
  await makeMapping(foreign.id, "101", 66, false);
  await makeMapping(tiktok.id, "101", 77, false);
  await prisma.syncJob.create({ data: { accountId: a.id, channelSku: "103:0", variantId: large.variantId!,
    status: "FAILED", newSellable: 99, lastError: "fixture failure" } });

  await check("scope bisnis/platform dan nama toko tetap benar", async () => {
    const result = await listShopeeProducts({ businessId: business.id });
    assert.equal(result.total, 4);
    assert.equal(result.syncProductCount, 4);
    assert.ok(result.rows.every((row) => [a.id, b.id].includes(row.accountId)));
    assert.equal(result.rows.find((row) => row.key === `${a.id}|101`)?.accountLabel, "Toko Kaos Kaki");
    assert.equal(result.lastSyncedAt?.toISOString(), "2026-10-10T03:14:00.000Z");
    const accounts = await getShopeeAccounts(business.id);
    assert.equal(accounts.length, 2);
    assert.ok(accounts.every((account) => account.isConnected));
    assert.ok(accounts.every((account) => !("accessToken" in account)));
  });
  await check("filter mapping, gagal sinkron, dan pemulihan terbaru", async () => {
    assert.equal((await listShopeeProducts({ businessId: business.id, mapping: "connected" })).total, 2);
    assert.equal((await listShopeeProducts({ businessId: business.id, mapping: "unlinked" })).total, 1);
    const failed = await listShopeeProducts({ businessId: business.id, mapping: "failed" });
    assert.equal(failed.total, 1); assert.equal(failed.rows[0].platformProductId, "103");
    await prisma.syncJob.create({ data: { accountId: a.id, channelSku: "103:0", variantId: large.variantId!,
      status: "SUCCESS", newSellable: 99, updatedAt: new Date(Date.now() + 1000) } });
    assert.equal((await listShopeeProducts({ businessId: business.id, mapping: "failed" })).total, 0);
  });
  await check("pengurutan seluruh hasil sebelum pagination dan multi toko", async () => {
    const result = await listShopeeProducts({ businessId: business.id, sort: "stock_desc", pageSize: 1 });
    assert.equal(result.rows[0].stockTotal, 1_777_764);
    assert.equal(result.total, 4);
    assert.equal((await listShopeeProducts({ businessId: business.id, accountIds: [a.id, b.id] })).total, 4);
    assert.equal((await listShopeeProducts({ businessId: business.id, accountIds: [a.id] })).total, 3);
    assert.equal((await listShopeeProducts({ businessId: business.id, search: "kaos kaki", sort: "account_asc" })).rows[0].accountId, b.id);
  });
  await check("judul dibersihkan hanya pada presentasi dan label numerik diberi fallback", () => {
    const row = { key: first.id, accountId: a.id, accountLabel: a.label, variantId: variant.id, platformProductId: "101", platformTitle: "Kaos Kaki ( ) ()", status: "NORMAL", channelSku: "101:0", variantCount: 1, stockTotal: 0, imageUrl: null, lastSyncedAt: null };
    assert.equal(productTitle(row), "Kaos Kaki");
    assert.equal(row.platformTitle, "Kaos Kaki ( ) ()");
    assert.equal(storeName("123456"), "Nama toko belum diatur");
    assert.equal(storeName("Shopee (123456)"), "Nama toko belum diatur");
  });
  const token = createSessionToken(user, business.id);
  async function post(body?: unknown) {
    const headers: Record<string, string> = { cookie: `maxius_session=${token}`, Origin: "http://localhost:3100" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return POST(new NextRequest("http://localhost:3100/api/marketplace/shopee/products/sync", { method: "POST", headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({}) });
  }
  await check("sinkron satu produk tidak menyentuh produk/toko lain atau stok pusat", async () => {
    calls.length = 0;
    const response = await post({ products: [{ accountId: a.id, productId: "101" }] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accounts[0].matched, 1);
    assert.ok(calls.every((url) => url.searchParams.get("shop_id") === "111"));
    assert.ok(calls.every((url) => !url.pathname.endsWith("get_item_list")));
    assert.equal((await prisma.productMapping.findUniqueOrThrow({ where: { id: first.id } })).platformTitle, "Terbaru 101");
    assert.equal((await prisma.productMapping.findFirstOrThrow({ where: { accountId: b.id, platformProductId: "101" } })).platformTitle, "Kaos Kaki 101 ()");
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock, 99);
  });
  await check("bulk sinkron menggunakan pasangan toko dan produk", async () => {
    calls.length = 0;
    const response = await post({ products: [{ accountId: a.id, productId: "102" }, { accountId: b.id, productId: "101" }] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accounts.length, 2);
    const baseCalls = calls.filter((url) => url.pathname.endsWith("get_item_base_info"));
    assert.deepEqual(baseCalls.map((url) => [url.searchParams.get("shop_id"), url.searchParams.get("item_id_list")]).sort(), [["111", "102"], ["222", "101"]]);
  });
  await check("toko asing, platform lain, ID salah, dan array kosong ditolak sebelum API", async () => {
    calls.length = 0;
    for (const account of [foreign, tiktok]) assert.equal((await post({ accountIds: [account.id] })).status, 404);
    assert.equal((await post({ products: [{ accountId: a.id, productId: "999" }] })).status, 404);
    assert.equal((await post({ products: [] })).status, 400);
    assert.equal((await post({ accountIds: [] })).status, 400);
    assert.equal((await post({ products: [{ accountId: a.id, productId: "1e3" }] })).status, 400);
    assert.equal(calls.length, 0);
  });
  await check("sinkron toko terpilih dan kontrak bodyless lama tetap bekerja", async () => {
    calls.length = 0;
    assert.equal((await post({ accountIds: [b.id] })).status, 200);
    assert.ok(calls.every((url) => url.searchParams.get("shop_id") === "222"));
    calls.length = 0;
    assert.equal((await post()).status, 200);
    assert.deepEqual([...new Set(calls.map((url) => url.searchParams.get("shop_id")))].sort(), ["111", "222"]);
  });
  console.log(`${passed} Shopee product integration checks passed`);
} finally {
  globalThis.fetch = originalFetch;
  await prisma.$disconnect();
  db.cleanup();
}
