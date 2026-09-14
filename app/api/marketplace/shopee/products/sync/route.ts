import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { syncShopeeListings } from "@/lib/services/marketplace-shopee.service";

export const POST = withAuth(async () => {
  try {
    const results = await syncShopeeListings();
    return NextResponse.json({ ok: true, accounts: results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync gagal.";
    console.error("[Shopee] sync listing error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});
