/**
 * [TEST] PHASE B.4 — Shopee adapter REAL (paralel TikTok, eksplisit).
 *
 * DB fixture ASLI (SQLite temp + migrate deploy).
 * Assert:
 *  1. syncStockToMarketplaces utk SHOPEE tanpa token → success:false + error jelas
 *     "belum terhubung OAuth" (BUKAN throw, BUKAN silent).
 *  2. Jejak SyncLog tertulis utk Shopee.
 *  3. Isolasi: TikTok bertoken sukses + Shopee gagal → 2 hasil, tidak saling
 *     membatalkan.
 *  4. Ujung-ke-ujung via worker resmi: job Shopee → PENDING retry (bukan
 *     SUCCESS palsu), central stock utuh.
 *  5. syncPriceToMarketplaces utk SHOPEE → tidak throw + SyncLog price_push
 *     skipped eksplisit.
 *
 * Jalankan: npx tsx scripts/test-phase-b-shopee.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-phase-b-shopee-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const { syncStockToMarketplaces, syncPriceToMarketplaces } = await import(
  "@/lib/services/sync.service"
);
const { enqueueSyncJobs, processDueSyncJobs } = await import("@/lib/services/sync-job.service");

// Akun Shopee tanpa token = belum OAuth → push wajib skipped eksplisit.
const NOT_CONNECTED_HINT = "OAuth";

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const business = await prisma.business.create({ data: { name: "Phase B.4" } });
const shopeeAcc = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee 1", businessId: business.id },
});
const tiktokAcc = await prisma.platformAccount.create({
  data: {
    platform: "TIKTOK_SHOP",
    label: "TikTok bertoken",
    businessId: business.id,
    accessToken: "tok-fixture",
    shopCipher: "cip-fixture",
  },
});

console.log("=== PHASE B.4: Shopee adapter (real) ===");
await ok("Shopee tanpa token → success:false + error OAuth eksplisit, tanpa throw", async () => {
  const results = await syncStockToMarketplaces(
    [{ accountId: shopeeAcc.id, channelSku: "SP-1" }],
    42
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].success, false);
  assert.equal(results[0].skipped, true);
  assert.ok((results[0].error ?? "").includes(NOT_CONNECTED_HINT));
});

await ok("jejak SyncLog tertulis (tidak silent)", async () => {
  const logs = await prisma.syncLog.findMany({
    where: { accountId: shopeeAcc.id, kind: "stock_push" },
  });
  assert.ok(logs.length >= 1);
  assert.ok((logs[0].message ?? "").includes(NOT_CONNECTED_HINT));
});

await ok("isolasi: TikTok sukses + Shopee gagal, 1 hasil per input", async () => {
  const results = await syncStockToMarketplaces(
    [
      { accountId: tiktokAcc.id, channelSku: "TT-1" },
      { accountId: shopeeAcc.id, channelSku: "SP-1" },
    ],
    77
  );
  assert.equal(results.length, 2);
  assert.equal(results[0].success, true);
  assert.equal(results[1].success, false);
  assert.ok((results[1].error ?? "").includes(NOT_CONNECTED_HINT));
});

await ok("worker resmi: job Shopee → retry (bukan sukses palsu), stok utuh", async () => {
  const master = await prisma.masterProduct.create({
    data: { name: "Produk Shopee", businessId: business.id, threshold: 5 },
  });
  const variant = await prisma.productVariant.create({
    data: { sku: "SHP-1", stock: 50, masterProductId: master.id },
  });
  await enqueueSyncJobs(variant.id, [{ accountId: shopeeAcc.id, channelSku: "SP-1" }], 50);
  const res = await processDueSyncJobs();
  assert.equal(res.succeeded, 0, "TIDAK boleh sukses palsu");
  assert.equal(res.pendingRetry, 1);
  const job = await prisma.syncJob.findFirstOrThrow({ where: { variantId: variant.id } });
  assert.equal(job.status, "PENDING");
  assert.ok((job.lastError ?? "").includes(NOT_CONNECTED_HINT));
  assert.equal(
    (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock,
    50
  );
});

await ok("push harga Shopee → tanpa throw + SyncLog price_push skipped", async () => {
  await syncPriceToMarketplaces([{ accountId: shopeeAcc.id, channelSku: "SP-1" }], 99000);
  const logs = await prisma.syncLog.findMany({
    where: { accountId: shopeeAcc.id, kind: "price_push" },
  });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, "skipped");
  assert.ok((logs[0].message ?? "").includes(NOT_CONNECTED_HINT));
});

await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (phase-b-shopee). DB fixture dihapus.`);
