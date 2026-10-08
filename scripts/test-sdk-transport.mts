import assert from "node:assert/strict";
import { execute } from "../lib/security/sdk-request";
const original = globalThis.fetch;
let seen: RequestInit | undefined;
let seenUrl = "";
globalThis.fetch = async (input, init) => {
  seenUrl = String(input); seen = init;
  return Response.json({ code: 0, data: { ok: true } });
};
try {
  const result = await execute({ uri: "https://open-api.tiktokglobalshop.com/test", method: "POST", qs: { sku: "a b" }, headers: { "content-type": "application/json" }, body: { qty: 2 }, json: true });
  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.body, { code: 0, data: { ok: true } });
  assert.equal(new URL(seenUrl).searchParams.get("sku"), "a b");
  assert.equal(seen?.body, '{"qty":2}');
  await execute({ uri: "https://open-api.tiktokglobalshop.com/upload", method: "POST", headers: { "Content-Type": "multipart/form-data" }, formData: { data: { value: Buffer.from("file"), options: { filename: "x.png", contentType: "image/png" } } }, json: true });
  assert.equal(new Headers(seen?.headers).has("content-type"), false);
  assert.equal((seen?.body as unknown as FormData).get("data") instanceof File, true);
  await assert.rejects(execute({ uri: "http://127.0.0.1" }));
} finally { globalThis.fetch = original; }
console.log("Native SDK transport tests passed");
