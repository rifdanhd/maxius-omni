import { NextResponse } from "next/server";
import { withAuth, type AuthenticatedRequest } from "@/lib/utils/api";
import {
  listTikTokProducts,
  getTikTokAccounts,
  getLastTiktokSyncTime,
  TIKTOK_TABS,
  TIKTOK_TAB_LABELS,
  type TikTokTabKey,
} from "@/lib/services/marketplace-tiktok.service";

const SORTS = [
  "name_asc",
  "name_desc",
  "price_asc",
  "price_desc",
  "stock_asc",
  "stock_desc",
  "updated_desc",
] as const;

// GET /api/marketplace/tiktok/products
//   search, sort, accountIds (csv), tab, page, pageSize
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const sp = req.nextUrl.searchParams;
  const tab = sp.get("tab") ?? "all";
  if (tab !== "all" && !(TIKTOK_TABS as readonly string[]).includes(tab)) {
    return NextResponse.json({ error: "Tab tidak dikenali." }, { status: 400 });
  }
  const sort = sp.get("sort") ?? "name_asc";
  if (!SORTS.includes(sort as (typeof SORTS)[number])) {
    return NextResponse.json({ error: "Sort tidak dikenali." }, { status: 400 });
  }
  const accountIds = sp
    .get("accountIds")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await listTikTokProducts({
    businessId: req.businessId,
    search: sp.get("search") ?? undefined,
    sort: sort as (typeof SORTS)[number],
    accountIds,
    tab: tab as TikTokTabKey,
    page: Number(sp.get("page") ?? 1),
    pageSize: Number(sp.get("pageSize") ?? 20),
  });

  const [accounts, lastSyncedAt] = await Promise.all([
    getTikTokAccounts(req.businessId),
    getLastTiktokSyncTime(req.businessId),
  ]);

  return NextResponse.json({
    ...result,
    tabs: TIKTOK_TABS.map((key) => ({ key, label: TIKTOK_TAB_LABELS[key] })),
    accounts,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
  });
});