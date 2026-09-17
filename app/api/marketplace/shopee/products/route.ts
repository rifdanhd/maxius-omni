import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import {
  getShopeeAccounts,
  listShopeeProducts,
} from "@/lib/services/marketplace-shopee.service";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const accountIds = sp
    .get("accountIds")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [result, accounts] = await Promise.all([
    listShopeeProducts({
      businessId: req.businessId,
      search: sp.get("search") ?? undefined,
      accountIds,
      page: Number(sp.get("page") ?? 1),
      pageSize: Number(sp.get("pageSize") ?? 20),
    }),
    getShopeeAccounts(req.businessId),
  ]);

  return NextResponse.json({ ...result, accounts });
});
