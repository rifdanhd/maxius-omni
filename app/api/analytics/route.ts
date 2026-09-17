import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { getAnalyticsAggregated } from "@/lib/services/analytics-agg.service";
import { cached } from "@/lib/utils/ttl-cache";

const CACHE_TTL_MS = 60_000;

// Bentuk query lama (query=start=...&end=...) sudah tidak dipakai UI;
// endpoint menyusuri analisis bisnis dashboard (rolling 7 hari vs 7 hari
// sebelumnya, Asia/Jakarta).
export const GET = withAuth(async (req) => {
  const data = await cached(`analytics:${req.businessId}`, CACHE_TTL_MS, () =>
    getAnalyticsAggregated(req.businessId)
  );
  return NextResponse.json(data);
});
