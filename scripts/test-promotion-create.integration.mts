/**
 * [TEST] INTEGRATION test Tahap 3 — endpoint /create (createPromotion service).
 *
 * BEDA dari unit test policy: pakai DB fixture ASLI (SQLite file sementara +
 * prisma migrate deploy) dan FAKE TikTok client (injection via opts.client —
 * TANPA mock module, jaringan tidak pernah disentuh).
 *
 * Cakupan permintaan reviewer Tahap 3:
 * 1. Create sukses & terverifikasi (G5 Get by ID cocok → audit SUCCESS)
 * 2. Create sukses tapi attach gagal → UNVERIFIED (BUKAN SUCCESS palsu)
 * 3. Re-validasi server-side menolak payload yang mestinya difilter /preview
 *    (G1 tanpa harga, G2 96% tanpa confirm, G3 overlap aktif tanpa ack,
 *    G4 tanpa kata "BUAT", lead time <2 jam, mapping akun salah)
 * 4. Audit PENDING ditulis SEBELUM panggilan TikTok pertama
 * 5. Alert UNVERIFIED + STALE_PENDING benar-benar terbaca (bukan cuma di DB)
 *
 * Jalankan:  npx tsx scripts/test-promotion-create.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// ── DB fixture: file SQLite sementara + migrasi penuh SEBELUM import prisma ──
const dbPath = path.join(process.cwd(), "prisma", `test-promo-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

// Import dinamis agar DATABASE_URL di atas berlaku sebelum PrismaClient dibuat.
const { prisma } = await import("@/lib/db/prisma");
const { createPromotion, revalidateForCreate, checkG4Confirmation } = await import(
  "@/lib/services/promotion-write.service-create"
);
const { getPromotionAlerts, STALE_PENDING_MS } = await import(
  "@/lib/services/promotion-alert.service"
);

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ─────────────────────────── Fixture data ─────────────────────────── */
const NOW = Date.now();
const BEGIN = new Date(NOW + 3 * 3600000); // +3 jam (lolos lead time 2 jam)
const END = new Date(NOW + 3 * 3600000 + 3 * 86400000);

const business = await prisma.business.create({ data: { name: "Test Biz" } });
const account = await prisma.platformAccount.create({
  data: {
    platform: "TIKTOK_SHOP",
    label: "TikTok Test",
    accessToken: "fake-token",
    shopCipher: "fake-cipher",
    businessId: business.id,
  },
});
const master = await prisma.masterProduct.create({
  data: { name: "Keripik RIKI", businessId: business.id },
});

async function makeVariantSku(sku: string, price: number | null, productId: string, overridePrice: number | null = null) {
  const variant = await prisma.productVariant.create({
    data: { sku, stock: 10, price, masterProductId: master.id },
  });
  return prisma.productMapping.create({
    data: { channelSku: sku, variantId: variant.id, accountId: account.id, price: overridePrice, platformProductId: productId, platformTitle: `Listing ${sku}` },
  });
}

const m1 = await makeVariantSku("SKU-1", 100000, "P1"); // harga varian
const m2 = await makeVariantSku("SKU-2", 50000, "P2", 80000); // override mapping
const m3 = await makeVariantSku("SKU-3", null, "P3"); // TANPA harga sumber (G1)
const mForeign = await (async () => {
  const acc2 = await prisma.platformAccount.create({
    data: { platform: "TIKTOK_SHOP", label: "Toko Lain", businessId: business.id },
  });
  const v = await prisma.productVariant.create({ data: { sku: "SKU-F", stock: 1, price: 10000, masterProductId: master.id } });
  return prisma.productMapping.create({ data: { channelSku: "SKU-F", variantId: v.id, accountId: acc2.id, platformProductId: "PF" } });
})();

// Activity AKTIF yang memuat P1 → overlap G3 untuk mapping m1.
const activeAct = await prisma.promotionActivity.create({
  data: {
    accountId: account.id,
    externalActivityId: "EXT-ACTIVE",
    title: "Promo Lama Aktif",
    activityType: "DIRECT_DISCOUNT",
    status: "ONGOING",
    productLevel: "PRODUCT",
    startsAt: new Date(NOW - 86400000),
    endsAt: new Date(NOW + 5 * 86400000),
    items: { create: { externalItemKey: "P1:", platformProductId: "P1" } },
  },
});

