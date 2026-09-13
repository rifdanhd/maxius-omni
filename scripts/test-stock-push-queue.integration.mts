/**
 * [TEST] INTEGRATION test TUGAS 3 — debounce/batch push stok + backoff rate-limit.
 *
 * DB fixture ASLI (SQLite temp + migrate deploy) — tanpa mock prisma.
 * Lapisan HTTP di-stub via global.fetch (fetch terekam utk verifikasi JUMLAH
 * call & payload; setTimeout di-stub agar backoff/diverifikasi nilainya tanpa
 * menunggu detik nyata).
 *
 * Skenario:
 *  1. 5 perubahan beruntun SKU sama → cukup NILAI TERAKHIR dikirim (coalesce),
 *     1 log "deferred" (bukan 5), 1 log "success"
 *  2. 3 SKU beda (satu produk TikTok) → 1 call search (seller_skus gabungan)
 *     + 1 call update berisi 3 SKU (bukan 6+ call per-SKU)
 *  3. HTTP 429 → retry backoff terjadwal (delay eksponensial+jitter),
 *     percobaan berikutnya sukses, semua tercatat di SyncLog
 *  4. Error validasi/permanen → GAGAL JELAS, tanpa retry terjadwal
 *  5. Akun tanpa token → "skipped", 0 call API
 *
 * Jalankan: npx tsx scripts/test-stock-push-queue.integration.mts
 */
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const benchDb = path.join(process.cwd(), "prisma", `test-stock-push-${Date.now()}.db`);
execSync(`cp prisma/dev.db "${benchDb}"`);
execSync(`npx prisma db push --skip-generate`, {
  env: { ...process.env, DATABASE_URL: `file:${benchDb}` },
  stdio: "pipe",
});
process.env.DATABASE_URL = `file:${benchDb}`;

const { prisma } = await import("@/lib/db/prisma");

/* ─────────────── Stub global.fetch (TikTok API palsu) ─────────────── */
type RecordedCall = { url: string; method: string; body: Record<string, unknown> | null };
const httpCalls: RecordedCall[] = [];
let updateResponder: (call: RecordedCall) => { status: number; body: Record<string, unknown> } = () => ({
  status: 200,
  body: { code: 0, data: {} },
});

const realSetTimeout = globalThis.setTimeout;
type CapturedTimer = { fn: () => void; delay: number };
let capturedTimers: CapturedTimer[] = [];
function stubTimers() {
  capturedTimers = [];
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, delay?: number) => {
    capturedTimers.push({ fn, delay: delay ?? 0 });
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
}
function restoreTimers() {
  (globalThis as { setTimeout: unknown }).setTimeout = realSetTimeout;
}
async function drainAsync() {
  for (let i = 0; i < 30; i++) await new Promise((r) => realSetTimeout(r, 20));
}

const okRes = (body: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

(globalThis as { fetch: unknown }).fetch = (async (url: string | URL, init?: { method?: string; body?: string }) => {
  const call: RecordedCall = {
    url: String(url),
    method: init?.method ?? "GET",
    body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
  };
  httpCalls.push(call);
  if (call.url.includes("/products/search")) {
    return okRes({
      code: 0,
      data: {
        products: [
          {
            id: "prod-1",
            skus: [
              { id: "tik-1", seller_sku: "CH-1" },
              { id: "tik-2", seller_sku: "CH-2" },
              { id: "tik-3", seller_sku: "CH-3" },
            ],
          },
        ],
      },
    });
  }
  if (call.url.includes("/inventory/update")) {
    const r = updateResponder(call);
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}) as typeof fetch;

/* ─────────────── Import modul yang diuji ─────────────── */
const { scheduleStockPush, _resetStockPushQueueForTests, DEBOUNCE_WINDOW_MS } = await import(
  "@/lib/services/stock-push-queue.service"
);
const { syncStockToMarketplaces } = await import("@/lib/services/sync.service");

/* ─────────────── Helper ─────────────── */
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
// Fixture DB = salinan dev.db (berisi jejak push sandbox lama) → SEMUA query
// SyncLog di-scope per akun fixture agar tidak menghitung baris lama.
async function syncLogs(kinds: string | undefined, accId: string) {
  return prisma.syncLog.findMany({
    where: { direction: "out", kind: "stock_push", accountId: accId, ...(kinds ? { status: kinds } : {}) },
    orderBy: { createdAt: "asc" },
  });
}
// Timer backoff = delay < 5s (backoff awal ±1,5–2,5s; timer flush selalu tepat
// DEBOUNCE_WINDOW_MS = 8s → tidak tercampur).
const countBackoffTimers = () => capturedTimers.filter((t) => t.delay > 0 && t.delay < 5_000).length;
// Bersihkan jejak antar grup (log grup sebelumnya tidak boleh terhitung).
async function clearLogs(accId: string) {
  await prisma.syncLog.deleteMany({ where: { accountId: accId } });
}

/* ─────────────── Fixture ─────────────── */
const business = await prisma.business.create({ data: { name: "T3 Biz" } });
const account = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "T3 Akun", businessId: business.id, accessToken: "tok", shopCipher: "cip" },
});
const noTokenAccount = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "T3 Tanpa Token", businessId: business.id },
});
// (varian tidak dibutuhkan skenario ini — push queue bekerja di lapisan mapping
// channel SKU; dibuat tanpa relasi varian)

