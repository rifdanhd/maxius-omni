import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { getTikTokUnmapped } from "@/lib/services/marketplace-tiktok.service";

// GET /api/marketplace/tiktok/products/unmapped?accountId=...
//   Discovery read-only: produk TikTok per akun yang belum punya ProductMapping
//   lokal. Tidak menulis DB — mapping baru hanya via aksi eksplisit user
//   (POST /api/inventory/mappings).
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  try {
    const accountId = req.nextUrl.searchParams.get("accountId")?.trim() || undefined;
    const accounts = await getTikTokUnmapped(req.businessId, accountId);
    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal memuat produk belum ter-mapping.";
    console.error("[TT] unmapped error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});