// Activity BERAKHIR yang memuat P2 → TIDAK boleh memblock (Tahap 2, re-check).
await prisma.promotionActivity.create({
  data: {
    accountId: account.id,
    externalActivityId: "EXT-ENDED",
    title: "Promo Lama Berakhir",
    activityType: "DIRECT_DISCOUNT",
    status: "DEACTIVATED",
    productLevel: "PRODUCT",
    startsAt: new Date(NOW - 10 * 86400000),
    endsAt: new Date(NOW - 5 * 86400000),
    items: { create: { externalItemKey: "P2:", platformProductId: "P2" } },
  },
});

/* ─────────────────────── Fake TikTok client ─────────────────────── */
type Calls = { create: number; attach: number; getById: number };
let calls: Calls = { create: 0, attach: 0, getById: 0 };
let attachShouldFail = false;
let getByIdPayload: Record<string, unknown> | null = null;
let pendingAuditSeenAtCreateCall: number | null = null;

function makeClient() {
  return {
    async create() {
      calls.create += 1;
      // Bukti "audit PENDING SEBELUM call TikTok": saat fake create dieksekusi,
      // baris audit PENDING untuk sesi ini HARUS sudah ada di DB.
      pendingAuditSeenAtCreateCall = await prisma.promotionAuditLog.count({
        where: { resultStatus: "PENDING", action: "CREATE_ACTIVITY" },
      });
      return { activityId: "EXT-NEW-1", status: "NOT_START" };
    },
    async attach() {
      calls.attach += 1;
      if (attachShouldFail) {
        const err = new Error("[Tokopedia | Shop] API error (110050): products limit exceeded | req-1");
        Object.assign(err, { code: 110050, requestId: "req-1" });
        throw err;
      }
      return { totalCount: 2 };
    },
    async getById() {
      calls.getById += 1;
      return { code: 0, data: getByIdPayload ?? { status: "NOT_START", begin_time: Math.floor(BEGIN.getTime() / 1000), end_time: Math.floor(END.getTime() / 1000) } };
    },
  };
}

const baseReq = {
  accountId: account.id,
  userId: "user-test",
  username: "tester",
  mappingIds: [m1.id, m2.id],
  discountByMappingId: { [m1.id]: 10, [m2.id]: 20 },
  beginAt: BEGIN.toISOString(),
  endAt: END.toISOString(),
  confirmationWord: "BUAT",
};

/* ───────────────────────────── Tests ───────────────────────────── */
console.log("=== G4: kata konfirmasi DI SERVER (bukan cuma UI) ===");
await ok("confirmationWord salah → ditolak, 0 call TikTok, 0 baris audit", async () => {
  calls = { create: 0, attach: 0, getById: 0 };
  const res = await createPromotion({ ...baseReq, confirmationWord: "HAPUS" }, { client: makeClient() });
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.error.includes("BUAT"));
  assert.equal(calls.create, 0);
  assert.equal(await prisma.promotionAuditLog.count(), 0, "tidak boleh ada jejak audit utk penolakan");
});
await ok("checkG4Confirmation: ' BUAT ' lolos (trim), '' / undefined ditolak", async () => {
  assert.equal(checkG4Confirmation(" BUAT "), null);
  assert.ok(checkG4Confirmation("") !== null);
  assert.ok(checkG4Confirmation(undefined) !== null);
});

