import assert from "node:assert";
import { setupTestDb } from "@/scripts/lib/test-db";

const db = setupTestDb("stock-movement");
const { prisma } = await import("@/lib/db/prisma");
const { effectiveStock, recordManualStockMovement } = await import(
  "@/lib/services/central-stock.service"
);

const business = await prisma.business.create({ data: { name: "Stock Movement Test" } });
const product = await prisma.masterProduct.create({
  data: { name: "Produk Gerakan", businessId: business.id },
});
const variant = await prisma.productVariant.create({
  data: { sku: "MOVE-1", stock: 10, safetyStock: 3, masterProductId: product.id },
});

const stockIn = await recordManualStockMovement({
  variantId: variant.id,
  direction: "IN",
  qty: 5,
  reasonLabel: "Pembelian atau restok",
  requestId: "request-stock-in-001",
});
assert.equal(stockIn.ok, true);
assert.equal(stockIn.stockAfter, 15);

const stockInRetry = await recordManualStockMovement({
  variantId: variant.id,
  direction: "IN",
  qty: 5,
  reasonLabel: "Pembelian atau restok",
  requestId: "request-stock-in-001",
});
assert.equal(stockInRetry.ok, true);
assert.equal(stockInRetry.already, true);
assert.equal(stockInRetry.stockAfter, 15);

const stockOut = await recordManualStockMovement({
  variantId: variant.id,
  direction: "OUT",
  qty: 4,
  reasonLabel: "Barang rusak",
  requestId: "request-stock-out-001",
});
assert.equal(stockOut.ok, true);
assert.equal(stockOut.stockAfter, 11);

const stockOutRetry = await recordManualStockMovement({
  variantId: variant.id,
  direction: "OUT",
  qty: 4,
  reasonLabel: "Barang rusak",
  requestId: "request-stock-out-001",
});
assert.equal(stockOutRetry.ok, true);
assert.equal(stockOutRetry.already, true);

const tooMuch = await recordManualStockMovement({
  variantId: variant.id,
  direction: "OUT",
  qty: 99,
  reasonLabel: "Koreksi stok keluar",
  requestId: "request-stock-out-too-much",
});
assert.equal(tooMuch.ok, false);
assert.match(tooMuch.reason ?? "", /hanya 11/);

const race = await Promise.all([
  recordManualStockMovement({
    variantId: variant.id,
    direction: "OUT",
    qty: 6,
    reasonLabel: "Barang rusak",
    requestId: "request-stock-out-race-a",
  }),
  recordManualStockMovement({
    variantId: variant.id,
    direction: "OUT",
    qty: 6,
    reasonLabel: "Barang rusak",
    requestId: "request-stock-out-race-b",
  }),
]);
assert.equal(race.filter((result) => result.ok).length, 1);

const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
assert.equal(after.stock, 5);
assert.ok(after.stock >= 0);
assert.equal(effectiveStock(after.stock, after.safetyStock), 2);

const ledgers = await prisma.stockLedger.findMany({
  where: { variantId: variant.id, reason: { in: ["STOCK_IN", "STOCK_OUT"] } },
});
assert.equal(ledgers.filter((entry) => entry.reason === "STOCK_IN").length, 1);
assert.equal(ledgers.filter((entry) => entry.reason === "STOCK_OUT").length, 2);
assert.ok(ledgers.every((entry) => entry.stockAfter >= 0));

await prisma.$disconnect();
db.cleanup();
console.log("PASS: stok masuk/keluar atomik, idempoten, tidak minus, dan cadangan terhitung.");
