/**
 * [TEST] INTEGRATION test TUGAS 1 — anti-oversell (race condition stok).
 *
 * DB fixture ASLI (SQLite temp + migrate deploy) — tanpa mock prisma.
 * Simulasi dua order untuk varian yang SAMA diproses (hampir) bersamaan:
 * - stok pas-pasan → tepat SATU yang lolos, stok TIDAK PERNAH negatif
 * - order yang gagal dapat stok tercatat di SyncLog (status "skipped") —
 *   tidak silent-fail
 * - idempotensi duel: deduct order yang SAMA dua kali bersamaan → stok
 *   terpotong tepat sekali (unique index gugurkan yang kedua)
 * - rollback penuh: order multi-varian dengan satu varian kurang → TIDAK ada
 *   varian yang terpotong (tidak boleh setengah)
 *
 * Jalankan:  npx tsx scripts/test-stock-guard.integration.mts
 */
import crypto from "crypto";
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-stock-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const now = new Date();
const {
  deductStockForOrder,
  restoreStockForCanceledOrder,
  InsufficientStockError,
} = await import("@/lib/services/central-stock.service");
const { recordSale } = await import("@/lib/services/sales.service");
const {
  buildDeductPlan,
  isDeduplicationFailure,
  insufficientStockMessage,
} = await import("@/lib/services/stock-guard.policy");

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/* ─────────────────────────── Fixture ─────────────────────────── */
const business = await prisma.business.create({ data: { name: "Stock Test" } });
const accA = await prisma.platformAccount.create({
  data: { platform: "TIKTOK_SHOP", label: "Toko A", businessId: business.id },
});
const accB = await prisma.platformAccount.create({
  data: { platform: "SHOPEE", label: "Toko B", businessId: business.id },
});
const master = await prisma.masterProduct.create({
  data: { name: "Produk Race", businessId: business.id, threshold: 5 },
});

/** Varian + 2 mapping (2 platform) → 2 order dari platform berbeda. */
async function makeVariantWithOrders(sku: string, stock: number, qtyPerOrder: number) {
  const variant = await prisma.productVariant.create({
    data: { sku, stock, masterProductId: master.id },
  });
  await prisma.productMapping.create({
    data: { id: crypto.randomUUID(), channelSku: `${sku}-A`, variantId: variant.id, accountId: accA.id, updatedAt: new Date() },
  });
  await prisma.productMapping.create({
    data: { id: crypto.randomUUID(), channelSku: `${sku}-B`, variantId: variant.id, accountId: accB.id, updatedAt: new Date() },
  });
  const mkOrder = async (platform: "TIKTOK_SHOP" | "SHOPEE", label: string) => {
    const account = platform === "TIKTOK_SHOP" ? accA : accB;
    const order = await prisma.order.create({
      data: {
        id: crypto.randomUUID(),
        orderNo: label,
        status: "AWAITING_SHIPMENT",
        accountId: account.id,
        updatedAt: now,
        items: { create: { id: crypto.randomUUID(), qty: qtyPerOrder, channelSku: `${sku}-${platform === "TIKTOK_SHOP" ? "A" : "B"}`, variantId: variant.id } },
      },
    });
    return order;
  };
  return { variant, orderA: await mkOrder("TIKTOK_SHOP", "RACE-A"), orderB: await mkOrder("SHOPEE", "RACE-B") };
}