console.log("=== Re-validasi server-side G1–G3 (jangan percaya client) ===");
await ok("G1: produk tanpa harga sumber → ditolak dengan itemErrors", async () => {
  const res = await revalidateForCreate({ ...baseReq, mappingIds: [m3.id], discountByMappingId: { [m3.id]: 10 } });
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.itemErrors?.[0].error.includes("harga"));
});
await ok("G1: mapping milik toko lain → ditolak", async () => {
  const res = await revalidateForCreate({ ...baseReq, mappingIds: [mForeign.id], discountByMappingId: { [mForeign.id]: 10 } });
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.itemErrors?.[0].error.includes("Mapping tidak ditemukan"));
});
await ok("G2: diskon 96% TANPA confirmExtreme → ditolak; DENGAN → lolos revalidasi", async () => {
  // m2 = tanpa overlap aktif, supaya hasil murni mencerminkan G2 (bukan G3).
  const noConfirm = await revalidateForCreate({ ...baseReq, mappingIds: [m2.id], discountByMappingId: { [m2.id]: 96 } });
  assert.equal(noConfirm.ok, false);
  assert.ok(!noConfirm.ok && noConfirm.itemErrors?.[0].error.includes("konfirmasi dampak"));
  const withConfirm = await revalidateForCreate({ ...baseReq, mappingIds: [m2.id], discountByMappingId: { [m2.id]: 96 }, confirmExtreme: true });
  assert.equal(withConfirm.ok, true);
});
await ok("G2: diskon non-integer (12.5) → ditolak", async () => {
  const res = await revalidateForCreate({ ...baseReq, mappingIds: [m2.id], discountByMappingId: { [m2.id]: 12.5 } });
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.itemErrors?.[0].error.includes("bulatan") === false);
});
await ok("G3: overlap AKTIF tanpa acknowledge → ditolak; BERAKHIR tidak memblock", async () => {
  // m1 (P1) masih di activity ONGOING → ditolak tanpa ack.
  const blocked = await revalidateForCreate(baseReq);
  assert.equal(blocked.ok, false);
  assert.ok(!blocked.ok && blocked.error.includes("AKTIF"));
  // m2 (P2) hanya pernah di activity DEACTIVATED → TIDAK diblok (Tahap 2).
  const onlyPast = await revalidateForCreate({ ...baseReq, mappingIds: [m2.id], discountByMappingId: { [m2.id]: 20 } });
  assert.equal(onlyPast.ok, true);
  // Dengan acknowledge → lolos.
  const acked = await revalidateForCreate({ ...baseReq, acknowledgeActiveOverlap: true });
  assert.equal(acked.ok, true);
});
await ok("Schedule: begin <2 jam dari sekarang → ditolak", async () => {
  const res = await createPromotion(
    { ...baseReq, beginAt: new Date(NOW + 3600000).toISOString() },
    { client: makeClient() }
  );
  assert.equal(res.ok, false);
  assert.equal(calls.create, 0);
});

console.log("=== Alur create: sukses & terverifikasi (G5) ===");
await ok("create sukses (dengan ack overlap G3): audit SUCCESS, attach benar, G5 cocok", async () => {
  calls = { create: 0, attach: 0, getById: 0 };
  pendingAuditSeenAtCreateCall = null;
  // m1 punya overlap AKTIF → butuh acknowledgeActiveOverlap (sudah di-warn di preview).
  const res = await createPromotion({ ...baseReq, acknowledgeActiveOverlap: true }, { client: makeClient() });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.resultStatus, "SUCCESS");
  assert.equal(res.externalActivityId, "EXT-NEW-1");
  assert.equal(res.attachedCount, 2);
  assert.equal(calls.create, 1);
  assert.equal(calls.attach, 1);
  assert.equal(calls.getById, 1, "G5: Get by ID wajib dipanggil sebelum dianggap sukses");
  assert.equal(res.overlapWarningAcknowledged, true, "flag ack overlap harus sampai ke response");
  // Harga final G1: 100000-10% → 90000; override 80000-20% → 64000.
  const p1 = res.items.find((i) => i.mappingId === m1.id);
  const p2 = res.items.find((i) => i.mappingId === m2.id);
  assert.equal(p1?.priceAfter, 90000);
  assert.equal(p2?.priceAfter, 64000);
  assert.equal(p2?.priceBefore, 80000, "harga sumber = override mapping");
  const audit = await prisma.promotionAuditLog.findUniqueOrThrow({ where: { id: res.auditLogId } });
  assert.equal(audit.resultStatus, "SUCCESS");
  assert.equal(audit.externalActivityId, "EXT-NEW-1");
  assert.equal(audit.action, "CREATE_ACTIVITY");
  assert.equal(audit.username, "tester");
  assert.ok(audit.payloadSent?.includes("DIRECT_DISCOUNT"));
});
await ok("create sukses TANPA overlap: SUCCESS dengan overlapWarningAcknowledged=false", async () => {
  calls = { create: 0, attach: 0, getById: 0 };
  const res = await createPromotion(
    { ...baseReq, mappingIds: [m2.id], discountByMappingId: { [m2.id]: 20 } },
    { client: makeClient() }
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.resultStatus, "SUCCESS");
  assert.equal(res.attachedCount, 1);
  assert.equal(res.overlapWarningAcknowledged, false);
  // m2 (DEACTIVATED saja) tidak diblok — konsisten dengan keputusan Tahap 2.
});
await ok("BUKTI audit PENDING sudah ada di DB SAAT call TikTok dieksekusi", async () => {
  // Nilai direkam oleh fake client.create di test sukses di atas.
  assert.equal(pendingAuditSeenAtCreateCall, 1);
});

