import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const requestedTake = Number(searchParams.get("take") ?? "50");
  const take = Number.isInteger(requestedTake) ? Math.min(Math.max(requestedTake, 1), 100) : 50;

  const activities = await prisma.promotionActivity.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      ...(status ? { status } : {}),
      account: { platform: "TIKTOK_SHOP", businessId: req.businessId },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    take,
    include: {
      account: { select: { id: true, label: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          productMapping: {
            select: { id: true, channelSku: true, platformProductId: true },
          },
        },
      },
    },
  });

  return NextResponse.json({
    ok: true,
    activities: activities.map((activity) => ({
      ...activity,
      startsAt: activity.startsAt.toISOString(),
      endsAt: activity.endsAt.toISOString(),
      sourceCreatedAt: activity.sourceCreatedAt?.toISOString() ?? null,
      sourceUpdatedAt: activity.sourceUpdatedAt?.toISOString() ?? null,
      lastConfirmedAt: activity.lastConfirmedAt?.toISOString() ?? null,
      createdAt: activity.createdAt.toISOString(),
      updatedAt: activity.updatedAt.toISOString(),
      items: activity.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    })),
  });
});
