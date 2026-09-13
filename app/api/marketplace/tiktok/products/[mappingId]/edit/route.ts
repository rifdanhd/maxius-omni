import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { loadTikTokEditData } from "@/lib/services/marketplace-tiktok-edit.service";

// GET /api/marketplace/tiktok/products/[mappingId]/edit
//   Data lengkap form edit (gabungan lokal + TikTok terkini).
export const GET = withAuth(async (_req, ctx) => {
  const mappingId = ctx?.params ? (await ctx.params).mappingId ?? null : null;
  if (!mappingId) return NextResponse.json({ error: "Mapping id hilang." }, { status: 400 });

  try {
    const data = await loadTikTokEditData(mappingId);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Gagal memuat data edit.";
    console.error("[TT] load edit error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});