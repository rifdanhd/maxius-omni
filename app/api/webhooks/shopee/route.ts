import { NextRequest } from "next/server";

/**
 * Webhook Shopee — STUB (integrasi Shopee belum dibangun).
 *
 * Endpoint ini sengaja ada supaya URL webhook Shopee sudah bisa didaftarkan
 * nanti tanpa merombak routing. Saat integrasi Shopee Open API siap, isi ulang
 * langkah berikut (mirip pola TikTok di app/api/webhooks/tiktok/route.ts):
 *   1. Verifikasi signature: header `Authorization` = SHA256(
 *        protocol + host + path + query + timestamp + body ) dengan partner_key,
 *      dan header `Timestamp`. Reject 401 kalau tidak cocok.
 *   2. Resolve akun: PlatformAccount platform="SHOPEE" via shop_id dari payload.
 *   3. Untuk topik ORDER_STATUS (order baru / update), ambil order → reduce
 *      stok via deductStockFromMapping() — mapping ProductMapping per akun.
 *   4. Push stok baru ke listing lain via pushVariantStockToOthers().
 *
 * Sekarang: terima & akui request (200) supaya platform tidak retry-storm,
 * tidak ada proses apa pun yang dijalankan. Log server menandai masih stub.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  console.warn(
    "[webhook-shopee] integrasi Shopee belum aktif — event diterima tanpa diproses. Body:",
    rawBody.slice(0, 500)
  );
  return new Response(null, { status: 200 });
}