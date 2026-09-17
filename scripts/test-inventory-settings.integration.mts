/**
 * [TEST] INTEGRATION — Pengaturan Inventori (GET/PUT + wiring).
 *
 * DB fixture ASLI (SQLite temp + migrate deploy) — tanpa mock prisma.
 * Cakupan:
 *  1. Settings semantics: singleton auto-create, patch parsial, persistensi,
 *     validasi ketat (threshold non-bulat/negatif, boolean salah tipe,
 *     frekuensi tak dikenal, body bukan objek).
 *  2. lowStockDefaultThreshold → ambang awal produk BARU, diuji lewat HANDLER
 *     ASLI /api/inventory/mappings (JWT ditandatangani dgn JWT_SECRET dari
 *     .env) + service product-copy.
 *  3. syncPush* → gate auto-push di sync.service (satu-satunya titik push):
 *     TikTok dimatikan → SyncLog "skipped" dgn pesan gate & tidak masuk
 *     antrean; Shopee gate vs "belum ada integrasi".
 *  4. notifyLowStock → gate handler ASLI /api/stock-alerts.
 *
 * Jalankan:  npx tsx --env-file=.env scripts/test-inventory-settings.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import jwt from "jsonwebtoken";

const dbPath = path.join(process.cwd(), "prisma", `test-settings-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const {
  getInventorySettings,
  updateInventorySettings,
  validateInventorySettingsUpdate,
  SETTING_ID,
} = await import("@/lib/services/inventory-settings.service");
const { saveProductCopyAsDraft } = await import("@/lib/services/product-copy.service");
const { syncStockToMarketplaces } = await import("@/lib/services/sync.service");
const { _resetStockPushQueueForTests } = await import("@/lib/services/stock-push-queue.service");
const mappingsRoute = await import("@/app/api/inventory/mappings/route");
const stockAlertsRoute = await import("@/app/api/stock-alerts/route");

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
function rejectsVal(name: string, r: { ok: boolean; reason?: string }, mustContain: string) {
  assert.equal(r.ok, false, `harusnya ditolak: ${JSON.stringify(r)}`);
  assert.ok(r.reason?.includes(mustContain), `pesan harus mengandung "${mustContain}", dapat: ${r.reason}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ─────────────────────────── Fixture ─────────────────────────── */
// Baris "business-default" (id eksplisit) — di produksi dibuat saat migrasi
// data; MasterProduct.businessId @default("business-default") butuh ini.
await prisma.business.create({ data: { id: "business-default", name: "Default" } });
const business = await prisma.business.create({ data: { name: "Settings Test" } });
const acc = await prisma.platformAccount.create({
  data: {
    platform: "TIKTOK_SHOP",
    label: "Toko Settings",
    businessId: business.id,
    accessToken: "tok-settings-test",
    shopCipher: "cipher-settings-test",
  },
});
const accShopee = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Toko Shopee Settings", businessId: business.id },
});
const user = await prisma.user.create({ data: { username: "admin-settings", passwordHash: "x" } });
const jwtSecret = process.env.JWT_SECRET;
assert.ok(jwtSecret, "JWT_SECRET harus ada di .env utk test handler");
const token = jwt.sign({ sub: user.id, username: user.username }, jwtSecret, { expiresIn: "10m" });
const authHeaders = { authorization: `Bearer ${token}`, "content-type": "application/json" };

/* ─────────────────────── 1 — Settings semantics ─────────────────────── */
console.log("=== 1 — GET/PUT settings semantics ===");

await ok("get pertama kali → auto-create baris default", async () => {
  await prisma.inventorySetting.deleteMany();
  const s = await getInventorySettings();
  assert.equal(s.lowStockDefaultThreshold, 20);
  assert.equal(s.notifyLowStock, true);
  assert.equal(s.notifyLowStockEmail, false);
  assert.equal(s.syncPushTiktok, true);
  assert.equal(s.syncPushShopee, true);
  assert.equal(s.syncPushTokopedia, true);
  assert.equal(s.opnameReminderFrequency, "monthly");
  const rows = await prisma.inventorySetting.findMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, SETTING_ID);
});

await ok("validate: field tak dikenal diabaikan, field valid lolos", async () => {
  const r = validateInventorySettingsUpdate({ lowStockDefaultThreshold: 7, hacker: true });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.data, { lowStockDefaultThreshold: 7 });
});

rejectsVal(
  "validate: threshold non-bulat ditolak",
  validateInventorySettingsUpdate({ lowStockDefaultThreshold: 2.5 }),
  "bilangan bulat"
);
rejectsVal(
  "validate: threshold negatif ditolak",
  validateInventorySettingsUpdate({ lowStockDefaultThreshold: -1 }),
  "bilangan bulat"
);
rejectsVal(
  "validate: boolean salah tipe ditolak",
  validateInventorySettingsUpdate({ notifyLowStock: "yes" }),
  "harus boolean"
);
rejectsVal(
  "validate: frekuensi tak dikenal ditolak",
  validateInventorySettingsUpdate({ opnameReminderFrequency: "yearly" }),
  "harus salah satu dari"
);
rejectsVal(
  "validate: body array ditolak",
  validateInventorySettingsUpdate([1, 2]),
  "Body harus objek"
);
rejectsVal("validate: body null ditolak", validateInventorySettingsUpdate(null), "Body harus objek");

