import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { restockReturnItem } from "@/lib/services/return-restock.service";

/** POST /api/returns/restock — konfirmasi gudang: terima & tambah stok (internal). */
export const POST = withAuth(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { itemId?: string };
  if (!body.itemId) {
    return NextResponse.json({ error: "itemId wajib diisi." }, { status: 400 });
  }

  // Pastikan item retur milik brand yang sama (guard multi-brand).
  const item = await prisma.returnItem.findUnique({
    where: { id: body.itemId },
    select: { returnRequest: { select: { account: { select: { businessId: true } } } } },
  });
  if (!item || item.returnRequest.account.businessId !== req.businessId) {
    return NextResponse.json({ error: "Item retur tidak ditemukan." }, { status: 404 });
  }

  const result = await restockReturnItem(body.itemId, req.user);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Gagal restock." }, { status: 400 });
  }
  return NextResponse.json(result);
});
