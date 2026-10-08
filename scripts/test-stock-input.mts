import assert from "node:assert/strict";
import { stockInSchema, stockAdjustSchema, opnameCountsSchema, validateApiJson } from "../lib/security/input";
assert.equal(stockInSchema.safeParse({ variantId: "v", qty: 1.5 }).success, false);
assert.equal(stockInSchema.safeParse({ variantId: "v", qty: "2" }).success, false);
assert.equal(stockInSchema.safeParse({ variantId: "v", qty: 2 }).success, true);
assert.equal(stockAdjustSchema.safeParse({ newStock: 1.5 }).success, false);
assert.equal(opnameCountsSchema.safeParse({ counts: [{ variantId: "v", countedStock: -1 }] }).success, false);
for (const key of ["stock", "safetyStock", "qty", "newStock", "countedStock"]) assert.throws(() => validateApiJson({ nested: { [key]: 1.5 } }));
console.log("Integer stock input tests passed");
