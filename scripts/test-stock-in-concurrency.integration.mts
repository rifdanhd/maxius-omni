/**
 * [TEST] Temuan #2 (PHASE A fix-up) — race condition endpoint stock-in.
 *
 * Mereplikasi PERSIS pola app/api/inventory/stock-in/route.ts (Opsi B):
 *   adjustStockManually mode INCREMENT ({ increment: qty }) — atomik
 *   `stock = stock + qty` + 1 baris ledger dalam SATU transaksi DB.
 * Pola LAMA (read di luar transaksi → hitung stock+qty → tulis absolut
 * via { newStock }) sudah DIHAPUS dari route karena lost update.
 *
 * Ekspektasi BENAR: stok 100 +10 +10 = 120.
 * Pola lama menghasilkan 110 (satu +10 ketiban) → test GAGAL = race terbukti.
 * Setelah fix Opsi B, test ini HIJAU.
 *
 * Jalankan:  npx tsx scripts/test-stock-in-concurrency.integration.mts
 */
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.join(process.cwd(), "prisma", `test-stock-in-race-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
execSync("npx prisma migrate deploy", {
  env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  stdio: "pipe",
});

const { prisma } = await import("@/lib/db/prisma");
const { adjustStockManually, STOCK_REASONS } = await import(
  "@/lib/services/central-stock.service"
);

const business = await prisma.business.create({ data: { name: "Race" } });
const master = await prisma.masterProduct.create({
  data: { name: "Race Prod", businessId: business.id },
});
const variant = await prisma.productVariant.create({
  data: { sku: "RACE-IN-1", stock: 100, masterProductId: master.id },
});

/** Satu "request stock-in" meniru route.ts (Opsi B): increment atomik, tanpa read. */
async function stockInRequest(qty: number) {
  return adjustStockManually({
    variantId: variant.id,
    increment: qty,
    note: `Barang masuk +${qty} pcs (simulasi route)`,
    reason: STOCK_REASONS.STOCK_IN,
  });
}

// Dua admin menekan "Barang Masuk +10" BERSAMAAN: kedua read terlayani
// sebelum write mana pun commit (interleaving terburuk yang wajar di beban).
const [r1, r2] = await Promise.all([stockInRequest(10), stockInRequest(10)]);
assert.equal(r1.ok, true);
assert.equal(r2.ok, true);

const final = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
console.log(`stok awal 100, dua stock-in +10 bersamaan → stok akhir ${final} (harusnya 120)`);
assert.equal(final, 120, `RACE: satu +10 ketiban (final=${final}, expected=120)`);

// Satu event stock-in = tepat SATU baris ledger (tidak ada dobel akibat retry/interleaving).
const ledgers = await prisma.stockLedger.findMany({
  where: { variantId: variant.id, reason: "STOCK_IN" },
});
assert.equal(ledgers.length, 2, `ledger harus 2 baris (1 per stock-in), dapat ${ledgers.length}`);
assert.deepEqual(
  ledgers.map((l) => l.changeQty).sort((a, b) => a - b),
  [10, 10]
);

await prisma.$disconnect();
fs.rmSync(dbPath, { force: true });
console.log("\nPASS: stock-in konkuren tidak kehilangan update.");
