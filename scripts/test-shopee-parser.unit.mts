/**
 * [TEST] UNIT — parser envelope Shopee (parseShopeeEnvelope di lib/integrations/shopee.ts).
 *
 * Kasus wajib: objek, array root, bukan JSON, non-2xx + envelope, error pada 2xx
 * (kode asli dipertahankan → konsumen refresh token bergantung pada err.error),
 * dan potongan body terpotong ≤300 karakter.
 *
 * Jalankan: npx tsx scripts/test-shopee-parser.unit.mts
 */
import assert from "node:assert";
import { parseShopeeEnvelope, ShopeeApiError } from "@/lib/integrations/shopee";

const PATH = "/api/v2/product/get_item_list";

function throwsApi(fn: () => unknown): ShopeeApiError {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof ShopeeApiError, `expected ShopeeApiError, got ${String(e)}`);
    return e;
  }
  throw new Error("expected throw, tapi tidak ada");
}

/* 1. Objek envelope valid (2xx) → sukses, response dibaca. */
{
  const raw = JSON.stringify({ error: "", message: "success", response: { item: [], total_count: 0 } });
  const env = parseShopeeEnvelope(200, raw, PATH);
  assert.deepStrictEqual(env.response, { item: [], total_count: 0 });
}

/* 2. Bentuk array root → j[0] yang dipakai. */
{
  const raw = JSON.stringify([{ error: "", response: { item: [{ item_id: 1 }] } }]);
  const env = parseShopeeEnvelope(200, raw, PATH);
  assert.deepStrictEqual(env.response, { item: [{ item_id: 1 }] });
}

/* 3. Bukan JSON → ShopeeApiError http_400 + snippet body di pesan. */
{
  const raw = "<html><body>400 Bad Request</body></html>";
  const err = throwsApi(() => parseShopeeEnvelope(400, raw, PATH));
  assert.strictEqual(err.error, "http_400");
  assert.ok(err.message.includes("body bukan JSON"), err.message);
  assert.ok(err.message.includes("<html>"), err.message);
}

/* 4. Non-2xx + envelope JSON → kode Shopee asli + snippet body ikut di pesan. */
{
  const raw = JSON.stringify({
    error: "invalid_acceess_token",
    message: "access token not found",
    request_id: "rid-403",
  });
  const err = throwsApi(() => parseShopeeEnvelope(403, raw, PATH));
  assert.strictEqual(err.error, "invalid_acceess_token");
  assert.strictEqual(err.requestId, "rid-403");
  assert.ok(err.message.includes("access token not found"), err.message);
  assert.ok(err.message.includes("— body:"), err.message);
}

/* 5. 2xx tapi env.error terisi → cabang terpisah: kode asli, TANPA snippet body. */
{
  const raw = JSON.stringify({ error: "error_auth", message: "token invalid", request_id: "rid-200" });
  const err = throwsApi(() => parseShopeeEnvelope(200, raw, PATH));
  assert.strictEqual(err.error, "error_auth", "kode error asli harus dipertahankan");
  assert.strictEqual(err.requestId, "rid-200");
  assert.ok(err.message.includes("token invalid"), err.message);
  assert.ok(!err.message.includes("— body:"), err.message);
}

/* 6. Body panjang dipotong: tidak ada run 301 karakter identik di pesan. */
{
  const raw = "A".repeat(500);
  const err = throwsApi(() => parseShopeeEnvelope(502, raw, PATH));
  assert.ok(err.message.includes("A".repeat(300)), "snippet 300 char harus ada");
  assert.ok(!err.message.includes("A".repeat(301)), "melebihi 300 char tidak boleh ikut");
}

/* 7. Bukan objek setelah parse (mis. JSON "null") → tetap error ber-snippet. */
{
  const err = throwsApi(() => parseShopeeEnvelope(200, "null", PATH));
  assert.strictEqual(err.error, "http_200");
  assert.ok(err.message.includes("tak dikenal"), err.message);
}

console.log("[OK] test-shopee-parser.unit: 7/7 kasus lulus");
