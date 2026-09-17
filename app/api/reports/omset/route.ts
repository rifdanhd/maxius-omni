import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { cached } from "@/lib/utils/ttl-cache";
import { getOmset, parseReportRange } from "@/lib/services/sales-report.service";

const CACHE_TTL_MS = 60_000;
const VALID_PLATFORMS = new Set(["SHOPEE", "TOKOPEDIA", "TIKTOK_SHOP"]);

// GET /api/reports/omset?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week|month
//   &platform=&accountId= — total + deret waktu + drilldown platform→akun→kategori.
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const platform = url.searchParams.get("platform");
  const g = url.searchParams.get("granularity");
  const granularity = g === "week" || g === "month" ? g : "day";
  const { fromMs, toMs } = parseReportRange(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  const filters = {
    businessId: req.businessId,
    fromMs,
    toMs,
    platform: platform && VALID_PLATFORMS.has(platform) ? platform : null,
    accountId: url.searchParams.get("accountId"),
  };
  const data = await cached(
    `omset:${req.businessId}:${fromMs}:${toMs}:${granularity}:${filters.platform ?? "-"}:${filters.accountId ?? "-"}`,
    CACHE_TTL_MS,
    () => getOmset(filters, granularity)
  );
  return NextResponse.json(data);
});
