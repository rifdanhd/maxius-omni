import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";
import { recordSale } from "@/lib/services/sales.service";

export const GET = withAuth(async () => {
  const log = await prisma.salesLog.findMany({
    orderBy: { time: "desc" },
    take: 20,
  });
  return NextResponse.json({ log });
});

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { accountId, channelSku, qty } = body;
    const result = await recordSale({ accountId, channelSku, qty });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mencatat penjualan.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
