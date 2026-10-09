import assert from "node:assert/strict";
import crypto from "node:crypto";
import { setupTestDb } from "@/scripts/lib/test-db";

const db = setupTestDb("mapping-safety");
process.env.PII_ENC_KEY = "ab".repeat(32);
process.env.TIKTOK_APP_KEY = "mapping-test-key";
process.env.TIKTOK_APP_SECRET = "mapping-test-secret";

const { prisma } = await import("@/lib/db/prisma");
const { findOrphanSkus, mapOrphanToVariant, backfillOrderItems, reconcileMappedOrders } = await import("@/lib/services/orphan-sku.service");
const { resolveVariantId, ingestTikTokOrdersPage } = await import("@/lib/services/order-sync.service");
const { deductStockForOrder, restoreStockForCanceledOrder, STOCK_REASONS } = await import("@/lib/services/central-stock.service");
const { getTikTokUnmapped, syncTikTokListings } = await import("@/lib/services/marketplace-tiktok.service");

const business = await prisma.business.create({ data: { name: "Mapping safety" } });
const otherBusiness = await prisma.business.create({ data: { name: "Other brand" } });
const account = await prisma.platformAccount.create({ data: { platform: "TIKTOK_SHOP", label: "Mapping A", businessId: business.id, accessToken: "test-a", shopCipher: "test-cipher" } });
const accountB = await prisma.platformAccount.create({ data: { platform: "SHOPEE", label: "Mapping B", businessId: business.id } });
const accountOther = await prisma.platformAccount.create({ data: { platform: "SHOPEE", label: "Other brand", businessId: otherBusiness.id } });
await prisma.inventorySetting.create({ data: { id: business.id, businessId: business.id, syncPushTiktok: false, syncPushShopee: false, syncPushTokopedia: false } });
const master = await prisma.masterProduct.create({ data: { name: "Mapping master", businessId: business.id } });
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`PASS ${++passed}: ${name}`);
}
const variant = (sku: string, stock = 10) => prisma.productVariant.create({ data: { sku, stock, masterProductId: master.id } });
const mapping = (channelSku: string, variantId: string, accountId = account.id) => prisma.productMapping.create({ data: { id: crypto.randomUUID(), channelSku, variantId, accountId, updatedAt: new Date() } });
async function order(channelSku: string, qty: number, variantId: string | null, accountId = account.id, status = "AWAITING_SHIPMENT") {
  return prisma.order.create({ data: {
    id: crypto.randomUUID(), orderNo: crypto.randomUUID(), status, accountId, updatedAt: new Date(), createTime: new Date(),
    items: { create: { id: crypto.randomUUID(), channelSku, qty, variantId } },
  } });
}
const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
const orderLedgers = (id: string) => prisma.stockLedger.findMany({ where: { referenceId: id, reason: "ORDER" } });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input) => {
  const url = new URL(String(input));
  assert.match(url.pathname, /\/products\/search$/);
  return new Response(JSON.stringify({ code: 0, data: { products: [{ id: "product-multi", title: "Two variants", status: "ACTIVE", skus: [
    { id: "remote-red", seller_sku: "SELLER-RED" }, { id: "remote-blue", seller_sku: "SELLER-BLUE" },
  ] }], next_page_token: null } }));
}) as typeof fetch;

