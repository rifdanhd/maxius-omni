import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { syncTikTokStockToCentral } from "@/lib/services/tiktok-central-stock-sync.service";

/** POST /api/inventory/sync/tiktok-to-central { accountId } */
export const POST = withAuth(async (req) => {
  const body = await req.json() as { accountId?: unknown; confirm?: unknown };
  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return NextResponse.json({ ok: false, error: "accountId toko TikTok wajib diisi." }, { status: 400 });
  }
  try {
    const result = await syncTikTokStockToCentral(req.businessId, req.user.id, body.accountId, { apply: body.confirm === true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sinkronisasi stok TikTok gagal.";
    console.error("[TikTokCentralStock]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
});
