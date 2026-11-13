import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { syncTikTokListings } from "@/lib/services/marketplace-tiktok.service";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

// POST /api/marketplace/tiktok/products/sync
//   Tarik semua produk Tokopedia | Shop per akun & update status mapping lokal.
export const POST = withAuth(async (req) => {
  const { accountIds } = z.object({ accountIds: z.array(z.string().min(1).max(200)).min(1).max(50).optional() }).strict().parse(await req.json().catch(() => ({})));
  if (accountIds) {
    const count = await prisma.platformAccount.count({ where: { id: { in: accountIds }, businessId: req.businessId, platform: "TIKTOK_SHOP" } });
    if (count !== new Set(accountIds).size) return NextResponse.json({ error: "Toko tidak ditemukan pada bisnis aktif." }, { status: 404 });
  }
  try {
    const results = accountIds
      ? (await Promise.all([...new Set(accountIds)].map((id) => syncTikTokListings(req.businessId, id)))).flat()
      : await syncTikTokListings(req.businessId);
    return NextResponse.json({ ok: true, accounts: results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync gagal.";
    console.error("[TT] sync listing error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
});
