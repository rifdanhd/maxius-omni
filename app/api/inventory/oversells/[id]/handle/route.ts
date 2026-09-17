import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";

/**
 * POST /api/inventory/oversells/:id/handle — tandai entri oversell sudah
 * ditangani (update status saja, tanpa alur refund otomatis).
 */
export const POST = withAuth(async (req: AuthenticatedRequest, ctx) => {
  const params = (await ctx?.params) as { id?: string } | undefined;
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "SyncLog id wajib diisi." }, { status: 400 });
  }

  const existing = await prisma.syncLog.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      handledAt: true,
      account: { select: { businessId: true } },
    },
  });
  if (!existing || existing.kind !== "central_stock_deduct") {
    return NextResponse.json({ error: "Entri oversell tidak ditemukan." }, { status: 404 });
  }
  try {
    assertSameBrand(existing.account.businessId, req.businessId);
  } catch {
    return NextResponse.json({ error: "Entri oversell tidak ditemukan." }, { status: 404 });
  }

  const updated = await prisma.syncLog.update({
    where: { id },
    data: { handledAt: new Date(), handledBy: req.user.username },
    select: { id: true, handledAt: true, handledBy: true },
  });

  return NextResponse.json({
    id: updated.id,
    handledAt: updated.handledAt?.toISOString() ?? null,
    handledBy: updated.handledBy,
  });
});
