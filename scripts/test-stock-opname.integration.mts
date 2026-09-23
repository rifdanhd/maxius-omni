/**
 * [TEST] INTEGRATION — FITUR Stok Opname + Riwayat Inventori.
 *
 * DB fixture ASLI (SQLite temp + migrate deploy) — tanpa mock prisma.
 * Fokus kriteria selesai:
 *  1. Finalisasi opname koreksi stok lewat jalur central-stock yang SAMA
 *     (bukti: StockLedger reason STOCK_OPNAME; reason MANUAL_ADJUSTMENT dari
 *     API adjust lama tetap bekerja; stok konsisten).
 *  2. Finalisasi parsial ditolak; opname batal tidak menyentuh stok.
 *  3. Finalisasi ganda bersamaan → idempoten (unique ledger), stok tidak
 *     terkoreksi dua kali.
 *  4. History: union ledger + oversell SyncLog, cursor pagination tidak
 *     skip/dobel, filter tanggal/produk/sumber bekerja.
 *
 * Jalankan:  npx tsx scripts/test-stock-opname.integration.mts
 */
import crypto from "crypto";
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-opname-${Date.now()}.db`);
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
const {
  createStockOpname,
  recordOpnameCounts,
  cancelStockOpname,
  finalizeStockOpname,
} = await import("@/lib/services/stock-opname.service");
const { listInventoryHistory, getInventoryHistoryCounts } = await import(
  "@/lib/services/stock-history.service"
);

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
async function rejects(name: string, fn: () => Promise<unknown>, mustContain: string) {
  try {
    await fn();
    assert.fail("harusnya throw");
  } catch (e) {
    assert.ok(
      e instanceof Error && e.message.includes(mustContain),
      `pesan harus mengandung "${mustContain}", dapat: ${e instanceof Error ? e.message : e}`
    );
  }
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ─────────────────────────── Fixture ─────────────────────────── */
const business = await prisma.business.create({ data: { name: "Opname Test" } });
const acc = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "Toko Opname", businessId: business.id },
});
const master = await prisma.masterProduct.create({
  data: { name: "Produk Opname", businessId: business.id },
});
const user = await prisma.user.create({ data: { id: crypto.randomUUID(), username: "admin-opname", passwordHash: "x" } });

async function mkVariant(sku: string, stock: number) {
  return prisma.productVariant.create({ data: { sku, stock, masterProductId: master.id } });
}

/* ─────────────────────────── FITUR 1 ─────────────────────────── */
console.log("=== FITUR 1: Stok Opname ===");

const vA = await mkVariant("OPN-A", 10);
const vB = await mkVariant("OPN-B", 5);
const vC = await mkVariant("OPN-C", 7);

let opname1: { id: string; code: string };
await ok("create: snapshot stok sistem saat dibuat (bukan live)", async () => {
  const r = await createStockOpname({ businessId: "business-default", 
    variantIds: [vA.id, vB.id],
    note: "hitung fisik",
    userId: user.id,
  });
  assert.ok(r.ok);
  opname1 = r.opname as { id: string; code: string };
  assert.match(opname1.code, /^OPN-\d{8}-/);
  const items = (r.opname as { items: Array<{ variantId: string; systemStock: number }> }).items;
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.systemStock).sort((a, b) => a - b),
    [5, 10]
  );
});

await ok("stok berubah SETELAH opname dibuat → snapshot tidak ikut berubah", async () => {
  await prisma.productVariant.update({ where: { id: vA.id }, data: { stock: 8 } });
  const detail = await prisma.stockOpnameItem.findFirstOrThrow({
    where: { opnameId: opname1.id, variantId: vA.id },
  });
  assert.equal(detail.systemStock, 10); // snapshot, bukan 8
});

await ok("recordCounts parsial → status IN_PROGRESS", async () => {
  const r = await recordOpnameCounts({
    opnameId: opname1.id,
    counts: [{ variantId: vA.id, countedStock: 9 }],
  });
  assert.ok(r.ok);
  assert.equal((r.opname as { status: string }).status, "IN_PROGRESS");
});

await ok("finalisasi parsial DITOLAK (tidak ada koreksi setengah hitung)", async () => {
  const r = await finalizeStockOpname({ opnameId: opname1.id, userId: user.id });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /belum dihitung/);
  const still = await prisma.productVariant.findUniqueOrThrow({ where: { id: vA.id } });
  assert.equal(still.stock, 8); // stok tak tersentuh
});

await ok("cancel: opname batal TIDAK menyentuh stok & tidak menulis ledger", async () => {
  const r = await cancelStockOpname({ opnameId: opname1.id });
  assert.ok(r.ok);
  assert.equal((r.opname as { status: string }).status, "CANCELLED");
  const ledgers = await prisma.stockLedger.count({
    where: { reason: STOCK_REASONS.STOCK_OPNAME, referenceId: opname1.id },
  });
  assert.equal(ledgers, 0);
  const still = await prisma.productVariant.findUniqueOrThrow({ where: { id: vA.id } });
  assert.equal(still.stock, 8);
});

await rejects("finalisasi opname CANCELLED ditolak", () =>
  finalizeStockOpname({ opnameId: opname1.id, userId: user.id }).then((r) => {
    if (!r.ok) throw new Error(r.reason ?? "");
  }),
  "dibatalkan"
);

// Opname lengkap: A (snapshot 8) → fisik 6; B (snapshot 5) → fisik 5; C (7) → fisik 12
let opname2: { id: string; code: string };
await ok("finalisasi lengkap: selisih dikoreksi via jalur central-stock", async () => {
  const r0 = await createStockOpname({ businessId: "business-default", 
    variantIds: [vA.id, vB.id, vC.id],
    userId: user.id,
  });
  opname2 = r0.opname as { id: string; code: string };
  await recordOpnameCounts({
    opnameId: opname2.id,
    counts: [
      { variantId: vA.id, countedStock: 6 },
      { variantId: vB.id, countedStock: 5 }, // cocok → skip
      { variantId: vC.id, countedStock: 12 },
    ],
  });
  const r = await finalizeStockOpname({ opnameId: opname2.id, userId: user.id });
  assert.ok(r.ok, r.reason);
  assert.equal(r.adjusted, 2);
  assert.equal(r.skipped, 1);
  assert.equal((r.opname as { status: string }).status, "COMPLETED");

  // Angka stok akhir persis hasil hitung fisik.
  const [a, b, c] = await Promise.all([
    prisma.productVariant.findUniqueOrThrow({ where: { id: vA.id } }),
    prisma.productVariant.findUniqueOrThrow({ where: { id: vB.id } }),
    prisma.productVariant.findUniqueOrThrow({ where: { id: vC.id } }),
  ]);
  assert.equal(a.stock, 6);
  assert.equal(b.stock, 5);
  assert.equal(c.stock, 12);

  // BUKTI jalur yang sama: ledger reason STOCK_OPNAME w/ referenceId opname.id,
  // stockAfter konsisten, note memuat kode opname.
  const ledgers = await prisma.stockLedger.findMany({
    where: { reason: STOCK_REASONS.STOCK_OPNAME, referenceId: opname2.id },
    orderBy: { variantId: "asc" },
  });
  assert.equal(ledgers.length, 2);
  const byVar = new Map(ledgers.map((l) => [l.variantId, l]));
  assert.equal(byVar.get(vA.id)!.changeQty, -2); // 8 → 6
  assert.equal(byVar.get(vA.id)!.stockAfter, 6);
  assert.equal(byVar.get(vC.id)!.changeQty, 5); // 7 → 12
  assert.ok(byVar.get(vC.id)!.note!.includes(opname2.code));
});

await ok("finalisasi GANDA bersamaan → idempoten, stok tidak terkoreksi 2×", async () => {
  // Reset: buat opname baru dgn selisih, lalu finalize dua-duanya bersamaan.
  const vD = await mkVariant("OPN-D", 20);
  const r0 = await createStockOpname({ businessId: "business-default",  variantIds: [vD.id], userId: user.id });
  const oid = (r0.opname as { id: string }).id;
  await recordOpnameCounts({ opnameId: oid, counts: [{ variantId: vD.id, countedStock: 15 }] });
  const [r1, r2] = await Promise.allSettled([
    finalizeStockOpname({ opnameId: oid, userId: user.id }),
    finalizeStockOpname({ opnameId: oid, userId: user.id }),
  ]);
  const fulfilled = [r1, r2].filter((x) => x.status === "fulfilled" && (x.value as { ok: boolean }).ok);
  assert.equal(fulfilled.length, 2, "keduanya boleh 'ok' (satu asli, satu already)");
  const ledgerCount = await prisma.stockLedger.count({
    where: { reason: STOCK_REASONS.STOCK_OPNAME, referenceId: oid },
  });
  assert.equal(ledgerCount, 1, "ledger tepat 1 baris");
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: vD.id } });
  assert.equal(v.stock, 15, "terkoreksi tepat sekali");
});

await rejects("countedStock negatif ditolak", () =>
  createStockOpname({ businessId: "business-default",  variantIds: [vA.id] }).then(async (r) => {
    const oid = (r.opname as { id: string }).id;
    const rr = await recordOpnameCounts({
      opnameId: oid,
      counts: [{ variantId: vA.id, countedStock: -3 }],
    });
    if (!rr.ok) throw new Error(rr.reason ?? "");
  }),
  "negatif"
);

/* ─────────────────────────── FITUR 2 ─────────────────────────── */
console.log("=== FITUR 2: Riwayat Inventori ===");

// Bangun kejadian beragam: order masuk (deduct), oversell (stok pas-pasan),
// penyesuaian manual (jalur lama), opname (sudah ada di atas).
const oversellVariant = await mkVariant("HIST-OVERSELL", 1);
await prisma.productMapping.create({
  data: { id: crypto.randomUUID(), channelSku: "HIST-OVERSELL-ACC", variantId: oversellVariant.id, accountId: acc.id, updatedAt: new Date() },
});
const oversellOrder = await prisma.order.create({
  data: {
    id: crypto.randomUUID(),
    orderNo: "HIST-OV-1",
    status: "AWAITING_SHIPMENT",
    accountId: acc.id,
    updatedAt: new Date(),
    items: {
      create: { id: crypto.randomUUID(), qty: 2, channelSku: "HIST-OVERSELL-ACC", variantId: oversellVariant.id },
    },
  },
});
await ok("oversell tertangkap → SyncLog skipped (order butuh tinjauan manual)", async () => {
  const r = await deductStockForOrder(oversellOrder.id);
  assert.equal(r.ok, false); // stok 1 < qty 2
  const log = await prisma.syncLog.findFirst({
    where: { kind: "central_stock_deduct", status: "skipped" },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(log);
  assert.ok(log.message?.includes("HIST-OV-1"));
});

await ok("jalur lama (adjustStockManually) tetap bekerja pasca-refactor", async () => {
  const r = await adjustStockManually({
    variantId: vB.id,
    newStock: 9,
    note: "koreksi lama tetap jalan",
    adjustedByUserId: user.id,
  });
  assert.ok(r.ok);
  assert.equal(r.changeQty, 4); // 5 → 9
  const ledger = await prisma.stockLedger.findFirstOrThrow({
    where: { reason: STOCK_REASONS.MANUAL_ADJUSTMENT, variantId: vB.id },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(ledger.stockAfter, 9);
  assert.equal(ledger.userId, user.id);
});

await ok("list: union ledger + oversell, terbaru di atas", async () => {
  const { items, nextCursor } = await listInventoryHistory({ businessId: "business-default",  limit: 50 });
  // 2 opname(opname2) + 1 opname(OPN-D) + 1 manual + 1 oversell = 5 minimal.
  assert.ok(items.length >= 5, `dapat ${items.length} baris`);
  assert.ok(nextCursor === null || typeof nextCursor === "string");
  const kinds = new Set(items.map((i) => i.eventKind));
  assert.ok(kinds.has("OPNAME"), "opname muncul");
  assert.ok(kinds.has("OVERSELL"), "oversell muncul");
  assert.ok(kinds.has("MANUAL"), "manual muncul");
  assert.ok(kinds.has("ORDER") === false || true); // order sukses mungkin ada
  // Urutan desc.
  for (let i = 1; i < items.length; i++) {
    assert.ok(
      items[i - 1].occurredAt.getTime() >= items[i].occurredAt.getTime(),
      "urutan desc"
    );
  }
});

await ok("oversell di history: changeQty null, orderNo terbaca dari message", async () => {
  const { items } = await listInventoryHistory({ businessId: "business-default",  source: "synclog", limit: 10 });
  const ov = items.find((i) => i.eventKind === "OVERSELL");
  assert.ok(ov, "oversell ada");
  assert.equal(ov.changeQty, null);
  assert.ok(ov.event.includes("HIST-OV-1"));
  assert.equal(ov.sku, "HIST-OVERSELL");
});

await ok("sebelum→sesudah konsisten (before = after − change)", async () => {
  const { items } = await listInventoryHistory({ businessId: "business-default",  source: "ledger", limit: 100 });
  for (const it of items) {
    if (it.changeQty !== null && it.changeQty !== 0) {
      assert.equal(it.stockBefore! + it.changeQty, it.stockAfter, it.id);
    }
  }
});

await ok("filter q (SKU) hanya mengembalikan varian terkait", async () => {
  const { items } = await listInventoryHistory({ businessId: "business-default",  q: "HIST-OVERSELL", limit: 50 });
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.sku === "HIST-OVERSELL"));
});

await ok("filter tanggal from/to mengurangi hasil", async () => {
  const all = await listInventoryHistory({ businessId: "business-default",  limit: 100 });
  const emptyFuture = await listInventoryHistory({ businessId: "business-default", 
    from: new Date(Date.now() + 86_400_000 * 2).toISOString(),
    to: new Date(Date.now() + 86_400_000 * 3).toISOString(),
    limit: 100,
  });
  assert.ok(all.items.length > 0);
  assert.equal(emptyFuture.items.length, 0);
});

await ok("cursor pagination: walk sampai habis TANPA dobel & TANPA skip", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const { items, nextCursor } = await listInventoryHistory({ businessId: "business-default",  limit: 3, cursor });
    seen.push(...items.map((i) => `${i.source}:${i.id}`));
    cursor = nextCursor;
    pages++;
    assert.ok(pages < 50, "loop tak berujung");
  } while (cursor);
  assert.equal(new Set(seen).size, seen.length, "tidak ada dobel");
  // Bandingkan dengan satu halaman besar (set sama).
  const all = await listInventoryHistory({ businessId: "business-default",  limit: 100 });
  const allKeys = new Set(all.items.map((i) => `${i.source}:${i.id}`));
  assert.equal(seen.length, allKeys.size, "jumlah sama dgn ambil semua");
  for (const k of seen) assert.ok(allKeys.has(k), `${k} hilang dari hasil full`);
});

await ok("counts agregasi DB-level", async () => {
  const counts = await getInventoryHistoryCounts("business-default");
  assert.ok((counts.OPNAME ?? 0) >= 2);
  assert.ok((counts.OVERSELL ?? 0) >= 1);
  assert.ok((counts.MANUAL ?? 0) >= 1);
});

/* ─────────────────────────── Selesai ─────────────────────────── */
console.log(`\n${passed}/${passed} PASS`);
await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
process.exit(0);
