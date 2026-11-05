import assert from "node:assert/strict";
import { selectedShopeeShop } from "../lib/services/shopee-account.policy";

assert.equal(selectedShopeeShop("44835480", [44835480, 1929797459]), "44835480");
assert.equal(selectedShopeeShop("44835480"), "44835480");
for (const value of [undefined, "", "44835480,1929797459", "[44835480]", "-1", "0", "1e10"]) {
  assert.throws(() => selectedShopeeShop(value), /satu toko/);
}
assert.throws(() => selectedShopeeShop("44835480", [1929797459]), /otorisasi/);
console.log("PASS: only explicit selected shop, no bulk attachment, mismatched authorization rejected");