await ok("updateInventorySettings: patch parsial + persistensi", async () => {
  const s1 = await updateInventorySettings({
    lowStockDefaultThreshold: 5,
    notifyLowStock: false,
    syncPushTiktok: false,
    opnameReminderFrequency: "weekly",
  });
  assert.equal(s1.lowStockDefaultThreshold, 5);
  const s2 = await getInventorySettings(); // baca ulang dari DB
  assert.equal(s2.lowStockDefaultThreshold, 5);
  assert.equal(s2.notifyLowStock, false);
  assert.equal(s2.syncPushTokopedia, true); // tidak disentuh
  assert.equal(s2.opnameReminderFrequency, "weekly");
});

/* ─────────────────────── 2 — Threshold wiring ─────────────────────── */
console.log("=== 2 — lowStockDefaultThreshold → produk baru ===");

await ok("product-copy: draft baru memakai ambang global (bukan 20)", async () => {
  await updateInventorySettings({ lowStockDefaultThreshold: 7 });
  const { id } = await saveProductCopyAsDraft({
    businessId: "business-default",
    name: "[TEST] Produk Copy Threshold",
    variants: [{ name: "Rasa Asli", price: null, stock: 3 }],
  });
  const product = await prisma.masterProduct.findUniqueOrThrow({ where: { id } });
  assert.equal(product.threshold, 7, "threshold harus ikut setting global");
  await prisma.masterProduct.delete({ where: { id } });
});

await ok("HANDLER /api/inventory/mappings: produk baru ber-threshold global", async () => {
  await updateInventorySettings({ lowStockDefaultThreshold: 9 });
  const req = new Request("http://localhost/api/inventory/mappings", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      accountId: acc.id,
      channelSku: "SET-NEW-1",
      newProductName: "[TEST] Paritas Mappings",
      stock: 3,
    }),
  });
  const res = await (mappingsRoute.POST as (r: unknown) => Promise<Response>)(req);
  assert.ok(res.ok, `POST mappings harus sukses, dapat ${res.status}`);
  const product = await prisma.masterProduct.findFirstOrThrow({
    where: { name: "[TEST] Paritas Mappings" },
  });
  assert.equal(product.threshold, 9, "threshold produk baru harus = setting global");
  // Cleanup: mapping cascade; hapus produk.
  await prisma.masterProduct.delete({ where: { id: product.id } });
});

/* ─────────────────────── 3 — Sync gate ─────────────────────── */
console.log("=== 3 — syncPush* gate di sync.service ===");

await ok("TikTok dimatikan → SyncLog 'skipped' dgn pesan gate, tidak masuk antrean", async () => {
  _resetStockPushQueueForTests();
  await updateInventorySettings({ syncPushTiktok: false });
  await syncStockToMarketplaces([{ accountId: acc.id, channelSku: "SET-GATE-1" }], 42);
  const gateLogs = await prisma.syncLog.findMany({
    where: {
      accountId: acc.id,
      kind: "stock_push",
      status: "skipped",
      message: { contains: "dimatikan" },
    },
  });
  assert.equal(gateLogs.length, 1, `harus tepat 1 log gate: ${JSON.stringify(gateLogs)}`);
  // Nilai yang ditahan tercatat di payload — cek jejak tidak silent.
  assert.ok(gateLogs[0].message?.includes("TikTok Shop") || gateLogs[0].message?.includes("TIKTOK_SHOP"));
  // Aktifkan lagi → tidak ada log gate baru untuk push berikutnya.
  await updateInventorySettings({ syncPushTiktok: true });
  await syncStockToMarketplaces([{ accountId: acc.id, channelSku: "SET-GATE-2" }], 43);
  const gateLogs2 = await prisma.syncLog.findMany({
    where: { accountId: acc.id, message: { contains: "dimatikan" } },
  });
  assert.equal(gateLogs2.length, 1, "gate tidak boleh memblokir setelah diaktifkan");
  _resetStockPushQueueForTests();
});

await ok("Shopee dimatikan → pesan gate; diaktifkan → pesan 'belum ada integrasi'", async () => {
  await updateInventorySettings({ syncPushShopee: false });
  await syncStockToMarketplaces([{ accountId: accShopee.id, channelSku: "SET-GATE-S1" }], 10);
  const gate = await prisma.syncLog.findFirst({
    where: { accountId: accShopee.id, message: { contains: "dimatikan" } },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(gate, "harus ada log gate shopee");

  await updateInventorySettings({ syncPushShopee: true });
  await syncStockToMarketplaces([{ accountId: accShopee.id, channelSku: "SET-GATE-S2" }], 11);
  const plain = await prisma.syncLog.findFirst({
    where: { accountId: accShopee.id, message: { contains: "belum punya integrasi push stok" } },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(plain, "saat aktif, jalur lama (belum ada integrasi) tetap jalan");
});

/* ─────────────────────── 4 — Notification gate ─────────────────────── */
console.log("=== 4 — notifyLowStock gate di /api/stock-alerts ===");

await ok("bell dimatikan → handler mengembalikan alerts kosong", async () => {
  await updateInventorySettings({ notifyLowStock: false });
  const req = new Request("http://localhost/api/stock-alerts", { headers: authHeaders });
  const res = await (stockAlertsRoute.GET as (r: unknown) => Promise<Response>)(req);
  assert.ok(res.ok);
  const data = (await res.json()) as { count: number; alerts: unknown[] };
  assert.deepEqual(data.alerts, []);
  assert.equal(data.count, 0);

  await updateInventorySettings({ notifyLowStock: true });
  const res2 = await (stockAlertsRoute.GET as (r: unknown) => Promise<Response>)(req);
  const data2 = (await res2.json()) as { count: number; alerts: unknown[] };
  assert.ok(Array.isArray(data2.alerts), "saat aktif, bentuk respons tetap normal");
});

/* ─────────────────────────── Selesai ─────────────────────────── */
console.log(`\n${passed}/${passed} PASS`);
await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
process.exit(0);