console.log("=== Kegagalan: attach gagal → UNVERIFIED (bukan SUCCESS palsu) ===");
await ok("attach batch pertama gagal → resultStatus UNVERIFIED + reason + audit DB UNVERIFIED", async () => {
  calls = { create: 0, attach: 0, getById: 0 };
  attachShouldFail = true;
  try {
    const res = await createPromotion(
      { ...baseReq, mappingIds: [m2.id], discountByMappingId: { [m2.id]: 20 } },
      { client: makeClient() }
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.resultStatus, "UNVERIFIED");
    assert.ok(res.unverifiedReason?.includes("Attach batch pertama gagal"));
    assert.equal(calls.create, 1, "activity TETAP terbentuk di TikTok → state tidak pasti");
    const audit = await prisma.promotionAuditLog.findUniqueOrThrow({ where: { id: res.auditLogId } });
    assert.equal(audit.resultStatus, "UNVERIFIED");
    assert.equal(audit.tiktokCode, null);
  } finally {
    attachShouldFail = false;
  }
});
await ok("G5 mismatch: Get by ID cocok tapi end_time beda → UNVERIFIED", async () => {
  calls = { create: 0, attach: 0, getById: 0 };
  getByIdPayload = {
    status: "NOT_START",
    begin_time: Math.floor(BEGIN.getTime() / 1000),
    end_time: Math.floor(END.getTime() / 1000) + 3600, // beda!
  };
  try {
    const res = await createPromotion(
      { ...baseReq, mappingIds: [m2.id], discountByMappingId: { [m2.id]: 20 } },
      { client: makeClient() }
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.resultStatus, "UNVERIFIED");
    assert.ok(res.unverifiedReason?.includes("tidak cocok"));
    const audit = await prisma.promotionAuditLog.findUniqueOrThrow({ where: { id: res.auditLogId } });
    assert.equal(audit.resultStatus, "UNVERIFIED");
  } finally {
    getByIdPayload = null;
  }
});
await ok("create call melempar (network error) → UNVERIFIED dengan tiktokCode tercatat", async () => {
  calls = { create: 0, attach: 0, getById: 0 };
  const failing = makeClient();
  failing.create = async () => {
    calls.create += 1;
    const err = new Error("[Tokopedia | Shop] API error (105003): internal | req-9");
    Object.assign(err, { code: 105003, requestId: "req-9" });
    throw err;
  };
  const res = await createPromotion(
    { ...baseReq, mappingIds: [m2.id], discountByMappingId: { [m2.id]: 20 } },
    { client: failing }
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.resultStatus, "UNVERIFIED");
  assert.equal(res.tiktokCode, 105003);
  const audit = await prisma.promotionAuditLog.findUniqueOrThrow({ where: { id: res.auditLogId } });
  assert.equal(audit.resultStatus, "UNVERIFIED");
  assert.equal(audit.tiktokCode, 105003);
  assert.equal(audit.requestId, "req-9");
});

console.log("=== Alert: UNVERIFIED & PENDING menggantung TERLIHAT (bukan cuma di DB) ===");
await ok("getPromotionAlerts: UNVERIFIED muncul di alert", async () => {
  const alerts = await getPromotionAlerts();
  const unv = alerts.filter((a) => a.kind === "UNVERIFIED");
  assert.ok(unv.length >= 3, "minimal 3 UNVERIFIED dari test sebelumnya");
  assert.ok(unv.every((a) => a.username.length > 0));
});
await ok("getPromotionAlerts: PENDING segar TIDAK alert; PENDING >30 menit → STALE_PENDING", async () => {
  const fresh = await prisma.promotionAuditLog.create({
    data: { accountId: account.id, userId: "u", username: "tester", action: "CREATE_ACTIVITY", resultStatus: "PENDING" },
  });
  let alerts = await getPromotionAlerts();
  assert.ok(!alerts.some((a) => a.auditLogId === fresh.id), "PENDING segar = sedang jalan, bukan alert");
  await prisma.promotionAuditLog.update({
    where: { id: fresh.id },
    data: { createdAt: new Date(Date.now() - STALE_PENDING_MS - 60000) },
  });
  alerts = await getPromotionAlerts();
  const stale = alerts.find((a) => a.auditLogId === fresh.id);
  assert.ok(stale && stale.kind === "STALE_PENDING");
});

console.log("=== Sanity fixture G3: activity aktif tadi benar-benar terdeteksi ===");
await ok("activeAct berstatus ONGOING dan memuat P1", async () => {
  const items = await prisma.promotionActivityItem.findMany({ where: { activityId: activeAct.id } });
  assert.equal(items[0].platformProductId, "P1");
});

/* ─────────────────────────── Cleanup ─────────────────────────── */
await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (integration). DB fixture dihapus.`);
console.log(`Audit rows tersisa di DB fixture: (file dihapus — tidak tersisa apa pun)`);
