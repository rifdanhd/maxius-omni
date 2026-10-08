import assert from "node:assert/strict";
import { maskEmail, maskPii, maskPhone, maskAddress } from "../lib/pii";

assert.equal(maskEmail("jane@gmail.com"), "j***@gmail.com");
assert.equal(maskEmail(null), null);
assert.equal(maskEmail("not-an-email"), "***");
assert.equal(maskPhone("1234"), "***");
assert.equal(maskPhone("12345678"), "***");
assert.equal(maskAddress("Jl Mawar No 12"), "***");
assert.equal(maskAddress("Jl Mawar No 12, Jakarta"), "***");
assert.equal(maskPii("call me at 1234"), "***");
console.log("PII security tests passed");
