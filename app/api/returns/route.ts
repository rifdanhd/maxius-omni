import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export const GET = withAuth(async (req) => {
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status")?.trim();
  const platformParam = searchParams.get("platform")?.trim();
  const q = searchParams.get("q")?.trim() || null;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSizeRaw = Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSizeRaw));

  // Tab "Menunggu Konfirmasi Gudang" = retur diterima & belum direstock.
  const tab = searchParams.get("tab")?.trim() || null;

  const whereStatus =
    tab === "warehouse"
      ? { status: { in: ["IN_TRANSIT", "RECEIVED", "APPROVED", "REFUNDED"] }, returnItem: { none: { restockedAt: { not: null }, variantId: { not: null } } } }
      : statusParam
        ? { status: { in: statusParam.split(",").map((s) => s.trim()).filter(Boolean) } }
        : {};

  const wherePlatform = platformParam ? { account: { platform: platformParam } } : {};

  const whereSearch = q
    ? {
        OR: [
          { externalReturnId: { contains: q } },
          { externalOrderId: { contains: q } },
          { reasonText: { contains: q } },
          { returnItem: { some: { channelSku: { contains: q } } } },
          { returnItem: { some: { productName: { contains: q } } } },
        ],
      }
    : {};

  const where = {
    AND: [{ account: { businessId: req.businessId } }, whereStatus, wherePlatform, whereSearch],
  };

  const [returns, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include: {
        account: { select: { id: true, platform: true, label: true } },
        returnItem: {
          include: {
            variant: { select: { sku: true, name: true, masterProduct: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ statusChangedAt: "desc" }, { firstSeenAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.returnRequest.count({ where }),
  ]);

  return NextResponse.json({ returns, total, page, pageSize });
});
