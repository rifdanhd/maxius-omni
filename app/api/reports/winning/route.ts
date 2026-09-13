import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { cached } from "@/lib/utils/ttl-cache";
import { getWinning, parseReportRange } from "@/lib/services/sales-report.service";

const CACHE_TTL_MS = 60_000;
const VALID_PLATFORMS = new Set(["SHOPEE", "TOKOPEDIA", "TIKTOK_SHOP"]);

// GET /api/reports/winning?from=YYYY-MM-DD&to=YYYY-MM-DD&platform=&accountId=
//   &groupBy=variant|product&limit= — produk/varian paling laku (PHASE C.2).
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const platform = url.searchParams.get("platform");
  const groupBy = url.searchParams.get("groupBy") === "product" ? "product" : "variant";
  const { fromMs, toMs } = parseReportRange(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  const filters = {
    fromMs,
    toMs,
    platform: platform && VALID_PLATFORMS.has(platform) ? platform : null,
    accountId: url.searchParams.get("accountId"),
  };
  const data = await cached(
    `winning:${fromMs}:${toMs}:${filters.platform ?? "-"}:${filters.accountId ?? "-"}:${groupBy}:${url.searchParams.get("limit") ?? "20"}`,
    CACHE_TTL_MS,
    () => getWinning(filters, groupBy, Number(url.searchParams.get("limit") ?? 20))
  );
  return NextResponse.json({ rows: data });
});
