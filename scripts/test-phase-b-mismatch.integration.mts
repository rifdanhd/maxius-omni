/**
 * [TEST] PHASE B.1 — Stock Mismatch View (read-only).
 *
 * DB fixture ASLI (SQLite temp + migrate deploy).
 * Assert:
 *  1. Filter default "mismatch" → hanya FAILED + PENDING retry>=1
 *     (PENDING segar & SUCCESS dikecualikan).
 *  2. Join display: nama produk, channelSku, akun, centralStock
 *     (effectiveStock) vs newSellable, retryCount, lastError.
 *  3. Filter eksplisit FAILED / PENDING / SUCCESS / all.
 *  4. Search q (SKU produk & channelSku) + cursor pagination.
 *  5. Read-only: jumlah SyncJob tidak berubah setelah query.
 *
 * Jalankan: npx tsx scripts/test-phase-b-mismatch.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-phase-b-mismatch-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const { listMismatchSyncJobs } = await import("@/lib/services/sync-mismatch.service");

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ── Fixture ── */
const business = await prisma.business.create({ data: { name: "Phase B.1" } });
const shopeeAcc = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee 1", businessId: business.id },
});
const master = await prisma.masterProduct.create({
  data: { name: "Kaos Kaki Test", businessId: business.id, threshold: 5 },
});
const variant = await prisma.productVariant.create({
  data: { sku: "TST-S-H", name: "Hitam - M", stock: 100, safetyStock: 10, masterProductId: master.id },
});

async function mkJob(data: {
  channelSku: string;
  newSellable: number;
  status: string;
  retryCount?: number;
  lastError?: string | null;
}) {
  // Unique (variantId, accountId, channelSku, status) → bedakan channelSku per job.
  return prisma.syncJob.create({
    data: {
      variantId: variant.id,
      accountId: shopeeAcc.id,
      channelSku: data.channelSku,
      newSellable: data.newSellable,
      status: data.status,
      retryCount: data.retryCount ?? 0,
      lastError: data.lastError ?? null,
    },
  });
}

await mkJob({ channelSku: "CH-FAIL", newSellable: 90, status: "FAILED", retryCount: 3, lastError: "Shopee timeout" });
await mkJob({ channelSku: "CH-RETRY", newSellable: 95, status: "PENDING", retryCount: 1, lastError: "token expired" });
await mkJob({ channelSku: "CH-FRESH", newSellable: 100, status: "PENDING", retryCount: 0 });
await mkJob({ channelSku: "CH-OK", newSellable: 100, status: "SUCCESS", retryCount: 0 });

console.log("=== PHASE B.1: Mismatch View ===");
await ok("default mismatch → FAILED + PENDING retry>=1 saja", async () => {
  const { rows } = await listMismatchSyncJobs({ businessId: "business-default", });
  const skus = rows.map((r) => r.channelSku).sort();
  assert.deepEqual(skus, ["CH-FAIL", "CH-RETRY"]);
});

await ok("join display lengkap + centralStock = effectiveStock(100,10) = 90", async () => {
  const { rows } = await listMismatchSyncJobs({ businessId: "business-default",  status: "FAILED" });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.variant.productName, "Kaos Kaki Test");
  assert.equal(r.variant.sku, "TST-S-H");
  assert.equal(r.account.label, "Shopee 1");
  assert.equal(r.account.platform, "SHOPEE");
  assert.equal(r.variant.centralStock, 90);
  assert.equal(r.newSellable, 90);
  assert.equal(r.retryCount, 3);
  assert.equal(r.maxRetries, 3);
  assert.ok((r.lastError ?? "").includes("timeout"));
});

await ok("filter eksplisit per status", async () => {
  const failed = await listMismatchSyncJobs({ businessId: "business-default",  status: "FAILED" });
  assert.equal(failed.rows.length, 1);
  const pending = await listMismatchSyncJobs({ businessId: "business-default",  status: "PENDING" });
  assert.equal(pending.rows.map((r) => r.channelSku).sort().join(","), "CH-FRESH,CH-RETRY");
  const success = await listMismatchSyncJobs({ businessId: "business-default",  status: "SUCCESS" });
  assert.equal(success.rows.length, 1);
  const all = await listMismatchSyncJobs({ businessId: "business-default",  status: "all" });
  assert.equal(all.rows.length, 4);
});

await ok("search q: SKU produk & channelSku", async () => {
  const bySku = await listMismatchSyncJobs({ businessId: "business-default",  status: "all", q: "TST-S-H" });
  assert.equal(bySku.rows.length, 4);
  const byChannel = await listMismatchSyncJobs({ businessId: "business-default",  status: "all", q: "CH-FAIL" });
  assert.equal(byChannel.rows.length, 1);
  assert.equal(byChannel.rows[0].channelSku, "CH-FAIL");
  const miss = await listMismatchSyncJobs({ businessId: "business-default",  status: "all", q: "TIDAK-ADA-XYZ" });
  assert.equal(miss.rows.length, 0);
});

await ok("cursor pagination stabil (limit 2 → 2+2, tanpa dobel/hilang)", async () => {
  const p1 = await listMismatchSyncJobs({ businessId: "business-default",  status: "all", limit: 2 });
  assert.equal(p1.rows.length, 2);
  assert.ok(p1.nextCursor);
  const p2 = await listMismatchSyncJobs({ businessId: "business-default",  status: "all", limit: 2, cursor: p1.nextCursor });
  assert.equal(p2.rows.length, 2);
  const ids = [...p1.rows, ...p2.rows].map((r) => r.id);
  assert.equal(new Set(ids).size, 4);
});

await ok("read-only: jumlah SyncJob tetap 4 setelah semua query", async () => {
  assert.equal(await prisma.syncJob.count(), 4);
});

await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (phase-b-mismatch). DB fixture dihapus.`);
