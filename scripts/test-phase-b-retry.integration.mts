/**
 * [TEST] PHASE B.2 — Retry manual per-job memakai mekanisme retry resmi.
 *
 * DB fixture ASLI (SQLite temp + migrate deploy).
 * Assert:
 *  1. FAILED (retryCount=max) + pusher sukses → SUCCESS, lastError null,
 *     central stock UTUH (tidak di-rollback/diubah).
 *  2. FAILED + pusher gagal → kembali FAILED, retryCount+1, lastError terisi.
 *  3. PENDING retry>=1 + pusher gagal → PENDING + backoff sesuai syncJobBackoffMs.
 *  4. Transisi IDENTIK dgn processDueSyncJobs (bandingkan hasil auto vs manual
 *     utk kasus gagal yang sama).
 *  5. Guard: SUCCESS → NOT_ELIGIBLE; id hilang → NOT_FOUND; PROCESSING →
 *     CONFLICT; dua retry bersamaan → tepat 1 jalan, 1 CONFLICT (anti spam).
 *  6. BUKAN job baru: jumlah baris SyncJob tetap.
 *
 * Jalankan: npx tsx scripts/test-phase-b-retry.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-phase-b-retry-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const {
  retrySingleSyncJob,
  processDueSyncJobs,
  syncJobBackoffMs,
  SyncJobRetryError,
} = await import("@/lib/services/sync-job.service");

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const business = await prisma.business.create({ data: { name: "Phase B.2" } });
const acc = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Shopee 1", businessId: business.id },
});
const master = await prisma.masterProduct.create({
  data: { name: "Produk Retry", businessId: business.id, threshold: 5 },
});
const variant = await prisma.productVariant.create({
  data: { sku: "RTY-1", stock: 90, masterProductId: master.id },
});
async function stockOf() {
  return (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
}
let n = 0;
async function mkJob(status: string, retryCount: number, lastError: string | null = null) {
  n += 1;
  return prisma.syncJob.create({
    data: {
      variantId: variant.id,
      accountId: acc.id,
      channelSku: `RTY-CH-${n}`,
      newSellable: 90,
      status,
      retryCount,
      lastError,
    },
  });
}
async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof SyncJobRetryError, "harus SyncJobRetryError");
    assert.equal((e as { code: string }).code, code);
    return;
  }
  assert.fail(`seharusnya melempar ${code}`);
}

console.log("=== PHASE B.2: Retry manual ===");
await ok("FAILED + sukses → SUCCESS, lastError null, stok central utuh", async () => {
  const job = await mkJob("FAILED", 3, "Shopee timeout");
  const out = await retrySingleSyncJob(job.id, { pusher: async () => ({ success: true }) });
  assert.equal(out.status, "SUCCESS");
  assert.equal(out.lastError, null);
  assert.equal(await stockOf(), 90);
  assert.equal(await prisma.syncJob.count(), n, "bukan job baru");
});

await ok("FAILED + gagal → FAILED lagi, retryCount+1, lastError baru", async () => {
  const job = await mkJob("FAILED", 3, "lama");
  const out = await retrySingleSyncJob(job.id, {
    pusher: async () => ({ success: false, error: "masih down" }),
  });
  assert.equal(out.status, "FAILED");
  assert.equal(out.retryCount, 4);
  assert.ok((out.lastError ?? "").includes("masih down"));
  assert.equal(await stockOf(), 90);
});

await ok("PENDING retry1 + gagal → PENDING + backoff resmi", async () => {
  const t0 = Date.now();
  const job = await mkJob("PENDING", 1, "lama");
  const out = await retrySingleSyncJob(job.id, {
    pusher: async () => {
      throw new Error("boom");
    },
    now: new Date(t0),
  });
  assert.equal(out.status, "PENDING");
  assert.equal(out.retryCount, 2);
  const fresh = await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(fresh.nextRetryAt?.getTime(), t0 + syncJobBackoffMs(2));
});

await ok("transisi manual IDENTIK dgn otomatis utk kasus gagal sama", async () => {
  const a = await mkJob("PENDING", 0);
  const b = await mkJob("PENDING", 0);
  const fail = async () => ({ success: false as const, error: "sama" });
  await retrySingleSyncJob(a.id, { pusher: fail });
  await processDueSyncJobs({ pusher: fail });
  const fa = await prisma.syncJob.findUniqueOrThrow({ where: { id: a.id } });
  const fb = await prisma.syncJob.findUniqueOrThrow({ where: { id: b.id } });
  assert.equal(fa.status, fb.status);
  assert.equal(fa.retryCount, fb.retryCount);
  assert.equal(fa.lastError, fb.lastError);
});

await ok("guard: SUCCESS / hilang / PROCESSING / dobel-klik", async () => {
  const okJob = await mkJob("SUCCESS", 0);
  await expectCode(retrySingleSyncJob(okJob.id, { pusher: async () => ({ success: true }) }), "NOT_ELIGIBLE");
  await expectCode(retrySingleSyncJob("id-tidak-ada", { pusher: async () => ({ success: true }) }), "NOT_FOUND");
  const proc = await mkJob("PROCESSING", 1);
  await expectCode(retrySingleSyncJob(proc.id, { pusher: async () => ({ success: true }) }), "CONFLICT");

  // Spam-klik bersamaan: pusher lambat → tepat 1 menang, 1 CONFLICT.
  const race = await mkJob("FAILED", 3, "race");
  let calls = 0;
  const slow = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 100));
    return { success: true as const };
  };
  const [r1, r2] = await Promise.allSettled([
    retrySingleSyncJob(race.id, { pusher: slow }),
    retrySingleSyncJob(race.id, { pusher: slow }),
  ]);
  const wins = [r1, r2].filter((r) => r.status === "fulfilled");
  const conflicts = [r1, r2].filter(
    (r) => r.status === "rejected" && (r.reason as { code?: string })?.code === "CONFLICT"
  );
  assert.equal(wins.length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(calls, 1, "pusher hanya dipanggil sekali");
});

await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (phase-b-retry). DB fixture dihapus.`);
