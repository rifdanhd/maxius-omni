import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

// Riwayat perubahan stok (StockLedger) utk audit — terbaru di atas.
// ?variantId= & ?reason= (mis. SAFETY_STOCK_CHANGE utk riwayat cadangan).
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const variantId = url.searchParams.get("variantId")?.trim() || undefined;
  const reason = url.searchParams.get("reason")?.trim() || undefined;

  const entries = await prisma.stockLedger.findMany({
    where: {
      ...(variantId ? { variantId } : {}),
      ...(reason ? { reason } : {}),
    },
    include: {
      variant: { select: { id: true, sku: true, masterProduct: { select: { name: true } } } },
      account: { select: { id: true, label: true, platform: true } },
      user: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ entries });
});