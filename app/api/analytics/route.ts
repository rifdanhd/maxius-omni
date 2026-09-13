import { NextResponse } from "next/server";
import { withAuth } from "@/lib/utils/api";
import { getAnalyticsAggregated } from "@/lib/services/analytics-agg.service";
import { cached } from "@/lib/utils/ttl-cache";

const CACHE_TTL_MS = 60_000;

// Bentuk query lama (query=start=...&end=...) sudah tidak dipakai UI;
// endpoint menyusuri analisis bisnis dashboard (rolling 7 hari vs 7 hari
// sebelumnya, Asia/Jakarta).
export const GET = withAuth(async () => {
  const data = await cached("analytics", CACHE_TTL_MS, getAnalyticsAggregated);
  return NextResponse.json(data);
});
