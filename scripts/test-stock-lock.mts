import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { adjustStockAbsoluteInTx, STOCK_REASONS } from "../lib/services/central-stock.service";
let stock = 10;
let queue = Promise.resolve();
const ledger: { changeQty: number; stockAfter: number }[] = [];
async function adjustment(value: number, snapshotStock?: number) {
  let release!: () => void;
  const previous = queue;
  queue = new Promise<void>(r => { release = r; });
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      assert.ok(strings.join("").includes("FOR UPDATE"));
      await previous;
      return [{ id: "v", sku: "sku", stock }];
    },
    productVariant: { update: async ({ data }: { data: { stock: number } }) => { stock = data.stock; } },
    stockLedger: { create: async ({ data }: { data: { changeQty: number; stockAfter: number } }) => { ledger.push(data); } },
  } as unknown as Prisma.TransactionClient;
  try { return await adjustStockAbsoluteInTx(tx, { variantId: "v", newStock: value, snapshotStock, reason: STOCK_REASONS.MANUAL_ADJUSTMENT }); }
  finally { release(); }
}
await Promise.all([adjustment(12), adjustment(15)]);
assert.equal(stock, 15);
assert.deepEqual(ledger.map(l => l.changeQty), [2, 3]);
// An opname snapshot of 10 counted as 9 must preserve five intervening units.
await adjustment(9, 10);
assert.equal(stock, 14);
assert.equal((await adjustment(1.5)).ok, false);
console.log("Concurrent stock lock and snapshot tests passed");
