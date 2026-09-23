/**
 * [TEST] Verifikasi push/sync di jalur INCREMENT (Opsi B, Temuan #2).
 *
 * Memastikan adjustStockManually({ increment }) — via adjustStockIncrement() —
 * memanggil pushVariantStockToOthers() setelah commit, sehingga
 * enqueueSyncJobs() (fix Temuan #1) mencatat 1 SyncJob PENDING per mapping
 * aktif, sama seperti jalur absolut & deduct order.
 *
 * Skenario:
 *  1. StockIn 0 +120 via INCREMENT pada varian bermapping 2 akun →
 *     stok 120, 1 ledger STOCK_IN +120, SyncJob PENDING utk KEDUA mapping
 *     dengan newSellable 120 (skenario 1 acceptance + assert SyncJob).
 *  2. Increment pada varian TANPA mapping → stok berubah, 0 SyncJob
 *     (funnel no-op, bukan error).
 *
 * Jalankan:  npx tsx scripts/test-stock-in-push.integration.mts
 */
import crypto from "crypto";
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-stock-in-push-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const { adjustStockManually, STOCK_REASONS } = await import(
  "@/lib/services/central-stock.service"
);

let passed = 0;

/* ── Fixture ── */
const business = await prisma.business.create({ data: { name: "StockIn Push" } });
const shopeeAcc = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee 1", businessId: business.id },
});
const tiktokAcc = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "TikTok 1", businessId: business.id },
});
const master = await prisma.masterProduct.create({
  data: { name: "Kaos Kaki Push", businessId: business.id },
});
const variant = await prisma.productVariant.create({
  data: { sku: "PUSH-IN-1", stock: 0, masterProductId: master.id },
});
await prisma.productMapping.create({
  data: { id: crypto.randomUUID(), channelSku: "SKU-PUSH-1", variantId: variant.id, accountId: shopeeAcc.id, updatedAt: new Date() },
});
await prisma.productMapping.create({
  data: { id: crypto.randomUUID(), channelSku: "PUSH-928", variantId: variant.id, accountId: tiktokAcc.id, updatedAt: new Date() },
});

async function waitJobs(variantId: string, count: number) {
  // push fire-and-forget → poll sampai SyncJob tercatat (pola skenario 2/3 acceptance).
  for (let i = 0; i < 100; i++) {
    const jobs = await prisma.syncJob.findMany({
      where: { variantId, status: "PENDING" },
    });
    if (jobs.length >= count) return jobs;
    await new Promise((res) => setTimeout(res, 50));
  }
  return prisma.syncJob.findMany({ where: { variantId, status: "PENDING" } });
}

/* ── Skenario 1: increment +120 → stok, ledger, DAN SyncJob kedua mapping ── */
console.log("=== Skenario 1: StockIn 0 +120 via INCREMENT → 120 + ledger + SyncJob ===");
{
  const r = await adjustStockManually({
    variantId: variant.id,
    increment: 120,
    note: "Barang masuk 10 lusin",
    reason: STOCK_REASONS.STOCK_IN,
  });
  assert.equal(r.ok, true);
  assert.equal(r.stockAfter, 120);
  assert.equal(r.changeQty, 120);
  const stock = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
  assert.equal(stock, 120);

  const ledgers = await prisma.stockLedger.findMany({
    where: { variantId: variant.id, reason: "STOCK_IN" },
  });
  assert.equal(ledgers.length, 1, "satu event stock-in = satu baris ledger");
  assert.equal(ledgers[0].changeQty, 120);
  assert.equal(ledgers[0].stockAfter, 120);
  passed += 1;
  console.log("  ✓ increment → 120 + 1 ledger STOCK_IN +120");

  const jobs = await waitJobs(variant.id, 2);
  assert.equal(jobs.length, 2, `SyncJob PENDING utk kedua mapping, dapat ${jobs.length}`);
  const byAcc = new Map(jobs.map((j) => [j.accountId, j]));
  assert.equal(byAcc.get(shopeeAcc.id)?.channelSku, "SKU-PUSH-1");
  assert.equal(byAcc.get(tiktokAcc.id)?.channelSku, "PUSH-928");
  for (const j of jobs) assert.equal(j.newSellable, 120, "nilai terbaru ter-coalesce");
  passed += 1;
  console.log("  ✓ SyncJob PENDING untuk kedua mapping (shopee + tiktok), newSellable 120");
}

/* ── Skenario 2: increment tanpa mapping → stok berubah, 0 job, tanpa error ── */
console.log("=== Skenario 2: increment varian tanpa mapping → tanpa SyncJob ===");
{
  const lonely = await prisma.productVariant.create({
    data: { sku: "PUSH-LONELY", stock: 5, masterProductId: master.id },
  });
  const r = await adjustStockManually({
    variantId: lonely.id,
    increment: 10,
    note: "Barang masuk lonely",
    reason: STOCK_REASONS.STOCK_IN,
  });
  assert.equal(r.ok, true);
  assert.equal(r.stockAfter, 15);
  // Beri kesempatan push fire-and-forget jalan bila (salah) dipicu.
  await new Promise((res) => setTimeout(res, 500));
  const jobs = await prisma.syncJob.findMany({ where: { variantId: lonely.id } });
  assert.equal(jobs.length, 0, "tanpa mapping → tanpa SyncJob");
  passed += 1;
  console.log("  ✓ stok 5 → 15, 0 SyncJob, tanpa error");
}

await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (stock-in-push). DB fixture dihapus.`);