console.log(`\n[1] Coalesce: 5 perubahan beruntun SKU sama → nilai terakhir, 1 deferred`);
{
  _resetStockPushQueueForTests();
  httpCalls.length = 0;
  stubTimers();
  await clearLogs(account.id);
  try {
    for (const q of [10, 9, 8, 7, 6]) {
      scheduleStockPush(account.id, "CH-1", q);
    }
    check("1 timer debounce dipasang (bukan 5)", capturedTimers.length === 1, `timers=${capturedTimers.length}`);
    await drainAsync();
    const deferred = await syncLogs("deferred", account.id);
    check("SyncLog deferred tepat 1", deferred.length === 1, `count=${deferred.length}`);

    capturedTimers[0].fn(); // window berakhir → flush
    await drainAsync();

    const updateCall = httpCalls.find((c) => c.url.includes("/inventory/update"));
    const skus = (updateCall?.body?.skus as Array<{ inventory: Array<{ quantity: number }> }>) ?? [];
    check("1 call update", httpCalls.filter((c) => c.url.includes("/inventory/update")).length === 1);
    check("quantity = nilai TERAKHIR (6)", skus[0]?.inventory?.[0]?.quantity === 6, JSON.stringify(skus));
    const success = await syncLogs("success", account.id);
    check("SyncLog success tepat 1", success.length === 1, `count=${success.length}`);
  } finally {
    restoreTimers();
  }
}

console.log(`\n[2] Batch: 3 SKU beda (satu produk) → 1 search + 1 update berisi 3 SKU`);
{
  _resetStockPushQueueForTests();
  httpCalls.length = 0;
  stubTimers();
  await clearLogs(account.id);
  try {
    scheduleStockPush(account.id, "CH-1", 11);
    scheduleStockPush(account.id, "CH-2", 12);
    scheduleStockPush(account.id, "CH-3", 13);
    capturedTimers[0].fn();
    await drainAsync();

    const searchCalls = httpCalls.filter((c) => c.url.includes("/products/search"));
    const updateCalls = httpCalls.filter((c) => c.url.includes("/inventory/update"));
    check("call search tepat 1", searchCalls.length === 1, `count=${searchCalls.length}`);
    check(
      "search membawa seller_skus gabungan",
      JSON.stringify((searchCalls[0]?.body?.seller_skus as string[])?.sort()) === JSON.stringify(["CH-1", "CH-2", "CH-3"]),
      JSON.stringify(searchCalls[0]?.body)
    );
    // +1 call inventory/search: resolve warehouse_id riil (E2E sandbox membuktikan
    // warehouse_id "" ditolak 36009004 — dulu disebabkan produk di-search per-SKU).
    check("call update tepat 1", updateCalls.length === 1, `count=${updateCalls.length}`);
    const skus = (updateCalls[0]?.body?.skus as Array<{ id: string }>) ?? [];
    check(
      "update berisi 3 SKU dgn id internal TikTok",
      skus.length === 3 && skus.every((s) => ["tik-1", "tik-2", "tik-3"].includes(s.id)),
      JSON.stringify(skus)
    );
    check("search TIDAK per-SKU (3 call utk 3 SKU vs ≥8 call implementasi lama)", httpCalls.length === 3, `total=${httpCalls.length}`);
    const success = await syncLogs("success", account.id);
    check("3 log success", success.length === 3, `count=${success.length}`);
  } finally {
    restoreTimers();
  }
}

