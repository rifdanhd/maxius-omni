/**
 * [TEST] PHASE A acceptance — 8 skenario inti Central Inventory + SyncJob.
 *
 * DB fixture ASLI (SQLite temp + migrate deploy) — tanpa mock prisma.
 * Push marketplace nyata TIDAK dipanggil (akun fixture tanpa token → jalur
 * sync mencatat "skipped" + hasil per-item success:false; akun fixture
 * bertoken hanya masuk antrean debounce, tanpa HTTP).
 *
 * Skenario:
 *  1. StockIn 0 → +120 = 120 (reason STOCK_IN)
 *  2. Order Shopee -10 → deduct benar
 *  3. Order TikTok -20 → deduct benar, cross-account
 *  4. Variant isolation
 *  5. Safety stock (effectiveStock)
 *  6. Concurrent deduction (stok 5 vs 4+4 → satu menang, tidak negatif)
 *  7. Duplicate webhook (idempotency → potong sekali)
 *  8. Sync fail via JALUR PRODUKSI (pusher default → hasil aktual
 *     success:false → central tetap, SyncJob FAILED setelah 3x retry)
 *  + Trigger SyncJob per mutasi (coalesce, 1 PENDING per triple)
 *  + Kontrak hasil per-item syncStockToMarketplaces (mixed success/failed,
 *    isolasi allSettled tetap: 1 toko gagal tak batalkan yang lain)
 *  + Isolasi status per-triple di worker (TikTok SUCCESS, Shopee retry)
 *
 * Jalankan:  npx tsx scripts/test-phase-a-acceptance.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-phase-a-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const {
  adjustStockManually,
  deductStockForOrder,
  STOCK_REASONS,
} = await import("@/lib/services/central-stock.service");
const { effectiveStock } = await import("@/lib/services/stock-level.policy");
const {
  enqueueSyncJobs,
  processDueSyncJobs,
  syncJobBackoffMs,
  SYNC_JOB_MAX_RETRIES,
} = await import("@/lib/services/sync-job.service");

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ─────────────────────────── Fixture ─────────────────────────── */
const business = await prisma.business.create({ data: { name: "Phase A" } });
const shopeeAcc = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee 1", businessId: business.id },
});
const tiktokAcc = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "TikTok 1", businessId: business.id },
});
const master = await prisma.masterProduct.create({
  data: { name: "Kaos Kaki Ortus Dewasa", businessId: business.id, threshold: 5 },
});
const variant = await prisma.productVariant.create({
  data: { sku: "ORT-S-H", stock: 0, masterProductId: master.id },
});
await prisma.productMapping.create({
  data: { channelSku: "SKU-172839", variantId: variant.id, accountId: shopeeAcc.id },
});
await prisma.productMapping.create({
  data: { channelSku: "928372", variantId: variant.id, accountId: tiktokAcc.id },
});

