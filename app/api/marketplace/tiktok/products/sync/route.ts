import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { syncTikTokListings } from "@/lib/services/marketplace-tiktok.service";

// POST /api/marketplace/tiktok/products/sync
//   Tarik semua produk Tokopedia | Shop per akun & update status mapping lokal.
export const POST = withAuth(async (req) => {
  try {
    const results = await syncTikTokListings(req.businessId);
    return NextResponse.json({ ok: true, accounts: results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync gagal.";
    console.error("[TT] sync listing error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});