console.log(`\n[3] Rate limit HTTP 429 → retry backoff terjadwal, sukses di percobaan berikutnya`);
{
  _resetStockPushQueueForTests();
  httpCalls.length = 0;
  stubTimers();
  let updateCount = 0;
  updateResponder = () => {
    updateCount++;
    if (updateCount === 1) return { status: 429, body: {} }; // rate limit (body kosong → code=429)
    return { status: 200, body: { code: 0, data: {} } };
  };
  await clearLogs(account.id);
  try {
    scheduleStockPush(account.id, "CH-1", 20);
    capturedTimers[0].fn(); // flush pertama → kena 429
    await drainAsync();

    const errors = await syncLogs("error", account.id);
    check(
      "SyncLog error menyebut retry backoff",
      errors.length === 1 && /retry ke-1/.test(errors[0]?.message ?? ""),
      JSON.stringify(errors.map((e) => e.message))
    );
    check("retry timer terjadwal dgn delay backoff", countBackoffTimers() === 1, `timers=${JSON.stringify(capturedTimers.map((t) => t.delay))}`);

    // Jalankan timer backoff, lalu timer flush yang dijadwalkan ulang (8s).
    capturedTimers.find((t) => t.delay > 0 && t.delay < 5_000)!.fn();
    await drainAsync();
    const requeuedFlush = capturedTimers.filter((t) => t.delay === DEBOUNCE_WINDOW_MS).pop();
    if (requeuedFlush) {
      requeuedFlush.fn();
      await drainAsync();
    }

    check("call update tepat 2 (1 gagal + 1 sukses)", updateCount === 2, `count=${updateCount}`);
    const success = await syncLogs("success", account.id);
    check("akhirnya success", success.length === 1, `count=${success.length}`);
  } finally {
    updateResponder = () => ({ status: 200, body: { code: 0, data: {} } });
    restoreTimers();
  }
}

console.log(`\n[4] Error permanen (validasi TikTok) → gagal JELAS, TIDAK di-retry`);
{
  _resetStockPushQueueForTests();
  httpCalls.length = 0;
  stubTimers();
  updateResponder = () => ({ status: 200, body: { code: 6012501, message: "Invalid SKU quantity" } });
  await clearLogs(account.id);
  try {
    scheduleStockPush(account.id, "CH-1", 30);
    capturedTimers[0].fn();
    await drainAsync();

    const errors = await syncLogs("error", account.id);
    check(
      "SyncLog error 'TIDAK di-retry otomatis'",
      errors.length === 1 && /TIDAK di-retry/.test(errors[0]?.message ?? ""),
      JSON.stringify(errors.map((e) => e.message))
    );
    check(
      "tidak ada timer backoff terjadwal (hanya 1 timer flush yang sudah jalan)",
      countBackoffTimers() === 0 && capturedTimers.length === 1,
      `timers=${JSON.stringify(capturedTimers.map((t) => t.delay))}`
    );
    check("call update tepat 1 (tidak diulang)", httpCalls.filter((c) => c.url.includes("/inventory/update")).length === 1);
  } finally {
    updateResponder = () => ({ status: 200, body: { code: 0, data: {} } });
    restoreTimers();
  }
}

console.log(`\n[5] Akun tanpa access token → skipped, 0 call API`);
{
  _resetStockPushQueueForTests();
  httpCalls.length = 0;
  stubTimers();
  await clearLogs(noTokenAccount.id);
  try {
    await syncStockToMarketplaces([{ accountId: noTokenAccount.id, channelSku: "CH-1" }], 5);
    await drainAsync();
    const skipped = await syncLogs("skipped", noTokenAccount.id);
    check("SyncLog skipped", skipped.length === 1, `count=${skipped.length}`);
    check("0 call API", httpCalls.length === 0, `count=${httpCalls.length}`);
    check("tidak ada timer (tidak masuk antrean)", capturedTimers.length === 0);
  } finally {
    restoreTimers();
  }
}

/* ─────────────── Ringkasan ─────────────── */
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
check(`DEBOUNCE_WINDOW_MS dalam rentang diminta (5–10s)`, DEBOUNCE_WINDOW_MS >= 5_000 && DEBOUNCE_WINDOW_MS <= 10_000, `${DEBOUNCE_WINDOW_MS}ms`);

await prisma.$disconnect();
restoreTimers();
fs.rmSync(benchDb, { force: true });
for (const suffix of ["-wal", "-shm"]) fs.rmSync(benchDb + suffix, { force: true });
process.exit(fail > 0 ? 1 : 0);
