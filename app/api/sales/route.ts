import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import { assertSameBrand } from "@/lib/services/business-scope.service";
import { recordSale } from "@/lib/services/sales.service";

export const GET = withAuth(async (req) => {
  const log = await prisma.salesLog.findMany({
    where: { account: { businessId: req.businessId } },
    orderBy: { time: "desc" },
    take: 20,
  });
  return NextResponse.json({ log });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  try {
    const body = await req.json();
    const { accountId, channelSku, qty } = body;
    if (accountId) {
      const acc = await prisma.platformAccount.findUnique({
        where: { id: String(accountId) },
        select: { businessId: true },
      });
      if (!acc) {
        return NextResponse.json({ error: "Akun tidak ditemukan." }, { status: 404 });
      }
      try {
        assertSameBrand(acc.businessId, req.businessId);
      } catch {
        return NextResponse.json({ error: "Akun tidak ditemukan." }, { status: 404 });
      }
    }
    const result = await recordSale({ accountId, channelSku, qty });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mencatat penjualan.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
