import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { autoLinkTikTokUnmapped } from "@/lib/services/marketplace-tiktok.service";

/**
 * POST /api/marketplace/tiktok/products/unmapped/auto-link
 * Menjalankan pencocokan otomatis massal untuk seluruh produk unmapped TikTok
 * terhadap master SKU yang sudah ada di stok pusat.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  try {
    const body = await req.json().catch(() => ({}));
    const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : undefined;
    const providedProducts = Array.isArray(body?.products) ? body.products : undefined;

    const result = await autoLinkTikTokUnmapped(req.businessId, accountId, providedProducts);
    return NextResponse.json({
      ok: true,
      linkedCount: result.linkedCount,
      message:
        result.linkedCount > 0
          ? `Berhasil menghubungkan ${result.linkedCount} varian secara otomatis ke stok pusat!`
          : "Tidak ditemukan SKU yang cocok dengan stok pusat saat ini.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal menjalankan auto-link massal.";
    console.error("[TT AutoLink Error]", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
});
