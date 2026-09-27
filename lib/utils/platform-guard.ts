import { NextResponse } from "next/server";

export const UNSUPPORTED_PLATFORM_CODE = "unsupported_platform";

/** Alasan per-item utk daftar `failed` cetak label batch. */
export const NON_TIKTOK_LABEL_REASON =
  "order non-TikTok — label resmi TikTok tidak berlaku (cetak label lokal dari menu Cetak)";

/**
 * Guard endpoint fulfillment/label milik TikTok: order Shopee (atau platform
 * lain) tidak boleh pernah menyentuh API TikTok — token Shopee tidak dipakai
 * ke TikTok dan order Shopee tidak memicu panggilan TikTok. Dipanggil SEBELUM
 * panggilan TikTok API apa pun.
 */
export function unsupportedPlatform(platform: string): NextResponse {
  return NextResponse.json(
    {
      error:
        platform === "SHOPEE"
          ? "Fitur ini hanya untuk TikTok Shop. Order Shopee dikirim/dicetak via Seller Center Shopee."
          : `Fitur ini hanya untuk TikTok Shop (platform ${platform} tidak didukung).`,
      code: UNSUPPORTED_PLATFORM_CODE,
    },
    { status: 400 }
  );
}