try {
  await check("orphan quantities and order counts stay separate per shop and brand", async () => {
    const a = await order("SAME-SKU", 2, null);
    await prisma.orderItem.create({ data: { id: crypto.randomUUID(), orderId: a.id, channelSku: "SAME-SKU", qty: 1 } });
    await order("SAME-SKU", 5, null, accountB.id);
    await order("SAME-SKU", 100, null, accountOther.id);
    const rows = (await findOrphanSkus(business.id)).filter((r) => r.channelSku === "SAME-SKU");
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.accountId === account.id)?.qty, 3);
    assert.equal(rows.find((r) => r.accountId === account.id)?.orderCount, 1);
    assert.equal(rows.find((r) => r.accountId === accountB.id)?.qty, 5);
  });

  const red = await variant("RED");
  await mapping("SELLER-RED", red.id);
  await check("legacy seller SKU resolves orders carrying canonical sku_id", async () => {
    assert.equal(await resolveVariantId(prisma, account.id, "remote-red", ["SELLER-RED"]), red.id);
    assert.equal(await resolveVariantId(prisma, accountB.id, "remote-red", ["SELLER-RED"]), null);
    const result = { fetched: 1, created: 0, skipped: 0, errors: [] as string[], reconciled: 0, reconcileScan: 0, trackingEvents: 0 };
    await ingestTikTokOrdersPage(prisma, account.id, [{ id: "legacy-order", status: "UNPAID", line_items: [{ sku_id: "remote-red", seller_sku: "SELLER-RED", product_id: "product-multi" }] }], result);
    assert.deepEqual(result.errors, []);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { order: { orderNo: "legacy-order" } } });
    assert.equal(item.variantId, red.id);
    assert.equal(item.channelSku, "remote-red");
  });

  await check("conflicting canonical and legacy mappings fail instead of choosing a variant", async () => {
    const other = await variant("CONFLICT");
    const conflict = await mapping("remote-red", other.id);
    await assert.rejects(resolveVariantId(prisma, account.id, "remote-red", ["SELLER-RED"]), /bertentangan/);
    await prisma.productMapping.delete({ where: { id: conflict.id } });
  });

  await check("partial products still offer every unmapped sibling on reload", async () => {
    const rows = await getTikTokUnmapped(business.id, account.id);
    assert.deepEqual(rows[0].unmapped[0].skus.map((s) => s.skuId), ["remote-blue"]);
    assert.deepEqual((await syncTikTokListings(business.id, account.id))[0].unmapped[0].skus.map((s) => s.skuId), ["remote-blue"]);
    const placeholder = await prisma.productMapping.create({ data: { id: crypto.randomUUID(), channelSku: "remote-blue", variantId: null, accountId: account.id, updatedAt: new Date() } });
    assert.deepEqual((await getTikTokUnmapped(business.id, account.id))[0].unmapped[0].skus.map((s) => s.skuId), ["remote-blue"]);
    await prisma.productMapping.delete({ where: { id: placeholder.id } });
    const blue = await variant("BLUE");
    await mapping("remote-blue", blue.id);
    assert.deepEqual((await getTikTokUnmapped(business.id, account.id))[0].unmapped, []);
  });

  await check("backfill aliases only touches orphan items belonging to the selected shop", async () => {
    const target = await variant("ALIAS");
    await order("old-alias", 1, null);
    await order("new-canonical", 1, null);
    await order("old-alias", 1, null, accountB.id);
    assert.equal(await backfillOrderItems(account.id, "new-canonical", target.id, prisma, ["old-alias"]), 2);
    assert.equal(await prisma.orderItem.count({ where: { channelSku: "old-alias", variantId: null, order: { accountId: accountB.id } } }), 1);
  });

  const a = await variant("PARTIAL-A");
  const b = await variant("PARTIAL-B");
  await mapping("PARTIAL-A", a.id);
  const mixed = await order("PARTIAL-A", 2, a.id);
  await prisma.orderItem.create({ data: { id: crypto.randomUUID(), orderId: mixed.id, channelSku: "PARTIAL-B", qty: 3 } });
  await check("mapping a late item deducts B without deducting A twice", async () => {
    assert.equal((await deductStockForOrder(mixed.id)).ok, true);
    assert.equal(await stock(a.id), 8);
    const result = await mapOrphanToVariant({ accountId: account.id, channelSku: "PARTIAL-B", variantId: b.id });
    assert.ok(result.ok);
    if (result.ok) assert.deepEqual(result.stockWarnings, []);
    assert.equal(await stock(a.id), 8);
    assert.equal(await stock(b.id), 7);
    assert.equal((await orderLedgers(mixed.id)).length, 2);
  });

  await check("parallel retries of partially mapped orders remain idempotent", async () => {
    await Promise.all([deductStockForOrder(mixed.id), deductStockForOrder(mixed.id), reconcileMappedOrders(account.id, b.id)]);
    assert.equal(await stock(a.id), 8);
    assert.equal(await stock(b.id), 7);
    assert.equal((await orderLedgers(mixed.id)).length, 2);
  });

  await check("cancel restores both the original and late mapped variants once", async () => {
    await prisma.order.update({ where: { id: mixed.id }, data: { status: "CANCELLED" } });
    await Promise.all([restoreStockForCanceledOrder(mixed.id, STOCK_REASONS.ORDER_CANCELLED), restoreStockForCanceledOrder(mixed.id, STOCK_REASONS.ORDER_REFUNDED), deductStockForOrder(mixed.id)]);
    assert.equal(await stock(a.id), 10);
    assert.equal(await stock(b.id), 10);
    assert.equal(await prisma.stockLedger.count({ where: { referenceId: mixed.id, reason: { in: ["ORDER_CANCELLED", "ORDER_REFUNDED"] } } }), 2);
  });

  await check("historical and cancelled orders backfill without deducting current stock", async () => {
    const v = await variant("HISTORY");
    const completed = await order("HISTORY", 4, null, account.id, "COMPLETED");
    const cancelled = await order("HISTORY", 2, null, account.id, "CANCELLED");
    const result = await mapOrphanToVariant({ accountId: account.id, channelSku: "HISTORY", variantId: v.id });
    assert.ok(result.ok);
    assert.equal(await stock(v.id), 10);
    assert.equal((await orderLedgers(completed.id)).length, 0);
    assert.equal((await orderLedgers(cancelled.id)).length, 0);
  });

  await check("shortage is visible and can be retried after restocking", async () => {
    const v = await variant("SHORTAGE", 0);
    const active = await order("SHORTAGE", 3, null);
    const first = await mapOrphanToVariant({ accountId: account.id, channelSku: "SHORTAGE", variantId: v.id });
    assert.ok(first.ok);
    if (first.ok) assert.match(first.stockWarnings.join(" "), /Stok tidak cukup/);
    assert.equal((await orderLedgers(active.id)).length, 0);
    await prisma.productVariant.update({ where: { id: v.id }, data: { stock: 5 } });
    const retry = await mapOrphanToVariant({ accountId: account.id, channelSku: "SHORTAGE", variantId: v.id });
    assert.ok(retry.ok);
    if (retry.ok) assert.deepEqual(retry.stockWarnings, []);
    assert.equal(await stock(v.id), 2);
    assert.equal((await orderLedgers(active.id)).length, 1);
  });

  await check("refreshing an existing shipped TikTok order repairs an orphan before deducting", async () => {
    const v = await variant("REFRESH");
    await mapping("REFRESH-SELLER", v.id);
    const existing = await order("refresh-sku-id", 1, null, account.id, "IN_TRANSIT");
    await prisma.platformOrderMapping.create({ data: { id: crypto.randomUUID(), accountId: account.id, externalOrderId: "refresh-order", rawStatus: "IN_TRANSIT", orderId: existing.id } });
    const result = { fetched: 1, created: 0, skipped: 0, errors: [] as string[], reconciled: 0, reconcileScan: 0, trackingEvents: 0 };
    await ingestTikTokOrdersPage(prisma, account.id, [{ id: "refresh-order", status: "IN_TRANSIT", line_items: [{ sku_id: "refresh-sku-id", seller_sku: "REFRESH-SELLER" }] }], result);
    assert.deepEqual(result.errors, []);
    assert.equal(await stock(v.id), 9);
    assert.equal((await orderLedgers(existing.id)).length, 1);
  });

  console.log(`${passed} mapping safety integration checks passed.`);
} finally {
  globalThis.fetch = realFetch;
  await prisma.$disconnect();
  db.cleanup();
}