/* ─────────────────────────── Tests ─────────────────────────── */
console.log("=== Policy murni (buildDeductPlan & dedup) ===");
await ok("buildDeductPlan: akumulasi per varian + urut variantId (anti-deadlock)", async () => {
  const plan = buildDeductPlan(
    [
      { variantId: "v-b", qty: 1 },
      { variantId: "v-a", qty: 2 },
      { variantId: "v-a", qty: 3 },
      { variantId: null, qty: 99 }, // tidak ter-mapping → dilewati
      { variantId: "v-c", qty: 0 }, // qty 0 → dilewati
    ],
    "note",
    "acc"
  );
  assert.deepEqual(
    plan.map((p) => [p.variantId, p.qty]),
    [["v-a", 5], ["v-b", 1]]
  );
});
await ok("isDeduplicationFailure: P2002 & SQLite UNIQUE, bukan error lain", async () => {
  assert.equal(isDeduplicationFailure({ code: "P2002" }), true);
  assert.equal(isDeduplicationFailure(new Error("UNIQUE constraint failed: StockLedger.x")), true);
  assert.equal(isDeduplicationFailure(new Error("Connection refused")), false);
});
await ok("insufficientStockMessage menyebut SKU, sisa, dan butuh", async () => {
  const msg = insufficientStockMessage("SKU-1", 3, 5);
  assert.ok(msg.includes("SKU-1") && msg.includes("3") && msg.includes("5") && msg.includes("manual"));
});

