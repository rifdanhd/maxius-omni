import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupTestDb } from "./lib/test-db";
import { stockReviewReason } from "../lib/services/stock-review.policy";

const db = setupTestDb("test-stock-review");
const { prisma } = await import("../lib/db/prisma");
const { getStockReviews } = await import("../lib/services/stock-review.service");
const { updateInventorySettings } = await import("../lib/services/inventory-settings.service");
globalThis.fetch = async () => { throw new Error("Pengujian tidak boleh memanggil marketplace"); };
try {
  for (const quantity of [9999, 88888, 99999, 88887, 10000, 1000, 888888]) assert.ok(stockReviewReason(quantity));
  for (const quantity of [0, 1, 999, 1234]) assert.equal(stockReviewReason(quantity), null);
  const business = await prisma.business.create({ data: { name: "Review A" } });
  const other = await prisma.business.create({ data: { name: "Review B" } });
  const master = await prisma.masterProduct.create({ data: { businessId: business.id, name: "Review master" } });
  const variant = await prisma.productVariant.create({ data: { masterProductId: master.id, sku: "SUSPICIOUS", stock: 88888 } });
  await prisma.stockLedger.create({ data: { id: randomUUID(), variantId: variant.id, reason: "INIT", changeQty: 88888, stockAfter: 88888, createdAt: new Date("2026-01-01") } });
  const account = await prisma.platformAccount.create({ data: { businessId: business.id, platform: "SHOPEE", label: "Fixture" } });
  await prisma.productMapping.create({ data: { accountId: account.id, channelSku: "1:0", variantId: variant.id, updatedAt: new Date() } });
  assert.equal((await getStockReviews(business.id)).length, 1);
  assert.equal((await getStockReviews(other.id)).length, 0);
  const ledgerBefore = await prisma.stockLedger.count();
  await assert.rejects(updateInventorySettings(business.id, { stockBaselineReady: true }), /Baseline perlu ditinjau/);
  assert.equal((await prisma.inventorySetting.findUniqueOrThrow({ where: { businessId: business.id } })).stockBaselineReady, false);
  assert.equal(await prisma.stockLedger.count(), ledgerBefore);
  assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock, 88888);
  await prisma.productVariant.update({ where: { id: variant.id }, data: { stock: 20 } });
  assert.equal((await getStockReviews(business.id)).length, 1, "Mengubah angka saat ini tidak menghapus bukti stok awal tidak wajar");
  await prisma.productVariant.update({ where: { id: variant.id }, data: { isArchived: true } });
  assert.equal((await getStockReviews(business.id)).length, 0);
  await prisma.productVariant.update({ where: { id: variant.id }, data: { isArchived: false } });
  await prisma.stockLedger.create({ data: { id: randomUUID(), variantId: variant.id, reason: "INITIAL_STOCK", changeQty: -88868, stockAfter: 20, note: "Fixture hasil verifikasi fisik" } });
  assert.equal((await getStockReviews(business.id)).length, 0);
  assert.equal((await updateInventorySettings(business.id, { stockBaselineReady: true })).stockBaselineReady, true);
  console.log("PASS: suspicious values, tenant isolation, baseline block, unchanged stock/ledger, archive exclusion, verified initial stock");
} finally {
  await prisma.$disconnect();
  db.cleanup();
}
