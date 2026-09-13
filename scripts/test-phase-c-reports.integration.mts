/**
 * [TEST] PHASE C.2 — Winning/Omset: korektness agregasi vs fixture diketahui.
 *
 * DB fixture ASLI (SQLite temp + migrate deploy). Read-only: assert angka
 * persis + count tabel tetap.
 *
 * Fixture (semua createTime = sekarang, dalam range default 30d):
 *  - Akun: TikTok T1, Shopee S1. Produk: P-A (cat Sepatu, varian A1/A2),
 *    P-B (tanpa kategori, varian B1).
 *  - O1 (T1, DELIVERED): A1 x2 @100rb + B1 x1 @50rb  → rev 250rb, units 3
 *  - O2 (S1, AWAITING_SHIPMENT): A1 x1 @100rb + A2 x3 @80rb → rev 340rb, units 4
 *  - O3 (T1, CANCELLED): A2 x10 @80rb → DIKECUALIKAN seluruhnya
 *  - O4 (S1, DELIVERED, tanpa item, amount 75rb) → fallback amount
 *
 * Ekspektasi: total orders 3, revenue 665rb, units 7.
 * Winning variant qty: A2=3, A1=3, B1=1 (A1 rev 300rb > A2 rev 240rb).
 * Winning product qty: P-A=6, P-B=1.
 *
 * Jalankan: npx tsx scripts/test-phase-c-reports.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-phase-c-reports-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const { getWinning, getOmset, parseReportRange } = await import(
  "@/lib/services/sales-report.service"
);

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const business = await prisma.business.create({ data: { name: "Phase C.2" } });
const t1 = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "TikTok 1", businessId: business.id },
});
const s1 = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee 1", businessId: business.id },
});
const pA = await prisma.masterProduct.create({
  data: { name: "Produk A", category: "Sepatu", businessId: business.id, threshold: 5 },
});
const pB = await prisma.masterProduct.create({
  data: { name: "Produk B", businessId: business.id, threshold: 5 },
});
const a1 = await prisma.productVariant.create({ data: { sku: "A1", stock: 10, masterProductId: pA.id } });
const a2 = await prisma.productVariant.create({ data: { sku: "A2", stock: 10, masterProductId: pA.id } });
const b1 = await prisma.productVariant.create({ data: { sku: "B1", stock: 10, masterProductId: pB.id } });

const now = new Date();
async function mkOrder(accountId: string, orderNo: string, status: string, items: Array<{ variantId?: string; channelSku: string; qty: number; price?: number }>, amount?: number) {
  return prisma.order.create({
    data: {
      orderNo, status, accountId, createTime: now, amount,
      items: { create: items.map((i) => ({ ...i })) },
    },
  });
}
await mkOrder(t1.id, "O1", "DELIVERED", [
  { variantId: a1.id, channelSku: "TT-A1", qty: 2, price: 100_000 },
  { variantId: b1.id, channelSku: "TT-B1", qty: 1, price: 50_000 },
]);
await mkOrder(s1.id, "O2", "AWAITING_SHIPMENT", [
  { variantId: a1.id, channelSku: "SP-A1", qty: 1, price: 100_000 },
  { variantId: a2.id, channelSku: "SP-A2", qty: 3, price: 80_000 },
]);
await mkOrder(t1.id, "O3", "CANCELLED", [
  { variantId: a2.id, channelSku: "TT-A2", qty: 10, price: 80_000 },
]);
await mkOrder(s1.id, "O4", "DELIVERED", [], 75_000);

const { fromMs, toMs } = parseReportRange(null, null);
const F = { fromMs, toMs, platform: null, accountId: null };

async function counts() {
  return [await prisma.order.count(), await prisma.orderItem.count()].join(",");
}
const before = await counts();

console.log("=== PHASE C.2: Winning / Omset ===");
await ok("omset total: 3 order, 665rb, 7 units (cancelled dikecualikan, amount fallback)", async () => {
  const r = await getOmset(F);
  assert.equal(r.total.orders, 3);
  assert.equal(r.total.revenue, 665_000);
  assert.equal(r.total.units, 7);
  assert.equal(r.buckets.length, 1, "semua order 1 hari Jakarta yang sama");
  assert.equal(r.buckets[0].revenue, 665_000);
});

await ok("drilldown platform → akun → kategori", async () => {
  const r = await getOmset(F);
  const byPlat = Object.fromEntries(r.byPlatform.map((s) => [s.id, s.revenue]));
  assert.equal(byPlat["TIKTOK_SHOP"], 250_000);
  assert.equal(byPlat["SHOPEE"], 415_000);
  const byAcc = Object.fromEntries(r.byAccount.map((s) => [s.label, s.revenue]));
  assert.equal(byAcc["TikTok 1"], 250_000);
  assert.equal(byAcc["Shopee 1"], 415_000);
  const byCat = Object.fromEntries(r.byCategory.map((s) => [s.label, s]));
  assert.equal(byCat["Sepatu"].revenue, 540_000);
  assert.equal(byCat["Sepatu"].units, 6);
  assert.equal(byCat["(Tanpa Kategori)"].revenue, 50_000);
});

await ok("filter platform & accountId mempersempit dgn benar", async () => {
  const tik = await getOmset({ ...F, platform: "TIKTOK_SHOP" });
  assert.equal(tik.total.orders, 1);
  assert.equal(tik.total.revenue, 250_000);
  const s1r = await getOmset({ ...F, accountId: s1.id });
  assert.equal(s1r.total.orders, 2);
  assert.equal(s1r.total.revenue, 415_000);
});

await ok("winning variant: urutan qty + revenue + join nama", async () => {
  // Grouping per (variant, channelSku) seperti analytics-agg: A1 terpecah
  // TT-A1 qty2 + SP-A1 qty1; A2/SP-A2 qty3 teratas.
  const rows = await getWinning(F, "variant", 10);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.qty), [3, 2, 1, 1]);
  assert.equal(rows[0].sku, "A2");
  assert.equal(rows[0].revenue, 240_000);
  const a1rows = rows.filter((r) => r.sku === "A1");
  assert.equal(a1rows.reduce((s, r) => s + r.qty, 0), 3);
  assert.equal(a1rows.reduce((s, r) => s + r.revenue, 0), 300_000);
  assert.equal(rows[0].productName, "Produk A");
  assert.equal(rows[0].category, "Sepatu");
});

await ok("winning product: P-A qty 6 rev 540rb, P-B qty 1", async () => {
  const rows = await getWinning(F, "product", 10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].productName, "Produk A");
  assert.equal(rows[0].qty, 6);
  assert.equal(rows[0].revenue, 540_000);
  assert.equal(rows[1].productName, "Produk B");
  assert.equal(rows[1].qty, 1);
});

await ok("parseReportRange: custom + rusak + batas 366 hari", async () => {
  const custom = parseReportRange("2026-01-01", "2026-01-07");
  assert.equal(custom.toMs - custom.fromMs, 7 * 86_400_000);
  const broken = parseReportRange("xxx", null);
  assert.ok(broken.toMs > broken.fromMs);
  const wide = parseReportRange("2020-01-01", "2026-09-13");
  assert.ok(wide.toMs - wide.fromMs <= 366 * 86_400_000);
});

await ok("read-only: count order/item tetap", async () => {
  assert.equal(await counts(), before);
});

await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (phase-c-reports). DB fixture dihapus.`);
