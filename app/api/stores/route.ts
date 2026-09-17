import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withAuth } from "@/lib/utils/api";

const AUTHORIZE_PATH: Record<string, string> = {
  SHOPEE: "/api/auth/shopee/authorize",
  TIKTOK_SHOP: "/api/auth/tiktok/authorize",
};

export const GET = withAuth(async (req) => {
  try {
    const accounts = await prisma.platformAccount.findMany({
      where: { businessId: req.businessId },
      include: { business: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    const stores = accounts.map((acc) => {
      const hasToken = Boolean(acc.accessToken);
      const expired =
        hasToken && acc.tokenExpiresAt
          ? acc.tokenExpiresAt.getTime() <= Date.now()
          : false;
      return {
        id: acc.id,
        name: acc.label,
        platform: acc.platform,
        businessId: acc.businessId,
        businessName: acc.business.name,
        isFrozen: acc.isFrozen,
        frozenReason: acc.frozenReason,
        lastSyncAt: acc.updatedAt.toISOString(),
        status: !hasToken ? "disconnected" : expired ? "expired" : "connected",
        connectedAt: acc.createdAt.toISOString(),
        tokenExpiresAt: acc.tokenExpiresAt?.toISOString() ?? null,
        scope: acc.scope,
        authorizePath: AUTHORIZE_PATH[acc.platform] ?? null,
      };
    });

    return NextResponse.json(stores);
  } catch (error) {
    console.error("Error fetching stores:", error);
    return NextResponse.json({ error: "Failed to fetch stores" }, { status: 500 });
  }
});