console.log("=== RACE: dua order bersamaan, stok pas-pasan (cukup utk SATU saja) ===");
for (let round = 0; round < 5; round++) {
  await ok(`ronde ${round + 1}: tepat satu order lolos, stok final = 0, tidak minus`, async () => {
    const { variant, orderA, orderB } = await makeVariantWithOrders(`R${round}-SKU`, 5, 5);
    // "Hampir bersamaan": kedua deduct dilempar tanpa await yang pertama.
    const results = await Promise.allSettled([
      deductStockForOrder(orderA.id),
      deductStockForOrder(orderB.id),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled" && r.value.ok && !r.value.already);
    assert.equal(fulfilled.length, 1, "hanya satu order boleh memotong stok");
    const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    assert.equal(after.stock, 0, "stok harus terpotong tepat 5 → 0");
    assert.ok(after.stock >= 0, "stok TIDAK BOLEH negatif");
    const ledgers = await prisma.stockLedger.findMany({ where: { variantId: variant.id, reason: "ORDER" } });
    assert.equal(ledgers.length, 1, "ledger ORDER hanya satu baris");
    // Yang kalah → jejak SyncLog (skipped) supaya ditinjau manual, bukan hilang.
    const loser = results.find(
      (r) => r.status === "fulfilled" && !r.value.ok
    ) as { value: { reason?: string } } | undefined;
    if (loser) {
      const logs = await prisma.syncLog.findMany({
        where: { kind: "central_stock_deduct", status: "skipped" },
      });
      assert.ok(logs.length >= 1, "order yang gagal dapat stok harus tercatat di SyncLog");
      assert.ok(
        logs.some((l) => (l.message ?? "").includes("Stok tidak cukup")),
        "pesan SyncLog memuat alasan stok kurang"
      );
    }
  });
}

console.log("=== RACE: stok cukup utk keduanya → dua-duanya lolos ===");
await ok("dua order bersamaan stok 100 qty 5 → stok 90, dua ledger", async () => {
  const { variant, orderA, orderB } = await makeVariantWithOrders("ENOUGH-SKU", 100, 5);
  const [a, b] = await Promise.all([deductStockForOrder(orderA.id), deductStockForOrder(orderB.id)]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
  assert.equal(after.stock, 90);
  const ledgers = await prisma.stockLedger.findMany({ where: { variantId: variant.id, reason: "ORDER" } });
  assert.equal(ledgers.length, 2);
});

console.log("=== RACE idempotensi: order SAMA diproses dua kali bersamaan ===");
await ok("deduct order sama x2 paralel → stok terpotong tepat sekali", async () => {
  const { variant, orderA } = await makeVariantWithOrders("IDEM-SKU", 50, 5);
  const [a, b] = await Promise.allSettled([
    deductStockForOrder(orderA.id),
    deductStockForOrder(orderA.id),
  ]);
  const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
  assert.equal(after.stock, 45, "hanya boleh terpotong sekali");
  const ledgers = await prisma.stockLedger.findMany({ where: { variantId: variant.id, reason: "ORDER", referenceId: orderA.id } });
  assert.equal(ledgers.length, 1);
  const values = await Promise.all([a, b]);
  const okResults = values.filter(
    (r) => r.status === "fulfilled" && (r.value.already || (r.value.ok && !r.value.already))
  );
  assert.equal(okResults.length, 2, "keduanya return sukses (satu asli, satu already)");
});

console.log("=== Rollback penuh: multi-varian, satu varian kurang ===");
await ok("order 2 varian (A cukup, B kurang) → TIDAK ADA yang terpotong", async () => {
  const vA = await prisma.productVariant.create({ data: { sku: "MULTI-A", stock: 10, masterProductId: master.id } });
  const vB = await prisma.productVariant.create({ data: { sku: "MULTI-B", stock: 2, masterProductId: master.id } });
  const order = await prisma.order.create({
    data: {
      id: crypto.randomUUID(),
      orderNo: "MULTI-1",
      status: "AWAITING_SHIPMENT",
      accountId: accA.id,
      updatedAt: now,
      items: {
        create: [
          { id: crypto.randomUUID(), qty: 3, channelSku: "MULTI-A", variantId: vA.id },
          { id: crypto.randomUUID(), qty: 5, channelSku: "MULTI-B", variantId: vB.id },
        ],
      },
    },
  });
  const res = await deductStockForOrder(order.id);
  assert.equal(res.ok, false);
  assert.ok(res.reason?.includes("Stok tidak cukup"));
  const a = await prisma.productVariant.findUniqueOrThrow({ where: { id: vA.id } });
  const b = await prisma.productVariant.findUniqueOrThrow({ where: { id: vB.id } });
  assert.equal(a.stock, 10, "varian A TIDAK boleh terpotong (rollback penuh)");
  assert.equal(b.stock, 2);
  const logs = await prisma.syncLog.findMany({ where: { kind: "central_stock_deduct", status: "skipped" } });
  assert.ok(logs.some((l) => (l.message ?? "").includes("Stok tidak cukup")));
});

console.log("=== recordSale: jalur webhook/manual juga atomik ===");
await ok("recordSale stok pas-pasan: satu lolos satu throw, stok tidak minus", async () => {
  const { variant } = await makeVariantWithOrders("SALE-SKU", 5, 5);
  const [okSale, failSale] = await Promise.allSettled([
    recordSale({ accountId: accA.id, channelSku: "SALE-SKU-A", qty: 5 }),
    recordSale({ accountId: accB.id, channelSku: "SALE-SKU-B", qty: 5 }),
  ]);
  assert.equal(okSale.status, "fulfilled");
  assert.equal(failSale.status, "rejected");
  const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
  assert.equal(after.stock, 0);
  assert.ok(after.stock >= 0);
  const err = (failSale as PromiseRejectedResult).reason as Error;
  assert.ok(err.message.includes("Stok tidak cukup"));
});

console.log("=== Restore tetap idempotent (duel dua restore bersamaan) ===");
await ok("restore order sama x2 paralel → stok kembali tepat sekali", async () => {
  const { variant, orderA } = await makeVariantWithOrders("RESTORE-SKU", 50, 5);
  await deductStockForOrder(orderA.id); // 50 → 45
  await Promise.allSettled([
    restoreStockForCanceledOrder(orderA.id, "ORDER_CANCELLED"),
    restoreStockForCanceledOrder(orderA.id, "ORDER_CANCELLED"),
  ]);
  const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
  assert.equal(after.stock, 50, "restore hanya sekali");
  const ledgers = await prisma.stockLedger.findMany({
    where: { variantId: variant.id, reason: "ORDER_CANCELLED", referenceId: orderA.id },
  });
  assert.equal(ledgers.length, 1);
});

await ok("InsufficientStockError terekspos utk caller", async () => {
  assert.ok(new InsufficientStockError("x").name === "InsufficientStockError");
});

/* ─────────────────────────── Cleanup ─────────────────────────── */
await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log(`\nPASS: ${passed} test group (stock-guard). DB fixture dihapus.`);
