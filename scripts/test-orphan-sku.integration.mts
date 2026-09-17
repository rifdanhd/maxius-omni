/**
 * [TEST] ORPHAN SKU SERVICE — deteksi & mapping dgn backfill historis.
 *
 * DB fixture ASLI (SQLite temp + migrate deploy) — tanpa mock prisma.
 * Jalankan: npx tsx scripts/test-orphan-sku.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";

const dbPath = path.join(process.cwd(), "prisma", `test-orphan-sku-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const {
  findOrphanSkus,
  mapOrphanToVariant,
  mapOrphanToNewMaster,
} = await import("@/lib/services/orphan-sku.service");
const { logOrphanSku } = await import("@/lib/services/sync-log.util");

let passed = 0;
function ok(name: string) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ── Fixture: 2 akun; order item orphan & ter-mapping; 1 order CANCELLED ── */
// Baris "business-default" — di produksi dibuat saat migrasi data;
// PlatformAccount/MasterProduct butuh ini via FK businessId.
await prisma.business.create({ data: { id: "business-default", name: "Default" } });
const acctA = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "Toko A", accessToken: "tok-a" },
});
const acctB = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "Toko B" },
});
const master = await prisma.masterProduct.create({
  data: {
    name: "Master Lama",
    variants: { create: [{ sku: "MASTER-1", stock: 5 }, { sku: "MASTER-2", stock: 7 }] },
  },
  include: { variants: true },
});
const variant = master.variants.find((v) => v.sku === "MASTER-1");
const variant2 = master.variants.find((v) => v.sku === "MASTER-2");
assert.ok(variant && variant2, "varian fixture harus ada");

async function mkOrder(acctId: string, status: string, items: Array<{ channelSku: string; qty: number; productName: string }>) {
  return prisma.order.create({
    data: {
      orderNo: `T${Math.random().toString(36).slice(2, 10)}`,
      status,
      accountId: acctId,
      createTime: new Date(),
      items: { create: items.map((i) => ({ ...i, price: 1000 })) },
    },
    include: { items: true },
  });
}

await mkOrder(acctA.id, "COMPLETED", [
  { channelSku: "SKU-X", qty: 2, productName: "Produk X lama" },
]);
await mkOrder(acctA.id, "PENDING", [
  { channelSku: "SKU-X", qty: 1, productName: "Produk X baru" },
]);
await mkOrder(acctB.id, "CANCELLED", [
  { channelSku: "SKU-Y", qty: 9, productName: "Produk Y (batal)" },
]);
await mkOrder(acctA.id, "COMPLETED", [
  { channelSku: "SKU-Z", qty: 2, productName: "Produk Z" },
]);
await mkOrder(acctA.id, "COMPLETED", [
  { channelSku: "SKU-Q", qty: 2, productName: "Produk Q" },
]);

/* 1. Deteksi: SKU-X (3 pcs / 2 order) & SKU-Z; SKU-Y batal = dikecualikan */
const orphans1 = await findOrphanSkus("business-default");
assert.equal(orphans1.length, 3, `harus 3 orphan, dapat ${orphans1.length}`);
assert.equal(orphans1[0].channelSku, "SKU-X", "urut qty terbesar");
assert.equal(orphans1[0].qty, 3);
assert.equal(orphans1[0].orderCount, 2);
assert.equal(orphans1[0].accountId, acctA.id);
assert.equal(orphans1[0].sampleProductName, "Produk X baru", "sample = order terbaru");
assert.equal(orphans1[0].existingMappingId, null);
const skuSet1 = new Set(orphans1.map((o) => o.channelSku));
assert.ok(skuSet1.has("SKU-Z") && skuSet1.has("SKU-Q"));
ok("deteksi: 3 orphan (SKU-X 3pcs/2order, SKU-Z, SKU-Q), CANCELLED dikecualikan");

/* 2. Mapping row sudah ada (order mendahului mapping) → existingMappingId terisi.
 *    Pakai variant2 supaya varian MASTER-1 tetap bebas utk kasus lain. */
const existingMapping = await prisma.productMapping.create({
  data: { accountId: acctA.id, channelSku: "SKU-Z", variantId: variant2!.id },
});
const orphans2 = await findOrphanSkus("business-default");
const z = orphans2.find((o) => o.channelSku === "SKU-Z");
assert.ok(z, "SKU-Z tetap orphan walau mapping sudah ada");
assert.equal(z!.existingMappingId, existingMapping.id);
ok("existingMappingId terisi bila mapping sudah ada (kasus order lama)");

