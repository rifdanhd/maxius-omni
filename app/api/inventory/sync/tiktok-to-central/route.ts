import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { syncTikTokStockToCentral } from "@/lib/services/tiktok-central-stock-sync.service";
import { StockPreviewConflict } from "@/lib/services/stock-preview.policy";
import { Prisma } from "@prisma/client";
import { z } from "zod";

/** POST /api/inventory/sync/tiktok-to-central { accountId } */
export const POST = withAuth(async (req) => {
  const body = z.object({ accountId: z.string().trim().min(1).max(200), confirm: z.boolean().optional(), previewToken: z.string().max(4000).optional() }).strict().parse(await req.json());
  if (typeof body.accountId !== "string" || !body.accountId.trim()) {
    return NextResponse.json({ ok: false, error: "accountId toko TikTok wajib diisi." }, { status: 400 });
  }
  try {
    const result = await syncTikTokStockToCentral(req.businessId, req.user.id, body.accountId, { apply: body.confirm === true, previewToken: body.previewToken });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof StockPreviewConflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")) return NextResponse.json({ error: "Preview berubah atau kedaluwarsa. Ambil preview baru sebelum mengganti stok pusat." }, { status: 409 });
    const message = error instanceof Error ? error.message : "Sinkronisasi stok TikTok gagal.";
    console.error("[TikTokCentralStock]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
});