async function mkOrder(accountId: string, orderNo: string, variantId: string, qty: number, channelSku: string) {
  return prisma.order.create({
    data: {
      orderNo,
      status: "AWAITING_SHIPMENT",
      accountId,
      items: { create: { qty, channelSku, variantId } },
    },
  });
}
async function stockOf(id: string) {
  return (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
}

/* ─────────────────────────── Tests ─────────────────────────── */
console.log("=== Skenario 1: StockIn 0 +120 = 120 (STOCK_IN) ===");
await ok("adjust STOCK_IN → 120 + ledger STOCK_IN +120", async () => {
  const r = await adjustStockManually({
    variantId: variant.id,
    newStock: 120,
    note: "Barang masuk 10 lusin",
    reason: STOCK_REASONS.STOCK_IN,
  });
  assert.equal(r.ok, true);
  assert.equal(r.stockAfter, 120);
  assert.equal(r.changeQty, 120);
  assert.equal(await stockOf(variant.id), 120);
  const ledgers = await prisma.stockLedger.findMany({
    where: { variantId: variant.id, reason: "STOCK_IN" },
  });
  assert.equal(ledgers.length, 1);
  assert.equal(ledgers[0].changeQty, 120);
  assert.equal(ledgers[0].stockAfter, 120);
});

console.log("=== Skenario 2+3: Order Shopee -10, TikTok -20 ===");
await ok("Shopee order 10 → 110 + SyncJob PENDING utk TikTok", async () => {
  const order = await mkOrder(shopeeAcc.id, "SP-1", variant.id, 10, "SKU-172839");
  const r = await deductStockForOrder(order.id);
  assert.equal(r.ok, true);
  assert.equal(await stockOf(variant.id), 110);
  // deduct memicu push fire-and-forget → poll sampai SyncJob tercatat
  // (jangan panggil pushVariantStockToOthers kedua: dua push paralel
  // memicu race create InventorySetting yang pre-existing).
  let jobs: Array<{ accountId: string; channelSku: string; newSellable: number }> = [];
  for (let i = 0; i < 100 && jobs.length === 0; i++) {
    await new Promise((res) => setTimeout(res, 50));
    jobs = await prisma.syncJob.findMany({
      where: { variantId: variant.id, accountId: tiktokAcc.id, status: "PENDING" },
    });
  }
  assert.equal(jobs.length, 1, "tepat 1 job (exclude akun asal)");
  assert.equal(jobs[0].accountId, tiktokAcc.id);
  assert.equal(jobs[0].channelSku, "928372");
  assert.equal(jobs[0].newSellable, 110);
});
await ok("TikTok order 20 → 90 (cross-account tidak ganggu)", async () => {
  const order = await mkOrder(tiktokAcc.id, "TT-1", variant.id, 20, "928372");
  const r = await deductStockForOrder(order.id);
  assert.equal(r.ok, true);
  assert.equal(await stockOf(variant.id), 90);
});

console.log("=== Skenario 4: Variant isolation ===");
await ok("mutasi 1 varian tidak sentuh varian lain", async () => {
  const other = await prisma.productVariant.create({
    data: { sku: "ORT-S-P", stock: 50, masterProductId: master.id },
  });
  const order = await mkOrder(shopeeAcc.id, "SP-2", variant.id, 5, "SKU-172839");
  await deductStockForOrder(order.id);
  assert.equal(await stockOf(variant.id), 85);
  assert.equal(await stockOf(other.id), 50);
});

console.log("=== Skenario 5: Safety stock ===");
await ok("stock 100 safety 10 → sellable 90 (dihitung, bukan kolom)", async () => {
  assert.equal(effectiveStock(100, 10), 90);
  const v = await prisma.productVariant.create({
    data: { sku: "ORT-P-H", stock: 100, safetyStock: 10, masterProductId: master.id },
  });
  const fresh = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(effectiveStock(fresh.stock, fresh.safetyStock), 90);
});

console.log("=== Skenario 6: Concurrent (stok 5 vs 4+4) ===");
await ok("tepat satu menang, stok akhir 1, tidak pernah negatif", async () => {
  const v = await prisma.productVariant.create({
    data: { sku: "RACE-5", stock: 5, masterProductId: master.id },
  });
  const a = await mkOrder(shopeeAcc.id, "RACE-A", v.id, 4, "SKU-172839");
  const b = await mkOrder(tiktokAcc.id, "RACE-B", v.id, 4, "928372");
  const [ra, rb] = await Promise.all([
    deductStockForOrder(a.id),
    deductStockForOrder(b.id),
  ]);
  const wins = [ra, rb].filter((r) => r.ok && !r.already);
  const losses = [ra, rb].filter((r) => !r.ok);
  assert.equal(wins.length, 1, "tepat satu order lolos");
  assert.equal(losses.length, 1, "satunya gagal jelas (bukan silent)");
  const after = await stockOf(v.id);
  assert.equal(after, 1);
  assert.ok(after >= 0, "stok TIDAK BOLEH negatif");
});

console.log("=== Skenario 7: Duplicate webhook ===");
await ok("payload sama 2x → potong sekali, kedua already:true", async () => {
  const v = await prisma.productVariant.create({
    data: { sku: "DUPE-1", stock: 100, masterProductId: master.id },
  });
  const order = await mkOrder(shopeeAcc.id, "DUPE-ORDER", v.id, 10, "SKU-172839");
  const first = await deductStockForOrder(order.id);
  assert.equal(first.ok, true);
  assert.equal(await stockOf(v.id), 90);
  const second = await deductStockForOrder(order.id);
  assert.equal(second.ok, true);
  assert.equal(second.already, true);
  assert.equal(await stockOf(v.id), 90, "tidak terpotong kedua kali");
  const ledgers = await prisma.stockLedger.findMany({
    where: { variantId: v.id, reason: "ORDER", referenceId: order.id },
  });
  assert.equal(ledgers.length, 1);
});

console.log("=== Trigger: coalesce enqueue ===");
await ok("perubahan beruntun → 1 PENDING nilai terakhir", async () => {
  const v = await prisma.productVariant.create({
    data: { sku: "COAL-1", stock: 50, masterProductId: master.id },
  });
  await enqueueSyncJobs(v.id, [{ accountId: tiktokAcc.id, channelSku: "928372" }], 50);
  await enqueueSyncJobs(v.id, [{ accountId: tiktokAcc.id, channelSku: "928372" }], 48);
  await enqueueSyncJobs(v.id, [{ accountId: tiktokAcc.id, channelSku: "928372" }], 45);
  const jobs = await prisma.syncJob.findMany({
    where: { variantId: v.id, status: "PENDING" },
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].newSellable, 45);
});

console.log("=== Hasil per-item: syncStockToMarketplaces surface success/failed ===");
await ok("1 sukses (bertoken→antrean) + 1 gagal (tanpa token) → array 2 hasil, isolasi utuh", async () => {
  const { syncStockToMarketplaces } = await import("@/lib/services/sync.service");
  const goodAcc = await prisma.platformAccount.create({
    data: {
      platform: "TIKTOK_SHOP",
      label: "TikTok bertoken",
      businessId: business.id,
      accessToken: "tok-fixture",
      shopCipher: "cip-fixture",
    },
  });
  // tiktokAcc fixture TIDAK punya token → hasil aktual success:false.
  const results = await syncStockToMarketplaces(
    [
      { accountId: goodAcc.id, channelSku: "GOOD-1" },
      { accountId: tiktokAcc.id, channelSku: "928372" },
    ],
    77
  );
  assert.equal(results.length, 2, "1 hasil per input (tidak digabung, tidak hilang)");
  const [good, bad] = results;
  assert.equal(good.accountId, goodAcc.id);
  assert.equal(good.channelSku, "GOOD-1");
  assert.equal(good.success, true, "bertoken → diterima antrean");
  assert.equal(bad.accountId, tiktokAcc.id);
  assert.equal(bad.success, false, "tanpa token → gagal aktual (bukan sukses palsu)");
  assert.ok((bad.error ?? "").length > 0, "error terisi untuk diagnosis");
  // Isolasi: kegagalan item kedua tidak menghapus/membatalkan item pertama.
  assert.equal(results.filter((r) => r.success).length, 1);
  assert.equal(results.filter((r) => !r.success).length, 1);
});

console.log("=== Skenario 8: Sync fail via JALUR PRODUKSI → central tetap, job FAILED ===");
await ok("3x gagal aktual (success:false, tanpa pusher palsu) → FAILED + retryCount=3, stok utuh", async () => {
  // Isolasi: job PENDING dari skenario sebelumnya sudah terassert;
  // hapus agar worker hanya memproses job skenario ini.
  await prisma.syncJob.deleteMany({});
  const v = await prisma.productVariant.create({
    data: { sku: "FAIL-1", stock: 90, masterProductId: master.id },
  });
  await enqueueSyncJobs(v.id, [{ accountId: tiktokAcc.id, channelSku: "928372" }], 90);
  // SENGAJA tanpa `pusher` → defaultPusher produksi: syncStockToMarketplaces
  // asli terhadap akun tanpa token → { success:false } (bukan throw palsu).
  const t0 = Date.now();
  // Ronde 1: PENDING → gagal → PENDING retry 1, nextRetryAt = +1m
  let res = await processDueSyncJobs({ now: new Date(t0) });
  assert.equal(res.pendingRetry, 1);
  assert.equal(res.succeeded, 0, "TIDAK boleh sukses palsu");
  let job = await prisma.syncJob.findFirstOrThrow({ where: { variantId: v.id } });
  assert.equal(job.status, "PENDING");
  assert.equal(job.retryCount, 1);
  assert.equal(job.nextRetryAt?.getTime(), t0 + syncJobBackoffMs(1));
  assert.ok((job.lastError ?? "").includes("access token"), `lastError = ${job.lastError}`);
  // Ronde 2 (+61s): gagal → retry 2, +5m
  res = await processDueSyncJobs({ now: new Date(t0 + 61_000) });
  assert.equal(res.pendingRetry, 1);
  assert.equal(res.succeeded, 0);
  job = await prisma.syncJob.findFirstOrThrow({ where: { variantId: v.id } });
  assert.equal(job.retryCount, 2);
  // Ronde 3 (+61s+301s): gagal → FAILED permanen (mismatch marker)
  res = await processDueSyncJobs({ now: new Date(t0 + 362_000) });
  assert.equal(res.failed, 1);
  assert.equal(res.succeeded, 0);
  job = await prisma.syncJob.findFirstOrThrow({ where: { variantId: v.id } });
  assert.equal(job.status, "FAILED");
  assert.equal(job.retryCount, SYNC_JOB_MAX_RETRIES);
  assert.ok((job.lastError ?? "").includes("access token"));
  // Ronde 4 (jauh di masa depan): tidak diproses lagi (retry habis)
  res = await processDueSyncJobs({ now: new Date(t0 + 10_000_000) });
  assert.equal(res.processed, 0);
  // Central TIDAK di-rollback
  assert.equal(await stockOf(v.id), 90);
});

console.log("=== Worker: kontrak hasil pusher (tanpa throw) ===");
await ok("pusher {success:false} → retry; {success:true} → SUCCESS", async () => {
  await prisma.syncJob.deleteMany({});
  const vFail = await prisma.productVariant.create({
    data: { sku: "RES-FAIL", stock: 5, masterProductId: master.id },
  });
  const vOk = await prisma.productVariant.create({
    data: { sku: "RES-OK", stock: 6, masterProductId: master.id },
  });
  await enqueueSyncJobs(vFail.id, [{ accountId: tiktokAcc.id, channelSku: "928372" }], 5);
  await enqueueSyncJobs(vOk.id, [{ accountId: tiktokAcc.id, channelSku: "928372" }], 6);
  const res = await processDueSyncJobs({
    pusher: async (job) => {
      if (job.channelSku === "928372" && job.newSellable === 5) {
        return { success: false, error: "marketplace down (hasil, bukan throw)" };
      }
      return { success: true };
    },
  });
  assert.equal(res.processed, 2);
  assert.equal(res.succeeded, 1);
  assert.equal(res.pendingRetry, 1);
  const jf = await prisma.syncJob.findFirstOrThrow({ where: { variantId: vFail.id } });
  assert.equal(jf.status, "PENDING");
  assert.equal(jf.retryCount, 1);
  assert.ok((jf.lastError ?? "").includes("marketplace down"));
  const jo = await prisma.syncJob.findFirstOrThrow({ where: { variantId: vOk.id } });
  assert.equal(jo.status, "SUCCESS");
});

console.log("=== Worker: isolasi status per-triple (sukses & gagal tercampur) ===");
await ok("TikTok sukses + Shopee gagal → status terpisah, tidak digabung", async () => {
  await prisma.syncJob.deleteMany({});
  const v = await prisma.productVariant.create({
    data: { sku: "MIX-1", stock: 50, masterProductId: master.id },
  });
  await enqueueSyncJobs(
    v.id,
    [
      { accountId: tiktokAcc.id, channelSku: "928372" },
      { accountId: shopeeAcc.id, channelSku: "SKU-172839" },
    ],
    50
  );
  const res = await processDueSyncJobs({
    pusher: async (job) =>
      job.accountId === tiktokAcc.id
        ? { success: true }
        : { success: false, error: "Shopee timeout" },
  });
  assert.equal(res.processed, 2);
  assert.equal(res.succeeded, 1);
  assert.equal(res.pendingRetry, 1);
  const jt = await prisma.syncJob.findFirstOrThrow({
    where: { variantId: v.id, accountId: tiktokAcc.id },
  });
  assert.equal(jt.status, "SUCCESS");
  const js = await prisma.syncJob.findFirstOrThrow({
    where: { variantId: v.id, accountId: shopeeAcc.id },
  });
  assert.equal(js.status, "PENDING", "gagal tidak menyeret triple lain");
  assert.equal(js.retryCount, 1);
  assert.equal(await stockOf(v.id), 50, "central utuh walau sebagian gagal");
});

console.log("=== Worker: pusher sukses (void, kontrak lama) → SUCCESS ===");
await ok("job sukses → SUCCESS, tidak diproses ulang", async () => {
  const v = await prisma.productVariant.create({
    data: { sku: "OK-1", stock: 10, masterProductId: master.id },
  });
  await enqueueSyncJobs(v.id, [{ accountId: tiktokAcc.id, channelSku: "928372" }], 10);
  let calls = 0;
  const res = await processDueSyncJobs({
    pusher: async () => {
      calls += 1;
    },
  });
  assert.equal(res.succeeded, 1);
  assert.equal(calls, 1);
  const job = await prisma.syncJob.findFirstOrThrow({ where: { variantId: v.id } });
  assert.equal(job.status, "SUCCESS");
});

/* ─────────────────────────── Cleanup ─────────────────────────── */
await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (phase-a). DB fixture dihapus.`);
