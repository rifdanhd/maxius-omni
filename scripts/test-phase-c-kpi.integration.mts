/**
 * [TEST] PHASE C.1 — Dashboard KPI: korektness angka vs fixture diketahui.
 *
 * DB fixture ASLI (SQLite temp + migrate deploy). Read-only: assert angka
 * persis + assert tidak ada mutasi (count semua tabel tetap).
 *
 * Fixture:
 *  - 2 akun (TikTok bertoken, Shopee tanpa token)
 *  - 3 varian: A stok 100/safety 10 (ok), B stok 5/safety 0 (low),
 *    C stok 0 (out) → central units 105, sellable 95, lowStock count 2
 *  - SyncJob: 1 FAILED + 1 PENDING retry1 + 1 PENDING segar + 1 SUCCESS
 *    → mismatch total 2 (failed 1, pendingRetry 1)
 *  - SyncLog: 2 error (kind a/b) dalam 7d + 1 error lama (>7d, dikecualikan)
 *
 * Jalankan: npx tsx scripts/test-phase-c-kpi.integration.mts
 */
import crypto from "crypto";
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-phase-c-kpi-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const { getDashboardKpi } = await import("@/lib/services/dashboard-kpi.service");

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const business = await prisma.business.create({ data: { name: "Phase C.1" } });
const tiktokAcc = await prisma.platformAccount.create({
  data: {
    platform: "TIKTOK_SHOP", label: "TikTok 1", businessId: business.id,
    accessToken: "tok", shopCipher: "cip",
  },
});
const shopeeAcc = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee 1", businessId: business.id },
});
const master = await prisma.masterProduct.create({
  data: { name: "Produk KPI", businessId: business.id, threshold: 5 },
});
const vA = await prisma.productVariant.create({
  data: { sku: "KPI-A", stock: 100, safetyStock: 10, masterProductId: master.id },
});
const vB = await prisma.productVariant.create({
  data: { sku: "KPI-B", stock: 5, safetyStock: 0, masterProductId: master.id },
});
await prisma.productVariant.create({
  data: { sku: "KPI-C", stock: 0, safetyStock: 0, masterProductId: master.id },
});

async function mkJob(channelSku: string, status: string, retryCount: number) {
  return prisma.syncJob.create({
    data: {
      variantId: vA.id, accountId: shopeeAcc.id, channelSku,
      newSellable: 90, status, retryCount,
      lastError: status === "PENDING" && retryCount === 0 ? null : "err",
    },
  });
}
await mkJob("KPI-FAIL", "FAILED", 3);
await mkJob("KPI-RETRY", "PENDING", 1);
await mkJob("KPI-FRESH", "PENDING", 0);
await mkJob("KPI-OK", "SUCCESS", 0);

async function mkLog(accountId: string, kind: string, status: string, daysAgo: number) {
  return prisma.syncLog.create({
    data: {
      direction: "out", kind, status, message: `${kind}/${status}`,
      payload: "{}",
      accountId,
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    },
  });
}
await mkLog(shopeeAcc.id, "stock_push", "error", 1);
await mkLog(shopeeAcc.id, "price_push", "error", 2);
await mkLog(tiktokAcc.id, "stock_push", "error", 30);
await mkLog(tiktokAcc.id, "stock_push", "success", 0);

const order = await prisma.order.create({
  data: {
    id: crypto.randomUUID(),
    orderNo: "KPI-1", status: "AWAITING_SHIPMENT", accountId: tiktokAcc.id,
    createTime: new Date(),
    items: { create: { id: crypto.randomUUID(), qty: 2, channelSku: "TT-1", variantId: vA.id, price: 50000 } },
  },
});

async function counts() {
  const [o, oi, v, j, l] = await Promise.all([
    prisma.order.count(), prisma.orderItem.count(), prisma.productVariant.count(),
    prisma.syncJob.count(), prisma.syncLog.count(),
  ]);
  return [o, oi, v, j, l].join(",");
}
const before = await counts();

console.log("=== PHASE C.1: Dashboard KPI ===");
await ok("central stock: 3 varian, 105 units, 95 sellable", async () => {
  const kpi = await getDashboardKpi("business-default");
  assert.equal(kpi.centralStock.variantCount, 3);
  assert.equal(kpi.centralStock.totalUnits, 105);
  assert.equal(kpi.centralStock.totalSellable, 95);
});

await ok("low stock: count 2 (B low, C out), top terurut sellable", async () => {
  const kpi = await getDashboardKpi("business-default");
  assert.equal(kpi.lowStock.count, 2);
  assert.equal(kpi.lowStock.top[0].sku, "KPI-C");
  assert.equal(kpi.lowStock.top[0].severity, "out");
  assert.equal(kpi.lowStock.top[1].sku, "KPI-B");
  assert.equal(kpi.lowStock.top[1].severity, "low");
  assert.equal(kpi.lowStock.top[1].sellable, 5);
});

await ok("mismatch reuse predikat B: total 2 (failed 1, pendingRetry 1)", async () => {
  const kpi = await getDashboardKpi("business-default");
  assert.deepEqual(kpi.mismatch, { total: 2, failed: 1, pendingRetry: 1 });
});

await ok("sync error 7d: 2 (error lama dikecualikan), byKind benar", async () => {
  const kpi = await getDashboardKpi("business-default");
  assert.equal(kpi.syncErrors.count7d, 2);
  assert.deepEqual(
    kpi.syncErrors.byKind.map((g) => g.kind).sort(),
    ["price_push", "stock_push"]
  );
});

await ok("store health fakta-DB: token/cipher boolean, aktivitas, error, mismatch", async () => {
  const kpi = await getDashboardKpi("business-default");
  assert.equal(kpi.storeHealth.length, 2);
  const tt = kpi.storeHealth.find((s) => s.accountId === tiktokAcc.id)!;
  const sp = kpi.storeHealth.find((s) => s.accountId === shopeeAcc.id)!;
  assert.equal(tt.hasToken, true);
  assert.equal(tt.hasCipher, true);
  assert.ok(tt.lastOrderAt instanceof Date, "order KPI-1 terbaca");
  assert.ok(tt.lastSyncAt instanceof Date);
  assert.equal(tt.errors7d, 0);
  assert.equal(tt.mismatch, 0);
  assert.equal(sp.hasToken, false);
  assert.equal(sp.hasCipher, false);
  assert.equal(sp.lastOrderAt, null);
  assert.equal(sp.errors7d, 2);
  assert.equal(sp.mismatch, 2);
  void order;
  void vB;
});

await ok("read-only: count semua tabel tidak berubah", async () => {
  assert.equal(await counts(), before);
});

await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (phase-c-kpi). DB fixture dihapus.`);