/* 3. mapOrphanToVariant: backfill 2 baris item SKU-X (total qty 3), orphan hilang */
const r3 = await mapOrphanToVariant({ accountId: acctA.id, channelSku: "SKU-X", variantId: variant!.id });
assert.ok(r3.ok, "mapOrphanToVariant harus sukses");
if (r3.ok) assert.equal(r3.backfilled, 2, `backfill 2 baris, dapat ${r3.backfilled}`);
const remainingX = await prisma.orderItem.count({ where: { channelSku: "SKU-X", variantId: null } });
assert.equal(remainingX, 0);
const orphans3 = await findOrphanSkus("business-default");
assert.ok(!orphans3.some((o) => o.channelSku === "SKU-X"));
ok("mapOrphanToVariant: 3 OrderItem ter-backfill, orphan SKU-X hilang dari deteksi");

/* 4. mapOrphanToNewMaster: master+varian+mapping+ledger INIT+backfill.
 *    SKU-Z sudah punya mapping (step 2) → pakai SKU-Q yang masih orphan. */
const r4 = await mapOrphanToNewMaster({
  businessId: "business-default",
  accountId: acctA.id,
  channelSku: "SKU-Q",
  newProductName: "Produk Q Master",
  sku: "Q-MASTER",
});
assert.ok(r4.masterProductId && r4.variantId);
assert.equal(r4.backfilled, 1, `backfill 1 baris (qty 2), dapat ${r4.backfilled}`);
const newVariant = await prisma.productVariant.findUnique({ where: { id: r4.variantId } });
assert.equal(newVariant?.stock, 0, "stok awal 0 (angka nyata diinput admin via UI)");
const initLedger = await prisma.stockLedger.findFirst({
  where: { variantId: r4.variantId, reason: "INIT" },
});
assert.ok(initLedger, "StockLedger INIT dibuat (audit trail titik nol)");
assert.equal(initLedger!.stockAfter, 0);
const orphans4 = await findOrphanSkus("business-default");
assert.deepEqual(orphans4.map((o) => o.channelSku), ["SKU-Z"], "tersisa SKU-Z (mapping ada, item historis sudah menunjuk varian2)");
ok("mapOrphanToNewMaster: master baru + ledger INIT + backfill 1 baris item");

/* 5. Idempotensi backfill + guard varian sudah dipakai SKU lain */
const r5 = await mapOrphanToVariant({ accountId: acctA.id, channelSku: "SKU-X", variantId: variant!.id });
assert.ok(r5.ok, "mapOrphanToVariant ulang harus sukses");
if (r5.ok) assert.equal(r5.backfilled, 0, "backfill ulang = 0 (sudah terisi)");
const itemCount = await prisma.orderItem.count({ where: { channelSku: "SKU-X" } });
assert.equal(itemCount, 2, "tidak ada item duplikat (2 baris, qty total 3)");
ok("idempoten: backfill ulang aman (0 perubahan)");

// Varian MASTER-1 sudah dipakai SKU-X di acctA → mapping SKU lain ke varian
// sama harus ditolak dengan pesan jelas (schema: @@unique accountId+variantId).
const r5b = await mapOrphanToVariant({ accountId: acctA.id, channelSku: "SKU-W-test", variantId: variant!.id });
assert.equal(r5b.ok, false, "varian yang sudah dipakai harus ditolak");
assert.ok(r5b.ok === false && r5b.reason === "variant_already_mapped");
assert.match(r5b.ok === false ? r5b.message : "", /sudah dipakai channel SKU/);
ok("guard: satu varian hanya 1 channel SKU per akun (pesan 409 jelas)");

/* 6. Marker pasif logOrphanSku: idempotent per (akun, SKU) selama unhandled */
await logOrphanSku(acctA.id, "SKU-M", 2);
await logOrphanSku(acctA.id, "SKU-M", 5); // duplikat — harus di-skip
const markers1 = await prisma.syncLog.findMany({
  where: { accountId: acctA.id, kind: "orphan_sku" },
});
assert.equal(markers1.length, 1, `1 marker, dapat ${markers1.length}`);
assert.match(markers1[0].message ?? "", /SKU-M/);
assert.equal(markers1[0].status, "warning");

await logOrphanSku(acctA.id, "SKU-N", 1); // SKU lain → marker baru
const markers2 = await prisma.syncLog.count({
  where: { accountId: acctA.id, kind: "orphan_sku" },
});
assert.equal(markers2, 2);

// Marker lama sudah ditangani (admin) → SKU sama boleh dapat marker baru.
await prisma.syncLog.update({
  where: { id: markers1[0].id },
  data: { handledAt: new Date(), handledBy: "admin" },
});
await logOrphanSku(acctA.id, "SKU-M", 3);
const markers3 = await prisma.syncLog.count({
  where: { accountId: acctA.id, kind: "orphan_sku", handledAt: null, payload: { contains: '"SKU-M"' } },
});
assert.equal(markers3, 1, "marker baru setelah yang lama ditangani");
ok("marker orphan_sku: idempotent unhandled, SKU lain terpisah, handled → boleh baru");

console.log(`\nPASS: ${passed} test group (orphan-sku). DB fixture dihapus.`);
await prisma.$disconnect();
execSync(`rm -f ${dbPath}`);
process.exit(0);
